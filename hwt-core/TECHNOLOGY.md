# TECHNOLOGY — the stack, and why

**The site has no internet, a LAN only, and load-shedding.** Every decision below follows
from those three facts.

---

## The verdict

> **Keep Node + Express + better-sqlite3, with a React SPA served from the same port.
> Spend the technology budget on power and boot resilience instead.**

The property that matters most here is that **there is one process and one file.** The
database is `backend/data/hms.db`. Nothing is installed on the counter machines — they open
a browser at `http://192.168.1.10:4000` and that is the entire client deployment. When the
power comes back, one service has to start, not four.

A database server would give you nothing at one site and cost you a second thing that must
survive every outage, be administered by someone on the premises, and be restored by that
same person at 9 p.m. on a Saturday. SQLite in WAL mode with `synchronous = FULL` is more
durable against a power cut than a badly-tuned Postgres, and its backup procedure is a file
copy. Revisit this **only** if the trust opens a second site that must share live data.

What the stack is actually missing is not a technology — it is the operational layer around
it. There is no backup job, no service that restarts on boot, and `synchronous` is left at
the compiled default rather than pinned deliberately. That is
[Phase 00](phases/PHASE-00-site-hardening.md), and it is one week.

---

## Keep as-is

| Component | Why it is right here |
|---|---|
| **better-sqlite3** | Synchronous, in-process, the fastest option for a single node. No server to crash, no port to bind, no user to authenticate. |
| **Express on one port** | Serves the built SPA and the API together. One URL for the whole LAN. |
| **React + Vite** | Builds to static files. No runtime dependency on anything outside the box. |
| **The browser as the client** | Any counter PC, any tablet on the LAN. Zero install, zero update problem, zero driver problem. |
| **JWT + local roles** | No identity provider to reach over an internet that does not exist. |
| **Permission-key RBAC** | `backend/src/permissions.js`. Roles are data, so a new counter role is a settings change. |
| **Settings table for financial rules** | Prices, discounts and caps are administrator-editable, not hard-coded — the client changes them without a release. |

---

## Add or harden — this is Phase 00

| Item | What to do |
|---|---|
| **Auto-start service** | Install the backend as a Windows service with **NSSM**, set to auto-start and restart on failure. After load-shedding, the pharmacy is open when the machine boots. Nobody should have to find a shortcut. |
| **`PRAGMA synchronous = FULL`** | Pin it in `db.js` with a comment saying why, so nobody later "optimises" it to `NORMAL`. In WAL mode `NORMAL` does not flush the log on commit, so a power cut can lose the last few **sales with the stock already deducted**. |
| **Single-transaction writes** | Confirm every write route is wrapped in one `db.transaction()`. A cut mid-sale must commit the bill, the stock movements, the register entry and the cash posting together, or none of them. |
| **Scheduled hot backup** | `VACUUM INTO` hourly to a second physical disk, nightly to a dated file, weekly to a rotated USB kept off-site. **Never** plain-copy `hms.db` while the server runs — the WAL file makes that unreliable. |
| **A proven restore** | Restore last night's file onto a spare machine once, time it, and write the steps on a card taped inside the counter. A backup nobody has restored is a rumour. |
| **UPS** | One 1000 VA unit carrying the server, the switch and the receipt printer. Fifteen minutes is enough to close cleanly. |
| **Static server IP** | Reserved in the router, bookmarked on every counter machine and set as the browser home page. Do not rely on Windows machine-name discovery. |
| **LAN thermal printer** | A raw socket to `IP:9100` beats driving USB through the Windows spooler, keeps working when a counter PC is swapped, and is how the Phase 07 drawer kick will be sent. |
| **Clock guard** | See the warning below. |

### The failure nobody predicts: the clock

With no internet there is no NTP. When the CMOS battery on a machine that is power-cycled
several times a day eventually dies, the server boots with its clock reset years into the
past — and every day-close, business-day query and expiry check silently files itself in the
wrong year.

