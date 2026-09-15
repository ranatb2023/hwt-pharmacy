# QA remediation — report of 2026-09-14

| | |
|---|---|
| **Source** | `HWT-Pharmacy-Portal-QA-Report-2026-09-14.md` (40 findings: 5 S1, 9 S2, 13 S3, 13 S4) |
| **Proof** | `scratchpad/qa-server-test.js` — 63 checks, every server-side finding reproduced against the old behaviour in the report and proved closed; runs on a throwaway copy of the live DB (`qa-run.js`). Screens checked in headless Chrome as administrator and as pharmacist, no console errors. |
| **Status** | 37 closed, 3 partly closed (said below), 0 open |

## What changes for the counter — read this first

These are behaviour changes, not just fixes. Staff will notice them on the first shift after the server restart.

1. **A cash sale needs an open till.** With no till session the POS refuses with `TILL_NOT_OPEN` and points at Cash Flow. Card and online sales never needed a drawer and still don't.
2. **Cash tendered must be entered.** The slip prints the tender and the change the server computed; the field is no longer optional.
3. **The rate box is the catalogue price.** Rounding down inside the counter-discount band still works; anything else needs the new `pharmacy.override_price` permission and is written to the audit log with the before and after. Above the DRAP MRP is refused for everyone, administrator included.
4. **Returns are checked against the bill.** Only what was sold, less what already came back, at the price on the bill, never more than was paid. A reason is required (picklist). Above `refund_auth_threshold` a **second person** with billing override signs with their own username and password. A cash refund needs an open till and is posted out of it.
5. **Returned medicine goes to quarantine**, under its original batch number, expiry and cost. A pharmacist releases it with a reason; returned cold-chain items cannot be released at all.
6. **The day can be closed.** On Day Close, once every till is counted, "Close the day" files the sheet (snapshot + SHA-256) and locks the date. Nothing more posts to it; an administrator reopens with a reason, audited, and every later print says REOPENED.
7. **One till per counter.** A second session on a counter that already has one is refused. Administrators can force-close an abandoned till from Cash Flow (no count, reason recorded).
8. **Five wrong passwords lock the account for fifteen minutes**, with a growing delay before that. Administrators unlock from Users.

## Findings, one by one

