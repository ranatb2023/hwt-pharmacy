-- Hope Welfare Trust HMS — SQLite schema (on-site hospital tier)
-- Offline-first: this local DB is the authoritative source of operational data.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Roles, users, audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT,
  permissions   TEXT NOT NULL DEFAULT '[]',   -- JSON array of permission keys
  is_system     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  department    TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  username      TEXT,
  action        TEXT NOT NULL,        -- e.g. 'patient.create'
  entity        TEXT,                 -- e.g. 'patient'
  entity_id     TEXT,
  detail        TEXT,                 -- JSON
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Patients, visits, tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_code    TEXT NOT NULL UNIQUE,   -- human-facing Patient ID (HWT-000123)
  full_name       TEXT NOT NULL,
  gender          TEXT,                   -- Male / Female / Other
  dob             TEXT,
  age             INTEGER,
  contact         TEXT,
  cnic            TEXT,
  guardian_name   TEXT,
  address         TEXT,
  category        TEXT NOT NULL DEFAULT 'Paid',  -- Paid / Complete Free / Discounted / Staff
  qr_token        TEXT UNIQUE,            -- opaque token encoded on the QR card
  consent_online  INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_contact ON patients(contact);

CREATE TABLE IF NOT EXISTS visits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL REFERENCES patients(id),
  visit_type    TEXT NOT NULL DEFAULT 'OPD',  -- OPD / Follow-up / Dialysis / Pharmacy
  department    TEXT,
  doctor_id     INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'registered', -- registered/in-consultation/lab/pharmacy/billed/completed
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);

CREATE TABLE IF NOT EXISTS tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id      INTEGER NOT NULL REFERENCES visits(id),
  patient_id    INTEGER NOT NULL REFERENCES patients(id),
  department    TEXT NOT NULL,
  token_number  INTEGER NOT NULL,
  token_date    TEXT NOT NULL DEFAULT (date('now')),
  status        TEXT NOT NULL DEFAULT 'waiting',  -- waiting/serving/done/cancelled
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_dept_date ON tokens(department, token_date);

