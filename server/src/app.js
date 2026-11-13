'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const {
  SESSION_COOKIE, verifyPassword, newSessionToken, requireAuth, publicUser,
} = require('./auth');
const { sanitize, fileToDocument, MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS } = require('./content');

const MAX_TITLE = 200;
const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MB of HTML per document
const ROLES = ['viewer', 'editor'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseId(id) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'Document not found');
  return new ObjectId(id);
}

function validateTitle(title) {
  if (typeof title !== 'string') throw new HttpError(400, 'Title must be a string');
  const t = title.trim();
  if (!t) throw new HttpError(400, 'Title cannot be empty');
  if (t.length > MAX_TITLE) throw new HttpError(400, `Title must be at most ${MAX_TITLE} characters`);
  return t;
}

/** Returns 'owner' | 'editor' | 'viewer' | null for this user on this document. */
function roleFor(doc, userId) {
  if (doc.ownerId.equals(userId)) return 'owner';
  const share = (doc.shares || []).find((s) => s.userId.equals(userId));
  return share ? share.role : null;
}

/**
 * @param {object} options
 * @param {boolean} options.secureCookies  set Secure on the session cookie (HTTPS deployments)
 * @param {string[]} options.corsOrigins   client origins allowed to call the API with cookies.
 *   When set, the client lives on another site, so the cookie must be SameSite=None (which requires Secure).
 * @param {string} [options.clientDist]    optional path to the client's build output. When set, the API also
 *   serves the web client from the same origin (single-service deployment).
 */
