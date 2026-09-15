const express = require('express');
const bcrypt = require('bcryptjs');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap, pad } = require('../utils');
const { getSettings } = require('../settings');
const { assertDayOpen, httpError } = require('../guards');
const { openSessionFor, postCashOut } = require('./cashflow');
const L = require('../ledger');

const router = express.Router();
router.use(authenticate);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// The reasons a pharmacy return register expects (QA S3-20). 'other' carries
// free text after it.
const REASONS = ['wrong item', 'wrong strength', 'patient reaction', 'duplicate purchase', 'damaged', 'expired', 'unused course', 'other'];

// What was sold on the bill, per product, and what has already come back.
function billLines(bill) {
  const sold = db
    .prepare(
      `SELECT ref_id AS product_id, SUM(quantity) AS qty, SUM(line_total) AS total, MIN(description) AS description
         FROM bill_items WHERE bill_id = ? AND item_type = 'pharmacy' AND ref_id IS NOT NULL
        GROUP BY ref_id`
    )
    .all(bill.id);
  const returned = db
    .prepare(
      `SELECT ri.product_id, SUM(ri.quantity) AS qty
         FROM return_items ri JOIN returns r ON r.id = ri.return_id
        WHERE r.bill_id = ? GROUP BY ri.product_id`
    )
    .all(bill.id);
  const refunded = db.prepare('SELECT COALESCE(SUM(refund_amount), 0) s FROM returns WHERE bill_id = ?').get(bill.id).s;
  return {
    lines: sold.map((s) => {
      const p = db.prepare('SELECT id, name, strength, unit, is_refrigerated FROM products WHERE id = ?').get(s.product_id) || {};
      const back = returned.find((r) => r.product_id === s.product_id)?.qty || 0;
      return {
        product_id: s.product_id, name: p.name, strength: p.strength, unit: p.unit, is_refrigerated: p.is_refrigerated,
        description: s.description,
        sold: s.qty, already_returned: back, returnable: Math.max(0, s.qty - back),
        // The price PAID per unit on this bill, after line rounding — never the
        // client's figure.
        unit_price: s.qty > 0 ? round2(s.total / s.qty) : 0,
      };
    }),
    refunded_so_far: round2(refunded),
  };
}

// Look up a pharmacy-sale bill (with items) to return against.
router.get(
  '/bill/:billNo',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE bill_no = ?').get(req.params.billNo);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    bill.items = db.prepare("SELECT * FROM bill_items WHERE bill_id = ? AND item_type = 'pharmacy'").all(bill.id);
    Object.assign(bill, billLines(bill));
    bill.refund_ceiling = round2(Math.max(0, Number(bill.paid_amount) - bill.refunded_so_far));
    bill.reasons = REASONS;
    bill.refund_auth_threshold = Number(getSettings().refund_auth_threshold || 0);
    res.json(bill);
  })
);

