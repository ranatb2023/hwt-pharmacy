// The dialysis demand — the unit's paper form, as one record.
//
// THE SHAPE COMES FROM THE PAPER, NOT FROM A DATA MODEL
//
// One sheet is simultaneously the requisition, the stock issue and the source of
// that patient's charge. The two signature lines at the foot ("Demanded by" and
// "Issued by") are two different people, so it is a two-step workflow:
//
//   demanded  — the unit writes what it needs.        NO STOCK MOVES.
//   issued    — the pharmacy hands it over.           FEFO deduction happens HERE.
//   short     — issued less than demanded.            The shortfall stays visible.
//   billed    — one invoice per session.              Base charge + consumables + emergency.
//
// Splitting demand from issue is the whole point. If demanding moved stock, the
// unit could empty the shelf by writing on a form, and the pharmacy would have
// no moment at which to say "we only have four".
//
// THE TWO LEDGERS
//
// A dialysis patient's medicine is free TO THE PATIENT and charged in full to
// the dialysis programme. Those are separate accounts on the same person and
// they must never be summed: `dialysis-demand` is what the programme has spent
// on them, `customer-credit` is what they personally owe the shop. The client
// was explicit about this ("dialysis demands and patient khata should be
// seperate"), and it is enforced by UNIQUE (party_id, ledger_kind).
const { db, nextSeq } = require('./db');
const { getSettings } = require('./settings');
const { resolveEntitlement } = require('./billingRules');
const { newBillNo, pad } = require('./utils');
const { businessDate } = require('./businessDay');
const L = require('./ledger');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function nextDemandNo() {
  return `DEM-${pad(nextSeq('dialysis_demand'), 5)}`;
}

function nextRegNo() {
  return `DLY-${pad(nextSeq('dialysis_patient'), 4)}`;
}

// ---------------------------------------------------------------------------
// What a line costs the programme (Q8)
// ---------------------------------------------------------------------------

// The unit already writes a "Total Cost" on the paper. This decides which number
// goes in it: what the medicine cost the trust, or what it would have sold for.
//
// Cost is read from THE BATCHES THAT ACTUALLY WENT OUT, not from the product
// default — two deliveries of the same injection rarely cost the same, and the
// programme should be charged for the ones it consumed. Falls back to the
// product's cost only when nothing was issued yet (a demand being priced before
// it is filled).
function unitCostFor(product, batches, basis) {
  if (basis === 'mrp') {
    return Number(product.mrp || product.sale_price || 0);
  }
  const taken = (batches || []).filter((b) => b.quantity > 0);
  const units = taken.reduce((t, b) => t + b.quantity, 0);
  if (!units) return lastBatchCost(product.id);
  const value = taken.reduce((t, b) => t + Number(b.cost_price || 0) * b.quantity, 0);
  return round2(value / units);
}

// ---------------------------------------------------------------------------
// Reading a demand
// ---------------------------------------------------------------------------

const DEMAND_SELECT = `
  SELECT d.*, p.full_name, p.patient_code, p.contact, p.category,
         dp.reg_no, dp.hbsag, dp.hcv, dp.hiv, dp.blood_group, dp.access_type,
         sh.name AS shift_name,
         u.full_name AS issued_by_name,
         b.bill_no
    FROM dialysis_demands d
    JOIN patients p ON p.id = d.customer_id
    LEFT JOIN dialysis_patients dp ON dp.customer_id = d.customer_id
    LEFT JOIN dialysis_shifts sh ON sh.id = d.shift_id
    LEFT JOIN users u ON u.id = d.issued_by
    LEFT JOIN bills b ON b.id = d.bill_id`;

function demandFull(id) {
  const d = db.prepare(`${DEMAND_SELECT} WHERE d.id = ?`).get(id);
  if (!d) return null;
  d.items = db
    .prepare(
      `SELECT i.*, pr.name AS product_name, pr.unit, pr.units_per_strip,
              ti.printed_label, ti.column_no, ti.is_freetext
         FROM dialysis_demand_items i
         LEFT JOIN products pr ON pr.id = i.product_id
         LEFT JOIN demand_template_items ti ON ti.id = i.template_item_id
        WHERE i.demand_id = ?
        ORDER BY i.sort_order, i.id`
    )
    .all(id)
    .map((r) => ({ ...r, batches: r.batches ? JSON.parse(r.batches) : null }));
  d.handover = db
    .prepare("SELECT * FROM handovers WHERE context = 'dialysis-demand' AND ref_id = ? ORDER BY id DESC LIMIT 1")
    .get(id) || null;
  d.shortfalls = d.items
    .filter((i) => i.qty_issued < i.qty_demanded)
    .map((i) => ({
      label: i.label || i.printed_label,
      demanded: i.qty_demanded,
      issued: i.qty_issued,
      short: i.qty_demanded - i.qty_issued,
    }));
  return d;
}

