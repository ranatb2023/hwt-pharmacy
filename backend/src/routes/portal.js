const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, nextSeq } = require('../db');
const { JWT_SECRET } = require('../config');
const { wrap, pad } = require('../utils');
const { queueSync } = require('../sync');

const router = express.Router();

// Separate token audience for external portal users (donors / patients).
function portalToken(kind, id) {
  return jwt.sign({ sub: id, kind }, JWT_SECRET, { expiresIn: '24h' });
}
function portalAuth(kind) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Login required' });
    try {
      const p = jwt.verify(token, JWT_SECRET);
      if (p.kind !== kind) return res.status(401).json({ error: 'Wrong portal token' });
      req.portalId = p.sub;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function lastSync() {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync'").get();
  return row ? row.value : null;
}

// ===========================================================================
// Donor portal
// ===========================================================================
router.post(
  '/donor/register',
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name || !b.email || !b.password) return res.status(400).json({ error: 'name, email, password required' });
    if (db.prepare('SELECT 1 FROM donors WHERE email = ?').get(b.email)) return res.status(409).json({ error: 'Email already registered' });
    const info = db
      .prepare('INSERT INTO donors (name, email, contact, password_hash) VALUES (?, ?, ?, ?)')
      .run(b.name, b.email, b.contact || null, bcrypt.hashSync(b.password, 10));
    res.status(201).json({ token: portalToken('donor', info.lastInsertRowid), name: b.name });
  })
);

router.post(
  '/donor/login',
  wrap((req, res) => {
    const { email, password } = req.body || {};
    const donor = db.prepare('SELECT * FROM donors WHERE email = ?').get(email);
    if (!donor || !donor.is_active || !bcrypt.compareSync(password || '', donor.password_hash || '')) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: portalToken('donor', donor.id), name: donor.name });
  })
);

// Impact dashboard — aggregated & de-identified (no patient identities).
router.get(
  '/donor/dashboard',
  portalAuth('donor'),
  wrap((req, res) => {
    const one = (sql) => db.prepare(sql).get();
    res.json({
      patients_served: one('SELECT COUNT(*) c FROM patients').c,
      free_patients: one("SELECT COUNT(*) c FROM patients WHERE category='Complete Free'").c,
      total_subsidy: one('SELECT COALESCE(SUM(subsidy),0) s FROM bills').s,
      dialysis_sessions: one("SELECT COUNT(*) c FROM dialysis_sessions WHERE status='completed'").c,
      lab_tests_done: one("SELECT COUNT(*) c FROM lab_orders WHERE status='completed'").c,
      total_donations: one('SELECT COALESCE(SUM(amount),0) s FROM donations WHERE is_pledge=0').s,
      last_sync: lastSync(),
    });
  })
);

router.post(
  '/donor/donate',
  portalAuth('donor'),
  wrap((req, res) => {
    const b = req.body || {};
    const amount = Number(b.amount || 0);
    if (amount <= 0) return res.status(400).json({ error: 'Positive amount required' });
    const receiptNo = `DON-${pad(nextSeq('donation'), 5)}`;
    const info = db
      .prepare('INSERT INTO donations (donor_id, receipt_no, amount, purpose, is_pledge) VALUES (?, ?, ?, ?, ?)')
      .run(req.portalId, receiptNo, amount, b.purpose || 'General fund', b.is_pledge ? 1 : 0);
    queueSync('donation', info.lastInsertRowid, { receiptNo, amount, is_pledge: !!b.is_pledge });
    res.status(201).json({ receipt_no: receiptNo, amount, is_pledge: !!b.is_pledge });
  })
);

router.get(
  '/donor/donations',
  portalAuth('donor'),
  wrap((req, res) => {
    res.json(db.prepare('SELECT receipt_no, amount, purpose, is_pledge, created_at FROM donations WHERE donor_id = ? ORDER BY created_at DESC').all(req.portalId));
  })
);

// ===========================================================================
// Patient portal — strict data isolation, requires online consent.
// ===========================================================================
router.post(
  '/patient/login',
  wrap((req, res) => {
    const { patient_code, contact } = req.body || {};
    const patient = db.prepare('SELECT * FROM patients WHERE patient_code = ?').get(patient_code);
    if (!patient || patient.contact !== contact) return res.status(401).json({ error: 'Invalid Patient ID or contact number' });
    if (!patient.consent_online) return res.status(403).json({ error: 'Online access not consented for this patient' });
    res.json({ token: portalToken('patient', patient.id), name: patient.full_name, patient_code });
  })
);

router.get(
  '/patient/me',
  portalAuth('patient'),
  wrap((req, res) => {
    const id = req.portalId;
    const patient = db.prepare('SELECT patient_code, full_name, gender, age, category FROM patients WHERE id = ?').get(id);
    const visits = db.prepare('SELECT id, visit_type, department, status, created_at FROM visits WHERE patient_id = ? ORDER BY created_at DESC').all(id);
    const consultations = db.prepare('SELECT diagnosis, complaint, referral, created_at FROM consultations WHERE patient_id = ? ORDER BY created_at DESC').all(id);
    const prescriptions = db.prepare('SELECT medicine_name, dosage, frequency, duration, created_at FROM prescriptions WHERE patient_id = ? ORDER BY created_at DESC').all(id);
    const lab = db.prepare(
      `SELECT lt.name AS test_name, lo.result_value, lo.status, lo.completed_at, lo.report_path
       FROM lab_orders lo JOIN lab_tests lt ON lt.id = lo.lab_test_id
       WHERE lo.patient_id = ? ORDER BY lo.created_at DESC`
    ).all(id);
    const bills = db.prepare('SELECT bill_no, net_amount, status, created_at FROM bills WHERE patient_id = ? ORDER BY created_at DESC').all(id);
    res.json({ patient, visits, consultations, prescriptions, lab, bills, last_sync: lastSync() });
  })
);

module.exports = router;
