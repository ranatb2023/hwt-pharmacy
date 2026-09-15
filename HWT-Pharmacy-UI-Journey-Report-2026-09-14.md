# UI & User Journey Report: Hope Welfare Trust Pharmacy Portal

| | |
|---|---|
| **Build** | v0.1.0 |
| **Target** | `http://localhost:4000` |
| **Viewport tested** | 1438 x 833 and 1150 x 666 |
| **Focus** | Interface craft and user journeys. Business logic was covered in the previous QA report. |
| **Method** | Walked each journey as the operator would, then measured the DOM and stylesheet for the causes |

---

## Verdict

The thinking behind this interface is better than the execution.

Almost every screen shows someone who understands who is using it. The Rx warning appears the moment a Schedule Rx item enters the basket. The department mode rewrites the pay button to say "Issue" and explains that no cash is taken. The new-medicine form carries a live DRAP Form 12 checklist and a preview of how the item will look at the counter. Quick-cash buttons drop the Rs 50 chip when the bill is over Rs 50. These are not obvious choices. Someone made them deliberately.

What lets it down is layout mechanics and failure handling.

The single most-used control in the product, the scan field on the counter screen, is 170px wide inside a 127px parent, and a status chip sits on top of it. The cashier can see roughly 12 pixels of what they type. That is not a styling nitpick. That is the primary input of a pharmacy POS, and it is unreadable.

The bigger issue is what happens when the LAN master is unreachable. On the Dashboard, it is handled well: red dot, "Cannot reach server", values fall back to dashes. Everywhere else the app carries on as if nothing happened. Inventory with a dead API reports "0 batches, nothing inside the window" and "0 items, all items above reorder level". A pharmacist doing the morning expiry check would read that as all clear and walk away. Two batches are actually inside the window.

**Nothing here blocks a demo. Two things block a live counter: the scan field, and offline states outside the Dashboard.**

### Counts

| Area | Findings |
|---|---|
| Journey friction | 14 |
| Layout and rendering defects | 11 |
| Design system drift | 5 |
| Navigation and IA | 4 |
| **Total** | **34** |

---

## Fixed since the last report

Worth logging, because it is a lot in one pass.

- Browser tab now reads "Hope Welfare Trust Pharmacy" instead of the hospital name
- Page headings wrap instead of clipping. "Management Dashboard" and "Inventory, Batches & DRAP Compliance" both render in full
- Currency is 2dp everywhere I looked. Rs 14,108.00, Rs 1,092.48, Rs 311,172.16
- Expiry card label now reads "≤90 D" and matches the `near_expiry_days` setting
- The DRAP contradiction is gone. Dashboard says "2 DRAP record gaps", Inventory says "2 COMPLIANCE GAPS", the filter tab says "DRAP missing (2)". Three screens, one number
- Sidebar hotkey badge corrected to F1
- Cash tendered is now required. The Complete button stays disabled with the prompt "Enter the cash received (F4), the slip prints the tender and the change"
- Quick-cash chips adapt to the bill total
- A UOM selector (tablet / strip / box) now sits on each basket line with a live "= 10 tablet" conversion
- Audit Log, Sync and Corrections have appeared in the navigation

---

## Journey walkthroughs

### J1. Serve a walk-in customer
*Runs a few hundred times a day. Everything else is secondary to this.*

**What works.** The scan field takes focus on page load. Type, press Down, press Enter, and focus returns to the scan field ready for the next item. That loop is correct and it is the thing most POS builds get wrong.

**Friction found:**

**1.1 The cashier cannot see what they are typing.** *(blocker)*

Measured geometry on the scan control:

| Element | x range | Note |
|---|---|---|
| Input | 293 to 462 | 170px wide |
| Its parent container | 127px wide | input overflows by 43px |
| Barcode icon, overlaid | 293 to 323 | covers first 30px |
| Status chip ("SCANNER READY" / "2 MATCHES"), overlaid | 298 to 419 | covers 121px |
| Search button starts | 431 | text runs behind it |

