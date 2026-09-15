# QA Report: Hope Welfare Trust Pharmacy Portal

| | |
|---|---|
| **Build** | v0.1.0 |
| **Target** | `http://localhost:4000` (LAN master, SQLite WAL) |
| **Business day under test** | 2026-09-14 |
| **Tester** | Claude (automated browser + API testing) |
| **Scope** | All 13 modules, UI and REST API, auth, RBAC, a11y, print |
| **Method** | Live click-through plus direct API probing with a valid admin token |

---

## Verdict

The product is well built. The information architecture is right, the Day-End Z-report is better than most commercial Pakistani pharmacy software, the audit log is real, and the domain modelling (FEFO, DRAP schedules, welfare cards, Zakat subsidy, department indents) shows someone who understands pharmacy operations.

But the money layer is not safe to ship.

Every write endpoint trusts the browser. The UI validates properly, the server mostly does not. A counter operator with the browser console open, or anyone who can reach port 4000 on the LAN with a stolen token, can dispense free medicine, refund money against bills that were never paid, and inflate stock out of nothing. None of it trips an alarm.

Five settings that already exist in `/api/settings` are declared but never enforced: `enforce_mrp`, `refund_auth_threshold`, and the till-session requirement implied across three screens. The scaffolding is there. The checks were never wired up.

**Recommendation: do not deploy to a live counter until S1 items are closed.** They are mostly small server-side fixes, not rewrites.

### Counts

| Severity | Count |
|---|---|
| S1 Critical | 5 |
| S2 High | 9 |
| S3 Medium | 13 |
| S4 Low / polish | 13 |
| **Total** | **40** |

---

## S1 CRITICAL

### S1-01 Returns API accepts any quantity and any price. Unlimited refund and phantom stock.

`POST /api/returns` never checks the return line against the original bill. Not quantity, not price, not what was already returned.

The UI clamps correctly. I typed `99` into the return qty box for a bill with 2 units sold, and the field snapped back to 2. The server has no such logic.

**Repro A, over-return.** Bill `INV-202609-00029` sold 1 unit of Panadol at Rs 5.

```js
POST /api/returns
{"bill_id":399,"reason":"QA over","items":[{"product_id":23,"quantity":50,"unit_price":5,"saleable":true}]}
```

→ `201 {"returnNo":"RET-00005","refund":250}`

A Rs 5 bill produced a Rs 250 cash refund and pushed 50 units of Panadol onto the shelf that were never sold and never bought.

**Repro B, double refund.** Bill `INV-202609-00028` (Rs 10) was fully refunded as `RET-00003`. Posting the identical payload again returned `201 RET-00004`, another Rs 10. Rs 20 refunded on a Rs 10 bill. There is no "already returned" ledger.

**Repro C, authorisation threshold ignored.** `/api/settings` has `refund_auth_threshold: 5000`, and the Returns screen says "HIGH-VALUE THRESHOLD Rs 5,000, you can authorise above it". A Rs 10,000 refund against a Rs 5 bill went through with no approval step:

```js
{"bill_id":403,"items":[{"product_id":23,"quantity":2000,"unit_price":5,"saleable":false}]}
```

→ `201 {"returnNo":"RET-00006","refund":10000}`

**Impact.** Direct cash theft. A cashier refunds an old walk-in bill to themselves repeatedly, takes the cash from the drawer, and the Z-report shows it as a legitimate refund line.

**Fix.** In the returns handler:
1. Load the bill lines. Reject any `product_id` not on the bill.
2. `SUM(already_returned) + requested <= sold_qty` per line, or reject.
3. Ignore the client `unit_price` entirely. Use the bill line's `unit_price`.
4. Refund total above `refund_auth_threshold` requires a second user's credentials or a supervisor PIN, recorded on the return.
5. Cap total refund at `bill.paid_amount`.

---

### S1-02 Sale API trusts the client's `unit_price`. `enforce_mrp` is set but does nothing.

`POST /api/pharmacy/sale` takes `unit_price` from the request body and writes it straight to the bill. There is no comparison against the product's `sale_price` or `mrp`.

`/api/settings` returns `enforce_mrp: 1`. It is never read on the sale path.

| Test | Product | Catalogue price | Sent | Result |
|---|---|---|---|---|
| Free dispense | Paracetamol 500mg | Rs 2 (MRP Rs 2) | `unit_price: 0` | `201`, `gross_amount: 0`, status `paid` |
| Negative price | Paracetamol 500mg | Rs 2 | `unit_price: -500` | `201`, clamped to 0, stock still deducted |
| Above MRP | Paracetamol 500mg | MRP Rs 2 | `unit_price: 99999` | `201`, `gross_amount: 99999` |

