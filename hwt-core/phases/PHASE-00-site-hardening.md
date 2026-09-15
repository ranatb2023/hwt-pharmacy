# Phase 00 — Site hardening & power resilience

| | |
|---|---|
| **Status** | 🟨 In progress — code done, machine setup outstanding |
| **Estimate** | 1 week |
| **Depends on** | nothing — **start here** |
| **Blocks** | everything |
| **Blocking questions** | none |

---

## Goal

A pharmacy that loses a day's sales to a power cut has no reports worth building. This phase
is cheap, almost entirely operational, and every phase after it assumes the data survived.

The stack is right (see [TECHNOLOGY.md](../TECHNOLOGY.md)). What is missing is the
operational layer around it: there is no backup job, no service that restarts on boot, and
`synchronous` is left at the compiled default rather than pinned deliberately.

## Requirements covered

- *no internet access, only the LAN setup is configured*
- *there is load-shedding too*

---

## Schema changes

None. This phase touches configuration, process and one start-up guard.

---

## Work

### 1. Durability

`backend/src/db.js` currently sets:

```js
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

Add, with the comment:

```js
// Load-shedding site: pin durability rather than inherit it.
// In WAL mode the faster `NORMAL` setting does not flush the log on commit, so a
// power cut can lose the last few transactions — which here means the last few
// SALES, with the stock already deducted. The write cost is irrelevant at counter
// volumes. Do not "optimise" this to NORMAL.
db.pragma('synchronous = FULL');
```

Then audit every write route for a single `db.transaction()` wrapper. A cut mid-sale must
commit the bill, the bill items, the stock movements, the controlled-register entry and the
cash posting **together, or not at all**. A half-written sale is worse than a lost one.

Routes to check: `pharmacy.js` (sale), `billing.js`, `inventory.js` (receive), `vendors.js`
(GRN, payment, reclaim), `returns.js`, `dialysis.js`, `cashflow.js`.

**Audit result (2026-09-07).** Thirteen routes already wrapped their writes correctly. Four
did not, and three of those were real:

| Route | What was wrong | Fixed |
|---|---|---|
| `cashflow.js` `/:id/close` | Totalled the till, then closed it in a separate statement. A sale auto-posting via `postCashIfOpen` in that window stays in `cash_transactions` but is excluded from `expected_cash` — **a phantom variance nobody can explain**, on the number the day-end report has to tie to | ✅ |
| `cashflow.js` `/open` | Check-then-insert: a double-click or two tabs could leave one user with two open tills, neither reconciling | ✅ |
| `settings.js` `PUT /` | **Validated and wrote in the same loop.** `{discount_pct: 0.25, staff_pct: -1}` returned `400 Invalid value for staff_pct` while `discount_pct` was already persisted — the administrator is told the update failed and walks away with half of it applied, to pricing rules. Not a power-cut bug; it happened every time | ✅ |
| `tokens.js` `POST /` | Token INSERT plus the visit's department UPDATE, unwrapped. A cut between them issues a token for a department the visit does not claim | ✅ |

`auth.js`, `lab.js`, `users.js` and `portal.js` write single statements per request, which
SQLite already makes atomic. Their check-then-insert patterns are backed by `UNIQUE`
constraints. No change needed.

### 2. Start-up clock guard

With no internet there is no NTP. When the CMOS battery on a machine power-cycled several
times a day dies, the server boots with its clock years in the past, and every day-close,
business-day query and expiry check silently files itself in the wrong year.

```js
// server.js, before listen()
const newest = db.prepare(
  'SELECT MAX(created_at) AS t FROM bills'
).get().t;
if (newest && new Date().toISOString().slice(0, 19).replace('T', ' ') < newest) {
  // refuse to serve; render a page telling the administrator to fix the system clock
}
```

Refusing to start is deliberate. A server that runs with a wrong clock corrupts a week of
reporting before anybody notices.

### 3. Backup and restore

```jsonc
// backend/package.json
"scripts": {
  "backup":  "node scripts/backup.js",     // VACUUM INTO a dated file
  "restore": "node scripts/restore.js"     // stop service, swap file, start service
}
```

`VACUUM INTO` is the only safe hot backup. **Never plain-copy `hms.db` while the server is
running** — the WAL file makes that copy unreliable.

Schedule: hourly to a second physical disk, nightly to a dated file, weekly to a rotated USB
kept off-site. Two USB sticks in rotation, so one is always out of the building.

### 4. Service and network

- Install the backend as a Windows service with **NSSM**; auto-start, restart on failure.
- Static IP on the server, reserved in the router. Bookmark it on every counter machine and
  set it as the browser home page.
- `Connectivity.jsx` already pings `/api/health` every 20 seconds. On this deployment its
  message must read **"Counter connected" / "Cannot reach the server"** — never "offline",
  which invites a pharmacist to think something is wrong with an internet connection the
  site was never supposed to have.

### 5. Power

One 1000 VA UPS carrying the **server, the switch and the receipt printer**. Leaving the
printer off it produces a half-printed receipt at the moment of a cut, which is a support
call every time.

---

## Tasks

- [x] Pin `PRAGMA synchronous = FULL` in `db.js` with the explanatory comment
- [x] Audit all write routes for a single `db.transaction()` wrapper; fix any that are not
- [x] Add the start-up clock guard and its administrator-facing message
- [x] Write `scripts/backup.js` using `VACUUM INTO`
- [x] Write `scripts/restore.js` (stop service → swap → start service)
- [x] Add `npm run backup` / `npm run restore` to `backend/package.json`
- [ ] Schedule hourly + nightly backups (Windows Task Scheduler)
- [ ] Set up the weekly USB rotation with two sticks, one always off-site
- [ ] Install the backend as an NSSM Windows service, auto-start + restart on failure
- [ ] Assign the server a static IP, reserve it in the router, bookmark it on every counter
- [x] Reword `Connectivity.jsx` for a LAN-only site ("Counter connected")
- [ ] Install and test the UPS across server + switch + printer

---

## Acceptance tests

- [ ] **Pull the plug mid-sale twenty times.** The database opens every time; no half-written
      bills; the last committed bill is present with its stock movements
- [ ] **Cold boot test.** From power-on, the server is serving and a counter can complete a
      sale within one minute, with nobody touching the server
- [ ] **Restore drill.** Last night's backup is restored onto a spare machine, timed, and the
      steps written on a card taped inside the counter
- [ ] **Clock test.** Set the server clock back one year; the server refuses to start and
      says why
- [ ] **UPS test.** Cut mains power; the server, switch and printer stay up long enough to
      close the cash session cleanly

---

## Machine setup — see [RUNBOOK.md](../RUNBOOK.md)

The five unticked tasks above all happen on the server, not in the repo. Step-by-step
commands, the backup schedule, the plug-pull test and the counter quick-card are in
[RUNBOOK.md](../RUNBOOK.md).

---

## Notes & decisions

- A backup nobody has restored is a rumour. The restore drill is an acceptance test, not a
  nice-to-have.
- The donor/patient portals and the sync engine stay switched off. `sync_records` accumulates
  rows locally and harms nothing. Recorded in [TECHNOLOGY.md](../TECHNOLOGY.md) as a
  deliberate exclusion so nobody "fixes" it later.
- Do **not** run `taskkill /IM node.exe` on this machine — the client runs the live app on
  it. Stop the service by name, or kill test servers by port.
