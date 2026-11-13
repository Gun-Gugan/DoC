'use strict';
const crypto = require('crypto');

const SESSION_COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Express middleware: resolves the session cookie to req.user or responds 401. */
function requireAuth(store) {
  return async (req, res, next) => {
    try {
      const token = req.cookies && req.cookies[SESSION_COOKIE];
      if (!token) return res.status(401).json({ error: 'Not signed in' });
      const session = await store.sessions.findOne({ _id: token });
      if (!session) return res.status(401).json({ error: 'Session expired, please sign in again' });
      const user = await store.users.findOne({ _id: session.userId });
      if (!user) return res.status(401).json({ error: 'Account not found' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function publicUser(u) {
  return { id: String(u._id), email: u.email, name: u.name };
}

module.exports = { SESSION_COOKIE, hashPassword, verifyPassword, newSessionToken, requireAuth, publicUser };
