# UI & User Journey Report (Round 2 of UI): Hope Welfare Trust Pharmacy

| | |
|---|---|
| **Build** | v0.1.0, rebuilt again since the Round 3 regression pass |
| **Target** | `http://localhost:4000` |
| **Role** | Pharmacist |
| **Viewport** | 1438 x 833 and 1150 x 666 |
| **Focus** | Interface craft and user journeys on the current build |
| **Method** | Walked each journey end to end as the counter operator, then measured the DOM and stylesheet |

---

## Verdict

The counter journey is now genuinely fast.

A complete walk-in sale from a cold POS screen to a printed slip takes **fifteen keystrokes and zero mouse clicks**: seven to type the medicine, Down, Enter, F4, three to type the tender, F9. The scan field takes focus on load, focus returns to it after every line, F4 scrolls to the payment panel and lands the cursor in the tender box, and the toolbar stays pinned throughout. That is what a pharmacy counter needs and it was not true two rounds ago.

The supporting screens caught up too. The stock receiving form has a live GRN preview, a running pharmacy-margin calculation, and helper copy under every field. Billing mode 1 now works and explains itself with an inline "Scan the card, or type a mobile or name in the Customer box ↓". Ten elements are now sticky. Six of seven form inputs were unlabelled in the last UI pass; one is now.

**One thing is still wrong and it matters more than anything else on this list.** When the server is unreachable and the pharmacist opens a screen they have not visited yet, the app fabricates an all-clear. I loaded Vendors cold with the API blocked and got "0 accounts with a balance due", "nothing awaiting delivery", "no vendor holds an advance", "All vendors (0)". Four confident statements with no data behind any of them.

The good news is that half of this got fixed: screens that **already** hold data now keep it during an outage instead of zeroing out, which is the right behaviour. It is only the cold load that still invents facts.

### Counts

| | |
|---|---|
| High | 1 |
| Medium | 4 |
| Low / polish | 9 |
| **Open total** | **14** |

Eleven findings from the previous UI pass are now closed.

---

## Journey walkthroughs

### J1. Serve a walk-in customer
*The journey that runs a few hundred times a day.*

**Measured, cold POS screen to printed slip:**

| Step | Input | Result |
|---|---|---|
| Land on POS | (tab or Alt+1) | Scan field already focused |
| Find the medicine | `Disprin` | Dropdown, 1 match, full-width, text visible |
| Select | `Down` `Enter` | Line added, **1 tablet, Rs 4.00**, focus back in the scan field |
| Tender | `F4` | Scrolls to payment, focuses the tender box, placeholder pre-filled with the exact amount |
| Amount | `100` | "CHANGE RETURN Rs 96.00", green panel, **TENDER VALID** badge, matching quick-cash chip highlights, F9 turns live |
| Complete | `F9` | Slip rendered, "New sale / Enter" offered |

**Fifteen keystrokes. No mouse.**

Three things worth calling out as done right:

**The default quantity is now the smallest saleable unit.** Selecting Disprin put 1 tablet in the basket, not a strip of 10. This was open across both previous UI passes. Where a product is strips-only the UOM toggle correctly hides the loose option instead of silently defaulting to ten.

**The tender state transition is unambiguous.** Grey "Complete & print slip" becomes green, a TENDER VALID badge appears, change is stated in large type, and the quick-cash chip that matches what was typed lights up. A cashier gets confirmation before committing, which is exactly where confirmation belongs.

**The slip carries real numbers.** "Cash received Rs 100.00 / Change returned Rs 96.00 / Dispensed by Pharmacist". Two rounds ago the slip printed a tender figure the cashier had never entered.

**One issue:**

**J1-a. The slip line duplicates the quantity.** It reads `Disprin — 1 tablet | QTY 1 | Rs 4.00 | Rs 4.00`. The quantity appears in the description and again in its own column. This is the same `"<name> — <qty> <uom>"` string that caused the Z-report grouping bug in Round 1. The report side was fixed; the string was not. Drop the quantity from the description and let the QTY column do its job.

