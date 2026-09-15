const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { assertDayOpen } = require('../guards');

// The furthest expiry a pack can plausibly carry (UI-03). Shared with the GRN.
function expiryHorizon() {
  const d = new Date(); d.setFullYear(d.getFullYear() + 10);
  return d.toISOString().slice(0, 10);
}
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const { getSetting } = require('../settings');
const { businessDate } = require('../businessDay');
const pk = require('../packaging');

const router = express.Router();
router.use(authenticate);

// Live sellable stock per product. Quarantined and expired batches are both
// excluded: they are physically present but cannot be handed over, so counting
// them would let the counter promise stock that dispensing then refuses —
// the same rule consumeFEFO applies, and the same figure /pharmacy/lookup
// reports as `sellable`.
function stockOnHand(productId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_batches
       WHERE product_id = ? AND quarantined = 0
         AND (expiry_date IS NULL OR date(expiry_date) >= date(?))`
    )
    .get(productId, businessDate());
  return row.qty;
}

const DRUG_SCHEDULES = ['OTC', 'Rx', 'G', 'Narcotic'];

// THE definition of "this needs a batch number and an expiry date".
// One function, one column (`product_types.is_medicine`). The SQL half of the
// same rule is `MEDICINE_SQL` below — keep them together so they cannot drift
// the way the two hand-written string predicates did.
function isMedicine(product) {
  if (product.product_type_id) {
    const t = db.prepare('SELECT is_medicine FROM product_types WHERE id = ?').get(product.product_type_id);
    if (t) return !!t.is_medicine;
  }
  // A product created before the list existed, or pointing at a deleted type:
  // fall back to the safer answer rather than silently exempting it.
  return true;
}

// The same rule, for queries. Assumes `p` is the products alias.
const MEDICINE_SQL =
  '(p.product_type_id IS NULL OR EXISTS (SELECT 1 FROM product_types pt WHERE pt.id = p.product_type_id AND pt.is_medicine = 1))';

// Accept either an id from the dropdown or a name typed by an importer, so the
// product form and a bulk load can both use the same endpoint.
function resolveType(b) {
  if (b.product_type_id) return db.prepare('SELECT * FROM product_types WHERE id = ?').get(b.product_type_id) || null;
  if (b.form) return db.prepare('SELECT * FROM product_types WHERE lower(name) = lower(?)').get(String(b.form).trim()) || null;
  return null;
}

// A unit typed in the "new unit" box joins the list, rather than existing only
// on the one product that introduced it — otherwise the next person types a
// slightly different spelling and the receipts disagree.
function resolveUnit(name) {
  const n = (name || '').trim();
  if (!n) return null;
  const found = db.prepare('SELECT * FROM base_units WHERE lower(name) = lower(?)').get(n);
  if (found) return found.name;
  db.prepare('INSERT INTO base_units (name, sort_order) VALUES (?, 99)').run(n);
  return n;
}

// Same, for the company — but here an unknown name is CREATED rather than
// dropped. Losing a manufacturer silently is what produces a margin report with
// a large unattributed row.
function resolveManufacturer(b) {
  if (b.manufacturer_id) return db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(b.manufacturer_id) || null;
  const name = b.manufacturer && String(b.manufacturer).trim();
  if (!name) return null;
  const found = db.prepare('SELECT * FROM manufacturers WHERE lower(name) = lower(?)').get(name);
  if (found) return found;
  const info = db.prepare('INSERT INTO manufacturers (name) VALUES (?)').run(name);
  return db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(info.lastInsertRowid);
}

// --- Catalogue lists (Phase 01) ---
// "Company-wise sale" is only as good as this data: free text yields GSK, G.S.K
// and Glaxo as three companies, so both lists are managed here.

router.get(
  '/product-types',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM product_types ORDER BY sort_order, name').all());
  })
);

router.post(
  '/product-types',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
    const clash = db.prepare('SELECT id FROM product_types WHERE lower(name) = lower(?)').get(b.name.trim());
    if (clash) return res.status(400).json({ error: `"${b.name}" already exists` });
    const info = db
      .prepare(
        `INSERT INTO product_types (name, is_medicine, default_tax_pct, default_schedule, sort_order, default_unit)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        b.name.trim(),
        b.is_medicine === false || b.is_medicine === 0 ? 0 : 1,
        Number(b.default_tax_pct || 0),
        DRUG_SCHEDULES.includes(b.default_schedule) ? b.default_schedule : 'OTC',
        Number(b.sort_order || 99),
        resolveUnit(b.default_unit)
      );
    audit(req, 'product_type.create', 'product_type', info.lastInsertRowid, { name: b.name });
    res.status(201).json(db.prepare('SELECT * FROM product_types WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.put(
  '/product-types/:id',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const t = db.prepare('SELECT * FROM product_types WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Product type not found' });
    const b = req.body || {};
    if (b.name && b.name.trim() !== t.name) {
      const clash = db.prepare('SELECT id FROM product_types WHERE lower(name) = lower(?) AND id != ?').get(b.name.trim(), t.id);
      if (clash) return res.status(400).json({ error: `"${b.name}" already exists` });
    }
    db.prepare(
      `UPDATE product_types SET name = ?, is_medicine = ?, default_tax_pct = ?,
         default_schedule = ?, sort_order = ?, is_active = ?, default_unit = ? WHERE id = ?`
    ).run(
      b.name ? b.name.trim() : t.name,
      b.is_medicine != null ? (b.is_medicine ? 1 : 0) : t.is_medicine,
      b.default_tax_pct != null ? Number(b.default_tax_pct) : t.default_tax_pct,
      DRUG_SCHEDULES.includes(b.default_schedule) ? b.default_schedule : t.default_schedule,
      b.sort_order != null ? Number(b.sort_order) : t.sort_order,
      b.is_active != null ? (b.is_active ? 1 : 0) : t.is_active,
      b.default_unit !== undefined ? resolveUnit(b.default_unit) : t.default_unit,
      t.id
    );
    audit(req, 'product_type.update', 'product_type', t.id, b);
    res.json(db.prepare('SELECT * FROM product_types WHERE id = ?').get(t.id));
  })
);

