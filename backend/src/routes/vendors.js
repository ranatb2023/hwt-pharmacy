const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { assertDayOpen } = require('../guards');
const { expiryHorizon } = require('./inventory');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap, pad } = require('../utils');
const { getSetting } = require('../settings');
const pk = require('../packaging');
const L = require('../ledger');

// `vendors.balance` is now a CACHE over the vendor ledger account, not a number
// kept by hand. Every movement posts an entry and then rewrites the column from
// the account, inside the same transaction — so the two cannot drift, and the
// column stays readable by the older queries that still select it.
//
// Callers must already be in a transaction. A payable that survives while the
// goods-received note it belongs to rolls back is worse than no ledger at all.
function postToVendor(vendor, entry) {
  const party = L.partyFor({ vendor });
  const acct = L.accountFor(party.id, 'vendor');
  L.post(acct.id, entry);
  const fresh = db.prepare('SELECT balance FROM ledger_accounts WHERE id = ?').get(acct.id);
  db.prepare('UPDATE vendors SET balance = ? WHERE id = ?').run(fresh.balance, vendor.id);
  return acct;
}

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

// NOTE: these literal paths MUST stay above `router.get('/:id')`. Express matches
// in declaration order, so /vendors/bookings would otherwise be read as a vendor
// whose id is the string "bookings" and answer 404.

// ---------------------------------------------------------------------------
// Order bookings
//
// The system does NOT issue purchase orders. The order taker visits in person
// and writes the order in his own book; the paper book stays authoritative.
// These rows are only a memo, so the counter can see "Getz order booked 4 Sep,
// not yet delivered" — and so a GRN can close the booking when it arrives.
// ---------------------------------------------------------------------------

router.get(
  '/bookings',
  requirePermission(PERMISSIONS.VENDOR_VIEW),
  wrap((req, res) => {
    const status = req.query.status;
    const rows = db
      .prepare(
        `SELECT ob.*, v.name AS vendor_name,
                (SELECT COUNT(*) FROM purchases pu WHERE pu.order_booking_id = ob.id) AS deliveries
           FROM order_bookings ob JOIN vendors v ON v.id = ob.vendor_id
          WHERE (? IS NULL OR ob.status = ?)
          ORDER BY ob.booked_on DESC, ob.id DESC LIMIT 200`
      )
      .all(status || null, status || null);
    res.json(rows);
  })
);

