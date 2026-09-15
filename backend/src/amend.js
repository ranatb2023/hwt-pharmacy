// Correcting a bill that was keyed wrong.
//
// AMEND, NEVER OVERWRITE.
//
// The client asked for "if billed miss entered then it should be edited by the
// admin if session closed". The word to be careful about is *edited*: editing
// the original row is the one thing this must not do.
//
// Last Tuesday's till was counted, reconciled and closed. If an admin edits a
// Tuesday bill on Friday, Tuesday's reprinted day book no longer matches the
// cash that was counted that evening, and nobody can tell whether the drawer was
// short or the record was changed. The day stops being evidence.
//
// So a correction writes THREE things and changes none:
//
//   1. a credit note        — reverses the original in full, stock back on the shelf
//   2. a corrected bill     — what it should have said, stock off the shelf again
//   3. a `bill_amendments`  — links them, with who, why, and which day it belongs to
//
// The cash difference posts to TODAY's open till, because that is when the money
// actually moves, carrying `for_date` so the day book can say which day it is
// putting right.
const { assertDayOpen } = require('./guards');
const { db } = require('./db');
const { newBillNo } = require('./utils');
const { businessDate } = require('./businessDay');
const { resolveEntitlement } = require('./billingRules');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

// Put back exactly what came off, into the batches it came from.
//
// Not FEFO in reverse: FEFO would return the stock to whichever batch expires
// soonest, which is not necessarily the one that was dispensed. The movements
// record which batch actually went out, so the reversal reads them.
function returnStock(billId, userId, reference) {
  const moves = db
    .prepare(
      `SELECT product_id, batch_id, SUM(-quantity) AS qty
         FROM stock_movements
        WHERE reference = (SELECT bill_no FROM bills WHERE id = ?)
          AND quantity < 0
        GROUP BY product_id, batch_id`
    )
    .all(billId);

  const back = db.prepare('UPDATE stock_batches SET quantity = quantity + ? WHERE id = ?');
  const move = db.prepare(
    `INSERT INTO stock_movements
       (product_id, batch_id, type, quantity, reference, reason, user_id, cost_centre, charge_class)
     VALUES (?, ?, 'amend-return', ?, ?, 'Bill amended', ?, ?, ?)`
  );
  const orig = db.prepare('SELECT cost_centre, charge_class FROM bills WHERE id = ?').get(billId) || {};
  for (const m of moves) {
    if (!m.batch_id || m.qty <= 0) continue;
    back.run(m.qty, m.batch_id);
    move.run(m.product_id, m.batch_id, m.qty, reference, userId,
      orig.cost_centre || 'COUNTER', orig.charge_class || null);
  }
  return moves;
}

// ---------------------------------------------------------------------------
// The amendment
// ---------------------------------------------------------------------------

