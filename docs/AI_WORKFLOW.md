# AI workflow note

## Tools used

- **Claude Code** (Claude Opus 5.5 in the Claude desktop app). I used it as a pair programmer that could read and write files, run the tests, and drive a browser to check the UI.
- I made the product and scope decisions, reviewed every diff, and did the manual testing myself.

## Where AI materially sped things up

- **Scaffolding the boring-but-necessary parts.** Express routing, error middleware, multer limits, scrypt hashing, and the sanitize-html whitelist each came together in minutes rather than an hour.
- **Library glue.** It knew the shape of the Quill 2 API (`dangerouslyPasteHTML`, how list markup is stored as `<ol><li data-list="bullet">`), the mammoth and marked APIs, and how to use `mongodb-memory-server` with a system binary. That saved a lot of time in docs.
- **Writing the test suite.** It drafted the access-control matrix (none / viewer / editor / owner × read / write / share / delete) as one readable scenario test. I then checked each assertion against the behaviour I actually wanted.
- **Browser verification.** It drove the app through the built-in browser: log in as Alice, format text, rename, reload, share with Bob as viewer, then log in as Bob. It also read the DOM to confirm view-only mode instead of trusting screenshots.

## What I changed or rejected

- **The storage choice.** The first plan was SQLite, because it's zero-setup and built into Node 22. I switched it to **MongoDB**. Documents with embedded share lists map naturally onto a document store, and Atlas's free tier makes the deployment path straightforward.
- **A version-conflict bug in the first draft.** The first version bumped the document `version` on renames too. A rename made while a content save was in flight would then raise a 409 against *your own* save. I caught this while reviewing the save-queue logic and changed it so only content changes bump the version. There's now a test asserting that a rename leaves the version untouched.
- **The frontend framework.** The first frontend was a dependency-free vanilla JS SPA. I had it rewritten in **React 19 + Vite** to match the stack I'd use in production. The API and tests didn't change, and I re-ran the browser checks against the React build.
- **A deployment bug caught during the React port.** The SPA fallback first used `res.sendFile(absolutePath)`. That returned 404 whenever the project sat under a dot-directory, because Express's `send` treats any dotted path segment as a hidden file. Deep links like `/docs/:id` broke. I switched it to `sendFile('index.html', { root })`.
- **Splitting the client and server.** I had the single package split into independent `client/` and `server/` projects. That required real changes beyond moving files: an API-only server, credentialed CORS limited to `CORS_ORIGIN`, `SameSite=None` cookies for cross-site deployment, a custom-header CSRF guard (with a test for it), and a client API URL set at build time. I checked the CORS behaviour with preflight requests from an allowed origin and a disallowed one.
- **The test runner script.** The generated `node --test test/` fails on Node 22, which treats the path as a file. I changed it to a glob.
- **Trusting screenshots.** During browser checks, two screenshots came back stale: one showed the login page while the app was actually on the editor. The DOM, the network log, and the URL all disagreed with the image. After that I checked state with DOM queries and the network log, not pixels.
- **Scope I chose not to add:** while testing, I found that typing `* ` doesn't start a bullet list, because Quill doesn't ship Markdown shortcuts. I left it out: the toolbar and keyboard shortcuts were enough for the timebox. I also skipped extra stretch features in favour of hardening the core flow.

## How I verified correctness, UX and reliability

- **Automated:** `npm test` runs 5 API tests against the real Express app and a real (in-memory) MongoDB. They cover access control, optimistic concurrency, sanitization (XSS payloads stripped, formatting kept), import of each file type, and auth failures.
- **Manual, in the browser:** the full flow across two users. Formatting survived a hard reload. The title and status line behave correctly. View-only mode has no toolbar and isn't editable. The roles shown in the share dialog match what the server returns.
- **Edge cases with curl:** `.docx` import (generated with python-docx), an unsupported `.pdf`, and an oversized 3 MB file. Each one gave a clear error message.
- **Reading the code:** I reviewed every AI-written file before keeping it. I paid most attention to the authorization gate (`loadDoc`), the sanitizer whitelist, and the autosave queue, because those are where subtle bugs hurt the most.
