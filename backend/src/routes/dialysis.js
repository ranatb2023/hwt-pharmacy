const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { applyCategory } = require('../billingRules');
const { newBillNo, wrap } = require('../utils');
const { consumeFEFO, paidStatus } = require('./pharmacy');
const { getSetting } = require('../settings');

const router = express.Router();
router.use(authenticate);

// --- Stations ---
router.get(
  '/stations',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => res.json(db.prepare('SELECT * FROM dialysis_stations WHERE is_active = 1 ORDER BY name').all()))
);

router.post(
  '/stations',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    if (!req.body?.name) return res.status(400).json({ error: 'Station name required' });
    const info = db.prepare('INSERT INTO dialysis_stations (name) VALUES (?)').run(req.body.name);
    res.status(201).json(db.prepare('SELECT * FROM dialysis_stations WHERE id = ?').get(info.lastInsertRowid));
  })
);

// --- Sessions list (optionally by date) ---
router.get(
  '/sessions',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const date = req.query.date;
    const base = `SELECT s.*, p.full_name, p.patient_code, p.category, st.name AS station_name, u.full_name AS staff_name
                  FROM dialysis_sessions s
                  JOIN patients p ON p.id = s.patient_id
                  LEFT JOIN dialysis_stations st ON st.id = s.station_id
                  LEFT JOIN users u ON u.id = s.staff_id`;
    const rows = date
      ? db.prepare(`${base} WHERE date(s.scheduled_at) = ? ORDER BY s.scheduled_at`).all(date)
      : db.prepare(`${base} ORDER BY s.scheduled_at DESC LIMIT 100`).all();
    res.json(rows);
  })
);

// --- Schedule (conflict check on station + time window) ---
router.post(
  '/sessions',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.patient_id || !b.scheduled_at) return res.status(400).json({ error: 'patient_id and scheduled_at required' });
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Avoid double-booking a station at the same scheduled time.
    if (b.station_id) {
      const clash = db
        .prepare(
          `SELECT 1 FROM dialysis_sessions
           WHERE station_id = ? AND scheduled_at = ? AND status != 'cancelled'`
        )
        .get(b.station_id, b.scheduled_at);
      if (clash) return res.status(409).json({ error: 'Station already booked for that time' });
    }

    const info = db
      .prepare(
        `INSERT INTO dialysis_sessions (patient_id, station_id, staff_id, scheduled_at, duration_min, base_charge, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(b.patient_id, b.station_id || null, b.staff_id || req.user.id, b.scheduled_at, b.duration_min || 240,
           b.base_charge != null ? Number(b.base_charge) : Number(getSetting('dialysis_charge')), b.notes || null, req.user.id);
    audit(req, 'dialysis.schedule', 'dialysis_session', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM dialysis_sessions WHERE id = ?').get(info.lastInsertRowid));
  })
);

// --- Complete a session: record vitals, deduct consumables, bill by category ---
router.post(
  '/sessions/:id/complete',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const session = db.prepare('SELECT * FROM dialysis_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'completed') return res.status(400).json({ error: 'Session already completed' });
    const b = req.body || {};
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(session.patient_id);
    const consumables = (b.consumables || []).filter((c) => c.product_id && c.quantity > 0);

    const out = db.transaction(() => {
      let consumableTotal = 0;
      const usedSnapshot = [];
      for (const c of consumables) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(c.product_id);
        if (!product) { const e = new Error(`Product ${c.product_id} not found`); e.status = 400; throw e; }
        consumeFEFO(product.id, c.quantity, 'dispense', `dialysis:${session.id}`, req.user.id);
        const line = product.sale_price * c.quantity;
        consumableTotal += line;
        usedSnapshot.push({ product_id: product.id, name: product.name, quantity: c.quantity, unit_price: product.sale_price, line });
      }

      const gross = Number(session.base_charge || 0) + consumableTotal;
      const calc = applyCategory(gross, patient.category);
      const billNo = newBillNo();
      const paid = calc.net;
      const billInfo = db
        .prepare(
          `INSERT INTO bills (bill_no, patient_id, category, bill_type, gross_amount, discount, subsidy, net_amount, paid_amount, status, created_by)
           VALUES (?, ?, ?, 'dialysis', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(billNo, patient.id, patient.category, calc.gross, calc.discount, calc.subsidy, calc.net, paid, paidStatus(calc.net, paid), req.user.id);
      const billId = billInfo.lastInsertRowid;

      const itemStmt = db.prepare(
        `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
         VALUES (?, 'dialysis', ?, ?, ?, ?, ?)`
      );
      itemStmt.run(billId, session.id, 'Dialysis session', 1, session.base_charge, session.base_charge);
      for (const u of usedSnapshot) itemStmt.run(billId, u.product_id, `Consumable: ${u.name}`, u.quantity, u.unit_price, u.line);

      db.prepare(
        `UPDATE dialysis_sessions SET status = 'completed', pre_vitals = ?, post_vitals = ?, notes = ?, consumables = ?, bill_id = ?
         WHERE id = ?`
      ).run(
        b.pre_vitals ? JSON.stringify(b.pre_vitals) : session.pre_vitals,
        b.post_vitals ? JSON.stringify(b.post_vitals) : null,
        b.notes || session.notes,
        JSON.stringify(usedSnapshot),
        billId,
        session.id
      );
      return { billId, billNo, gross, subsidy: calc.subsidy };
    })();

    audit(req, 'dialysis.complete', 'dialysis_session', session.id, { billNo: out.billNo });
    res.json(out);
  })
);

// --- Period activity report ---
router.get(
  '/report',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '2999-12-31';
    const rows = db
      .prepare(
        `SELECT p.category, COUNT(*) AS sessions,
                COALESCE(SUM(b.gross_amount),0) AS gross,
                COALESCE(SUM(b.subsidy),0) AS subsidy,
                COALESCE(SUM(b.net_amount),0) AS net
         FROM dialysis_sessions s
         JOIN patients p ON p.id = s.patient_id
         LEFT JOIN bills b ON b.id = s.bill_id
         WHERE s.status = 'completed' AND date(s.scheduled_at) BETWEEN ? AND ?
         GROUP BY p.category`
      )
      .all(from, to);
    res.json(rows);
  })
);

module.exports = router;
