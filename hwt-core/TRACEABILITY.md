# TRACEABILITY — every requirement, placed

Each line the client gave us against the phase that delivers it. Nothing has been dropped or
quietly narrowed.

**Verify against this file before saying a phase is done.** If a requirement is not ticked
here, it is not delivered, regardless of what the phase file says.

Scope is set by [SCOPE.md](SCOPE.md).

---

## A. Modules (from `MODULES_AND_FEATURES.md`)

| # | Module | Phase | ✔ |
|---|---|---|---|
| M1 | **Pharmacy Management** | [01](phases/PHASE-01-counter-and-catalogue.md), [02](phases/PHASE-02-departments.md), [06](phases/PHASE-06-reports-and-corrections.md), [07](phases/PHASE-07-cash-register.md) | ⬜ |
| M2 | **Inventory & Stock Management** | [01](phases/PHASE-01-counter-and-catalogue.md), [02](phases/PHASE-02-departments.md) | ⬜ |
| M3 | **Customer Management** | [03](phases/PHASE-03-customers-and-entitlements.md), [04](phases/PHASE-04-ledger-and-credit.md) | ⬜ |
| M4 | **Dialysis Management** *(full module)* | [05](phases/PHASE-05-dialysis-management.md) | ⬜ |
| M5 | **Reporting & Analytics** | [06](phases/PHASE-06-reports-and-corrections.md) | ⬜ |
| M6 | **Donor Portal (Online)** | [08](phases/PHASE-08-portals-and-sync.md) | ⬜ |
| M7 | **Patient Portal (Online)** | [08](phases/PHASE-08-portals-and-sync.md) | ⬜ |
| M8 | **Offline Operation & Sync** | offline half → [00](phases/PHASE-00-site-hardening.md); sync half → [08](phases/PHASE-08-portals-and-sync.md) | ⬜ |

### On hold — deliberately not built

| Module | Replaced by |
|---|---|
| Patient Management & Reception | Customer Management; dialysis registers its own patients |
| Token & Queue Management | Nothing — the counter has no token system |
| Doctor Consultation (EMR) | Prescriptions arrive from outside, typed at the counter |
| Laboratory Management | The lab is a **department**: sends a slip, gets an invoice |

Code for all four stays behind the mode gate. Not deleted.

---

## B. The client's 21-line brief

| # | Requirement, in the client's own words | Phase | How it lands | ✔ |
|---|---|---|---|---|
| 1 | multiple patient handle at a time (4 to 5) | [01](phases/PHASE-01-counter-and-catalogue.md) | Server-persisted parked carts, tab strip, F5/F6 | ⬜ |
| 2 | dropdown list for product type | [01](phases/PHASE-01-counter-and-catalogue.md) | `product_types` lookup table + admin screen | ⬜ |
| 3 | full box price | [01](phases/PHASE-01-counter-and-catalogue.md) | Third entry leg on the packaging maths; all three rates shown | ⬜ |
| 4 | dialysis patient (free medicine) | [03](phases/PHASE-03-customers-and-entitlements.md) + [05](phases/PHASE-05-dialysis-management.md) | Entitlement resolved at issue on the demand form; posts to the dialysis programme | ⬜ |
| 5 | lab uses products | [02](phases/PHASE-02-departments.md) | Lab sends a slip → dispensed → **invoiced to the Laboratory** | ⬜ |
| 6 | card patient (full free, 50%, 20%) | [03](phases/PHASE-03-customers-and-entitlements.md) | `welfare_cards` + configurable `card_tiers` with a covered scope | ⬜ |
| 7 | hospital uses | [02](phases/PHASE-02-departments.md) | Ward / OT / Admin slips → invoiced, tracked as hospital expense | ⬜ |
| 8 | reports as is | [06](phases/PHASE-06-reports-and-corrections.md) | Existing reports untouched; new ones beside them *(Q1)* | ⬜ |
| 9 | emergency cases uses | [02](phases/PHASE-02-departments.md) | Emergency slips → invoiced; `is_emergency` for separate reporting | ⬜ |
| 10 | all needs to seprate | [02](phases/PHASE-02-departments.md) | `cost_centre` + `charge_class` on every movement and every bill | ⬜ |
| 11 | udhaar khata (credit payment withheld when cleared) | [04](phases/PHASE-04-ledger-and-credit.md) | Party ledger; a credit sale bypasses the till until settlement | ⬜ |
| 12 | electronic cash register — this should be the last phase | [07](phases/PHASE-07-cash-register.md) | ESC/POS kick from the backend, invoice-gated | ⬜ |
| 13 | register open only when the invoice is generated | [07](phases/PHASE-07-cash-register.md) | Kick accepted only for a recent **cash** bill by this user at this counter | ⬜ |
| 14 | admin can open without the invoice | [07](phases/PHASE-07-cash-register.md) | `register.open` no-sale, logged, counted on the day book | ⬜ |
| 15 | reports of non-paid customer | [06](phases/PHASE-06-reports-and-corrections.md) | Receivables by party, 30/60/90 aging, contact numbers | ⬜ |
| 16 | how much company earn — distribution wise, company wise, product wise, annually / monthly | [06](phases/PHASE-06-reports-and-corrections.md) | Margin grouped on vendor, manufacturer, product, type. **Needs Phase 01's managed lists** | ⬜ |
| 17 | staff wise report — subsidy used, left, and payable if exceeded | [03](phases/PHASE-03-customers-and-entitlements.md) + [04](phases/PHASE-04-ledger-and-credit.md) | Statement in 03; the excess posts to the staff credit account in 04 | ⬜ |
| 18 | dialysis demands and patient khata should be seperate | [04](phases/PHASE-04-ledger-and-credit.md) | Distinct `ledger_kind` accounts, never netted, separate statements | ⬜ |
| 19 | record the person who has taken the medicine | [05](phases/PHASE-05-dialysis-management.md) | Shared `handovers` record with relation and CNIC, plus a signed slip | ⬜ |
| 20 | emergency medicine of dialysis on the same invoice | [05](phases/PHASE-05-dialysis-management.md) | The form's own **Emergency** row on the one session bill | ⬜ |
| 21 | admin edits a mis-entered bill after the session is closed | [06](phases/PHASE-06-reports-and-corrections.md) | Credit note + corrected bill; adjustment to the currently open till | ⬜ |
| 22 | day end on close, printed (card, dialysis, paid) | [06](phases/PHASE-06-reports-and-corrections.md) | Day-close fired on close, segmented and footed | ⬜ |
| 23 | no vendor ordering — record the delivery only | [01](phases/PHASE-01-counter-and-catalogue.md) | GRN kept, no PO, `order_bookings` memo + printable demand slip | ⬜ |

