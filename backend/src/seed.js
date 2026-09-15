const bcrypt = require('bcryptjs');
const { db, init } = require('./db');
const { DEFAULT_ROLES } = require('./permissions');

init();

console.log('Seeding HWT HMS database...');

const seed = db.transaction(() => {
  // --- Roles ---
  const roleId = {};
  const upsertRole = db.prepare(
    `INSERT INTO roles (name, description, permissions, is_system)
     VALUES (@name, @description, @permissions, 1)
     ON CONFLICT(name) DO UPDATE SET permissions = excluded.permissions, description = excluded.description`
  );
  for (const r of DEFAULT_ROLES) {
    upsertRole.run({ name: r.name, description: r.description, permissions: JSON.stringify(r.permissions) });
    roleId[r.name] = db.prepare('SELECT id FROM roles WHERE name = ?').get(r.name).id;
  }

  // --- Users (username / password / role) ---
  const users = [
    ['admin', 'admin123', 'System Administrator', 'Administrator', 'Administration'],
    ['reception', 'pass123', 'Front Desk', 'Receptionist', 'Reception'],
    ['doctor', 'pass123', 'Dr. Ayesha Khan', 'Doctor', 'OPD'],
    ['lab', 'pass123', 'Lab Technician', 'Lab Technician', 'Laboratory'],
    ['pharmacy', 'pass123', 'Pharmacist', 'Pharmacist', 'Pharmacy'],
    ['cashier', 'pass123', 'Cashier', 'Cashier', 'Billing'],
  ];
  const insUser = db.prepare(
    `INSERT INTO users (username, full_name, password_hash, role_id, department)
     VALUES (@username, @full_name, @hash, @role_id, @department)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role_id = excluded.role_id`
  );
  for (const [username, password, full_name, role, department] of users) {
    insUser.run({ username, full_name, hash: bcrypt.hashSync(password, 10), role_id: roleId[role], department });
  }

  // --- Lab test catalogue ---
  const labTests = [
    ['CBC', 'Complete Blood Count', 'Blood', '', '', 400],
    ['BSF', 'Blood Sugar Fasting', 'Blood', '70-100', 'mg/dL', 150],
    ['LFT', 'Liver Function Test', 'Blood', '', '', 900],
    ['RFT', 'Renal Function Test', 'Blood', '', '', 900],
    ['URINE', 'Urine Routine Examination', 'Urine', '', '', 200],
    ['HBA1C', 'HbA1c', 'Blood', '<5.7', '%', 700],
  ];
  const insTest = db.prepare(
    `INSERT INTO lab_tests (code, name, sample_type, normal_range, unit, price)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO NOTHING`
  );
  for (const t of labTests) insTest.run(...t);

  // --- Products + opening stock ---
  // Named fields, not a positional tuple: this row has grown past a dozen
  // columns and a mis-ordered array here would be silent, not a crash.
  //
  // Packaging follows how the medicine is actually boxed in Pakistan. Prices are
  // per BASE UNIT (one tablet / capsule / bottle) - the counter derives the
  // strip and box price from it, so the three can never disagree.
  const products = [
    { sku: 'MED-PARA', name: 'Panadol 500mg', generic_name: 'Paracetamol', form: 'Tablet', unit: 'tab',
      strength: '500mg', units_per_strip: 10, strips_per_box: 20, allow_loose: 1,
      drug_schedule: 'OTC', drap_reg_no: '000123', sale_price: 2, mrp: 2.5,
      manufacturer: 'GSK', is_refrigerated: 0, reorder_level: 400 },

    { sku: 'MED-AMOX', name: 'Amoxil 500mg', generic_name: 'Amoxicillin', form: 'Capsule', unit: 'cap',
      strength: '500mg', units_per_strip: 10, strips_per_box: 10, allow_loose: 0, // full course only
      drug_schedule: 'Rx', drap_reg_no: '001456', sale_price: 8, mrp: 9,
      manufacturer: 'GSK', is_refrigerated: 0, reorder_level: 100 },

    { sku: 'MED-ORS', name: 'ORS Sachet', generic_name: 'Oral Rehydration Salt', form: 'Sachet', unit: 'sachet',
      strength: null, units_per_strip: 1, strips_per_box: 25, allow_loose: 1,
      drug_schedule: 'OTC', drap_reg_no: '002789', sale_price: 15, mrp: 18,
      manufacturer: 'Searle', is_refrigerated: 0, reorder_level: 50 },

    { sku: 'MED-METF', name: 'Glucophage 500mg', generic_name: 'Metformin', form: 'Tablet', unit: 'tab',
      strength: '500mg', units_per_strip: 20, strips_per_box: 5, allow_loose: 1,
      drug_schedule: 'Rx', drap_reg_no: '003012', sale_price: 3, mrp: 3.5,
      manufacturer: 'Merck', is_refrigerated: 0, reorder_level: 200 },

    { sku: 'MED-OMEP', name: 'Risek 20mg', generic_name: 'Omeprazole', form: 'Capsule', unit: 'cap',
      strength: '20mg', units_per_strip: 14, strips_per_box: 2, allow_loose: 1,
      drug_schedule: 'Rx', drap_reg_no: '004345', sale_price: 6, mrp: 6,
      manufacturer: 'Getz Pharma', is_refrigerated: 0, reorder_level: 140 },

    { sku: 'MED-INSU', name: 'Humulin 70/30', generic_name: 'Insulin Human', form: 'Injection', unit: 'vial',
      strength: '100IU/ml', units_per_strip: 1, strips_per_box: 1, allow_loose: 1,
      drug_schedule: 'G', drap_reg_no: '005678', sale_price: 950, mrp: 1050,
      manufacturer: 'Eli Lilly', is_refrigerated: 1, reorder_level: 10 },

    { sku: 'MED-TRAM', name: 'Tramal 50mg', generic_name: 'Tramadol', form: 'Capsule', unit: 'cap',
      strength: '50mg', units_per_strip: 10, strips_per_box: 3, allow_loose: 0,
      drug_schedule: 'Narcotic', drap_reg_no: '006901', sale_price: 28, mrp: 32,
      manufacturer: 'Searle', is_refrigerated: 0, reorder_level: 30 },

    { sku: 'OTC-BAND', name: 'Bandage Roll', generic_name: null, form: 'Item', unit: 'roll',
      strength: null, units_per_strip: 1, strips_per_box: 1, allow_loose: 1,
      drug_schedule: 'OTC', drap_reg_no: null, sale_price: 40, mrp: 45,
      manufacturer: null, is_refrigerated: 0, reorder_level: 20 },
  ];

  const insProd = db.prepare(
    `INSERT INTO products
       (sku, name, generic_name, form, unit, strength, units_per_strip, strips_per_box, allow_loose,
        pack_size, is_otc, drug_schedule, drap_reg_no, sale_price, mrp, manufacturer,
        is_refrigerated, reorder_level)
     VALUES
       (@sku, @name, @generic_name, @form, @unit, @strength, @units_per_strip, @strips_per_box, @allow_loose,
        @pack_size, @is_otc, @drug_schedule, @drap_reg_no, @sale_price, @mrp, @manufacturer,
        @is_refrigerated, @reorder_level)
     ON CONFLICT(sku) DO NOTHING`
  );
  const insBatch = db.prepare(
    `INSERT INTO stock_batches (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity, mrp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insMove = db.prepare(
    `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason)
     VALUES (?, ?, 'purchase', ?, 'Opening stock')`
  );

  // Opening batches expire on a stagger rather than all on one date, so a fresh
  // install shows the expiry buckets and the claim window doing something.
  const inMonths = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  };
  const EXPIRY_STAGGER = [24, 18, 2, 30, 12, 5, 20, 36];

  // Opening stock is stated in boxes, the way it arrives from the distributor,
  // and converted to base units here.
  const OPENING_BOXES = [3, 2, 4, 3, 5, 12, 2, 30];

  function seedProduct(p, idx, boxes, stagger, mfrFallback) {
    p.pack_size = p.units_per_strip * p.strips_per_box;
    p.is_otc = p.drug_schedule === 'OTC' ? 1 : 0;
    insProd.run(p);
    const prod = db.prepare('SELECT id FROM products WHERE sku = ?').get(p.sku);
    // Only add opening stock if none exists yet.
    if (db.prepare('SELECT 1 FROM stock_batches WHERE product_id = ? LIMIT 1').get(prod.id)) return;
    const qty = boxes * p.pack_size;
    const batch = insBatch.run(
      prod.id,
      `B-${String(1000 + idx)}`,
      inMonths(stagger),
      p.manufacturer || mfrFallback,
      Math.round(p.sale_price * 0.6 * 100) / 100,
      qty,
      p.mrp || p.sale_price
    );
    insMove.run(prod.id, batch.lastInsertRowid, qty);
  }

  products.forEach((p, idx) =>
    seedProduct(p, idx, OPENING_BOXES[idx], EXPIRY_STAGGER[idx % EXPIRY_STAGGER.length], 'Generic Pharma')
  );

  // --- Dialysis stations ---
  const insStation = db.prepare("INSERT INTO dialysis_stations (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  ['Station A', 'Station B', 'Station C', 'Station D'].forEach((s) => insStation.run(s));

  // --- Dialysis consumables (products) ---
  const consumables = [
    { sku: 'DLY-KIT', name: 'Dialyzer Kit', generic_name: null, form: 'Kit', unit: 'kit',
      strength: null, units_per_strip: 1, strips_per_box: 1, allow_loose: 1,
      drug_schedule: 'Rx', drap_reg_no: '007234', sale_price: 1200, mrp: 1300,
      manufacturer: 'MedSupply', is_refrigerated: 0, reorder_level: 20 },
    { sku: 'DLY-SAL', name: 'Saline 1000ml', generic_name: null, form: 'Bottle', unit: 'bottle',
      strength: '0.9%', units_per_strip: 1, strips_per_box: 12, allow_loose: 1,
      drug_schedule: 'Rx', drap_reg_no: '007567', sale_price: 120, mrp: 135,
      manufacturer: 'MedSupply', is_refrigerated: 0, reorder_level: 30 },
  ];
  consumables.forEach((c, idx) => seedProduct(c, 100 + idx, idx === 0 ? 100 : 9, 15, 'MedSupply'));

  // --- Sample vendor ---
  if (!db.prepare('SELECT 1 FROM vendors LIMIT 1').get()) {
    db.prepare('INSERT INTO vendors (name, contact, address) VALUES (?, ?, ?)')
      .run('Generic Pharma Distributors', '042-111-000', 'Lahore');
  }

  // --- Demo donor account ---
  if (!db.prepare('SELECT 1 FROM donors WHERE email = ?').get('donor@example.com')) {
    db.prepare('INSERT INTO donors (name, email, contact, password_hash) VALUES (?, ?, ?, ?)')
      .run('Demo Donor', 'donor@example.com', '0300-0000000', bcrypt.hashSync('donor123', 10));
  }
});

seed();
console.log('Seed complete.');
console.log('Login accounts (username / password):');
console.log('  admin / admin123        (Administrator)');
console.log('  reception / pass123     (Receptionist)');
console.log('  doctor / pass123        (Doctor)');
console.log('  lab / pass123           (Lab Technician)');
console.log('  pharmacy / pass123      (Pharmacist)');
console.log('  cashier / pass123       (Cashier)');
console.log('Donor portal: donor@example.com / donor123');
process.exit(0);