Visible typing area: roughly **x 419 to 431. Twelve pixels.**

I typed "Pana" and the field displayed "2 MATCHES". The input's `value` was `"Pana"`. It was rendered, just buried.

Same root cause produces two more symptoms. The input's right edge (462) sits on top of the F2 badge on the Search button (442 to 466), so that badge disappears. And the results dropdown renders 405px wide anchored to a 170px input inside a 127px box, so it hangs off at an angle and covers the billing mode row beneath.

One CSS fix, three symptoms gone. Give the input real width (it should be the widest thing in that row, not the narrowest), move the status chip to the right edge or below as a caption, and let the dropdown match the input.

**1.2 Enter on an empty dropdown does nothing, silently.** Typing fast enough to beat the debounce and hitting Enter adds no line and shows no message. The cashier looks down at the basket, sees nothing, and types again. A brief "searching…" or "no match for X" closes the loop.

**1.3 Default quantity is a full strip.** Selecting Panadol 500mg added `1 strip = 10 tablets`, not 1 tablet. The conversion line is there and it is well done, but the default is buried under the stepper and a distracted cashier will sell ten tablets to someone who asked for one. Default to the smallest saleable unit, or make the UOM choice the first thing the eye lands on after adding.

**1.4 The basket table gives the medicine name the least room on the row.**

Measured on a single-line basket, container 834px, table 971px, so **137px overflows and the row scrolls horizontally**:

| Column | Width | What it holds |
|---|---|---|
| # | 37px | "01" |
| **Medicine & formulation** | **110px** | "Panadol Extra · 10/strip · box Rs 600.00 · strip Rs 60.00 · tablet Rs 6.00 · MRP Rs 6.00/tablet" |
| Next expiry | 101px | "2028-03-31" |
| On shelf | 246px | "3 box + 4 strip + 9 tablet" |
| Dispense qty | 250px | stepper plus UOM toggle |
| Rate | 116px | "60.00 / strip" |
| Line total | 78px | "Rs 60.00" |
| Remove | 32px | "✕" |

The name column wraps to ten lines and forces a **179px row height**. Four items would fill the screen. Meanwhile "On shelf", a figure the cashier glances at once, gets more than double the width.

Fix: give the name column the space, move the pricing breakdown out of the name cell into the Rate cell or a hover, and shrink "On shelf" to a compact figure with the breakdown on hover.

**1.5 Rate and Line Total are off-screen.** Because of 1.4, the two numbers that decide what the customer pays sit past the right edge behind a horizontal scrollbar. Those two columns should be pinned.

**1.6 The action toolbar scrolls away.** Scrolling to the payment panel takes the scan field, the F-key row and the basket header off screen. On a counter the scan field should never leave. Pin the toolbar, and pin the running total.

---

### J2. Attach a customer or welfare card

**2.1 Billing mode 1 is an enabled button that does nothing.** *(confirmed twice, including a programmatic click)*

All three mode pills are `<button>`, `disabled: false`, `cursor: pointer`. Clicking "2. Walk-in" and "3. Department requisition" both switch mode. Clicking "1. Customer / Welfare card" changes nothing. Before and after the click the computed backgrounds are identical and the slip label stays "Retail, walk-in".

I assume mode 1 is a derived state that only activates once a customer is attached. If so it should not be a button. Either switch to it and prompt ("scan the card or type a mobile"), or render it as a status chip that lights up on its own.

**2.2 The unknown-mobile flow is genuinely good, and then clutters itself.** Type an unregistered mobile, press Enter, and an inline create-customer form appears with the mobile prefilled and Name focused. No modal, no lost context. That is the right pattern.

But the surrounding chrome does not stand down. Still on screen at the same time:

- "No customer identified, this is a walk-in sale. Scan a card or type a mobile to attach one." Directly contradicts the form the user is filling in
- "NAME (OPTIONAL)" and "PHONE (OPTIONAL)" on the right, so there are now two name fields and two phone fields visible simultaneously

