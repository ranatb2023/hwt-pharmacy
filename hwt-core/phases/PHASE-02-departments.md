# Phase 02 — Departments: prescription in, invoice out

| | |
|---|---|
| **Status** | 🟦 In review — built and live-tested; screens need a human check |
| **Estimate** | 2 weeks |
| **Depends on** | [Phase 01](PHASE-01-counter-and-catalogue.md), and Phase 03's customer table |
| **Blocks** | [05](PHASE-05-dialysis-management.md), [06](PHASE-06-reports-and-corrections.md) |
| **Blocking questions** | **Q12** (invoice rate), **Q13** (which departments, who signs) |

---

## Goal

The laboratory, emergency, the wards and the OT are **outside** this product — their modules
are on hold. They reach the pharmacy the way any customer does: a prescription comes in, stock
goes out, an invoice goes back. Those invoices are the hospital's expense, reported by
department.

## Requirements covered

- *lab uses products* · *hospital uses* · *emergency cases uses*
- *all needs to seprate*
- *other uses from the different department should come to the pharmacy in the form of prescription and these departments then charge accordingly by giving them invoice*
- *these should be tracked in hospital expense*

---

## The design decision

> **A department is a customer, and it gets a real invoice.**
>
> The earlier plan modelled this as a silent internal issue valued at cost, with no paperwork.
> The client corrected it: departments are **charged**, and the charge is the hospital's
> expense. That is better in every way — it produces a document the department in-charge can
> be shown, it reuses the ledger the pharmacy already needs for customer credit, and "hospital expense
> by department" becomes a `GROUP BY` on invoices rather than a second accounting mechanism.

There is **no software integration** with the lab or emergency systems, because those modules
are on hold. The prescription arrives on paper and is typed at the counter.

### The two dimensions stay

Even with an invoice as the mechanism, stock still has to answer *where did it go*:

| Column | Question | Values |
|---|---|---|
| `cost_centre` | **Where did it go?** | `COUNTER` · `DIALYSIS` · `LAB` · `EMERGENCY` · `WARD` · `OT` · `ADMIN` |
| `charge_class` | **Who paid?** | `PAID` · `CARD_100` · `CARD_50` · `CARD_20` · `STAFF` · `DIALYSIS_FREE` · `DEPARTMENT` · `CREDIT` · `ZAKAT` |

Two orthogonal columns, not one enum. *An emergency injection given free to a card patient is
two facts, not one* — a single field would force values like `EMERGENCY_CARD_50` the first
time it happened.

Both go on `stock_movements` **and** on `bills`, so a stock question and a money question are
answered from the same two words.

---

## Schema changes

```sql
CREATE TABLE departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,   -- LAB / EMERGENCY / WARD / OT / ADMIN / DIALYSIS
  name          TEXT NOT NULL,
  in_charge     TEXT,                   -- who signs for it (Q13)
  contact       TEXT,
  customer_id   INTEGER REFERENCES patients(id),  -- its customer record, type 'department'
  invoice_basis TEXT NOT NULL DEFAULT 'cost',     -- cost / cost_plus / mrp  (Q12)
  markup_pct    REAL NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- A prescription or demand slip received from a department, typed at the counter.
CREATE TABLE department_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no    TEXT NOT NULL UNIQUE,   -- REQ-00001
  department_id INTEGER NOT NULL REFERENCES departments(id),
  patient_name  TEXT,                   -- the department's own patient; free text, no link
  patient_ref   TEXT,                   -- their MR number if they wrote one
  slip_ref      TEXT,                   -- the paper slip's serial
  prescriber    TEXT,
  requested_on  TEXT NOT NULL,          -- business date
  status        TEXT NOT NULL DEFAULT 'received',  -- received/dispensed/short/invoiced/cancelled
  bill_id       INTEGER REFERENCES bills(id),
  notes         TEXT,
  received_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE department_request_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES department_requests(id),
  product_id    INTEGER REFERENCES products(id),
  label         TEXT,                   -- what the slip said, if it is not a catalogue match
  qty_requested INTEGER NOT NULL DEFAULT 0,
  qty_dispensed INTEGER NOT NULL DEFAULT 0,
  unit_price    REAL NOT NULL DEFAULT 0,
  line_total    REAL NOT NULL DEFAULT 0,
  is_emergency  INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE stock_movements ADD COLUMN cost_centre  TEXT;
ALTER TABLE stock_movements ADD COLUMN charge_class TEXT;
ALTER TABLE bills           ADD COLUMN cost_centre  TEXT;
ALTER TABLE bills           ADD COLUMN charge_class TEXT;
ALTER TABLE bills           ADD COLUMN department_id INTEGER REFERENCES departments(id);

-- one-off backfill so historical margin stays correct
UPDATE stock_movements SET cost_centre = 'COUNTER' WHERE cost_centre IS NULL;
```

