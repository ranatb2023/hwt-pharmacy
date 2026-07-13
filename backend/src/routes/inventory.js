const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

// Live stock-on-hand per product (sum of batch quantities).
function stockOnHand(productId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_batches WHERE product_id = ?')
    .get(productId);
  return row.qty;
}

// --- Products ---
router.get(
  '/products',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = q
      ? db
          .prepare(
            `SELECT * FROM products WHERE is_active = 1 AND (name LIKE ? OR generic_name LIKE ? OR sku LIKE ?)
             ORDER BY name LIMIT 50`
          )
          .all(like, like, like)
      : db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY name LIMIT 100').all();
    for (const p of rows) p.on_hand = stockOnHand(p.id);
    res.json(rows);
  })
);

router.post(
  '/products',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Product name required' });
    const info = db
      .prepare(
        `INSERT INTO products (sku, name, generic_name, form, unit, is_otc, sale_price, reorder_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        b.sku || null,
        b.name,
        b.generic_name || null,
        b.form || null,
        b.unit || 'unit',
        b.is_otc ? 1 : 0,
        b.sale_price || 0,
        b.reorder_level || 10
      );
    audit(req, 'product.create', 'product', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  })
);

// --- Batches / receive stock ---
router.get(
  '/products/:id/batches',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    res.json(
      db
        .prepare('SELECT * FROM stock_batches WHERE product_id = ? ORDER BY expiry_date ASC')
        .all(req.params.id)
    );
  })
);

router.post(
  '/products/:id/receive',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const b = req.body || {};
    const qty = parseInt(b.quantity, 10);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Quantity must be positive' });

    const batchId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO stock_batches (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(product.id, b.batch_no || null, b.expiry_date || null, b.manufacturer || null, b.cost_price || 0, qty);
      const id = info.lastInsertRowid;
      db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, 'purchase', ?, ?, ?, ?)`
      ).run(product.id, id, qty, b.reference || null, 'Goods received', req.user.id);
      return id;
    })();

    audit(req, 'stock.receive', 'product', product.id, { batchId, qty });
    res.status(201).json({ batch: db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId) });
  })
);

// Manual stock adjustment / write-off
router.post(
  '/products/:id/adjust',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const b = req.body || {};
    const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ? AND product_id = ?').get(b.batch_id, product.id);
    if (!batch) return res.status(400).json({ error: 'Valid batch_id required' });
    const delta = parseInt(b.quantity, 10); // signed
    if (!delta) return res.status(400).json({ error: 'Non-zero quantity required' });
    if (batch.quantity + delta < 0) return res.status(400).json({ error: 'Adjustment exceeds batch quantity' });

    db.transaction(() => {
      db.prepare('UPDATE stock_batches SET quantity = quantity + ? WHERE id = ?').run(delta, batch.id);
      db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reason, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(product.id, batch.id, b.type || 'adjust', delta, b.reason || 'Manual adjustment', req.user.id);
    })();

    audit(req, 'stock.adjust', 'product', product.id, { batchId: batch.id, delta, reason: b.reason });
    res.json({ on_hand: stockOnHand(product.id) });
  })
);

// --- Alerts ---
router.get(
  '/alerts',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const lowStock = db
      .prepare(
        `SELECT p.id, p.name, p.reorder_level,
                COALESCE(SUM(b.quantity),0) AS on_hand
         FROM products p LEFT JOIN stock_batches b ON b.product_id = p.id
         WHERE p.is_active = 1
         GROUP BY p.id HAVING on_hand <= p.reorder_level
         ORDER BY on_hand ASC`
      )
      .all();
    const nearExpiry = db
      .prepare(
        `SELECT b.*, p.name FROM stock_batches b JOIN products p ON p.id = b.product_id
         WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL
           AND date(b.expiry_date) <= date('now','+90 day')
         ORDER BY b.expiry_date ASC`
      )
      .all();
    res.json({ low_stock: lowStock, near_expiry: nearExpiry });
  })
);

// --- Movement ledger ---
router.get(
  '/movements',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT m.*, p.name AS product_name FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         ORDER BY m.created_at DESC LIMIT 200`
      )
      .all();
    res.json(rows);
  })
);

module.exports = { router, stockOnHand };