// `lines` is what the bill SHOULD have said:
//   [{ product_id, quantity, unit_price?, description? }]
// Omit it entirely to cancel the bill outright.
//
// Caller must already be in a transaction.
function amend(original, { lines, reason, userId, consumeFEFO, openSession }) {
  assertDayOpen();
  if (!reason || !String(reason).trim()) {
    const e = new Error('A reason is required — an unexplained correction is worth nothing to an auditor.');
    e.status = 400;
    throw e;
  }
  if (original.status === 'cancelled') {
    const e = new Error(`${original.bill_no} was already cancelled.`);
    e.status = 409;
    throw e;
  }

  const forDate = db.prepare('SELECT bizdate(created_at) d FROM bills WHERE id = ?').get(original.id).d;
  const patient = original.patient_id
    ? db.prepare('SELECT * FROM patients WHERE id = ?').get(original.patient_id)
    : null;

  // --- 1. the credit note -------------------------------------------------
  const cnNo = newBillNo();
  const cnId = db
    .prepare(
      `INSERT INTO bills
         (bill_no, patient_id, customer_name, category, bill_type, cost_centre, charge_class,
          welfare_card_id, subsidy_fund_id, gross_amount, discount, subsidy, net_amount,
          paid_amount, payment_method, status, notes, created_by)
       VALUES (?, ?, ?, ?, 'credit-note', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'amended', ?, ?)`
    )
    .run(
      cnNo, original.patient_id, original.customer_name, original.category,
      original.cost_centre, original.charge_class,
      original.welfare_card_id, original.subsidy_fund_id,
      -original.gross_amount, -original.discount, -original.subsidy, -original.net_amount,
      -original.paid_amount, original.payment_method,
      `Reverses ${original.bill_no}: ${reason}`, userId
    ).lastInsertRowid;

  // Mirror the original's lines, negated, so the credit note prints as a
  // readable reversal rather than a single unexplained figure.
  const origItems = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(original.id);
  const cnItem = db.prepare(
    `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of origItems) {
    cnItem.run(cnId, it.item_type, it.ref_id, `Reversal: ${it.description}`,
      -it.quantity, it.unit_price, -it.line_total);
  }

  returnStock(original.id, userId, cnNo);
  db.prepare("UPDATE bills SET status = 'amended' WHERE id = ?").run(original.id);

  // --- 2. the corrected bill ---------------------------------------------
  let corrected = null;
  if (Array.isArray(lines) && lines.length) {
    const priced = [];
    for (const l of lines) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id);
      if (!product) { const e = new Error(`Product ${l.product_id} not found`); e.status = 400; throw e; }
      const qty = Math.max(0, parseInt(l.quantity, 10) || 0);
      if (!qty) continue;
      const unit = l.unit_price != null ? Number(l.unit_price) : product.sale_price;
      const { dispensed } = consumeFEFO(
        product.id, qty, 'dispense', 'PENDING', userId,
        { costCentre: original.cost_centre || 'COUNTER', chargeClass: original.charge_class }
      );
      if (dispensed < qty) {
        const e = new Error(
          `${product.name}: only ${dispensed} of ${qty} are in stock, so the corrected bill cannot be made.`
        );
        e.status = 400;
        throw e;
      }
      priced.push({
        product, qty, unit,
        amount: round2(unit * qty),
        item_type: 'pharmacy',
        product_type_id: product.product_type_id,
      });
    }
    if (!priced.length) { const e = new Error('The corrected bill has no lines'); e.status = 400; throw e; }

    // Priced through the same engine as the counter, so a correction cannot
    // quietly give a different entitlement from the one the sale would have.
    const calc = resolveEntitlement(patient, priced, { forceCategory: original.category });
    const newNo = newBillNo();
    const newId = db
      .prepare(
        `INSERT INTO bills
           (bill_no, patient_id, customer_name, category, bill_type, cost_centre, charge_class,
            welfare_card_id, subsidy_fund_id, gross_amount, discount, subsidy, net_amount,
            paid_amount, payment_method, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newNo, original.patient_id, original.customer_name, original.category,
        original.bill_type, original.cost_centre, calc.charge_class || original.charge_class,
        calc.card_id || original.welfare_card_id, calc.fund_id || original.subsidy_fund_id,
        calc.gross, calc.discount, calc.subsidy, calc.net,
        calc.net, original.payment_method, calc.net > 0 ? 'paid' : 'paid',
        `Corrects ${original.bill_no}: ${reason}`, userId
      ).lastInsertRowid;

    // The movements were stamped 'PENDING' before the bill number existed.
    db.prepare("UPDATE stock_movements SET reference = ? WHERE reference = 'PENDING'").run(newNo);

    const it = db.prepare(
      `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
       VALUES (?, 'pharmacy', ?, ?, ?, ?, ?)`
    );
    for (const p of priced) it.run(newId, p.product.id, p.product.name, p.qty, p.unit, p.amount);

    corrected = { id: newId, bill_no: newNo, ...calc };
  }

  // --- 3. the money -------------------------------------------------------
  //
  // Positive: the customer was overcharged and is owed money back.
  // Negative: they were undercharged and owe the difference.
  const cashDelta = round2(original.paid_amount - (corrected ? corrected.net : 0));

  let sessionId = null;
  if (cashDelta !== 0 && openSession) {
    sessionId = openSession.id;
    db.prepare(
      `INSERT INTO cash_transactions (session_id, type, category, amount, reason, reference, user_id)
       VALUES (?, ?, 'amendment', ?, ?, ?, ?)`
    ).run(
      openSession.id,
      cashDelta > 0 ? 'out' : 'in',
      Math.abs(cashDelta),
      `Correction to ${forDate} — ${reason}`,
      original.bill_no,
      userId
    );
  }

  const amendId = db
    .prepare(
      `INSERT INTO bill_amendments
         (original_id, credit_note_id, corrected_id, reason, for_date, cash_delta, session_id, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(original.id, cnId, corrected ? corrected.id : null, String(reason).trim(),
      forDate, cashDelta, sessionId, userId).lastInsertRowid;

  return {
    amendment_id: amendId,
    original: { id: original.id, bill_no: original.bill_no, net: original.net_amount },
    credit_note: { id: cnId, bill_no: cnNo },
    corrected,
    for_date: forDate,
    cash_delta: cashDelta,
    // Said in words, because "-450" is ambiguous at a counter.
    cash_note: cashDelta > 0
      ? `Refund ${Math.abs(cashDelta)} to the customer`
      : cashDelta < 0
        ? `Collect ${Math.abs(cashDelta)} from the customer`
        : 'No money changes hands',
    posted_to_open_till: !!sessionId,
    today: businessDate(),
  };
}

// The chain of corrections on a bill. Amending twice must read as a chain, not
// look like a silent overwrite.
function chainFor(billId) {
  return db
    .prepare(
      `SELECT a.*, u.full_name AS amended_by,
              o.bill_no AS original_no, c.bill_no AS credit_note_no, n.bill_no AS corrected_no
         FROM bill_amendments a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN bills o ON o.id = a.original_id
         LEFT JOIN bills c ON c.id = a.credit_note_id
         LEFT JOIN bills n ON n.id = a.corrected_id
        WHERE a.original_id = ? OR a.corrected_id = ? OR a.credit_note_id = ?
        ORDER BY a.id`
    )
    .all(billId, billId, billId);
}

module.exports = { amend, chainFor, returnStock, round2 };