**Impact.** Two separate problems.

Selling at Rs 0 means stock walks out the door with a valid "paid" receipt and no revenue. Stock audit will show the shrinkage weeks later with no way to trace it.

Selling above the notified MRP is a pricing violation under Pakistan's drug pricing rules and carries real regulatory exposure. Worth confirming the current position with whoever handles the pharmacy's DRAP compliance. Either way the system will record it, print it on a slip carrying the pharmacy's name, and roll it into the Z-report. The Rs 99,999 test bill pushed the day's gross margin to 99.95% and neither the dashboard nor the Z-report flagged it.

**Fix.**
1. Server computes the line price from the product record. Treat any client `unit_price` as a *requested discount only*, valid when lower than catalogue price and within `counter_discount_pct`.
2. Hard reject `unit_price > mrp` when `enforce_mrp` is on. Return a named error code like the Rx check already does.
3. Reject `unit_price <= 0` unless the bill category is a welfare or Zakat category that legitimately zero-rates the line, and record which fund absorbed it.
4. Any price override needs a permission (`pharmacy.override_price`) and an audit entry with the before and after.

The Rx enforcement is the model to copy. That one is done right:
`400 {"error":"Paracetamol 500mg is prescription-only (Schedule Rx)...","code":"PRESCRIPTION_REQUIRED"}`

---

### S1-03 Sales complete with no till open. Cash becomes unreconcilable.

The app states the rule in three places. Cash Flow: "No till open, open one below before taking cash" and "Every cash sale from the counter posts itself to this session until it is closed." The footer shows "No till open". The dashboard shows "TILL REGISTER STATUS: Closed".

None of it is enforced.

**Repro.** With no till session open, I added Paracetamol at the POS, entered a prescription ref, and clicked "Complete & print slip". Sale completed. Slip printed "Cash received Rs 6". Footer still read "No till open".

I then ran 7 more cash sales via the API. All accepted.

**Measured result on the Z-report for 2026-09-14:**

| Line | Value |
|---|---|
| CASH (DRAWER) per sales summary | Rs 100,035 |
| DRAWER EXPECTED per till session | Rs 5,010 |
| **Unaccounted** | **Rs 95,025** |

Only the one sale made after I opened a till posted to the drawer. The rest exist as cash revenue attached to no session.

The Z-report prints both figures on the same page and does not flag the gap. Its audit note is confidently wrong: *"Net cash movement through the till was Rs 10.00, so the drawer should hold Rs 5,010.00"* while the same sheet reports Rs 100,035 taken in cash.

**Impact.** This is the exact hole that till reconciliation exists to close. Cash can be taken all day and never appear in any drawer count.

**Fix.**
1. Reject `payment_method: cash` when the user has no open till session. Error code `TILL_NOT_OPEN`.
2. Card and online sales may proceed without a till; they never touch the drawer.
3. On the Z-report, assert `cash_sales == sum(session cash_in for the day)`. Any difference gets a red band at the top of the sheet, not a quiet line.

---

### S1-04 A closed and reconciled business day still accepts new sales. The Z-report is not immutable.

**Repro.**
1. Opened till SES-18, sold, counted the drawer, clicked "Save & close shift". Screen showed `RECONCILED`, variance `Balanced`. Z-report at that moment: **9 bills, Rs 100,035**.
2. Posted one more cash sale for the same business day. → `201 INV-202609-00029`.
3. Re-fetched `/api/pharmacy/day-close?date=2026-09-14`: **10 bills, Rs 100,040**.

The audit sheet that was printed, signed and filed no longer matches what the system will print for that date. By the end of testing the same closed day read 14 bills and Rs 100,060.

**Impact.** The Z-report is the primary financial artefact. If it is regenerable and mutable after sign-off, it has no evidentiary value, and there is no way to detect after-hours sales.

**Fix.**
1. Add a `day_close` record with `status: closed` and a content hash of the figures at close time.
2. Block all billing, returns and stock movements for a closed date. Error `DAY_CLOSED`.
3. Reopening a closed day needs an admin action, writes an audit entry, and marks the day `reopened` on every future print of that sheet.
4. Store the signed snapshot. "Reprint" returns the snapshot, never a fresh query.

---

### S1-05 Returned medicine goes back on the saleable shelf with no expiry date, zero cost and no traceable batch.

