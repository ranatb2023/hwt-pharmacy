const { db } = require('./db');
const { getSetting } = require('./settings');

// How much staff discount a patient has already consumed this calendar year.
// The annual cap is Administrator-configurable (FR-BIL-05/07) and resets each
// calendar year automatically via the year filter below.
function staffAllowance(patientId) {
  const cap = Number(getSetting('staff_annual_cap'));
  const year = new Date().getFullYear();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(discount),0) AS used
       FROM bills
       WHERE patient_id = ? AND category = 'Staff'
         AND strftime('%Y', created_at) = ?`
    )
    .get(patientId, String(year));
  const used = row.used;
  return { cap, used, remaining: Math.max(0, cap - used), year };
}

// Clamp a computed discount to the patient's remaining staff allowance.
// Returns the adjusted { discount, net } (amount over the cap becomes payable).
function clampStaffDiscount(patientId, calc) {
  const { remaining } = staffAllowance(patientId);
  if (calc.discount <= remaining) return calc;
  const allowed = remaining;
  const shortfall = calc.discount - allowed;
  return { ...calc, discount: allowed, net: round(calc.net + shortfall) };
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = { staffAllowance, clampStaffDiscount };