---

### J2. Attach a customer or welfare card

**Mode 1 works now.** Clicking "1. Customer / Welfare card" flips the pill, changes the slip label to "Retail — registered customer", focuses the customer box, and shows an instruction chip: *"Scan the card, or type a mobile or name in the Customer box ↓"*. In the last two passes this was an enabled button that did nothing. Good fix, and the inline guidance is better than the tooltip I suggested.

**J2-a. The screen then contradicts itself.** *(Medium)*

With mode 1 active and the slip reading "registered customer", the panel beside the customer box still says:

> "No customer identified — this is a walk-in sale. Scan a card or type a mobile to attach one."

And **NAME (OPTIONAL)** / **PHONE (OPTIONAL)** are still on screen. Those fields belong to walk-in mode. So the operator sees "registered customer" and "this is a walk-in sale" simultaneously, with two sets of name and phone inputs available.

Hide the walk-in panel and the optional fields whenever mode 1 or mode 3 is active.

**J2-b. The instruction chip breaks the toggle.** The guidance chip renders *inside* the billing-mode row, wedged between pill 2 and pill 3. A three-way segmented control with a sentence sitting in the middle of it stops reading as a three-way control. Put the chip on its own line below the row.

---

### J5. Open the till for the day

**Two clicks with the defaults pre-filled** (Cash Flow tab, then "Open till session"). Counter and opening float are both remembered and both properly labelled. The header updates immediately to a "Counter 1" badge and "TILL CASH Rs 5,000.00", and the footer to "Counter 1 · opened 10:33". The stale-footer bug from the last pass is gone.

**J5-a. Three small frictions in the morning routine.** *(Low)*

- **No autofocus.** Landing on Cash Flow puts focus on `<body>`. The morning open should focus the float field or the Open button so the pharmacist can confirm with Enter.
- **No confirmation.** The state simply changes. An earlier build showed "Till opened on Counter 1 with a float of Rs 5,000". That banner is gone and the moment now passes without acknowledgement, which for a cash-custody action is the wrong instinct.
- **The page auto-scrolls away from the result.** After opening, the view jumps down to the cash-movements form, pushing the ACTIVE TILL STATUS card you just created half out of view.

**J5-b. The EXPECTED DRAWER CASH card is inert but still shouts.** *(Low)* With no session open it is the only dark card in a row of three light ones, containing a dash. It draws the most attention while carrying the least information. Let it match the others until there is a session to report.

---

### J6. Receive stock against a delivery (GRN)

**This form is the second-best screen in the product**, after the new-medicine master.

- Header states what it is: "INWARD STOCK RECEIVING & GRN (GOODS RECEIVED NOTE)", with a "BATCH & EXPIRY REQUIRED" badge
- An explainer that gives the reason, not the rule: *"Batch number and expiry date are required for medicine — they are what make a recall or an expiry claim against the distributor possible."*
- Three numbered sections: batch & expiry, pricing & distributor margin, vendor & traceability
- A **live GRN preview** showing current shelf stock, incoming, new physical balance, invoice payable, supplier and challan
- **BATCH COST, RETAIL YIELD and PHARMACY MARGIN computed live** as you type, which is the difference between catching a bad purchase at entry and finding it at stock audit
- Helper copy under every field: "entered per box", "1 box = 10 strips = 100 caps", "stamped on box & blister foil", "ex-tax invoice cost", "not recorded — no supplier claim will be possible"
- A HISTORICAL BATCHES panel showing the last three intakes

**J6-a. The primary button stays green on a state the form says is impossible.** *(Medium)*

I entered an expiry of 2020-01-01. The field turned red with the helper text **"already expired — cannot be received"**. The "Receive into stock" button stayed **enabled and green**, and the GRN preview on the right cheerfully computed "(+) Incoming 100 cap, New physical balance 300 cap, Expiry 2020-01-01".

