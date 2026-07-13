const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap, pad } = require('../utils');

const router = express.Router();
router.use(authenticate);

// --- Vendor master ---
router.get(
  '/',
  requirePermission(PERMISSIONS.VENDOR_VIEW),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM vendors WHERE is_active = 1 ORDER BY name').all());
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.VENDOR_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Vendor name required' });
    const info = db
      .prepare('INSERT INTO vendors (name, contact, address, notes) VALUES (?, ?, ?, ?)')
      .run(b.name, b.contact || null, b.address || null, b.notes || null);
    audit(req, 'vendor.create', 'vendor', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(info.lastInsertRowid));
  })
);

// Vendor detail with payables ledger.
router.get(
  '/:id',
  requirePermission(PERMISSIONS.VENDOR_VIEW),
  wrap((req, res) => {
    const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
    v.purchases = db.prepare('SELECT * FROM purchases WHERE vendor_id = ? ORDER BY created_at DESC').all(v.id);
    v.payments = db.prepare('SELECT * FROM vendor_payments WHERE vendor_id = ? ORDER BY created_at DESC').all(v.id);
    v.reclaims = db
      .prepare(
        `SELECT vr.*, p.name AS product_name FROM vendor_reclaims vr
         JOIN products p ON p.id = vr.product_id WHERE vr.vendor_id = ? ORDER BY vr.created_at DESC`
      )
      .all(v.id);
    res.json(v);
  })
);

// --- Goods received (creates stock batches + raises payable) ---
router.post(
  '/:id/purchase',
  requirePermission(PERMISSIONS.VENDOR_MANAGE),
  wrap((req, res) => {
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const b = req.body || {};
    const items = (b.items || []).filter((i) => i.product_id && i.quantity > 0);
    if (!items.length) return res.status(400).json({ error: 'At least one line item required' });

    const out = db.transaction(() => {
      const grnNo = `GRN-${pad(nextSeq('grn'), 5)}`;
      let total = 0;
      const purchaseInfo = db
        .prepare(
          `INSERT INTO purchases (grn_no, vendor_id, invoice_no, total_amount, paid_amount, notes, created_by)
           VALUES (?, ?, ?, 0, ?, ?, ?)`
        )
        .run(grnNo, vendor.id, b.invoice_no || null, Number(b.paid_amount || 0), b.notes || null, req.user.id);
      const purchaseId = purchaseInfo.lastInsertRowid;

      const batchStmt = db.prepare(
        `INSERT INTO stock_batches (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const itemStmt = db.prepare(
        `INSERT INTO purchase_items (purchase_id, product_id, batch_id, quantity, cost_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const moveStmt = db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, 'purchase', ?, ?, 'Goods received', ?)`
      );

      for (const it of items) {
        const product = db.prepare('SELECT id FROM products WHERE id = ?').get(it.product_id);
        if (!product) { const e = new Error(`Product ${it.product_id} not found`); e.status = 400; throw e; }
        const cost = Number(it.cost_price || 0);
        const lineTotal = cost * it.quantity;
        total += lineTotal;
        const batch = batchStmt.run(it.product_id, it.batch_no || null, it.expiry_date || null, it.manufacturer || vendor.name, cost, it.quantity);
        itemStmt.run(purchaseId, it.product_id, batch.lastInsertRowid, it.quantity, cost, lineTotal);
        moveStmt.run(it.product_id, batch.lastInsertRowid, it.quantity, grnNo, req.user.id);
      }

      const paid = Number(b.paid_amount || 0);
      db.prepare('UPDATE purchases SET total_amount = ? WHERE id = ?').run(total, purchaseId);
      // Raise payable = total - paid
      db.prepare('UPDATE vendors SET balance = balance + ? WHERE id = ?').run(total - paid, vendor.id);
      if (paid > 0) {
        db.prepare('INSERT INTO vendor_payments (vendor_id, amount, method, reference, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(vendor.id, paid, b.method || 'cash', grnNo, req.user.id);
      }
      return { grnNo, purchaseId, total };
    })();

    audit(req, 'vendor.purchase', 'purchase', out.purchaseId, { grnNo: out.grnNo, total: out.total });
    res.status(201).json(out);
  })
);

// --- Vendor payment ---
router.post(
  '/:id/payment',
  requirePermission(PERMISSIONS.VENDOR_MANAGE),
  wrap((req, res) => {
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const amount = Number((req.body || {}).amount || 0);
    if (amount <= 0) return res.status(400).json({ error: 'Positive amount required' });
    db.transaction(() => {
      db.prepare('INSERT INTO vendor_payments (vendor_id, amount, method, reference, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(vendor.id, amount, (req.body || {}).method || 'cash', (req.body || {}).reference || null, req.user.id);
      db.prepare('UPDATE vendors SET balance = balance - ? WHERE id = ?').run(amount, vendor.id);
    })();
    audit(req, 'vendor.payment', 'vendor', vendor.id, { amount });
    res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor.id));
  })
);

// --- Vendor reclaim (return stock to vendor, reduce inventory, credit/cash) ---
router.post(
  '/:id/reclaim',
  requirePermission(PERMISSIONS.VENDOR_MANAGE),
  wrap((req, res) => {
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const b = req.body || {};
    const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ? AND product_id = ?').get(b.batch_id, b.product_id);
    if (!batch) return res.status(400).json({ error: 'Valid batch_id + product_id required' });
    const qty = parseInt(b.quantity, 10);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Positive quantity required' });
    if (batch.quantity < qty) return res.status(400).json({ error: 'Reclaim exceeds batch quantity' });
    const value = Number(b.value != null ? b.value : batch.cost_price * qty);
    const settlement = b.settlement === 'cash' ? 'cash' : 'credit';

    db.transaction(() => {
      db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?').run(qty, batch.id);
      db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, 'reclaim', ?, ?, ?, ?)`
      ).run(b.product_id, batch.id, -qty, `vendor:${vendor.id}`, b.reason || 'Vendor reclaim', req.user.id);
      db.prepare(
        `INSERT INTO vendor_reclaims (vendor_id, product_id, batch_id, quantity, value, reason, settlement, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(vendor.id, b.product_id, batch.id, qty, value, b.reason || null, settlement, req.user.id);
      // Credit reduces what we owe; cash refund does not touch payable.
      if (settlement === 'credit') {
        db.prepare('UPDATE vendors SET balance = balance - ? WHERE id = ?').run(value, vendor.id);
      }
    })();

    audit(req, 'vendor.reclaim', 'vendor', vendor.id, { product_id: b.product_id, qty, value, settlement });
    res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor.id));
  })
);

module.exports = router;