Every return creates a synthetic batch instead of crediting the original one.

`GET /api/inventory/products/23/batches` after testing:

```json
[{"batch_no":"RET-00002","expiry_date":null,"quantity":4,"cost_price":0,"manufacturer":"Customer return"},
 {"batch_no":"RET-00003","expiry_date":null,"quantity":2,"cost_price":0,"manufacturer":"Customer return"},
 {"batch_no":"RET-00004","expiry_date":null,"quantity":2,"cost_price":0,"manufacturer":"Customer return"},
 {"batch_no":"RET-00005","expiry_date":null,"quantity":50,"cost_price":0,"manufacturer":"Customer return"},
 {"batch_no":"1246","expiry_date":"2030-08-26","quantity":5,"cost_price":5,"manufacturer":"Abbot"}]
```

Four things are wrong at once.

**No expiry.** `expiry_date: null` on saleable stock. The Inventory screen's own banner says "A medicine needs a DRAP registration number, a batch and an expiry on every receipt." Returns bypass that rule. Expired medicine can re-enter the shelf and the near-expiry watch will never see it.

**FEFO breaks quietly.** I sold 1 Panadol afterwards and FEFO took it from batch `1246` (expiry 2030), not from the null-expiry batches. NULLs sort last. So the 58 returned units are dead stock: they inflate `on_hand`, they suppress reorder alerts, and they will only ever be dispensed once the real batch runs dry, at which point COGS flips to zero.

**COGS corruption.** `cost_price: 0`. Formulary valuation dropped by Rs 15 while 54 units came back in. Any sale from a returned batch reports 100% margin.

**Recall impossible.** The units originally came from batch `1246`. They are now in `RET-00005`. If DRAP recalls batch 1246, those units are invisible to the recall.

**Plus a regulatory point.** Dispensed medicine returning to the saleable shelf is not generally permissible. The app already has a quarantine concept (`quarantined` flag, `/pharmacy/batches/:id/quarantine`). Returns skip it.

**Fix.**
1. Credit the return to the batch it was dispensed from. Store `batch_id` on the bill line at sale time so the return can find it.
2. Restore the original `cost_price` and `expiry_date`.
3. Default returned stock to `quarantined: 1`. Release needs a pharmacist action with a reason, and never for cold-chain or opened packs.
4. Add a DB constraint: no saleable batch may have a NULL expiry.
5. The `saleable: false` write-off path works correctly. Keep it as the default for anything that cannot be verified.

---

## S2 HIGH

### S2-06 Cash refunds never post to the till session, by design

The Returns screen states it plainly: *"It is not posted against the till session, count it out of the drawer and note it on the closing sheet."*

Refunds are the mirror of S1-03. Cash leaves the drawer, the drawer ledger does not know. Staff are asked to patch it manually at closing, which is where variance comes from.

Cash Flow already supports typed movements (`Safe drop`, `Petty cash expense`, `Float top-up`, `Other cash in`). A cash refund should auto-post as `cash_out / refund` with the return number as reference, exactly like sales auto-post as `Auto-posted from billing`.

### S2-07 Orphaned open till session, and sessions are scoped per user rather than per counter

Cash Flow lists a session opened **7 Jul 2026, 16:59** by "Cashier" on Counter 1, still `OPEN` with no close. Meanwhile the page header says "No till open" and `/api/cashflow/current` returns `{"session":null}` for the admin user.

`current` resolves by `user_id`, not by counter. Consequences:

- Two cashiers can hold two simultaneous open tills on the same physical counter and the same drawer.
- An admin cannot see or force-close another user's abandoned session from this screen.
- The 7 July session will never reconcile. Its float of Rs 1,000 is permanently unaccounted.

Fix: sessions belong to a counter. One open session per counter, enforced. Add an admin "force close with reason" that writes an audit entry. Add a startup warning for any session open longer than 24h.

### S2-08 "Today's Dispensing Register" shows bills from four days ago, sorted by ID instead of time

On the dashboard, the panel titled **Today's Dispensing Register**, subtitled *"The latest bills raised at the counter, newest first"*, listed 8 bills totalling Rs 4,094. All 8 were created `2026-09-10`. Business day was `2026-09-14`. The same dashboard showed **BILLS TODAY: 0**.

The rendered times read 10:03, 11:18, 13:31, 16:09, 13:29, 16:09, 10:32, 12:26. Not descending. `recent_sales` comes back ordered by `id DESC` while the column shows `created_at`.

