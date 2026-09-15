# UI & journey remediation, round 2 — report of 2026-09-14

| | |
|---|---|
| **Source** | `HWT-Pharmacy-UI-Journey-Report-R2-2026-09-14.md` — 14 findings (1 high, 4 medium, 9 polish) after 11 from the previous UI pass were verified closed |
| **Proof** | `scratchpad/uj2-shots.js` — headless Chrome at 1150×666: a cold load of Vendors with every `/api/*` call refused, the mode-1 walk, a measured contrast ratio, the till-open routine, the GRN form with a 2020 expiry; plus the server suite `qa-server-test.js` (66 checks) |
| **Status** | 13 closed, 1 partly (UI-14 type scale) |

## The one the tester would not ship without

**UI-01, a cold load during an outage fabricates an all-clear.** The connection state already existed; what was missing was that a screen opened for the first time during the outage had never fetched, so its zero-initialised tiles read as facts. The first failed request now marks the document offline before anything paints as a claim: every KPI figure renders "—" and every caption and empty state reads "cannot check — server unreachable", on a cold load as on a warm one. Verified: Vendors opened cold with the API dead shows three dashes and none of "0 accounts with a balance due", "nothing awaiting delivery", "no vendor holds an advance".

## Findings, one by one

| # | Finding | Status | What was done |
|---|---|---|---|
| UI-01 | Cold load invents an all-clear | Closed | Above |
| UI-02 | GRN button live on a failed validation | Closed | One `problem` value (over MRP, expired, implausible expiry) disables the button, shows under the field, and prints "Cannot receive." in the GRN preview with the expiry row in red |
| UI-03 | Expiry input unbounded; 3025 accepted | Closed | `min` today and `max` ten years on the input; the same bound on both receipt routes (`EXPIRED`, `EXPIRY_IMPLAUSIBLE`), the GRN route having had no expiry check at all. Verified: 3025 refused, 2020 refused |
| UI-04 | Mode 1 shows "registered customer" and "walk-in sale" together | Closed | While a card is awaited the profile panel and the optional name/phone fields are not rendered |
| UI-05 | Contrast on the NET PAYABLE card | Closed | Supporting lines lifted to slate-100/200 on the navy card; the subtotal line measures 14.5:1 (was 3.75:1) |
| UI-06 | Till open: no focus, no confirmation, page jumps | Closed | The float field takes focus and Enter opens; the confirmation names the counter, float and operator; the view stays at the top with the new till card |
| UI-07 | Header GRN button dead without a reason | Closed | F3 and the button always act: with a medicine selected they open the GRN for it (the button says so), otherwise they focus the search and say to pick a row first |
| UI-08 | More ▾ has no `aria-expanded` | Closed | `aria-expanded`, `aria-haspopup`, `aria-controls`, and `role="menu"` on the list |
| UI-09 | One unlabelled input | Closed | The customer lookup carries "Customer card number, mobile or name" |
| UI-10 | Slip line repeats the quantity | Closed | The bill line reads "Disprin · per tablet"; the quantity lives in its column only. Returns and the Z-report read the same line |
| UI-11 | Empty EXPECTED DRAWER CASH shouts | Closed | Light tile until a session is open, "no session open" as its caption |
| UI-12 | Guidance chip inside the segmented control | Closed | Its own line under the mode row, with an "it is a walk-in after all" way back |
| UI-13 | MRP per box vs master MRP per cap | Closed | The helper converts the master MRP to the unit being entered |
| UI-14 | Type scale unchanged | Partly | The 12px floor now applies everywhere, not only inside the frames, so 9/10/11px classes render at 12; the stylesheet itself is on a nine-step scale. The tester's count includes Tailwind's generated classes (`text-[13px]`, `text-sm`…), which stay |

## The live server

The tester's `QA-FAR` batch (Amoxil, expiry 3025-01-01, 100 capsules) was quarantined on the live server with the reason recorded, so it has left the saleable shelf; nothing was deleted. Their open till `SES-16` was left as found. Port 4000 needs a restart for the expiry bounds and the slip-line change; the frontend is rebuilt.

## Notes on two "still open" items in the report

- **Idempotency keys** are in place and, since round 3, mandatory on the server; the tester's duplicate came from bare API calls before that change reached port 4000.
- **Dark mode** was not removed; it became opt-in (☾ in both headers) and moved off `html` for the reason the tester gives. It remains a filter until a token palette is built.