Clicking it fires a real request that the server correctly refuses with `400 "Cannot receive stock that is already expired."` So nothing bad happens, but the operator gets a green go-button for an action the same screen has already told them cannot succeed, plus a wasted round trip.

Disable the button and mirror the error in the preview panel whenever a field-level validation is failing.

**J6-b. The expiry date input has no bounds, and a typo gets accepted.** *(Medium)*

`<input type="date">` with no `min` and no `max`. Past dates are caught server-side. Absurd future dates are not:

```
expiry 2020-01-01 → 400 "Cannot receive stock that is already expired."
batch_no ""       → 400 "Batch number is required when receiving medicine."
expiry 3025-01-01 → 201  100 caps received, quarantined: 0, on the saleable shelf
```

A finger slip of `3025` for `2025` creates stock that will never surface in the 90-day expiry watch and will never be caught by any existing check. Add `min` (today) and `max` (receipt date plus a sensible horizon) on the input, and the same bound server-side.

**J6-c. Two doors to the same action, one of them locked without saying why.** *(Low)*

The page header has "Receive stock / GRN F3", disabled, with the reason only in a native `title` tooltip ("Pick a medicine first"). Every one of the 17 table rows also has its own enabled "Receive" button. So the advertised keyboard path is dead until a selection is made, the explanation takes a second of hovering to appear and never appears on keyboard focus, and the working path is somewhere else entirely.

Either drop the header button, or make it open a product picker so F3 always does something.

**J6-d. Unit mismatch between adjacent lines.** *(Low)* "MRP PER BOX" has the placeholder "as printed" and the helper text directly beneath reads "master MRP Rs 9.00/cap". Per box above, per cap below, one line apart.

---

### J8. Morning stock and expiry check

Clean. The KPI row now aligns on a shared baseline, the subtitles no longer clip ("ORS Sachet · 60d left · 1 quarantined" renders in full, and it surfaces the quarantine count), the compliance badge sits inline with the page title, and the medicine table no longer overflows.

Product rows no longer duplicate the strength. "Amoxil 500mg" with "Amoxicillin • Capsule • 10/strip • 10 strips/box • full strips only • MED-AMOX" beneath it, rather than the "Amoxil 500mg 500mg" pattern from earlier builds.

---

### J10. When the LAN master goes down

This split into two different behaviours, one now right and one still wrong.

**Right: a screen that already has data keeps it.** I blocked the API on a loaded Inventory screen. The medicine count stayed at 17 throughout the outage instead of collapsing to 0, and the blocking modal explained that the figures were stale. Keeping stale data and labelling it is the correct trade. This was zeroing out in the last pass.

**Right: the banner now clears itself.** On reconnect the modal closed and the red banner went with it. Previously it persisted over a green connection light until someone pressed F5.

**Still wrong: a cold load invents an all-clear.** *(High)*

With the API blocked, I navigated to Vendors, a screen that had not loaded in that session. It rendered:

| Card | Value | Caption |
|---|---|---|
| Total payables to vendors | Rs 0.00 | **"0 accounts with a balance due"** |
| Orders booked | 0 | **"nothing awaiting delivery"** |
| Advances held by vendors | Rs 0.00 | **"no vendor holds an advance"** |
| Vendor list | — | **"All vendors (0)"** |

Same on Requisitions: "queue is clear", "none flagged", "every line supplied in full".

The blocking modal sits over the middle of the screen, so these cards stay fully readable around it. And this is the realistic scenario: the pharmacist arrives, the LAN switch is off, and they click through tabs. Every screen they have not already opened tells them there is nothing to worry about.

**Fix:** a cold load with no data renders `—` for every metric and swaps empty-state captions from factual claims ("queue is clear") to unknown-state text ("cannot check, server unreachable"). The Dashboard already does the `—` fallback for two of its cards, so the pattern exists in the codebase. The distinction to encode is *no data yet* versus *data that says zero*.

---

## Findings by severity

### High

**UI-01. Cold load during an outage fabricates an all-clear.** See J10. The one item on this list I would not ship without.