Hide the walk-in panel and the optional fields while the create form is open.

**2.3 Customer data persists across transactions.** After parking a bill and starting a new sale, the customer box still held `03001234567` from the previous transaction. A new sale should start clean.

---

### J3. Department requisition

**3.1 This mode is the best-executed part of the counter.** Switching to it changes the F9 button from "Pay" to "Issue", disables F4 Tender, changes the slip type to "Department issue note", and shows: *"Billed to Laboratory on account at cost price. No money is taken now and the drawer is not touched."* That sentence does more work than a help page.

**3.2 Retail fields stay on screen and contradict it.** The CUSTOMER row, the stale mobile, the "this is a walk-in sale" panel and NAME/PHONE (OPTIONAL) all remain visible next to the department fields. There are now two mobile inputs on screen: "PHONE (OPTIONAL)" and "THEIR MOBILE". Mode 3 should hide the retail block entirely.

**3.3 "COLLECTED BY *" is required with no upfront signal.** It carries an asterisk but no styling difference from the optional fields beside it, and nothing indicates the issue will be refused until it is filled.

---

### J4. Park and resume a sale

**4.1 The mechanic is right.** Pressing F6 parked the bill, a "WAITING:" strip appeared above the billing mode row with a "New sale" tab and the parked bill beside it, each with an ✕ to discard. The Hold button updated to "Hold (1)". This is how parked sales should work.

**4.2 The tab label identifies nothing.** The parked bill reads "Customer 1 · Rs 60.00" for what was a walk-in with no customer attached. With three bills parked, the operator gets "Customer 1", "Customer 2", "Customer 3". Label them with something recallable: the time parked, the item count, or the first medicine on the bill.

---

### J5. Open the shift, close the shift

Covered in the previous report for correctness. On craft:

**5.1 "ACTIVE TILL STATUS" renders as a fragment.** After opening a till the card displayed `Count…` with the subtitle `System Administrator …`. The card is trying to show "Counter 1" inside a box too narrow for it. This is the truncation pattern again, and here it produces a card that says nothing at all.

**5.2 The footer does not react.** With a till freshly open, the status bar still read "No till open" until a navigation occurred. The header and footer should subscribe to the same state as the page.

**5.3 The close confirmation is a native browser dialog.** It breaks the visual language, cannot restate the figures being committed, and cannot be operated on a touch terminal the way the rest of the app can. Replace it with an app modal showing expected, counted and variance before the user commits.

---

### J6. Add a new medicine

**This is the best screen in the product.** Alt+N opens a modal with:

- Numbered sections: 1 Brand & clinical identification, 2 Packaging, 3 Regulatory, 4 Pricing & reorder
- A **live POS item presentation** panel showing how the item will appear at the counter as you type
- A **DRAP Form 12 validation** checklist that ticks off in real time
- Helper text that teaches rather than labels: "as registered on the packaging", "the smallest thing sold", "sealed within one blister strip", "notified maximum retail" versus "what the counter charges"
- A plain-language explainer: "One box = 1 strip = 1 unit. Stock is counted in units, so any of the three can be sold from the same shelf"
- A cold chain checkbox that states its consequence: "flagged at receipt, on the shelf and at the counter"
- Save disabled until requirements are met

Two small things:

**6.1 The DRAP checklist is half green before anything is typed.** "Schedule (general sale)", "Packaging valid" and "Reorder level set" all show ✓ on an empty form because they have defaults. A checklist that starts 50% complete carries less signal. Show those as neutral until the user confirms them.

**6.2 The modal wastes vertical space.** The scroll region is about 520px inside an 833px viewport, so the form scrolls more than it needs to. Let it grow toward the viewport height.

---

### J7. Morning stock and expiry check

**7.1 The Inventory KPI cards fight their own titles.** Four cards, four different internal layouts, no shared baseline. Measured vertical positions of the four headline numbers: 380, 430, 360, 382. Nothing lines up.

