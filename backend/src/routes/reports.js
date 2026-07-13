const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

// Management dashboard — daily operational visibility.
router.get(
  '/dashboard',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const one = (sql, ...args) => db.prepare(sql).get(...args);

    res.json({
      patients_today: one("SELECT COUNT(*) c FROM patients WHERE date(created_at)=?", today).c,
      patients_total: one('SELECT COUNT(*) c FROM patients').c,
      tokens_today: one('SELECT COUNT(*) c FROM tokens WHERE token_date=?', today).c,
      lab_pending: one("SELECT COUNT(*) c FROM lab_orders WHERE status!='completed'").c,
      revenue_today: one("SELECT COALESCE(SUM(paid_amount),0) s FROM bills WHERE date(created_at)=?", today).s,
      subsidy_today: one("SELECT COALESCE(SUM(subsidy),0) s FROM bills WHERE date(created_at)=?", today).s,
      low_stock: one(
        `SELECT COUNT(*) c FROM (
           SELECT p.id FROM products p LEFT JOIN stock_batches b ON b.product_id=p.id
           WHERE p.is_active=1 GROUP BY p.id
           HAVING COALESCE(SUM(b.quantity),0) <= p.reorder_level)`
      ).c,
    });
  })
);

// Discount / subsidy report by period.
router.get(
  '/subsidy',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '2999-12-31';
    const rows = db
      .prepare(
        `SELECT category,
                COUNT(*) AS bills,
                COALESCE(SUM(gross_amount),0) AS gross,
                COALESCE(SUM(discount),0) AS discount,
                COALESCE(SUM(subsidy),0) AS subsidy,
                COALESCE(SUM(net_amount),0) AS net
         FROM bills WHERE date(created_at) BETWEEN ? AND ?
         GROUP BY category ORDER BY category`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Recent audit trail.
router.get(
  '/audit',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200').all());
  })
);

// --- Date range helper ---
function range(req) {
  return { from: req.query.from || '1970-01-01', to: req.query.to || '2999-12-31' };
}

// Revenue — grouped by day, category, or bill type.
router.get(
  '/revenue',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const group = ['day', 'category', 'type'].includes(req.query.group) ? req.query.group : 'day';
    const col = group === 'day' ? "date(created_at)" : group === 'category' ? 'category' : 'bill_type';
    const rows = db
      .prepare(
        `SELECT ${col} AS label, COUNT(*) AS bills,
                COALESCE(SUM(gross_amount),0) AS gross,
                COALESCE(SUM(discount),0) AS discount,
                COALESCE(SUM(subsidy),0) AS subsidy,
                COALESCE(SUM(net_amount),0) AS net,
                COALESCE(SUM(paid_amount),0) AS collected
         FROM bills WHERE date(created_at) BETWEEN ? AND ?
         GROUP BY ${col} ORDER BY ${col}`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Stock valuation — on-hand qty × cost, plus sale value.
router.get(
  '/stock-valuation',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.sale_price,
                COALESCE(SUM(b.quantity),0) AS on_hand,
                COALESCE(SUM(b.quantity * b.cost_price),0) AS cost_value,
                COALESCE(SUM(b.quantity),0) * p.sale_price AS sale_value
         FROM products p LEFT JOIN stock_batches b ON b.product_id = p.id
         WHERE p.is_active = 1
         GROUP BY p.id ORDER BY cost_value DESC`
      )
      .all();
    res.json(rows);
  })
);

// Vendor payables + purchase/reclaim totals.
router.get(
  '/vendors',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.VENDOR_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT v.id, v.name, v.balance,
                COALESCE((SELECT SUM(total_amount) FROM purchases WHERE vendor_id=v.id),0) AS purchased,
                COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE vendor_id=v.id),0) AS paid,
                COALESCE((SELECT SUM(value) FROM vendor_reclaims WHERE vendor_id=v.id),0) AS reclaimed
         FROM vendors v WHERE v.is_active = 1 ORDER BY v.balance DESC`
      )
      .all();
    res.json(rows);
  })
);

// Returns report.
router.get(
  '/returns',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT r.return_no, r.created_at, r.refund_amount, r.reason,
                COALESCE(p.full_name, r.customer_name) AS customer,
                (SELECT SUM(quantity) FROM return_items WHERE return_id=r.id AND saleable=1) AS restocked,
                (SELECT SUM(quantity) FROM return_items WHERE return_id=r.id AND saleable=0) AS writtenoff
         FROM returns r LEFT JOIN patients p ON p.id = r.patient_id
         WHERE date(r.created_at) BETWEEN ? AND ? ORDER BY r.created_at DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Cash flow report — session reconciliation by period.
router.get(
  '/cashflow',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT cs.id, cs.counter, u.full_name AS user_name, cs.opened_at, cs.closed_at,
                cs.opening_float, cs.expected_cash, cs.counted_cash, cs.variance, cs.status
         FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
         WHERE date(cs.opened_at) BETWEEN ? AND ? ORDER BY cs.opened_at DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Patient register.
router.get(
  '/patients',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT patient_code, full_name, gender, age, category, contact, date(created_at) AS registered
         FROM patients WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Lab productivity — tests ordered vs completed.
router.get(
  '/lab',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.LAB_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT lt.name AS test_name,
                COUNT(*) AS ordered,
                SUM(CASE WHEN lo.status='completed' THEN 1 ELSE 0 END) AS completed,
                COALESCE(SUM(lo.price),0) AS revenue
         FROM lab_orders lo JOIN lab_tests lt ON lt.id = lo.lab_test_id
         WHERE date(lo.created_at) BETWEEN ? AND ?
         GROUP BY lt.id ORDER BY ordered DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Dialysis activity by category.
router.get(
  '/dialysis',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT p.category, COUNT(*) AS sessions,
                COALESCE(SUM(b.gross_amount),0) AS gross,
                COALESCE(SUM(b.subsidy),0) AS subsidy,
                COALESCE(SUM(b.net_amount),0) AS net
         FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id
         LEFT JOIN bills b ON b.id = s.bill_id
         WHERE s.status='completed' AND date(s.scheduled_at) BETWEEN ? AND ?
         GROUP BY p.category`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Stock-movement ledger (FR-REP-04).
router.get(
  '/stock-movements',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT m.created_at, p.name AS product_name, m.type, m.quantity, m.reference, m.reason
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         WHERE date(m.created_at) BETWEEN ? AND ?
         ORDER BY m.created_at DESC LIMIT 500`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Staff discount consumed vs annual cap, per staff member (FR-REP-11).
router.get(
  '/staff-discount',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const { getSetting } = require('../settings');
    const cap = Number(getSetting('staff_annual_cap'));
    const year = String(new Date().getFullYear());
    const rows = db
      .prepare(
        `SELECT p.patient_code, p.full_name,
                COALESCE(SUM(b.discount),0) AS used
         FROM patients p
         LEFT JOIN bills b ON b.patient_id = p.id AND b.category='Staff'
              AND strftime('%Y', b.created_at) = ?
         WHERE p.category = 'Staff'
         GROUP BY p.id ORDER BY used DESC`
      )
      .all(year);
    rows.forEach((r) => { r.cap = cap; r.remaining = Math.max(0, cap - r.used); });
    res.json(rows);
  })
);

module.exports = router;