router.get(
  '/base-units',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM base_units WHERE is_active = 1 ORDER BY sort_order, name').all());
  })
);

router.post(
  '/base-units',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const clash = db.prepare('SELECT id FROM base_units WHERE lower(name) = lower(?)').get(name);
    if (clash) return res.status(400).json({ error: `"${name}" already exists` });
    const info = db
      .prepare('INSERT INTO base_units (name, descr, sort_order) VALUES (?, ?, 99)')
      .run(name, b.descr || null);
    audit(req, 'base_unit.create', 'base_unit', info.lastInsertRowid, { name });
    res.status(201).json(db.prepare('SELECT * FROM base_units WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.get(
  '/manufacturers',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.manufacturer_id = m.id) AS product_count
             FROM manufacturers m ORDER BY m.name`
        )
        .all()
    );
  })
);

router.post(
  '/manufacturers',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Name is required' });
    const clash = db.prepare('SELECT id FROM manufacturers WHERE lower(name) = lower(?)').get(b.name.trim());
    if (clash) return res.status(400).json({ error: `"${b.name}" already exists` });
    const info = db
      .prepare('INSERT INTO manufacturers (name, contact) VALUES (?, ?)')
      .run(b.name.trim(), b.contact || null);
    audit(req, 'manufacturer.create', 'manufacturer', info.lastInsertRowid, { name: b.name });
    res.status(201).json(db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(info.lastInsertRowid));
  })
);

// Merge one company into another. This is the screen that turns "GSK", "G.S.K"
// and "Glaxo" into one row, and it must move the products before it removes the
// duplicate or the margin report loses them.
router.post(
  '/manufacturers/:id/merge-into/:targetId',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const from = db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(req.params.id);
    const into = db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(req.params.targetId);
    if (!from || !into) return res.status(404).json({ error: 'Manufacturer not found' });
    if (from.id === into.id) return res.status(400).json({ error: 'Cannot merge a company into itself' });

    const moved = db.transaction(() => {
      const r = db
        .prepare('UPDATE products SET manufacturer_id = ?, manufacturer = ? WHERE manufacturer_id = ?')
        .run(into.id, into.name, from.id);
      db.prepare('DELETE FROM manufacturers WHERE id = ?').run(from.id);
      return r.changes;
    })();
    audit(req, 'manufacturer.merge', 'manufacturer', from.id, { from: from.name, into: into.name, moved });
    res.json({ merged: from.name, into: into.name, products_moved: moved });
  })
);

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
            `SELECT * FROM products
             WHERE is_active = 1
               AND (name LIKE ? OR generic_name LIKE ? OR sku LIKE ? OR barcode = ? OR drap_reg_no LIKE ?)
             ORDER BY name LIMIT 50`
          )
          .all(like, like, like, q, like)
      : db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY name LIMIT 100').all();
    for (const p of rows) {
      p.on_hand = stockOnHand(p.id);
      // Ship the answer, not the rule. The receive form needs to know whether a
      // batch number is required, and it must not re-derive that from schedule
      // and form strings — that was a third hand-written copy of the predicate,
      // in the browser, free to disagree with the two on the server.
      p.is_medicine = isMedicine(p) ? 1 : 0;
      Object.assign(p, pk.withPackaging(p, p.on_hand));
    }
    res.json(rows);
  })
);

router.post(
  '/products',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Product name required' });

    const schedule = DRUG_SCHEDULES.includes(b.drug_schedule) ? b.drug_schedule : 'OTC';
    const salePrice = Number(b.sale_price || 0);
    // MRP defaults to the selling price when not supplied, so the ceiling is
    // never accidentally zero (which would read as "no price notified").
    const mrp = b.mrp != null && b.mrp !== '' ? Number(b.mrp) : salePrice;
    if (mrp > 0 && salePrice > mrp) {
      return res.status(400).json({ error: 'Selling price cannot exceed the maximum retail price (MRP).' });
    }
    // Anything other than a general-sale item is a registered drug, and DRAP
    // registration is what makes it legal to stock.
    if (schedule !== 'OTC' && !b.drap_reg_no) {
      return res.status(400).json({ error: 'DRAP registration number is required for prescription medicine.' });
    }

    // Packaging: a box holds strips, a strip holds base units. pack_size is
    // kept as the derived total so older callers keep working.
    const perStrip = Number(b.units_per_strip) > 0 ? Math.floor(Number(b.units_per_strip)) : 1;
    const perBox = Number(b.strips_per_box) > 0 ? Math.floor(Number(b.strips_per_box)) : 1;

    // The dosage form comes from the managed list. `form` is still written with
    // the type's name so everything that already reads it keeps working.
    const type = resolveType(b);
    const maker = resolveManufacturer(b);

    // Required here, not only in the form. The type decides whether a batch
    // number and expiry are demanded on receipt, so a product without one is a
    // product whose compliance rule is undefined — and a bulk import bypasses
    // every check the browser does.
    if (!type) {
      return res.status(400).json({
        error: 'Choose a product type — it decides whether a batch number and expiry are required.',
      });
    }

    const info = db
      .prepare(
        `INSERT INTO products
           (sku, name, generic_name, form, unit, is_otc, sale_price, reorder_level,
            drap_reg_no, strength, pack_size, mrp, drug_schedule, is_refrigerated,
            tax_pct, barcode, manufacturer, units_per_strip, strips_per_box, allow_loose,
            product_type_id, manufacturer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        b.sku || null,
        b.name,
        b.generic_name || null,
        type ? type.name : b.form || null,
        resolveUnit(b.unit) || type?.default_unit || 'unit',
        schedule === 'OTC' ? 1 : 0,
        salePrice,
        b.reorder_level || 10,
        b.drap_reg_no || null,
        b.strength || null,
        perStrip * perBox,
        mrp,
        schedule,
        b.is_refrigerated ? 1 : 0,
        Number(b.tax_pct || 0),
        b.barcode || null,
        maker ? maker.name : b.manufacturer || null,
        perStrip,
        perBox,
        b.allow_loose === false || b.allow_loose === 0 ? 0 : 1,
        type ? type.id : null,
        maker ? maker.id : null
      );
    audit(req, 'product.create', 'product', info.lastInsertRowid, { name: b.name, schedule });
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  })
);

