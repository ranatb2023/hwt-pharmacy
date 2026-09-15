const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// This system runs on sites with load-shedding, so durability is pinned rather than
// inherited from whatever the build defaults to.
//
// In WAL mode the faster `synchronous = NORMAL` does not flush the write-ahead log on
// commit: a power cut can lose the last few committed transactions. Here that means the
// last few SALES — with the stock already deducted and the customer already gone. The
// extra fsync costs nothing at counter volumes.
//
// Do not "optimise" this to NORMAL.
db.pragma('synchronous = FULL');

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
  // bizdate()/bizmonth()/bizyear() — registered after the settings table exists,
  // because the offset is read from it.
  require('./businessDay').registerSqlHelpers(db);
}

// Idempotent column additions for databases created before a column existed.
function migrate() {
  const hasColumn = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  // Returns true when the column was actually added, so one-off backfills can
  // run exactly once instead of on every start-up.
  const add = (table, col, ddl) => {
    if (hasColumn(table, col)) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  };
  add('bills', 'payment_method', "payment_method TEXT DEFAULT 'cash'");

  // --- Pakistan pharmacy compliance fields (DRAP / Drugs Act 1976) ---
  // Product master: registration, price ceiling, legal classification, packing.
  add('products', 'drap_reg_no', 'drap_reg_no TEXT');            // DRAP registration number printed on the pack
  add('products', 'strength', 'strength TEXT');                  // e.g. 500mg, 120mg/5ml
  add('products', 'pack_size', 'pack_size INTEGER NOT NULL DEFAULT 1'); // derived: base units per box

  // Packaging levels: a box holds strips, a strip holds tablets. Stock is always
  // counted in base units (tablets); these describe how to read and sell them.
  const stripAdded = add('products', 'units_per_strip', 'units_per_strip INTEGER NOT NULL DEFAULT 1');
  add('products', 'strips_per_box', 'strips_per_box INTEGER NOT NULL DEFAULT 1');
  add('products', 'allow_loose', 'allow_loose INTEGER NOT NULL DEFAULT 1'); // may a strip be broken?
  const mrpAdded = add('products', 'mrp', 'mrp REAL');           // DRAP-notified maximum retail price per unit
  const scheduleAdded = add('products', 'drug_schedule', "drug_schedule TEXT NOT NULL DEFAULT 'OTC'"); // OTC / Rx / G / Narcotic
  add('products', 'is_refrigerated', 'is_refrigerated INTEGER NOT NULL DEFAULT 0'); // cold-chain item
  add('products', 'tax_pct', 'tax_pct REAL NOT NULL DEFAULT 0'); // GST on non-exempt (surgical/OTC) items
  add('products', 'barcode', 'barcode TEXT');                    // scanned at the counter
  add('products', 'manufacturer', 'manufacturer TEXT');

  // Batch: MRP is printed per pack and changes with each DRAP price notification,
  // so it is held on the batch as well as the product default.
  add('stock_batches', 'mrp', 'mrp REAL');
  add('stock_batches', 'vendor_id', 'vendor_id INTEGER REFERENCES vendors(id)');
  add('stock_batches', 'quarantined', 'quarantined INTEGER NOT NULL DEFAULT 0'); // expired/damaged, blocked from sale
  add('stock_batches', 'claim_status', "claim_status TEXT NOT NULL DEFAULT 'none'"); // none/claimed/settled

  // The is_otc flag predates drug_schedule. On the migration that introduces the
  // column, derive the legal classification from it once — otherwise every
  // legacy prescription medicine would sit in the DB marked as general sale.
  if (scheduleAdded) {
    db.exec("UPDATE products SET drug_schedule = CASE WHEN is_otc = 1 THEN 'OTC' ELSE 'Rx' END");
  }
  // Seed the price ceiling from the current selling price so MRP validation
  // never blocks a sale on data that was never captured. Products added later
  // get their MRP from the product form.
  if (mrpAdded) db.exec('UPDATE products SET mrp = sale_price');

  // pack_size previously meant "loose units per pack", which in practice was
  // always the strip size. Carry it into the new field on the migration that
  // introduces the packaging levels, then keep pack_size as the derived total.
  if (stripAdded) {
    db.exec('UPDATE products SET units_per_strip = CASE WHEN pack_size > 0 THEN pack_size ELSE 1 END');
  }
  db.exec('UPDATE products SET pack_size = units_per_strip * strips_per_box');

  // --- Phase 01: catalogue lists ---
  add('products', 'product_type_id', 'product_type_id INTEGER REFERENCES product_types(id)');
  add('products', 'manufacturer_id', 'manufacturer_id INTEGER REFERENCES manufacturers(id)');
  add('purchases', 'order_booking_id', 'order_booking_id INTEGER REFERENCES order_bookings(id)');
  add('product_types', 'default_unit', 'default_unit TEXT');

  seedBaseUnits();
  seedProductTypes();
  // Deliberately NOT gated on "was the column just added". Both backfills are
  // scoped to rows that are still NULL, so running them on every start-up costs
  // nothing after the first pass and self-heals two cases a one-shot migration
  // misses: a fresh install where seed.js inserts products *after* migrate(),
  // and any product created later by an import that did not set the fields.
  backfillProductTypes();
  backfillManufacturers();

  // --- Phase 02: where did it go, and who paid ---
  // Two orthogonal columns, not one status string. An emergency injection given
  // free to a card patient is TWO facts; a single enum would force values like
  // EMERGENCY_CARD_50 the first time it happened.
  add('stock_movements', 'cost_centre', 'cost_centre TEXT');    // where it went
  add('stock_movements', 'charge_class', 'charge_class TEXT');  // who paid
  add('bills', 'cost_centre', 'cost_centre TEXT');
  add('bills', 'charge_class', 'charge_class TEXT');
  add('bills', 'department_id', 'department_id INTEGER REFERENCES departments(id)');

  // The customer record is the one identity in this product (Patient Management
  // is on hold), and a department is a customer type like any other.
  add('patients', 'customer_type', "customer_type TEXT NOT NULL DEFAULT 'registered'");

  // Who physically carried the medicine away. `received_by` is the pharmacy
  // staffer who typed the slip; this is the runner on the other side of the
  // counter, and it is the answer to "who took it" when a department queries an
  // invoice weeks later. Phase 05 generalises this into a shared `handovers`
  // record covering narcotics and dialysis too.
  add('department_requests', 'collected_by_name', 'collected_by_name TEXT');
  add('department_requests', 'collected_by_cnic', 'collected_by_cnic TEXT');
  add('department_requests', 'collected_by_contact', 'collected_by_contact TEXT');

  seedDepartments();
  ensureDepartmentCustomers();

  // An employee's own allowance, where it differs from the trust-wide default.
  // NULL means "use the `staff_annual_cap` setting" — so raising the default
  // still moves everyone who was never given a personal figure, which is the
  // behaviour an administrator expects from a default.
  add('patients', 'staff_cap', 'staff_cap REAL');
  add('patients', 'designation', 'designation TEXT');

  // --- Phase 06: corrections ---
  // A credit note has to say on its face what it reverses and why. Without this
  // the reason lives only in `bill_amendments`, and the document handed to the
  // customer explains nothing.
  add('bills', 'notes', 'notes TEXT');

  // --- Phase 05: dialysis ---
  // The unit files by shift, so every dialysis report groups by it.
  add('dialysis_sessions', 'shift_id', 'shift_id INTEGER REFERENCES dialysis_shifts(id)');
  add('dialysis_sessions', 'demand_id', 'demand_id INTEGER REFERENCES dialysis_demands(id)');
  // `dialysis_stations.assigned_serology` lets a machine be reserved for
  // HBsAg-positive patients, which is the operational reason serology is a
  // column on the patient rather than a note.
  add('dialysis_stations', 'assigned_serology', 'assigned_serology TEXT');
  add('patients', 'dialysis_reg_no', 'dialysis_reg_no TEXT');
  seedDialysisShifts();
  seedDemandTemplate();

  // --- Phase 04: the ledger ---
  add('bills', 'ledger_account_id', 'ledger_account_id INTEGER REFERENCES ledger_accounts(id)');

  // --- QA 2026-09-14 ---
  // S3-15: a retried POST /sale returns the bill it already made.
  add('bills', 'idempotency_key', 'idempotency_key TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_idempotency ON bills(idempotency_key) WHERE idempotency_key IS NOT NULL');
  // S3-21: the slip prints the tender the cashier actually entered, or nothing.
  add('bills', 'tendered', 'tendered REAL');
  add('bills', 'change_given', 'change_given REAL');
  // S1-03: which drawer the cash landed in. NULL on a card / credit sale.
  add('bills', 'cash_session_id', 'cash_session_id INTEGER REFERENCES cash_sessions(id)');
  // S2-06 / S1-01: a refund is cash out of a till, or a credit on a ledger,
  // and above the threshold it carries who authorised it.
  add('returns', 'refund_method', "refund_method TEXT NOT NULL DEFAULT 'cash'");
  add('returns', 'session_id', 'session_id INTEGER REFERENCES cash_sessions(id)');
  add('returns', 'authorised_by', 'authorised_by INTEGER REFERENCES users(id)');
  add('return_items', 'batch_id', 'batch_id INTEGER REFERENCES stock_batches(id)');
  // S1-05: a returned batch remembers the batch it was dispensed from, so a
  // recall on the original still finds the units that came back.
  add('stock_batches', 'origin', "origin TEXT NOT NULL DEFAULT 'purchase'");   // purchase / return
  add('stock_batches', 'origin_batch_id', 'origin_batch_id INTEGER REFERENCES stock_batches(id)');
  // S2-07: a till closed by an administrator without a count says so.
  add('cash_sessions', 'force_closed', 'force_closed INTEGER NOT NULL DEFAULT 0');
  add('cash_sessions', 'closed_by', 'closed_by INTEGER REFERENCES users(id)');
  // S2-12: lockout after repeated failures.
  add('users', 'failed_logins', 'failed_logins INTEGER NOT NULL DEFAULT 0');
  add('users', 'locked_until', 'locked_until TEXT');

  // S1-05 (4): no SALEABLE batch of medicine may carry a NULL expiry. Enforced
  // by the database, not only by the receive route, so no code path — a
  // return, an import, a fix-up script — can put undated medicine on the
  // shelf. A quarantined batch may lack the date; releasing it may not.
  // Sundries (product_types.is_medicine = 0) are exempt, as at goods receipt.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_batch_expiry_insert BEFORE INSERT ON stock_batches
    WHEN NEW.expiry_date IS NULL AND COALESCE(NEW.quarantined, 0) = 0
     AND COALESCE((SELECT COALESCE(pt.is_medicine, 1) FROM products p
                   LEFT JOIN product_types pt ON pt.id = p.product_type_id
                   WHERE p.id = NEW.product_id), 1) = 1
    BEGIN SELECT RAISE(ABORT, 'EXPIRY_REQUIRED: a saleable batch of medicine needs an expiry date'); END;
    CREATE TRIGGER IF NOT EXISTS trg_batch_expiry_release BEFORE UPDATE OF quarantined ON stock_batches
    WHEN NEW.quarantined = 0 AND OLD.quarantined = 1 AND NEW.expiry_date IS NULL
     AND COALESCE((SELECT COALESCE(pt.is_medicine, 1) FROM products p
                   LEFT JOIN product_types pt ON pt.id = p.product_type_id
                   WHERE p.id = NEW.product_id), 1) = 1
    BEGIN SELECT RAISE(ABORT, 'EXPIRY_REQUIRED: a batch with no expiry date cannot be released for sale'); END;
  `);

  migrateVendorBalances();
  renameKhataToCredit();
  refreshSystemRoles();

  // --- Phase 03: entitlements ---
  add('bills', 'welfare_card_id', 'welfare_card_id INTEGER REFERENCES welfare_cards(id)');
  add('bills', 'subsidy_fund_id', 'subsidy_fund_id INTEGER REFERENCES subsidy_funds(id)');
  seedEntitlements();
  // Everything that left the shelf before this column existed left it over the
  // counter. Without the backfill, gross margin — which is about to be re-keyed
  // on cost_centre = 'COUNTER' — would silently lose all of its history.
  db.exec("UPDATE stock_movements SET cost_centre = 'COUNTER' WHERE cost_centre IS NULL");
  db.exec("UPDATE bills SET cost_centre = 'COUNTER' WHERE cost_centre IS NULL");
}

// The three tiers the client named. Percentages and ceilings are data so the
// board adding a fourth is a settings change, not a release.
const CARD_TIERS = [
  ['CARD_100', 'Full support — 100%', 1.00],
  ['CARD_50', 'Half support — 50%', 0.50],
  ['CARD_20', 'Partial support — 20%', 0.20],
];

const SUBSIDY_FUNDS = [
  ['ZAKAT', 'Zakat fund'],
  ['DONATION', 'General donations'],
  ['TRUST', 'Trust own funds'],
  ['DIALYSIS', 'Dialysis programme'],
];

function seedEntitlements() {
  const tier = db.prepare(
    'INSERT INTO card_tiers (code, name, discount_pct, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO NOTHING'
  );
  const fund = db.prepare(
    'INSERT INTO subsidy_funds (code, name) VALUES (?, ?) ON CONFLICT(code) DO NOTHING'
  );
  db.transaction(() => {
    CARD_TIERS.forEach(([c, n, p], i) => tier.run(c, n, p, i));
    SUBSIDY_FUNDS.forEach(([c, n]) => fund.run(c, n));
  })();

  // Default scope, applied once per tier when it has none: medicine and the
  // dialysis charge are covered, cosmetics and general items are not.
  //
  // This is the Q2 assumption. It is seeded rather than hard-coded precisely so
  // the client's answer changes rows, not code.
  const excluded = ['Cosmetic', 'General item'];
  const scope = db.prepare(
    'INSERT INTO card_tier_scope (tier_id, product_type_id, item_type, covered) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const t of db.prepare('SELECT id FROM card_tiers').all()) {
      const has = db.prepare('SELECT 1 FROM card_tier_scope WHERE tier_id = ?').get(t.id);
      if (has) continue;
      scope.run(t.id, null, null, 1);                       // covered by default
      for (const name of excluded) {
        const pt = db.prepare('SELECT id FROM product_types WHERE name = ?').get(name);
        if (pt) scope.run(t.id, pt.id, 'pharmacy', 0);      // except these
      }
    }
  })();
}

// The ledger first shipped with Urdu terms in its STORED values — a
// `customer-khata` account kind, a `khata-recovery` cash category, `KHATA-<id>`
// references and "Udhaar" narrations. The client asked for English throughout,
// and relabelling the screens is not enough: `ledger_kind` decides which account
// a sale posts to, `category` is what the day book groups on, and the narrations
// are printed on the statement handed across the counter.
//
// So the stored values are renamed in place, once. Idempotent — it matches only
// the old spellings, so a restart is a no-op. The point is that a statement
// printed last week and one printed today read the same: a customer comparing
// two pages of the same account must not find two different vocabularies.
// Permissions are declared in code (DEFAULT_ROLES) and seeded into `roles`
// once, by seed.js on a fresh install. A permission introduced in a later
// phase never reached a database that already existed — Phase 06 added
// billing.amend and the live Administrator still could not amend a bill.
// So every start folds the code's defaults INTO the stored system roles.
// Additive only: a key is never removed, so a role tightened by hand (or a
// custom, non-system role) is left exactly as it was.
function refreshSystemRoles() {
  const { DEFAULT_ROLES } = require('./permissions');
  const get = db.prepare('SELECT id, permissions FROM roles WHERE name = ? AND is_system = 1');
  const set = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?');
  for (const r of DEFAULT_ROLES) {
    const row = get.get(r.name);
    if (!row) continue;
    let have = [];
    try { have = JSON.parse(row.permissions || '[]'); } catch { have = []; }
    const merged = Array.from(new Set([...have, ...r.permissions]));
    if (merged.length !== have.length) set.run(JSON.stringify(merged), row.id);
  }
}

function renameKhataToCredit() {
  db.transaction(() => {
    db.prepare(
      "UPDATE ledger_accounts SET ledger_kind = 'customer-credit' WHERE ledger_kind = 'customer-khata'"
    ).run();
    db.prepare(
      "UPDATE cash_transactions SET category = 'credit-recovery' WHERE category = 'khata-recovery'"
    ).run();
    // 'KHATA-' is six characters, so the id resumes at seven.
    db.prepare(
      "UPDATE cash_transactions SET reference = 'CREDIT-' || substr(reference, 7) WHERE reference LIKE 'KHATA-%'"
    ).run();
    // 'Udhaar — ' is nine characters; substr counts characters, not bytes, so the
    // em dash does not throw the offset out.
    db.prepare(
      "UPDATE ledger_entries SET narration = 'Credit — ' || substr(narration, 10) WHERE narration LIKE 'Udhaar — %'"
    ).run();
  })();
}

// Vendor payables predate the ledger: the amount lived on `vendors.balance` as a
// bare number with no history behind it, so the first correction left nothing to
// check it against.
//
// This carries each vendor's balance in as a single opening entry, once. From
// then on the entries are the truth and the column is a same-transaction cache.
// It is idempotent — a vendor that already has a party row is skipped — so a
// restart cannot double anybody's opening balance.
//
// A vendor balance is money WE owe, and by the sign convention in ledger.js that
// is still a DEBIT: outstanding in the account's own direction. `vendors.balance`
// and `ledger_accounts.balance` therefore hold the same number, which is what
// makes the migration checkable.
function migrateVendorBalances() {
  const pending = db
    .prepare(
      `SELECT v.* FROM vendors v
        WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.vendor_id = v.id)`
    )
    .all();
  if (!pending.length) return;

  const L = require('./ledger');
  db.transaction(() => {
    for (const v of pending) {
      const party = L.partyFor({ vendor: v });
      const acct = L.accountFor(party.id, 'vendor');
      const bal = Number(v.balance || 0);
      if (bal === 0) continue;
      L.post(acct.id, {
        debit: bal > 0 ? bal : 0,
        credit: bal < 0 ? -bal : 0,
        narration: 'Opening balance carried in from the vendor record',
      });
    }
  })();
}

// Q6 until the client answers. Three shifts is the common pattern for a unit
// running morning to evening; the unit's real names replace these in Admin
// without a release, because they are rows.
const DIALYSIS_SHIFTS = [
  ['Morning', '07:00', '11:00'],
  ['Afternoon', '11:30', '15:30'],
  ['Evening', '16:00', '20:00'],
];

function seedDialysisShifts() {
  const has = db.prepare('SELECT 1 FROM dialysis_shifts LIMIT 1').get();
  if (has) return;
  const ins = db.prepare(
    'INSERT INTO dialysis_shifts (name, starts_at, ends_at, sort_order) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => DIALYSIS_SHIFTS.forEach(([n, s, e], i) => ins.run(n, s, e, i)))();
}

// The nineteen rows of the unit's paper form, in the unit's own words and the
// paper's own order. Transcribed in hwt-client/forms/dialysis-demand-form.md.
//
// Do NOT tidy this wording. Recognition is what gets the screen adopted: a nurse
// holding the paper has to find the same row in the same place. "Inj-Antibiotec"
// is spelt the way the unit spells it on purpose.
//
//   label, column, freetext, emergency, multi-SKU (Q7)
const DEMAND_ROWS = [
  ['Inj-Neurobian', 1, 0, 0, 0],
  ['Inj-Mabil', 1, 0, 0, 0],
  ['Inj-Epocan 2000', 1, 0, 0, 0],
  ['Inj-Epocan 4000', 1, 0, 0, 0],
  ['Inj-Omeprazole', 1, 0, 0, 0],
  ['Inj-Antibiotec / Vancare', 1, 0, 0, 1],
  ['Inj-Iron', 1, 0, 0, 0],
  ['Inj-Paracetamol', 1, 0, 0, 0],
  ['Inj-Hyzonate', 1, 0, 0, 0],
  ['Inj-Toralak', 2, 0, 0, 0],
  ['Inj-Aron Plus', 2, 0, 0, 0],
  ['Inj-Gentamycin', 2, 0, 0, 0],
  ['Syringe 1cc / 3cc / 10cc', 2, 0, 0, 1],
  ['Gauze', 2, 0, 0, 0],
  ['IV set', 2, 0, 0, 0],
  ['N/S 1000 / 100 ml', 2, 0, 0, 1],
  ['other', 2, 1, 0, 0],
  ['Emergency', 2, 1, 1, 0],
];

function seedDemandTemplate() {
  const has = db.prepare('SELECT 1 FROM demand_templates LIMIT 1').get();
  if (has) return;
  db.transaction(() => {
    const t = db
      .prepare("INSERT INTO demand_templates (name) VALUES ('Dialysis Unit — Demand Form for Patient')")
      .run();
    const ins = db.prepare(
      `INSERT INTO demand_template_items
         (template_id, printed_label, column_no, sort_order, is_freetext, is_emergency)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    // Sort order restarts per column so the two columns print side by side the
    // way the paper does.
    let n1 = 0;
    let n2 = 0;
    for (const [label, col, free, emerg] of DEMAND_ROWS) {
      const order = col === 1 ? n1++ : n2++;
      ins.run(t.lastInsertRowid, label, col, order, free, emerg);
    }
  })();
  linkDemandProducts();
}