-- ---------------------------------------------------------------------------
-- Consultations (EMR)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id      INTEGER NOT NULL REFERENCES visits(id),
  patient_id    INTEGER NOT NULL REFERENCES patients(id),
  doctor_id     INTEGER REFERENCES users(id),
  vitals        TEXT,     -- JSON: bp, pulse, temp, weight, spo2
  complaint     TEXT,
  notes         TEXT,
  diagnosis     TEXT,
  referral      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consult_patient ON consultations(patient_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consultation_id INTEGER NOT NULL REFERENCES consultations(id),
  patient_id      INTEGER NOT NULL REFERENCES patients(id),
  product_id      INTEGER REFERENCES products(id),
  medicine_name   TEXT NOT NULL,
  dosage          TEXT,
  frequency       TEXT,
  duration        TEXT,
  instructions    TEXT,
  dispensed       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_presc_patient ON prescriptions(patient_id);

-- ---------------------------------------------------------------------------
-- Laboratory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_tests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE,
  name          TEXT NOT NULL,
  sample_type   TEXT,
  normal_range  TEXT,
  unit          TEXT,
  price         REAL NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lab_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id      INTEGER NOT NULL REFERENCES visits(id),
  patient_id    INTEGER NOT NULL REFERENCES patients(id),
  lab_test_id   INTEGER NOT NULL REFERENCES lab_tests(id),
  ordered_by    INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'ordered',  -- ordered/collected/completed
  result_value  TEXT,
  result_notes  TEXT,
  report_path   TEXT,
  price         REAL NOT NULL DEFAULT 0,
  completed_by  INTEGER REFERENCES users(id),
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_laborders_status ON lab_orders(status);
CREATE INDEX IF NOT EXISTS idx_laborders_patient ON lab_orders(patient_id);

-- ---------------------------------------------------------------------------
-- Inventory / Pharmacy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT UNIQUE,
  name          TEXT NOT NULL,
  generic_name  TEXT,
  form          TEXT,           -- tablet/syrup/injection...
  unit          TEXT DEFAULT 'unit',
  is_otc        INTEGER NOT NULL DEFAULT 0,
  sale_price    REAL NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS stock_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  batch_no       TEXT,
  expiry_date    TEXT,
  manufacturer   TEXT,
  cost_price     REAL NOT NULL DEFAULT 0,
  quantity       INTEGER NOT NULL DEFAULT 0,   -- current on-hand for this batch
  received_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batches_product ON stock_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON stock_batches(expiry_date);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  batch_id      INTEGER REFERENCES stock_batches(id),
  type          TEXT NOT NULL,   -- purchase/dispense/sale/return/adjust/writeoff
  quantity      INTEGER NOT NULL,  -- signed: + in, - out
  reference     TEXT,            -- e.g. bill id / grn id
  reason        TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no        TEXT NOT NULL UNIQUE,
  visit_id       INTEGER REFERENCES visits(id),
  patient_id     INTEGER REFERENCES patients(id),
  customer_name  TEXT,           -- for walk-in OTC sales
  category       TEXT NOT NULL DEFAULT 'Paid',
  bill_type      TEXT NOT NULL DEFAULT 'clinical', -- clinical / pharmacy-sale
  gross_amount   REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  subsidy        REAL NOT NULL DEFAULT 0,   -- value waived for Complete Free
  net_amount     REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',   -- cash / card / online
  status         TEXT NOT NULL DEFAULT 'unpaid', -- unpaid/paid/partial
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(created_at);

CREATE TABLE IF NOT EXISTS bill_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id       INTEGER NOT NULL REFERENCES bills(id),
  item_type     TEXT NOT NULL,   -- consultation/lab/pharmacy/dialysis
  ref_id        INTEGER,
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  unit_price    REAL NOT NULL DEFAULT 0,
  line_total    REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_billitems_bill ON bill_items(bill_id);

-- ---------------------------------------------------------------------------
-- Vendors / Suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  contact       TEXT,
  address       TEXT,
  notes         TEXT,
  balance       REAL NOT NULL DEFAULT 0,   -- payable owed to vendor (+ = we owe)
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  grn_no        TEXT NOT NULL UNIQUE,       -- goods received note
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  invoice_no    TEXT,
  total_amount  REAL NOT NULL DEFAULT 0,
  paid_amount   REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON purchases(vendor_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id   INTEGER NOT NULL REFERENCES purchases(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  batch_id      INTEGER REFERENCES stock_batches(id),
  quantity      INTEGER NOT NULL,
  cost_price    REAL NOT NULL DEFAULT 0,
  line_total    REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vendor_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  amount        REAL NOT NULL,
  method        TEXT,
  reference     TEXT,
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_reclaims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  batch_id      INTEGER REFERENCES stock_batches(id),
  quantity      INTEGER NOT NULL,
  value         REAL NOT NULL DEFAULT 0,
  reason        TEXT,
  settlement    TEXT NOT NULL DEFAULT 'credit',   -- credit / cash
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Customer returns (against pharmacy sales)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS returns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no      TEXT NOT NULL UNIQUE,
  bill_id        INTEGER REFERENCES bills(id),
  patient_id     INTEGER REFERENCES patients(id),
  customer_name  TEXT,
  refund_amount  REAL NOT NULL DEFAULT 0,
  reason         TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     INTEGER NOT NULL REFERENCES returns(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  quantity      INTEGER NOT NULL,
  unit_price    REAL NOT NULL DEFAULT 0,
  saleable      INTEGER NOT NULL DEFAULT 1,   -- 1 = restocked, 0 = written off
  line_total    REAL NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Dialysis
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dialysis_stations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dialysis_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients(id),
  station_id     INTEGER REFERENCES dialysis_stations(id),
  staff_id       INTEGER REFERENCES users(id),
  scheduled_at   TEXT NOT NULL,
  duration_min   INTEGER,
  status         TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled/in-progress/completed/cancelled
  pre_vitals     TEXT,
  post_vitals    TEXT,
  notes          TEXT,
  base_charge    REAL NOT NULL DEFAULT 0,
  consumables    TEXT,                              -- JSON snapshot of consumables used
  bill_id        INTEGER REFERENCES bills(id),
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dialysis_patient ON dialysis_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_dialysis_sched ON dialysis_sessions(scheduled_at);

-- ---------------------------------------------------------------------------
-- Cash flow & float
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  counter        TEXT NOT NULL,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  opening_float  REAL NOT NULL DEFAULT 0,
  opened_at      TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at      TEXT,
  expected_cash  REAL,
  counted_cash   REAL,
  variance       REAL,
  status         TEXT NOT NULL DEFAULT 'open',   -- open / closed
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_status ON cash_sessions(status);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL REFERENCES cash_sessions(id),
  type           TEXT NOT NULL,   -- in / out
  category       TEXT,            -- sale/payment/petty/expense/misc
  amount         REAL NOT NULL,
  reason         TEXT,
  reference      TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cashtx_session ON cash_transactions(session_id);

-- ---------------------------------------------------------------------------
-- Donors & donations (online tier data, aggregated / de-identified)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  email          TEXT UNIQUE,
  contact        TEXT,
  password_hash  TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id       INTEGER REFERENCES donors(id),
  receipt_no     TEXT UNIQUE,
  amount         REAL NOT NULL,
  purpose        TEXT,
  is_pledge      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Sync records (offline-first change queue for the cloud tier)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity         TEXT NOT NULL,
  entity_id      TEXT,
  operation      TEXT NOT NULL,       -- upsert / delete
  payload        TEXT,                -- JSON
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending / synced
  synced_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_records(status);

CREATE TABLE IF NOT EXISTS sync_state (
  key            TEXT PRIMARY KEY,
  value          TEXT
);

-- ---------------------------------------------------------------------------
-- Configurable settings (prices, discount rules, staff cap, thresholds)
-- Administrator-editable so financial rules are not hard-coded (SRS §2.5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key     TEXT PRIMARY KEY,
  value   TEXT
);

-- ---------------------------------------------------------------------------
-- Counters (sequence generator for human-facing codes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  name    TEXT PRIMARY KEY,
  value   INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Controlled-drug (narcotic / Schedule G) sale register
-- Control of Narcotic Substances Act 1997 and the Drugs Act 1976 require a
-- pharmacy to keep a bound register of every controlled-drug sale, naming the
-- prescriber, the prescription, and the person who collected the medicine.
-- Entries are written automatically by the pharmacy sale route and are
-- append-only (never edited or deleted) so the register can be inspected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS controlled_register (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no          TEXT NOT NULL UNIQUE,        -- CDR-00001
  bill_id           INTEGER REFERENCES bills(id),
  bill_no           TEXT,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  product_name      TEXT NOT NULL,
  drug_schedule     TEXT,                        -- G / Narcotic
  batch_no          TEXT,
  expiry_date       TEXT,
  quantity          INTEGER NOT NULL,
  patient_id        INTEGER REFERENCES patients(id),
  patient_name      TEXT,
  buyer_name        TEXT,                        -- person collecting, if not the patient
  buyer_cnic        TEXT,                        -- CNIC recorded at the counter
  buyer_contact     TEXT,
  prescriber_name   TEXT,                        -- prescribing doctor
  prescriber_reg_no TEXT,                        -- PMDC registration number
  prescription_ref  TEXT,                        -- prescription id / paper serial
  pharmacist_id     INTEGER REFERENCES users(id),
  pharmacist_name   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cdr_created ON controlled_register(created_at);
CREATE INDEX IF NOT EXISTS idx_cdr_product ON controlled_register(product_id);

-- ---------------------------------------------------------------------------
-- PHASE 01 — catalogue lists, parked sales, order bookings
-- ---------------------------------------------------------------------------

-- Dosage form as a managed list rather than free text on products.form.
-- is_medicine is the single definition of "needs a batch number and an expiry
-- date on receipt" — it replaces the string predicate that was duplicated
-- between the receive route and the compliance panel.
CREATE TABLE IF NOT EXISTS product_types (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  is_medicine      INTEGER NOT NULL DEFAULT 1,
  default_tax_pct  REAL NOT NULL DEFAULT 0,
  default_schedule TEXT NOT NULL DEFAULT 'OTC',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1
);

-- Manufacturer as a managed list. "Company-wise sale" is only as good as this
-- field: free text yields GSK, G.S.K and Glaxo as three separate companies.
CREATE TABLE IF NOT EXISTS manufacturers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  contact   TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- Parked carts, so four or five customers can be served in parallel.
-- Held server-side, not in React state: a shift lasts eight hours and on this
-- site a browser reload is what happens when the lights go out.
CREATE TABLE IF NOT EXISTS held_sales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT,
  counter    TEXT,
  user_id    INTEGER REFERENCES users(id),
  cart       TEXT NOT NULL,
  hold_date  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_held_user ON held_sales(user_id, hold_date);

-- A memo of the order the order taker wrote in his own book. NOT a purchase
-- order: the system never issues one, it only records what was booked so the
-- counter can see what is still to arrive.
CREATE TABLE IF NOT EXISTS order_bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  taker_name    TEXT,
  taker_contact TEXT,
  booked_on     TEXT NOT NULL,
  expected_on   TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'booked',
  user_id       INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON order_bookings(vendor_id, status);

-- Base units, as a managed list. The unit label is printed on every receipt and
-- in every rate ("Rs 11.07/cap"), so free text produces tab / Tab / tablet /
-- tabs on four products that are the same thing. Nothing groups by it, so the
-- label stays denormalised on products.unit — this list only constrains what
-- can be chosen.
CREATE TABLE IF NOT EXISTS base_units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  descr      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- PHASE 02 — departments: prescription in, invoice out
--
-- The laboratory, emergency, the wards and the OT are OUTSIDE this product;
-- their modules are on hold. They reach the pharmacy the way any customer does:
-- a prescription comes in on paper, stock goes out, an invoice goes back. Those
-- invoices are the hospital's expense, reported by department.
--
-- There is deliberately no software link to a lab or reception record. The
-- department's own patients belong to the department's own system.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,      -- LAB / EMERGENCY / WARD / OT / ADMIN / DIALYSIS
  name          TEXT NOT NULL,
  in_charge     TEXT,                      -- who signs for it; prints on the issue slip
  contact       TEXT,
  customer_id   INTEGER REFERENCES patients(id),
  invoice_basis TEXT NOT NULL DEFAULT 'cost',  -- cost / cost_plus / mrp   (Q12)
  markup_pct    REAL NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS department_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no    TEXT NOT NULL UNIQUE,      -- REQ-00001
  department_id INTEGER NOT NULL REFERENCES departments(id),
  patient_name  TEXT,                      -- their patient; free text, not a record here
  patient_ref   TEXT,                      -- their MR number, if the slip carries one
  slip_ref      TEXT,                      -- the paper slip's own serial
  prescriber    TEXT,
  collected_by_name    TEXT,               -- the runner who carried it away
  collected_by_cnic    TEXT,
  collected_by_contact TEXT,
  requested_on  TEXT NOT NULL,             -- business date
  status        TEXT NOT NULL DEFAULT 'received', -- received/dispensed/short/cancelled
  bill_id       INTEGER REFERENCES bills(id),
  notes         TEXT,
  received_by   INTEGER REFERENCES users(id),
  issued_by     INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deptreq_status ON department_requests(status, requested_on);
CREATE INDEX IF NOT EXISTS idx_deptreq_dept ON department_requests(department_id, requested_on);

CREATE TABLE IF NOT EXISTS department_request_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES department_requests(id),
  product_id    INTEGER REFERENCES products(id),
  label         TEXT,                      -- what the slip said, before it is matched
  uom           TEXT NOT NULL DEFAULT 'unit',
  qty_requested INTEGER NOT NULL DEFAULT 0,   -- base units
  qty_dispensed INTEGER NOT NULL DEFAULT 0,   -- base units
  unit_price    REAL NOT NULL DEFAULT 0,
  line_total    REAL NOT NULL DEFAULT 0,
  is_emergency  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deptreqitem_req ON department_request_items(request_id);


-- ---------------------------------------------------------------------------
-- PHASE 03 — customers & entitlements
--
-- Patient Management is on hold, so `patients` IS the customer table for this
-- product (customer_type: walk-in / registered / dialysis / department / staff).
-- It is not renamed: thirty routes reference it on a system in daily use, and
-- renaming buys nothing.
--
-- A welfare card is a physical object with a number, a tier and an expiry that
-- the counter verifies — not a word typed on a record.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS card_tiers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,      -- CARD_100 / CARD_50 / CARD_20
  name            TEXT NOT NULL,
  discount_pct    REAL NOT NULL,             -- 1.00 / 0.50 / 0.20
  monthly_ceiling REAL,                      -- null = no ceiling
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1
);

-- What a tier covers. A 100% card should not make a bottle of shampoo free, so
-- the scope is data rather than a rule buried in the pricing code.
-- product_type_id NULL = "any product type"; item_type NULL = "any service".
CREATE TABLE IF NOT EXISTS card_tier_scope (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tier_id         INTEGER NOT NULL REFERENCES card_tiers(id),
  product_type_id INTEGER REFERENCES product_types(id),
  item_type       TEXT,                      -- pharmacy / dialysis
  covered         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tierscope_tier ON card_tier_scope(tier_id);

-- Whose money paid for what was waived. The trust's donors need to know.
CREATE TABLE IF NOT EXISTS subsidy_funds (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT NOT NULL UNIQUE,            -- ZAKAT / DONATION / TRUST / DIALYSIS
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS welfare_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_no     TEXT NOT NULL UNIQUE,          -- HWC-00001
  customer_id INTEGER NOT NULL REFERENCES patients(id),
  tier_id     INTEGER NOT NULL REFERENCES card_tiers(id),
  fund_id     INTEGER REFERENCES subsidy_funds(id),
  issued_on   TEXT NOT NULL,
  valid_till  TEXT,
  approved_by TEXT,                          -- who authorised it, for the trust board
  status      TEXT NOT NULL DEFAULT 'active',-- active / suspended / expired
  photo_path  TEXT,
  qr_token    TEXT UNIQUE,                   -- scanned at the counter
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_customer ON welfare_cards(customer_id, status);


-- ---------------------------------------------------------------------------
-- PHASE 04 — party accounts & customer credit
--
-- One ledger spine serves customer credit, staff recovery, vendor payables and the
-- dialysis demand account. The rule that matters is not in this file but in the
-- sale route: a CREDIT sale must not post cash. Revenue is recognised at sale,
-- cash at settlement. Without that the drawer can never be reconciled.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS parties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type  TEXT NOT NULL,            -- customer/staff/department/vendor
  name        TEXT NOT NULL,
  contact     TEXT,                     -- MOBILE: the account is looked up by phone
  cnic        TEXT,
  customer_id INTEGER REFERENCES patients(id),
  user_id     INTEGER REFERENCES users(id),
  vendor_id   INTEGER REFERENCES vendors(id),
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parties_contact ON parties(contact);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_customer ON parties(customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_vendor   ON parties(vendor_id)   WHERE vendor_id IS NOT NULL;

-- UNIQUE(party_id, ledger_kind) is what keeps a dialysis demand from ever being
-- netted against the same person's personal account. The client was explicit that
-- those two must never be summed together.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id     INTEGER NOT NULL REFERENCES parties(id),
  ledger_kind  TEXT NOT NULL,           -- customer-credit/dialysis-demand/staff/vendor/department
  credit_limit REAL,
  balance      REAL NOT NULL DEFAULT 0, -- CACHE, written in the same txn as the entry
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (party_id, ledger_kind)
);

-- Append-only. A mistaken entry is corrected with a reversing entry, never by
-- editing or deleting one — the same discipline Phase 06 applies to bills.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
  entry_date TEXT NOT NULL,             -- business date
  bill_id    INTEGER REFERENCES bills(id),
  reference  TEXT,
  narration  TEXT,
  debit      REAL NOT NULL DEFAULT 0,   -- they owe us more
  credit     REAL NOT NULL DEFAULT 0,   -- they paid, or we waived
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_bill ON ledger_entries(bill_id);

-- ---------------------------------------------------------------------------
-- PHASE 05 — Dialysis Management (the one full clinical module)
--
-- Everything else in this hospital is a department that sends a slip. Dialysis
-- registers its own patients, keeps their history, orders on its own demand
-- form and keeps its money separate from the patient's personal account.
--
-- The shape of these tables comes from the unit's paper form, not from a data
-- model: one document is simultaneously the requisition, the stock issue and
-- the source of that patient's charge, so it is ONE record with a status, not
-- three screens to reconcile afterwards.
-- ---------------------------------------------------------------------------

-- The unit's own shift names (Q6). Data, so the client's answer changes rows.
CREATE TABLE IF NOT EXISTS dialysis_shifts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  starts_at  TEXT,
  ends_at    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- The clinical profile. The IDENTITY lives in `patients` — one person, one
-- record, whether they are buying soap at the counter or being dialysed.
CREATE TABLE IF NOT EXISTS dialysis_patients (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id       INTEGER NOT NULL UNIQUE REFERENCES patients(id),
  reg_no            TEXT NOT NULL UNIQUE,          -- DLY-0001
  enrolled_on       TEXT NOT NULL,
  ended_on          TEXT,
  blood_group       TEXT,
  access_type       TEXT,                          -- AV fistula / catheter / graft
  diagnosis         TEXT,
  -- Serology drives machine assignment: a positive patient is dialysed on an
  -- assigned machine. This is why it is a column and not a note.
  hbsag             TEXT, hcv TEXT, hiv TEXT,
  serology_date     TEXT,
  dry_weight        REAL,
  sessions_per_week INTEGER,
  fund_id           INTEGER REFERENCES subsidy_funds(id),
  referring_dr      TEXT,
  next_of_kin       TEXT, next_of_kin_contact TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The printed form, as data. The unit's wording is the interface: a nurse who
-- knows the paper must need no training, so `printed_label` is what shows on
-- screen even when the catalogue name is longer.
CREATE TABLE IF NOT EXISTS demand_templates (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS demand_template_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   INTEGER NOT NULL REFERENCES demand_templates(id),
  printed_label TEXT NOT NULL,
  column_no     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL,
  is_freetext   INTEGER NOT NULL DEFAULT 0,   -- "other" / "Emergency": search the catalogue
  is_emergency  INTEGER NOT NULL DEFAULT 0,   -- reported apart, billed on the same invoice
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- One printed row, several SKUs ("Syringe 1cc/3cc/10cc"). Q7 fills this in.
CREATE TABLE IF NOT EXISTS demand_template_item_products (
  item_id    INTEGER NOT NULL REFERENCES demand_template_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  is_default INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, product_id)
);

CREATE TABLE IF NOT EXISTS dialysis_demands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  demand_no   TEXT NOT NULL UNIQUE,             -- DEM-00001
  session_id  INTEGER REFERENCES dialysis_sessions(id),
  customer_id INTEGER NOT NULL REFERENCES patients(id),
  shift_id    INTEGER REFERENCES dialysis_shifts(id),
  demand_date TEXT NOT NULL,
  template_id INTEGER REFERENCES demand_templates(id),
  -- demanded -> issued | short -> billed. FEFO happens at ISSUE, because the
  -- paper has two signature lines and they mean two different people.
  status      TEXT NOT NULL DEFAULT 'demanded',
  demanded_by TEXT,
  issued_by   INTEGER REFERENCES users(id),
  issued_at   TEXT,
  bill_id     INTEGER REFERENCES bills(id),
  total_cost  REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demand_status ON dialysis_demands(status, demand_date);
CREATE INDEX IF NOT EXISTS idx_demand_customer ON dialysis_demands(customer_id);

CREATE TABLE IF NOT EXISTS dialysis_demand_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  demand_id        INTEGER NOT NULL REFERENCES dialysis_demands(id),
  template_item_id INTEGER REFERENCES demand_template_items(id),
  product_id       INTEGER REFERENCES products(id),
  label            TEXT,                          -- what the nurse read on the form
  qty_demanded     INTEGER NOT NULL DEFAULT 0,
  qty_issued       INTEGER NOT NULL DEFAULT 0,    -- the paper cannot show a short issue
  unit_cost        REAL NOT NULL DEFAULT 0,
  line_total       REAL NOT NULL DEFAULT 0,
  is_emergency     INTEGER NOT NULL DEFAULT 0,
  batches          TEXT,                          -- JSON: which batch actually went out
  sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_demand_items ON dialysis_demand_items(demand_id);

-- Who physically carried the medicine away.
--
-- The narcotic register already captured this for controlled drugs. The client
-- asked for it on dialysis too ("if someone else order the dialysis patient
-- medicine then record the person who has taken the medicine"), and Phase 02
-- needs it for department runners. One shared record rather than three
-- half-implementations, so a relative collecting for a patient carries the same
-- audit strength as a controlled-drug sale.
-- ---------------------------------------------------------------------------
-- QA 2026-09-14 (S1-04): the closed business day.
--
-- The Z-report is the primary financial artefact. Once the day is closed the
-- figures are SNAPSHOTTED and hashed here, every later print of that date
-- returns the snapshot rather than a fresh query, and nothing may be posted
-- to a closed date until an administrator reopens it — which is audited and
-- shown on every future print of the sheet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS day_closes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date  TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'closed',   -- closed / reopened
  snapshot       TEXT NOT NULL,                    -- the Z-report JSON at close
  content_hash   TEXT NOT NULL,                    -- sha256 of the snapshot
  closed_by      INTEGER REFERENCES users(id),
  closed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_by    INTEGER REFERENCES users(id),
  reopened_at    TEXT,
  reopen_reason  TEXT,
  reclosed_at    TEXT
);

-- QA 2026-09-14 (S2-12): every sign-in attempt, failed ones included, so a
-- brute-force run on the LAN is visible and rate-limited.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT,
  ip          TEXT,
  ok          INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(created_at);

CREATE TABLE IF NOT EXISTS handovers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  context     TEXT NOT NULL,          -- sale / dialysis-demand / department
  ref_id      INTEGER,
  customer_id INTEGER REFERENCES patients(id),
  taken_by    TEXT NOT NULL,
  relation    TEXT,                   -- Self/Son/Daughter/Spouse/Brother/Sister/Attendant/Other
  cnic        TEXT,
  contact     TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_handover_ref ON handovers(context, ref_id);

-- ---------------------------------------------------------------------------
-- PHASE 06 — corrections
--
-- AMEND, NEVER OVERWRITE.
--
-- A closed till stays closed. An admin correcting last week's bill must not
-- reopen it, must not edit the original, and must not make the original's day
-- disagree with what was counted in the drawer that evening.
--
-- So a correction is a NEW pair of documents — a credit note reversing the
-- original and a corrected bill replacing it — linked to what they correct and
-- stamped with who did it and why. The cash difference lands on TODAY's open
-- till, carrying the date it belongs to, because that is where the money
-- actually moves.
--
-- This is the difference between a system a trust auditor accepts and one they
-- do not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_amendments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  original_id    INTEGER NOT NULL REFERENCES bills(id),
  credit_note_id INTEGER NOT NULL REFERENCES bills(id),
  corrected_id   INTEGER REFERENCES bills(id),   -- null when the bill is only cancelled
  reason         TEXT NOT NULL,
  for_date       TEXT NOT NULL,                  -- the business day being corrected
  cash_delta     REAL NOT NULL DEFAULT 0,        -- + owed to customer, - collected from them
  session_id     INTEGER REFERENCES cash_sessions(id),  -- the OPEN till it landed on
  user_id        INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_amend_original ON bill_amendments(original_id);
CREATE INDEX IF NOT EXISTS idx_amend_date ON bill_amendments(for_date);