router.post(
  '/bookings',
  requirePermission(PERMISSIONS.VENDOR_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.vendor_id) return res.status(400).json({ error: 'Vendor is required' });
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(b.vendor_id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const info = db
      .prepare(
        `INSERT INTO order_bookings (vendor_id, taker_name, taker_contact, booked_on, expected_on, notes, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        vendor.id,
        b.taker_name || null,
        b.taker_contact || null,
        b.booked_on || new Date().toISOString().slice(0, 10),
        b.expected_on || null,
        b.notes || null,
        req.user.id
      );
    audit(req, 'vendor.booking.create', 'order_booking', info.lastInsertRowid, { vendor: vendor.name });
    res.status(201).json(db.prepare('SELECT * FROM order_bookings WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.put(
  '/bookings/:id',
  requirePermission(PERMISSIONS.VENDOR_MANAGE),
  wrap((req, res) => {
    const ob = db.prepare('SELECT * FROM order_bookings WHERE id = ?').get(req.params.id);
    if (!ob) return res.status(404).json({ error: 'Booking not found' });
    const b = req.body || {};
    const STATUSES = ['booked', 'partial', 'delivered', 'cancelled'];
    const status = STATUSES.includes(b.status) ? b.status : ob.status;
    db.prepare(
      'UPDATE order_bookings SET taker_name = ?, taker_contact = ?, expected_on = ?, notes = ?, status = ? WHERE id = ?'
    ).run(
      b.taker_name ?? ob.taker_name,
      b.taker_contact ?? ob.taker_contact,
      b.expected_on ?? ob.expected_on,
      b.notes ?? ob.notes,
      status,
      ob.id
    );
    audit(req, 'vendor.booking.update', 'order_booking', ob.id, { status });
    res.json(db.prepare('SELECT * FROM order_bookings WHERE id = ?').get(ob.id));
  })
);

// The sheet you hand the order taker when he walks in. Everything at or below
// its reorder level, suggested in BOXES because that is how stock is bought.
router.get(
  '/demand-slip',
  requirePermission(PERMISSIONS.VENDOR_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.strength, p.sku, p.reorder_level, p.units_per_strip, p.strips_per_box,
                p.manufacturer,
                COALESCE((SELECT SUM(sb.quantity) FROM stock_batches sb
                           WHERE sb.product_id = p.id AND sb.quarantined = 0), 0) AS on_hand
           FROM products p
          WHERE p.is_active = 1
          ORDER BY p.name`
      )
      .all();

    const items = rows
      .filter((r) => r.on_hand <= r.reorder_level)
      .map((r) => {
        const perBox = pk.unitsPerBox(r);
        const short = Math.max(0, r.reorder_level * 2 - r.on_hand);
        return {
          ...r,
          on_hand_label: pk.formatQty(r, r.on_hand),
          suggest_boxes: Math.max(1, Math.ceil(short / perBox)),
          units_per_box: perBox,
        };
      });

    res.json({
      generated_at: new Date().toISOString(),
      pharmacy: getSetting('pharmacy_name'),
      items,
    });
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
    assertDayOpen();

    const out = db.transaction(() => {
      const grnNo = `GRN-${pad(nextSeq('grn'), 5)}`;
      let total = 0;
      const purchaseInfo = db
        .prepare(
          `INSERT INTO purchases (grn_no, vendor_id, invoice_no, total_amount, paid_amount, notes, created_by, order_booking_id)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .run(
          grnNo, vendor.id, b.invoice_no || null, Number(b.paid_amount || 0),
          b.notes || null, req.user.id, b.order_booking_id || null
        );
      const purchaseId = purchaseInfo.lastInsertRowid;

      // Recording the delivery closes the booking it fulfils, so the counter's
      // "still to arrive" list empties itself instead of needing to be tidied by
      // hand — which is how such a list stops being believed.
      if (b.order_booking_id) {
        db.prepare(
          "UPDATE order_bookings SET status = ? WHERE id = ? AND vendor_id = ? AND status IN ('booked','partial')"
        ).run(b.partial_delivery ? 'partial' : 'delivered', b.order_booking_id, vendor.id);
      }

      // vendor_id on EVERY batch, without exception. Margin by distributor is
      // built from it, and a batch received without one is a sale whose supplier
      // can never be known afterwards — the stock is on the shelf and the
      // question "who sold us this" has no answer.
      const batchStmt = db.prepare(
        `INSERT INTO stock_batches
           (product_id, batch_no, expiry_date, manufacturer, cost_price, quantity, vendor_id, mrp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const itemStmt = db.prepare(
        `INSERT INTO purchase_items (purchase_id, product_id, batch_id, quantity, cost_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const moveStmt = db.prepare(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
         VALUES (?, ?, 'purchase', ?, ?, 'Goods received', ?)`
      );

      const today = new Date().toISOString().slice(0, 10);
      for (const it of items) {
        const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(it.product_id);
        if (!product) { const e = new Error(`Product ${it.product_id} not found`); e.status = 400; throw e; }
        if (it.expiry_date && it.expiry_date <= today) { const e = new Error(`${product.name}: this batch expired on ${it.expiry_date} and cannot be received.`); e.status = 400; e.code = 'EXPIRED'; throw e; }
        if (it.expiry_date && it.expiry_date > expiryHorizon()) { const e = new Error(`${product.name}: an expiry of ${it.expiry_date} is more than ten years away — check the year on the pack.`); e.status = 400; e.code = 'EXPIRY_IMPLAUSIBLE'; throw e; }
        const cost = Number(it.cost_price || 0);
        const lineTotal = cost * it.quantity;
        total += lineTotal;
        const batch = batchStmt.run(
          it.product_id, it.batch_no || null, it.expiry_date || null,
          it.manufacturer || vendor.name, cost, it.quantity,
          vendor.id, it.mrp != null ? Number(it.mrp) : null
        );
        itemStmt.run(purchaseId, it.product_id, batch.lastInsertRowid, it.quantity, cost, lineTotal);
        moveStmt.run(it.product_id, batch.lastInsertRowid, it.quantity, grnNo, req.user.id);
      }

      const paid = Number(b.paid_amount || 0);
      if (paid > total + 0.001) {
        const e = new Error(`Paid on receipt (${paid}) is more than the invoice (${total}). Record the excess as a separate advance.`);
        e.status = 400;
        throw e;
      }
      db.prepare('UPDATE purchases SET total_amount = ? WHERE id = ?').run(total, purchaseId);
      // Two entries, not one net figure: the invoice raises what is owed, the
      // money handed over on receipt reduces it. Netting them into one debit
      // hid the payment from the statement and, when the invoice was paid in
      // full, tried to post a zero or negative amount the ledger refuses. See
      // the sign convention at the top of ledger.js.
      postToVendor(vendor, {
        debit: total,
        reference: grnNo,
        narration: `Goods received — ${items.length} item${items.length === 1 ? '' : 's'}`
          + (b.invoice_no ? ` (invoice ${b.invoice_no})` : ''),
        user_id: req.user.id,
      });
      if (paid > 0) {
        db.prepare('INSERT INTO vendor_payments (vendor_id, amount, method, reference, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(vendor.id, paid, b.method || 'cash', grnNo, req.user.id);
        postToVendor(vendor, {
          credit: paid,
          reference: grnNo,
          narration: `Paid on receipt — ${b.method || 'cash'}`,
          user_id: req.user.id,
        });
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
      postToVendor(vendor, {
        credit: amount,
        reference: (req.body || {}).reference || null,
        narration: `Payment to vendor — ${(req.body || {}).method || 'cash'}`,
        user_id: req.user.id,
      });
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
      // Mark the batch as claimed so it stops being offered as "still claimable"
      // on the pharmacy dashboard. A partial reclaim leaves the remainder open.
      db.prepare(
        `UPDATE stock_batches
         SET claim_status = CASE WHEN quantity > 0 THEN 'none' ELSE 'claimed' END
         WHERE id = ?`
      ).run(batch.id);
      // Credit reduces what we owe; cash refund does not touch payable.
      if (settlement === 'credit') {
        postToVendor(vendor, {
          credit: value,
          reference: `reclaim:${b.product_id}`,
          narration: `Stock returned — ${qty} × ${b.reason || 'reclaim'}`,
          user_id: req.user.id,
        });
      }
    })();

    audit(req, 'vendor.reclaim', 'vendor', vendor.id, { product_id: b.product_id, qty, value, settlement });
    res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor.id));
  })
);

module.exports = router;