Two fixes: filter the panel to the business date (or retitle it "Recent bills" and show the date), and order by `created_at DESC`.

### S2-09 Dashboard and Z-report show contradictory figures with no guard

Observed together on one screen:

- `BILLS TODAY: 11` next to `TILL REGISTER STATUS: Closed`
- `GROSS MARGIN TODAY: Rs 100,005 / 99.95% on cost of Rs 55`
- `REVENUE TODAY: Rs 100,045` with `Opening Float: no till`

A 99.95% margin day, and a day with sales but no till, are both impossible in normal operation. Neither raises anything.

Add sanity assertions that surface on the dashboard and at the top of the Z-report: margin outside a configured band, any sale outside a till session, any single bill more than N times the trailing median, same SKU sold at materially different prices on one day.

### S2-10 The "RECONCILED" badge in Reports does not mean reconciled

The Revenue Breakdown table shows `2026-09-14 ... Rs 100,045 collected ... AUDIT STATUS: RECONCILED`, in a panel subtitled *"Audited register entries with verified receipt numbers and counter reconciliation"*.

Actual cash reconciled through a till that day: Rs 5,010. The badge appears to mean "collected equals net, nothing on the credit ledger". It says nothing about the drawer.

A report that prints the word RECONCILED next to an unreconciled figure is worse than one that prints nothing. Rename to `SETTLED` / `ON LEDGER`, and add a separate `TILL` column driven by the actual day-close record: `Balanced`, `Variance Rs X`, or `Not counted`.

### S2-11 Serology status is displayed in plain text on a shared counter terminal

The Dialysis patient list renders `HBsAg positive` and `HCV positive` as coloured pills in a plain list, next to full name and mobile number, on a screen any staff member at the counter can open.

This is sensitive health data on a shared workstation. Clinical staff do need isolation information for machine assignment, but they need the operational fact, not a public list of infection status.

Suggested changes: gate the serology column behind a dialysis-unit permission; default to an operational flag (`Isolation: dedicated machine / Bay B`) with the underlying result revealed on explicit click; log every reveal to the audit trail; drop it from any exported or printed list unless the user has the permission.

### S2-12 No login rate limiting, and failed logins are not audited

Eight wrong passwords against `/api/auth/login` in **548 ms**. All returned `401`. No delay, no lockout, no captcha, no counter.

Separately, `/api/reports/audit` logged `auth.login` **98** times before three deliberate failures and **98** after. Only successful logins are recorded.

So an attacker on the LAN can brute-force counter accounts at full speed and leave no trace. Pharmacy staff accounts often use short PINs, which makes this practical.

Fix: exponential backoff per username and per IP, lockout after N failures with an admin unlock, and an `auth.login_failed` audit action carrying username and IP.

Related: the JWT lives in `localStorage` (`hms_token`), 12h expiry, no `jti`, so it cannot be revoked and any XSS exfiltrates a working session token. An httpOnly SameSite cookie plus a server-side session table would be stronger, and would give you real "sign out everywhere".

### S2-13 DRAP compliance status contradicts itself between modules

Dashboard, LOW-STOCK ITEMS card: **"DRAP Formulary Stock Compliant"**.

Inventory, same data: **"11 COMPLIANCE GAPS"**, **"DRAP REGULATORY GAP: 09 missing reg."**, with `MISSING` badges on Amoxicillin, Metformin, Omeprazole, Paracetamol and others. `drap_reg_no` is null on those records.

The dashboard is the screen a manager glances at. It is telling them the opposite of the truth. Drive that card from the same query as the Inventory gap count, and make it read `9 medicines missing DRAP reg.` when the count is non-zero.

### S2-14 Printed slips carry no pharmacy licence number, address or contact

`/api/settings` returns:

```json
"pharmacy_license_no": "", "pharmacy_address": "", "pharmacy_contact": ""
```

The footer confirms it: `Licence not recorded`. The printed slip I generated shows only the pharmacy name, the bill number, the lines and the totals.

A retail pharmacy invoice in Pakistan is generally expected to carry the pharmacy name and address, the drug sale licence number, and where registered the NTN/STRN. Confirm the exact current requirements with the pharmacy's compliance contact before finalising the slip layout. Same for the Z-report and the controlled drug register sheet.

Fix: make these fields mandatory in setup, block printing until they are filled, and put them in the slip and audit-sheet headers. Also worth adding: the dispensing pharmacist's name and registration number on the slip for Rx items.

---

## S3 MEDIUM

