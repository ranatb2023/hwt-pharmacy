# Phase 10 — Management redesign (the sidebar shell)

| | |
|---|---|
| **Status** | 🟩 Built — browser pass owed |
| **Source** | `stitch_offline_pharmacy_pos_redesign/` — 62 Stitch screens + `clinical_pos_system/DESIGN.md`, placed by the client on 2026-09-11 |
| **Depends on** | Phase 09 (the counter screens, the dock shell, the theme) |

## What the client handed over

Sixty-two screens in two families, plus the design-system spec.

- **17 `pharmacy_pos_*` screens** — the counter workstations. Sixteen are the screens Phase 09 already built in the header-and-dock frame; one is new (*register new welfare beneficiary*) and two are variants of returns.
- **1 executive dashboard + 42 `pharmacy_admin_*` screens** — the management side. Every one of these sits in a **dark navy left sidebar** frame (`w-64`, `#0b1f3d`) with a white breadcrumb header, a scrolling workspace and a telemetry footer. This frame does not exist yet.
- **`DESIGN.md`** — the same tokens Phase 09 extracted (surface `#f8f9ff`, primary `#0f2d59`, secondary `#0066cc`, emerald `#059669`, amber `#d97706`, red `#dc2626`; Inter / JetBrains Mono, plus **Manrope** for headlines, which Phase 09 did not have).

"Execute the exact design on the overall dashboard" therefore means: the management side of the product, in the sidebar frame, screen for screen — starting with the Management Dashboard itself.

## Approach — the same rule as Phase 09

**Restyle in place. Never rewrite a page from the mockup HTML.** The mockups carry placeholder figures, sample rows and features that do not exist; each becomes the skin over the page's existing state and handlers. Where a mockup shows something the system cannot know, the screen shows what it does know, and the table below says so.

Two frames, chosen by **route**, not by user:

| Frame | Routes | Why |
|---|---|---|
| **Dock** (`WsLayout`, Phase 09) | `/pharmacy`, `/pharmacy-close`, `/departments`, `/inventory`, `/vendors`, `/customers`, `/credit`, `/returns`, `/cashflow`, and the pharmacist's home | The 17 counter mockups use it; a pharmacist at the till should not lose 256px to a sidebar |
| **Sidebar** (`AdminLayout`, this phase) | `/admin/*`, `/reports/*`, `/margin`, `/amend`, `/dialysis`, `/stock-audit`, and `/` for a **management user** (`user.manage` or `report.view`) | The 42 admin/report mockups and the executive dashboard use it. A counter user's home (`/`) stays in the dock frame without the sidebar — the client's call, 2026-09-11; the admin's home follows the executive-dashboard mockup, 2026-09-14 |

The sidebar lists the counter pages too (exactly as the mockups do) — clicking one swaps frame. The dock's *More* menu carries *Home* and *Administration* back. One canonical sidebar (taken from the *System Settings* mockup, whose menu mirrors the real Administration tabs one for one) is used on every management screen; the mockups' sidebars disagree with each other and are not copied per screen.

**Sidebar (canonical).** Main menu: Dashboard · Pharmacy Counter (F2) · Day Close · Inventory · Departments · Customers & Cards · Credit Accounts · Dialysis · Billing (hospital mode only) · Returns · Cash Flow · Vendors · Reports · Profitability. Administration: Users · Roles & Permissions · Employees · Catalogue · Dialysis Form · Settings · Audit Log · Subsidy Report · Sync · Corrections.

## Screen → page map

### The dashboard

| Mockup | Page | Built as / mockup-only |
|---|---|---|
| `hospital_management_executive_dashboard` | `Dashboard.jsx` (management home) | KPIs from `/reports/dashboard` (patients / tokens / lab are **hospital-mode only** and hidden in pharmacy mode — the on-hold module; in their place: bills today, units out, dispensing queue, expiry watch from `/pharmacy/dashboard`). "Sync queue / latency" → real: outbox count when Phase 08 lands, ping to `/api/health` now. Tokens table → hospital mode; in pharmacy mode the same panel is **today's dispensing register** (recent sales). Ward indents → `/departments/requests?status=received`, real. Launchpads → real routes, F1–F6 wired; hospital-only tiles hidden in pharmacy mode |

