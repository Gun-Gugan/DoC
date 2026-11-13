# Ajaia Docs

A lightweight collaborative document editor: create, format, import, and share documents with owner / editor / viewer access.

**Live demo:** https://doc-xfkq.onrender.com

**Stack:** `client/` React 19 + React Router + Vite + Quill 2 · `server/` Node.js 22 + Express + MongoDB

## Demo accounts

All passwords are `password123`. The login page has one-click buttons for each.

| User | Email | Suggested role in the demo |
|---|---|---|
| Alice Owner | `alice@ajaia.dev` | Creates and shares documents |
| Bob Editor | `bob@ajaia.dev` | Gets "Can edit" access |
| Carol Viewer | `carol@ajaia.dev` | Gets "Can view" access |

The accounts are seeded automatically on server start, so there's nothing extra to set up.

## What you can do

- **Documents:** create, rename (click the title), edit, and delete them (owner only, via the API). Changes autosave about 0.8 s after you stop typing, and `Ctrl/Cmd+S` saves straight away. A status line shows *Unsaved changes / Saving… / All changes saved*.
- **Formatting:** Heading 1–3, bold, italic, underline, strikethrough, numbered and bulleted lists (with nesting via Tab), quotes, links, and clear formatting.
- **File import:** **Import file** on the dashboard turns a **`.txt`, `.md` or `.docx` file (max 2 MB)** into a new editable document. Markdown and Word headings, lists, and bold/italic are kept. Other file types are rejected with a clear message. You can try it with the files in [`samples/`](samples/).
- **Sharing:** the owner clicks **Share**, enters an email (the field autocompletes from the seeded users), and picks **Can edit** or **Can view**. From the same dialog the owner can change a person's role or remove them.
  - The dashboard splits **My documents** from **Shared with me**. Each document has a role badge, and shared documents show who owns them.
  - Viewers get a read-only editor with no toolbar and a banner saying so.
  - The server enforces all of this. If a user has no access, the API returns 404 so it doesn't reveal that the document exists.
- **Safe concurrent saves:** every content save sends the version it was based on. If someone else saved in between, the server responds `409`. The editor then stops and offers *Reload latest* rather than silently overwriting the other person's work.

## Repository layout

The client and server are two independent Node projects, each with its own `package.json`. They are run, built and deployed separately.

```
server/                  REST API: Express + MongoDB
  src/server.js            entry point: reads env, connects to Mongo, starts HTTP
  src/app.js               routes: auth, documents, sharing, import; CORS + CSRF guard; errors
  src/db.js                Mongo connection, indexes, demo-user seeding
  src/auth.js              scrypt password hashing, session cookie middleware
  src/content.js           HTML sanitizer + file → HTML conversion (.txt / .md / .docx)
  test/api.test.js         API tests (node:test + in-memory MongoDB)
client/                  Web app: React 19 + React Router + Vite + Quill 2
  src/App.jsx              auth context, routes, app shell
  src/pages/               Login, Dashboard, Editor
  src/components/          ShareDialog, Toast
  src/api.js               fetch wrapper (API base URL from VITE_API_URL)
samples/                 example files for the import flow
docs/                    ARCHITECTURE.md, AI_WORKFLOW.md
render.yaml              Render blueprint: single web service (API + built client)
```

## Run locally

Requirements: Node.js ≥ 20 (22 recommended) and a MongoDB you can reach. If you don't have one:

```bash
docker run -d --name ajaia-mongo -p 27017:27017 mongo:7
```

**1. API server** (terminal 1):

```bash
cd server
```

```bash
npm install
```

```bash
npm run dev
```

The API listens on http://localhost:3000. Check it with http://localhost:3000/api/health. The server reads `server/.env` automatically if it exists: copy `server/.env.example` and fill it in.

**2. Client** (terminal 2):

```bash
cd client
```

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. In development, Vite proxies `/api` to the API server, so no CORS setup is needed.

