# Phase 09 — Workstation redesign

| | |
|---|---|
| **Status** | 🟨 In progress — foundation built; screens restyled one at a time |
| **Estimate** | 2–3 weeks |
| **Depends on** | Every built phase — this restyles them, it does not add to them |
| **Blocks** | Nothing |
| **Source** | Stitch project *Offline Pharmacy POS Redesign* (`17184736514062509442`), sixteen screens, saved to [`../../hwt-client/design/stitch/`](../../hwt-client/design/stitch/) |

---

## What this is, and what it is not

A **visual redesign** of the pharmacy application into the dense, keyboard-driven
"workstation" layout the client had drawn in Stitch. Every one of the sixteen screens maps
onto a page that already exists and has verified behaviour behind it. Nothing in this phase
adds a capability; it changes how the existing ones look and how they are reached.

That framing decides the approach:

> **Restyle in place. Never rewrite a page from the mockup HTML.**
>
> The counter alone carries F6 hold / F5 resume with atomic swap, the server-side quote that
> keeps the pane equal to the charge, card resolution with expiry refusal, credit with limit
> warnings, department mode, and the staff cap. All verified live across four phases. The
> Stitch markup knows none of it. So the Stitch layout becomes the **skin** over the existing
> state and handlers — the page keeps its logic and gets new bones.

---

## The design system, and the four things it could not keep

| In the mockups | Here | Why |
|---|---|---|
| Tailwind from `cdn.tailwindcss.com` | Tailwind 3 in the build (already present) | No internet on site |
| Inter / Manrope / JetBrains Mono from Google Fonts | `@fontsource/inter` + `@fontsource/jetbrains-mono`, self-hosted like Nunito Sans | No internet on site |
| Material Symbols icon font (screens 05, 06, 12, 13) | The app's own `icons.jsx` | No internet on site |
| F-keys on the nav dock | **Alt+1…8** on the dock; F-keys stay with the page | The mockups' dock F-keys collide with the POS's own F2–F9, and disagree with themselves — F10 is Cash Flow on one screen and Day Close on another |

Manrope appears on four screens and Inter on the rest. That is a mockup artefact, not a
decision; **one face, Inter**, with JetBrains Mono for anything read as a number.

Palette: Tailwind slate, `clinical.primary #0369a1` for actions, `navy.900` for the one dark
block on a POS screen (the amount the customer reads from across the counter) and the status
footer. The CSS variables the un-restyled pages use were re-keyed to the same tones, so the
app never looks like two products while this is in progress.

---

## Screen → page map, with what the mockup shows that is not real

| # | Stitch screen | Page | Mockup elements with nothing behind them |
|---|---|---|---|
| 01 | Counter — multi-mode | `Pharmacy.jsx` | "Zakat verified" badge; "Drawer F11" (Phase 07) |
| 02 | Counter — department requisition | `Pharmacy.jsx` (dept mode) | — |
| 03 | Counter — walk-in | `Pharmacy.jsx` | — |
| 04 | Day-end close | `PharmacyClose.jsx` | "Shift handover & safe drop"; note-by-note denomination count (UI-only calculator is cheap and useful — build it, feeds `counted_cash`) |
| 05 | Requisition queue | `Departments.jsx` | "Ready for handover" / "Dispatch" states beyond what `department_requests` records |
| 06 | Inventory & DRAP | `Inventory.jsx` | "DRAP regulatory gap" tile is derivable (products missing `drap_reg_no`); claim voucher = existing reclaim |
| 07 | New medicine | `Inventory.jsx` product form | — |
| 08 | Receive stock / GRN | `Vendors.jsx` purchase | "Form 12-B compliance" checkbox is text only |
| 09 | Suppliers & orders | `Vendors.jsx` | "Credit rating"; NTN / STRN / bank fields — **no columns** |
| 10 | Vendor ledger & voucher | `Vendors.jsx` + Phase 04 vendor ledger | WHT deduction on a voucher — not modelled |
| 11 | New vendor | `Vendors.jsx` | NTN / STRN / licence / bank — **no columns**; ask before adding them |
| 12 | Customers, cards & credit | `Customers.jsx` + `Credit.jsx` | — |
| 13 | Returns & refund | `Returns.jsx` | Mockup rendered blank; HTML outline used |
| 14 | Credit settlement | `Credit.jsx` statement | Manual invoice selection — **allocation is oldest-first by design (Phase 04)**; show the allocation, do not offer a picker |
| 15 | Cash flow & till | `CashFlow.jsx` | "Safe drop", "Supervisor PIN" |
| 16 | Clinical billing & encounters | `Billing.jsx` | **Not built.** Hospital-mode module, on hold by [SCOPE.md](../SCOPE.md). Stays behind the mode gate |