### Administration (the `Admin.jsx` tabs, each becoming a screen under `/admin/<tab>`)

| Mockup | Page | Mockup-only |
|---|---|---|
| `system_settings_rules_workstation`, `system_settings_drap_regulatory_workstation` | Settings | "Supervisor PIN", "Lead pharmacist reg no", "Tax/NTN" — no settings keys; ask |
| `users_roles_prescribers_governance_workstation`, `staff_users_directory_workstation`, `register_new_staff_prescriber_workstation` | Users | prescriber licence / PMDC number — no column; ask |
| `roles_permissions_governance_matrix` | Roles | hash chain / cryptographic evidence — not a thing |
| `staff_medical_allowances_welfare_quotas`, `add_staff_medical_allowance_workstation`, `staff_medical_quota_utilization_ledger` | Employees (+ `/reports/staff-statement/:id`) | dependents, co-pay policy — no columns; "department" chip → `designation` |
| `medicine_types_packaging_catalogue_master`, `dosage_form_packaging_simple`, `drug_manufacturers_simple`, `drug_manufacturer_details_view`, `register_drug_manufacturer_workstation`, `merge_duplicate_manufacturers_workstation` | Catalogue (product types, base units, manufacturers, merge) | manufacturer licences / cold-chain protocols — no columns |
| `drap_formulary_master_controlled_substances_workstation` | Catalogue → products by schedule (`/inventory/products`) + `/pharmacy/controlled-register` | — |
| `system_pharmacy_audit_history`, `drap_regulatory_audit_trail_compliance_register_1/2`, `audit_record_deep_inspection_workstation` | Audit Log (`/reports/audit`) | hash verification — not a thing; "deep inspection" = the audit row's JSON detail |
| `zakat_welfare_subsidy_financial_report` | Subsidy Report (`/reports/subsidy-by-fund`, `/reports/subsidy`) | — |
| `offline_cloud_sync_outbox_engine_workstation`, `offline_sync_multi_node_cluster_engine` | Sync | **Phase 08 not started** — the tab shows what `syncRoutes` exposes today; cluster telemetry is mockup-only until then |
| `welfare_tiers_subsidy_funds_workstation` | Customers → Tiers & funds (already restyled in Phase 09; gets the sidebar frame when opened from Administration) | — |

### Reports (each a screen under `/reports/<key>`)

| Mockup | Page | Mockup-only |
|---|---|---|
| `daily_monthly_revenue_sales_audit_report` | Reports → revenue (`/reports/revenue`) | "terminal scope" — one terminal today |
| `category_profit_margin_analysis_report` | `Margin.jsx` (`/reports/margin`) | — |
| `fast_slow_moving_drug_velocity_report` | Reports → stock movements + top sellers (`/reports/stock-movements`, dashboard `top_sellers`) | "run rate days" derivable; built |
| `expiry_stock_wastage_audit_report` | Reports → expiry (dashboard `expiry.batches`, `/inventory/alerts`) | — |
| `zakat_welfare_subsidy_financial_report` | (as Subsidy Report above) | — |

### Management workstations that duplicate a counter page

These are the admin-side view of a page Phase 09 already restyled. They are **not rebuilt**; the sidebar link opens the Phase 09 page (in the dock frame) and the admin-only additions in the mockup are listed here for the record.

| Mockup | Existing page | Admin-only additions in the mockup |
|---|---|---|
| `customers_patients_directory_workstation`, `welfare_cards_registration_smart_pass_enrollment_workstation`, `issue_edit_patient_welfare_card_workstation` | `Customers.jsx` | "smart pass enrollment", guarantor — not modelled |
| `patient_credit_accounts_outstanding_dues_workstation` | `Credit.jsx` | "trustee review", "staff emergency credit" pills — not modelled |
| `customer_returns_refund_audit_workstation` | `Returns.jsx` + `/reports/returns` | — |
| `department_indents_ward_accounts_workstation` | `Departments.jsx` + `/reports/hospital-expense` | — |
| `cash_flow_float_till_sessions_workstation` | `CashFlow.jsx` | — |
| `suppliers_vendors_procurement_workstation`, `supplier_ledger_credit_balance_vendor_payment_reconciliation`, `purchase_orders_inward_grn_stock_verification_workstation` | `Vendors.jsx` | purchase orders — **the system issues no POs by design** (order bookings instead) |
| `near_expiry_expiry_claim_management_workstation`, `batch_quarantine_drug_recall_cold_chain_excursion_workstation` | `Inventory.jsx` dossier + `PharmacyHome` expiry panel (`/pharmacy/batches/:id/quarantine`, vendor reclaim) | recall notices, temperature excursions — not modelled |
| `physical_stock_audit_cycle_count_stock_adjustment_workstation` | `/inventory/products/:id/adjust` exists with **no screen** — a small stock-adjustment screen is in scope for this phase | cycle-count sheets — not modelled |
| `clinical_invoicing_master_encounter_billing_workstation`, `pos_central_clinical_billing_*` | `Billing.jsx` | **Hospital module, on hold** — stays gated (Phase 09) |