New counter: `request_no` → `REQ-00001`. New `bills.bill_type` value: `department-invoice`.

---

## Work

### 1. Receiving a prescription from a department

A screen shaped like the paper slip that arrives: pick the department, type the patient's name
and the slip serial, add lines by searching the catalogue. Lines that are not in the catalogue
can be entered as free text and resolved before dispensing.

The department's patient is **not** a customer record. There is deliberately no link — the
lab's patients belong to the lab's system, which is on hold. We store the name and their MR
number as text so the invoice can be checked against their paperwork.

### 2. Dispensing and invoicing

One action: FEFO-deduct, stamp `cost_centre` and `charge_class = 'DEPARTMENT'`, and raise a
bill with `bill_type = 'department-invoice'`, `payment_method = 'credit'` against the
department's ledger account (Phase 04). Short-dispensing records `qty_dispensed <
qty_requested` and both numbers print.

**The invoice rate is Q12.** The working assumption is **batch cost price**, because this is an
intra-organisation transfer whose purpose is expense tracking, not margin. If the trust wants
cost-plus or MRP, `invoice_basis` and `markup_pct` are already on the table — but the decision
changes what "hospital expense" means, so ask before building the report.

### 3. Hospital expense

`GET /api/reports/hospital-expense` — department invoices for a period, grouped by department,
with a per-item breakdown and a monthly trend. This is the number the trust budgets against,
so it prints on one page.

### 4. Fix the margin query — do it here, not later

> **This is a known live defect, not a hypothetical.**
>
> Gross margin identifies revenue by joining `bills.bill_type = 'pharmacy-sale'` while COGS
> sums **all** `stock_movements.type = 'dispense'`. Dialysis consumables use the same movement
> type, so they land in COGS with no matching revenue and margin goes negative. It was patched
> once by adding a join; adding department dispensing on top will break it again.
>
> **Re-key both sides on `cost_centre = 'COUNTER'`.** Department invoices and dialysis issues
> must not distort counter margin — they are cost recovery, not retail.

Files: `backend/src/pharmacyDashboard.js`, `backend/src/routes/reports.js`.

---

## API surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST/PUT | `/api/departments` | `inventory.manage` | Admin CRUD; creates the customer record |
| POST | `/api/departments/requests` | `pharmacy.dispense` | Type a received slip |
| GET | `/api/departments/requests?status=` | `pharmacy.dispense` | Pending worklist |
| POST | `/api/departments/requests/:id/dispense` | `pharmacy.dispense` | FEFO deduct + raise the invoice |
| GET | `/api/departments/requests/:id/print` | `pharmacy.dispense` | Invoice + signed issue slip |
| GET | `/api/departments/:id/statement` | `billing.view` | What this department owes and has been invoiced |
| GET | `/api/reports/hospital-expense` | `report.view` | By department, by period |
| GET | `/api/reports/consumption` | `report.view` | Stock out by cost centre and charge class |

---

## Tasks

- [x] `departments` table + seed from **Q13**, each with an in-charge
- [x] Every department gets a customer record of type `department`
- [x] Department admin screen (name, in-charge, invoice basis, markup)
- [x] `department_requests` + `department_request_items` tables, `request_no` counter
- [x] `stock_movements.cost_centre` / `.charge_class` via `migrate()`
- [x] `bills.cost_centre` / `.charge_class` / `.department_id` via `migrate()`
- [x] `department-invoice` added to `bill_type`
- [x] One-off backfill of existing movements to `COUNTER`
- [x] "Receive department prescription" screen, shaped like the paper slip
- [x] Free-text lines resolvable to catalogue products before dispensing
- [x] Dispense action: FEFO deduct + raise the invoice, in one transaction
- [x] Short-dispense records requested vs dispensed; both print
- [x] Printable invoice + signed issue slip (Demanded by / Issued by)
- [x] `GET /api/reports/hospital-expense` by department and period
- [x] **Re-key the margin query on `cost_centre = 'COUNTER'`** in `pharmacyDashboard.js` and `reports.js`

---

## Acceptance tests

- [ ] A lab slip for 20 gauze is typed, dispensed FEFO, and produces an invoice to the
      Laboratory — not a silent stock transfer
- [x] The invoice appears on the Laboratory's statement as an unpaid balance
- [x] The same dispense writes `cost_centre = LAB`, `charge_class = DEPARTMENT` on every movement
- [ ] Short-dispensing 15 of 20 records both numbers and invoices only the 15
- [x] Dispensing more than is on hand is refused, with the shortfall named
- [x] Quarantined and expired batches are never selected (same rule as the counter)
- [x] The hospital-expense report for a month equals the sum of that month's department
      invoices, and splits correctly by department
- [x] **Margin regression:** a counter sale and a department dispense on the same day — gross
      margin reflects only the counter sale and stays positive

---

## One screen for issuing, not two

The first version of the Departments page had a "Type a department slip" modal that rebuilt the
whole cart inside a dialog — a worse copy of the counter, with no scanner, no stock figures and
no keyboard shortcuts. **It was removed.**

Issuing now works one way:

1. **Issue to a department** captures only what the counter cannot infer — which department, and
   **who is collecting the medicine** — plus optional patient / ward / slip serial.
2. It hands off to the till with that context already set, and the medicines are **scanned there**
   exactly as for any other sale.

The counter also has a "Charge this sale to" selector for when the runner simply walks up, so
neither route requires knowing about the other.

### Who collected it is required

`collected_by_name` / `_contact` / `_cnic` on `department_requests`, **enforced by the route, not
only the form**: stock leaving the pharmacy with nobody named against it is what a department
disputes three weeks later, when no one can answer. `received_by` remains the pharmacy staffer
who processed it — two different people, two different columns.

The name appears on the register, on the slip detail, and on the "Received by" line of the
printed issue slip. Phase 05 generalises this into the shared `handovers` record covering
narcotics and dialysis.

```
no runner named -> 400 "Name of the person collecting the medicine is required."
with a runner   -> 201  invoice INV-...  Rs 72
  stored: Imran (lab attendant) | 0300-1234567 | for Bed 7 | slip L-118
  register shows REQ-00001 -> Imran (lab attendant)
