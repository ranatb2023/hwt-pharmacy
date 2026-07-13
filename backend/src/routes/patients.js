const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { queueSync } = require('../sync');
const { newPatientCode, newQrToken, wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

const CATEGORIES = ['Paid', 'Complete Free', 'Discounted', 'Staff'];

// List / search patients
router.get(
  '/',
  requirePermission(PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = db
        .prepare(
          `SELECT * FROM patients
           WHERE patient_code LIKE ? OR full_name LIKE ? OR contact LIKE ? OR cnic LIKE ?
           ORDER BY created_at DESC LIMIT 50`
        )
        .all(like, like, like, like);
    } else {
      rows = db.prepare('SELECT * FROM patients ORDER BY created_at DESC LIMIT 50').all();
    }
    res.json(rows);
  })
);

// Lookup by QR token (near-instant patient open)
router.get(
  '/by-qr/:qr',
  requirePermission(PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const p = db.prepare('SELECT * FROM patients WHERE qr_token = ?').get(req.params.qr);
    if (!p) return res.status(404).json({ error: 'Patient not found' });
    res.json(p);
  })
);

// Resolve a scanned QR value or typed Patient ID to a record — a QR scan and
// a manual Patient ID entry are treated as fully equivalent inputs (FR-QR-03).
router.get(
  '/resolve/:key',
  requirePermission(PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const key = (req.params.key || '').trim();
    const p = db
      .prepare('SELECT * FROM patients WHERE patient_code = ? OR qr_token = ?')
      .get(key, key);
    if (!p) return res.status(404).json({ error: 'No patient matches that ID / QR' });
    res.json(p);
  })
);

// Find existing patients by contact number or CNIC — used at reception to
// surface a returning patient before a duplicate record is created (FR-PAT-03/07).
// Declared before '/:id' so the static path is matched first.
router.get(
  '/lookup',
  requirePermission(PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const contact = (req.query.contact || '').trim();
    const cnic = (req.query.cnic || '').trim();
    if (!contact && !cnic) return res.json([]);
    const rows = db
      .prepare(
        `SELECT id, patient_code, full_name, gender, age, contact, cnic, category
         FROM patients
         WHERE (@contact != '' AND contact = @contact)
            OR (@cnic != '' AND cnic = @cnic)
         ORDER BY created_at DESC LIMIT 5`
      )
      .all({ contact, cnic });
    res.json(rows);
  })
);

// Single patient with full longitudinal history
router.get(
  '/:id',
  requirePermission(PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Patient not found' });

    p.visits = db.prepare('SELECT * FROM visits WHERE patient_id = ? ORDER BY created_at DESC').all(p.id);
    p.consultations = db
      .prepare('SELECT * FROM consultations WHERE patient_id = ? ORDER BY created_at DESC')
      .all(p.id);
    p.lab_orders = db
      .prepare(
        `SELECT lo.*, lt.name AS test_name FROM lab_orders lo
         JOIN lab_tests lt ON lt.id = lo.lab_test_id
         WHERE lo.patient_id = ? ORDER BY lo.created_at DESC`
      )
      .all(p.id);
    p.prescriptions = db
      .prepare('SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY created_at DESC')
      .all(p.id);
    p.bills = db.prepare('SELECT * FROM bills WHERE patient_id = ? ORDER BY created_at DESC').all(p.id);
    res.json(p);
  })
);