## Order

1. **Frame**: `AdminLayout` (sidebar, header, footer), Manrope, route groups in `App.jsx`, `/admin/:tab` deep links.
2. **Management Dashboard** — the page the client named.
3. **Administration screens**: Settings, Users, Roles, Employees, Catalogue, Audit log, Subsidy report, Sync, Dialysis form.
4. **Reports**: revenue, margin, velocity, expiry & wastage.
5. **Stock adjustment** screen (the one management workstation with a route and no page).
6. Re-run every touched page's suite; acceptance below.

## Tasks

- [x] `AdminLayout`: sidebar (canonical list, permission-filtered, hospital-only items gated), header (title + breadcrumb, connection pill, date, F5 refresh, export), footer (host, engine, ping, till, licence, build) — every figure live — `components/AdminLayout.jsx`; host, ping, node state, till and build are measured, not typed
- [x] Manrope self-hosted; `font-headline` in the theme; the dashboard hex tokens named — `@fontsource/manrope`, `font-headline`, `hwt.*` colours
- [x] Route groups: sidebar frame for management routes, dock for counter routes; `/admin/:tab` opens the tab — `Shell()` in App.jsx picks the frame by route; `/admin/:tab`, `/reports/:key`, `/stock-audit`
- [x] Management Dashboard — `Dashboard.jsx`; pharmacy-mode KPIs replace the hospital ones; F1–F7 launchpads; indents from the requisition queue
- [x] Settings — **bug found:** the whole form answered 400 since Phase 05 (`dialysis_cost_basis` missing from the text allow-list); fixed in settings.js
- [x] Users (+ register staff) — roster with role chips, add-staff card; licence numbers not held (noted)
- [x] Roles & permissions — list + inspector grouped by area; custom roles created with their permission set; system roles read-only
- [x] Employees & quotas (+ add allowance, quota ledger) — quota ledger with utilisation bars, assign-allowance form with preset tiers, per-employee ledger from `/reports/staff-statement/:id`
- [x] Catalogue (types & units, manufacturers, register, merge, formulary by schedule) — dosage forms (schedule, unit, batch rule, deactivate), base units, manufacturers with side-by-side merge
- [x] Audit log (+ record inspection) — KPIs by action group, quick filters, record inspection with the raw JSON; no hash chain (noted)
- [x] Subsidy report (zakat & welfare) — by fund and by category over a chosen period; active card holders
- [x] Sync (what exists) — queue by entity, sync now; Phase 08 notice
- [x] Dialysis form — shifts and row mapping in the new frame
- [x] Reports: revenue & sales — KPIs, breakdown by day / category / type with collected vs credit, distribution bars, CSV
- [x] Reports: category & margin (`Margin.jsx`) — `Margin.jsx`; KPIs, status pills, cost-vs-margin bars, low-margin lines by product
- [x] Reports: velocity — **new route** `/reports/velocity` (units out per SKU over a period, run rate, days left, tier); the movement ledger could not carry it
- [x] Reports: expiry & wastage — from the dashboard's expiry block; pull-from-shelf per batch and pull-all-expired; claim tracker by supplier
- [x] Stock adjustment screen — `StockAudit.jsx` at `/stock-audit`: count each batch, post the variance through `/inventory/products/:id/adjust` with a reason
- [x] Every touched page's suite re-run — `p10-admin-test.js`, `p10-reports-test.js` pass on a copy of the live DB

