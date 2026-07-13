const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

// Visit + patient context for the consultation screen.
router.get(
  '/context/:visitId',
  requirePermission(PERMISSIONS.CONSULT_MANAGE, PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.visitId);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(visit.patient_id);
    const history = db
      .prepare('SELECT * FROM consultations WHERE patient_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(visit.patient_id);
    res.json({ visit, patient, history });
  })
);

// Record a consultation together with prescriptions and lab orders.
router.post(
  '/',
  requirePermission(PERMISSIONS.CONSULT_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.visit_id) return res.status(400).json({ error: 'visit_id required' });
    const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(b.visit_id);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    const out = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO consultations
             (visit_id, patient_id, doctor_id, vitals, complaint, notes, diagnosis, referral)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          visit.id,
          visit.patient_id,
          req.user.id,
          b.vitals ? JSON.stringify(b.vitals) : null,
          b.complaint || null,
          b.notes || null,
          b.diagnosis || null,
          b.referral || null
        );
      const consultationId = info.lastInsertRowid;

      // Prescriptions
      const presStmt = db.prepare(
        `INSERT INTO prescriptions
           (consultation_id, patient_id, product_id, medicine_name, dosage, frequency, duration, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of b.prescriptions || []) {
        if (!p.medicine_name) continue;
        presStmt.run(
          consultationId,
          visit.patient_id,
          p.product_id || null,
          p.medicine_name,
          p.dosage || null,
          p.frequency || null,
          p.duration || null,
          p.instructions || null
        );
      }

      // Lab orders
      const labStmt = db.prepare(
        `INSERT INTO lab_orders (visit_id, patient_id, lab_test_id, ordered_by, price)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const testId of b.lab_test_ids || []) {
        const test = db.prepare('SELECT * FROM lab_tests WHERE id = ?').get(testId);
        if (!test) continue;
        labStmt.run(visit.id, visit.patient_id, testId, req.user.id, test.price);
      }

      const nextStatus = (b.lab_test_ids || []).length ? 'lab' : 'in-consultation';
      db.prepare("UPDATE visits SET status = ?, doctor_id = ?, updated_at = datetime('now') WHERE id = ?").run(
        nextStatus,
        req.user.id,
        visit.id
      );

      return consultationId;
    })();

    audit(req, 'consultation.create', 'consultation', out, { visit_id: visit.id });
    const consultation = db.prepare('SELECT * FROM consultations WHERE id = ?').get(out);
    res.status(201).json(consultation);
  })
);

module.exports = router;
