// Demo data — enough of a working month to click through every screen.
//
//   node scripts/seed-demo.js            # add it
//   node scripts/seed-demo.js --remove   # take it all out again
//   node scripts/seed-demo.js --status   # what is currently in
//
// WHY THIS LOGS WHAT IT CREATES
//
// This runs against a database that already has real rows in it. "Delete the
// demo data" cannot mean "delete everything that looks like demo data" — a
// guess like that eventually deletes a real patient with an unlucky name. So
// every row this script writes is recorded in `demo_seed_log`, and --remove
// deletes exactly those ids, in reverse order, and nothing else.
//
// WHY IT IS BACKDATED
//
// Data all stamped today makes the aging buckets, the monthly margin trend and
// the fiscal-year report look empty or wrong, which is precisely what needs
// testing. Sales are spread over the last five months and debts are aged across
// the 30/60/90 boundaries on purpose.
const path = require('path');
const { db, init } = require(path.join(__dirname, '..', 'src', 'db'));
const { pad } = require(path.join(__dirname, '..', 'src', 'utils'));

init();

const REMOVE = process.argv.includes('--remove');
const STATUS = process.argv.includes('--status');

db.exec(`
  CREATE TABLE IF NOT EXISTS demo_seed_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id     INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const logStmt = db.prepare('INSERT INTO demo_seed_log (table_name, row_id) VALUES (?, ?)');
function ins(table, sql, params) {
  const info = db.prepare(sql).run(params);
  logStmt.run(table, info.lastInsertRowid);
  return info.lastInsertRowid;
}

// ---------------------------------------------------------------------------
function status() {
  const rows = db
    .prepare('SELECT table_name, COUNT(*) n FROM demo_seed_log GROUP BY table_name ORDER BY table_name')
    .all();
  if (!rows.length) { console.log('No demo data is loaded.'); return; }
  console.log('Demo data currently loaded:\n');
  rows.forEach((r) => console.log(`  ${r.table_name.padEnd(24)} ${r.n}`));
  console.log('\nRemove it with:  node scripts/seed-demo.js --remove');
}

function remove() {
  const rows = db.prepare('SELECT * FROM demo_seed_log ORDER BY id DESC').all();
  if (!rows.length) { console.log('Nothing to remove — no demo data is loaded.'); return; }
  let gone = 0;
  let kept = 0;
  db.transaction(() => {
    for (const r of rows) {
      try {
        db.prepare(`DELETE FROM ${r.table_name} WHERE id = ?`).run(r.row_id);
        gone++;
      } catch (e) {
        // A row something real now points at. Leave it and say so rather than
        // forcing it out and breaking the thing that referenced it.
        kept++;
      }
    }
    db.exec('DELETE FROM demo_seed_log');
  })();
  console.log(`Removed ${gone} demo rows.`);
  if (kept) console.log(`${kept} could not be removed because real data now references them.`);
}

if (STATUS) { status(); process.exit(0); }
if (REMOVE) { remove(); process.exit(0); }

if (db.prepare('SELECT COUNT(*) n FROM demo_seed_log').get().n > 0) {
  console.log('Demo data is already loaded. Remove it first:');
  console.log('  node scripts/seed-demo.js --remove');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const money = (n) => Math.round(n * 100) / 100;

const DAY = 86400000;
function ago(days, hour = 11) {
  // Stored UTC; the counter reads it at +5. Written at a working local hour so
  // nothing lands on a timezone boundary by accident and confuses the very
  // report this data exists to exercise.
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour - 5, rint(0, 59), rint(0, 59), 0);
  // NEVER in the future. Today's slot can be an hour that has not happened yet,
  // and a record dated ahead of the clock trips the start-up guard in
  // server.js — which is exactly what that guard is for, and it caught this.
  const t = Math.min(d.getTime(), Date.now() - 60000);
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}
const dateOf = (ts) => new Date(`${ts.replace(' ', 'T')}Z`).toISOString().slice(0, 10);

const seq = {};
function nextNo(prefix, width, key) {
  const row = db.prepare('SELECT COALESCE(MAX(value), 0) v FROM counters WHERE name = ?').get(key);
  if (seq[key] === undefined) seq[key] = row.v + 1000; // clear of anything real
  seq[key] += 1;
  return `${prefix}${pad(seq[key], width)}`;
}
const billNo = () => `INV-DEMO-${pad(++seq.b || (seq.b = 1), 5)}`;

const admin = db.prepare("SELECT id, full_name FROM users ORDER BY id LIMIT 1").get();
const USER = admin ? admin.id : 1;

console.log('Adding demo data…\n');

// ---------------------------------------------------------------------------
// 1. Catalogue — several companies and two distributors, or the profitability
//    report has nothing to group by.
// ---------------------------------------------------------------------------
const MAKERS = ['Getz Pharma', 'Searle Pakistan', 'Hilton Pharma', 'Sami Pharmaceuticals'];
const makerIds = {};
for (const m of MAKERS) {
  const found = db.prepare('SELECT id FROM manufacturers WHERE name = ?').get(m);
  makerIds[m] = found ? found.id
    : ins('manufacturers', 'INSERT INTO manufacturers (name) VALUES (?)', [m]);
}

const DISTRIBUTORS = ['Al-Habib Distributors', 'Muslim Traders Karachi'];
const distIds = {};
for (const v of DISTRIBUTORS) {
  const found = db.prepare('SELECT id FROM vendors WHERE name = ?').get(v);
  distIds[v] = found ? found.id
    : ins('vendors', 'INSERT INTO vendors (name, contact, balance, is_active) VALUES (?, ?, 0, 1)',
      [v, `0300${rint(1000000, 9999999)}`]);
}

//  name, maker, unit, cost, sale, schedule
const PRODUCTS = [
  ['Brufen 400mg', 'Getz Pharma', 'tablet', 6, 11, 'OTC'],
  ['Augmentin 625mg', 'Getz Pharma', 'tablet', 34, 52, 'Rx'],
  ['Risek 20mg', 'Searle Pakistan', 'capsule', 9, 16, 'OTC'],
  ['Panadol Extra', 'Searle Pakistan', 'tablet', 3, 6, 'OTC'],
  ['Ventolin Inhaler', 'Hilton Pharma', 'inhaler', 260, 395, 'Rx'],
  ['Surbex-Z', 'Hilton Pharma', 'tablet', 7, 13, 'OTC'],
  ['Disprin', 'Sami Pharmaceuticals', 'tablet', 2, 4, 'OTC'],
  ['Polyfax Ointment', 'Sami Pharmaceuticals', 'tube', 88, 140, 'OTC'],
];

const prodIds = [];
for (const [name, maker, unit, cost, sale, sched] of PRODUCTS) {
  let id = (db.prepare('SELECT id FROM products WHERE name = ?').get(name) || {}).id;
  if (!id) {
    id = ins('products',
      `INSERT INTO products (sku, name, form, unit, sale_price, mrp, drug_schedule, is_active,
                             manufacturer_id, units_per_strip, strips_per_box, allow_loose, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 10, 10, 1, 20)`,
      [`DEMO-${pad(prodIds.length + 1, 3)}`, name, 'Tablet', unit, sale, sale, sched, makerIds[maker]]);
  }
  prodIds.push({ id, name, cost, sale, sched });

  // Two batches from two distributors at different costs, so FEFO crosses them
  // and margin-by-distributor has something real to split.
  ins('stock_batches',
    `INSERT INTO stock_batches (product_id, batch_no, expiry_date, cost_price, mrp, quantity, vendor_id, manufacturer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `D-${pad(prodIds.length, 2)}A`, '2027-06-30', cost, sale, 400,
      distIds[DISTRIBUTORS[0]], maker]);
  ins('stock_batches',
    `INSERT INTO stock_batches (product_id, batch_no, expiry_date, cost_price, mrp, quantity, vendor_id, manufacturer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, `D-${pad(prodIds.length, 2)}B`, '2028-03-31', money(cost * 1.12), sale, 600,
      distIds[DISTRIBUTORS[1]], maker]);
}
console.log(`  catalogue     ${PRODUCTS.length} products, ${MAKERS.length} companies, ${DISTRIBUTORS.length} distributors`);

// ---------------------------------------------------------------------------
// 2. Customers
// ---------------------------------------------------------------------------
const NAMES = [
  'Muhammad Aslam', 'Fatima Bibi', 'Abdul Rehman', 'Ayesha Siddiqua', 'Imran Haider',
  'Zainab Khatoon', 'Tariq Mehmood', 'Saira Bano', 'Nadeem Akhtar', 'Rukhsana Parveen',
  'Shahid Iqbal', 'Kulsoom Akram', 'Bilal Ahmad', 'Naseem Akhtar', 'Javed Iqbal',
  'Shazia Kanwal', 'Asif Mahmood', 'Rubina Yasmin',
];

const custIds = [];
NAMES.forEach((n, i) => {
  const code = nextNo('DEMO-C', 4, 'demo_customer');
  const id = ins('patients',
    `INSERT INTO patients (patient_code, full_name, gender, age, contact, customer_type, category, qr_token, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'registered', 'Paid', ?, ?, ?)`,
    [code, n, i % 2 ? 'Female' : 'Male', rint(19, 74), `0300${pad(2000000 + i, 7)}`,
      `demo-${code}`, ago(rint(40, 200)), USER]);
  custIds.push({ id, name: n });
});
console.log(`  customers     ${custIds.length}`);

// ---------------------------------------------------------------------------
// 3. Welfare cards — one per tier, so the counter and the day book have all
//    three to segment by.
// ---------------------------------------------------------------------------
const tiers = db.prepare('SELECT * FROM card_tiers ORDER BY sort_order').all();
const fund = db.prepare("SELECT id FROM subsidy_funds WHERE code = 'ZAKAT'").get();
const cardHolders = [];
tiers.forEach((t, i) => {
  const c = custIds[i];
  const cardNo = nextNo('DEMO-WC-', 4, 'demo_card');
  const id = ins('welfare_cards',
    `INSERT INTO welfare_cards (card_no, customer_id, tier_id, fund_id, issued_on, valid_till, status, qr_token, approved_by, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'Trust Board', ?)`,
    [cardNo, c.id, t.id, fund ? fund.id : null, dateOf(ago(120)), '2027-12-31',
      `demo-card-${cardNo}`, USER]);
  cardHolders.push({ ...c, tier: t, card_id: id });
});
console.log(`  welfare cards ${cardHolders.length} (${tiers.map((t) => t.name).join(', ')})`);

// ---------------------------------------------------------------------------
// 4. Five months of counter sales
//
//    Spread across segments so the day book has something in every section and
//    the margin trend has a shape rather than one spike.
// ---------------------------------------------------------------------------
const staff = db.prepare("SELECT id, full_name FROM patients WHERE category = 'Staff' OR customer_type = 'staff'").all();

let billCount = 0;
let saleValue = 0;
const madeBills = [];

function writeSale({ when, customer, chargeClass, cardId, method, lines, costCentre = 'COUNTER', billType = 'pharmacy-sale' }) {
  const no = billNo();
  let gross = 0;
  for (const l of lines) gross += l.qty * l.unit;
  gross = money(gross);

  let discount = 0;
  let subsidy = 0;
  if (chargeClass === 'CARD_50') discount = money(gross * 0.5);
  else if (chargeClass === 'CARD_20') discount = money(gross * 0.2);
  else if (chargeClass === 'CARD_100' || chargeClass === 'ZAKAT') subsidy = gross;
  else if (chargeClass === 'STAFF') discount = gross;
  else if (chargeClass === 'DIALYSIS_FREE') subsidy = gross;
  const net = money(gross - discount - subsidy);
  const paid = method === 'credit' ? 0 : net;

  const id = ins('bills',
    `INSERT INTO bills (bill_no, patient_id, customer_name, category, bill_type, cost_centre,
                        charge_class, welfare_card_id, subsidy_fund_id, gross_amount, discount,
                        subsidy, net_amount, paid_amount, payment_method, status, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [no, customer ? customer.id : null, customer ? customer.name : 'Walk-in customer',
      chargeClass === 'STAFF' ? 'Staff' : 'Paid', billType, costCentre, chargeClass,
      cardId || null, (chargeClass === 'CARD_100' || chargeClass === 'ZAKAT') && fund ? fund.id : null,
      gross, discount, subsidy, net, paid, method,
      method === 'credit' ? 'unpaid' : 'paid', when, USER]);

  for (const l of lines) {
    ins('bill_items',
      `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
       VALUES (?, 'pharmacy', ?, ?, ?, ?, ?)`,
      [id, l.product.id, l.product.name, l.qty, l.unit, money(l.qty * l.unit)]);

    // The movement is what margin reads, so it has to name a real batch.
    const batches = db
      .prepare('SELECT id, cost_price, quantity FROM stock_batches WHERE product_id = ? AND quantity > 0 ORDER BY expiry_date')
      .all(l.product.id);
    let left = l.qty;
    for (const b of batches) {
      if (left <= 0) break;
      const take = Math.min(b.quantity, left);
      db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?').run(take, b.id);
      ins('stock_movements',
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id, cost_centre, charge_class, created_at)
         VALUES (?, ?, 'dispense', ?, ?, 'demo sale', ?, ?, ?, ?)`,
        [l.product.id, b.id, -take, no, USER, costCentre, chargeClass, when]);
      left -= take;
    }
  }
  billCount++;
  saleValue += net;
  madeBills.push({ id, no, when, net, chargeClass });
  return { id, no, gross, net };
}

const METHODS = ['cash', 'cash', 'cash', 'card', 'online'];
for (let d = 150; d >= 0; d -= 1) {
  // Not every day, and busier recently — a flat line looks synthetic and hides
  // whether the trend chart is actually working.
  if (d > 30 && d % 3 !== 0) continue;
  const perDay = d > 30 ? rint(2, 5) : rint(4, 9);
  for (let k = 0; k < perDay; k++) {
    const lines = [];
    for (let n = 0; n < rint(1, 3); n++) {
      const p = pick(prodIds);
      lines.push({ product: p, qty: rint(1, 12), unit: p.sale });
    }
    const roll = Math.random();
    let chargeClass = 'PAID';
    let customer = null;
    let cardId = null;
    let method = pick(METHODS);

    if (roll < 0.12 && cardHolders.length) {
      const h = pick(cardHolders);
      customer = h; cardId = h.card_id; chargeClass = h.tier.code;
    } else if (roll < 0.18 && staff.length) {
      const s = pick(staff);
      customer = { id: s.id, name: s.full_name }; chargeClass = 'STAFF';
    } else if (roll < 0.30) {
      customer = pick(custIds);
      if (roll < 0.22) method = 'credit';
    }
    writeSale({ when: ago(d, rint(9, 19)), customer, chargeClass, cardId, method, lines });
  }
}
console.log(`  counter sales ${billCount} bills over 5 months, Rs ${Math.round(saleValue).toLocaleString('en-PK')}`);

// ---------------------------------------------------------------------------
// 5. Credit accounts, aged across the buckets on purpose
// ---------------------------------------------------------------------------
const L = require(path.join(__dirname, '..', 'src', 'ledger'));
const DEBTS = [
  { who: 3, age: 8, amount: 1450, limit: 5000 },
  { who: 4, age: 42, amount: 2600, limit: 5000 },
  { who: 5, age: 71, amount: 900, limit: 2000 },
  // Deliberately still over its limit AFTER the part payment below, so the
  // over-limit state is actually visible on the screen that shows it.
  { who: 6, age: 118, amount: 6400, limit: 3000 },
  { who: 7, age: 35, amount: 1200, limit: null },
];
let acctCount = 0;
db.transaction(() => {
  for (const dbt of DEBTS) {
    const c = custIds[dbt.who];
    const person = db.prepare('SELECT * FROM patients WHERE id = ?').get(c.id);
    const party = L.partyFor({ customer: person });
    logStmt.run('parties', party.id);
    const acct = L.accountFor(party.id, 'customer-credit', { credit_limit: dbt.limit });
    logStmt.run('ledger_accounts', acct.id);

    const e1 = L.post(acct.id, {
      debit: dbt.amount, reference: `DEMO-${c.id}`,
      narration: 'Credit — 2 items', entry_date: dateOf(ago(dbt.age)), user_id: USER,
    });
    if (e1) logStmt.run('ledger_entries', e1.id);

    // One of them has been paying something off, so a part-settled account
    // exists to look at.
    if (dbt.age > 60) {
      const e2 = L.post(acct.id, {
        credit: money(dbt.amount * 0.3), narration: 'Payment received (cash)',
        entry_date: dateOf(ago(Math.max(1, dbt.age - 30))), user_id: USER,
      });
      if (e2) logStmt.run('ledger_entries', e2.id);
    }
    acctCount++;
  }
})();
console.log(`  credit        ${acctCount} accounts aged across 0-30 / 31-60 / 61-90 / 90+`);

// ---------------------------------------------------------------------------
// 6. Dialysis
// ---------------------------------------------------------------------------
const D = require(path.join(__dirname, '..', 'src', 'dialysisDemand'));
const shifts = db.prepare('SELECT * FROM dialysis_shifts ORDER BY sort_order').all();
const stations = db.prepare('SELECT * FROM dialysis_stations WHERE is_active = 1').all();
const template = db.prepare('SELECT * FROM demand_templates ORDER BY id LIMIT 1').get();
const tplItems = template
  ? db.prepare('SELECT * FROM demand_template_items WHERE template_id = ? ORDER BY column_no, sort_order').all(template.id)
  : [];

const DIALYSIS = [
  ['Ghulam Fatima', 'F', 54, 'B+', 'AV fistula', 'positive', 'negative'],
  ['Muhammad Yousaf', 'M', 61, 'O+', 'Catheter', 'negative', 'positive'],
  ['Razia Sultana', 'F', 47, 'A+', 'AV fistula', 'negative', 'negative'],
  ['Allah Ditta', 'M', 66, 'B-', 'Graft', 'negative', 'negative'],
  ['Nasreen Akhtar', 'F', 39, 'AB+', 'AV fistula', 'pending', 'negative'],
  ['Sardar Ali', 'M', 58, 'O-', 'Catheter', 'negative', 'negative'],
];

const dpIds = [];
DIALYSIS.forEach((row, i) => {
  const [name, sex, age, blood, access, hbsag, hcv] = row;
  const code = nextNo('DEMO-D', 4, 'demo_dialysis_cust');
  const custId = ins('patients',
    `INSERT INTO patients (patient_code, full_name, gender, age, contact, customer_type, category, qr_token, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'dialysis', 'Paid', ?, ?, ?)`,
    [code, name, sex === 'F' ? 'Female' : 'Male', age, `0321${pad(3000000 + i, 7)}`,
      `demo-${code}`, ago(rint(100, 300)), USER]);

  const regNo = `DLY-D${pad(i + 1, 3)}`;
  const dpId = ins('dialysis_patients',
    `INSERT INTO dialysis_patients (customer_id, reg_no, enrolled_on, blood_group, access_type,
                                    diagnosis, hbsag, hcv, hiv, serology_date, dry_weight,
                                    sessions_per_week, fund_id, next_of_kin, next_of_kin_contact, status)
     VALUES (?, ?, ?, ?, ?, 'ESRD', ?, ?, 'negative', ?, ?, ?, ?, ?, ?, 'active')`,
    [custId, regNo, dateOf(ago(rint(100, 300))), blood, access, hbsag, hcv,
      dateOf(ago(40)), money(48 + Math.random() * 25), i % 2 ? 2 : 3,
      D.dialysisFundId(), 'Next of kin', `0321${pad(4000000 + i, 7)}`]);
  db.prepare('UPDATE patients SET dialysis_reg_no = ? WHERE id = ?').run(regNo, custId);
  dpIds.push({ dpId, custId, name, regNo });
});

// Sessions: past ones completed, a few upcoming.
let sessCount = 0;
dpIds.forEach((p, i) => {
  const days = i % 2 ? [1, 4] : [1, 3, 5];
  for (let w = 6; w >= -1; w--) {
    for (const wd of days) {
      const d = w * 7 - wd;
      if (d < -7) continue;
      const when = d >= 0 ? ago(d, 8) : new Date(Date.now() + Math.abs(d) * DAY).toISOString().slice(0, 19).replace('T', ' ');
      ins('dialysis_sessions',
        `INSERT INTO dialysis_sessions (patient_id, station_id, staff_id, shift_id, scheduled_at,
                                        duration_min, status, base_charge, pre_vitals, post_vitals, created_by)
         VALUES (?, ?, ?, ?, ?, 240, ?, 2500, ?, ?, ?)`,
        [p.custId, stations.length ? stations[i % stations.length].id : null, USER,
          shifts.length ? shifts[i % shifts.length].id : null, when,
          d >= 0 ? 'completed' : 'scheduled',
          JSON.stringify({ bp: `${rint(130, 165)}/${rint(80, 95)}`, weight: money(52 + Math.random() * 18) }),
          d >= 0 ? JSON.stringify({ bp: `${rint(115, 135)}/${rint(70, 85)}`, weight: money(49 + Math.random() * 16) }) : null,
          USER]);
      sessCount++;
    }
  }
});

// Demands across every status the pharmacy worklist filters by.
const mapped = tplItems.filter((t) => !t.is_freetext);
let demandCount = 0;
dpIds.forEach((p, i) => {
  const states = ['billed', 'billed', 'issued', 'short', 'demanded'];
  states.forEach((state, k) => {
    const d = 30 - k * 6 + i;
    const when = ago(Math.max(0, d), 9);
    const no = `DEM-D${pad(++demandCount, 4)}`;
    const total = state === 'demanded' ? 0 : money(rint(300, 1800));
    const did = ins('dialysis_demands',
      `INSERT INTO dialysis_demands (demand_no, customer_id, shift_id, demand_date, template_id,
                                     status, demanded_by, issued_by, issued_at, total_cost, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'Dialysis Unit', ?, ?, ?, ?, ?)`,
      [no, p.custId, shifts.length ? shifts[i % shifts.length].id : null, dateOf(when),
        template ? template.id : null, state,
        state === 'demanded' ? null : USER, state === 'demanded' ? null : when,
        total, when, USER]);

    const rows = mapped.length ? mapped.slice(0, 3) : [];
    rows.forEach((ti, n) => {
      const prod = prodIds[(i + n) % prodIds.length];
      const qty = rint(1, 4);
      const issued = state === 'demanded' ? 0 : state === 'short' && n === 0 ? Math.max(0, qty - 1) : qty;
      ins('dialysis_demand_items',
        `INSERT INTO dialysis_demand_items (demand_id, template_item_id, product_id, label,
                                            qty_demanded, qty_issued, unit_cost, line_total, is_emergency, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [did, ti.id, prod.id, ti.printed_label, qty, issued, prod.cost,
          money(prod.cost * issued), 0, n]);
    });

    if (state !== 'demanded') {
      ins('handovers',
        `INSERT INTO handovers (context, ref_id, customer_id, taken_by, relation, cnic, contact, user_id, created_at)
         VALUES ('dialysis-demand', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [did, p.custId, pick(['Self', 'Imran (son)', 'Kausar (daughter)', 'Ward attendant']),
          pick(['Self', 'Son', 'Daughter', 'Attendant']),
          `35201-${rint(1000000, 9999999)}-${rint(1, 9)}`, `0300${rint(1000000, 9999999)}`, USER, when]);
    }
  });
});
console.log(`  dialysis      ${dpIds.length} patients, ${sessCount} sessions, ${demandCount} demands`);

// ---------------------------------------------------------------------------
// 7. Department invoices — hospital expense, by department
// ---------------------------------------------------------------------------
const depts = db.prepare('SELECT * FROM departments WHERE is_active = 1').all();
let deptCount = 0;
depts.slice(0, 4).forEach((dept, i) => {
  for (let k = 0; k < 3; k++) {
    const when = ago(rint(1, 60), 12);
    const lines = [{ product: pick(prodIds), qty: rint(2, 10) }].map((l) => ({ ...l, unit: l.product.sale }));
    writeSale({
      when, customer: { id: dept.customer_id, name: dept.name },
      chargeClass: 'DEPARTMENT', method: 'none', lines,
      costCentre: 'DEPARTMENT', billType: 'department-invoice',
    });
    db.prepare('UPDATE bills SET department_id = ? WHERE id = (SELECT MAX(id) FROM bills)').run(dept.id);
    deptCount++;
  }
});
console.log(`  departments   ${deptCount} invoices across ${Math.min(depts.length, 4)} departments`);

// ---------------------------------------------------------------------------
// 8. Returns
// ---------------------------------------------------------------------------
let retCount = 0;
for (let i = 0; i < 4; i++) {
  const b = madeBills[rint(0, madeBills.length - 1)];
  const amount = money(Math.min(b.net, rint(40, 260)));
  if (amount <= 0) continue;
  ins('returns',
    `INSERT INTO returns (return_no, bill_id, customer_name, refund_amount, reason, created_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`RET-DEMO-${pad(i + 1, 3)}`, b.id, 'Walk-in customer', amount,
      pick(['Wrong strength supplied', 'Patient reaction', 'Duplicate purchase', 'Damaged strip']),
      b.when, USER]);
  retCount++;
}
console.log(`  returns       ${retCount}`);

// ---------------------------------------------------------------------------
// 9. Till sessions, so the day book reconciles instead of saying "no session"
// ---------------------------------------------------------------------------
// The day book reconciles the drawer from `cash_transactions`, not from the
// bills. Creating a session without them leaves the sheet saying the till
// expected only its opening float against a day of cash sales — which is
// exactly the mismatch the day book exists to surface, so the demo has to post
// the movements the way the sale route does.
let tillCount = 0;
for (let d = 14; d >= 1; d--) {
  const day = dateOf(ago(d));
  const cashBills = db
    .prepare(
      `SELECT id, bill_no, paid_amount, created_at FROM bills
        WHERE bizdate(created_at) = ? AND payment_method = 'cash'
          AND bill_type = 'pharmacy-sale' AND paid_amount > 0`
    )
    .all(day);
  if (!cashBills.length) continue;

  const float = 5000;
  const sessionId = ins('cash_sessions',
    `INSERT INTO cash_sessions (counter, user_id, opening_float, opened_at, status)
     VALUES ('Counter 1', ?, ?, ?, 'closed')`,
    [USER, float, ago(d, 9)]);

  let taken = 0;
  for (const b of cashBills) {
    taken += b.paid_amount;
    ins('cash_transactions',
      `INSERT INTO cash_transactions (session_id, type, category, amount, reason, reference, user_id, created_at)
       VALUES (?, 'in', 'sale', ?, 'Auto-posted from billing', ?, ?, ?)`,
      [sessionId, b.paid_amount, b.bill_no, USER, b.created_at]);
  }

  const expected = money(float + taken);
  // A believable day: usually exact, occasionally a small variance to look at.
  const counted = Math.random() < 0.25 ? money(expected + pick([-50, -20, 20, 100])) : expected;
  db.prepare(
    `UPDATE cash_sessions SET closed_at = ?, expected_cash = ?, counted_cash = ?, variance = ?
      WHERE id = ?`
  ).run(ago(d, 21), expected, counted, money(counted - expected), sessionId);
  tillCount++;
}
console.log(`  till sessions ${tillCount} closed days with reconciliation`);

// ---------------------------------------------------------------------------
console.log('\nDone.');
console.log('  node scripts/seed-demo.js --status   to see what is loaded');
console.log('  node scripts/seed-demo.js --remove   to take it all out again');