### S3-15 No idempotency on sale. Duplicate bills under retry or double-click.
Three identical concurrent `POST /api/pharmacy/sale` calls produced `INV-202609-00031`, `00032`, `00033`. Three bills, stock deducted three times. On a flaky LAN a retry after a slow response silently duplicates a sale. Fix: client sends a UUID `idempotency_key`; server returns the existing bill for a repeated key. (Bill number generation itself is race-safe, numbers came out sequential.)

### S3-16 Z-report "ITEMS SOLD" splits one product into several rows
The sheet showed `Panadol — 1 unit ... 4 ... Rs 20` and `Panadol — 2 unit ... 2 ... Rs 10` as separate lines.

Root cause: the bill line `description` is built as `"<name> — <qty> <uom>"` (confirmed on `GET /api/returns/bill/INV-202609-00028`), and the report groups by description. Group by `product_id` and render the name separately. Same defect makes the return slip read `Panadol — 2 unit × 2`, which looks like 4 units.

### S3-17 Day close accepts a negative drawer count, and the counted total is hand-overridable
Typing `-9999` into "PKR 20 / 10 & coins" produced `Actual counted physical cash: Rs -4999` and `Cash variance: Short by Rs 10,009`. The handover panel still suggested retaining a Rs 5,000 float from a negative drawer.

Set `min=0` on every denomination input. Make "Actual counted physical cash" read-only and derived from the denomination rows, otherwise the denomination count is theatre.

### S3-18 Near-expiry threshold is labelled 30 days but is actually 90
UI: `NEAR-EXPIRY WATCH (≤30 DAYS)` and `EXPIRY WATCH (≤30 D)`. Settings: `near_expiry_days: 90`. `/api/inventory/alerts` returns `"near_expiry_days": 90`. Both current batches happen to be inside 30 days, so the mismatch is invisible today and will mislead the moment a 60-day batch appears. Render the label from the setting.

### S3-19 Hotkey badge in the sidebar is wrong
The sidebar shows `F2` beside "Pharmacy Counter". Pressing **F2** on the dashboard does nothing. Pressing **F1** opens the Pharmacy Counter, which matches the dashboard tile. Inside the POS, **F2** means "Search". So one key label points at three different things depending on where you look. Fix the badge to F1 and keep a single global map.

### S3-20 Return reason is not required
Processed `RET-00003` with the reason field empty. Seed data contains a return whose reason is literally `"reason"`. For a pharmacy return register the reason is the whole point. Make it required, and offer a picklist (wrong item, wrong strength, patient reaction, duplicate purchase, damaged, expired, other + free text).

### S3-21 Cash tendered is never captured, but the slip prints a cash figure anyway
The sale payload contains no tendered amount. I completed a Rs 6 sale with the CASH TENDERED box empty and "STILL DUE Rs 6" showing in red, and the printed slip read `Cash received Rs 6, Change returned Rs 0`. The server assumes exact tender.

The receipt is asserting something the cashier never entered. Either require tender ≥ net for cash payments, or stop printing a tender line you do not have. The change-calculation UI (Exact / 50 / 100 / 500 / 1,000 / 5,000) is good and should be mandatory rather than optional.

### S3-22 The counter RATE field is freely editable with no permission or audit
Every basket line exposes an editable rate box. Combined with S1-02 there is no ceiling, no permission check, and no audit entry recording that a price was overridden. Gate it behind `pharmacy.override_price`, cap it, and log old → new with the operator.

### S3-23 GST is configured at 18% and never applied
`gst_pct: 0.18` in settings, `tax_pct: 0` on every product, no tax line on any bill or slip. Most medicines are exempt, so zero is often right, but general/OTC items are not. Either implement per-product tax and print a tax line, or remove the setting so it does not read as implemented.

### S3-24 Unknown `/api/*` routes return an Express HTML error page
`GET /api/inventory/batches` returns `<!DOCTYPE html>...<pre>Cannot GET /api/inventory/batches</pre>` with `Content-Type: text/html`. Any client doing `res.json()` throws. Add a JSON 404 handler scoped to `/api` and a generic error handler that never leaks stack traces or framework identity.

### S3-25 Reversed date range returns an empty report with no explanation
`from=2026-09-14&to=2026-09-01` → `200 []`. The UI renders a blank report and the user assumes there were no sales. Validate and show "To date is before From date".

### S3-26 Native `confirm()` dialogs in the shift-close flow
Closing the shift raised a browser-native confirm. It breaks the visual language of the rest of the app, cannot carry context (expected vs counted vs variance), and cannot be styled for a touch terminal. Replace with an app modal that restates the numbers being committed.