```

---

## Charging a department from the counter

A runner arrives at the till with a slip. The pharmacist is already there and already scanning,
so **the counter can charge the sale to a department directly** — there is a "Charge this sale
to" selector under the customer name. Picking a department:

- prices the cart at that department's basis instead of retail,
- replaces the tender controls with "On account · no cash",
- relabels the button "Issue to Laboratory",
- and posts through the **same** `dispenseRequest()` the Departments page uses, so the pricing,
  the cost-centre stamping and the credit payment method cannot drift between the two screens.

The Departments page remains for the fuller workflow: a slip that has to be typed now and
matched later, printed as an issue slip, or reviewed after the fact.

**Reachability:** `/departments` is in the admin sidebar *and* on the pharmacist's home screen
("Department Slips"). Front-line roles get the hub layout with no sidebar, so a nav entry alone
would have made the whole module invisible to the people who use it.

```
till opened, expected Rs 2000
counter -> department -> 201
  invoice INV-...  Rs 45   bill_type department-invoice
  cost_centre LAB  charge_class DEPARTMENT  payment credit  status unpaid
till after: expected Rs 2000        <-- unchanged, no cash taken
counter KPIs: bills 0, net 0, units 0   <-- not counted as a counter sale
movements: LAB/DEPARTMENT 5u
```

---

## Verified live (2026-09-07)

```
departments seeded      LAB, EMERGENCY, WARD, OT, DIALYSIS, ADMIN  (all invoice_basis = cost)

lab slip typed          REQ-00001, one matched line + one handwritten line
dispense blocked        400 "1 line(s) are not matched to a product yet: Gauze roll..."
line matched, dispensed 200 -> INV-...  Rs 96
  bill_type  department-invoice   cost_centre LAB   charge_class DEPARTMENT   payment credit

movement ledger         LAB / DEPARTMENT  6 movements, 36 units   (stock says where it went)

short dispense          status "short", shortfall reported as "9998 box + 2 strip + 9 cap"
                        invoice covers only what left the shelf

department statement    Laboratory: invoiced Rs 288, paid Rs 0, outstanding Rs 288
hospital expense        EMERGENCY Rs 816 | LAB Rs 288 | WARD Rs 360
```

### Margin regression — the reason this phase exists

```
                      bills | net Rs | COGS Rs | margin Rs | units
at start                  0 |      0 |       0 |         0 |     0
after counter sale        1 |    150 |      90 |        60 |    10
after ward slip (40 u)    1 |    150 |      90 |        60 |    10   <-- unchanged

