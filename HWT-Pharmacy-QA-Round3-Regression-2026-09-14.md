# QA Report: Hope Welfare Trust Pharmacy Portal (Round 3)

| | |
|---|---|
| **Build** | v0.1.0, rebuilt since Round 2 |
| **Target** | `http://localhost:4000` |
| **Business day** | 2026-09-14 |
| **Role tested** | Pharmacist (`pharmacy`, user id 5, 11 permissions) |
| **Scope** | Fresh audit of the redesigned build, plus regression against the 74 findings from Rounds 1 and 2 |
| **Method** | Live UI walkthrough plus direct API exploitation with a valid Pharmacist token |

---

## Verdict

This is a different product from the one I tested two rounds ago.

Every one of the five critical defects is closed. Not patched around: closed properly, with named error codes, messages that tell the operator what to do, and in several cases a better design than the one I suggested. The day-end sheet is now content-hashed and reprints from its snapshot. Returns credit back to their original batch and land in quarantine. Cash sales refuse to complete without an open till, while card and online sales correctly proceed without one. The account locks after five failed sign-ins and returns HTTP 423 with a retry time.

The Z-report now opens with its own exception banner:

> **CASH DOES NOT TIE.** Cash taken on bills: Rs 18,170.00. Cash that reached a till: Rs 6,120.00. Unaccounted: Rs 12,050.00.
> 6 cash bills totalling Rs 12,050.00 were taken with no till session open. That cash is in no drawer ledger and cannot be reconciled. Cash sales now refuse to complete without an open till.
> 5 bills today are more than five times the trailing median of Rs 218.00.

That is the exception dashboard from the Round 1 feature list, built into the artefact where it matters most.

The interface caught up too. The scan field went from 12 visible pixels to 1090. The basket table went from 137px of overflow and 179px rows to zero overflow and 60px rows, with the medicine name now the widest column instead of the narrowest. The 23-item sidebar became eight keyboard-addressable tabs. The type scale dropped from 21 sizes to 12 integers.

**What is left is mostly a tier down.** Three things are worth doing before this goes live: sales still have no idempotency key, so a double-click or a LAN retry duplicates a bill; a reconnect after a network blip does not refetch, leaving the pharmacist on an empty screen with a green "connected" light; and the offline empty-state copy still asserts things it cannot know.

**Recommendation: this is close to counter-ready.** The three items above, then ship.

### Counts

| | Round 1+2 | Round 3 |
|---|---|---|
| Critical | 5 | **0** |
| High | 9 | 2 |
| Medium | 13 | 6 |
| Low / polish | 13 | 9 |
| Journey / UI (Round 2) | 34 | folded into the above |
| **Open total** | **74** | **17** |