---

## C. Site constraints (2026-09-07)

| # | Constraint | Phase | How it lands | ✔ |
|---|---|---|---|---|
| 24 | no internet access, LAN setup only | [00](phases/PHASE-00-site-hardening.md) | Static server IP, browser clients, every report printable on paper | ⬜ |
| 25 | load-shedding | [00](phases/PHASE-00-site-hardening.md) | `synchronous = FULL`, single-transaction writes, auto-start service, UPS, clock guard | ⬜ |
| 26 | which technology is best for us | [TECHNOLOGY.md](TECHNOLOGY.md) | Keep Node + SQLite + React; spend the budget on Phase 00 | ✅ |

---

## D. The dialysis demand form (client's PDF)

Transcribed at [`../hwt-client/forms/dialysis-demand-form.md`](../hwt-client/forms/dialysis-demand-form.md).

| # | What the form requires | Phase | How it lands | ✔ |
|---|---|---|---|---|
| 27 | Nineteen fixed rows in two columns, in the unit's own wording | [05](phases/PHASE-05-dialysis-management.md) | `demand_template_items` seeded in exactly that order | ⬜ |
| 28 | Per patient, per shift — three blocks to a sheet | [05](phases/PHASE-05-dialysis-management.md) | `dialysis_demands` keyed on customer + shift + date; print keeps 3 to a page | ⬜ |
| 29 | "Demanded by" and "Issued by" signatures | [05](phases/PHASE-05-dialysis-management.md) | Two-step workflow; FEFO deducts at issue | ⬜ |
| 30 | A "Total Cost" cell per patient block | [05](phases/PHASE-05-dialysis-management.md) | `dialysis_demands.total_cost`, printed filled in *(Q8)* | ⬜ |
| 31 | Rows covering several SKUs | [05](phases/PHASE-05-dialysis-management.md) | `demand_template_item_products` — a set per row with a default *(Q7)* | ⬜ |
| 32 | An "other" row and an "Emergency" row | [05](phases/PHASE-05-dialysis-management.md) | `is_freetext` rows searching the catalogue; `is_emergency` flag | ⬜ |

---

## E. Scope decisions (2026-09-07)

| # | Instruction, in the client's own words | Phase | How it lands | ✔ |
|---|---|---|---|---|
| 33 | *all these modules are standalone, no link with each other, only with the pharmacy* | [02](phases/PHASE-02-departments.md) | No software integration. A slip comes in, an invoice goes out | ⬜ |
| 34 | *only dialysis module is full fledge — they register customer, order medicine from the pharmacy, keep the dialysis patient history* | [05](phases/PHASE-05-dialysis-management.md) | Own registration, own profile, own history, own demand form | ⬜ |
| 35 | *all other uses should come to the pharmacy in the form of prescription* | [02](phases/PHASE-02-departments.md) | `department_requests` — typed at the counter from the paper slip | ⬜ |
| 36 | *these departments then charge accordingly by giving them invoice* | [02](phases/PHASE-02-departments.md) | `bill_type = 'department-invoice'` against the department's ledger | ⬜ |
| 37 | *these should be tracked in hospital expense* | [02](phases/PHASE-02-departments.md) + [06](phases/PHASE-06-reports-and-corrections.md) | `GET /api/reports/hospital-expense`, by department and period | ⬜ |
| 38 | *other modules are on hold* | [SCOPE.md](SCOPE.md) | Reception, Queue, EMR, Lab gated off — code kept, not deleted | ✅ |
| 39 | *think of it like a POS system for the pharmacy and dialysis management system* | whole plan | [SCOPE.md](SCOPE.md) restates the product in one line | ✅ |
| 40 | *client related work should be in the separate folder* | — | [`../hwt-client/`](../hwt-client/) created | ✅ |

---

## Coverage by phase

| Phase | Requirements delivered |
|---|---|
| 00 | 24, 25 · M8 (offline half) |
| 01 | 1, 2, 3, 23 · M1, M2 |
| 02 | 5, 7, 9, 10, 33, 35, 36, 37 · M1, M2 |
| 03 | 4 (part), 6, 17 (part) · M3 |
| 04 | 11, 17 (part), 18 · M3 |
| 05 | 4 (part), 19, 20, 27–32, 34 · M4 |
| 06 | 8, 15, 16, 21, 22, 37 (report) · M5 |
| 07 | 12, 13, 14 · M1 |
| 08 | M6, M7, M8 (sync half) |

Every numbered line appears in at least one phase, or is explicitly split with "(part)".
**If a new requirement arrives, add it here first, then to the phase file** — and check it
against the scope test in [SCOPE.md](SCOPE.md) before adding it at all.
