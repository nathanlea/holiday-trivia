# Holiday Trivia

Live trivia for about 25 teams, with mobile answers, host grading, final wagers,
and a projector scoreboard.

## What changed for 2026

- Teams visit the site, enter a name, and join the one game open for joining. No
  game code or PIN is needed. The host can close joining without disconnecting teams.
- One server-configured host secret creates and manages all games. Host credentials
  stay in the current browser tab's session storage, never in URLs or the frontend build.
  The scoreboard is public and read-only.
- Answer drafts survive a refresh in the same tab. Connections retry after interruptions;
  submission controls indicate disconnection and expired timers. Last year's browser
  sessions are ignored so returning players start fresh.
- Deadlines are enforced on the server. Answers are accepted once per team per round;
  repeat requests cannot double-count points. Numeric zero answers score correctly.
  SQLite writes are serialized for simultaneous submissions.
- Future questions and unrevealed answers are omitted from public state. Closed-round
  answers remain visible, as before. Grading on the dedicated submissions page now
  requires **Save Grades** rather than silently saving as soon as every choice is set.
- The frontend is served by a Cloudflare Worker. API and WebSocket requests are proxied
  through the same domain to a persistent backend; no cross-domain frontend settings
  are needed.

## Hosting recommendation

Use **Cloudflare Workers Free + one DigitalOcean Basic droplet running Docker Compose**.
This keeps the existing SQLite app simple: no external database, Redis, or managed
WebSocket service. Caddy handles backend HTTPS automatically.