## Acceptance tests

- [x] No CDN reference anywhere in the build (Manrope self-hosted) (grep of `dist/` clean)
- [x] Every figure on the sidebar, header, footer and dashboard is live (host, ping, node, till, build, business day; nothing typed in)
- [x] The two frames never show together; every sidebar link lands on a page in the right frame (`Shell()` chooses one by route)
- [x] Hospital-only items (patients, tokens, lab, billing) are absent in pharmacy mode (sidebar `hospital: true`, dashboard tiles and cards swap)
- [x] Each restyled screen passes its phase's suite unchanged (Phase 09 suites unchanged; Phase 10 suites added)
- [x] Mockup-only elements are listed above, not silently dropped (and each screen says so where it matters)

## Browser pass — first round (2026-09-11)

Screenshots taken in headless Chrome at 1600 and 1366 wide, as the administrator and as the pharmacist. Three things the API suites could not see:

- **Every bar in both frames rendered as a centred box, not full width.** The pre-Tailwind stylesheet defines its own `.flex` (display:flex + gap 12px + align-items:center) and `.grid` (gap 18px); Tailwind's `flex` / `grid` utilities share the names and the legacy rules came later in the file, so every new flex container was centred. The legacy helpers are now `fx` / `gx`, renamed in the stylesheet and in the fifteen old pages that use them; the restyled pages are untouched. Measured after: header, main and footer are 1344px beside a 256px sidebar at 1600, and 1600px in the dock frame.
- **The pharmacist's home was still the Phase 03 page.** Pharmacy mode now has one home for everyone — the Management Dashboard, filtered by permission, in the dock frame (the client asked for it without the sidebar) — with the pharmacy's own panels folded in below the mockup's sections: medicine lookup, expiry & claims (pull per batch, quarantine all expired), reorder list, moving today, controlled-drug register. `/pharmacy-dashboard` redirects to `/` in pharmacy mode; `PharmacyHome.jsx` remains the hub page for hospital mode.
- **A global `border-radius: 0 !important`** from the earlier sharp-edge decision flattened every rounded card and pill the design system specifies (4px controls, 6–8px cards). Removed.
- Also fixed: the till card said "Primary undefined" when no till was open — the dashboard treated `{ open: false }` as a session.
- **The admin's home (2026-09-14).** The client asked for the admin dashboard to follow the executive-dashboard mockup. `Dashboard` now has two homes: `management` (an administrator, or anyone with `report.view` — `isManagementUser` in `auth.jsx`) renders the mockup's four sections and nothing else — welcome banner, eight KPI cards, six launchpads in F-key order, today's register beside the ward indents — in the sidebar frame; the counter user's home keeps the dock frame with the lookup box, the action banners and the four counter panels. KPI figures are Manrope, as drawn, not monospace. Measured: main 1344px beside the 256px sidebar at 1600.
- **Dropdowns.** The custom `Select` still wore the Phase 01 look (44px, 1.5px border, square corners) and, once restyled to the design's 40px control, stood taller than the counter pages' 32px inputs. Both dropdown kinds (native `<select>` and `Select`) now take DESIGN.md's control — 1px slate border, 6px radius, inline chevron, blue focus ring, white rounded menu with the design's shadow — and their height, font and padding come from CSS custom properties set on each frame's content wrapper (`WsLayout` 32px / 12px, `AdminLayout` 40px / 14px). Modals inherit them because they render inside the frame's tree. Measured: dropdown = input = native select in both frames.

## What is still owed

- **Browser pass** on the remaining Phase 09 and Phase 10 screens — the home, counter, revenue and employees screens have been looked at (above); the rest have not.
- The pharmacist's own home (`PharmacyHome.jsx`, dock frame) was not in this set and keeps its Phase 03 look.
- Admin-side variants of counter pages (customers directory, credit ledger, returns audit, indents, cash sessions, suppliers, GRN) open the Phase 09 pages; their admin-only extras are listed in the map above and need columns the client has not been asked for.
- Client questions raised by this set: lead pharmacist name and registration, NTN / tax number, prescriber licence numbers, manufacturer DML licences, fund endowment balances, supervisor PIN.
