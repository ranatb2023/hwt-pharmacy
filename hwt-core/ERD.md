# ERD — entity relationships

The same structure as [DATABASE.md](DATABASE.md), drawn. Split by domain, because one
diagram of forty tables is a picture nobody reads.

> **Viewing:** these are Mermaid diagrams. VS Code renders them in Markdown preview
> (`Ctrl+Shift+V`); GitHub renders them inline.

**Scope:** the product is a **pharmacy POS + dialysis management system** — see
[SCOPE.md](SCOPE.md). Section 4 is on hold and drawn for reference only.

**Legend:** solid entities are shipped. Sections marked 🟦 are planned and name the phase
that adds them.

---

## 1. The system at a glance

How the domains hang together. `bills` is the hub — almost every money question is answered
by joining to it.

```mermaid
erDiagram
    PATIENTS      ||--o{ VISITS          : "attends"
    VISITS        ||--o{ TOKENS          : "queues as"
    VISITS        ||--o{ CONSULTATIONS   : "produces"
    CONSULTATIONS ||--o{ PRESCRIPTIONS   : "writes"
    VISITS        ||--o{ LAB_ORDERS      : "orders"
    PATIENTS      ||--o{ DIALYSIS_SESSIONS : "receives"

    PRODUCTS      ||--o{ STOCK_BATCHES   : "stocked as"
    STOCK_BATCHES ||--o{ STOCK_MOVEMENTS : "moves"
    VENDORS       ||--o{ PURCHASES       : "supplies"
    PURCHASES     ||--o{ PURCHASE_ITEMS  : "contains"
    PURCHASE_ITEMS }o--|| STOCK_BATCHES  : "creates"

    BILLS         ||--o{ BILL_ITEMS      : "contains"
    PATIENTS      ||--o{ BILLS           : "is billed"
    VISITS        ||--o{ BILLS           : "generates"
    DIALYSIS_SESSIONS ||--o| BILLS       : "charged on"
    BILLS         ||--o{ RETURNS         : "refunded by"
    BILLS         ||--o{ CONTROLLED_REGISTER : "logs"

    CASH_SESSIONS ||--o{ CASH_TRANSACTIONS : "records"
    BILLS         ||..o{ CASH_TRANSACTIONS : "posts cash to"

    USERS         }o--|| ROLES           : "holds"
    USERS         ||--o{ AUDIT_LOG       : "acts"
```

---

## 2. Inventory & pharmacy — the core

This is where the current product lives. Note the two facts that govern everything:
`stock_batches.quantity` is in **base units**, and `expiry_date` is the FEFO ordering key.

```mermaid
erDiagram
    PRODUCTS {
        int    id PK
        string sku UK
        string name
        string generic_name
        string form "free text - becomes product_type_id in P01"
        string manufacturer "free text - becomes manufacturer_id in P01"
        string drap_reg_no "DRAP registration"
        string drug_schedule "OTC/Rx/G/Narcotic"
        real   sale_price "PER BASE UNIT"
        real   mrp "DRAP ceiling, PER BASE UNIT"
        int    units_per_strip
        int    strips_per_box
        int    pack_size "DERIVED = per_strip * per_box"
        int    allow_loose "0 = strip may not be broken"
        int    is_refrigerated
        string barcode
        int    reorder_level
    }
    STOCK_BATCHES {
        int    id PK
        int    product_id FK
        int    vendor_id FK "needed for distributor margin, P06"
        string batch_no
        string expiry_date "FEFO ordering key"
        real   cost_price "PER BASE UNIT"
        real   mrp "printed on THIS pack"
        int    quantity "BASE UNITS on hand"
        int    quarantined "excluded from FEFO and the counter"
        string claim_status "none/claimed/settled"
    }
    STOCK_MOVEMENTS {
        int    id PK
        int    product_id FK
        int    batch_id FK
        string type "purchase/dispense/sale/return/adjust/writeoff"
        int    quantity "SIGNED, base units"
        string reference "bill_no or grn_no"
        int    user_id FK
        string created_at
    }
    CONTROLLED_REGISTER {
        int    id PK
        string entry_no UK "CDR-00001"
        int    bill_id FK
        int    product_id FK
        string drug_schedule "G or Narcotic only"
        string buyer_name "generalised to HANDOVERS in P05"
        string buyer_cnic
        string prescriber_name
        string prescription_ref
        string pharmacist_name
    }

    PRODUCTS      ||--o{ STOCK_BATCHES       : "stocked as"
    PRODUCTS      ||--o{ STOCK_MOVEMENTS     : "moved"
    STOCK_BATCHES ||--o{ STOCK_MOVEMENTS     : "from batch"
    PRODUCTS      ||--o{ CONTROLLED_REGISTER : "registered"
    VENDORS       ||--o{ STOCK_BATCHES       : "supplied"
```