// Q7: which SKU does each printed row actually deduct?
//
// Guessed here by matching the printed label against the catalogue, so a fresh
// install is usable — but a guess is all it is. The rows the form itself marks
// as covering several SKUs (syringes, saline, the antibiotic choice) are left
// for the unit in-charge to map in Admin, because deducting the wrong syringe
// silently is worse than asking.
//
// Runs on every start-up but only fills rows that have NO product yet, so a
// mapping made by hand is never overwritten.
function linkDemandProducts() {
  const items = db
    .prepare(
      `SELECT i.* FROM demand_template_items i
        WHERE i.is_freetext = 0
          AND NOT EXISTS (SELECT 1 FROM demand_template_item_products p WHERE p.item_id = i.id)`
    )
    .all();
  if (!items.length) return;
  const find = db.prepare(
    "SELECT id FROM products WHERE lower(name) LIKE lower(?) AND is_active = 1 ORDER BY length(name) LIMIT 1"
  );
  const link = db.prepare(
    'INSERT OR IGNORE INTO demand_template_item_products (item_id, product_id, is_default) VALUES (?, ?, 1)'
  );
  db.transaction(() => {
    for (const it of items) {
      // "Inj-Epocan 2000" -> "epocan"; the catalogue rarely repeats the unit's
      // prefix or the strength in the same shape.
      const core = String(it.printed_label)
        .replace(/^Inj[-\s]*/i, '')
        .split('/')[0]
        .replace(/[0-9]+\s*(mg|ml|cc)?/gi, '')
        .trim();
      if (core.length < 3) continue;
      const hit = find.get('%' + core + '%');
      if (hit) link.run(it.id, hit.id);
    }
  })();
}