Of the 74 prior findings: **41 verified fixed**, 8 still open, 25 not re-testable this round (Pharmacist role has no access, or the module is no longer in this role's navigation).

---

## Critical items: all five closed

Each was re-run as the original repro.

### S1-01 Returns accepted any quantity and any price → **FIXED**

Four separate guards now, where there were none:

```
over-return 50 of 1  → 400 RETURN_EXCEEDS_SOLD
   "Only 1 roll(s) of Bandage Roll can still come back on INV-202609-00001
    (1 sold, 0 already returned)."

second return        → 400 RETURN_EXCEEDS_SOLD  (already_returned: 1)

foreign product      → 400 NOT_ON_BILL
   "Product 16 is not on bill INV-202609-00001."

Rs 6,000 refund      → 403 AUTH_REQUIRED
   "A refund above Rs 5000 needs a second person with billing
    override to authorise it."   threshold: 5000
```

Client-supplied price is now ignored outright. I sent `unit_price: 9999` on a line sold at Rs 40 and the refund came back **Rs 40**.

`refund_auth_threshold` was a setting that did nothing in Round 1. It is now enforced, and enforced as a *second person*, which is the supervisor-override pattern rather than a self-approval.

### S1-02 Sale trusted the client's price, `enforce_mrp` did nothing → **FIXED**

| Test | Sent | Result |
|---|---|---|
| Free dispense | `unit_price: 0` | `400 INVALID_PRICE` |
| Negative | `unit_price: -50` | `400 INVALID_PRICE` |
| Far above MRP | `99999` (MRP 45) | `400 ABOVE_MRP`, `mrp: 45` |
| One rupee above MRP | `46` | `400 ABOVE_MRP` |
| Deep discount | `1` (catalogue 40) | `403 PRICE_OVERRIDE_REQUIRED` |
| At the 10% counter cap | `36` | passes the price check |
| One paisa past the cap | `35.99` | `403 PRICE_OVERRIDE_REQUIRED` |

The boundary is exact. `counter_discount_pct: 0.1` is honoured to the paisa.

The zero-price message is worth quoting because it teaches rather than blocks:

> "Bandage Roll cannot be sold at Rs 0. A free or subsidised line comes from the customer's card or category, not from the price."

### S1-03 Cash sales completed with no till open → **FIXED**

```
cash, no till    → 409 TILL_NOT_OPEN
   "No till is open for you. Cash is taken into an open till session —
    open one in Cash Flow before the first cash sale."

card, no till    → 201  (correct)
online, no till  → 201  (correct)
```

Card and online correctly bypass the till check, which is the distinction I recommended. Refunds got the same guard, with refund-specific wording.

### S1-04 Closed days still accepted postings → **FIXED**

Closing the day now presents an app modal, not a browser confirm:

> **Close 2026-09-14 and file the sheet?**
> 14 bills, net Rs 20,308.00, cash Rs 18,170.00.
> The figures are snapshotted and hashed. Nothing more can be posted to this date unless an administrator reopens it.

After closing, the day-close record carries a real content hash and `from_snapshot: true`:

```json
{"status":"closed","closed_at":"2026-09-14 10:06:11","closed_by":"Pharmacist",
 "hash":"a7669b54c645d3257bab34905fa97255c046f821e79ccff0368049149473413b",
 "reopened_at":null,"reopened_by":null,"reopen_reason":null,"reclosed_at":null}
```

Every write to the locked date is refused:

```
sale (card)   → 409 DAY_CLOSED
return        → 409 DAY_CLOSED
open a till   → 409 DAY_CLOSED
```

The audited reopen path exists in the schema (`reopen_reason`, `reclosed_at`) but needs an administrator, so I could not exercise it as Pharmacist.

### S1-05 Returns restocked with null expiry and zero cost → **FIXED**

The return response now reports where the stock went:

```json
"quarantined":[{"batch_id":27,"batch_no":"B-1007","expiry_date":"2029-09-14",
                "quantity":1,"product":"Bandage Roll"}],
"session_id":15
```

Batch listing afterwards:

| Batch | Expiry | Qty | Quarantined |
|---|---|---|---|
| B-1007 | 2029-09-14 | 28 | 0 |
| B-1007 | 2029-09-14 | 1 | **1** |

The unit went back to its own batch with its real expiry and was held off the shelf. No more `RET-000xx` phantom batches with `expiry_date: null` and `cost_price: 0`.

Confirmed the quarantine actually bites: selling 29 rolls (28 saleable plus 1 quarantined) returns `400 Insufficient non-expired stock`.

---

## High

### H1. Sales still have no idempotency key *(carried from S3-15)*

Three identical concurrent `POST /api/pharmacy/sale` calls:

```
201 INV-202609-00004
201 INV-202609-00005
201 INV-202609-00006
```

Three bills, stock deducted three times. This is now the most likely way to corrupt a day that is otherwise well protected: a double-click on a slow LAN, or a client retry after a timeout, and the Z-report carries a phantom sale that all the new guards will happily certify.

Fix: client generates a UUID per basket and sends it as `idempotency_key`. Server returns the existing bill for a key it has already seen. The day-close hash makes this more important, not less, because a duplicate now gets sealed into an immutable snapshot.

### H2. Reconnecting does not refetch, and the error banner never clears

Reproduced by blocking `/api/*`, then restoring it.

While down, the new connection modal is excellent:

> **Cannot reach the pharmacy server**
> Nothing on this screen can be trusted until the connection returns — the figures are stale and nothing can be saved. Check the LAN cable and that the server machine is switched on, then tell the administrator.
> *Unreachable since 15:02 · retrying every 5 seconds*  [Retry now]

It is not dismissible by Escape and it blocks navigation, which is the right call for a cash terminal.

When the connection came back, the modal cleared and the header went green "Counter connected". But:

- **The page data never reloaded.** Inventory still read `Rs 0.00`, `All medicines (0)`, `Nothing in this view`, `0 batches inside the 90-day expiry window`
- **The red banner stayed**, reading "Cannot reach the pharmacy server. Check the LAN cable or the server machine, then press F5" over a green connection light
- Only a manual **Refresh** restored the data

So after a two-second LAN blip, a pharmacist is looking at an empty formulary, a green light, and a red banner that contradicts both. The retry loop restores the connection pill but does not re-run the screen's queries.

Fix: on the transition from unreachable to reachable, refetch the active screen and clear the banner. The banner should clear on any successful request, not on a manual dismiss.

---

## Medium

### M1. Offline empty states still assert facts they cannot know *(carried from Round 2, 9.2)*

Behind and around the connection modal, the underlying screen is unchanged from Round 2:

| Card | Value | Caption shown while the server is dead |
|---|---|---|
| Near-expiry watch | 0 batches | **"nothing inside the window"** |
| Stock-out / reorder | 0 items | **"all items above reorder level"** |
| DRAP regulatory gap | 0 missing | **"no medicine priced above MRP"** |
| Medicines list | (0) | **"Nothing in this view"** |

The modal covers the middle of the screen, so these cards stay fully readable around it. The modal is a curtain, not a fix. A pharmacist glancing past it reads "nothing inside the window" while two batches sit inside it, one at 60 days.

Fix: when the connection is down, metrics render `—` and empty-state captions swap to unknown-state text ("cannot check, server unreachable"). The Dashboard already does the `—` fallback for two of its cards, so the pattern exists in the codebase.

### M2. The tab bar overflows and hides Day Close

Measured: `nav.scrollWidth 1416` vs `clientWidth 1140`. **276px of overflow** at a 1150px viewport.

"Alt+7 Cash Flow" is cut mid-word and **"Alt+8 Day Close" is entirely off-screen** behind a thin horizontal scrollbar. Day Close is reachable from the header button, so it is not lost, but a keyboard-first design that hides two of its eight destinations at the default window size undercuts itself.

Options: shorter labels ("POS", "Requisitions", "Inventory", "Vendors", "Customers", "Returns", "Cash", "Day Close"), drop the `Alt+n` prefix into a tooltip, or wrap to two rows below 1280px.

### M3. Billing mode 1 is still a dead button *(carried from Round 2, 2.1)*

All three mode pills are enabled `<button>` elements with `cursor: pointer`. Modes 2 and 3 switch. Mode 1 does nothing, verified again with a programmatic click: computed backgrounds identical before and after, slip label unchanged at "Retail — walk-in".

Either switch to it and prompt for the card, or render it as a status chip that lights up when a customer is attached.

### M4. Pharmacy licence, address and contact are still empty *(carried from S2-14)*

```json
"pharmacy_license_no": "", "pharmacy_address": "", "pharmacy_contact": ""
```

Printed slips and the day-end sheet still carry only the pharmacy name. A retail pharmacy invoice in Pakistan is generally expected to show the licence number and address, and where registered the NTN/STRN. Worth confirming the current requirement with whoever handles the pharmacy's compliance, then making these mandatory in setup and blocking printing until they are filled.

This is now the only Round 1 High that is still fully open, and it is a data-entry gate rather than a code change.

### M5. Error message quality is inconsistent

The new errors are excellent. The old ones were not updated, and the gap is visible:

| Situation | Message | Code |
|---|---|---|
| Over-return | "Only 1 roll(s) of Bandage Roll can still come back on INV-202609-00001 (1 sold, 0 already returned)." | `RETURN_EXCEEDS_SOLD` |
| Above MRP | "Bandage Roll cannot be sold above its maximum retail price of Rs 45." | `ABOVE_MRP` |
| Not enough stock | **"Insufficient non-expired stock"** | *none* |
| Negative quantity | **"At least one item required"** | *none* |

"Insufficient non-expired stock" names no product, no available quantity, and does not mention that some of the stock is quarantined, which was the actual reason in my test. "At least one item required" for a negative quantity is simply wrong: the item is there, the quantity is not valid.

Bring these two up to the standard of the rest, with codes.

### M6. The Z-report bills table is not time-sorted

Observed order in BILLS (14): 08:02, 06:56, 08:02, 08:02, 08:02, 08:02, 08:02, 05:35, 09:59, 09:59, 10:00, 10:00, 10:00, 10:00.

Same class of defect as the dashboard register in Round 1 (S2-08), which was fixed there and not here. For a filed audit document the bill list should read chronologically.

---

## Low / polish

**P1. "Card 50%" is an ambiguous revenue category.** The ledger table lists `Card 50%` as a REVENUE CATEGORY with Rs 7,818 gross and Rs 3,909 discount, while PAYMENTS RECEIVED separately lists `CARD / POS TERMINAL Rs 2,098`. Two unrelated meanings of "card" on one sheet. Rename the welfare tier to something like "Welfare card (50%)".

**P2. Dark mode is a filter hack.** `@media (prefers-color-scheme: dark) { html { filter: invert(.92) hue-rotate(180deg) } }` with counter-inverts on images and receipts. It ships a dark theme without building one, but: semantic colours land wrong (a red "CASH DOES NOT TIE" banner will not read red after a 180° hue rotation), brand blue becomes orange, blacks come out washed at 0.92, and there is no toggle, so a terminal with a dark OS theme gets it whether the pharmacy wants it or not. Also note that `filter` on `html` creates a containing block and will break `position: fixed` if you later pin the POS toolbar, which I recommended in Round 2. The token layer (`--primary`, `--danger`, `--warn`, `--ok`) already exists; a real dark palette on those tokens would be a modest amount of work and would behave correctly.

**P3. Live clock fails contrast at 2.56:1.** The header timestamp at 11px. The version string is 3.75:1. Both below the 4.5:1 floor. Page-wide contrast is much improved otherwise, down from 5 failures to 2.

**P4. Form inputs still have no programmatic labels** *(carried from S4-33)*. No `<label for>`, no `aria-label`, no wrapping label. Placeholder text is not a label.

**P5. Pluralisation.** "RETURNS TODAY **1 slips**". Also "1 batches" on the inventory card.

**P6. Duplicated strength in product names.** The inventory table renders "Amoxil 500mg **500mg**", with the name field already containing the strength and the strength field appended in lighter type. Same pattern as "Panadol 1000mg" in Round 1.

**P7. Default quantity is still one full strip** *(carried from Round 2, 1.3)*. Adding Amoxil put 10 capsules in the basket. Less severe now that the UOM toggle only offers valid units ("full strips only" products correctly hide the loose option), but the default still deserves to be the first thing the eye lands on.

**P8. 91 hardcoded hex colours** remain in the stylesheet alongside the semantic token layer *(carried from D3)*. Radii improved from 25 distinct values to 17, still short of a clean set.

**P9. Numeral rendering is inconsistent between cards.** "STAFF ACCOUNTS 0" renders in a slashed monospace zero while "ACTIVE WELFARE CARDS 3" uses the proportional face. Pick one for KPI figures.

---

## Regression table

### Round 1, Critical

| ID | Finding | Status |
|---|---|---|
| S1-01 | Returns API accepts any quantity and price | **Fixed** |
| S1-02 | Sale trusts client `unit_price`, `enforce_mrp` inert | **Fixed** |
| S1-03 | Sales complete with no till open | **Fixed** |
| S1-04 | Closed day still accepts postings | **Fixed** |
| S1-05 | Returns restock with null expiry, zero cost | **Fixed** |

### Round 1, High

| ID | Finding | Status |
|---|---|---|
| S2-06 | Refunds never post to the till session | **Fixed** (`session_id` on the return; Cash Flow shows "out Rs 40.00") |
| S2-07 | Orphaned open till; per-user not per-counter | **Partly fixed** (second session blocked with `SESSION_OPEN`, but the message is per-user; `force_closed` and `closed_by` columns now exist, suggesting supervisor close was built. Could not verify cross-user as Pharmacist) |
| S2-08 | Dashboard register not sorted newest first | **Fixed on the dashboard**, still wrong in the Z-report bills table (see M6) |
| S2-09 | Dashboard and Z-report contradictions unflagged | **Fixed** (`SALES_OUTSIDE_TILL` and `BILL_OUTLIER` alerts on the sheet) |
| S2-10 | "RECONCILED" badge meant "no credit due" | **Not re-tested** (Reports not in the Pharmacist navigation) |
| S2-11 | Serology status shown in plain list | **Not re-testable** (`/api/dialysis/patients` → 403, correct RBAC) |
| S2-12 | No login rate limiting; failed logins unaudited | **Fixed** (lock after 5 attempts, 15 min, HTTP 423 with `retry_after`; 10 attempts took 8.25s vs 548ms before. Audit side not verifiable as Pharmacist) |
| S2-13 | DRAP compliance contradiction between modules | **Fixed** (verified Round 2) |
| S2-14 | Printed slip has no licence number or address | **Still open** (see M4) |

### Round 1, Medium

| ID | Finding | Status |
|---|---|---|
| S3-15 | No idempotency on sale | **Still open** (see H1) |
| S3-16 | Z-report ITEMS SOLD split one product into rows | **Fixed** (now grouped by product with a BILLS column) |
| S3-17 | Negative drawer count accepted; total overridable | **Fixed** (inputs `min="0"`; server returns `NEGATIVE_COUNT`) |
| S3-18 | Near-expiry labelled 30 days, actually 90 | **Fixed** |
| S3-19 | Sidebar hotkey badge wrong | **Fixed**, then superseded by the tab redesign |
| S3-20 | Return reason not mandatory | **Not re-tested** |
| S3-21 | Cash tendered never captured | **Fixed, server-side too** (`TENDER_REQUIRED`, `TENDER_SHORT`) |
| S3-22 | Rate field editable with no permission or audit | **Fixed** (`PRICE_OVERRIDE_REQUIRED` names the permission) |
| S3-23 | GST configured at 18%, never applied | **Not re-tested** |
| S3-24 | Unknown `/api/*` returns Express HTML | **Fixed** (`{"error":"No such endpoint: POST /api/settings","code":"NOT_FOUND"}`) |
| S3-25 | Reversed date range returns empty 200 | **Not re-tested** |
| S3-26 | Native `confirm()` dialogs | **Fixed** (app modal restating bills, net and cash) |
| S3-27 | Reports omit zero days | **Not re-tested** |

### Round 1, Low

S4-28 truncation **fixed**. S4-29 currency 2dp **fixed**. S4-30 to S4-32 POS dropdown, sticky toolbar, sidebar clipping **fixed or superseded by the redesign** (toolbar still not sticky). S4-33 input labels **still open**. S4-34 contrast **mostly fixed**, 2 failures remain. S4-35 leading-zero counters **fixed**. S4-36 stale footer **fixed** (footer now shows live till and today's sales). S4-37 bill number wrapping **fixed**. S4-38 hospital naming **fixed** in the browser title; hospital field names persist in `/api/reports/dashboard` (`patients_today`, `tokens_today`, `lab_pending`). S4-39 dark mode **shipped**, see P2. S4-40 audit log in the UI **built** (`audit.view` permission exists and correctly 403s for Pharmacist).

### Round 2, journeys and UI

L1, L2, L3 scan field **fixed** (170px in a 127px parent with a chip on top → 1090px matching its parent, chip at the right edge, typed text fully visible). L4, L5, L6 basket columns **fixed** (137px overflow → 0; medicine column 110px → 394px; row height 179px → 60px; "on shelf" 246px → 80px). L9 KPI baselines **fixed**. L10 subtitle clipping **fixed**. L11 till card fragment **fixed** ("Counter 1" renders in full). N1 and N2 navigation **fixed** (23 flat items, 11 below the fold → 8 keyboard tabs, though see M2). D1 type scale **fixed** (21 sizes with half-pixels → 12 integers: 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28). D2 radii **improved** (25 → 17). D3 hex colours **unchanged** (91). 9.3 connection indicators **fixed**. 9.4 raw "Failed to fetch" **fixed**. 9.2 offline empty-state copy **still open** (M1). 2.1 mode 1 dead button **still open** (M3). 1.3 default quantity **still open** (P7).

---

## Design suggestions

**1. Finish the connection state, do not stop at the modal.** The modal is the best piece of failure UX in the product. It is undermined by the screen behind it still claiming all-clear, and by the reconnect leaving stale emptiness with a green light. One connection state, one refetch on recovery, one banner that clears itself.

**2. Pin the counter toolbar and the running total.** Still not sticky. On the POS, scrolling to the payment panel takes the scan field off screen. Note the interaction with P2: if you pin anything, the dark-mode `filter` on `html` will break it.

**3. Build the dark theme on the tokens you already have.** `--primary`, `--danger`, `--warn`, `--ok` exist and are used 262 times. A proper dark palette on those is a contained change and gives you correct semantic colour, a manual toggle, and no `filter` side effects.

**4. Close the last of the scale drift.** 12 font sizes is workable but 9px is too small for counter hardware at arm's length, and 12 steps still leaves room for inconsistency. A six-step scale (11 / 12 / 14 / 16 / 20 / 28) covers everything I saw. Then sweep the 91 hex values into the semantic tokens.

**5. Give the tab bar a responsive plan.** Eight tabs at 1416px in a 1140px bar is a layout that only works on a wide monitor. Shorten the labels or wrap below 1280px.

**6. Normalise the error voice.** Two grades of message currently ship side by side. The good grade already exists in the codebase; apply it to the remaining handlers and give every refusal a code.

---

## Feature suggestions

Reordered from Round 1 given what has landed since.

### Worth doing next

1. **Idempotency keys** (H1). The day-close hash makes duplicate bills permanent. This is now the highest-value remaining item.
2. **Exception screen.** The Z-report alerts (`SALES_OUTSIDE_TILL`, `BILL_OUTLIER`) are structured and coded. Surface them as a standing screen rather than only at day-end, so a manager sees an outlier the hour it happens.
3. **Purchase orders and GRN matching.** Vendors tracks payables and advances, and there is a "Record order" action, but no PO → GRN → invoice three-way match. Receiving is where pharmacy leakage concentrates.
4. **Expiry claim workflow.** The card already says "CLAIM DUE · 2". Make it a tracked process: mark claimable, generate a distributor claim note, record credit received, reconcile against payables.
5. **Batch recall.** Returns now credit back to the original batch, so the data finally supports it: search a batch number, list every bill and customer it reached, print notices.

### Still on the list from Round 1

6. **Refill reminders** for chronic patients. Highest commercial return of anything here for a Pakistani retail pharmacy.
7. **Receivables ageing.** Rs 10,360 outstanding across 5 accounts, 1 over limit, with no 30/60/90 buckets and no statements.
8. **Credit limit enforcement at the counter**, with the supervisor-override component you have now built for refunds.
9. **Backup status in the footer.** For an offline-first LAN SQLite deployment this remains the single highest-impact operational addition. The footer has room and already shows "Local SQLite".
10. **Automatic reorder suggestions** from consumption velocity, lead time and pack size.
11. **Substitute and generic suggestions** when a product is out of stock at the counter.
12. **Offline queue on the client.** Now safe to build, once idempotency keys exist.
13. **Urdu interface option.**
14. **Multi-counter support.** The data model has `counter`, the UI assumes Counter 1.
15. **WhatsApp receipts.**

---

## Test data to clean up

| Type | What | Note |
|---|---|---|
| Bills | `INV-202609-00001` → `INV-202609-00006` | 6 bills, Rs 6,200 total, on business day 2026-09-14 |
| Return | `RET-00001` | Rs 40, against `INV-202609-00001` |
| Till session | `SES-15` | opened and closed, balanced at Rs 11,080 |
| **Day lock** | **2026-09-14 is closed and hashed** | Nothing more can post to it without an administrator reopen. Reopen it before continuing manual testing on this date |
| Quarantined stock | Bandage Roll, batch B-1007, 1 roll | held off the shelf by the return |
| **Account lockout** | **`pharmacy` locked until ~10:15 UTC** | From the rate-limit test. It self-clears after 15 minutes; my existing token stayed valid throughout |

Customers on the test bills were walk-in names only (`QA-R3`, `QA-IDEM`, `QA-POSTLOCK`). No customer records were created.

---

## What I could not test

Being straight about the gaps, since the Pharmacist role is deliberately scoped:

- **Audit log contents.** `/api/reports/audit` → `403 {"need":["audit.view"]}`. Correct behaviour, but it means I could not confirm whether failed sign-ins are now recorded, only that they are now rate-limited.
- **Dialysis and the serology privacy finding (S2-11).** `403 {"need":["dialysis.view"]}`.
- **Reports module** (S2-10, S3-25, S3-27) and **Settings writes** (correctly `403 {"need":["user.manage"]}`).
- **Cross-user till behaviour** (S2-07). The `force_closed` and `closed_by` columns suggest supervisor force-close was built; confirming it needs two accounts.
- **The administrator reopen path** for a locked day.

A short pass as Administrator would close all of these. Say the word and I will run it.
