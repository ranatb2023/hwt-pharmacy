const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

// Issue a department token tied to an existing visit/patient.
router.post(
  '/',
  requirePermission(PERMISSIONS.TOKEN_MANAGE),
  wrap((req, res) => {
    const { visit_id, department } = req.body || {};
    if (!visit_id || !department) return res.status(400).json({ error: 'visit_id and department required' });
    const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(visit_id);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    const today = new Date().toISOString().slice(0, 10);
    // Daily per-department running number.
    const seqName = `token:${department}:${today}`;
    const number = nextSeq(seqName);

    const info = db
      .prepare(
        `INSERT INTO tokens (visit_id, patient_id, department, token_number, token_date)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(visit_id, visit.patient_id, department, number, today);

    db.prepare("UPDATE visits SET department = ?, updated_at = datetime('now') WHERE id = ?").run(
      department,
      visit_id
    );

    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(info.lastInsertRowid);
    audit(req, 'token.create', 'token', token.id, { department, number });
    res.status(201).json(token);
  })
);

// Department work-list / queue for today
router.get(
  '/queue/:department',
  requirePermission(PERMISSIONS.TOKEN_MANAGE, PERMISSIONS.CONSULT_MANAGE, PERMISSIONS.LAB_VIEW),
  wrap((req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(
        `SELECT t.*, p.patient_code, p.full_name, p.category
         FROM tokens t JOIN patients p ON p.id = t.patient_id
         WHERE t.department = ? AND t.token_date = ?
         ORDER BY t.token_number ASC`
      )
      .all(req.params.department, today);
    res.json(rows);
  })
);

router.put(
  '/:id/status',
  requirePermission(PERMISSIONS.TOKEN_MANAGE, PERMISSIONS.CONSULT_MANAGE, PERMISSIONS.LAB_MANAGE),
  wrap((req, res) => {
    const { status } = req.body || {};
    const allowed = ['waiting', 'serving', 'done', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const t = db.prepare('SELECT * FROM tokens WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Token not found' });
    db.prepare('UPDATE tokens SET status = ? WHERE id = ?').run(status, t.id);
    audit(req, 'token.status', 'token', t.id, { status });
    res.json(db.prepare('SELECT * FROM tokens WHERE id = ?').get(t.id));
  })
);

module.exports = router;