---

## 3. Billing & money

```mermaid
erDiagram
    BILLS {
        int    id PK
        string bill_no UK
        int    visit_id FK
        int    patient_id FK
        string customer_name "walk-in"
        string category "Paid/Complete Free/Discounted/Staff"
        string bill_type "clinical / pharmacy-sale"
        real   gross_amount
        real   discount
        real   subsidy "the trust's giving, recorded not lost"
        real   net_amount
        real   paid_amount
        string payment_method "cash/card/online - P04 adds credit"
        string status "unpaid/paid/partial"
    }
    BILL_ITEMS {
        int    id PK
        int    bill_id FK
        string item_type "consultation/lab/pharmacy/dialysis"
        int    ref_id
        string description "carries packaging: 3 strips (30 tab)"
        int    quantity "BASE UNITS"
        real   unit_price
        real   line_total
    }
    RETURNS {
        int    id PK
        string return_no UK
        int    bill_id FK
        real   refund_amount
        string reason
    }
    RETURN_ITEMS {
        int    id PK
        int    return_id FK
        int    product_id FK
        int    quantity
        int    saleable "1 = restocked, 0 = written off"
    }
    CASH_SESSIONS {
        int    id PK
        string counter
        int    user_id FK
        real   opening_float
        real   expected_cash
        real   counted_cash
        real   variance
        string status "open/closed"
    }
    CASH_TRANSACTIONS {
        int    id PK
        int    session_id FK
        string type "in/out"
        string category "sale/payment/petty/expense/misc"
        real   amount
        string reference
    }

    BILLS         ||--o{ BILL_ITEMS        : "contains"
    BILLS         ||--o{ RETURNS           : "refunded by"
    RETURNS       ||--o{ RETURN_ITEMS      : "contains"
    CASH_SESSIONS ||--o{ CASH_TRANSACTIONS : "records"
    BILLS         ||..o{ CASH_TRANSACTIONS : "cash sale posts to open till"
```

> **Phase 04 changes one arrow here:** a *credit* bill must **not** post a cash transaction.
> Revenue is recognised at sale, cash at settlement. That dotted line becomes conditional.

---

## 4. Clinical — ⏸️ ON HOLD

> These four modules (Reception, Token & Queue, Consultation/EMR, Laboratory) are **not being
> built** — see [SCOPE.md](SCOPE.md). The tables exist and the code stays behind the mode gate.
> Drawn here so nobody re-creates them.

### 4a. Shape of the on-hold tables