// Update the product master — DRAP number, MRP and classification change with
// each price notification, so they must be editable without re-creating a SKU.
router.put(
  '/products/:id',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const b = req.body || {};

    const schedule = DRUG_SCHEDULES.includes(b.drug_schedule) ? b.drug_schedule : product.drug_schedule;
    const salePrice = b.sale_price != null ? Number(b.sale_price) : product.sale_price;
    const mrp = b.mrp != null && b.mrp !== '' ? Number(b.mrp) : product.mrp;
    if (mrp > 0 && salePrice > mrp) {
      return res.status(400).json({ error: 'Selling price cannot exceed the maximum retail price (MRP).' });
    }

    // SKU is editable, so it has to be updated — and it is UNIQUE, so a clash
    // must come back as a clear 400 rather than a constraint failure.
    const sku = b.sku !== undefined ? (b.sku || null) : product.sku;
    if (sku && sku !== product.sku) {
      const clash = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(sku, product.id);
      if (clash) return res.status(400).json({ error: `SKU "${sku}" is already used by another product.` });
    }

    const perStrip = Number(b.units_per_strip) > 0 ? Math.floor(Number(b.units_per_strip)) : product.units_per_strip || 1;
    const perBox = Number(b.strips_per_box) > 0 ? Math.floor(Number(b.strips_per_box)) : product.strips_per_box || 1;

    const type = resolveType(b) || (product.product_type_id
      ? db.prepare('SELECT * FROM product_types WHERE id = ?').get(product.product_type_id)
      : null);
    const maker = resolveManufacturer(b) || (product.manufacturer_id
      ? db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(product.manufacturer_id)
      : null);

    db.prepare(
      `UPDATE products SET
         sku = ?, name = ?, generic_name = ?, form = ?, unit = ?, sale_price = ?, reorder_level = ?,
         drap_reg_no = ?, strength = ?, pack_size = ?, mrp = ?, drug_schedule = ?,
         is_otc = ?, is_refrigerated = ?, tax_pct = ?, barcode = ?, manufacturer = ?,
         units_per_strip = ?, strips_per_box = ?, allow_loose = ?,
         product_type_id = ?, manufacturer_id = ?
       WHERE id = ?`
    ).run(
      sku,
      b.name || product.name,
      b.generic_name ?? product.generic_name,
      type ? type.name : (b.form ?? product.form),
      resolveUnit(b.unit) || product.unit,
      salePrice,
      b.reorder_level != null ? Number(b.reorder_level) : product.reorder_level,
      b.drap_reg_no ?? product.drap_reg_no,
      b.strength ?? product.strength,
      perStrip * perBox,
      mrp,
      schedule,
      schedule === 'OTC' ? 1 : 0,
      b.is_refrigerated != null ? (b.is_refrigerated ? 1 : 0) : product.is_refrigerated,
      b.tax_pct != null ? Number(b.tax_pct) : product.tax_pct,
      b.barcode ?? product.barcode,
      maker ? maker.name : (b.manufacturer ?? product.manufacturer),
      perStrip,
      perBox,
      b.allow_loose != null ? (b.allow_loose ? 1 : 0) : product.allow_loose,
      type ? type.id : product.product_type_id,
      maker ? maker.id : product.manufacturer_id,
      product.id
    );
    audit(req, 'product.update', 'product', product.id, { name: b.name, schedule, mrp });
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
  })
);

