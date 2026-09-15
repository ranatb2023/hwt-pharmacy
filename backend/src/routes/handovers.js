const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const H = require('../handovers');

const router = express.Router();
router.use(authenticate);

// The collector's record, on its own. Dispensing writes one as a side effect;
// this exists for the case the paper handles by someone signing later — the
// relative who came back for the medicine after the slip was already made.
router.post(
  '/',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!H.CONTEXTS.includes(b.context)) {
      return res.status(400).json({ error: `context must be one of: ${H.CONTEXTS.join(', ')}` });
    }
    if (!b.taken_by || !String(b.taken_by).trim()) {
      return res.status(400).json({ error: 'Record who collected the medicine.' });
    }
    const row = H.record({ ...b, user_id: req.user.id });
    audit(req, 'handover.record', 'handover', row.id, { context: b.context, ref_id: b.ref_id });
    res.status(201).json(row);
  })
);

// Everything handed to a named person, or everything against one dispense.
// The question this answers is "who took it", and it is asked weeks later.
router.get(
  '/',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT h.*, p.full_name AS customer_name, p.patient_code, u.full_name AS issued_by
           FROM handovers h
           LEFT JOIN patients p ON p.id = h.customer_id
           LEFT JOIN users u ON u.id = h.user_id
          WHERE (:context IS NULL OR h.context = :context)
            AND (:ref IS NULL OR h.ref_id = :ref)
            AND (:q = '' OR h.taken_by LIKE :like OR h.cnic LIKE :like OR h.contact LIKE :like)
          ORDER BY h.id DESC
          LIMIT 200`
      )
      .all({
        context: req.query.context || null,
        ref: req.query.ref_id || null,
        q, like,
      });
    res.json({ relations: H.RELATIONS, rows });
  })
);

module.exports = router;
