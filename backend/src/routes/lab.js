const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');
fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Persist a base64/data-URL report file to disk and return its served path.
function saveReportFile(orderId, fileName, fileData) {
  const m = /^data:(.*?);base64,(.*)$/s.exec(fileData);
  const base64 = m ? m[2] : fileData;
  const safeName = String(fileName || 'report').replace(/[^\w.\-]/g, '_').slice(-60);
  const rel = `${orderId}-${Date.now()}-${safeName}`;
  fs.writeFileSync(path.join(REPORTS_DIR, rel), Buffer.from(base64, 'base64'));
  return `/reports/${rel}`;
}

// --- Test catalogue ---
router.get(
  '/tests',
  requirePermission(PERMISSIONS.LAB_VIEW, PERMISSIONS.CONSULT_MANAGE),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM lab_tests WHERE is_active = 1 ORDER BY name').all());
  })
);

router.post(
  '/tests',
  requirePermission(PERMISSIONS.LAB_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Test name required' });
    const info = db
      .prepare(
        `INSERT INTO lab_tests (code, name, sample_type, normal_range, unit, price)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(b.code || null, b.name, b.sample_type || null, b.normal_range || null, b.unit || null, b.price || 0);
    audit(req, 'lab.test.create', 'lab_test', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM lab_tests WHERE id = ?').get(info.lastInsertRowid));
  })
);

// --- Work-list ---
router.get(
  '/orders',
  requirePermission(PERMISSIONS.LAB_VIEW),
  wrap((req, res) => {
    const status = req.query.status; // ordered/collected/completed
    const base = `SELECT lo.*, lt.name AS test_name, lt.normal_range, lt.unit, lt.sample_type,
                         p.patient_code, p.full_name, p.category
                  FROM lab_orders lo
                  JOIN lab_tests lt ON lt.id = lo.lab_test_id
                  JOIN patients p ON p.id = lo.patient_id`;
    const rows = status
      ? db.prepare(`${base} WHERE lo.status = ? ORDER BY lo.created_at ASC`).all(status)
      : db.prepare(`${base} ORDER BY lo.created_at DESC LIMIT 100`).all();
    res.json(rows);
  })
);

// --- Record result / complete ---
router.put(
  '/orders/:id/result',
  requirePermission(PERMISSIONS.LAB_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const order = db.prepare('SELECT * FROM lab_orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Lab order not found' });

    // Accept an uploaded report file (PDF/image) or a manually-typed path.
    let reportPath = b.report_path || null;
    if (b.file_data) {
      try {
        reportPath = saveReportFile(order.id, b.file_name, b.file_data);
      } catch (e) {
        return res.status(400).json({ error: 'Could not save report file' });
      }
    }

    db.prepare(
      `UPDATE lab_orders SET
         result_value = ?, result_notes = ?, report_path = ?,
         status = 'completed', completed_by = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(b.result_value || null, b.result_notes || null, reportPath, req.user.id, order.id);

    audit(req, 'lab.result', 'lab_order', order.id, { result_value: b.result_value });
    res.json(db.prepare('SELECT * FROM lab_orders WHERE id = ?').get(order.id));
  })
);

router.put(
  '/orders/:id/collect',
  requirePermission(PERMISSIONS.LAB_MANAGE),
  wrap((req, res) => {
    const order = db.prepare('SELECT * FROM lab_orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Lab order not found' });
    db.prepare("UPDATE lab_orders SET status = 'collected' WHERE id = ?").run(order.id);
    audit(req, 'lab.collect', 'lab_order', order.id);
    res.json(db.prepare('SELECT * FROM lab_orders WHERE id = ?').get(order.id));
  })
);

module.exports = router;
