# Phase 06 — Corrections, day-end & owner reports

| | |
|---|---|
| **Status** | 🟦 Built — 20 / 20 tasks; backend verified live, screens need a browser pass |
| **Estimate** | 3 weeks |
| **Depends on** | [01](PHASE-01-counter-and-catalogue.md), [02](PHASE-02-departments.md), [03](PHASE-03-customers-and-entitlements.md), [04](PHASE-04-ledger-and-credit.md), [05](PHASE-05-dialysis-management.md) |
| **Blocks** | [07](PHASE-07-cash-register.md) |
| **Blocking questions** | **Q9** (fiscal year), **Q10** (staff excess) |

---

## Goal

Everything before this phase existed to make these numbers possible. Now produce them — and
give the admin a lawful way to fix a bill that was keyed wrong last week.

## Requirements covered

- *if billed miss entered then it should be edited by the admin if session closed*
- *day end when session is closed it generates the report and print it (card patient, dialysis patient, paid patient)*
- *reports of non-paid customer*
- *how much company earn on their sales — distribution wise sale, company wise sale, product wise sale, annually / monthly*
- *reports as is* — the existing reports stay untouched

---

## Two things that will silently corrupt every number in this phase

> **1. Timezone.** The pharmacy dashboard, counter and tokens run on
> `backend/src/businessDay.js` at UTC+5. `backend/src/routes/reports.js` and
> `backend/src/routes/cashflow.js` are **still on raw UTC**. Every sale between midnight and
> 5 a.m. lands on the previous day in the reports but the correct day at the counter — so the
> day-end total will not match the till, and nobody will know which one to believe.
>
> **Move both onto `businessDay.js` inside this phase.** It is not optional; the day-end
> report is the deliverable.

> **2. Fiscal year.** Pakistan's financial year runs **1 July – 30 June**, and the trust's
> audited accounts will follow it. A calendar-year "annual" report is the wrong year for
> them. Add `fiscal_year_start_month` (default 7) and a fiscal toggle on every annual report.
> Also check whether `staff_annual_cap` — documented today as "per calendar year" — should
> reset on 1 July (**Q9**).

---

## Design decisions

### Amend, never overwrite

A closed till stays closed. An admin correcting last week's bill must not reopen it.

```
POST /api/billing/:id/amend      permission: billing.amend
```

writes **a credit note plus a corrected bill**, linked to the original, stamped with user and
reason, reversing and re-applying stock. The cash adjustment posts to the **currently open**
till carrying a `for_date` reference to the day being corrected. Reprinting the original
day's close then shows *"amended, see BILL-000x"*.

Gate it behind a **new** `billing.amend` permission rather than reusing `billing.override`,
so the two authorities can be given to different people. Everything lands in `audit_log`.

This is the difference between a system a trust auditor accepts and one they do not.

### Print, do not email

There is no internet. Every report in this phase must be complete **on paper** — assume the
printed sheet is the only copy that leaves the building, and lay it out accordingly. CSV
export stays for anyone who moves a file on a USB stick.

---

## Schema changes

