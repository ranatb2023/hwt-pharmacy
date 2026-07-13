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