DigitalOcean currently lists a 1 GiB / 1 vCPU droplet at **$6/month maximum
($0.00893/hour)**, with per-second billing. Use 2 GiB ($12/month maximum) if you want
more room for on-server Docker builds. The Worker Free plan includes 100,000 requests
per day; this event should be comfortably below that under normal usage, not a
guarantee under public abuse. Check pricing before provisioning:
[DigitalOcean](https://www.digitalocean.com/pricing/droplets),
[Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/).

**Both players and the host need working internet.** Rehearse on venue Wi-Fi and
mobile data. Keep a paper-answer fallback for a venue-wide outage.

## Local development

Use Node.js **24 LTS** and npm. From the repository root:

```sh
cp .env.example .env
openssl rand -hex 24
# Put the generated value in .env as TRIVIA_ADMIN_SECRET.
npm ci
npm run dev
```

Open <http://localhost:8000>, or <http://localhost:8000/gamemaster> for host tools.
The backend runs on port 3000. The dev runner starts both processes and stops them
on Ctrl+C. The old PM2/nginx files are not used by this setup.

If npm requires explicit install-script approval, approve the SQLite, esbuild, and
workerd versions shown by `npm install-scripts ls`, then run
`npm rebuild sqlite3 esbuild workerd`. These are required native tools; review the
packages before approving future versions.

The sample environment points to a **fresh database** in `data/trivia-2026.db`
(the relative database path is resolved from the server workspace).
Last year's database is not deleted or migrated. **Do not point this version at the
old database:** the per-game PIN schema was replaced. Production uses a new Docker
volume and never copies repository databases into the image.

```sh
npm test
npm run build
npm run typecheck
npm --workspace client run deploy:check
```

For a local rehearsal of the actual Worker and Docker backend, build the client
and run Wrangler with a local `BACKEND_ORIGIN`. Use
`--infer-origin-from-routes=false` to preserve the browser's localhost origin;
Wrangler otherwise rewrites it based on the configured production domain. Allow
that exact local origin on the rehearsal backend, not on the production server.

Tests cover scoring, wagers, host access, joining, deadlines, public state,
25 concurrent submissions, concurrent score adjustments, existing question files,
API error messages, tied ranks, React WebSocket reconnect/resume behavior, and Worker
proxy behavior.

## Deployment

No live resources are created by this repository. Follow these steps when ready.

### 1. DNS and a small droplet

1. Make sure `holidaytriviaconsole.org` uses Cloudflare nameservers. Save existing DNS
   settings before replacing last year's frontend records.
2. Create an Ubuntu LTS DigitalOcean droplet with an SSH key. Allow inbound SSH
   from your IP, and HTTP/HTTPS (80/443) from the internet. **Do not expose port 3000.**
3. Install Docker Engine and its Compose plugin using
   [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
4. Add a **DNS-only** Cloudflare `A` record for `api.holidaytriviaconsole.org` pointing
   to the droplet IPv4 address. Add an AAAA record only if IPv6 is actually configured.
   The frontend apex domain will be managed by the Worker's custom-domain setup.

### 2. Backend

Clone or copy this repository to the droplet, including the committed lockfile.
In its root:

```sh
cp .env.example .env
openssl rand -hex 24
# Set TRIVIA_ADMIN_SECRET in .env to the generated value.
chmod 600 .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 server caddy
curl --fail https://api.holidaytriviaconsole.org/api/health
```

Caddy obtains a certificate automatically once DNS resolves and ports 80/443 are
reachable. The backend starts only with a host secret of at least 16 characters.
Its SQLite file is stored in the `trivia-data` named volume. The runtime is non-root;
the build compiles SQLite for the container's own Linux libraries. Keep exactly
**one backend instance**, not multiple replicas sharing the file.

Compose allows only `https://holidaytriviaconsole.org` as a browser origin.
If you add another frontend hostname, update `TRIVIA_ALLOWED_ORIGINS` in
`compose.yaml` (comma-separated exact origins), the Worker routes, and DNS together.
Never put the host secret in a `VITE_*` variable or in Cloudflare frontend variables.

### 3. Cloudflare Worker frontend

On your development machine, with Node.js 24:

```sh
npm ci
npm --workspace client exec -- wrangler login
npm --workspace client run deploy:check
npm run deploy
```

`client/wrangler.jsonc` configures:

- The custom domain `holidaytriviaconsole.org`.
- Built assets from `client/dist`, including SPA routing for host subpages.
- `BACKEND_ORIGIN=https://api.holidaytriviaconsole.org`.
- Worker-first routing for `/api`, `/api/*`, and `/ws`.

When Cloudflare reports an existing conflicting apex record, follow its
custom-domain setup instructions to remove only that old record. Do not remove
email or other unrelated DNS records. Keep any unrelated sites/services intact.

Leave `VITE_API_BASE` and `VITE_WS_BASE` unset for this deployment. The browser uses
the frontend origin for both transports; the Worker forwards requests and WebSocket
upgrades to Caddy. Unknown API endpoints return JSON errors, not the SPA.
`client/public/_headers` supplies frontend security headers and asset caching rules.

Verify:

```sh
curl --fail https://holidaytriviaconsole.org/api/health
curl -I https://holidaytriviaconsole.org/gamemaster/submissions
```

Then verify actual WebSocket connectivity in the browser: the host, team, and
scoreboard must all show **Connected/Live**, not just a successful health request.

### 4. Run the event

1. Visit `/gamemaster`, enter the host secret, give the game a title, and import a
   JSON question set. `questions_sample.json` and the existing `questiosn.json`
   format are supported without changes. Creating a game closes joining for older
   games and opens it for this game.
2. Save the game code displayed in the host header. It is only needed to resume a
   game if joining has been closed. The secret stays in that browser tab until
   sign-out or closing the tab.
3. Share `https://holidaytriviaconsole.org` with teams. Use **one phone per team**;
   refreshing restores that device's team session. Clearing browser storage or
   switching devices does not recover the team automatically.
4. Open the projector link from the console. It contains only the game code and
   does not expose host credentials.
5. Close joining after teams arrive. Open rounds one at a time; close them before
   moving on. Timers reject late answers even if the host has not pressed Close.
   Grades on the submissions page apply when **Save Grades** is pressed.
6. For the final, open the wager stage first, then close it and open the final
   question. A wager can be changed only while its wager stage is open.
7. Re-importing questions resets that game's scores, answers, and wagers. The
   console asks for confirmation if rounds already exist.

## Updates, backups, and teardown

Before deploying an update, stop submissions and back up the database:

```sh
docker compose stop server
docker compose cp server:/app/data ./trivia-backup-2026
docker compose start server
```

Copy the **whole directory** (including any WAL/SHM files), keep it private, and
download the backup before deleting the droplet. To restore, stop the server, copy
the backed-up directory contents back to `/app/data`, ensure files belong to
`node:node`, and restart. Test a restore before relying on it for the event.

For code updates:

```sh
git pull
docker compose up -d --build
docker compose logs --tail=50 server
# Deploy the frontend from the development machine with npm run deploy.
```

After the event, back up first, then run `docker compose down` (without `-v`).
Delete the droplet in DigitalOcean to stop compute billing; powering it off is not
enough. Remove unused DNS records and delete the Worker in Cloudflare (or run
`npm --workspace client exec -- wrangler delete` after checking the project name).
Deleting a droplet destroys its local volumes. Retained provider snapshots/backups
and other resources may still incur charges.

## Dependency maintenance notes

Dependencies and the lockfile are updated. TypeScript moved from the declared 5.2
range (installed 5.9) through validated 6.0 and 7.0 builds. Vite, Vitest, SQLite,
WebSocket/HTTP middleware, Router, and deployment tooling are updated; React stays
on the latest 18.x to avoid an unnecessary rendering migration.

`npm audit` currently reports **two moderate findings** in the Sequelize/uuid
dependency chain. There is no compatible fix offered by npm for Sequelize 6;
`npm audit fix --force` proposes a breaking downgrade to Sequelize 3. Do not run
that command. Recheck advisories and upstream support before the next event.