```mermaid
erDiagram
    PATIENTS {
        int    id PK
        string patient_code UK "HWT-000123"
        string full_name
        string contact "indexed - primary lookup"
        string cnic
        string category "superseded by welfare cards in P03"
        string qr_token UK
        int    consent_online
    }
    VISITS {
        int    id PK
        int    patient_id FK
        string visit_type "OPD/Follow-up/Dialysis/Pharmacy"
        string department
        int    doctor_id FK
        string status
    }
    TOKENS {
        int    id PK
        int    visit_id FK
        string department
        int    token_number
        string token_date "written via businessDay.js"
        string status "waiting/serving/done/cancelled"
    }
    CONSULTATIONS {
        int    id PK
        int    visit_id FK
        int    doctor_id FK
        string vitals "JSON"
        string diagnosis
    }
    PRESCRIPTIONS {
        int    id PK
        int    consultation_id FK
        int    product_id FK
        string medicine_name
        string dosage
        int    dispensed
    }
    LAB_ORDERS {
        int    id PK
        int    visit_id FK
        int    lab_test_id FK
        string status "ordered/collected/completed"
        string result_value
        string report_path "uploaded file"
        real   price
    }
    LAB_TESTS {
        int    id PK
        string code UK
        string name
        real   price
    }

    PATIENTS      ||--o{ VISITS        : "attends"
    VISITS        ||--o{ TOKENS        : "queues as"
    VISITS        ||--o{ CONSULTATIONS : "produces"
    CONSULTATIONS ||--o{ PRESCRIPTIONS : "writes"
    VISITS        ||--o{ LAB_ORDERS    : "orders"
    LAB_TESTS     ||--o{ LAB_ORDERS    : "ordered as"
    PRODUCTS      ||--o{ PRESCRIPTIONS : "prescribed"
```

---

## 5. Vendors & purchasing

There is **no purchase order** — the order taker visits and writes the order in his own
book. The system records the delivery.

```mermaid
erDiagram
    VENDORS {
        int    id PK
        string name
        string contact
        real   balance "CACHE - P04 derives it from the ledger"
        int    is_active
    }
    PURCHASES {
        int    id PK
        string grn_no UK "goods received note"
        int    vendor_id FK
        string invoice_no
        real   total_amount
        real   paid_amount
    }
    PURCHASE_ITEMS {
        int    id PK
        int    purchase_id FK
        int    product_id FK
        int    batch_id FK
        int    quantity "base units"
        real   cost_price "per base unit"
    }
    VENDOR_PAYMENTS {
        int    id PK
        int    vendor_id FK
        real   amount
        string method
    }
    VENDOR_RECLAIMS {
        int    id PK
        int    vendor_id FK
        int    batch_id FK
        int    quantity
        real   value
        string settlement "credit/cash"
    }

    VENDORS   ||--o{ PURCHASES       : "delivers"
    PURCHASES ||--o{ PURCHASE_ITEMS  : "contains"
    VENDORS   ||--o{ VENDOR_PAYMENTS : "is paid"
    VENDORS   ||--o{ VENDOR_RECLAIMS : "accepts claim"
    PURCHASE_ITEMS }o--|| STOCK_BATCHES : "creates"
```

---

## 6. 🟦 Phase 02 — departments: prescription in, invoice out

The lab, emergency and the wards are **outside** this product — their modules are on hold.
They reach the pharmacy the way any customer does: a prescription comes in, stock goes out,
an invoice goes back, and those invoices are the hospital's expense.

There is deliberately **no link** from a department request to a patient record. The
department's patients belong to the department's own system.

