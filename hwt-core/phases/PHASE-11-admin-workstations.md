# Phase 11 — Admin workstations (the sidebar frame everywhere)

| | |
|---|---|
| **Status** | 🟩 Built — browser pass done on every screen at 1600 |
| **Source** | The 13 `pharmacy_admin_*` mockups Phase 10 mapped to a counter page and did not rebuild (`stitch_offline_pharmacy_pos_redesign/`) |
| **Depends on** | Phase 09 (the counter pages), Phase 10 (the sidebar frame, the dashboard) |

## What the client asked

2026-09-14: *"admin dashboard should follow the admin screen design … not just only the home it should follow the all admin screens design across the admin dashboard."*

Phase 10 left thirteen admin mockups pointing at the Phase 09 counter pages, opened from the sidebar **in the dock frame**. An administrator clicking *Customers* lost the sidebar and landed on a screen drawn in the counter's dense grey language. That is what the client saw.

## The rule now — frame by user

| Who | Frame | Where |
|---|---|---|
| **Management user** (`user.manage` or `report.view` — `isManagementUser()` in `auth.jsx`) | Sidebar (`AdminLayout`) | **every route**, the counter pages included |
| Counter user (the pharmacist, the cashier) | Dock (`WsLayout`) | every counter route and `/`; the report / admin routes only exist in the sidebar frame |

The two frames never show together. `Shell()` in `App.jsx` decides.

## The mechanism — one page, two skins

The counter pages are not rewritten (the Phase 09 rule stands). Each of them carried its own copy of the same six Tailwind strings — `BTN`, `BTN_DARK`, `BTN_GO`, `CTL`, `NUM`, `LABEL` — hard-coded to the dock's 32px / slate-800 look. Those are now **one export** in `components/ws/index.jsx`, and they are CSS classes (`ws-btn`, `ws-btn-dark`, `ws-btn-go`, `ws-ctl`, `ws-num`, `ws-label`) whose values come from custom properties the frame's content wrapper sets (`styles.css`, "Workstation controls"):

| | Dock (`.ws-content`) | Admin (`.admin-content`) |
|---|---|---|
| Control height / text | 32px / 12px | 40px / 14px |
| Dark button | slate-800 | navy `#0b1f3d` |
| Go button | emerald | action blue `#0284c7` |
| Focus ring | slate-800 | `#0284c7` |
| Radius | 4px | 6px |
| KPI tile | 6px, slate-300 border, mono 18px figure | 8px, slate-200, **4px coloured left bar by tone**, Manrope 28px figure |
| Page title | 16px Inter, breadcrumb above it | 22px Manrope navy; the breadcrumb is hidden — the frame's header carries it |

The KPI tiles (`Tile` / `Kpi` in each page, `Metric` in `ws/index.jsx`) carry `ws-tile`, `ws-tile-label`, `ws-tile-value` and a `data-tone`; the title blocks carry `ws-crumb` / `ws-h1`. Four utilities are re-valued **inside `.admin-content` only** — `rounded-md`, `border-slate-300`, `shadow-xs`, `h-9` — plus `bg-emerald-700` → blue — so the panels the pages draw with utilities take the admin mockups' card values. That block is listed in `styles.css` under "The admin skin" and nowhere else.

The frame's header title and breadcrumb for each counter route come from `TITLES` in `AdminLayout.jsx`, named after the mockups (*Customers & Patients Directory*, *Patient Credit Ledger & Receivables*, *Cash Flow, Float & Till Sessions*, …).

## Screen → page map (the thirteen)

| Mockup | Page, in the sidebar frame | Carried over from Phase 09 | Mockup-only (not drawn) |
|---|---|---|---|
| `customers_patients_directory_workstation` | `Customers.jsx` | KPIs, directory / card register / tiers & funds tabs, mobile-first search, filter chips, customer inspector, statement | age & sex columns (not held), "smart pass" |
| `welfare_cards_registration_smart_pass_enrollment_workstation`, `issue_edit_patient_welfare_card_workstation` | `Customers.jsx` → card issue / edit | tier, fund, ceiling, expiry, serial | guardian, diagnosis, consultant, card barcode preview, committee approval ref |
| `patient_credit_accounts_outstanding_dues_workstation` | `Credit.jsx` | KPIs, owing filter, account ledger, settlement console with quick amounts, aging, receipt | overdue-by-days KPI, "trustee review", "staff emergency credit" chips, guarantor |
| `customer_returns_refund_audit_workstation` | `Returns.jsx` | verify bill, line accept / return qty, refund panel, recent returns | subsidy reversal split, supervisor PIN, restock bin, Form 9 checklist |
| `department_indents_ward_accounts_workstation` | `Departments.jsx` | KPIs, queue / all / departments tabs, slip inspector, dispense, department accounts | authorised heads & signer keys, budget ceilings, MTD by unit |
| `cash_flow_float_till_sessions_workstation` | `CashFlow.jsx` | KPIs, open session with float, sessions & variance log, count & close | two-drawer layout, denomination count on this screen (it is on Day Close), supervisor PIN |
| `suppliers_vendors_procurement_workstation`, `supplier_ledger_credit_balance_vendor_payment_reconciliation`, `purchase_orders_inward_grn_stock_verification_workstation` | `Vendors.jsx` (+ statement, GRN in `Inventory.jsx`) | KPIs, directory, vendor dossier, order booking, GRN, payments, statement | purchase orders (none by design), WHT / tax, cross-cheque instruments, dual sign-off |
| `near_expiry_expiry_claim_management_workstation`, `batch_quarantine_drug_recall_cold_chain_excursion_workstation` | `Inventory.jsx` dossier + `/reports/expiry` (Phase 10) | near-expiry list, claim window, pull / quarantine, vendor reclaim | debit notes, recall notices, cold-chain telemetry, Form 8 |
| `physical_stock_audit_cycle_count_stock_adjustment_workstation` | `StockAudit.jsx` (Phase 10, already in this frame) | — | blind recount, dual sign-off, barcode audit log |

## Tasks

- [x] `isManagementUser()`; `Shell()` gives a management user the sidebar frame on every route
- [x] `TITLES` for the ten counter routes; the admin wrapper is a flex column so the POS keeps its fixed-cart layout
- [x] The six control strings become one shared, frame-driven class set; nine pages import them (Customers, Credit, Returns, Departments, CashFlow, Vendors, Inventory, Pharmacy, PharmacyClose)
- [x] KPI tiles and title blocks marked; the admin skin in `styles.css`
- [x] Browser pass at 1600 as admin on `/`, customers, credit, returns, departments, cash flow, vendors, inventory, POS, day close, stock audit; as pharmacist on departments and inventory (dock unchanged); the issue-to-department modal in the admin frame
- [x] Measured: inputs, native selects, custom `Select`, buttons all 40px in the admin frame (32 in the dock); zero console errors on twelve routes

## Acceptance

- [x] An administrator never leaves the sidebar frame; a pharmacist never sees it on a counter screen
- [x] Every counter page's handlers, payloads and state are untouched (only class strings and two wrapper attributes changed)
- [x] The dock frame renders pixel-for-pixel as before for the counter user (the classes resolve to the Phase 09 values there)
- [x] Mockup-only elements are listed above, not silently dropped

## What is still owed

- The mockup-only columns above are client questions: age / sex on the customer file, guarantor and consultant on the welfare card, prescriber licences, supervisor PIN, WHT on vendor payments.
- `Dialysis.jsx` (Phase 05, legacy CSS) sits in the sidebar frame but is not restyled — the dialysis screens are not in either mockup set.
- The backend on port 4000 still needs a restart for the Phase 09 / 10 server changes.
