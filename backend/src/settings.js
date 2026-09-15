const { db } = require('./db');

// Administrator-configurable financial rules (SRS §2.5, FR-BIL-01/04/05, NFR-11).
// Values persist in the `settings` table; defaults apply until overridden.
//
// DEPLOYMENT MODE
// The system ships in two shapes from one codebase:
//   'pharmacy' — Phase 1. A standalone retail pharmacy: counter, inventory,
//                vendors, returns, cash. Nothing that depends on a doctor,
//                reception or laboratory being present is shown, because in a
//                standalone install those records never exist.
//   'hospital' — Phase 2. The full HMS; every module above plus patients,
//                tokens, consultations, prescriptions, lab and dialysis.
// Switching the mode is the whole migration — no code is forked or removed, so
// Phase 2 does not have to merge months of divergence back together.
const DEFAULTS = {
  consultation_fee: 300,
  dialysis_charge: 2500,
  discount_pct: 0.20,        // Discounted category

  // STAFF: the allowance is an amount of MEDICINE, not a rate of discount.
  //
  // An employee's medicine is covered in full until their yearly allowance is
  // used up; after that they pay. So a Rs 50 purchase draws Rs 50 from the
  // allowance and costs them nothing — it does not "give them Rs 25 off and
  // charge Rs 25", which is what a 50% rate did and what the client corrected
  // on 2026-09-08.
  //
  // Kept as a percentage rather than hard-coded so the trust can move to
  // part-coverage without a release. At 1.00 the cap alone decides.
  staff_pct: 1.00,           // share of a staff bill the allowance covers
  staff_annual_cap: 20000,   // per staff member, per year (client, 2026-09-08)
  refund_auth_threshold: 5000,

  // Pakistan's financial year runs 1 July – 30 June and the trust's audited
  // accounts will follow it, so an "annual" report defaults to that rather than
  // to January. Set to 1 if the trust really does report on the calendar year.
  fiscal_year_start_month: 7,

  // --- Dialysis (Phase 05) ---
  // Q8: is the dialysis programme charged what the medicine COST the trust, or
  // what it would have sold for? The unit already writes a "Total Cost" on the
  // paper form; this decides which number goes in it.
  //
  // Defaults to cost, the conservative reading: the trust is charging its own
  // programme, and billing itself at retail would overstate what the programme
  // consumed. Ask the accountant, not only the unit — then change this, not code.
  dialysis_cost_basis: 'cost',   // 'cost' | 'mrp'
  dialysis_base_charge_covered: 1, // does the programme cover the session charge too?

  // --- Pharmacy (Pakistan) ---
  near_expiry_days: 90,        // amber "use or claim soon" window
  expiry_claim_days: 180,      // distributors accept expiry claims this far ahead
  enforce_mrp: 1,              // block selling above the DRAP-notified MRP
  enforce_rx: 1,               // require a prescription for Rx/Schedule-G medicine
  // gst_pct was declared here and never applied to a bill (QA S3-23). The
  // DRAP-notified MRP is tax-inclusive, so no GST is added on a counter line;
  // the setting is gone rather than left reading as implemented. Per-product
  // `tax_pct` stays in the schema for the day general goods are taxed.
  tz_offset_hours: 5,          // Pakistan Standard Time (UTC+5, no DST)

  // Counter discount a pharmacist may give without a billing override. A
  // standalone pharmacy rounds bills down at the counter all day; requiring an
  // authorisation for every Rs 20 would make the till unusable.
  counter_discount_pct: 0.10,

  // --- Counter (Phase 01) ---
  // How many customers one pharmacist can have parked at the counter at once.
  max_parked_sales: 5,
  // An Rs 155 strip of 14 capsules is Rs 11.0714 each. The per-unit price keeps
  // full precision; this rounds the LINE only, the way a counter actually does.
  // 'none' | 'rupee' | 'five'
  loose_rounding: 'rupee',

  // --- Deployment ---
  deployment_mode: 'pharmacy',   // 'pharmacy' (Phase 1) | 'hospital' (Phase 2)
  pharmacy_name: 'Hope Welfare Trust Pharmacy',
  pharmacy_license_no: '',       // drug sale licence, printed on the receipt
  pharmacy_address: '',
  pharmacy_contact: '',
};

// Free-text settings are stored as-is; everything else is coerced to a number.
const TEXT = new Set([
  'deployment_mode', 'pharmacy_name', 'pharmacy_license_no',
  'pharmacy_address', 'pharmacy_contact', 'loose_rounding',
  // A basis, not a number: 'cost' | 'mrp'. Left out of this set, NUMERIC
  // turned it into NaN and every Settings save answered 400 (found Phase 10).
  'dialysis_cost_basis',
]);

const LOOSE_ROUNDING = ['none', 'rupee', 'five'];
const NUMERIC = new Set(Object.keys(DEFAULTS).filter((k) => !TEXT.has(k)));

const MODES = ['pharmacy', 'hospital'];

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
  // The business-day helpers cache the offset; correcting the timezone has to
  // take effect on the next query, not the next restart.
  if (key === 'tz_offset_hours') require('./businessDay').invalidate();
}

// True when hospital-only features (patients, tokens, doctor prescriptions,
// lab, dialysis) should be active. Phase 1 pharmacy installs answer false.
function isHospitalMode() {
  return getSetting('deployment_mode') === 'hospital';
}

module.exports = {
  getSettings, getSetting, setSetting, isHospitalMode,
  DEFAULTS, NUMERIC, TEXT, MODES, LOOSE_ROUNDING,
};
