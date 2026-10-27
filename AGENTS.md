# AGENTS.md

## Repo shape
- Node.js app only; the former Google Apps Script project (`Kód.js`, `appsscript.json`) is deleted. Migration notes: `NODE_MIGRATION.md`.
- Server: plain `node:http` (no framework), CommonJS (`*.cjs`) in `server/`. UI is the two untouched Hungarian HTML files in root: `index.html` (public client form) and `dashboard_v2.html` (owner dashboard).
- Data lives outside the repo: the `Adatok` Google Sheet (A–AN, 40 cols) and the Drive project folders (Google Sheets/Drive/Docs APIs + IMAP/SMTP).

## Module map
- `server/index.cjs` — HTTP server: `/health`, OAuth login/callback/logout, `/dashboard`, `/api/rpc`, `/form`, `/api/form`. Exports `{server, authenticated, pack, unpack}`; only listens when run directly.
- `server/config.cjs` — env loading/validation (`loadConfig`, `REQUIRED`).
- `server/domain.cjs` — pure business logic: `FIELDS`/`buildRow`/`rowToData`, validation, folder names, restart postfix, plan scales, room list, building value, cover selection, merge fields, conditional markers, dates.
- `server/google.cjs` — low-level Sheets/Drive/Docs clients (`values`, `update`, `listChildren`, `createFile`, `exportPdf`, `getDoc`, `batchUpdateDoc`, `extractFolderLinks`, ...).
- `server/store.cjs` — project CRUD, UID generation, `saveData`, hidden sheets, document index, config values, locks.
- `server/project-sheet.cjs` — project data sheet, room list source, plan entries, render cover.
- `server/docs.cjs` — Docs API manipulation (markers, merge fields, tables, technical description, plan list, rooms, gross coverage, cover).
- `server/documents.cjs` — document generation, sync, PDF finalization, `_DokumentumIndex`.
- `server/projects.cjs` — folder resolution/lifecycle (`dashboardPerform`), checks, offers, restart, audio.
- `server/emails.cjs` / `server/mailer.cjs` — SMTP sending via nodemailer, ZIP package, attachments.
- `server/mail.cjs` — read sent mail via IMAP (`imapflow` + `mailparser`).
- `server/ai.cjs` — Gemini audio summary and key config.
- `server/dashboard.cjs` — RPC method table/dispatcher.
- `server/form.cjs` — form HTML rendering with `google.script.run` fetch shim + `/api/form` handler.
- `scripts/google-token.cjs` — one-off OAuth helper to mint `OWNER_REFRESH_TOKEN`.
- `scripts/check-env.cjs` — `npm run check`: verifies env vars and each live integration (Sheets, Drive, Docs, IMAP, SMTP, Gemini) with Hungarian diagnostics; exit code 1 on failure.

## Run / test
- `npm ci` then `npm start` (`node server/index.cjs`). Env vars are required at load time; see `.env.example`.
- Tests: `npm test` (`node --test tests/*.cjs`). They use plain fakes/mocks for Google, Drive, Docs, IMAP and SMTP — no real credentials, no vm/Apps Script globals. `tests/node_server.cjs` spawns the real server with dummy env.
- `npm run token` starts a local OAuth redirect listener on `127.0.0.1:53682/oauth2callback` to print `OWNER_REFRESH_TOKEN`.
- `npm run check` (`scripts/check-env.cjs`) hits the live Google/IMAP/SMTP/Gemini endpoints with the configured tokens and prints a per-integration report; safe to run in a Railway shell, reads `.env` locally if present.
- Health: `GET /health` → `{ok:true}`.

## Required env
- Required: `BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`, `SESSION_SECRET` (>=32).
- Defaulted: `PORT` (3000), `SHEET_ID`, `SHEET_NAME` (`Adatok`), `IMAP_HOST`/`IMAP_PORT` (993).
- Needed for features: `OWNER_REFRESH_TOKEN` (public form server-side Google access; `/api/form` returns 503 without it), `IMAP_USER`/`IMAP_PASSWORD` (sent mail), `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASSWORD`/`MAIL_FROM` (sending; falls back to IMAP values), `GEMINI_API_KEY`/`GEMINI_MODEL` (AI summary; dashboard-saved key in `_ProjektBeállítások` wins).
- OAuth scopes: `openid`, `email`, `spreadsheets`, `drive`, `documents`; redirect `https://<BASE_URL>/auth/callback`. `npm run token` additionally redirects to `http://127.0.0.1:53682/oauth2callback`.

## Key workflows / gotchas
- **UIDs are canonical**: 32 uppercase hex chars in column A. `saveData` with a UID only updates an existing row (unknown UID throws); creating a record requires no UID. `saveData` preserves status, client link, folder URL and `gdprAccepted`, and copies `lakcim*` into the notification address when `ertesitesi_same` is true/undefined.
- **Sheet shape stays A–AN (40 cols)**. Change `server/domain.cjs` (`FIELDS`, `buildRow`, `rowToData`) and nothing else — do not reintroduce a second mapping.
- **Hidden sheet names are fixed for compatibility**: `_ProjektMemo`, `_ProjektJegyzetek`, `_ProjektÚjraindítás`, `_ProjektEllenőrzés`, `_ProjektElvártFájlok`, `_ProjektIdővonal`, `_DokumentumIndex`, `_ProjektBeállítások`.
- **Folder lifecycle** (`dashboardPerform`): `start` requires confirmation `start:<uid>`, checks folder name conflicts before finalizing, moves `_Ajánlatok` → work folder, sets `AKTÍV`. `close` requires `close:<uid>`, finalizes `írásos` documents, moves into `_Elkészült` under the active folder, sets `KÉSZ`. `tests/project_lifecycle.cjs` asserts the ordering.
- **Document generation** uses templates by ID, writes `_DokumentumIndex`, syncs the technical description from `Tervezési adatok` (gross coverage from H2/J2) and the room list from `PLN/helyiségek.txt` (fallback `helyiséglista.txt`), cover image from the latest `Render` package. Conditional Docs blocks use hidden white 1pt `{{#IF ...}}` / `{{/IF}}` markers.
- **No Apps Script triggers**: `onEdit` behaviors do not exist; sync/generation runs from dashboard/form actions instead (`dashboardPerform` actions like `sync`, `document:<type>`).
- **RPC/security**: `/api/rpc` and `/api/form` require same-origin and the `X-Kocka-RPC: 1` / `X-Kocka-Form: 1` header; RPC also requires the owner OAuth session cookie.
- **Errors**: `server/index.cjs` maps errors to HTTP 400 unless `error.status >= 500`; only 5xx hides the message.
- **Test seam**: `projects.dashboardPerform(google, store, uid, action, confirmation, hooks)` accepts optional `{getDashboardProject, documents, projectSheet}` overrides; keep it when refactoring.
- **`appendProjectPostfix`** intentionally mirrors the old behavior (an already-postfixed `*.pdf` can pick up a second postfix).
- **archiver v8 is ESM**: `require('archiver')` returns `{Archiver, ZipArchive, TarArchive, JsonArchive}`; use `new archiver.ZipArchive(...)`.

## Pointers
- Drive IDs are extracted defensively from URLs or raw IDs; tests mock Drive (`listChildren`/`createFolder`/`moveFile`).
- New Google API calls belong in `server/google.cjs`; keep feature logic out of it.
- Live Google/Docs/Drive/IMAP/SMTP behavior cannot be verified locally — say so instead of claiming it works.