// Q13 until the client answers. Each is a customer of the pharmacy that receives
// an invoice, not a store that draws stock silently.
const DEPARTMENTS = [
  ['LAB', 'Laboratory'], ['EMERGENCY', 'Emergency'], ['WARD', 'Ward / IPD'],
  ['OT', 'Operating Theatre'], ['DIALYSIS', 'Dialysis Unit'], ['ADMIN', 'Administration'],
];

// A department is a customer of the pharmacy, so it needs a customer record —
// that record is what Phase 04 hangs its ledger account off, and what lets a
// department statement be produced the same way as anyone else's account.
//
// Idempotent and run on every start-up, so a department added later (or one
// whose customer record was deleted) heals itself rather than silently having
// nowhere to post an invoice.
function ensureDepartmentCustomers() {
  const missing = db.prepare('SELECT * FROM departments WHERE customer_id IS NULL').all();
  if (!missing.length) return;
  const findByCode = db.prepare('SELECT id FROM patients WHERE patient_code = ?');
  const insert = db.prepare(
    `INSERT INTO patients (patient_code, full_name, customer_type, contact, created_at)
     VALUES (?, ?, 'department', ?, datetime('now'))`
  );
  const link = db.prepare('UPDATE departments SET customer_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const d of missing) {
      // Readable rather than sequential: DEPT-LAB says what it is in every
      // statement and every export, and it is unique because the code is.
      const code = `DEPT-${d.code}`;
      const existing = findByCode.get(code);
      const id = existing ? existing.id : insert.run(code, d.name, d.contact || null).lastInsertRowid;
      link.run(id, d.id);
    }
  })();
}