### S3-27 Reports omit zero days instead of showing them
The Revenue Breakdown for 2026-09-01 → 2026-09-14 lists 11 rows and silently skips the 11th, 12th and 13th. A reader cannot tell "no trading" from "data missing". Emit zero rows across the range.

---

## S4 LOW / POLISH

### S4-28 Text truncation is systemic
Every page heading and every KPI subtitle uses Tailwind `truncate` (`white-space: nowrap; text-overflow: ellipsis`) inside a fixed-width box. Measured overflow on the Vendors page alone:

| Text | Clipped by |
|---|---|
| "tax, licence and bank details not held — pending" | 187px |
| "paid ahead of goods — offsets the next GRN" | 77px |
| "0 accounts with a balance due" | 10px |
| "Suppliers, Vendors & Procurement" (h1) | 6px |

Result: `Management Dash…`, `Inventory, Batches & DRAP Comp…`, `Customer Returns & Refund A…`, `Cash Flow, Float & Till Sessi…`, `ACTIVE TILL STATUS: No till…`, `BILL UNDER REVIEW: INV-2026…`. On the Cash Flow page the active till card rendered as `Count…` which is not even a word.

Fix: `line-clamp-2` with normal wrapping on subtitles, let h1 wrap or shorten the page titles. Titles like "Inventory, Batches & DRAP Compliance" are doing a subtitle's job; make them two lines by design.

### S4-29 Currency formatting is inconsistent
`Rs 2,848.5`, `Rs 155,277.5`, `Rs 166,083.5`, `Rs 8,847.2` appear with one decimal, elsewhere with two or none. Route every money value through one formatter at 2dp with thousands separators.

### S4-30 POS autocomplete dropdown is too narrow and the typed text is invisible
Typing "Paracetamol" into the scan field: the field kept showing its `SCANNER READY` state and the text was not visible. The results dropdown rendered about 160px wide, unaligned with the input, with a horizontal scrollbar, overlapping the billing-mode row beneath it. On a counter where speed is everything this is the highest-traffic control in the product. Match the dropdown to the input width, show the typed query, no horizontal scroll.

### S4-31 POS toolbar and scan field are not sticky
Scrolling down to the payment panel pushes the scan input off screen. The scan field should be pinned and auto-refocused after every line, so a barcode gun always lands somewhere useful.

### S4-32 Last sidebar item is clipped behind the user card
On the Vendors page the active "Vendors" item rendered half-hidden behind the "System Administrator" panel. The scroll container does not reserve space for the fixed footer block. Add bottom padding equal to the footer height.

### S4-33 Six of seven form inputs have no programmatic label
On the POS page: no `<label for>`, no `aria-label`, no wrapping label on the scan field, the customer lookup, name, phone, quantity and rate inputs. Placeholder text is not a label. Screen readers and voice input announce nothing.

### S4-34 Five WCAG AA contrast failures, and body type is small
| Element | Ratio | Needs |
|---|---|---|
| `SCANNER READY` (POS input state) | 3.86:1 | 4.5:1 |
| Breadcrumb links | 4.10:1 | 4.5:1 |
| Active nav item, white on blue | 4.10:1 | 4.5:1 |
| `Billing mode:` label | 4.34:1 | 4.5:1 |

Several labels sit at 10-11px. Counter screens are read at arm's length, often on cheap panels. Lift muted text to `slate-600` and raise the small-label floor to 12px.

### S4-35 Leading-zero counters read oddly
`00 slips`, `01 accounts`, `09 missing reg.`, `04 cards`, `02 batches`. The terminal aesthetic is nice but `00 items` reads like a formatting bug. Either keep it only for fixed-width numeric displays or drop it.

### S4-36 Footer till status is stale until navigation
After opening a till on the Cash Flow page the footer still read `No till open`. It only updated after navigating. Subscribe the status bar to the same state.

### S4-37 Bill number column wraps to three lines
On the dashboard register, `INV-DEMO-00358` renders as `INV-` / `DEMO-` / `00358`. Add `white-space: nowrap` and widen the column.

### S4-38 Hospital naming leaks through a pharmacy product
`<title>` is `HWT Hospital Management System` on every page. `/api/reports/dashboard` returns `patients_today`, `tokens_today`, `lab_pending: 4`. The permission set includes `token.manage`, `consult.manage`, `lab.view`, `lab.result`. The audit log carries `consultation.create`, `lab.collect`, `visit.create`.

