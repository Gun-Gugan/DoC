# Submission: Ajaia Docs

- **Live product URL:** https://doc-xfkq.onrender.com
- **Walkthrough video:** see [`VIDEO_URL.txt`](VIDEO_URL.txt)
- **Demo accounts** (password `password123` for all three; the login page has one-click buttons):
  - `alice@ajaia.dev`
  - `bob@ajaia.dev`
  - `carol@ajaia.dev`

## What's in this folder

| Path | What |
|---|---|
| `README.md` | Overview, local setup/run, tests, deployment, feature status |
| `docs/ARCHITECTURE.md` | Architecture note: data model, what I prioritized, scope cuts, next steps |
| `docs/AI_WORKFLOW.md` | AI workflow note: tools, speed-ups, what I changed or rejected, verification |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Link to the 3–5 minute walkthrough video |
| `server/` | Backend REST API (Express + MongoDB), with its own `package.json` |
| `server/test/api.test.js` | Automated API tests (`cd server && npm test`) |
| `client/` | Frontend (React 19 + Vite + Quill editor), with its own `package.json` |
| `samples/` | Example `.md`, `.txt` and `.docx` files for trying the import feature |
| `render.yaml` | Render blueprint: one web service that builds the client and serves it from the API |
| `server/.env.example`, `client/.env.example` | Configuration |

`node_modules/` and `client/dist/` are not included. Run `npm install` in `server/` and in `client/` (see the README).

## Suggested 3-minute review path

1. Sign in as **alice**. Click **+ New document**, type some text, and use the toolbar: a heading, bold/italic/underline, and a bulleted and a numbered list. Watch the status change to *All changes saved*. Then rename the document by clicking its title.
2. Reload the page. The document and its formatting are still there.
3. Click **Share**. Add `bob@ajaia.dev` as **Can edit** and `carol@ajaia.dev` as **Can view**.
4. Sign out and sign in as **bob**. The document is under **Shared with me** with an *Owned by Alice* label, and Bob can edit it.
5. Sign in as **carol**. The document opens read-only, with a view-only banner and no toolbar.
6. Back on the dashboard, use **Import file** with something from `samples/`. Each file becomes a new editable document.
7. Optional: open the same document as Alice and Bob in two browsers, edit it in both, and see the conflict banner instead of a silent overwrite.

## Status

- **Working end to end:** everything in the brief's core list: create, rename, edit, save and reopen documents; rich-text formatting; file upload (`.txt`/`.md`/`.docx` → new document); sharing with an owner and a visible owned/shared distinction; persistence in MongoDB; validation and error handling; automated tests; architecture and AI notes.
- **Stretch done:** role-based sharing (editor vs viewer).
- **Incomplete / not built:** real-time co-editing, comments, version history, export, sign-up, and a delete button in the UI (the API supports delete).
- **Next 2–4 hours:** change polling and live "updated by" prompts, version history with restore, Markdown/PDF export, Playwright E2E tests, and rate limiting. Details are in `docs/ARCHITECTURE.md`.