| # | Finding | Status | What was done |
|---|---|---|---|
| S1-01 | Returns accept any qty / price | **Closed** | `routes/returns.js` rewritten: product must be on the bill; sold − returned bounds the quantity; unit price is the bill line's; refund capped at paid less prior refunds; threshold needs a second user's credentials (`authorised_by` on the return); day must be open. |
| S1-02 | Sale trusts client price, `enforce_mrp` unused | **Closed** | Sale prices from the product; a client price is a request — inside the counter band it is a discount, otherwise `PRICE_OVERRIDE_REQUIRED` unless `pharmacy.override_price`; `ABOVE_MRP` hard for everyone; `INVALID_PRICE` for ≤ 0; overrides audited as `pharmacy.price_override`. |
| S1-03 | Sales with no till | **Closed** | `TILL_NOT_OPEN` (409) on cash sales; the bill records `cash_session_id`; the Z-report carries `cash_check` (cash on bills vs cash into tills) and prints a red band when they differ. |
| S1-04 | Closed day still accepts sales | **Closed** | `day_closes` table; `POST /pharmacy/day-close/close` snapshots + hashes; `GET` returns the snapshot for a closed day; `assertDayOpen()` in `guards.js` blocks sales, returns, receipts, adjustments, GRNs, till open/movements, dispenses and corrections with `DAY_CLOSED`; reopen is `day.reopen`/admin with a reason, audited, shown on every print. |
| S1-05 | Returns create undated, costless batches | **Closed** (see note) | Returns credit a quarantined copy of the ORIGINAL batch (same batch no, expiry, cost, MRP, vendor; `origin='return'`, `origin_batch_id`); release needs a reason, never cold chain; two DB triggers refuse any saleable medicine batch without an expiry. *Note:* the batch is found through the stock-movement ledger the sale already writes (`reference = bill_no`, `batch_id`), which is the same fact the report asked to store on the bill line. |
| S2-06 | Refunds never post to the till | **Closed** | `postCashOut()`; a cash refund posts `out / refund` with the return number; a bill on account is credited on the ledger instead. |
| S2-07 | Orphan till, per-user sessions | **Closed** | One open session per counter (`COUNTER_IN_USE`); `GET /cashflow/open`; `POST /cashflow/:id/force-close` (admin, reason, audited, `force_closed`); stale (> 24 h) sessions flagged on Cash Flow, the dashboard and the Z-report. |
| S2-08 | "Today's register" shows old bills | **Closed** | `recent_sales` filtered to the business date, ordered by `created_at DESC`. |
| S2-09 | Contradictory figures, no guard | **Closed** | `sanityAlerts()`: sales outside a till, margin outside 0–60 %, bill > 5 × trailing median, one SKU at prices > 20 % apart, stale till, undated saleable batches. Banners on both dashboards and bands at the top of the Z-report. |
| S2-10 | "RECONCILED" badge is not reconciliation | **Closed** | Revenue by day: `SETTLED / ON LEDGER / NO TRADING` plus a **Till** column from that day's sessions (Balanced / Variance Rs X / Not counted / Till open / No till) and the day-close lock state. |
| S2-11 | Serology in plain text | **Closed** | Lists and records carry only `isolation` (dedicated / standard / unknown); results need `dialysis.serology` and an explicit, audited reveal (`dialysis.serology_reveal`); edits by anyone else leave the results untouched; nothing revealed prints. |
| S2-12 | No login rate limit, failures unaudited | **Closed** (cookie note) | `login_attempts`; backoff 250 ms → 8 s; lock after 5 failures for 15 min (`ACCOUNT_LOCKED` 423); `auth.login_failed`, `auth.lockout`, `auth.login_blocked`, `auth.unlock` audited; Unlock on the Users screen. *Not done:* moving the JWT from localStorage to an httpOnly cookie with a server session table — a separate change to the auth model, listed under deferred. |
| S2-13 | DRAP status contradicts itself | **Closed** | `/reports/dashboard` carries the same `complianceGaps()` the Inventory screen uses; the dashboard card says "N DRAP record gaps". |
| S2-14 | Slips carry no licence / address | **Closed** (see note) | Slip, return slip and Z-report print address, contact and licence when set; "Dispensed by" on the slip; Settings marks the three fields required with a red notice; the POS receipt shows an amber warning while the licence is missing. *Not done as written:* printing is not BLOCKED when they are empty — that would stop the live counter today. The fields are blank on the live system; the client fills them in. |
| S3-15 | No idempotency on sale | **Closed** | `idempotency_key` (unique, partial index) — a repeated key returns the existing bill (200, `duplicate: true`), including under a race; the POS sends one key per attempt. |
| S3-16 | Z-report splits one product | **Closed** | Items sold grouped by `product_id`, named from the product, with bills and unit; the return slip prints the product name. |
| S3-17 | Negative drawer count | **Closed** | Denomination inputs clamp ≥ 0; the counted total is read-only and derived from the notes; the server refuses a negative count (`NEGATIVE_COUNT`). |
| S3-18 | Near-expiry label says 30, setting is 90 | **Closed** | Labels read the setting; the dashboard card shows the window's own bucket. |
| S3-19 | Sidebar badge F2 vs F1 | **Closed** | Badge is F1. |
| S3-20 | Return reason optional | **Closed** | Required; picklist (wrong item, wrong strength, patient reaction, duplicate purchase, damaged, expired, unused course, other + text). |
| S3-21 | Tender never captured | **Closed** | `TENDER_REQUIRED` / `TENDER_SHORT`; `bills.tendered`, `bills.change_given`; the slip prints only what was recorded. |
| S3-22 | Rate field free | **Closed** | Disabled without `pharmacy.override_price`; server audits every override (S1-02). |
| S3-23 | GST configured, never applied | **Closed** | `gst_pct` removed from the settings (MRP is tax-inclusive); `products.tax_pct` stays in the schema for the day general goods are taxed. |
| S3-24 | HTML 404 on `/api` | **Closed** | JSON 404 with `code: NOT_FOUND`; `x-powered-by` off; 5xx never leak a message or stack. |
| S3-25 | Reversed date range | **Closed** | `RANGE_REVERSED` (400) on every ranged report; the Revenue screen says it before asking. |
| S3-26 | Native confirm dialogs | **Closed** | `ConfirmDialog` / `useConfirm` in `ui.jsx`; shift close restates expected / counted / variance; quarantine-all and discard-parked use it too. |
| S3-27 | Reports omit zero days | **Closed** | Revenue by day emits every calendar day in the range (capped at a year). |
| S4-28 | Truncation everywhere | **Closed** | Page titles wrap; tile subtitles `line-clamp-2`; tile values wrap. |
| S4-29 | Currency formatting | **Closed** | `money()` is 2 dp with separators everywhere. |
| S4-30 | POS autocomplete narrow | **Closed** | Dropdown is the input's width, no horizontal scroll, higher z-index; the badge shows the match count while typing. |
| S4-31 | Toolbar not sticky | **Closed** | Toolbar sticks to the top of the scroll area; the scan field is refocused after every pick and every sale. |
| S4-32 | Sidebar last item clipped | **Closed** | The nav is the flex item that scrolls, with bottom padding. |
| S4-33 | Inputs without labels | **Closed** | `aria-label` / `htmlFor` on the scan, lookup, name, phone, quantity, rate, tender, count and return inputs. |
| S4-34 | Contrast, 10 px labels | **Closed** | 12 px floor for 9/10/11 px text in both frames; muted text one step darker; breadcrumb and active nav on `#0369a1`; the scanner badge darker. |
| S4-35 | Leading-zero counters | **Closed** | Removed from every KPI tile. |
| S4-36 | Footer till status stale | **Closed** | `hwt:till` event after open / close / movement / refund; both frames re-read at once. |
| S4-37 | Bill number wraps | **Closed** | `whitespace-nowrap`. |
| S4-38 | Hospital naming leaks | **Closed** (title) | `<title>` and `document.title` are the pharmacy's name. The hospital-module field names in the API stay — they are the on-hold Phase 2 and are documented as such. |
| S4-39 | No dark mode | **Partly** | A first cut: with the OS in dark mode the screen is inverted and hue-rotated; images, slips and the Z-report are inverted back; print untouched. A token-based theme is a later pass. |
| S4-40 | Audit log unreachable | **Closed** | It was under Administration › Audit Log; now also in the reports' "More reports…" picker. |

## Deferred, and why

- **S2-12 (second half):** httpOnly cookie session + server-side session table + `jti` revocation. A change to the auth model touching every client; scheduled separately.
- **S4-39:** a real dark theme (tokens, not a filter).
- **Design recommendation 2** (a dedicated counter layout) and the feature tiers are product decisions, not defects; not in this pass.

## The test data the tester wrote

Left in place, as the report recommends reseeding over hand deletion, and nothing is ever deleted from the live database without the client's word. The bills `INV-202609-00020 → 00033`, returns `RET-00003 → 00006`, session `SES-18` and the three undated Panadol batches are all on business day 2026-09-14; the undated batches now show as a red alert on the dashboard until they are quarantined and written off.

## Operations

- **Restart the server on port 4000** — the schema migration (new tables, columns, triggers) runs on start and is additive.
- The three pharmacy-information settings are required before slips are complete.
- The new permissions: `pharmacy.override_price`, `dialysis.serology` (Doctor and Administrator hold it), `day.reopen` (Administrator).