Understandable given the shared codebase and `deployment_mode: "pharmacy"`, but the browser title is customer-visible and the field names will confuse whoever maintains this next. At minimum drive `<title>` from `pharmacy_name`.

### S4-39 No dark mode
No `prefers-color-scheme` rules in the stylesheet. Pharmacy counters run long evening shifts, often in low light. Worth having.

### S4-40 The audit log exists but is not reachable from the UI
`/api/reports/audit` returns a genuinely good trail: 26 distinct action types, with user, username, entity, entity id, JSON detail, IP and timestamp. It is not in the navigation and not in the "More reports" dropdown. Surface it.

---

## What is already good

Worth saying, because it is a lot.

- **Day-End Close & Z-Report.** Denomination-by-denomination drawer count, expected vs counted vs variance, controlled drug register section, suggested safe drop and retained float, signature blocks for pharmacist and cash verifier, "the day in one line" strip, and any past date re-printable. This is better than most commercial Pakistani pharmacy packages.
- **Rx enforcement.** Server-side, with a clear error code and the offending product named. The one validation that was done properly, and it is the template for the rest.
- **Stock validation.** Overselling (`Insufficient non-expired stock`), fractional quantities (`Invalid quantity for Panadol`) and negative quantities are all correctly rejected.
- **Audit trail.** Real, broad, with IP addresses.
- **Pack-aware inventory.** `4 box + 5 strip + 1 tablet` with per-unit, per-strip and per-box pricing and a loose-sale flag is exactly right for Pakistan.
- **DRAP awareness.** Drug schedules, formulary compliance panel, missing-registration tracking, near-expiry distributor claim tracking (`2 claimable from distributors`).
- **Welfare and Zakat modelling.** Subsidy funds, welfare cards and tiers, staff allowance caps, department internal transfer at cost with no counter margin.
- **Print engineering.** 15 media queries including `@media print and (max-width: 100mm)` for 80mm thermal, plus an A4 path.
- **Keyboard-first design.** Hotkey launchpads, F-key toolbar, `Ctrl+F` search, `Esc` to clear. The right instinct for a counter.
- **Polling is well behaved.** Measured 2 requests in 20 seconds (health plus till status). No problem here.
- **Auth boundary.** No token and bad token both return `401` cleanly on every endpoint tested. Granular permission model already in place.

---

## Design recommendations

### 1. Fix the truncation problem properly, do not just widen boxes
The pattern across every module is a long descriptive title plus a long descriptive subtitle crammed into a fixed card. The copy is good. The container is wrong. Let subtitles wrap to two lines, and split page titles into a real heading plus a supporting line instead of one 40-character string that always clips.

### 2. Give the counter screen a dedicated layout
The POS currently shares the standard shell: sidebar, breadcrumb, KPI-style chrome. At a live counter the operator needs the scan field, the basket and the total, and almost nothing else. Consider a focused mode that collapses the sidebar, pins the scan bar to the top, pins the total to the bottom, and enlarges the basket rows. Bind it to a key.

### 3. Make status contradictions impossible to ignore
Right now the app shows `BILLS TODAY: 11` and `TILL: Closed` side by side, calmly. Any state that should not coexist deserves a banner at the top of the dashboard, in the app's own visual language: "11 bills today were taken with no till session open. Cash cannot be reconciled."

### 4. One number, one source
Expiry threshold, DRAP compliance and reconciliation status each render differently in different modules because each screen computes its own. Pull them into shared selectors so the dashboard cannot disagree with the module it summarises.

### 5. Typography and density
The 10-11px muted labels are too small for counter hardware. Raise the floor to 12px, lift muted text contrast, and reduce table row height in the dispensing register so more bills fit without scrolling.

### 6. Replace native dialogs
Every confirm step should be an app modal that restates the figures being committed, especially shift close and any refund.

---

## Feature recommendations

Ordered by what I think is worth most to this pharmacy.

### Tier 1: close the control gaps
1. **Supervisor override flow.** A single reusable modal that takes a second user's credentials and writes an audit entry. Wire it to price overrides, refunds above threshold, force-closing a till, reopening a closed day, and releasing quarantined stock. This one component fixes several S1 items at once.
2. **Immutable day close.** Snapshot and hash the Z-report at close; lock the date; require an audited reopen.
3. **Exception dashboard.** A single screen listing everything that needs a human: sales outside a till, margin outliers, price overrides, refunds above threshold, till variances above a tolerance, negative or zero-price lines, batches with no expiry, stale open sessions. Right now all of this is discoverable only by reading raw data.
4. **Audit log in the UI.** Filter by user, action, date, entity. It already exists in the API.

