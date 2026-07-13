const { db } = require('./db');

// Administrator-configurable financial rules (SRS §2.5, FR-BIL-01/04/05, NFR-11).
// Values persist in the `settings` table; defaults apply until overridden.
const DEFAULTS = {
  consultation_fee: 300,
  dialysis_charge: 2500,
  discount_pct: 0.20,        // Discounted category
  staff_pct: 0.50,           // Staff category (before cap)
  staff_annual_cap: 50000,   // per staff member, per calendar year
  refund_auth_threshold: 5000,
};

const NUMERIC = new Set(Object.keys(DEFAULTS));

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const r of rows) {
    out[r.key] = NUMERIC.has(r.key) ? Number(r.value) : r.value;
  }
  return out;
}

function getSetting(key) {
  return getSettings()[key];
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

module.exports = { getSettings, getSetting, setSetting, DEFAULTS, NUMERIC };