counter figures unchanged by the ward slip: YES
margin positive:                            YES
the ward cost landed in hospital expense instead: Rs 360
```

---

## The task I ticked without doing

**"Every department gets a customer record of type `department`" was ticked and never
implemented.** `departments.customer_id` existed as a column that nothing wrote. Caught on the
close-out audit before Phase 03, not by the acceptance tests — none of them looked at it.

It matters because Phase 04 hangs the ledger account off that record; without it the department
statement would have had to invent a second mechanism, which is the thing this phase exists to
avoid. Now:

- `ensureDepartmentCustomers()` in `db.js` creates one per department (`DEPT-LAB`, readable
  rather than sequential so it identifies itself in every statement and export), runs on every
  start-up, and is idempotent — verified by running it twice more and counting.
- The `POST /departments` route calls the same function, so a department added at runtime is not
  a second class of department.
- Department invoices now carry `patient_id` pointing at that record.
- **`patients` search excludes them.** They are records, not people: without the filter a
  pharmacist looking for a customer is offered "Emergency" and "Laboratory".

```
LAB -> DEPT-LAB (department)   EMERGENCY -> DEPT-EMERGENCY   WARD -> DEPT-WARD
OT  -> DEPT-OT                 DIALYSIS  -> DEPT-DIALYSIS    ADMIN -> DEPT-ADMIN
runtime-created PHYSIO -> DEPT-PHYSIO
invoice INV-... -> customer DEPT-EMERGENCY / Emergency
idempotent: 7 department customers before, 7 after two more migration runs
patient search for "Emer" -> 0 results
```

Also removed a dead `STATUSES` constant that was declared and never used.

---

## Four defects found while building this

0a. **Blank page after issuing.** The counter's receipt renders `bill.items`, but the department
   path returned a bare `bills` row with no items. `undefined.map()` threw, React unmounted the
   whole tree, and the pharmacist got a white screen with the stock already deducted and no
   invoice to hand over. Fixed by returning `fullBill()` on both department paths, and by
   defaulting to `[]` in the component so a missing collection can never blank the page again.

   The receipt now also reads as what it is: *"Issued to Emergency — charged to their account"*,
   with the department, the patient/ward, their slip serial, **who collected it**, and
   Issued-by / Received-by signature lines instead of cash and change.

0. **`department_id` deleted in transit.** The Departments hand-off stored the id on the
   `deptPatient` object as `undefined` to "clear" it, and the counter's payload spread that
   object *after* `department_id: deptId`. The spread overwrote the real id with `undefined`,
   `JSON.stringify` dropped the key, and the server correctly reported it had no department —
   while the screen showed "Issue to Emergency". Setting a key to `undefined` is not the same as
   not having the key. Fixed by destructuring the id out of the hand-off, and by writing
   `department_id` **last** in the payload so nothing spread before it can win.

   The error message made it worse: *"Department not found"* implies the row is missing. It now
   says *"No department was sent with this issue"* (400) when the id never arrived, and
   *"Department 9999 not found"* (404) when it did but does not exist.

1. **`consumeFEFO` stamped nothing.** My first pass patched `cost_centre` onto the movements
   with an `UPDATE ... WHERE cost_centre IS NULL` *after* the deduction. That can miss rows, and
   a movement with no cost centre is invisible to every report in Phase 06. `consumeFEFO` now
   takes `costCentre` / `chargeClass` and writes them in the same INSERT — so the counter,
   departments and dialysis all stamp correctly by construction.
2. **The dashboard's "units sold today" counted department stock.** Department invoices write
   `bill_items` with the same `item_type = 'pharmacy'`, so a lab slip for 200 gauze reported as
   200 units sold over the counter — the identical mistake to the COGS join this phase replaced,
   in a new place, introduced by me. Both that query and the day-close `units_out` are now
   scoped to `cost_centre = 'COUNTER'`.

---

## Notes & decisions

- **Q12 assumption:** departments are invoiced at **batch cost price**. Confirm before the
  hospital-expense report is built, because it changes what the number means.
- **Q13:** the department list and who signs for each is a fifteen-minute conversation that
  prevents a month of "who authorised this" arguments.
- Department patients are stored as free text on purpose. Linking them would require the
  Laboratory and Reception modules, which are on hold — see [SCOPE.md](../SCOPE.md).
- `is_emergency` on the request line exists so Phase 06 can report emergency consumption
  separately without a second mechanism.