function seedDepartments() {
  const ins = db.prepare(
    'INSERT INTO departments (code, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING'
  );
  db.transaction(() => {
    DEPARTMENTS.forEach(([code, name], i) => ins.run(code, name, i));
  })();
}

// The Pakistani pharmacy shelf. Seeded once; the administrator edits it after.
// `is_medicine` decides whether a batch number and expiry date are required on
// receipt — one definition, read by both the receive route and the compliance
// panel, instead of the string comparison that used to be copied between them.
const PRODUCT_TYPES = [
  // name, is_medicine, default tax, default schedule, default base unit
  ['Tablet', 1, 0, 'Rx', 'tab'], ['Capsule', 1, 0, 'Rx', 'cap'],
  ['Syrup', 1, 0, 'Rx', 'bottle'], ['Suspension', 1, 0, 'Rx', 'bottle'],
  ['Injection', 1, 0, 'Rx', 'vial'], ['IV infusion', 1, 0, 'Rx', 'bag'],
  ['Drops', 1, 0, 'Rx', 'bottle'], ['Inhaler', 1, 0, 'Rx', 'inhaler'],
  ['Ointment / Cream', 1, 0, 'Rx', 'tube'], ['Sachet', 1, 0, 'OTC', 'sachet'],
  ['Suppository', 1, 0, 'Rx', 'supp'],
  ['Surgical / Disposable', 0, 0.18, 'OTC', 'piece'], ['Dressing', 0, 0.18, 'OTC', 'piece'],
  ['Diagnostic / Test strip', 0, 0.18, 'OTC', 'strip'], ['Nutrition', 0, 0, 'OTC', 'pack'],
  ['Cosmetic', 0, 0.18, 'OTC', 'piece'], ['General item', 0, 0.18, 'OTC', 'piece'],
];