```mermaid
erDiagram
    DEPARTMENTS {
        int    id PK
        string code UK "LAB/EMERGENCY/WARD/OT/ADMIN/DIALYSIS"
        string name
        string in_charge "who signs for it (Q13)"
        int    customer_id FK "its customer record"
        string invoice_basis "cost / cost_plus / mrp (Q12)"
        real   markup_pct
    }
    DEPARTMENT_REQUESTS {
        int    id PK
        string request_no UK "REQ-00001"
        int    department_id FK
        string patient_name "free text - NOT a customer record"
        string patient_ref "their MR number"
        string slip_ref "the paper slip serial"
        string prescriber
        string requested_on
        string status "received/dispensed/short/invoiced/cancelled"
        int    bill_id FK
    }
    DEPARTMENT_REQUEST_ITEMS {
        int    id PK
        int    request_id FK
        int    product_id FK
        string label "what the slip said"
        int    qty_requested
        int    qty_dispensed
        real   unit_price
        int    is_emergency
    }
    STOCK_MOVEMENTS {
        int    id PK
        string cost_centre "NEW - where it went"
        string charge_class "NEW - who paid"
    }
    BILLS {
        int    id PK
        string bill_type "NEW value: department-invoice"
        string cost_centre "NEW"
        string charge_class "NEW"
        int    department_id FK "NEW"
    }

    DEPARTMENTS         ||--o{ DEPARTMENT_REQUESTS      : "sends"
    DEPARTMENT_REQUESTS ||--o{ DEPARTMENT_REQUEST_ITEMS : "contains"
    DEPARTMENT_REQUEST_ITEMS }o--|| STOCK_BATCHES       : "FEFO deducts"
    DEPARTMENT_REQUESTS ||--o| BILLS                    : "invoiced as"
    DEPARTMENTS         ||--o| PARTIES                  : "is a customer"
    DEPARTMENTS         ||..o{ STOCK_MOVEMENTS          : "tags cost_centre"
```

`cost_centre` ∈ `COUNTER` · `DIALYSIS` · `LAB` · `EMERGENCY` · `WARD` · `OT` · `ADMIN`

`charge_class` ∈ `PAID` · `CARD_100` · `CARD_50` · `CARD_20` · `STAFF` · `DIALYSIS_FREE` ·
`DEPARTMENT` · `CREDIT` · `ZAKAT`

Two orthogonal columns, not one enum: *an emergency injection given free to a card patient is
two facts, not one.*

## 7. 🟦 Phase 03 — customers & entitlements

A card is a physical thing with a number, a tier and an expiry that the counter verifies —
not a word typed on a patient record. Dialysis entitlement hangs off an *enrolment*, not off
`patients.category`, because a dialysis patient can still be a paying customer for
unrelated items.

```mermaid
erDiagram
    CARD_TIERS {
        int    id PK
        string code UK "CARD_100/CARD_50/CARD_20"
        string name
        real   discount_pct "1.00 / 0.50 / 0.20"
        real   monthly_ceiling
    }
    CARD_TIER_SCOPE {
        int    tier_id FK
        int    product_type_id FK
        string item_type "consultation/lab/pharmacy/dialysis"
    }
    WELFARE_CARDS {
        int    id PK
        string card_no UK
        int    patient_id FK
        int    tier_id FK
        string issued_on
        string valid_till
        string approved_by
        string status "active/suspended/expired"
        string qr_token UK "scanned at the counter"
    }
    DIALYSIS_ENROLMENTS {
        int    id PK
        int    patient_id FK
        int    fund_id FK
        string enrolled_on
        string status
    }
    SUBSIDY_FUNDS {
        int    id PK
        string code UK "ZAKAT/DONATION/TRUST/DIALYSIS"
        string name
    }

    CARD_TIERS    ||--o{ WELFARE_CARDS      : "grants"
    CARD_TIERS    ||--o{ CARD_TIER_SCOPE    : "covers"
    PATIENTS      ||--o{ WELFARE_CARDS      : "holds"
    PATIENTS      ||--o{ DIALYSIS_ENROLMENTS: "enrolled in"
    SUBSIDY_FUNDS ||--o{ DIALYSIS_ENROLMENTS: "funds"
    WELFARE_CARDS ||--o{ BILLS              : "discounts"
    SUBSIDY_FUNDS ||--o{ BILLS              : "pays the subsidy"
```

---

## 8. 🟦 Phase 04 — party accounts & customer credit

One ledger spine serves credit, staff recovery, vendor payables and the dialysis demand
account. The `UNIQUE (party_id, ledger_kind)` constraint is what keeps a **dialysis demand
from ever being netted against a patient's personal credit account** — the client was explicit about
that.

