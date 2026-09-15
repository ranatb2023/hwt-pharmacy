const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const { getSettings, setSetting, DEFAULTS, NUMERIC, MODES } = require('../settings');

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

    // Validate EVERY key before writing ANY of them. Validating and saving in one pass
    // means a bad value halfway down the form returns 400 while the keys before it are
    // already persisted — the administrator is told the update failed and walks away
    // with half of it applied, to prices and discount percentages.
    const changed = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (body[key] == null) continue;
      let val = body[key];
      if (NUMERIC.has(key)) {
        val = Number(val);
        // Every numeric rule is a price, a percentage or a count and cannot be
        // negative — except the timezone offset, which is negative west of UTC.
        const allowNegative = key === 'tz_offset_hours';
        if (Number.isNaN(val) || (val < 0 && !allowNegative)) {
          return res.status(400).json({ error: `Invalid value for ${key}` });
        }
      }
      // Switching deployment mode turns whole modules on and off, so an
      // unrecognised value would leave the system in neither shape.
      if (key === 'deployment_mode' && !MODES.includes(val)) {
        return res.status(400).json({ error: `deployment_mode must be one of: ${MODES.join(', ')}` });
      }
      changed[key] = val;
    }

    // Then write them together, so a power cut cannot leave the pricing rules
    // half-updated either.
    db.transaction(() => {
      for (const [key, val] of Object.entries(changed)) setSetting(key, val);
    })();

    audit(req, 'settings.update', 'settings', null, changed);
    res.json({ settings: getSettings() });
  })
);

module.exports = router;
