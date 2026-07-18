# todoist-service

Lightweight Express proxy for the Todoist REST API. Single file: `server.js`.

- **Internal only** — listens on `localhost:3010` on the VPS; no nginx vhost, no
  Cloudflare. Consumed server-to-server by `finance-app` (action items sync) and
  `home-app` (maintenance-task two-way sync → "Home Maintenance" project, added 2026-07-16).
  (travel-app was previously listed as a consumer but has no Todoist integration —
  corrected 2026-07-16.)
- No build step, no database. `npm install --omit=dev` is the whole setup.
- Config via `.env`: `TODOIST_API_TOKEN`, `TODOIST_FINANCE_PROJECT_ID`,
  `TODOIST_TRAVEL_PROJECT_ID`, `PORT=3010`. See `.env.example`.

## Run locally

```bash
npm install
node server.js   # http://localhost:3010
```

## Deploy

`Deploy-Todoist` from local PowerShell (`$PROFILE`): git pull → `npm install --omit=dev`
→ `pm2 restart todoist-service`. First-time setup and verification steps are in
`DEPLOY.md` (gitignored, local only).

Note: the GitHub repo (`ChrisDyer/todoist-service`) is currently **public** and the VPS
pulls over HTTPS. Nothing sensitive is tracked (`.env` is gitignored), but if the repo
is made private, switch the VPS to a deploy key (see the pattern in the root `README.md`
new-app checklist).

## Plan folders

If a multi-phase plan is ever needed for this app, put it under `docs/plans/<slug>/`
with a `PROGRESS.md` per the convention in the root `CLAUDE.md`, register it in the
root `projects.config.json` (path + `totalPhases`), and run
`node tools/project-status.mjs` from the repo root.
## Task Date/Deadline contract

`POST /tasks`, `POST /tasks/batch`, and `PATCH /tasks/:id` accept optional `deadlineDate`
alongside existing `dueDate`. The proxy validates strict `YYYY-MM-DD` dates, rejects
`deadlineDate` earlier than `dueDate` when both are present, maps `dueDate` to Todoist
`due_date`, and maps `deadlineDate` to Todoist `deadline_date`. Omitting `deadlineDate`
remains backward compatible for existing consumers.

The service returns its existing safe envelopes: `{ ok: true, taskId }`/`{ ok: true }` on
success and `{ ok: false, error }` on validation or upstream failure. Tests mock upstream
Todoist; do not call live Todoist while validating this contract.