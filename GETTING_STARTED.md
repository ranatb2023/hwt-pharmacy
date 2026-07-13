# Getting Started — HWT HMS

An offline-first Hospital Management System. Backend: **Node.js + Express + better-sqlite3** (single-file local DB). Frontend: **React (Vite)**.

## Prerequisites
- Node.js 18+ (tested on Node 22)

## First-time setup
```bash
# from the project root
npm run install:all      # installs backend + frontend deps
npm run seed             # creates data/hms.db with roles, users and master data
```

## Run

### Option A — single server (production-style, one port)
```bash
npm run build            # builds the React app into frontend/dist
npm start                # serves API + UI at http://localhost:4000
```
Open **http://localhost:4000**

### Option B — development (hot reload)
```bash
npm install              # root, for the "concurrently" runner
npm run dev              # API on :4000, Vite dev server on :5173 (proxies /api)
```
Open **http://localhost:5173**

## Demo login accounts
| Username    | Password  | Role           |
|-------------|-----------|----------------|
| admin       | admin123  | Administrator  |
| reception   | pass123   | Receptionist   |
| doctor      | pass123   | Doctor         |
| lab         | pass123   | Lab Technician |
| pharmacy    | pass123   | Pharmacist     |
| cashier     | pass123   | Cashier        |

## Online portals (public — separate from staff login)
- **Donor portal:** `/portal/donor` — demo `donor@example.com` / `donor123` (or register). Shows aggregated, de-identified impact metrics; make donations/pledges.
- **Patient portal:** `/portal/patient` — log in with **Patient ID + registered contact number**. Requires the "online consent" box ticked at registration. Strict per-patient data isolation.

## Try the clinical flow
1. **reception** → Register a patient (choose a billing category), issue a token.
2. **doctor** → Open the patient / Queue → *Consult*: record vitals & diagnosis, add a prescription, order a lab test.
3. **lab** → Laboratory work-list → *Enter Result* (becomes visible to the doctor).
4. **pharmacy** → find the patient → add pending prescriptions → *Complete Sale* (deducts stock FEFO, applies category discount).
5. **cashier** → Billing → load the visit → *Finalize Bill* (category rules auto-applied) → record payment.
6. **admin** → Dashboard, Subsidy Report, Audit Log, user & role management.

## Modules implemented (complete)
Patient Management · Token & Queue · Doctor Consultation (EMR) · Laboratory · Inventory & Stock · Pharmacy (FEFO dispensing & OTC sales) · Billing with patient-category rules (Paid / Complete Free / Discounted / Staff) · **Vendor/Supplier** (goods received, payments, reclaims, payables) · **Customer Returns** (refund, restock saleable, write-off) · **Dialysis** (stations, scheduling with conflict checks, consumables deduction, category billing) · **Cash Flow & Float** (open/close, transactions, reconciliation with variance) · **Roles & Permissions** (RBAC) · Audit logging · Reporting (dashboard, discount/subsidy) · **Donor Portal** · **Patient Portal** · **Offline↔cloud Sync engine** (queue, status, run, export/import).

## Try the extended modules
- **Vendors** (pharmacy/admin): open a vendor → *Goods Received* (creates stock batches + raises payable) → *Record Payment* / *Reclaim*.
- **Dialysis** (doctor/admin): *Schedule Session* (station conflicts are blocked) → *Complete* records vitals, deducts consumables, and bills by category.
- **Cash Flow** (cashier/pharmacy): open a float → add cash in/out → close and reconcile against counted cash (variance shown).
- **Returns** (cashier/pharmacy): look up a pharmacy bill → choose return quantities and saleable flag → refund.
- **Sync** (admin → Sync tab): watch the pending queue, click *Sync Now*.

## Data & backup
The entire database is a single file at `backend/data/hms.db` (SQLite WAL mode). Back it up by copying that file. Delete it and re-run `npm run seed` to reset.
