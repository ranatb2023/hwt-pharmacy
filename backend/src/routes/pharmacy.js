const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { applyCategory } = require('../billingRules');
const { clampStaffDiscount } = require('../staffCap');
const { postCashIfOpen } = require('./cashflow');
const { newBillNo, wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

// FEFO: consume up to `qty` from the earliest-expiring batches with stock.
// Returns the quantity actually dispensed. With opts.allowPartial the caller
// tolerates a shortfall; otherwise a shortfall throws (all-or-nothing).
function consumeFEFO(productId, qty, movementType, reference, userId, opts = {}) {
  let remaining = qty;
  const batches = db
    .prepare(
      `SELECT * FROM stock_batches
       WHERE product_id = ? AND quantity > 0
       ORDER BY (expiry_date IS NULL), expiry_date ASC, id ASC`
    )
    .all(productId);

  const now = new Date().toISOString().slice(0, 10);
  for (const batch of batches) {
    if (remaining <= 0) break;
    // Never dispense expired stock.
    if (batch.expiry_date && batch.expiry_date < now) continue;
    const take = Math.min(batch.quantity, remaining);
    db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?').run(take, batch.id);
    db.prepare(
      `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, batch.id, movementType, -take, reference, movementType, userId);
    remaining -= take;
  }
  if (remaining > 0 && !opts.allowPartial) {
    const err = new Error('Insufficient non-expired stock');
    err.status = 400;
    throw err;
  }
  return qty - remaining; // quantity actually dispensed
}

// Prescriptions for a patient with current dispensed flag + live stock.
router.get(
  '/prescriptions/:patientId',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT pr.*, p.sale_price,
                (SELECT COALESCE(SUM(quantity),0) FROM stock_batches WHERE product_id = pr.product_id) AS on_hand
         FROM prescriptions pr LEFT JOIN products p ON p.id = pr.product_id
         WHERE pr.patient_id = ? ORDER BY pr.created_at DESC`
      )
      .all(req.params.patientId);
    res.json(rows);
  })
);

// Dispense / sell: unified line-item billing that deducts stock via FEFO.
// body: { patient_id?, visit_id?, customer_name?, category?, items:[{product_id, quantity, unit_price?}],
//         manual_discount?, paid_amount? }
router.post(
  '/sale',
  requirePermission(PERMISSIONS.PHARMACY_SELL, PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.filter((i) => i.product_id && i.quantity > 0) : [];
    if (!items.length) return res.status(400).json({ error: 'At least one item required' });

    // Resolve patient category (walk-in customers default to Paid).
    let category = b.category || 'Paid';
    if (b.patient_id) {
      const patient = db.prepare('SELECT category FROM patients WHERE id = ?').get(b.patient_id);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });
      category = patient.category;
    }

    if (b.manual_discount && !req.user.permissions.includes(PERMISSIONS.BILLING_OVERRIDE)) {
      return res.status(403).json({ error: 'Manual discount requires authorization' });
    }

    const allowPartial = !!b.allow_partial;

    const result = db.transaction(() => {
      const method = ['cash', 'card', 'online'].includes(b.payment_method) ? b.payment_method : 'cash';
      const billNo = newBillNo();

      // Consume stock first (FEFO), then price by what was actually dispensed so
      // a partial dispense bills only the supplied quantity (FR-PHA-09).
      let gross = 0;
      const lines = [];
      const shortfalls = [];
      for (const i of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(i.product_id);
        if (!product) { const e = new Error(`Product ${i.product_id} not found`); e.status = 400; throw e; }
        const unit = i.unit_price != null ? Number(i.unit_price) : product.sale_price;
        const requested = i.quantity;
        const dispensed = consumeFEFO(product.id, requested, 'dispense', billNo, req.user.id, { allowPartial });
        const shortfall = requested - dispensed;
        if (shortfall > 0) shortfalls.push({ product: product.name, requested, dispensed, shortfall });
        if (dispensed > 0) {
          const line = unit * dispensed;
          gross += line;
          lines.push({ product, dispensed, unit, line });
        }
      }
      if (!lines.length) { const e = new Error('Nothing could be dispensed — no stock available'); e.status = 400; throw e; }

      let calc = applyCategory(gross, category, { manualDiscount: b.manual_discount });
      if (category === 'Staff' && b.patient_id) calc = clampStaffDiscount(b.patient_id, calc);
      const paidAmt = b.paid_amount != null ? Number(b.paid_amount) : calc.net;
      const billInfo = db
        .prepare(
          `INSERT INTO bills
             (bill_no, visit_id, patient_id, customer_name, category, bill_type,
              gross_amount, discount, subsidy, net_amount, paid_amount, payment_method, status, created_by)
           VALUES (?, ?, ?, ?, ?, 'pharmacy-sale', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNo, b.visit_id || null, b.patient_id || null, b.customer_name || null, category,
          calc.gross, calc.discount, calc.subsidy, calc.net, paidAmt, method,
          paidStatus(calc.net, paidAmt), req.user.id
        );
      const billId = billInfo.lastInsertRowid;

      const itemStmt = db.prepare(
        `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
         VALUES (?, 'pharmacy', ?, ?, ?, ?, ?)`
      );
      for (const p of lines) {
        itemStmt.run(billId, p.product.id, p.product.name, p.dispensed, p.unit, p.line);
        // Fully-supplied prescription lines are marked dispensed; short lines stay pending.
        const short = shortfalls.find((s) => s.product === p.product.name);
        if (b.patient_id && !short) {
          db.prepare(
            `UPDATE prescriptions SET dispensed = 1
             WHERE patient_id = ? AND product_id = ? AND dispensed = 0`
          ).run(b.patient_id, p.product.id);
        }
      }
      postCashIfOpen(req.user.id, paidAmt, 'sale', billNo, method);
      return { billId, billNo, shortfalls };
    })();

    audit(req, 'pharmacy.sale', 'bill', result.billId, { billNo: result.billNo, shortfalls: result.shortfalls });
    const bill = fullBill(result.billId);
    bill.shortfalls = result.shortfalls;
    res.status(201).json(bill);
  })
);

function paidStatus(net, paid) {
  if (paid >= net) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function fullBill(id) {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
  bill.items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(id);
  return bill;
}

module.exports = { router, consumeFEFO, paidStatus, fullBill };