### Medium

**UI-02.** GRN primary button stays enabled and green on a failed field validation (J6-a).
**UI-03.** No `min`/`max` on the expiry date input; a year-3025 typo is accepted onto the saleable shelf (J6-b).
**UI-04.** Billing mode 1 shows "registered customer" and "this is a walk-in sale" at the same time, with duplicate name and phone fields (J2-a).

**UI-05. Contrast failures on the NET PAYABLE panel.** *(Medium, because of where they are)*

Four failures on the POS screen, all at **3.75:1** against a 4.5:1 requirement, all 12px, all inside the dark totals card:

| Text | Ratio |
|---|---|
| "Net payable" | 3.75 |
| "Subtotal · 0 items" | 3.75 |
| "Counter discount" | 3.75 |
| "Rs 0.00" (the subtotal figure) | 3.75 |

This is the panel a cashier reads aloud to state the amount due, on a counter terminal, often in poor light. The large NET PAYABLE figure itself is fine; it is the supporting lines that fall short. Lighten the secondary text on that dark card.

Page-wide contrast is otherwise good. The header clock at 2.56:1 that I flagged last round is the only other one I found.

### Low / polish

**UI-06.** Till open: no autofocus, no confirmation, page scrolls away from the result (J5-a).
**UI-07.** Two paths to GRN, the advertised one disabled with a native-tooltip-only reason (J6-c).
**UI-08.** The `More ▾` navigation menu sets no `aria-expanded`, so assistive tech cannot tell it is a disclosure.
**UI-09.** One unlabelled input remains: the customer lookup field on the POS. Down from six of seven in the last pass.
**UI-10.** Slip line duplicates the quantity: "Disprin — 1 tablet" beside "QTY 1" (J1-a).
**UI-11.** EXPECTED DRAWER CASH renders as an attention-grabbing dark card while empty (J5-b).
**UI-12.** Mode-1 guidance chip sits inside the segmented control (J2-b).
**UI-13.** MRP per box vs master MRP per cap on adjacent lines in the GRN form (J6-d).

**UI-14. The design system is unchanged since the last measurement.**

| | Previous pass | Now |
|---|---|---|
| Font sizes | 12 | 12 (9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28) |
| Border radii | 17 | 17 |
| Hardcoded hex colours | 91 | 92 |

The big cleanup already happened: 21 sizes with half-pixel values collapsed to 12 integers. What remains is the tail. Twelve steps still leaves room to pick the wrong one, and 9px is too small for a counter terminal read at arm's length. A six-step scale (11 / 12 / 14 / 16 / 20 / 28) covers everything I saw on every screen.

Separately, **dark mode has been removed** since the last pass. That was the right call: it was implemented as `filter: invert(.92) hue-rotate(180deg)` on `html`, and there are now **10 sticky or fixed elements** in the layout, which that filter would have broken by creating a containing block. If you want it back, build it on the `--primary` / `--danger` / `--warn` / `--ok` tokens that already exist and give it a manual toggle.

---

## Fixed since the last UI pass

| Finding | Status |
|---|---|
| Tab bar overflowed 276px, Day Close off-screen | **Fixed.** `More ▾` overflow menu, 0px overflow. 8 primary tabs plus Dashboard, Credit Accounts and Stock Audit in the menu |
| Billing mode 1 was an enabled dead button | **Fixed**, with inline guidance |
| Default quantity was one full strip | **Fixed.** Smallest saleable unit |
| POS toolbar not sticky | **Fixed.** 10 sticky/fixed elements |
| 6 of 7 inputs unlabelled | **Fixed.** 1 of 7 remains |
| Error banner never self-cleared | **Fixed.** Clears on reconnect |
| Screens zeroed out during an outage | **Fixed.** Stale data is retained and labelled |
| "Process Requisitions Now" CTA under an empty queue | **Fixed.** Replaced by a contextual "Issue to a department" |
| Product names duplicated the strength | **Fixed** |
| Dark mode filter hack | **Removed** |
| Pharmacy licence gap was silent | **Surfaced.** The POS now shows an amber banner after every sale: *"Licence not recorded. The slip header carries no drug sale licence number or address — an administrator enters them in Settings."* The licence is still blank, but the gap is no longer invisible |