// The smallest thing that can be handed across the counter. Everything in the
// system is counted in these: stock, bill lines, the movement ledger.
const BASE_UNITS = [
  ['tab', 'tablet'], ['cap', 'capsule'], ['bottle', 'syrup, drops, suspension'],
  ['vial', 'injection vial'], ['amp', 'ampoule'], ['bag', 'IV bag'],
  ['sachet', 'powder sachet'], ['tube', 'cream or ointment tube'],
  ['inhaler', 'metered-dose inhaler'], ['supp', 'suppository'],
  ['strip', 'test strip'], ['pack', 'nutrition or general pack'],
  ['piece', 'anything counted singly'], ['ml', 'sold by volume'], ['gm', 'sold by weight'],
];

function seedBaseUnits() {
  const ins = db.prepare(
    'INSERT INTO base_units (name, descr, sort_order) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING'
  );
  db.transaction(() => { BASE_UNITS.forEach(([n, d], i) => ins.run(n, d, i)); })();
}

function seedProductTypes() {
  const ins = db.prepare(
    `INSERT INTO product_types (name, is_medicine, default_tax_pct, default_schedule, sort_order, default_unit)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING`
  );
  // Fill the default unit on rows seeded before the column existed, but never
  // overwrite one an administrator has set.
  const fix = db.prepare('UPDATE product_types SET default_unit = ? WHERE name = ? AND default_unit IS NULL');
  db.transaction(() => {
    PRODUCT_TYPES.forEach(([name, med, tax, sched, unit], i) => {
      ins.run(name, med, tax, sched, i, unit);
      fix.run(unit, name);
    });
  })();
}