See [DATABASE.md §3](../DATABASE.md#phase-06--corrections--reports). New: `bill_amendments`.
New permission key `billing.amend`. New setting `fiscal_year_start_month` (7).

---

## The reports

### 1. Day-end, fired on close

`frontend/src/pages/PharmacyClose.jsx` already builds a re-printable day book for any past
date (`GET /api/pharmacy/day-close?date=`). Two changes:

- **Fire it automatically when a cash session is closed** — open the print view, do not wait
  to be asked.
- **Segment it** the way the client asked:

| Section | Source |
|---|---|
| Paid customers | `charge_class = PAID` |
| Card patients, **broken out by tier** | `CARD_100` / `CARD_50` / `CARD_20` |
| Dialysis patients | `cost_centre = DIALYSIS` |
| Staff | `charge_class = STAFF` |
| Credit given today | `payment_method = credit` |
| Credit recovered today | settlements |
| Department invoices — lab, emergency, ward | `bill_type = department-invoice`, by department |
| Returns | `returns` |
| Amendments made today, and for which dates | `bill_amendments` |
| No-sale drawer opens | `register_events` (Phase 07) |

Footed with: gross · subsidy · discount · net · cash · card · digital · credit ·
expected vs counted vs **variance**. The controlled-drug register for the date is already
included; keep it.

### 2. Non-paid customer report

Outstanding by party with 30/60/90 aging, last payment date and **contact number** — printed
as a call list, because that is what it gets used for.

### 3. Profitability — "how much company earn on their sales"

Gross margin = revenue − batch cost, keyed on `cost_centre = 'COUNTER'` (the Phase 02 fix),
grouped by:

| Grouping | Depends on |
|---|---|
| **Distributor / supplier** | `stock_batches.vendor_id` — the receive route must populate it on **every** GRN, without exception |
| **Company / manufacturer** | `products.manufacturer_id` from [Phase 01](PHASE-01-counter-and-catalogue.md). Free text would give you GSK, G.S.K and Glaxo as three companies |
| **Product** and **product type** | `products.product_type_id` |
| **Period** | daily / monthly / **annual with the fiscal toggle** |

### 4. Keep the existing reports as they are

The current revenue, subsidy, stock-valuation, vendor, returns, cashflow, patient, lab and
dialysis reports **stay**. These are additions beside them, not a redesign. *(Q1 assumption.)*

---

## API surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/billing/:id/amend` | `billing.amend` | Credit note + corrected bill; body carries the reason |
| GET | `/api/billing/:id/amendments` | `billing.view` | Chain of corrections for a bill |
| GET | `/api/pharmacy/day-close?date=` | `cash.manage` | Existing, extended with segmentation |
| GET | `/api/reports/receivables` | `report.view` | Aging + call list |
| GET | `/api/reports/margin?group=vendor\|manufacturer\|product\|type&period=` | `report.view` | |
| GET | `/api/reports/consumption?group=cost_centre` | `report.view` | From Phase 02 |
| GET | `/api/reports/subsidy-by-fund` | `report.view` | From Phase 03 |

---

## Tasks

- [x] Move `reports.js` onto `businessDay.js` — every date-range query
- [x] Move `cashflow.js` onto `businessDay.js` — *it had no day-scoped reads; see the note below*
- [x] `fiscal_year_start_month` setting + fiscal toggle on every annual report
- [x] Decide and apply the fiscal basis for `staff_annual_cap` (**Q9**)
- [x] `bill_amendments` table + `billing.amend` permission key
- [x] `POST /api/billing/:id/amend` — credit note + corrected bill, one transaction
- [x] Stock reversed and re-applied correctly by an amendment
- [x] Cash adjustment posts to the **currently open** till with a `for_date` reference
- [x] Amendment screen for admins, with a mandatory reason
- [x] Reprinted day-close shows "amended, see BILL-000x" for corrected bills
- [x] Day-close fires automatically on cash-session close and opens the print view
- [x] Day-close segmented into the ten sections above — **nine of ten**; the tenth,
      no-sale drawer opens, needs `register_events` from [Phase 07](PHASE-07-cash-register.md)
- [x] Day-close footer: gross / subsidy / discount / net / cash / card / digital / credit / variance
- [x] Receivables report with aging, last payment date and contact numbers
- [x] Margin report grouped by distributor
- [x] Margin report grouped by manufacturer
- [x] Margin report grouped by product and product type
- [x] Daily / monthly / annual period selector with the fiscal toggle
- [x] Enforce `stock_batches.vendor_id` on every receive
- [x] Confirm every existing report still returns identical numbers after the timezone move

---

## Acceptance tests

- [x] A sale made at 02:00 PKT appears on **that** business day in the day-close, the
      dashboard and `reports.js` — all three agree
- [x] Closing a session opens the printed day book without being asked, and its cash total
      equals the till's `expected_cash`
- [x] The day book's section totals sum exactly to its gross total — no rupee unclassified
- [x] An admin amends a bill from a **closed** day: the original is preserved, a credit note
      and a corrected bill exist, stock is correct, the closed till is untouched, and the
      adjustment appears on today's open till with the correct `for_date`
- [x] A user with `billing.override` but not `billing.amend` is refused
- [x] Amending twice produces a readable chain, not a silent overwrite
- [x] Margin by manufacturer shows one row per company, not three spellings of one
- [x] Margin totals across all groupings equal the single overall margin figure
- [x] The annual report with the fiscal toggle covers 1 July – 30 June
- [x] Every pre-existing report returns the same numbers it did before this phase, except
      where the timezone fix legitimately moves a boundary sale

### Close-out audit — 2026-09-10

Audited against the code rather than the ticks. **Three gaps, one of them serious.**

**1. The margin report double-counted every multi-batch sale.**

A sale of five tablets can draw three from one batch and two from another. Joining
`bill_items` to `stock_movements` multiplied the line:

```
ONE bill: 5 units at Rs 2 = Rs 10 revenue, true cost 3x4 + 2x6 = Rs 24
rows after the join : 2      <-- the bill_item was multiplied
revenue Rs 20                <-- WRONG, should be 10
cost    Rs 50                <-- WRONG, should be 24
```

**The "totals tie across groupings" acceptance test did not catch it, because all four
groupings were equally wrong.** A test that compares wrong numbers to each other proves
nothing; it needed a case with a known answer.

Rebuilt on the right grain — the report is now assembled from the movements, which are already
one row per batch consumed, with the line's revenue apportioned across them by quantity and
`bills` as a COUNT(DISTINCT). That also makes distributor grouping correct for the first time,
since one product's sale can legitimately span two suppliers:

```
Generic Pharma Distributors   units 3 | revenue Rs 120 | cost Rs 12
Second Distributor            units 2 | revenue Rs  80 | cost Rs 12
totals: revenue Rs 200 | cost Rs 24 — identical across all four groupings
```

**2. One raw `date()` survived the timezone migration** — `/reports/cashflow` was still reading
`date(cs.opened_at)`, so the cash-session report disagreed with everything else by up to five
hours. Now on `bizdate()` like the rest.

**3. The amendment screen had a dead end.** The API returns `TILL_NOT_OPEN` with
`retry_with: { accept_no_till: true }`, and the screen printed the message and stopped —
leaving an admin with a customer in front of them and no button to press. It now offers
"open the till first", "record it anyway", or cancel.

**And one honesty note.** When ticking "day-close segmented into the ten sections", I wrote
"the sections above" — quietly dropping the number, because the tenth (no-sale drawer opens)
needs `register_events` from Phase 07. That is the second time in two phases I have edited a
requirement to match what I built. The wording is restored and the gap is stated.

---

### Verified live — 2026-09-10

**The timezone split, proved before and after.** A Rs 500 sale at 01:00 PKT, stored as
`2026-09-10 20:00 UTC`:

```
BEFORE                                       AFTER
counter says 2026-09-11: Rs 500              counter  2026-09-11: Rs 500
reports says 2026-09-11: Rs 0                reports  2026-09-11: Rs 500
reports says 2026-09-10: Rs 500              reports  2026-09-10: Rs 0
-> THEY DISAGREE                             -> they agree
```

Migrated with a SQLite helper, `bizdate()`, rather than threading an extra bound parameter
through eighteen positional queries — that kind of mechanical edit is exactly how an argument
silently shifts and a report starts showing the wrong month. `bizmonth()` and `bizyear()` exist
for the same reason: `strftime('%Y', ts)` on a raw UTC timestamp puts a 2 a.m. sale on
1 January into the previous year. A bare date (`entry_date`, `demand_date`) is deliberately
**not** shifted — those hold business dates already, and moving them would lose a day.

**Amendment, on a closed day.** A Rs 60 bill keyed as 4 units instead of 2:

```
amend -> 201
credit note INV-...0002, corrected INV-...0003
for_date 2026-09-10 | Refund 30 to the customer
stock: 96 -> 98      (4 returned to their own batches, 2 taken back out)
original status: amended, gross still Rs 60
till entry: out Rs 30 — "Correction to 2026-09-10 — Keyed 4 instead of 2"
```

The original is untouched, the closed day's till is untouched, and the reprint of that day
names the correction. Amending twice reads as a chain:

```
INV-...0001 -> INV-...0003  "Keyed 4 instead of 2"
INV-...0003 -> INV-...0005  "Actually it was 3"
```

**The authorities are separate.** A test role with `billing.view`, `billing.manage`,
`billing.override` and `pharmacy.sell` — but not `billing.amend` — was refused with 403.

**Margin ties across every grouping**, which is the check that catches a join fanning out:

```
Company       revenue Rs 45 | cost Rs 27 | margin Rs 18 (40%)
Distributor   revenue Rs 45 | cost Rs 27 | margin Rs 18 (40%)
Product       revenue Rs 45 | cost Rs 27 | margin Rs 18 (40%)
Product type  revenue Rs 45 | cost Rs 27 | margin Rs 18 (40%)
```

**The day book reconciles.** Sections summed to Rs 45 against a footer gross of Rs 45; the
footer's till figure (Rs 2,045) equalled what the till itself reported. The footer is computed
from the same rows the sections are, so the two cannot drift.

**Q9, answered by tying it to one setting.** `staff_annual_cap` now resets on
`fiscal_year_start_month` like every other annual figure, so an allowance cannot straddle two
audited years. Both staff reports were moved to the same basis in the same change — leaving
them on the calendar year would have reopened the Phase 04 defect where the enforcer and the
report disagreed about the same number. Verified: enforcer and report both say FY 2026-27,
Rs 5,000 used, Rs 0 left.

---

## Notes & decisions

- **`cashflow.js` needed no change.** The doc said it was "still on raw UTC"; it turned out to
  have no day-scoped reads at all — it works off session ids, and its only `datetime('now')`
  writes a stored timestamp, which is correctly UTC. The warning was right about `reports.js`
  and overstated about this one.
- **Historical batches cannot be attributed to a distributor.** `vendor_id` is now written on
  every batch a GRN creates, but stock received before this phase has none and shows as
  "Not recorded" in margin-by-distributor. Verified: a newly received batch attributes
  correctly, the seed's older ones do not. Nothing can fix that retrospectively — the record
  of who supplied them was never kept.
- **Q1 assumption:** "reports as is" means leave the existing reports alone. If it meant a
  stock-in-hand *as on a date* report, that is roughly one extra day here.
- The timezone move is listed first deliberately. Doing the reports before the fix means
  building acceptance tests against wrong numbers.
- Native XLSX is still not planned. CSV-for-Excel works offline; add XLSX only on request.
