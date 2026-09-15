// Register a starter set of employees on the staff rate.
//
//   node scripts/seed-employees.js            # add anyone missing
//   node scripts/seed-employees.js --list     # just show who is already there
//
// Idempotent, keyed on the mobile number: running it twice adds nobody twice.
// It only ever INSERTs — no employee is edited or removed, so it is safe to run
// against a live database. Change a cap afterwards in Admin > Employees.
const path = require('path');
const { db, init } = require(path.join(__dirname, '..', 'src', 'db'));
const { newPatientCode, newQrToken } = require(path.join(__dirname, '..', 'src', 'utils'));
const { getSetting } = require(path.join(__dirname, '..', 'src', 'settings'));

// name, designation, mobile, yearly allowance (null = the trust default)
const EMPLOYEES = [
  ['Nasreen Bibi', 'Staff Nurse', '03001112221', null],
  ['Bashir Ahmed', 'Lab Technician', '03001112222', null],
  ['Saima Yousaf', 'Dialysis Technician', '03001112223', 35000],
  ['Muhammad Iqbal', 'Ward Attendant', '03001112224', 10000],
  ['Rehana Kausar', 'Cleaner', '03001112225', 5000],
];

init();

const fmt = (n) => 'Rs ' + Number(n).toLocaleString('en-PK');
const dflt = Number(getSetting('staff_annual_cap'));

if (process.argv.includes('--list')) {
  const rows = db
    .prepare(
      `SELECT patient_code, full_name, designation, contact, staff_cap
         FROM patients WHERE category = 'Staff' OR customer_type = 'staff'
        ORDER BY full_name`
    )
    .all();
  console.log(`Employees on the staff rate (trust default ${fmt(dflt)}/year):\n`);
  if (!rows.length) console.log('  none yet');
  rows.forEach((r) => console.log(
    `  ${r.patient_code}  ${String(r.full_name).padEnd(18)}`
    + `${String(r.designation || '').padEnd(22)}${String(r.contact || '').padEnd(14)}`
    + (r.staff_cap == null ? `${fmt(dflt)} (default)` : `${fmt(r.staff_cap)} (personal)`)));
  process.exit(0);
}

const find = db.prepare('SELECT id, full_name FROM patients WHERE contact = ?');
const insert = db.prepare(
  `INSERT INTO patients
     (patient_code, full_name, designation, contact, category, customer_type,
      staff_cap, qr_token, consent_online, created_at)
   VALUES (?, ?, ?, ?, 'Staff', 'staff', ?, ?, 0, datetime('now'))`
);

let added = 0;
let skipped = 0;
db.transaction(() => {
  for (const [name, designation, contact, cap] of EMPLOYEES) {
    const existing = find.get(contact);
    if (existing) {
      console.log(`  skip   ${name} — ${contact} is already ${existing.full_name}`);
      skipped++;
      continue;
    }
    const code = newPatientCode();
    insert.run(code, name, designation, contact, cap, newQrToken());
    console.log(`  added  ${code}  ${name.padEnd(18)}${String(designation).padEnd(22)}`
      + (cap == null ? `${fmt(dflt)} (trust default)` : `${fmt(cap)} (personal cap)`));
    added++;
  }
})();

console.log(`\n${added} added, ${skipped} already present.`);
console.log('Set or change any allowance in Admin > Employees.');