// Map the old free-text products.form onto the list, once. Anything that does
// not match is treated as MEDICINE — requiring a batch on an item that turns out
// to be a bandage is an annoyance; letting real medicine in without one is not.
function backfillProductTypes() {
  db.transaction(() => {
    db.exec(`
      UPDATE products SET product_type_id = (
        SELECT id FROM product_types pt WHERE lower(pt.name) = lower(products.form)
      ) WHERE product_type_id IS NULL AND form IS NOT NULL`);
    const general = db.prepare("SELECT id FROM product_types WHERE name = 'General item'").get();
    const tablet = db.prepare("SELECT id FROM product_types WHERE name = 'Tablet'").get();
    // 'Item' was the old marker for a general-sale sundry; everything else
    // unmatched keeps the safer medicine default.
    db.prepare(
      "UPDATE products SET product_type_id = ? WHERE product_type_id IS NULL AND drug_schedule = 'OTC' AND form = 'Item'"
    ).run(general.id);
    db.prepare('UPDATE products SET product_type_id = ? WHERE product_type_id IS NULL').run(tablet.id);
  })();
}

// Every distinct spelling already in products.manufacturer becomes a row, and
// the products point at it. Merging the duplicates is an admin screen job — the
// data has to exist before it can be merged.
function backfillManufacturers() {
  db.transaction(() => {
    db.exec(`
      INSERT INTO manufacturers (name)
      SELECT DISTINCT trim(manufacturer) FROM products
       WHERE manufacturer IS NOT NULL AND trim(manufacturer) <> ''
      ON CONFLICT(name) DO NOTHING`);
    db.exec(`
      UPDATE products SET manufacturer_id = (
        SELECT id FROM manufacturers m WHERE m.name = trim(products.manufacturer)
      ) WHERE manufacturer_id IS NULL AND manufacturer IS NOT NULL`);
  })();
}

// Atomic sequence generator for human-facing codes (Patient ID, Bill No, tokens).
const nextSeqStmt = db.transaction((name) => {
  db.prepare(
    `INSERT INTO counters(name, value) VALUES(?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`
  ).run(name);
  return db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value;
});

function nextSeq(name) {
  return nextSeqStmt(name);
}

module.exports = { db, init, nextSeq, ensureDepartmentCustomers };
