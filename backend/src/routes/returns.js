const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap, pad } = require('../utils');

const router = express.Router();
router.use(authenticate);

// Look up a pharmacy-sale bill (with items) to return against.
router.get(
  '/bill/:billNo',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE bill_no = ?').get(req.params.billNo);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    bill.items = db.prepare("SELECT * FROM bill_items WHERE bill_id = ? AND item_type = 'pharmacy'").all(bill.id);
    res.json(bill);
  })
);

// Process a return: restock saleable items, write off the rest, refund.
// body: { bill_id, reason, items:[{product_id, quantity, unit_price, saleable}] }
router.post(
  '/',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const bill = b.bill_id ? db.prepare('SELECT * FROM bills WHERE id = ?').get(b.bill_id) : null;
    const items = (b.items || []).filter((i) => i.product_id && i.quantity > 0);
    if (!items.length) return res.status(400).json({ error: 'At least one item required' });

    const refund = items.reduce((s, i) => s + Number(i.unit_price || 0) * i.quantity, 0);
    if (refund > 5000 && !req.user.permissions.includes(PERMISSIONS.BILLING_OVERRIDE)) {
      return res.status(403).json({ error: 'High-value refund requires authorization' });
    }

    const out = db.transaction(() => {
      const returnNo = `RET-${pad(nextSeq('return'), 5)}`;
      const info = db
        .prepare(
          `INSERT INTO returns (return_no, bill_id, patient_id, customer_name, refund_amount, reason, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(returnNo, bill?.id || null, bill?.patient_id || null, bill?.customer_name || null, refund, b.reason || null, req.user.id);
      const returnId = info.lastInsertRowid;

      const itemStmt = db.prepare(
        `INSERT INTO return_items (return_id, product_id, quantity, unit_price, saleable, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const batchStmt = db.prepare(
        `INSERT INTO stock_batches (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity)
         VALUES (?, ?, NULL, 'Customer return', 0, ?)`
      );
      const moveStmt = db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const it of items) {
        const saleable = it.saleable ? 1 : 0;
        const lineTotal = Number(it.unit_price || 0) * it.quantity;
        itemStmt.run(returnId, it.product_id, it.quantity, Number(it.unit_price || 0), saleable, lineTotal);
        if (saleable) {
          // Return good stock to inventory as a fresh batch.
          const batch = batchStmt.run(it.product_id, returnNo, it.quantity);
          moveStmt.run(it.product_id, batch.lastInsertRowid, 'return', it.quantity, returnNo, 'Customer return (saleable)', req.user.id);
        } else {
          // Unsaleable: record write-off (no stock added).
          moveStmt.run(it.product_id, null, 'writeoff', 0, returnNo, 'Customer return (unsaleable)', req.user.id);
        }
      }
      return { returnNo, returnId, refund };
    })();

    audit(req, 'return.create', 'return', out.returnId, { returnNo: out.returnNo, refund: out.refund });
    res.status(201).json(out);
  })
);

router.get(
  '/',
  requirePermission(PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM returns ORDER BY created_at DESC LIMIT 100').all());
  })
);

module.exports = router;
