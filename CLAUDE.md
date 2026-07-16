# todoist-service

Lightweight Express proxy for the Todoist REST API. Single file: `server.js`.

- **Internal only** — listens on `localhost:3010` on the VPS; no nginx vhost, no
  Cloudflare. Consumed server-to-server by `finance-app` (action items sync).
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