Where a mockup shows a field with no column behind it, the screen omits the field rather than
showing a dead input. Adding the vendor tax/bank columns is a small schema change worth doing
— but it is the client's data to ask for, not a redesign's to invent.

---

## Order

Shell first, because all sixteen share it. Then the pages in the order they are used:

1. **Foundation** — theme, fonts, `components/ws/` primitives, `WsLayout` (header · Alt-dock · footer)
2. **Counter** (01 / 02 / 03 — one page, three modes)
3. **Day close** (04)
4. **Requisition queue** (05)
5. **Inventory, new medicine, GRN** (06 / 07 / 08)
6. **Vendors, ledger, new vendor** (09 / 10 / 11)
7. **Customers & cards, credit settlement** (12 / 14)
8. **Returns** (13)
9. **Cash flow** (15)

Each page is restyled, rebuilt, and its existing verification suite re-run before the next.
A restyle that changes a number is a regression, not a redesign.

---

## Tasks

- [x] Tailwind theme extended: `clinical`, `navy`, Inter / JetBrains Mono
- [x] Fonts self-hosted via @fontsource (no CDN anywhere)
- [x] `components/ws/`: `Kbd`, `Panel`, `PanelHead`, `Metric`, `DarkTotal`, `rs()`
- [x] `WsHeader` — counter, connection, live PKT clock, user, till cash, Day Close — all real
- [x] `WsNav` — eight-slot Alt+1…8 dock, "More" for the rest, permission-filtered
- [x] `WsFooter` — SQLite / server host / till / today's sales / build — all real
- [x] `WsLayout` and the CSS-variable re-key
- [x] Wire `WsLayout` as the pharmacy-mode shell (hospital mode keeps the sidebar)
- [x] 01/02/03 Counter — restyled in place; every handler, key and payload unchanged (`p09-counter-test.js`: lookup, walk-in and staff quotes, hold/resume, cash sale, department issue all pass); `.pos-*` CSS retired except the hit-list rules Admin and the dialysis register share
- [x] 04 Day close, with the denomination counter — two columns: the working side (session state, note-by-note drawer count feeding `counted_cash` through the existing `/cashflow/:id/close`, controlled-register check) is not printed; the audit sheet prints alone on A4. F8 print, F10 close, Esc back to the counter. Safe-drop figures are arithmetic and stored nowhere. Fixed on the way: the department-invoices heading rendered `{D}` (an undefined identifier, a ReferenceError the moment a department had an invoice that day). `p09-close-test.js` passes
- [x] 05 Requisition queue — queue left, slip under inspection right (no longer a modal); ▲/▼ Enter walk it, F9 dispenses, Esc puts the slip down; emergencies float to the top. The list route now returns `emergency_lines` and `units_requested` (both from the items table) so the urgency column and the KPIs are real. "Ready for handover" / "dispatch" not shown — no such state exists. `p09-dept-test.js` passes
- [x] 06/07/08 Inventory, new medicine, GRN — shelf list with omnibar, schedule filter and pills (low / near expiry / DRAP missing / controlled) left, the medicine's batch dossier right (packaging maths, FEFO-ordered batches with supplier, claim window that hands off to the vendor reclaim). Tiles from `/pharmacy/dashboard` when permitted, else from the list. Receive (08) and the medicine master (07) are the same two forms restyled: GRN preview + last three intakes; live POS preview + validation checklist. Alt+N, F3, F9, Esc. Backend: batches route joins the supplier name. `p09-inv-test.js` passes
- [x] 09/10/11 Vendors, ledger, new vendor — directory left, the vendor's file right (booked orders / GRNs / vouchers / reclaims as tabs); the statement (10) is a mode of the page with the payment voucher beside it, Esc back; new vendor (11) holds only the four columns that exist and says so. Alt+N, F4, Alt+P. Found and fixed: a GRN paid in full on receipt posted `total − paid` as one debit, which the ledger refuses at zero or below (a 500 on an ordinary cash purchase); it now posts the invoice and the on-receipt payment as two entries and refuses an overpayment with a 400. `p09-vendor-test.js` passes
- [x] 12/14 Customers & cards, credit settlement — directory left, the customer's file right (ledger & dispense history / cards & entitlement / credit & staff allowance), one list of cards and one of accounts instead of a request per row; Register customer (Alt+N); Pay / settle (Alt+P) hands the account to the settlement workstation, where the unsettled bills, the till entry (method, tendered, change), the credit limit and the 80mm receipt sit together. Oldest-first allocation is SHOWN after posting, never offered as a picker. `p09-cust-test.js` passes
- [x] 13 Returns — verify the bill, tick what comes back and whether it restocks, take the refund; the slip prints on the roll. Same two requests as before. **Flagged, not changed:** a cash refund is recorded on the return and on the day-end sheet but is not posted as cash OUT of the till session, so the drawer count at closing is short by the refund with nothing to explain it. The screen says so; the fix (post the refund to the open till) is a Phase 03 behaviour change for the client to confirm
- [x] 15 Cash flow — open the till, move cash with a reason and a witness (safe drop / petty expense / float top-up), watch the drawer feed and the variance log; closing goes to the day-end count (F10). Supervisor PIN and drawer kick not built (no PIN on a user, no drawer hardware)
- [x] Every page's existing verification suite re-run after its restyle — on fresh copies of the live database: p04, p04f, p05 pass unchanged; p06 passes after the finding below. p02, p03 and counter-dept no longer pass **as fixtures**, not as behaviour: they predate Phase 05's rule that a department slip must name its collector, and Phase 04's seeded employees turned their sample customer into a staff member. Each rule was re-proved directly (`p09-regress-check.js`: collector required → 400; a 50% card on a fresh customer halves the medicine; an over-limit credit sale → 409 OVER_CREDIT_LIMIT). **Finding:** system roles are seeded once by seed.js, so `billing.amend` (Phase 06) never reached an installed database — the live Administrator got 403 on Corrections. `db.js` now folds the code's default permissions into the stored system roles at every start, additively

## Acceptance tests

- [x] No request leaves the LAN: no CDN script, stylesheet, font or icon anywhere in the build (grep of `dist/` after every page)
- [x] Every figure on the header and footer is live and matches its source screen (till from `/cashflow/current`, today from the dashboard; nothing typed in)
- [ ] Alt+1…8 reach the eight dock pages from any page; F2–F9 on the POS still do what they did — wired and read through; needs the browser pass (see Phase 05/06 browser passes, still owed)
- [x] Each restyled page passes its phase's verification suite unchanged — see the task above for which fixtures are stale and how each rule was re-proved
- [ ] The un-restyled pages remain usable and in the same tone throughout — CSS variables re-keyed so Admin, Reports, Profitability, Corrections, Dialysis and the demand register shift tone with the shell; needs the browser pass
- [x] Screen 16 is not reachable in pharmacy mode — no dock entry, and `/billing` now redirects home unless `hospitalMode` (`HospitalOnly` in App.jsx)
