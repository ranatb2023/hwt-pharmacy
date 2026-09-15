const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { queueSync } = require('../sync');
const { applyCategory, resolveEntitlement } = require('../billingRules');
const { staffAllowance, clampStaffDiscount } = require('../staffCap');
const { newBillNo, wrap } = require('../utils');
const { getSetting } = require('../settings');
const { postCashIfOpen } = require('./cashflow');
const { paidStatus, fullBill } = require('./pharmacy');

const router = express.Router();
router.use(authenticate);

// Build a proposed clinical bill for a visit (consultation + completed lab orders).
router.get(
  '/visit/:visitId/preview',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const visit = db
      .prepare(
        `SELECT v.*, p.category, p.full_name, p.patient_code
         FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`
      )
      .get(req.params.visitId);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    const items = [];
    const hasConsult = db.prepare('SELECT 1 FROM consultations WHERE visit_id = ? LIMIT 1').get(visit.id);
    if (hasConsult) {
      const fee = Number(getSetting('consultation_fee'));
      items.push({ item_type: 'consultation', description: 'Doctor consultation', quantity: 1, unit_price: fee, line_total: fee });
    }
    const labs = db
      .prepare(
        `SELECT lo.id, lt.name, lo.price FROM lab_orders lo
         JOIN lab_tests lt ON lt.id = lo.lab_test_id
         WHERE lo.visit_id = ?`
      )
      .all(visit.id);
    for (const l of labs) {
      items.push({ item_type: 'lab', ref_id: l.id, description: `Lab: ${l.name}`, quantity: 1, unit_price: l.price, line_total: l.price });
    }

    const gross = items.reduce((s, i) => s + i.line_total, 0);
    let calc = applyCategory(gross, visit.category);
    let allowance = null;
    if (visit.category === 'Staff') {
      allowance = staffAllowance(visit.patient_id);
      calc = clampStaffDiscount(visit.patient_id, calc);
    }
    res.json({ visit, category: visit.category, items, staff_allowance: allowance, ...calc });
  })
);

// Finalize a clinical bill for a visit.
router.post(
  '/visit/:visitId',
  requirePermission(PERMISSIONS.BILLING_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const visit = db
      .prepare('SELECT v.*, p.category FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?')
      .get(req.params.visitId);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    if (b.manual_discount && !req.user.permissions.includes(PERMISSIONS.BILLING_OVERRIDE)) {
      return res.status(403).json({ error: 'Manual discount requires authorization' });
    }

    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return res.status(400).json({ error: 'No billable items' });
    const gross = items.reduce((s, i) => s + Number(i.line_total || 0), 0);
    let calc = applyCategory(gross, visit.category, { manualDiscount: b.manual_discount });
    if (visit.category === 'Staff') calc = clampStaffDiscount(visit.patient_id, calc);
    const paid = b.paid_amount != null ? Number(b.paid_amount) : calc.net;
    const method = ['cash', 'card', 'online'].includes(b.payment_method) ? b.payment_method : 'cash';

    const result = db.transaction(() => {
      const billNo = newBillNo();
      const info = db
        .prepare(
          `INSERT INTO bills
             (bill_no, visit_id, patient_id, category, bill_type,
              gross_amount, discount, subsidy, net_amount, paid_amount, payment_method, status, created_by)
           VALUES (?, ?, ?, ?, 'clinical', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNo, visit.id, visit.patient_id, visit.category,
          calc.gross, calc.discount, calc.subsidy, calc.net, paid, method,
          paidStatus(calc.net, paid), req.user.id
        );
      const billId = info.lastInsertRowid;
      const stmt = db.prepare(
        `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const i of items) {
        stmt.run(billId, i.item_type || 'other', i.ref_id || null, i.description || '', i.quantity || 1, i.unit_price || 0, i.line_total || 0);
      }
      db.prepare("UPDATE visits SET status = 'billed', updated_at = datetime('now') WHERE id = ?").run(visit.id);
      postCashIfOpen(req.user.id, paid, 'clinical', billNo, method);
      return billId;
    })();

    audit(req, 'billing.create', 'bill', result, { visit_id: visit.id, subsidy: calc.subsidy });
    queueSync('bill', result, { category: visit.category, net: calc.net, subsidy: calc.subsidy });
    res.status(201).json(fullBill(result));
  })
);