```mermaid
erDiagram
    PARTIES {
        int    id PK
        string party_type "patient/customer/staff/department/vendor"
        string name
        string contact "MOBILE - the account lookup key, indexed"
        string cnic
        int    patient_id FK
        int    user_id FK
        int    vendor_id FK
    }
    LEDGER_ACCOUNTS {
        int    id PK
        int    party_id FK
        string ledger_kind "customer-credit/dialysis-demand/staff/vendor/department"
        real   credit_limit
        real   balance "CACHE, written in the same txn as the entry"
    }
    LEDGER_ENTRIES {
        int    id PK
        int    account_id FK
        string entry_date "business date"
        int    bill_id FK
        string narration
        real   debit "they owe us more"
        real   credit "they paid, or we waived"
        int    user_id FK
    }

    PARTIES         ||--o{ LEDGER_ACCOUNTS : "holds"
    LEDGER_ACCOUNTS ||--o{ LEDGER_ENTRIES  : "records"
    BILLS           ||--o| LEDGER_ENTRIES  : "credit sale debits"
    PATIENTS        ||--o| PARTIES         : "is a"
    USERS           ||--o| PARTIES         : "is a"
    VENDORS         ||--o| PARTIES         : "is a"
```

---

## 9. Dialysis — shipped, and 🟦 Phase 05

The demand form is **per patient, per shift**. One document is simultaneously the
requisition, the stock issue and the source of that patient's charge — so it is modelled as
one record, not three screens that must be reconciled afterwards.

```mermaid
erDiagram
    DIALYSIS_STATIONS {
        int    id PK
        string name UK
        int    is_active
    }
    DIALYSIS_SESSIONS {
        int    id PK
        int    patient_id FK
        int    station_id FK
        int    shift_id FK "NEW in P05"
        string scheduled_at
        string status "scheduled/in-progress/completed/cancelled"
        real   base_charge
        int    bill_id FK
    }
    DIALYSIS_PATIENTS {
        int    id PK
        int    customer_id FK "UNIQUE - identity is the customer record"
        string reg_no UK "DLY-0001"
        string enrolled_on
        string blood_group
        string access_type "AV fistula, catheter, graft"
        string hbsag "serology drives machine assignment"
        string hcv
        string hiv
        real   dry_weight
        int    sessions_per_week
        int    fund_id FK
        string status
    }
    DIALYSIS_SHIFTS {
        int    id PK
        string name UK "the unit's own names - Q6"
        string starts_at
        string ends_at
    }
    DEMAND_TEMPLATES {
        int    id PK
        string name "Dialysis Unit - Demand Form for Patient"
    }
    DEMAND_TEMPLATE_ITEMS {
        int    id PK
        int    template_id FK
        string printed_label "Inj-Epocan 2000, as the unit writes it"
        int    column_no "1 = left, 2 = right"
        int    sort_order
        int    is_freetext "the 'other' row"
        int    is_emergency "the 'Emergency' row"
    }
    DEMAND_TEMPLATE_ITEM_PRODUCTS {
        int    item_id FK
        int    product_id FK
        int    is_default
    }
    DIALYSIS_DEMANDS {
        int    id PK
        string demand_no UK "DEM-00001"
        int    session_id FK
        int    customer_id FK
        int    shift_id FK
        string demand_date
        string status "demanded/issued/short/billed/cancelled"
        string demanded_by "the unit - paper signature line"
        int    issued_by FK "the pharmacy - paper signature line"
        int    bill_id FK
        real   total_cost "the form's Total Cost cell"
    }
    DIALYSIS_DEMAND_ITEMS {
        int    id PK
        int    demand_id FK
        int    template_item_id FK
        int    product_id FK
        string label "free text for the 'other' row"
        int    qty_demanded
        int    qty_issued
        real   unit_cost
        int    is_emergency
    }
    HANDOVERS {
        int    id PK
        string context "sale/dialysis-demand/issue"
        int    ref_id
        int    patient_id FK
        string taken_by
        string relation "Self/Son/Daughter/Spouse/Attendant/Other"
        string cnic
        string contact
    }

    PATIENTS              ||--o| DIALYSIS_PATIENTS : "registered as"
    DIALYSIS_PATIENTS     ||--o{ DIALYSIS_SESSIONS : "receives"
    DIALYSIS_STATIONS     ||--o{ DIALYSIS_SESSIONS : "hosts"
    DIALYSIS_SHIFTS       ||--o{ DIALYSIS_SESSIONS : "scheduled in"
    DIALYSIS_SESSIONS     ||--o| DIALYSIS_DEMANDS  : "consumes via"
    DEMAND_TEMPLATES      ||--o{ DEMAND_TEMPLATE_ITEMS : "rows"
    DEMAND_TEMPLATE_ITEMS ||--o{ DEMAND_TEMPLATE_ITEM_PRODUCTS : "may be any of"
    DEMAND_TEMPLATE_ITEM_PRODUCTS }o--|| PRODUCTS : "resolves to"
    DIALYSIS_DEMANDS      ||--o{ DIALYSIS_DEMAND_ITEMS : "contains"
    DIALYSIS_DEMANDS      ||--o| BILLS            : "billed on"
    DIALYSIS_DEMANDS      ||--o{ HANDOVERS        : "collected by"
    BILLS                 ||--o{ HANDOVERS        : "collected by"
```