// Register a new patient (+ opening visit)
router.post(
  '/',
  requirePermission(PERMISSIONS.PATIENT_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.full_name) return res.status(400).json({ error: 'Patient name is required' });
    const category = CATEGORIES.includes(b.category) ? b.category : 'Paid';

    // Warn about likely duplicates (same name + contact, or same CNIC) unless
    // the receptionist explicitly confirms with force=true (FR-PAT-07).
    if (!b.force) {
      const dupes = db
        .prepare(
          `SELECT id, patient_code, full_name, contact, cnic FROM patients
           WHERE (contact IS NOT NULL AND contact != '' AND contact = @contact AND full_name = @full_name)
              OR (cnic IS NOT NULL AND cnic != '' AND cnic = @cnic)
           LIMIT 5`
        )
        .all({ contact: b.contact || null, full_name: b.full_name, cnic: b.cnic || null });
      if (dupes.length) {
        return res.status(409).json({ error: 'Possible duplicate patient', duplicates: dupes });
      }
    }

    const result = db.transaction(() => {
      const code = newPatientCode();
      const qr = newQrToken();
      const info = db
        .prepare(
          `INSERT INTO patients
           (patient_code, full_name, gender, dob, age, contact, cnic, guardian_name,
            address, category, qr_token, consent_online, created_by)
           VALUES (@patient_code,@full_name,@gender,@dob,@age,@contact,@cnic,@guardian_name,
                   @address,@category,@qr_token,@consent_online,@created_by)`
        )
        .run({
          patient_code: code,
          full_name: b.full_name,
          gender: b.gender || null,
          dob: b.dob || null,
          age: b.age || null,
          contact: b.contact || null,
          cnic: b.cnic || null,
          guardian_name: b.guardian_name || null,
          address: b.address || null,
          category,
          qr_token: qr,
          consent_online: b.consent_online ? 1 : 0,
          created_by: req.user.id,
        });
      const patientId = info.lastInsertRowid;

      // Opening visit
      const visitInfo = db
        .prepare(
          `INSERT INTO visits (patient_id, visit_type, department, created_by)
           VALUES (?, ?, ?, ?)`
        )
        .run(patientId, b.visit_type || 'OPD', b.department || null, req.user.id);

      return { patientId, visitId: visitInfo.lastInsertRowid, code, qr };
    })();

    audit(req, 'patient.create', 'patient', result.patientId, { code: result.code });
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(result.patientId);
    // Only agreed, de-identified fields are queued for the cloud tier.
    queueSync('patient', result.patientId, { patient_code: result.code, category: patient.category });
    res.status(201).json({ patient, visit_id: result.visitId });
  })
);

// Open a new visit for an existing patient — the returning-patient path at
// reception. Mirrors the opening visit created during registration, so the
// front end can print the same token receipt (FR-PAT-03, FR-TOK-01).
router.post(
  '/:id/visit',
  requirePermission(PERMISSIONS.PATIENT_MANAGE),
  wrap((req, res) => {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    const b = req.body || {};
    const info = db
      .prepare(
        `INSERT INTO visits (patient_id, visit_type, department, created_by)
         VALUES (?, ?, ?, ?)`
      )
      .run(patient.id, b.visit_type || 'OPD', b.department || null, req.user.id);
    audit(req, 'visit.create', 'visit', info.lastInsertRowid, { patient_id: patient.id });
    res.status(201).json({ patient, visit_id: info.lastInsertRowid });
  })
);

// Edit demographics (audited)
router.put(
  '/:id',
  requirePermission(PERMISSIONS.PATIENT_MANAGE),
  wrap((req, res) => {
    const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });
    const b = req.body || {};
    const category = CATEGORIES.includes(b.category) ? b.category : existing.category;

    db.prepare(
      `UPDATE patients SET
         full_name=@full_name, gender=@gender, dob=@dob, age=@age, contact=@contact,
         cnic=@cnic, guardian_name=@guardian_name, address=@address, category=@category,
         consent_online=@consent_online, updated_at=datetime('now')
       WHERE id=@id`
    ).run({
      id: existing.id,
      full_name: b.full_name ?? existing.full_name,
      gender: b.gender ?? existing.gender,
      dob: b.dob ?? existing.dob,
      age: b.age ?? existing.age,
      contact: b.contact ?? existing.contact,
      cnic: b.cnic ?? existing.cnic,
      guardian_name: b.guardian_name ?? existing.guardian_name,
      address: b.address ?? existing.address,
      category,
      consent_online: b.consent_online != null ? (b.consent_online ? 1 : 0) : existing.consent_online,
    });
    audit(req, 'patient.update', 'patient', existing.id, { before: existing, after: b });
    res.json(db.prepare('SELECT * FROM patients WHERE id = ?').get(existing.id));
  })
);

module.exports = router;
