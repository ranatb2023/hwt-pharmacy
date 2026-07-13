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
  const products = [
    ['MED-PARA', 'Paracetamol 500mg', 'Paracetamol', 'Tablet', 0, 2, 50],
    ['MED-AMOX', 'Amoxicillin 500mg', 'Amoxicillin', 'Capsule', 0, 8, 40],
    ['MED-ORS', 'ORS Sachet', 'Oral Rehydration Salt', 'Sachet', 1, 15, 30],
    ['MED-METF', 'Metformin 500mg', 'Metformin', 'Tablet', 0, 3, 40],
    ['MED-OMEP', 'Omeprazole 20mg', 'Omeprazole', 'Capsule', 0, 5, 40],
    ['OTC-BAND', 'Bandage Roll', null, 'Item', 1, 40, 20],
  ];
  const insProd = db.prepare(
    `INSERT INTO products (sku, name, generic_name, form, is_otc, sale_price, reorder_level)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sku) DO NOTHING`
  );
  const insBatch = db.prepare(
    `INSERT INTO stock_batches (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insMove = db.prepare(
    `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason)
     VALUES (?, ?, 'purchase', ?, 'Opening stock')`
  );
  for (const p of products) {
    insProd.run(...p);
    const prod = db.prepare('SELECT id FROM products WHERE sku = ?').get(p[0]);
    // Only add opening stock if none exists yet.
    const has = db.prepare('SELECT 1 FROM stock_batches WHERE product_id = ? LIMIT 1').get(prod.id);
    if (!has) {
      const batch = insBatch.run(prod.id, 'B-OPEN', '2027-12-31', 'Generic Pharma', p[5] * 0.6, 200);
      insMove.run(prod.id, batch.lastInsertRowid, 200);
    }
  }

  // --- Dialysis stations ---
  const insStation = db.prepare("INSERT INTO dialysis_stations (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  ['Station A', 'Station B', 'Station C', 'Station D'].forEach((s) => insStation.run(s));

  // --- Dialysis consumables (products) ---
  const consumables = [
    ['DLY-KIT', 'Dialyzer Kit', null, 'Kit', 0, 1200, 20],
    ['DLY-SAL', 'Saline 1000ml', null, 'Bottle', 0, 120, 30],
  ];
  for (const c of consumables) {
    insProd.run(...c);
    const prod = db.prepare('SELECT id FROM products WHERE sku = ?').get(c[0]);
    const has = db.prepare('SELECT 1 FROM stock_batches WHERE product_id = ? LIMIT 1').get(prod.id);
    if (!has) {
      const batch = insBatch.run(prod.id, 'B-OPEN', '2027-12-31', 'MedSupply', c[5] * 0.6, 100);
      insMove.run(prod.id, batch.lastInsertRowid, 100);
    }
  }

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
