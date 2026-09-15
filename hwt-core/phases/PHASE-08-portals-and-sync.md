# Phase 08 — Portals & sync, carried on a USB stick

| | |
|---|---|
| **Status** | ⬜ Not started |
| **Estimate** | 2 weeks |
| **Depends on** | [03](PHASE-03-customers-and-entitlements.md), [05](PHASE-05-dialysis-management.md), [06](PHASE-06-reports-and-corrections.md) |
| **Blocks** | nothing |
| **Blocking questions** | **Q11 — this phase cannot start without it** |

---

## Goal

Give donors an impact dashboard and patients access to their own records, on a site that has
no internet — by moving a signed, encrypted package on a USB stick instead of over a wire.

## Requirements covered

- **Donor Portal (Online)** — registration, impact dashboard, fund utilisation, receipts,
  aggregated and de-identified
- **Patient Portal (Online)** — own history and reports, strict isolation, consent recorded
- **Offline Operation & Sync** — the sync half. *(The offline half is [Phase 00](PHASE-00-site-hardening.md))*

---

## The contradiction, and how it resolves

The client has these three modules in scope. The site has no internet. Both are true, so the
design has to absorb the contradiction rather than pretend one of the facts away.

The module's own specification already contains the answer: *"provide manual export/import
fallback when needed"*. Here, the fallback **is** the mechanism.

```
   ┌──────────────────────────────────────────┐
   │  PHARMACY SITE  —  no internet, ever     │
   │                                          │
   │   hms.db  ──►  export package            │
   │                (encrypted, signed,       │
   │                 de-identified,           │
   │                 incremental)             │
   └───────────────────┬──────────────────────┘
                       │
                  USB stick,
                carried by a person
                       │
                       ▼
   ┌──────────────────────────────────────────┐
   │  OFFICE MACHINE  —  has internet         │
   │                                          │
   │   import  ──►  online tier               │
   │                ├─ Donor Portal           │
   │                └─ Patient Portal         │
   └──────────────────────────────────────────┘
```

**Rules this design follows:**

1. **One direction only** — site → online. The portals are read-only views of hospital data.
   This matches the module's own rule that conflicts resolve in favour of hospital data: with
   one-way flow there are no conflicts to resolve.
2. **The site never waits for anything.** No connection is attempted, no timeout blocks a sale.
   The export is a button on the Reports screen.
3. **Idempotent and resumable.** Importing the same package twice changes nothing. A package
   that fails halfway is re-importable from the start.
4. **Encrypted at rest on the stick.** A USB stick carrying patient data will eventually be
   lost. Encrypt the package, not just the transfer.
5. **De-identified for donors.** Donor-facing figures are aggregates — amounts given, patients
   helped, by fund and by month. No names, no codes, nothing re-identifiable.
6. **Consent gates the patient portal.** `patients.consent_online` already exists and is already
   enforced; keep that gate.

---

## Q11 — answer this before starting

**Is there any internet-connected machine, and who carries the stick?**

The whole phase depends on it. Three shapes, and each is a different build:

| If the answer is | Then |
|---|---|
| The trust office has internet and someone visits weekly | Build exactly as drawn above. Weekly cadence, portals show a "data as of" date |
| Nobody has internet at all | Build the export only. The portals are pointless until there is somewhere to host them — say so and stop |
| The pharmacy could get a mobile dongle | Reconsider: a scheduled push over a metered link may beat a stick. But the site still must never *depend* on it |

Until this is answered, **do not start**. Everything in this phase is shaped by it.

---

## Schema changes

`sync_records` and `sync_state` already exist and are already populated by
`backend/src/sync.js`. This phase gives them a destination rather than replacing them.

```sql
CREATE TABLE sync_packages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  package_no   TEXT NOT NULL UNIQUE,     -- PKG-00001
  from_seq     INTEGER NOT NULL,          -- sync_records.id range covered
  to_seq       INTEGER NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  checksum     TEXT NOT NULL,             -- integrity + idempotency key
  exported_at  TEXT NOT NULL,
  exported_by  INTEGER REFERENCES users(id),
  imported_at  TEXT,                      -- set on the online tier only
  notes        TEXT
);
```

---

## Work

### On the site

- **Export button** on the Reports screen: pick a date range or "everything since the last
  package", write an encrypted file to a chosen path, record a `sync_packages` row.
- **What goes in:** donations and fund utilisation aggregates; per-patient visit, prescription,
  dialysis and report records **only for customers with `consent_online = 1`**; nothing else.
  Never export the whole database.
- **What never goes in:** cost prices, margins, vendor terms, staff subsidy, credit balances,
  the controlled-drug register, user password hashes.
- Show the last export date and the pending row count on the dashboard, so a missed week is
  visible.

### On the online tier

- **Import** a package: verify the signature and checksum, apply idempotently, record
  `imported_at`.
- **Donor Portal:** registration, login, impact dashboard, fund utilisation by
  `subsidy_funds`, donations and pledges, printable receipts, and a prominent **"data as of
  <date>"** stamp — a stale portal that says so is trustworthy; one that does not is not.
- **Patient Portal:** login by patient code + contact match (the existing rule), own visit
  history, prescriptions, dialysis sessions and uploaded reports, download and print, and the
  same freshness stamp.

Both portals already exist in the codebase at `/portal/donor` and `/portal/patient` with their
own JWT `kind` claim. **This phase supplies their data, it does not rebuild them.**

---

## API surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/sync/export` | `sync.manage` | Build an encrypted package, write it to a path |
| GET | `/api/sync/packages` | `sync.manage` | History, with pending row count |
| POST | `/api/sync/import` | `sync.manage` | **Online tier only.** Idempotent |
| GET | `/api/sync/status` | `sync.manage` | Last export, pending rows, last import seen |

---

## Tasks

- [ ] **Answer Q11 before writing any code in this phase**
- [ ] `sync_packages` table + `package_no` counter
- [ ] Export builder: incremental from `sync_records`, checksummed
- [ ] Encryption at rest, with the key held outside the package
- [ ] Consent filter — only `consent_online = 1` customers in the patient payload
- [ ] Redaction check: no cost, margin, vendor, staff-subsidy, credit or CDR data in a package
- [ ] Donor payload as aggregates only — no re-identifiable rows
- [ ] Export screen with date range and target path
- [ ] Last-export date and pending count on the dashboard
- [ ] Idempotent import on the online tier
- [ ] "Data as of" stamp on both portals
- [ ] Wire the existing Donor Portal to imported data
- [ ] Wire the existing Patient Portal to imported data

---

## Acceptance tests

- [ ] Exporting twice with no activity in between produces a package with zero rows
- [ ] Importing the same package twice leaves the online tier unchanged the second time
- [ ] A package interrupted halfway re-imports cleanly from the start
- [ ] A customer with `consent_online = 0` appears nowhere in any package
- [ ] A package contains no cost price, margin, vendor term, staff subsidy, credit balance or
      controlled-register row — verified by decrypting one and grepping for the fields
- [ ] The donor dashboard shows fund totals with no re-identifiable patient data
- [ ] Both portals display the correct "data as of" date, and it changes after an import

---

## Notes & decisions

- The offline half of this module is already delivered in
  [Phase 00](PHASE-00-site-hardening.md) — the site is fully functional with no connection and
  is the source of truth. This phase is only the sync half.
- **A USB stick carrying patient data will eventually be lost.** Encryption at rest is not
  optional, and the key must not travel on the same stick.
- This phase is last because it is the only one that depends on something outside the building.
  Everything the pharmacy and the dialysis unit need to work is finished by Phase 07.
