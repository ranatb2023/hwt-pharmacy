# QA round 3 remediation — report of 2026-09-14

| | |
|---|---|
| **Source** | `HWT-Pharmacy-QA-Round3-Regression-2026-09-14.md` — 17 open items (2 high, 6 medium, 9 polish) after 41 of 74 earlier findings were verified fixed |
| **Proof** | `scratchpad/qa-server-test.js` (66 checks, DB copy) and `scratchpad/qa3-shots.js` (headless Chrome at 1150×666 with DOM measurements, offline / recovery walk) |
| **Status** | 14 closed, 2 partly (P2 dark theme, P8 stylesheet hex), 1 is the client's data entry (M4) |

## Two things the tester saw that were already true

- **H1 idempotency.** The POS has sent a UUID per basket since the Round 1 pass; the tester's three concurrent calls were bare API posts with no key, which the server accepted as three sales. The key is now **required**: `POST /pharmacy/sale` without `idempotency_key` answers `400 IDEMPOTENCY_KEY_REQUIRED`, so no client, script or retry can duplicate a bill.
- **The counter toolbar** was already sticky; measured at 666px high with the page scrolled 528px, the scan field sits 13px below the top of the scroll area.

## Findings, one by one

| # | Finding | Status | What was done |
|---|---|---|---|
| H1 | No idempotency on sale | Closed | Key mandatory on the server (above); the POS already sent one |
| H2 | Reconnect does not refetch; banner stays | Closed | The connection state counts recoveries; both frames key the page on it so every screen except the counter remounts and re-fetches when the server answers again; the counter keeps its basket, clears its offline banner and re-fetches on `hwt:online`. Verified: blocked, tiles "—"; unblocked, within one probe the tiles and 17 rows are back and the banner is gone |
| M1 | Offline empty states assert facts | Closed | `data-offline` on the document while unreachable: every KPI figure renders "—" and every tile caption and table empty state reads "cannot check — server unreachable". Verified on Inventory |
| M2 | Tab bar overflows at 1150 | Closed | Labels POS · Requisitions · Inventory · Vendors · Customers · Returns · Cash Flow · Day Close; the Alt+n chips show from xl and sit in the tooltip below it. Measured: 1150px of tabs in a 1150px bar, Day Close on screen |
| M3 | Mode-1 pill dead | Closed | It is a mode: clicking lights the pill, focuses the customer box, and the prompt stays until a card or mobile is entered or another mode is picked. Verified programmatically |
| M4 | Licence / address / contact empty | Client | Data entry in Settings (the fields are marked required with a notice); nothing more to code |
| M5 | Two grades of error message | Closed | `INSUFFICIENT_STOCK` names the medicine, what can go, and how much is quarantined or expired; `INVALID_QUANTITY` names the product and the value; `NO_ITEMS` for an empty basket |
| M6 | Z-report bills not time-sorted | Closed | Bills, refunds and register entries on the sheet order by time |
| P1 | "Card 50%" ambiguous | Closed | Segment reads "Welfare card 50%" |
| P2 | Dark mode is a filter hack | Partly | Now opt-in (☾ toggle in both headers, remembered), applied to the app root rather than `html`, never imposed by the OS. Still a filter; a token palette is the next step |
| P3 | Clock and version fail contrast | Closed | Clock slate-600 on white; version slate-300 on navy |
| P4 | Inputs without labels | Closed | 16 more inputs take `aria-label` from the label beside them (POS, Cash Flow, Credit); the earlier pass covered the rest |
| P5 | "1 slips", "1 batches" | Closed | Every KPI unit is singular at one (20 sites) |
| P6 | "Amoxil 500mg 500mg" | Closed | The strength prints only when the name does not already carry it |
| P7 | Default quantity a full strip | Closed in Round 2 | The default is the smallest unit the product may be sold in; a strips-only product (Amoxil) correctly defaults to the strip |
| P8 | 91 hex colours, 17 radii | Partly | Stylesheet: 79 hex (semantic greens/ambers/roses of pills), 5 radius tokens plus 50% and 0; the tester's counts include Tailwind's generated CSS |
| P9 | Two numeral faces | Closed | Every KPI figure uses the tile font |

## The live server

The tester locked business day 2026-09-14 and tripped the lockout on `pharmacy`. Today was reopened as administrator with the reason recorded ("QA round 3 closed the day during testing"); the lockout had already self-cleared. Their six bills, one return and quarantined roll remain, as before.

Port 4000 is running the QA-pass code (the reopen went through it). It needs one more restart for this round's server changes: the mandatory key, the named errors, the sheet ordering and the segment label.