### Server configuration (`server/.env.example`)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | |
| `MONGODB_DB` | `ajaia_docs` | |
| `CORS_ORIGIN` | — | The client's URL when it's hosted on another origin. Accepts a comma-separated list. |
| `CLIENT_DIST` | — | Path to the client build, relative to `server/` (e.g. `../client/dist`). When set, the API also serves the web app from the same origin. Used for the live deployment. |
| `NODE_ENV` | — | `production` turns on Secure cookies and trust proxy. Together with `CORS_ORIGIN`, the session cookie becomes `SameSite=None` so it works cross-site. |

### Client configuration (`client/.env.example`)

| Variable | Default | |
|---|---|---|
| `VITE_API_URL` | empty (same origin) | The API's public URL for a deployed build, e.g. `https://ajaia-docs-api.onrender.com`. It's read at build time. |
| `API_PROXY_TARGET` | `http://localhost:3000` | Dev only: where Vite proxies `/api`. |

### API security when split

- **CORS:** the API only allows credentialed requests from `CORS_ORIGIN`.
- **CSRF:** every state-changing request has to send the header `X-Requested-With: ajaia-docs`. A browser only sends a custom header cross-origin after a CORS preflight, and only the allowed client origin passes that preflight. Requests without the header get a 403.

## Tests

```bash
cd server
```

```bash
npm test
```

The tests use `node:test` against the real Express app and a throwaway in-memory MongoDB (`mongodb-memory-server`), so they don't need a running database. On the first run it downloads a MongoDB binary (~100 MB). If you already have `mongod` installed, you can skip the download:

```bash
MONGOMS_SYSTEM_BINARY=$(which mongod) npm test
```

What's covered:
- **Access control:** a document that isn't shared returns 404. A viewer can read it but can't edit or reshare it. Upgrading a viewer to editor lets them save. Editors can't delete. Revoking access works. Bad share input (unknown email, invalid role, sharing with yourself) is rejected.
- **Optimistic concurrency:** a stale `baseVersion` gets a 409 and the stored content stays as it was. A rename doesn't bump the content version.
- **Sanitization:** `<script>`, `onerror` and `onclick` are stripped, while headings, underline, lists and indent classes are kept.
- **Import:** `.md` comes through as headings and lists, `.txt` as escaped paragraphs, and `.pdf` is rejected.
- **Auth and CSRF:** requests without a session get 401, a wrong password gets 401, and a write without the CSRF header gets 403.

## Deploy (free tier)

The live deployment is **one Render web service on one URL**. The build compiles `client/`, and the API serves that build when `CLIENT_DIST` is set. The browser then talks to a single origin: first-party cookies, no CORS, and no third-party-cookie blocking in Safari or incognito. The two projects still build and run independently. To host them separately instead, see `CORS_ORIGIN` / `VITE_API_URL` above.

1. **MongoDB Atlas (free M0):**
   - Create a database user.
   - Under **Network Access**, allow `0.0.0.0/0`, because Render's outbound IPs aren't fixed.
   - Copy the `mongodb+srv://…` string. URL-encode special characters in the password, e.g. `@` → `%40`.
2. **GitHub:** push this folder to a new repository.
3. **Render:** choose **New → Blueprint** and pick the repo, or create a plain **Web Service** with the defaults. Either way the root `package.json` handles it:
   - build: `npm install`. Its `postinstall` installs and builds `client/`, then installs `server/`.
   - start: `npm start`. This runs the API with `CLIENT_DIST=../client/dist`.
4. When Render asks for `MONGODB_URI`, paste the Atlas string. Then deploy.
5. Open `https://<service>.onrender.com`. The demo users are seeded on first boot. Health check: `/api/health`.

Note: Render's free instances sleep after 15 minutes without traffic, and waking takes up to about a minute. `.github/workflows/keep-alive.yml` pings `/api/health` every 10 minutes to keep the demo warm. If the first load is slow anyway, wait a moment and refresh.

## Status

Working end to end: auth with the seeded users, create, rename, edit with autosave, reopen, rich-text formatting kept across reloads, `.txt`/`.md`/`.docx` import, sharing by email with editor/viewer roles, the owned vs shared split on the dashboard, view-only mode, conflict detection, and automated tests.

Deliberately not built (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):
- real-time co-editing and presence
- comments
- version history
- export
- sign-up and password reset
- a delete button in the UI (the API supports it)