// --- Batches / receive stock ---
router.get(
  '/products/:id/batches',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT sb.*, v.name AS vendor_name
             FROM stock_batches sb LEFT JOIN vendors v ON v.id = sb.vendor_id
            WHERE sb.product_id = ? ORDER BY sb.expiry_date ASC`
        )
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
    assertDayOpen();
    // Stock arrives in boxes or strips but is held in base units, so convert on
    // the way in. `cost_price` and `mrp` are quoted per the same unit of measure
    // the quantity is entered in — a trade price is per box, not per tablet.
    const uom = pk.UOMS.includes(b.uom) ? b.uom : 'unit';
    const entered = parseInt(b.quantity, 10);
    if (!entered || entered <= 0) return res.status(400).json({ error: 'Quantity must be positive' });
    const qty = pk.toBaseUnits(product, entered, uom);
    const perReceivedUnit = pk.unitsIn(product, uom);

    // Stock of a registered drug may not be held without a batch number and an
    // expiry date — it is the batch that makes a recall or an expiry claim
    // possible. General-sale sundries (bandages, etc.) are exempt.
    //
    // The rule lives on product_types.is_medicine and nowhere else. It used to be
    // spelled `drug_schedule = 'OTC' AND form = 'Item'` here AND in the compliance
    // panel; the two copies drifted and produced a gap that could not be closed.
    if (isMedicine(product)) {
      if (!b.batch_no || !String(b.batch_no).trim()) {
        return res.status(400).json({ error: 'Batch number is required when receiving medicine.' });
      }
      if (!b.expiry_date) {
        return res.status(400).json({ error: 'Expiry date is required when receiving medicine.' });
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    if (b.expiry_date && b.expiry_date <= today) {
      return res.status(400).json({ error: `${product.name}: this batch expired on ${b.expiry_date} and cannot be received.`, code: 'EXPIRED' });
    }
    if (b.expiry_date && b.expiry_date > expiryHorizon()) {
      return res.status(400).json({ error: `${product.name}: an expiry of ${b.expiry_date} is more than ten years away — check the year on the pack.`, code: 'EXPIRY_IMPLAUSIBLE', max: expiryHorizon() });
    }

    // Both prices are entered per received unit (per box / per strip) and are
    // stored per base unit, so a batch's cost and MRP stay comparable with the
    // per-unit sale price no matter how the stock was bought in.
    const costPerUnit = pk.round2(Number(b.cost_price || 0) / perReceivedUnit);
    const batchMrp = b.mrp != null && b.mrp !== ''
      ? pk.round2(Number(b.mrp) / perReceivedUnit)
      : product.mrp;
    if (batchMrp > 0 && costPerUnit > batchMrp) {
      return res.status(400).json({ error: 'Trade price cannot exceed the maximum retail price printed on the pack.' });
    }

    const batchId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO stock_batches
             (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity, mrp, vendor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          product.id,
          b.batch_no || null,
          b.expiry_date || null,
          b.manufacturer || product.manufacturer || null,
          costPerUnit,
          qty,
          batchMrp || null,
          b.vendor_id || null
        );
      const id = info.lastInsertRowid;
      db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, 'purchase', ?, ?, ?, ?)`
      ).run(
        product.id, id, qty, b.reference || null,
        `Goods received: ${pk.describeSale(product, entered, uom)}`, req.user.id
      );
      return id;
    })();

    audit(req, 'stock.receive', 'product', product.id, { batchId, qty, entered, uom });
    res.status(201).json({
      batch: db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batchId),
      received: pk.describeSale(product, entered, uom),
      on_hand: stockOnHand(product.id),
      on_hand_label: pk.formatQty(product, stockOnHand(product.id)),
    });
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
    assertDayOpen();
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
    const nearDays = Number(getSetting('near_expiry_days') || 90);
    const lowStock = db
      .prepare(
        `SELECT p.id, p.name, p.reorder_level,
                COALESCE(SUM(b.quantity),0) AS on_hand
         FROM products p LEFT JOIN stock_batches b
           ON b.product_id = p.id AND b.quarantined = 0
         WHERE p.is_active = 1
         GROUP BY p.id HAVING on_hand <= p.reorder_level
         ORDER BY on_hand ASC`
      )
      .all();
    const nearExpiry = db
      .prepare(
        `SELECT b.*, p.name, p.strength, p.drug_schedule,
                CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS days_left
         FROM stock_batches b JOIN products p ON p.id = b.product_id
         WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL
           AND date(b.expiry_date) <= date('now', ?)
         ORDER BY b.expiry_date ASC`
      )
      .all(`+${nearDays} day`);
    res.json({ low_stock: lowStock, near_expiry: nearExpiry, near_expiry_days: nearDays });
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

module.exports = { router, stockOnHand, expiryHorizon };
