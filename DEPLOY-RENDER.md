# Deploying the HWT Pharmacy Portal on Render

This guide takes the project from your laptop to a public URL on [Render](https://render.com). Read the first section before you start: it explains the one decision that matters (the persistent disk) and what changes when the app leaves the LAN.

---

## 0. Before you start — three things to understand

**1. The app is one Node service.** The Express backend serves the API under `/api` and also serves the built React frontend from `frontend/dist`. On Render that means **one Web Service**, not two. The browser talks to `/api` on the same domain, so nothing needs a CORS or URL change.

**2. The database is a SQLite file, so the service needs a persistent disk.** Render's filesystem is thrown away on every deploy and restart. If you deploy without a disk, every deploy starts with an empty pharmacy. A persistent disk (mounted at `/var/data`) keeps `hms.db` across deploys. **Persistent disks are only available on paid instances** (Starter, about $7/month, plus about $0.25/GB/month for the disk). The Free plan cannot run this app correctly.

**3. The app was designed for a private LAN. On Render it is on the public internet.** Before you share the URL:
- change every seeded password (`admin / admin123`, `pharmacy / pass123`, …) in Admin › Users, or better, create your own accounts and deactivate the seeded ones;
- let Render generate `JWT_SECRET` (the blueprint below does this) — never keep the development default;
- Render gives you HTTPS automatically; do not turn it off.

The header will read "LAN Master: your-service.onrender.com" — that is expected; it shows the host the browser is talking to.

---

## 1. Put the code on GitHub

Render deploys from a Git repository. The project already points at `https://github.com/ranatb2023/hwt-pharmacy.git`.

```powershell
cd "C:\Users\hp\Downloads\HWT Hospital Management System"
git status                      # see what is uncommitted
git add -A
git commit -m "Prepare for Render: seed-if-empty, start:render, render.yaml"
git push origin main
```

Check that these are **not** committed (they are in `.gitignore`): `backend/data/` (the database), `frontend/dist/` (the build), `node_modules/`, `.env`. The live database is created on Render's disk, not copied from your laptop.

---

## 2. Create the service on Render (Blueprint — recommended)

The repository contains `render.yaml`, which describes the whole service. Using it means you type nothing into the dashboard forms.

1. Sign in at https://dashboard.render.com (create an account with your GitHub login if you have none).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account if asked, then pick the repository **ranatb2023/hwt-pharmacy**.
4. Render reads `render.yaml` and shows one service, **hwt-pharmacy**, with a 1 GB disk. Click **Apply**.
5. Render builds the frontend, installs the backend and starts it. The first build takes 3–6 minutes (the `better-sqlite3` driver compiles on the server). Watch the **Logs** tab; the last lines should be:

```
seed-if-empty: empty database — seeding.
Seed complete.
HWT HMS API running on http://localhost:10000
```

6. Open the URL Render shows (something like `https://hwt-pharmacy.onrender.com`). The login page appears. Sign in with `admin / admin123` and change the password immediately.

### What the blueprint sets, in case you prefer the manual form

| Setting | Value |
|---|---|
| Type | Web Service |
| Runtime | Node |
| Region | Singapore (closest to Pakistan) |
| Instance | Starter |
| Root directory | `backend` |
| Build command | `npm ci && npm --prefix ../frontend ci && npm --prefix ../frontend run build` |
| Start command | `npm run start:render` |
| Health check path | `/api/health` |
| Disk | name `hwt-data`, mount path `/var/data`, 1 GB |
| Env `NODE_VERSION` | `22` |
| Env `HMS_DB_PATH` | `/var/data/hms.db` |
| Env `JWT_SECRET` | click **Generate** (a long random value) |
| Env `SEED_DEMO` | `0` — set to `1` **only** for the first deploy if you want the demo month loaded, then set it back |

If you go the manual route: **New +** → **Web Service** → pick the repo → fill the table above → **Advanced** → **Add Disk** → **Create Web Service**.

---

## 3. What happens on the first boot

`npm run start:render` runs `scripts/seed-if-empty.js` and then the server.

- On an **empty** disk it runs the normal seed once: roles, the six seeded users, the lab catalogue, the starter medicines with opening stock, the sample vendor. With `SEED_DEMO=1` it also loads the demo month and the starter employees.
- On every **later** start it finds users already present and does nothing. Redeploys never reset your passwords or data.

The schema migrations (new tables, columns, triggers) run at every start and are additive, exactly as they do on the laptop.

---

## 4. After the first deploy — the setup checklist

Do these in the app, signed in as the administrator:

1. **Admin › Users** — change the admin password; deactivate `reception`, `doctor`, `lab`, `cashier` if the pharmacy does not use them; change `pharmacy`'s password.
2. **Admin › Settings** — enter the pharmacy name, **drug sale licence number, address and phone**. Slips and the day-end sheet print incomplete until these are in.
3. **Cash Flow** — open the first till before the first cash sale (cash sales refuse to complete without one).
4. If you loaded the demo month, remove it when real trading starts: Render dashboard → the service → **Shell** tab → `node scripts/seed-demo.js --remove`.

---

## 5. Backups

The disk survives deploys, but it is one disk. Take backups.

**Manual, any time** — Render dashboard → the service → **Shell**:

```bash
npm run backup -- /var/data/backups --keep 14
```

That writes a consistent copy of the live database to `/var/data/backups/hms-<timestamp>.db` and keeps the newest 14. It is safe while the pharmacy is trading.

**Download a backup to your laptop** — in the same Shell, print it as base64 and copy, or simpler: use Render's disk snapshot feature (service → **Disk** → **Snapshots**) which Render takes daily on paid plans and keeps for 7 days.

**Automatic daily backup** — add a Render **Cron Job** later if you want more than the daily snapshot: same repo, root directory `backend`, schedule `0 21 * * *` (02:00 Pakistan time), command `npm run backup -- /var/data/backups --keep 30`. The cron job must attach the **same disk**, which Render allows only for services in the same region.

**Restore** — Shell: `node scripts/restore.js /var/data/backups/hms-<timestamp>.db --yes`, then **Manual Deploy → Restart** the service.

---

## 6. Updating the site later

Every `git push` to `main` redeploys automatically (`autoDeploy: true` in the blueprint). A deploy:

1. builds the frontend and backend,
2. starts the new version alongside the old one,
3. waits for `/api/health` to answer,
4. switches traffic, then stops the old one.

Your database is untouched. Migrations run at start. If a deploy fails to become healthy, Render keeps the old version running — check the **Logs** tab.

To deploy without pushing: service → **Manual Deploy** → **Deploy latest commit**.

---

## 7. Custom domain (optional)

Service → **Settings** → **Custom Domains** → **Add** → enter e.g. `pharmacy.hopewelfare.org.pk` → add the CNAME record Render shows at your DNS provider. Render issues the HTTPS certificate itself within a few minutes.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails on `better-sqlite3` | Node version mismatch | `NODE_VERSION` must be `20` or `22`; the manifest declares `engines.node >= 20` |
| Site loads but every API call is 404 HTML | Root directory wrong, or frontend not built | Root directory must be `backend`; build command must include the `../frontend` build |
| Login works, then data vanishes after a deploy | No persistent disk, or `HMS_DB_PATH` not on it | Add the disk at `/var/data` and set `HMS_DB_PATH=/var/data/hms.db` |
| "Cannot reach the pharmacy server" overlay on a working site | Service restarting (deploy) or asleep | Wait 30 s; on the Starter plan services do not sleep |
| `EACCES` writing the database | Mount path differs from `HMS_DB_PATH` | Both must be under `/var/data` |
| Seed ran again and reset passwords | Someone ran `npm run seed` by hand | Use `start:render` only; the seed script is for an empty database |
| Slow first request each morning | Free plan sleep | The app needs Starter anyway for the disk |

---

## 9. Files this guide relies on

| File | Purpose |
|---|---|
| `render.yaml` | The blueprint: service, build/start commands, disk, environment |
| `backend/scripts/seed-if-empty.js` | Seeds only an empty database, so redeploys never reset data |
| `backend/package.json` → `start:render` | `node scripts/seed-if-empty.js && node src/server.js` |
| `backend/src/config.js` | Reads `PORT`, `JWT_SECRET`, `HMS_DB_PATH` from the environment |
| `backend/scripts/backup.js`, `restore.js` | The backup and restore used in section 5 |

Render sets `PORT` itself; the server reads it. Nothing in the code needs editing for Render.