Cause: the title and a badge share the top row, so long titles wrap and push the number down by a variable amount. "NEAR-EXPIRY WATCH (≤90 DAYS)" wraps to five lines next to its "CLAIM DUE · 2" badge. "DRAP REGULATORY GAP" wraps to three next to "AUDIT".

Fix: badge on its own row or in the card corner, title on a fixed two-line height, number on a shared baseline.

**7.2 Subtitles still clip.** "ORS Sachet ·…" and "no medicine priced above…" and an orphan "no" floating above the latter. Same `truncate` pattern flagged last round, now confined to the card subtitles.

**7.3 The medicine table overflows horizontally**, same as the counter basket and the dashboard register. "PRICE / MRP" renders as "PRICE / MRF" at the cut.

---

### J8. Manager's morning glance at the Dashboard

**8.1 "Today's Dispensing Register" still is not sorted newest first**, despite saying so. Observed order by bill number: 343, 342, 341, 340, 339, 337, 338, 344. The highest number in the list sits last. Times read 13:02 six times, then 11:56, then 10:35. It is ordered by row id, which matches neither the bill number nor the timestamp.

**8.2 The register table overflows** and cuts the STATUS column to "S". The AMOUNT column is narrow enough that "Rs" breaks onto its own line above the figure: "Rs" then "1,185.00". Customer names wrap to three lines.

**8.3 Contradictions still sit side by side unremarked.** `BILLS TODAY: 8` next to `TILL REGISTER STATUS: Closed`. `REVENUE TODAY: Rs 14,108.00` with the caption "Opening Float: no till". Both impossible in normal trade, neither flagged.

**8.4 Card footers pair unrelated facts.** Each KPI card ends with a two-column footer, so the eye reads "139 units dispensed | Counter closed" and "7.74% on cost of Rs 13,015.52 | 0 indents pending" as if the halves relate. They do not.

**8.5 Zero-value cards keep their promotional captions.** "SUBSIDY TODAY Rs 0.00" still carries "Trust Zakat Absorbed" and "100% Needy Relief" beneath it. When the value is zero the caption should go quiet.

**8.6 Numbers wrap inconsistently.** "Rs 1,092.48" and "Rs 14,108.00" break across two lines while "8" and "Rs 0.00" sit on one. The KPI row loses its rhythm. Fit the number to the box with a smaller step rather than letting it wrap.

**8.7 The hub tiles duplicate the sidebar and cost a full screen of scroll.** Six large tiles pointing at six destinations already in the 23-item sidebar. They also skip F5 (reserved for refresh), so the sequence reads F1, F2, F3, F4, F6, F7, which looks like a mistake even though it is not.

**8.8 "Process Requisitions Now" is a primary CTA under an empty queue.** The Ward & Unit Indents panel says "Nothing awaiting dispense", then leaves roughly 400px of white space, then offers a dark primary button. Hide or disable it when the queue is empty, and let the panel shrink to its content.

---

### J9. When the LAN master goes down

*I blocked all `/api/*` calls and walked the app.*

**9.1 The Dashboard handles it properly.** Sidebar badge flips to a red dot and "Unreachable". A header pill reads "Cannot reach server". BILLS TODAY and TOTAL CUSTOMERS fall back to "—". This is exactly right.

**9.2 No other screen does.** *(blocker)*

Inventory, offline, rendered:

- ACTIVE STOCK VALUATION: Rs 0.00, "0 SKUs listed · at retail"
- NEAR-EXPIRY WATCH (≤90 DAYS): 0 batches, **"nothing inside the window"**
- STOCK-OUT / REORDER ALERT: 0 items, **"all items above reorder level"**
- DRAP REGULATORY GAP: 0 missing reg. no, **"no medicine priced above MRP"**
- All medicines (0), "Nothing in this view"

Departments, offline, rendered:

- AWAITING DISPENSE: 0 slips, **"queue is clear"**
- EMERGENCY LINES: 0 slips, **"none flagged"**
- SHORT TODAY: 0 slips, **"every line supplied in full"**
- "No slips waiting. When a runner brings one, type it here."
- "Refreshes every 30 s · 0 slips pending"

Every one of those is a confident positive claim made with no data behind it. The pharmacist checking expiry before opening reads "nothing inside the window" and moves on. In reality two batches are inside it, one at four days.

**9.3 The connection indicators lie on those screens.** While the API was fully dead, Departments still showed a green dot with "Counter Connected" in the header, and the footer still read "LAN Master: localhost · SQLite WAL Active · Ping: 5.9ms". Cached values presented as live.

**9.4 The error message is a raw exception.** Every screen surfaced a pink banner reading **"Failed to fetch"**. That is the browser's `TypeError` text. A counter operator in Kashmir cannot act on it. It should read something like "Cannot reach the pharmacy server. Check the LAN cable or the server machine, then press F5." with a retry button.

**9.5 Even on the Dashboard the fallback is inconsistent.** BILLS TODAY and TOTAL CUSTOMERS degraded to "—", but GROSS MARGIN TODAY still printed "Rs 0.00" with "0% on cost of Rs 0.00". Two cards tell the truth, one invents a figure.

**Suggested pattern.** One connection state held at app level. When it is down: every metric renders "—", every empty state switches from a factual claim ("queue is clear") to an unknown state ("cannot check, server unreachable"), the connection pill and footer go red across all screens, and write actions disable with an explanation.

---

## Layout and rendering defects

| # | Screen | Defect | Measurement |
|---|---|---|---|
| L1 | POS | Scan input overflows parent and is covered by its own status chip | input 170px inside a 127px parent; 12px of visible text area |
| L2 | POS | Input overlaps the Search button's F2 badge, hiding it | input right edge 462, badge spans 442 to 466 |
| L3 | POS | Results dropdown wider than the input it belongs to, overlaps billing mode row | dropdown 405px, input 170px |
| L4 | POS | Basket table scrolls horizontally; Rate and Line Total pushed off-screen | table 971px in an 834px container, 137px overflow |
| L5 | POS | Medicine name column narrower than every data column | 110px vs 246px for "On shelf" |
| L6 | POS | Basket rows 179px tall from forced wrapping | 4 lines fills the viewport |
| L7 | Dashboard | Register table overflows, STATUS truncated to "S" | horizontal scrollbar present |
| L8 | Dashboard | "Rs" wraps onto a separate line from the amount | AMOUNT column too narrow |
| L9 | Inventory | KPI headline numbers not on a shared baseline | y = 380, 430, 360, 382 |
| L10 | Inventory | Card subtitles clip mid-word, orphan "no" line | `truncate` on 10px text |
| L11 | Cash Flow | Active till card renders as "Count…" | card narrower than its own content |

---

## Design system

The foundations are there. A token layer exists on `:root` with 39 app variables covering buttons, controls, tiles, semantic colours (`--primary`, `--danger`, `--warn`, `--ok`), shadows, radii and focus. It is used 262 times in the stylesheet. `:focus-visible` is used properly. There are no positive `tabindex` hacks. Skeleton and spinner CSS both exist.

The problem is drift alongside it.

**D1. Twenty-one distinct font sizes**, including half-pixel steps: 10, 10.5, 11, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 18, 24, 25. A working scale needs six to eight steps. The half-pixel values do not land on the pixel grid and render slightly soft. And 24 and 25 both appear, a difference nobody can see but that still costs a token.

Proposed scale: 11 (micro), 12 (label), 14 (body), 16 (subhead), 20 (section), 28 (display). Everything maps to one of those.

**D2. Twenty-five distinct border radii**, mixing raw px (4, 6, 8, 10, 12, 18, 20), rem (.5rem), percentage (50%), three separate variables (`--radius`, `--radius-sm`, `--ctl-radius`) and two `!important` overrides. Only nine of the twenty-five use a token.