// ---------------------------------------------------------------------------
// Issue — the pharmacy hands it over
// ---------------------------------------------------------------------------

// Deducts FEFO, records what was actually issued per line and which batch it
// came from, and prices the lines against the programme.
//
// `consumeFEFO` is injected rather than imported to keep this module free of a
// circular require with the pharmacy router, which owns it.
//
// Caller must be inside a transaction: a demand marked issued while the stock
// movement rolls back is a shelf that disagrees with the record.
function issueDemand(demand, { consumeFEFO, userId, allowPartial = true }) {
  const settings = getSettings();
  const basis = settings.dialysis_cost_basis === 'mrp' ? 'mrp' : 'cost';

  const items = db
    .prepare('SELECT * FROM dialysis_demand_items WHERE demand_id = ? ORDER BY sort_order, id')
    .all(demand.id);

  let total = 0;
  let anyShort = false;
  const update = db.prepare(
    `UPDATE dialysis_demand_items
        SET qty_issued = ?, unit_cost = ?, line_total = ?, batches = ?
      WHERE id = ?`
  );

  for (const it of items) {
    if (!it.product_id || it.qty_demanded <= 0) {
      // A row the nurse wrote a quantity against but never resolved to a SKU
      // cannot be deducted. It stays on the record as a shortfall rather than
      // being silently dropped, so the unit can see what it did not get.
      if (it.qty_demanded > 0) anyShort = true;
      continue;
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) { const e = new Error(`Product ${it.product_id} not found`); e.status = 400; throw e; }

    const { dispensed, batches } = consumeFEFO(
      product.id, it.qty_demanded, 'dispense', demand.demand_no, userId,
      // DIALYSIS, never COUNTER. These deductions have no counter revenue behind
      // them; tagging them COUNTER is what used to drive gross margin negative.
      { allowPartial, costCentre: 'DIALYSIS', chargeClass: 'DIALYSIS_FREE' }
    );
    if (dispensed < it.qty_demanded) anyShort = true;

    const unit = unitCostFor(product, batches, basis);
    const line = round2(unit * dispensed);
    total += line;
    update.run(dispensed, unit, line, JSON.stringify(batches), it.id);
  }

  db.prepare(
    `UPDATE dialysis_demands
        SET status = ?, issued_by = ?, issued_at = datetime('now'), total_cost = ?
      WHERE id = ?`
  ).run(anyShort ? 'short' : 'issued', userId, round2(total), demand.id);

  return { total: round2(total), short: anyShort };
}

// ---------------------------------------------------------------------------
// Bill — one invoice for the session
// ---------------------------------------------------------------------------