### Tier 2: pharmacy operations
5. **Purchase orders and GRN matching.** Vendors shows payables and advances but there is no PO → GRN → invoice three-way match. Receiving against a PO is where most pharmacy leakage happens.
6. **Expiry claim workflow.** The near-expiry card already says "2 claimable from distributors". Turn that into a tracked process: mark claimable, generate a distributor claim note, record credit received, reconcile against payables.
7. **Automatic reorder suggestions.** Reorder levels exist but are static. Compute suggested order quantity from consumption velocity, lead time and pack size, then produce a per-vendor draft order.
8. **Batch recall.** Search a batch number, list every bill and customer it went to, print recall notices. You already hold the data.
9. **Substitute and generic suggestions.** When a product is out of stock at the counter, surface same-molecule alternatives with stock and price. Direct revenue and a real time-saver.
10. **Drug interaction and allergy warnings.** Even a basic check against the customer file on Rx dispensing would set this apart in this market.

### Tier 3: revenue and customer
11. **Refill reminders.** You have customer files, purchase history and chronic-medication patterns. An SMS or WhatsApp reminder a few days before a chronic patient runs out is the highest-ROI feature on this list for a Pakistani retail pharmacy.
12. **Receivables ageing.** Credit Accounts shows balances but no 30/60/90 buckets, no statements, no reminders. Rs 10,360 is outstanding across 5 accounts with no ageing view.
13. **Credit limit enforcement at the counter.** Tariq Mehmood sits at Rs 4,480 against a Rs 3,000 limit. The screen says "no more credit until settled". Make the POS enforce it, with a supervisor override. Also reconsider allowing unlimited-credit accounts (Saira Bano has "no limit").
14. **Loyalty or welfare tier automation.** The welfare card and tier infrastructure is built. Auto-promote based on spend or verified need rather than manual assignment.

### Tier 4: platform
15. **Backup status in the footer.** For an offline-first LAN SQLite deployment, "last backup: 14 Sept 11:40, verified" belongs next to the WAL indicator. There is a `sync.run` audit action but no visible sync or backup state. This is the single highest-impact operational addition: a pharmacy that loses its SQLite file loses everything.
16. **Multi-counter support.** The data model has `counter` but the UI assumes Counter 1. Named terminals, per-counter Z-reports, consolidated day close.
17. **Urdu interface option.** Counter staff literacy in English varies. Even partial Urdu labelling on the POS would widen who can be hired.
18. **Offline queue on the client.** If the LAN master goes down mid-shift the counter currently stops. Queuing sales locally and replaying them on reconnect matches the offline-first intent (needs the idempotency key from S3-15 to be safe).
19. **WhatsApp receipts.** Cheaper than paper, and it gives you a customer contact record.

---

## Test data to clean up

My testing wrote real records. Recommend reseeding rather than deleting by hand.

| Type | Range | Note |
|---|---|---|
| Bills | `INV-202609-00020` → `INV-202609-00033` | 14 bills, Rs 100,060 gross, all on business day 2026-09-14 |
| Returns | `RET-00003` → `RET-00006` | Rs 10,270 refunded |
| Till session | `SES-18` | Opened and closed 14 Sept, balanced |
| Phantom stock | Panadol (id 23) batches `RET-00003/4/5` | 54 units, null expiry, Rs 0 cost |
| Customers on bills | `QA-BOT`, `QA-AFTER-CLOSE`, `QA-FEFO`, `QA-IDEMPOTENCY` | walk-in names only, no customer records created |

Pre-existing issue, not mine: till session id 2, opened 7 Jul 2026 by "Cashier", still open.

---

## Suggested fix order

**Before any live counter use**
S1-02 (server-side pricing + `enforce_mrp`) → S1-01 (returns validation) → S1-03 (require open till for cash) → S1-04 (lock closed days) → S1-05 (return batching and quarantine)

**Before handover**
S2-06, S2-07, S2-12, S2-14, S3-15, S3-17, S3-22

**Next iteration**
S2-08, S2-09, S2-10, S2-13, S3-16, S3-18, S3-19, S3-20, S3-21

**Polish pass**
S4-28 and S4-29 first, they affect every screen. Then the rest.

**Separate track**
S2-11 (serology visibility) needs a decision from the hospital, not just a code change.