function createApp(store, { secureCookies = false, corsOrigins = [], clientDist } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const crossSite = corsOrigins.length > 0 && secureCookies;
  const cookieOptions = {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: secureCookies,
    maxAge: 7 * 24 * 3600 * 1000,
  };

  if (corsOrigins.length) {
    app.use(cors({ origin: corsOrigins, credentials: true, allowedHeaders: ['Content-Type', 'X-Requested-With'] }));
  }
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // CSRF guard: every state-changing request must carry a custom header. Browsers only send custom
  // headers cross-origin after a CORS preflight, which only our allowed client origins pass.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'ajaia-docs') {
      return res.status(403).json({ error: 'Missing X-Requested-With header' });
    }
    next();
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  /** Loads a document and enforces the minimum role. 404 when the user has no access (no existence leak). */
  async function loadDoc(req, minRole) {
    const doc = await store.documents.findOne({ _id: parseId(req.params.id) });
    const role = doc && roleFor(doc, req.user._id);
    if (!doc || !role) throw new HttpError(404, 'Document not found');
    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[minRole]) {
      throw new HttpError(403, minRole === 'owner' ? 'Only the owner can do that' : 'You have view-only access');
    }
    return { doc, role };
  }

  async function usersById(ids) {
    const unique = [...new Map(ids.map((id) => [String(id), id])).values()];
    const users = await store.users.find({ _id: { $in: unique } }).toArray();
    return new Map(users.map((u) => [String(u._id), u]));
  }

  async function serializeDoc(doc, role) {
    const people = await usersById([doc.ownerId, ...(doc.shares || []).map((s) => s.userId)]);
    const owner = people.get(String(doc.ownerId));
    return {
      id: String(doc._id),
      title: doc.title,
      content: doc.content,
      version: doc.version,
      role,
      owner: owner ? publicUser(owner) : null,
      shares: role === 'owner'
        ? (doc.shares || []).map((s) => ({ ...publicUser(people.get(String(s.userId)) || { _id: s.userId }), role: s.role }))
        : undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async function createDocument(ownerId, title, content) {
    const now = new Date();
    const doc = { title, content, ownerId, shares: [], version: 1, createdAt: now, updatedAt: now };
    const { insertedId } = await store.documents.insertOne(doc);
    return { ...doc, _id: insertedId };
  }

  // ---------- auth ----------
  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }
    const user = await store.users.findOne({ email: email.trim().toLowerCase() });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Incorrect email or password');
    }
    const token = newSessionToken();
    await store.sessions.insertOne({ _id: token, userId: user._id, createdAt: new Date() });
    res.cookie(SESSION_COOKIE, token, cookieOptions);
    res.json({ user: publicUser(user) });
  }));

  app.post('/api/auth/logout', wrap(async (req, res) => {
    const token = req.cookies && req.cookies[SESSION_COOKIE];
    if (token) await store.sessions.deleteOne({ _id: token });
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  }));

  const auth = requireAuth(store);

  app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  // Small directory used by the share dialog's autocomplete.
  app.get('/api/users', auth, wrap(async (req, res) => {
    const users = await store.users.find({ _id: { $ne: req.user._id } }).sort({ email: 1 }).toArray();
    res.json({ users: users.map(publicUser) });
  }));

  // ---------- documents ----------
  app.get('/api/documents', auth, wrap(async (req, res) => {
    const projection = { content: 0 };
    const [owned, shared] = await Promise.all([
      store.documents.find({ ownerId: req.user._id }, { projection }).sort({ updatedAt: -1 }).toArray(),
      store.documents.find({ 'shares.userId': req.user._id }, { projection }).sort({ updatedAt: -1 }).toArray(),
    ]);
    const people = await usersById(shared.map((d) => d.ownerId));
    const summary = (d) => {
      const role = roleFor(d, req.user._id);
      const owner = people.get(String(d.ownerId));
      return {
        id: String(d._id),
        title: d.title,
        role,
        owner: role === 'owner' ? publicUser(req.user) : owner ? publicUser(owner) : null,
        sharedWithCount: (d.shares || []).length,
        updatedAt: d.updatedAt,
      };
    };
    res.json({ owned: owned.map(summary), shared: shared.map(summary) });
  }));

  app.post('/api/documents', auth, wrap(async (req, res) => {
    const body = req.body || {};
    const title = body.title === undefined ? 'Untitled document' : validateTitle(body.title);
    const doc = await createDocument(req.user._id, title, '');
    res.status(201).json({ document: await serializeDoc(doc, 'owner') });
  }));

  app.post('/api/documents/import', auth, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(413, `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`));
      }
      if (err) return next(new HttpError(400, err.message));
      next();
    });
  }, wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, `Choose a file to upload (${SUPPORTED_EXTENSIONS.join(', ')})`);
    const { title, html } = await fileToDocument(req.file.originalname, req.file.buffer);
    const doc = await createDocument(req.user._id, title, html);
    res.status(201).json({ document: await serializeDoc(doc, 'owner') });
  }));

  app.get('/api/documents/:id', auth, wrap(async (req, res) => {
    const { doc, role } = await loadDoc(req, 'viewer');
    res.json({ document: await serializeDoc(doc, role) });
  }));

  /**
   * Updates title and/or content. Content updates use optimistic concurrency:
   * the client sends the version it last saw; if someone else saved in between we return 409
   * instead of silently overwriting their work.
   */
  app.patch('/api/documents/:id', auth, wrap(async (req, res) => {
    const { doc } = await loadDoc(req, 'editor');
    const body = req.body || {};
    const set = { updatedAt: new Date() };
    if (body.title !== undefined) set.title = validateTitle(body.title);
    if (body.content !== undefined) {
      if (typeof body.content !== 'string') throw new HttpError(400, 'Content must be an HTML string');
      if (Buffer.byteLength(body.content) > MAX_CONTENT_BYTES) throw new HttpError(413, 'Document is too large (max 1 MB)');
      if (!Number.isInteger(body.baseVersion)) throw new HttpError(400, 'baseVersion is required when saving content');
      set.content = sanitize(body.content);
    }
    if (!('title' in set) && !('content' in set)) throw new HttpError(400, 'Nothing to update');

    // Only content changes bump the version, so a rename never conflicts with an in-flight content save.
    const filter = { _id: doc._id };
    const update = { $set: set };
    if ('content' in set) {
      filter.version = body.baseVersion;
      update.$inc = { version: 1 };
    }
    const updated = await store.documents.findOneAndUpdate(
      filter,
      update,
      { returnDocument: 'after' }
    );
    if (!updated) {
      const current = await store.documents.findOne({ _id: doc._id }, { projection: { version: 1 } });
      return res.status(409).json({
        error: 'This document was changed by someone else since you opened it. Reload to get the latest version.',
        currentVersion: current ? current.version : null,
      });
    }
    res.json({ document: await serializeDoc(updated, roleFor(updated, req.user._id)) });
  }));

  app.delete('/api/documents/:id', auth, wrap(async (req, res) => {
    const { doc } = await loadDoc(req, 'owner');
    await store.documents.deleteOne({ _id: doc._id });
    res.json({ ok: true });
  }));

  // ---------- sharing ----------
  app.put('/api/documents/:id/shares', auth, wrap(async (req, res) => {
    const { doc } = await loadDoc(req, 'owner');
    const { email, role = 'editor' } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Email is required');
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    const target = await store.users.findOne({ email: email.trim().toLowerCase() });
    if (!target) throw new HttpError(404, `No user with email ${email.trim()}`);
    if (target._id.equals(doc.ownerId)) throw new HttpError(400, 'You already own this document');

    // Upsert the share: update the role if already shared, otherwise append.
    const res1 = await store.documents.updateOne(
      { _id: doc._id, 'shares.userId': target._id },
      { $set: { 'shares.$.role': role } }
    );
    if (res1.matchedCount === 0) {
      await store.documents.updateOne(
        { _id: doc._id },
        { $push: { shares: { userId: target._id, role, sharedAt: new Date() } } }
      );
    }
    const fresh = await store.documents.findOne({ _id: doc._id });
    res.json({ document: await serializeDoc(fresh, 'owner') });
  }));

  app.delete('/api/documents/:id/shares/:userId', auth, wrap(async (req, res) => {
    const { doc } = await loadDoc(req, 'owner');
    if (!ObjectId.isValid(req.params.userId)) throw new HttpError(404, 'Share not found');
    await store.documents.updateOne(
      { _id: doc._id },
      { $pull: { shares: { userId: new ObjectId(req.params.userId) } } }
    );
    const fresh = await store.documents.findOne({ _id: doc._id });
    res.json({ document: await serializeDoc(fresh, 'owner') });
  }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  if (clientDist) {
    // Single-origin deployment: serve the built React app and fall back to index.html for client routes.
    // `root` (not an absolute path) so a dot-directory above the app isn't rejected as a dotfile.
    app.use(express.static(clientDist));
    app.get(/^\/(?!api\/).*/, (req, res, next) => res.sendFile('index.html', { root: clientDist }, (err) => err && next(err)));
  } else {
    app.get('/', (req, res) => res.json({ name: 'Ajaia Docs API', health: '/api/health' }));
  }
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
  });

  return app;
}

module.exports = { createApp };