### The demand form, row by row

Seed `demand_template_items` with exactly this, in this order, so the screen matches the
paper the unit already fills in.

| Sort | Column 1 (left) | Column 2 (right) |
|---|---|---|
| 1 | Inj-Neurobian | Inj-Toralak |
| 2 | Inj-Mabil | Inj-Aron Plus |
| 3 | Inj-Epocan 2000 | Inj-Gentamycin |
| 4 | Inj-Epocan 4000 | Syringe 1cc / 3cc / 10cc ⚠ |
| 5 | Inj-Omeprazole | Gauze |
| 6 | Inj-Antibiotec / Vancare ⚠ | IV set |
| 7 | Inj-Iron | N/S 1000 / 100 ml ⚠ |
| 8 | Inj-Paracetamol | other 🔓 |
| 9 | Inj-Hyzonate | Emergency 🔓🚨 |

⚠ = one printed row covering **several SKUs**; needs a `demand_template_item_products` set
with a default (see [OPEN-QUESTIONS](OPEN-QUESTIONS.md) Q7).
🔓 = `is_freetext` — searches the whole catalogue.
🚨 = `is_emergency` — **already a row on their paper form**, which is why "emergency medicine
on the same dialysis invoice" is not a new feature, just one that was being done by hand.

Header carries **Shift** and **Date**; footer carries **Demanded by** (the unit) and
**Issued by** (the pharmacy) — two signatures, therefore a two-step workflow. Three patient
blocks print to a sheet; keep that so the unit's filing does not change.

---

## 10. 🟦 Phases 06 & 07 — corrections and the drawer

```mermaid
erDiagram
    BILL_AMENDMENTS {
        int    id PK
        int    original_bill_id FK
        int    credit_note_id FK "a bill"
        int    corrected_bill_id FK "a bill"
        string reason
        real   amount_delta
        string for_date "the CLOSED business day being corrected"
        int    posted_to_session FK "the CURRENTLY OPEN till"
        int    user_id FK
    }
    REGISTER_EVENTS {
        int    id PK
        int    session_id FK
        int    bill_id FK "null = admin no-sale"
        string kind "sale-kick / no-sale / failed"
        string reason
        int    user_id FK
    }

    BILLS         ||--o{ BILL_AMENDMENTS : "amended by"
    CASH_SESSIONS ||--o{ BILL_AMENDMENTS : "adjustment posted to"
    CASH_SESSIONS ||--o{ REGISTER_EVENTS : "drawer opened during"
    BILLS         ||--o| REGISTER_EVENTS : "kicks the drawer"
```

**No bill is ever edited in place.** A correction is a credit note plus a corrected bill,
with the cash adjustment posted to the *currently open* till carrying a `for_date` reference
— so a closed till stays closed and stays reconciled.