// Process a return (QA S1-01, S1-05, S2-06, S3-20).
//
// Everything is checked against the ORIGINAL BILL, on the server:
//   - a product not on the bill is refused;
//   - returned so far + requested may not exceed what was sold;
//   - the refund is priced at what the bill line was sold for — the client's
//     unit_price is ignored;
//   - the refund cannot exceed what was actually paid on the bill, less any
//     refund already made against it;
//   - above `refund_auth_threshold` a SECOND user holding billing.override
//     authorises it with their credentials, recorded on the return;
//   - a cash refund needs an open till, and is posted out of it;
//   - a bill paid on account is refunded as a ledger credit instead;
//   - returned medicine goes back to the batch it was dispensed from, at that
//     batch's cost and expiry, QUARANTINED — a pharmacist releases it with a
//     reason, never a cold-chain item.
//
// body: { bill_id, reason, reason_note?, refund_method?, authoriser?: {username, password},
//         items:[{product_id, quantity, saleable}] }
router.post(
  '/',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const settings = getSettings();

    const bill = b.bill_id ? db.prepare('SELECT * FROM bills WHERE id = ?').get(b.bill_id) : null;
    if (!bill) throw httpError(400, 'BILL_REQUIRED', 'A return is made against the original bill. Look the bill up first.');
    if (bill.status === 'amended') throw httpError(400, 'BILL_AMENDED', `${bill.bill_no} was amended — return against the corrected bill.`);
    if (bill.bill_type === 'credit-note') throw httpError(400, 'BILL_REQUIRED', 'A credit note cannot be returned against.');

    const reason = String(b.reason || '').trim();
    if (!reason) throw httpError(400, 'REASON_REQUIRED', 'A reason is required for every return.');
    const reasonText = reason === 'other' || !REASONS.includes(reason)
      ? String(b.reason_note || (REASONS.includes(reason) ? '' : reason)).trim()
      : reason;
    if (!reasonText) throw httpError(400, 'REASON_REQUIRED', 'Say what the reason is.');

    const raw = (Array.isArray(b.items) ? b.items : []).filter((i) => i.product_id && Number(i.quantity) > 0);
    if (!raw.length) return res.status(400).json({ error: 'At least one item required' });

    assertDayOpen();

    const { lines, refunded_so_far: refundedSoFar } = billLines(bill);
    const items = [];
    for (const i of raw) {
      const qty = Math.floor(Number(i.quantity));
      const line = lines.find((l) => l.product_id === Number(i.product_id));
      if (!line) throw httpError(400, 'NOT_ON_BILL', `Product ${i.product_id} is not on bill ${bill.bill_no}.`);
      if (qty > line.returnable) {
        throw httpError(400, 'RETURN_EXCEEDS_SOLD',
          `Only ${line.returnable} ${line.unit || 'unit'}(s) of ${line.name} can still come back on ${bill.bill_no} (${line.sold} sold, ${line.already_returned} already returned).`,
          { sold: line.sold, already_returned: line.already_returned });
      }
      items.push({ line, qty, saleable: !!i.saleable, lineTotal: round2(line.unit_price * qty) });
    }

    // What the customer is owed: the lines at the price they paid, never more
    // than what was actually paid on the bill less earlier refunds. A bill on
    // account is credited on the ledger rather than paid out of the drawer.
    const ledgerRefund = bill.payment_method === 'credit' && bill.ledger_account_id;
    const method = ledgerRefund ? 'ledger' : 'cash';
    const gross = round2(items.reduce((s, i) => s + i.lineTotal, 0));
    const ceiling = round2(Math.max(0, (ledgerRefund ? Number(bill.net_amount) : Number(bill.paid_amount)) - refundedSoFar));
    const refund = Math.min(gross, ceiling);
    const capped = gross > ceiling + 0.001;

    // Authorisation above the threshold: a second person, with the permission,
    // proving who they are. Recorded on the return.
    const threshold = Number(settings.refund_auth_threshold || 0);
    let authorisedBy = null;
    if (threshold > 0 && refund > threshold) {
      const a = b.authoriser || {};
      if (!a.username || !a.password) {
        throw httpError(403, 'AUTH_REQUIRED',
          `A refund above Rs ${threshold} needs a second person with billing override to authorise it.`, { threshold });
      }
      const auth = db
        .prepare(`SELECT u.*, r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`)
        .get(String(a.username));
      const perms = auth ? JSON.parse(auth.permissions || '[]') : [];
      if (!auth || !auth.is_active || !bcrypt.compareSync(String(a.password), auth.password_hash)) {
        throw httpError(403, 'AUTH_INVALID', 'The authoriser\'s credentials were not accepted.');
      }
      if (!perms.includes(PERMISSIONS.BILLING_OVERRIDE)) throw httpError(403, 'AUTH_INVALID', `${auth.full_name} does not hold billing override.`);
      if (auth.id === req.user.id) throw httpError(403, 'AUTH_SECOND_PERSON', 'The authoriser must be a second person, not the one processing the return.');
      authorisedBy = auth;
    }

    // Cash leaves a drawer, so there has to be one.
    let session = null;
    if (method === 'cash' && refund > 0) {
      session = openSessionFor(req.user.id);
      if (!session) throw httpError(409, 'TILL_NOT_OPEN', 'No till is open for you. A cash refund is paid out of an open till session — open one in Cash Flow first.');
    }

    const out = db.transaction(() => {
      const returnNo = `RET-${pad(nextSeq('return'), 5)}`;
      const info = db
        .prepare(
          `INSERT INTO returns (return_no, bill_id, patient_id, customer_name, refund_amount, reason, user_id,
                                refund_method, session_id, authorised_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(returnNo, bill.id, bill.patient_id || null, bill.customer_name || null, refund, reasonText, req.user.id,
          method, session ? session.id : null, authorisedBy ? authorisedBy.id : null);
      const returnId = info.lastInsertRowid;

      const itemStmt = db.prepare(
        `INSERT INTO return_items (return_id, product_id, quantity, unit_price, saleable, line_total, batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const moveStmt = db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const quarantined = [];

      for (const it of items) {
        let firstBatch = null;
        if (it.saleable) {
          // The batches this bill's units left from, as the movement ledger
          // recorded them at dispense. Credit the return to those, in a
          // QUARANTINED copy that carries the same batch number, expiry, cost
          // and MRP — so FEFO, valuation and a recall all still work.
          const origins = db
            .prepare(
              `SELECT m.batch_id, SUM(-m.quantity) AS qty
                 FROM stock_movements m
                WHERE m.reference = ? AND m.product_id = ? AND m.quantity < 0 AND m.batch_id IS NOT NULL
                GROUP BY m.batch_id ORDER BY qty DESC`
            )
            .all(bill.bill_no, it.line.product_id);
          let left = it.qty;
          for (const o of origins) {
            if (left <= 0) break;
            const take = Math.min(left, o.qty);
            const src = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(o.batch_id);
            if (!src) continue;
            let q = db
              .prepare(`SELECT * FROM stock_batches WHERE origin = 'return' AND origin_batch_id = ? AND quarantined = 1`)
              .get(src.id);
            if (q) {
              db.prepare('UPDATE stock_batches SET quantity = quantity + ? WHERE id = ?').run(take, q.id);
            } else {
              const ins = db
                .prepare(
                  `INSERT INTO stock_batches
                     (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity, mrp, vendor_id, quarantined, origin, origin_batch_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'return', ?)`
                )
                .run(src.product_id, src.batch_no, src.expiry_date, src.manufacturer, src.cost_price, take, src.mrp, src.vendor_id, src.id);
              q = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(ins.lastInsertRowid);
            }
            moveStmt.run(it.line.product_id, q.id, 'return', take, returnNo,
              `Customer return — quarantined pending pharmacist release (from batch ${src.batch_no || src.id})`, req.user.id);
            quarantined.push({ batch_id: q.id, batch_no: q.batch_no, expiry_date: q.expiry_date, quantity: take, product: it.line.name });
            if (!firstBatch) firstBatch = q.id;
            left -= take;
          }
          if (left > 0) {
            // A bill with no batch trail (pre-ledger data). Held in quarantine
            // under the return number; it cannot be released without an expiry,
            // which the trigger enforces — write it off or receive it properly.
            const ins = db
              .prepare(
                `INSERT INTO stock_batches (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity, quarantined, origin)
                 VALUES (?, ?, NULL, 'Customer return', 0, ?, 1, 'return')`
              )
              .run(it.line.product_id, returnNo, left);
            moveStmt.run(it.line.product_id, ins.lastInsertRowid, 'return', left, returnNo,
              'Customer return — no batch trail on the bill; quarantined', req.user.id);
            quarantined.push({ batch_id: ins.lastInsertRowid, batch_no: returnNo, expiry_date: null, quantity: left, product: it.line.name });
            if (!firstBatch) firstBatch = ins.lastInsertRowid;
          }
        } else {
          moveStmt.run(it.line.product_id, null, 'writeoff', 0, returnNo, `Customer return (unsaleable): ${reasonText}`, req.user.id);
        }
        itemStmt.run(returnId, it.line.product_id, it.qty, it.line.unit_price, it.saleable ? 1 : 0, it.lineTotal, firstBatch);
      }

      if (method === 'cash' && refund > 0) {
        postCashOut(session.id, refund, 'refund', returnNo, `Refund on ${bill.bill_no}: ${reasonText}`, req.user.id);
      } else if (method === 'ledger' && refund > 0) {
        L.post(bill.ledger_account_id, {
          credit: refund, reference: returnNo, bill_id: bill.id, user_id: req.user.id,
          narration: `Return ${returnNo} against ${bill.bill_no}: ${reasonText}`,
        });
      }
      return { returnNo, returnId, refund, refund_method: method, capped, quarantined, session_id: session ? session.id : null };
    })();

    audit(req, 'return.create', 'return', out.returnId, {
      returnNo: out.returnNo, bill: bill.bill_no, refund: out.refund, method: out.refund_method,
      capped: out.capped, reason: reasonText, authorised_by: authorisedBy ? authorisedBy.username : null,
      quarantined: out.quarantined.map((q) => q.batch_id),
    });
    out.authorised_by = authorisedBy ? authorisedBy.full_name : null;
    res.status(201).json(out);
  })
);

router.get(
  '/reasons',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => res.json({ reasons: REASONS, refund_auth_threshold: Number(getSettings().refund_auth_threshold || 0) }))
);

router.get(
  '/',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    res.json(
      db.prepare(
        `SELECT r.*, b.bill_no, a.full_name AS authorised_by_name
           FROM returns r LEFT JOIN bills b ON b.id = r.bill_id LEFT JOIN users a ON a.id = r.authorised_by
          ORDER BY r.created_at DESC LIMIT 100`
      ).all()
    );
  })
);

module.exports = router;
module.exports.REASONS = REASONS;
