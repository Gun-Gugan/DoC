'use strict';
// End-to-end API tests: real Express app + a throwaway in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { connect } = require('../src/db');
const { createApp } = require('../src/app');

let mongo, store, server, base;
const CSRF = { 'X-Requested-With': 'ajaia-docs' };

before(async () => {
  mongo = await MongoMemoryServer.create();
  store = await connect(mongo.getUri(), 'ajaia_test');
  server = createApp(store).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server && server.close();
  store && (await store.client.close());
  mongo && (await mongo.stop());
});

/** Minimal cookie-aware client for one user. */
async function login(email, password = 'password123') {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body, form } = {}) => {
    const headers = { cookie, ...CSRF };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(`${base}${path}`, { method, headers, body: payload });
    return { status: r.status, body: await r.json() };
  };
}

test('rejects unauthenticated requests and bad credentials', async () => {
  const r = await fetch(`${base}/api/documents`);
  assert.equal(r.status, 401);
  const bad = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ email: 'alice@ajaia.dev', password: 'wrong' }),
  });
  assert.equal(bad.status, 401);
});

test('sharing grants, limits and revokes access', async () => {
  const alice = await login('alice@ajaia.dev');
  const bob = await login('bob@ajaia.dev');

  const created = await alice('/api/documents', { method: 'POST', body: { title: 'Q3 plan' } });
  assert.equal(created.status, 201);
  const id = created.body.document.id;

  // Not shared yet: Bob cannot see it at all (404, not 403, so existence is not leaked).
  assert.equal((await bob(`/api/documents/${id}`)).status, 404);

  // Share as viewer: Bob can read, appears under "shared", but cannot edit or reshare.
  const shared = await alice(`/api/documents/${id}/shares`, { method: 'PUT', body: { email: 'bob@ajaia.dev', role: 'viewer' } });
  assert.equal(shared.status, 200);
  const bobList = await bob('/api/documents');
  assert.deepEqual(bobList.body.shared.map((d) => [d.id, d.role, d.owner.email]), [[id, 'viewer', 'alice@ajaia.dev']]);
  assert.equal(bobList.body.owned.length, 0);
  const bobView = await bob(`/api/documents/${id}`);
  assert.equal(bobView.body.document.role, 'viewer');
  assert.equal(bobView.body.document.shares, undefined, 'non-owners do not see the share list');
  assert.equal((await bob(`/api/documents/${id}`, { method: 'PATCH', body: { content: '<p>x</p>', baseVersion: 1 } })).status, 403);
  assert.equal((await bob(`/api/documents/${id}/shares`, { method: 'PUT', body: { email: 'carol@ajaia.dev' } })).status, 403);

  // Upgrade to editor (re-sharing updates the role rather than duplicating the share).
  const upgraded = await alice(`/api/documents/${id}/shares`, { method: 'PUT', body: { email: 'bob@ajaia.dev', role: 'editor' } });
  assert.equal(upgraded.body.document.shares.length, 1);
  assert.equal(upgraded.body.document.shares[0].role, 'editor');
  const edit = await bob(`/api/documents/${id}`, { method: 'PATCH', body: { content: '<p><strong>Bob was here</strong></p>', baseVersion: 1 } });
  assert.equal(edit.status, 200);
  assert.equal((await alice(`/api/documents/${id}`)).body.document.content, '<p><strong>Bob was here</strong></p>');
  // Editors still cannot delete.
  assert.equal((await bob(`/api/documents/${id}`, { method: 'DELETE' })).status, 403);

  // Revoke.
  const bobId = upgraded.body.document.shares[0].id;
  assert.equal((await alice(`/api/documents/${id}/shares/${bobId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await bob(`/api/documents/${id}`)).status, 404);

  // Validation on share input.
  assert.equal((await alice(`/api/documents/${id}/shares`, { method: 'PUT', body: { email: 'nobody@x.dev' } })).status, 404);
  assert.equal((await alice(`/api/documents/${id}/shares`, { method: 'PUT', body: { email: 'bob@ajaia.dev', role: 'admin' } })).status, 400);
  assert.equal((await alice(`/api/documents/${id}/shares`, { method: 'PUT', body: { email: 'alice@ajaia.dev' } })).status, 400);
});

test('stale saves are rejected with 409 instead of overwriting', async () => {
  const alice = await login('alice@ajaia.dev');
  const { body } = await alice('/api/documents', { method: 'POST', body: {} });
  const id = body.document.id;
  assert.equal(body.document.title, 'Untitled document');

  const first = await alice(`/api/documents/${id}`, { method: 'PATCH', body: { content: '<p>v2</p>', baseVersion: 1 } });
  assert.equal(first.status, 200);
  assert.equal(first.body.document.version, 2);

  // A rename does not bump the content version.
  const renamed = await alice(`/api/documents/${id}`, { method: 'PATCH', body: { title: '  Renamed  ' } });
  assert.equal(renamed.body.document.title, 'Renamed');
  assert.equal(renamed.body.document.version, 2);

  const stale = await alice(`/api/documents/${id}`, { method: 'PATCH', body: { content: '<p>stale</p>', baseVersion: 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.currentVersion, 2);
  assert.equal((await alice(`/api/documents/${id}`)).body.document.content, '<p>v2</p>');

  // Validation.
  assert.equal((await alice(`/api/documents/${id}`, { method: 'PATCH', body: { title: '   ' } })).status, 400);
  assert.equal((await alice(`/api/documents/${id}`, { method: 'PATCH', body: { content: '<p>x</p>' } })).status, 400);
  assert.equal((await alice('/api/documents/not-an-id')).status, 404);
});

test('saved HTML is sanitized but keeps formatting', async () => {
  const alice = await login('alice@ajaia.dev');
  const id = (await alice('/api/documents', { method: 'POST', body: {} })).body.document.id;
  const dirty = '<h1>Title</h1><p><u>u</u><em>i</em><img src=x onerror=alert(1)><script>alert(1)</script></p>'
    + '<ol><li data-list="bullet" class="ql-indent-1" onclick="x()">item</li></ol>';
  const res = await alice(`/api/documents/${id}`, { method: 'PATCH', body: { content: dirty, baseVersion: 1 } });
  assert.equal(
    res.body.document.content,
    '<h1>Title</h1><p><u>u</u><em>i</em></p><ol><li data-list="bullet" class="ql-indent-1">item</li></ol>'
  );
});

test('file import turns .md and .txt into documents and rejects other types', async () => {
  const alice = await login('alice@ajaia.dev');
  const upload = (name, text) => {
    const form = new FormData();
    form.append('file', new Blob([text]), name);
    return alice('/api/documents/import', { method: 'POST', form });
  };

  const md = await upload('Meeting notes.md', '# Agenda\n\n- **Budget**\n- Hiring\n\n<script>alert(1)</script>');
  assert.equal(md.status, 201);
  assert.equal(md.body.document.title, 'Meeting notes');
  assert.match(md.body.document.content, /<h1>Agenda<\/h1>/);
  assert.match(md.body.document.content, /<ul>\s*<li><strong>Budget<\/strong><\/li>/);
  assert.doesNotMatch(md.body.document.content, /script/);

  const txt = await upload('todo.txt', 'line one\nline two\n\n<b>second</b> para');
  assert.equal(txt.body.document.content, '<p>line one<br />line two</p><p>&lt;b&gt;second&lt;/b&gt; para</p>');

  const pdf = await upload('report.pdf', '%PDF-1.4');
  assert.equal(pdf.status, 400);
  assert.match(pdf.body.error, /Unsupported file type/);

  const list = await alice('/api/documents');
  assert.ok(list.body.owned.some((d) => d.title === 'Meeting notes'));
});

test('state-changing requests without the CSRF header are rejected', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@ajaia.dev', password: 'password123' }),
  });
  assert.equal(res.status, 403);
});
