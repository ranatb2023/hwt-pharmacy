# HWT Core — the single source of truth for what we are building

**The product is a point-of-sale system for the pharmacy plus a full dialysis management
system.** Every other department sends a prescription in and gets an invoice back. Four
modules are on hold.

Read **[SCOPE.md](SCOPE.md) first.** It decides what is in and what is out, and it wins over
every other document here.

---

## Read in this order

| # | File | What it answers |
|---|------|-----------------|
| 1 | **[SCOPE.md](SCOPE.md)** | What are we building? What is on hold? How do departments connect? |
| 2 | **[STATUS.md](STATUS.md)** | Where are we right now? Which phase is open? What is done? |
| 3 | **[DATABASE.md](DATABASE.md)** | Every table and column — what exists today, what each phase adds |
| 4 | **[ERD.md](ERD.md)** | The same thing as pictures, one diagram per domain |
| 5 | **[TECHNOLOGY.md](TECHNOLOGY.md)** | Why this stack, the hardware, and how it survives no-internet + load-shedding |
| 6 | **[RUNBOOK.md](RUNBOOK.md)** | Operating the server: service, backups, restore, power, the clock, the counter card |
| 7 | **[TRACEABILITY.md](TRACEABILITY.md)** | Each line the client asked for → the phase that delivers it |
| 8 | **[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)** | The answers we still need, and what each one changes |
| 9 | **[phases/](phases/)** | One file per phase: schema, endpoints, screens, tasks, acceptance tests |

Client-facing material — their briefs, their paper forms, what we hand back to them — lives
in **[`../hwt-client/`](../hwt-client/)**, not here. This folder is the build.

---

## The phases

| # | Phase | Est. | File |
|---|-------|------|------|
| 00 | Site hardening & offline operation | 1 wk | [PHASE-00](phases/PHASE-00-site-hardening.md) |
| 01 | Counter throughput & catalogue | 2 wks | [PHASE-01](phases/PHASE-01-counter-and-catalogue.md) |
| 02 | Departments — prescription in, invoice out | 2 wks | [PHASE-02](phases/PHASE-02-departments.md) |
| 03 | Customer management & entitlements | 2.5 wks | [PHASE-03](phases/PHASE-03-customers-and-entitlements.md) |
| 04 | Party accounts & customer credit | 2.5 wks | [PHASE-04](phases/PHASE-04-ledger-and-credit.md) |
| 05 | Dialysis Management — the full module | 3 wks | [PHASE-05](phases/PHASE-05-dialysis-management.md) |
| 06 | Reporting, day-end & corrections | 3 wks | [PHASE-06](phases/PHASE-06-reports-and-corrections.md) |
| 07 | Electronic cash register | 1 wk | [PHASE-07](phases/PHASE-07-cash-register.md) |
| 08 | Portals & sync (USB-carried) | 2 wks | [PHASE-08](phases/PHASE-08-portals-and-sync.md) |

**Total ≈ 19 developer-weeks.**

---

## The four rules the whole plan rests on

Everything else is detail. These four are structural — get them wrong and later phases have
to be rewritten rather than extended.

1. **A department is a customer, and it gets an invoice.**
   Not a silent internal transfer. The lab, emergency and the wards send a prescription in and
   receive an invoice, and those invoices are the hospital's expense. Phase 02.

2. **Every rupee owed sits in a party ledger, and credit never touches the till.**
   A credit sale must not post cash. Revenue is recognised at sale; cash at settlement. Without
   this the drawer can never be reconciled and Phase 07 is pointless. Phase 04.

3. **Dialysis registers its own patients and keeps its own history.**
   Patient Management is on hold, so dialysis cannot lean on it. Its demand ledger is never
   netted against a patient's personal credit account. Phase 05.

4. **The database must survive having its power cut mid-sale.**
   No internet, LAN only, load-shedding. Phase 00 comes first because every later phase assumes
   the data is still there.

---

## Invariants — do not break these

Already true in the shipped code. New work must preserve them.

| Invariant | Where it lives | Why |
|---|---|---|
| **Stock is always counted in base units** (one tablet, one capsule, one bottle) | `backend/src/packaging.js` | Only the counter and the forms speak strips and boxes; they convert exactly once, at the edge. Keeps a half-strip representable |
| **Prices are per base unit.** Strip and box prices are derived by multiplication | `products.sale_price`, `products.mrp`, `stock_batches.cost_price/mrp` | A stored box price and a stored unit price drift the first time one is edited. Never add a per-strip or per-box price column |
| **`pack_size` is derived**, `= units_per_strip * strips_per_box`, recomputed on every start-up | `backend/src/db.js` `migrate()` | Never write it directly |
| **Timestamps are stored UTC**; the business day is UTC + `tz_offset_hours` | `backend/src/businessDay.js` | Pakistan is UTC+5. Raw `date(created_at)` pushes the first five hours of a shift into the previous day |
| **Waived money is recorded, not lost** — it goes to `bills.subsidy` | `backend/src/billingRules.js` | The trust's donors need to see what was given away |
| **Every new dropdown uses `<Select>`**, never a native `<select>` | `frontend/src/components/Select.jsx` | Project-wide design decision |
| **Sharp edges** — a global rule sets `border-radius: 0` | `frontend/src/styles.css` | Design system |
| **One codebase, no fork** — on-hold modules stay behind the mode gate | `backend/src/settings.js` | Decided 2026-08-24. Turning a module back on must be a setting, not a merge |
| **Append-only tables** are never updated or deleted from | `audit_log`, `controlled_register`, `stock_movements`, `ledger_entries` | Corrections are reversing entries, not edits |

---

## How to keep this folder honest

- When a task is finished, tick its box **in the phase file** and update the counts in
  [STATUS.md](STATUS.md). Both, in the same commit as the code.
- **A phase is Done only when its acceptance tests are ticked**, not its tasks. Ticking tasks
  is progress; ticking acceptance is delivery.
- When a decision is made — especially one answering [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) —
  write it into the decision log in STATUS.md with the date and who decided it. A decision that
  only exists in a WhatsApp message does not exist.
- When the schema changes, update [DATABASE.md](DATABASE.md) and [ERD.md](ERD.md) in the same
  commit as the migration. A schema document that lags the code is worse than none.
- **Before adding any work, apply the scope test:** does the pharmacy counter or the dialysis
  unit need it to get through a day? If not, it goes in OPEN-QUESTIONS, not into a phase.