// Base charge + consumables + emergency items, on ONE invoice.
//
// The client asked for "emergency medicine of dialysis ... in the same invoice".
// The paper form already has an Emergency row, so this is not a new feature: the
// emergency line is flagged so Phase 06 can report it separately, and billed
// with everything else because that is what the unit already does.
function billDemand(demand, { userId }) {
  const settings = getSettings();
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(demand.customer_id);
  const items = db
    .prepare(
      `SELECT i.*, pr.name AS product_name, pr.product_type_id
         FROM dialysis_demand_items i
         LEFT JOIN products pr ON pr.id = i.product_id
        WHERE i.demand_id = ? AND i.qty_issued > 0
        ORDER BY i.sort_order, i.id`
    )
    .all(demand.id);

  const session = demand.session_id
    ? db.prepare('SELECT * FROM dialysis_sessions WHERE id = ?').get(demand.session_id)
    : null;

  // The session charge rides on the same invoice when there is a session.
  const baseCharge = session ? Number(session.base_charge || 0) : 0;

  const lines = [];
  if (baseCharge > 0) {
    lines.push({ amount: baseCharge, item_type: 'dialysis', label: 'Dialysis session', qty: 1 });
  }
  for (const it of items) {
    lines.push({
      amount: Number(it.line_total || 0),
      item_type: 'pharmacy',
      product_type_id: it.product_type_id,
      label: `${it.is_emergency ? 'Emergency: ' : ''}${it.product_name || it.label}`,
      qty: it.qty_issued,
      unit: it.unit_cost,
      is_emergency: it.is_emergency,
      product_id: it.product_id,
    });
  }
  if (!lines.length) { const e = new Error('Nothing was issued, so there is nothing to bill'); e.status = 400; throw e; }

  // One entitlement decision, through the same engine as the counter — but the
  // category is FORCED here rather than carried on the patient.
  //
  // An enrolled patient's dialysis is covered; the same person buying soap at
  // the counter is not. Putting 'Complete Free' on the customer record made
  // everything free for them forever, which is not what "dialysis patient (free
  // medicine)" asks for. The entitlement belongs to the demand.
  const enrolled = db
    .prepare("SELECT 1 FROM dialysis_patients WHERE customer_id = ? AND status = 'active'")
    .get(patient.id);
  const calc = resolveEntitlement(patient, lines, {
    forceCategory: enrolled ? 'Complete Free' : undefined,
  });

  const billNo = newBillNo();
  const billInfo = db
    .prepare(
      `INSERT INTO bills
         (bill_no, patient_id, customer_name, category, bill_type, cost_centre, charge_class,
          welfare_card_id, subsidy_fund_id, gross_amount, discount, subsidy, net_amount,
          paid_amount, payment_method, status, created_by)
       VALUES (?, ?, ?, ?, 'dialysis', 'DIALYSIS', ?, ?, ?, ?, ?, ?, ?, 0, 'none', ?, ?)`
    )
    .run(
      billNo, patient.id, patient.full_name, patient.category,
      calc.charge_class || 'DIALYSIS_FREE',
      calc.card_id || null,
      calc.fund_id || dialysisFundId(),
      calc.gross, calc.discount, calc.subsidy, calc.net,
      calc.net > 0 ? 'unpaid' : 'paid',
      userId
    );
  const billId = billInfo.lastInsertRowid;

  const itemStmt = db.prepare(
    `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of lines) {
    itemStmt.run(
      billId,
      l.item_type === 'dialysis' ? 'dialysis' : 'pharmacy',
      l.product_id || demand.session_id || null,
      l.label, l.qty, l.unit != null ? l.unit : l.amount, l.amount
    );
  }

  // THE SEPARATION. Full value goes to the programme's account for this patient;
  // nothing touches their personal credit account unless they are actually being
  // charged, which only happens when the entitlement did not cover something.
  const party = L.partyFor({ customer: patient });
  const programme = L.accountFor(party.id, 'dialysis-demand');
  const covered = round2(calc.subsidy + calc.discount);
  if (covered > 0) {
    L.post(programme.id, {
      debit: covered,
      bill_id: billId,
      reference: demand.demand_no,
      narration: `Dialysis — ${items.length} item${items.length === 1 ? '' : 's'}`
        + (baseCharge > 0 ? ' + session' : ''),
      user_id: userId,
      entry_date: demand.demand_date || businessDate(),
    });
  }

  // The one place the two ledgers touch: something the programme did not cover.
  // It goes to the patient personally, and the caller is told so it can be said
  // on screen rather than discovered on a statement later.
  let patientCharge = null;
  if (calc.net > 0) {
    const own = L.accountFor(party.id, 'customer-credit');
    L.post(own.id, {
      debit: calc.net,
      bill_id: billId,
      reference: demand.demand_no,
      narration: 'Dialysis items not covered by the programme',
      user_id: userId,
      entry_date: demand.demand_date || businessDate(),
    });
    patientCharge = { account_id: own.id, amount: calc.net };
  }

  db.prepare("UPDATE dialysis_demands SET status = 'billed', bill_id = ? WHERE id = ?")
    .run(billId, demand.id);
  if (session) {
    db.prepare('UPDATE dialysis_sessions SET bill_id = ?, demand_id = ? WHERE id = ?')
      .run(billId, demand.id, session.id);
  }

  return {
    bill_id: billId,
    bill_no: billNo,
    gross: calc.gross,
    subsidy: calc.subsidy,
    discount: calc.discount,
    net: calc.net,
    programme_account_id: programme.id,
    programme_charged: covered,
    patient_charge: patientCharge,
    emergency_total: round2(
      items.filter((i) => i.is_emergency).reduce((t, i) => t + Number(i.line_total || 0), 0)
    ),
  };
}

// What the last delivery of this product cost. Used only to price a demand
// that has not been issued yet; once it is issued the real batches decide.
function lastBatchCost(productId) {
  const row = db
    .prepare(
      `SELECT cost_price FROM stock_batches
        WHERE product_id = ? AND cost_price > 0
        ORDER BY id DESC LIMIT 1`
    )
    .get(productId);
  return row ? Number(row.cost_price) : 0;
}

function dialysisFundId() {
  const f = db.prepare("SELECT id FROM subsidy_funds WHERE code = 'DIALYSIS'").get();
  return f ? f.id : null;
}

module.exports = {
  nextDemandNo, nextRegNo, unitCostFor, demandFull, issueDemand, billDemand,
  dialysisFundId, round2, DEMAND_SELECT,
};
