# Architecture note

## Shape of the system

```
client/  React 19 SPA (Vite build, static hosting) + Quill 2
   │  JSON over fetch (CORS, credentials), httpOnly session cookie, X-Requested-With CSRF header
   ▼
server/  Express REST API (server/src/app.js)
   ├─ auth: scrypt-hashed seeded users, random session tokens
   ├─ documents: CRUD + optimistic-concurrency saves
   ├─ sharing: owner-managed { userId, role } list per document
   └─ import: multer (in-memory, 2 MB) → mammoth / marked / text → sanitize-html
   ▼
MongoDB: users · sessions (TTL index, 7 days) · documents
```

The client and server are separate projects with separate `package.json` files, and they are deployed separately: the client as a static site, the server as an API-only web service. The client's API base URL is a build-time setting (`VITE_API_URL`). The server allows credentialed CORS only from `CORS_ORIGIN`.

Cross-site cookies have to be `SameSite=None`, so the server also requires a custom `X-Requested-With` header on every state-changing request. Browsers won't send a custom header cross-origin without a CORS preflight, and only the allowed client origin passes that preflight. That gives CSRF protection without token plumbing.

In development, Vite proxies `/api` to the server, so everything is same-origin and no CORS is involved.

Why split them: each side can be developed, scaled and deployed on its own.

For the live demo I still deploy them on **one origin**. The Render build compiles the client, and the API serves it via `CLIENT_DIST`. Browsers increasingly block third-party cookies (Safari, incognito Chrome), and a reviewer's login failing for that reason would be the worst possible demo bug. A single origin also means one free service to wake up instead of two. The cross-origin path (CORS allow-list, `SameSite=None`, CSRF header) is still implemented and tested, for when the two do need to live apart.

On the frontend, Quill is mounted imperatively inside a React effect rather than through a wrapper library: `react-quill` doesn't support React 19. Autosave state (dirty, in-flight, version, timer) lives in a ref, so keystrokes don't cause re-renders. Only the visible status text is React state.

## Data model

```js
documents: {
  _id, title, content /* sanitized HTML */, ownerId,
  shares: [{ userId, role: 'editor' | 'viewer', sharedAt }],
  version /* incremented on each content save */, createdAt, updatedAt
}
```

Shares are embedded in the document rather than kept in a join collection. The access check then reads one document, and "shared with me" is a single indexed query on `shares.userId`. A document only ever has a handful of collaborators, so embedding is the idiomatic Mongo choice here.

Content is stored as **HTML**, specifically the editor's own markup. The alternative was Quill's Delta JSON. I picked HTML for these reasons:
- File import naturally produces HTML (mammoth, marked).
- The stored content can be read without the editor.
- It sanitizes cleanly against a whitelist.

The tradeoff is that HTML isn't a good base for operational-transform real-time editing. If live co-editing became a requirement, I'd move to Delta or Yjs.

## What I prioritized and why

1. **The core editing loop feels right.** The flow is create → type → it saves itself → reload → it's all still there. Autosave uses a debounce and a single-flight save queue, so there's only ever one request in flight and the latest content wins. It also has a visible save status, `Ctrl+S`, a warning when you leave with unsaved changes, and retry on network errors.
2. **Access control is real, not cosmetic.** Every document route goes through one `loadDoc(req, minRole)` gate with a strict ranking: owner > editor > viewer. The UI hides controls the user can't use, but the server is the authority. When a user has no access, the API answers 404 rather than 403, so it doesn't leak that the document exists.
3. **No silent data loss.** Two editors on the same document could otherwise overwrite each other without either noticing. Saves are compare-and-set on `version`, done atomically with `findOneAndUpdate({ _id, version })`. A stale save gets a 409, and the UI stops and offers a reload. Renames don't bump the version, so renaming never conflicts with your own pending save. This is the cheapest correct alternative to real-time sync.
4. **Untrusted HTML is sanitized on the server.** Both saved content and imported content are untrusted. Everything passes through one whitelist that matches what the toolbar can produce.
5. **Import that is actually useful.** The product-relevant case is "I have notes in a file and want them as a doc". `.docx`, `.md` and `.txt` cover most of that. Each upload becomes a new owned document with its title taken from the filename.

## Deliberate scope cuts

| Cut | Why |
|---|---|
| Real-time co-editing and presence | This is the biggest cost (OT/CRDT, websockets) for this timebox. Optimistic locking prevents data loss, which is the part that matters most. |
| Sign-up, password reset, OAuth | The brief allows seeded users. A real product would use SSO. |
| PDF import, attachments | `.docx`/`.md`/`.txt` cover the "turn my notes into a doc" case. PDF-to-rich-text conversion is lossy and slow. |
| Version history, comments, export | These are stretch goals. I spent the stretch time on role-based sharing (editor vs viewer), because it builds on the sharing model reviewers have to test anyway. |
| A delete button in the UI | The API supports owner-only delete (and it's tested). I left the destructive action out of the demo UI to keep the surface small. |

## What I'd build next (2–4 more hours)

1. Make the dashboard and editor poll for changes. Viewers would see edits live, and editors would get a "Bob updated this document" prompt before a conflict happens.
2. Version history. Keep the previous `content` on each save, capped at N versions, with a restore action.
3. Export to Markdown or PDF, plus a delete button with an undo toast.
4. Playwright end-to-end tests for the browser flows (autosave, conflict banner, view-only mode).
5. Rate-limit the login and import routes, and add a CSRF token if the app ever goes cross-origin. The current SameSite=Lax cookie plus JSON-only API covers same-site usage.