**D3. Ninety-one hardcoded hex colours** in the stylesheet, on top of the Tailwind palette reached through classes and the semantic variables already defined.

**D4. Eighty-five distinct padding values.** No consistent spacing step.

**D5. Type is small for the hardware.** Body sits at 14px, labels at 10 to 11px. Counter terminals are read at arm's length on inexpensive panels. Raise the small-label floor to 12px and body to 15px.

None of this is visible as a single broken screen. It shows up as the slight unevenness across the app: cards that do not quite align, labels at four sizes on one screen, corners that do not match between a button and the card holding it.

---

## Navigation and information architecture

**N1. The sidebar is a flat list of 23 items, and 11 are below the fold.**

Measured at 666px viewport height: the scroll container is 460px tall holding 1011px of content. **551px, more than half the menu, is hidden.**

Below the fold: Reports, Users, Roles & Permissions, Employees, Catalogue, Dialysis Form, Settings, Audit Log, Subsidy Report, Sync, Corrections.

The Audit Log was a recommendation from the last report and it is now in there. It is also effectively undiscoverable.

**N2. No grouping.** Daily counter work (Pharmacy Counter, Day Close), stock work (Inventory, Stock Audit, Vendors), money (Cash Flow, Credit Accounts, Returns), configuration (Users, Roles, Settings) and operations (Sync, Corrections) all carry identical visual weight in one undifferentiated column.

Suggested grouping, admin collapsed by default:

```
COUNTER      Pharmacy Counter · Day Close · Returns
STOCK        Inventory · Stock Audit · Vendors · Catalogue
PEOPLE       Customers & Cards · Credit Accounts · Dialysis
MONEY        Cash Flow · Departments
INSIGHT      Reports · Subsidy Report · Audit Log
ADMIN ▸      Users · Roles · Employees · Settings · Sync · Corrections · Dialysis Form
```

That puts every daily destination above the fold and drops the default item count from 23 to about 14.

**N3. The dashboard hub tiles are a second navigation system** for a subset of the first, and they cost a full screen of scrolling before the register becomes visible. Either shrink them to a compact row of icon buttons or drop them and let the register and the indent queue occupy the fold.

**N4. Two scroll regions compete.** The sidebar scrolls independently of the page. On a short viewport a user scrolling with the cursor near the left edge moves the menu instead of the content.

---

## Priority

**Before a live counter**

1. L1, L2, L3. Fix the scan input width and the chip overlay. One CSS change, three symptoms, and it is the control the whole product runs on
2. 9.2, 9.3, 9.4. One app-level connection state. Never print "queue is clear" or "nothing inside the window" without data, never show a green dot on a dead connection, never show "Failed to fetch" to a cashier
3. L4, L5, L6. Rebalance the basket columns so the medicine name is the widest thing on the row and Rate and Line Total stay on screen

**Before handover**

4. 1.3 default quantity, 2.1 dead mode pill, 2.2 and 3.2 stale panels, 4.2 parked bill labels
5. 5.1 truncated till card, 5.2 stale footer, 5.3 native dialog
6. 8.1 register sort order, 8.2 register overflow, 8.3 unflagged contradictions
7. N1 and N2. Group the sidebar and get the daily items above the fold

**Next iteration**

8. D1 and D2. Collapse the type scale and the radius set, then sweep the hardcoded hex values into the tokens that already exist
9. 7.1 KPI card baselines, 7.2 subtitle clipping, 8.4 to 8.8 dashboard card details
10. 6.1 and 6.2 on the medicine form, 1.2 empty search feedback, 3.3 required field signalling
11. D5. Raise the type floor for counter hardware

---

## One closing note

The counter screen, the department issue mode and the new-medicine form all show a designer thinking about the person in front of the terminal. The failure states and the layout maths show the same product on autopilot.

The gap between those two is where all thirty-four findings live, and it is a much easier gap to close than building the good parts was.