// Staff discount allowance for a patient (shown before billing).
router.get(
  '/staff-allowance/:patientId',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const p = db.prepare('SELECT category FROM patients WHERE id = ?').get(req.params.patientId);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    res.json({ category: p.category, ...staffAllowance(req.params.patientId) });
  })
);

// Record a payment against a bill.
router.post(
  '/:id/pay',
  requirePermission(PERMISSIONS.BILLING_MANAGE),
  wrap((req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const amount = Number((req.body || {}).amount || 0);
    if (amount <= 0) return res.status(400).json({ error: 'Positive amount required' });
    const method = ['cash', 'card', 'online'].includes((req.body || {}).payment_method) ? req.body.payment_method : bill.payment_method || 'cash';
    const paid = bill.paid_amount + amount;
    db.prepare('UPDATE bills SET paid_amount = ?, payment_method = ?, status = ? WHERE id = ?').run(
      paid,
      method,
      paidStatus(bill.net_amount, paid),
      bill.id
    );
    postCashIfOpen(req.user.id, amount, 'payment', bill.bill_no, method);
    audit(req, 'billing.pay', 'bill', bill.id, { amount, method });
    res.json(fullBill(bill.id));
  })
);

// Find a bill by the number printed on it. That is all an admin has when
// someone brings a receipt back: not an id, a piece of paper.
router.get(
  '/lookup',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const no = (req.query.bill_no || '').trim();
    if (!no) return res.status(400).json({ error: 'Enter a bill number' });
    const bill = db
      .prepare('SELECT * FROM bills WHERE bill_no = ? COLLATE NOCASE')
      .get(no);
    if (!bill) return res.status(404).json({ error: `No bill numbered ${no}` });
    bill.items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);
    res.json(bill);
  })
);

// Declared BEFORE '/:id' so the static path is matched first.
router.get(
  '/:id',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json(fullBill(bill.id));
  })
);

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------


// Amend a bill on a day whose till is already closed.
//
// Gated on `billing.amend`, NOT `billing.override`. Letting a senior pharmacist
// discount at the counter and letting them rewrite last week's takings are two
// different authorities, and an auditor will expect to see them held by
// different people.
router.post(
  '/:id/amend',
  requirePermission(PERMISSIONS.BILLING_AMEND),
  wrap((req, res) => {
    const original = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Bill not found' });
    const b = req.body || {};

    const { consumeFEFO } = require('./pharmacy');
    const { openSessionFor } = require('./cashflow');
    const A = require('../amend');

    // The money lands on the till that is open NOW. Without one it has nowhere
    // to go, and a correction that quietly moves no cash is how a drawer ends
    // the day short with no explanation.
    const till = openSessionFor(req.user.id);
    if (!till && !b.accept_no_till) {
      return res.status(409).json({
        error: 'No till is open, so a refund or a collection has nowhere to land. '
          + 'Open the till first, or amend without moving cash if nothing changes hands.',
        code: 'TILL_NOT_OPEN',
        retry_with: { accept_no_till: true },
      });
    }

    let out;
    try {
      out = db.transaction(() => A.amend(original, {
        lines: b.lines,
        reason: b.reason,
        userId: req.user.id,
        consumeFEFO,
        openSession: till,
      }))();
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    audit(req, 'billing.amend', 'bill', original.id, out);
    res.status(201).json(out);
  })
);

router.get(
  '/:id/amendments',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const A = require('../amend');
    res.json(A.chainFor(Number(req.params.id)));
  })
);

module.exports = router;
