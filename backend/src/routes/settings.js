const express = require('express');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const { getSettings, setSetting, DEFAULTS, NUMERIC } = require('../settings');

const router = express.Router();
router.use(authenticate);

// Anyone who bills needs to read prices; only admins can change them.
router.get(
  '/',
  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.USER_MANAGE, PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    res.json({ settings: getSettings(), defaults: DEFAULTS });
  })
);

router.put(
  '/',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const body = req.body || {};
    const changed = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (body[key] == null) continue;
      let val = body[key];
      if (NUMERIC.has(key)) {
        val = Number(val);
        if (Number.isNaN(val) || val < 0) return res.status(400).json({ error: `Invalid value for ${key}` });
      }
      setSetting(key, val);
      changed[key] = val;
    }
    audit(req, 'settings.update', 'settings', null, changed);
    res.json({ settings: getSettings() });
  })
);

module.exports = router;