**Guard:** on start-up, if system time is earlier than the newest `created_at` in the
database, refuse to serve and show the administrator a message saying the clock must be
corrected. One evening of misfiled sales costs more than the check.

---

## Do not add

| Tempting | Why not, here |
|---|---|
| **Postgres / MySQL** | A second service to survive every outage and administer on site, for no benefit at a single location. |
| **Electron** | Per-machine installs and per-machine updates, to replace a browser that already works. |
| **An offline-writing PWA** | Two counters writing bills while disconnected means duplicate bill numbers and a merge problem. One server on a UPS is simpler *and* safer. |
| **Docker on Windows** | One more layer between the power returning and the till opening. |
| **A cloud or sync tier** | There is no internet. If data ever has to leave, do it as a signed export written to a USB stick — a deliberate, auditable handoff. |
| **A per-strip or per-box price column** | Breaks the pricing invariant. See [DATABASE.md](DATABASE.md) §1. |
| **Native XLSX** | CSV-for-Excel already works offline. Add real XLSX only if the client asks. |

---

## About the online tier

`ARCHITECTURE_OVERVIEW.md` describes donor and patient portals and a sync engine on an
online tier. **This site cannot reach it.**

Leave those switched off rather than half-connected. The `sync_records` queue simply
accumulates rows locally and harms nothing. If the trust later wants donor reporting, do it
as an export from the Reports screen carried on an encrypted USB stick — not by putting a
hospital database on a link that does not exist.

This is not a gap in the plan. It is a deliberate exclusion, recorded here so nobody
"fixes" it later.

---

## Hardware to specify with the client

| Item | Spec | Why |
|---|---|---|
| Server | Mini PC or desktop, **SSD**, 8 GB RAM, Windows | Every commit's durability depends on the disk honouring a flush. An SSD also cuts the boot time after each outage. |
| UPS | 1000 VA, carrying **server + switch + receipt printer** | Fifteen minutes to close a session cleanly. Do not leave the printer off it — a half-printed receipt at the moment of a cut is a support call. |
| Network | Gigabit switch. Counter machines **wired**. Wi-Fi only for roaming tablets | Wired removes an entire class of intermittent-failure reports. |
| Receipt printer | Thermal, **RJ11 drawer port**, network interface | The drawer kick in Phase 07 goes backend → printer over a socket. |
| Barcode scanner | Any USB keyboard-wedge model | The counter already auto-adds a line on an exact barcode match followed by Enter, which is exactly what these send. No driver, no integration. |
| Cash drawer | Standard RJ11/RJ12, 12 V or 24 V to match the printer | Pulse pin (2 or 5) and duration vary by brand — they are settings in Phase 07. |
| Backup target | Second internal disk **plus** two USB sticks in rotation | The second disk covers a mistake; the USB covers a fire or a theft. |

---

## Deployment topology

```
                        ┌─────────────────────────┐
                        │  UPS (1000 VA)          │
                        └──┬───────┬───────────┬──┘
                           │       │           │
   ┌───────────────────────┴──┐  ┌─┴────────┐  │
   │ SERVER  192.168.1.10     │  │ Gigabit  │  │
   │ Node + Express :4000     │◄─┤ switch   │  │
   │ better-sqlite3           │  └─┬──────┬─┘  │
   │ backend/data/hms.db      │    │      │    │
   │ NSSM service, auto-start │    │      │    │
   └──┬───────────────────────┘    │      │    │
      │ VACUUM INTO                │      │    │
      ▼                            │      │    │
   2nd disk + weekly USB           │      │    │
                                   │      │    │
        ┌──────────────────────────┘      │    │
        │                                 │    │
   ┌────┴─────────┐              ┌────────┴┐ ┌─┴──────────────┐
   │ Counter PC   │              │ Tablet  │ │ Thermal printer│
   │ browser only │              │ (Wi-Fi) │ │ :9100 + drawer │
   │ + scanner    │              └─────────┘ └────────────────┘
   └──────────────┘
```

No line on this diagram leaves the building.