---

## Design recommendations

**1. Encode "no data" as a distinct state from "zero".** This is UI-01 and it is the only structural gap left. Every metric component needs three states, not two: a value, a zero, and an unknown. Captions follow the same rule. Once that exists, the outage behaviour becomes correct everywhere rather than on the two Dashboard cards that already do it.

**2. Make validation state reach the primary button.** The GRN form knows the expiry is invalid, says so in red under the field, and leaves the green button live. Any field-level error should disable the submit and mirror itself in the preview panel.

**3. Bound every date input.** Expiry, delivery date, report ranges. `min` and `max` on the control plus the same bound server-side. A pharmacy is a domain where a mistyped year is a stock item nobody ever inspects again.

**4. Let modes clean up after themselves.** Mode 1 and mode 3 both leave walk-in controls on screen. A mode switch should hide what the mode does not use, not layer new fields on top of the old ones.

**5. Confirm cash-custody actions.** Opening a till changes who is accountable for a drawer. It currently happens silently. A brief confirmation naming the counter, the float and the operator costs nothing and matches the care already taken at day close.

**6. Finish the type scale.** Twelve steps to six, and lift the 9px floor.

---

## Feature recommendations

Unchanged in substance from the last report, reordered for what has landed since.

**Worth doing next**

1. **Idempotency keys.** Still the top item overall. Three identical concurrent sales still create three bills, and the day-close hash now makes a duplicate permanent.
2. **Exception screen.** The Z-report already emits coded alerts (`SALES_OUTSIDE_TILL`, `BILL_OUTLIER`). Surface them as a standing screen so a manager sees an outlier the hour it happens rather than at day end.
3. **Purchase orders and GRN matching.** The receiving form is now good enough that a PO to match it against is the obvious next step. Receiving is where pharmacy leakage concentrates, and the live margin calculation in that form is half the control already.
4. **Expiry claim workflow.** The card says "CLAIM DUE · 2". Make it a tracked process: mark claimable, generate the distributor claim note, record credit received, reconcile against payables.
5. **Batch recall.** Returns now credit back to the original batch with its real expiry, so the data finally supports it.

**Still on the list**

6. Refill reminders for chronic patients, the highest commercial return here.
7. Receivables ageing with 30/60/90 buckets and statements.
8. Credit limit enforcement at the counter, reusing the supervisor-override component built for refunds.
9. **Backup status in the footer.** For an offline-first LAN SQLite deployment this stays the highest-impact operational addition. The footer already says "Local SQLite" and has room beside it.
10. Automatic reorder suggestions from consumption velocity, lead time and pack size.
11. Substitute and generic suggestions when a product is out of stock at the counter.
12. Offline queue on the client, once idempotency keys exist.
13. Urdu interface option.
14. Multi-counter support. The model has `counter`, the UI assumes Counter 1.
15. WhatsApp receipts.

---

## Test data to clean up

| Type | What |
|---|---|
| Bill | `INV-202609-00007`, Disprin 1 tablet, Rs 4.00, cash |
| Till session | `SES-16`, still **open** on Counter 1 with a Rs 5,000 float |
| Stock batch | Amoxil 500mg, batch **`QA-FAR`**, 100 caps, **expiry 3025-01-01**, on the saleable shelf |

The `QA-FAR` batch is the one worth removing by hand: it is 100 saleable capsules that no expiry check will ever flag.

---

## One closing note

Three passes ago the counter screen had a search field with twelve visible pixels and a basket that pushed the price off the edge of the table. It now runs a complete sale in fifteen keystrokes.

What is left is a single missing state. The app knows how to show a value and how to show a zero. It does not yet know how to say "I could not check". Add that one state and the failure behaviour becomes as considered as everything else here.
