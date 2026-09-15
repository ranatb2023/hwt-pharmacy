# UI & journey remediation — report of 2026-09-14

| | |
|---|---|
| **Source** | `HWT-Pharmacy-UI-Journey-Report-2026-09-14.md` (34 findings: 14 journey, 11 layout, 5 design system, 4 navigation) |
| **Proof** | `scratchpad/uj-shots.js` — headless Chrome at the tester's two viewports (1438×833, 1150×666) with DOM measurements, plus the dead-server walk with every `/api/*` call refused. Server suite `qa-server-test.js` still passes. |
| **Status** | 31 closed, 2 partly (N1 on a 666px-high screen; D3 colour tokens), 1 not swept (D4 spacing) |

## The blockers first

- **The scan field (1.1, L1–L3).** The toolbar is now a wrapping row in which the search takes the width and the key row wraps beneath it when there is not room. Measured at 1150 wide: input 448px, its parent 448px, no overflow; the dropdown is the input's width; the F2 badge is no longer covered. The status chip reads `SCANNER READY`, then the match count while typing.
- **The dead server (9.2–9.5).** One connection state for the app (`connection.js`). The API client marks the app offline on the first failed call and online on the first success; both frames' pills and footers read it; a full-screen overlay in the app's own words ("Cannot reach the pharmacy server … check the LAN cable or the server machine") covers every screen while it lasts, retrying every five seconds with a Retry button, and the page stays mounted underneath so a basket survives. "Failed to fetch" is never shown; the message is the same everywhere. On reconnect every page re-fetches. Verified with `/api/*` refused: overlay present, header pill red, footer red, raw text absent.
- **The basket (1.4–1.6, L4–L6).** Fixed column layout: the medicine name is the widest column; the price breakdown moved under the rate; "on shelf" is one figure with the breakdown as a tooltip. Measured at 1150: table 1124px in a 1124px box (no horizontal scroll), a row 58px (was 179), Rate and Line total always on screen. The toolbar is sticky.

## Findings, one by one

| # | Finding | Status | What was done |
|---|---|---|---|
| 1.1 | Scan field unreadable | Closed | Wrapping toolbar; search `flex-1 min-w-[24rem]`; chip shows match count |
| 1.2 | Enter on empty dropdown is silent | Closed | "Still searching…" or "No medicine matches X" |
| 1.3 | Default quantity is a strip | Closed | Default is the smallest saleable unit; strip only when the product may not be broken |
| 1.4 / 1.5 | Name column narrowest; Rate/Total off-screen | Closed | Fixed columns, name takes the space, prices under Rate, shelf compact |
| 1.6 | Toolbar scrolls away | Closed | Sticky toolbar (QA pass); scan refocused after each pick and sale |
| 2.1 | Mode-1 pill does nothing | Closed | It focuses the customer box and shows "Scan the card, or type a mobile or name" for five seconds |
| 2.2 | Create-customer form clutters | Closed | While the form is open the walk-in panel and the optional name/phone fields are hidden |
| 2.3 | Customer persists across sales | Closed | A reset token clears the customer box (typed key, hits, form) on every new sale |
| 3.2 | Retail block stays in department mode | Closed | The customer block is not rendered in mode 3 |
| 3.3 | "Collected by *" gives no signal | Closed | Red border and "required before issuing" until filled |
| 4.2 | Parked bill reads "Customer 1" | Closed | Label is the customer or first medicine, "+n", and the time parked |
| 5.1 | Till card renders "Count…" | Closed | Tile values wrap (QA pass); verified at 1150 |
| 5.2 | Footer does not react | Closed | `hwt:till` event (QA pass); verified |
| 5.3 | Native confirm | Closed | App dialog with expected / counted / variance (QA pass) |
| 6.1 | Checklist half green on an empty form | Closed | Defaulted checks show ○ "default" until the form is touched |
| 6.2 | Modal wastes height | Closed | Scroll regions grow to `100vh − 7rem` |
| 7.1 / L9 | KPI numbers on four baselines | Closed | Every tile title is a fixed two-line box; measured y = 246, 246, 246, 246 |
| 7.2 / L10 | Subtitles clip | Closed | `line-clamp-2` on every tile subtitle |
| 7.3 | Medicine table overflows | Closed | The inspector stacks below the table under 2xl, so the table has the width; numeric header no-wrap |
| 8.1 | Register not newest first | Closed | Server orders by `created_at DESC` (QA pass); the tester was on the old server |
| 8.2 / L7 / L8 | Register overflows, "Rs" wraps | Closed | No-wrap on bill, amount and status; customer name clamps |
| 8.3 | Contradictions unflagged | Closed | Sanity banners (QA pass); the tester was on the old server |
| 8.4 | Footers pair unrelated facts | Closed | One caption line per card |
| 8.5 | Zero cards keep captions | Closed | Subsidy at zero says "No subsidy given today"; revenue caption is the till state |
| 8.6 | Numbers wrap | Closed | `clamp()` size, no-wrap, tabular figures |
| 8.7 / N3 | Hub tiles cost a screen | Closed | One compact row of six small tiles (icon, title, key); the description is the tooltip |
| 8.8 | Primary CTA under an empty queue | Closed | Button only when the queue has slips; a text link otherwise; the panel shrinks to its content |
| 9.1–9.5 | Offline handling | Closed | See "the blockers first" |
| L11 | Cash Flow card "Count…" | Closed | As 5.1 |
| D1 | 21 font sizes | Closed | Stylesheet now uses 9 sizes on the scale 11 / 12 / 14 / 15 / 16 / 18 / 20 / 24 / 28 (`--fs-*` tokens); no half-pixels |
| D2 | 25 radii | Closed | Five tokens (`--radius-xs/sm/-/lg/pill`); every px radius in the stylesheet maps to one; the legacy `--radius: 0` sharp override is gone |
| D3 | 91 hex colours | Partly | The design's ten colours are tokens (`--action`, `--navy`, `--line`, `--ink-*`, `--surface`) and replaced throughout; 79 hex values remain, the semantic greens/ambers/roses of pills and alerts |
| D4 | 85 padding values | Not swept | Spacing lives in Tailwind classes; a spacing-scale sweep is a later pass |
| D5 | Type small for the hardware | Closed | 12px floor (QA pass) and the base body size is 15px |
| N1 | 11 sidebar items below the fold | Partly | Grouped, Admin collapsed by default, items 30px: at 833px high the whole menu fits (631px of menu in 627px visible, the Admin toggle on screen). At 666px high the nav still scrolls — 16 items cannot fit 460px at a readable size |
| N2 | No grouping | Closed | Counter · Stock · People · Money · Insight · Admin ▸ (collapsible, remembered) |
| N4 | Two scroll regions compete | Closed | Menu fits at normal heights; `overscroll-contain` where it must scroll |

## Not in this pass

- D4's spacing sweep (Tailwind classes across 40 files) — a later pass with the type/radius tokens now in place.
- Design recommendation 2 (a dedicated counter layout) — a product decision, not a defect.
