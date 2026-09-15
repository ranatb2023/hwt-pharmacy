const { db } = require('./db');
const { getSetting } = require('./settings');

// The cap for one employee: their own figure if they have been given one, the
// trust-wide default otherwise. Every screen and report that mentions an
// allowance resolves it HERE, so a personal cap cannot be honoured in one place
// and ignored in another.
function capFor(person) {
  const own = person && person.staff_cap;
  return own == null || own === '' ? Number(getSetting('staff_annual_cap')) : Number(own);
}

// How much staff discount a patient has already consumed this calendar year.
// The annual cap is Administrator-configurable (FR-BIL-05/07) and resets each
// calendar year automatically via the year filter below.
//
// KEYED ON `charge_class`, NOT `category`. The two are different questions:
// `category` is how the person was registered, `charge_class` is what actually
// decided the price of this bill. They part company the moment a staff member
// also holds a welfare card — the card takes precedence in resolveEntitlement(),
// so the bill is priced as CARD_50 while the customer is still categorised
// Staff. Counting that bill here charged the card's relief against the
// employee's own medicine allowance: the trust paid, and the employee silently
// lost the entitlement anyway.
//
// `/reports/staff-allowances` was already keyed this way, so the enforcer and
// the report used to disagree about the same number. One definition now.
// THE YEAR THIS RESETS ON — the second half of Q9.
//
// It follows `fiscal_year_start_month`, the same setting every annual report
// uses, rather than the calendar year it was originally written against. If the
// trust is audited on 1 July – 30 June, an allowance that resets on 1 January
// straddles two audited years and nobody can reconcile the staff-benefit figure
// to the accounts it belongs to.
//
// Setting the month to 1 puts both back on the calendar year together, which is
// the point of tying them: the two can no longer disagree.
function staffAllowance(patientId) {
  const B = require('./businessDay');
  const person = db.prepare('SELECT staff_cap FROM patients WHERE id = ?').get(patientId);
  const cap = capFor(person);

  const startMonth = B.fiscalStartMonth();
  const fy = B.fiscalYearOf(B.businessDate(), startMonth);
  const { from, to } = B.fiscalRange(fy, startMonth);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(discount + subsidy),0) AS used
       FROM bills
       WHERE patient_id = ? AND charge_class = 'STAFF'
         AND status != 'amended'
         AND bizdate(created_at) BETWEEN ? AND ?`
    )
    .get(patientId, from, to);
  const used = row.used;
  return {
    cap,
    used,
    remaining: Math.max(0, cap - used),
    year: B.fiscalLabel(fy, startMonth),
    from,
    to,
  };
}

// Clamp a computed discount to the patient's remaining staff allowance.
// Returns the adjusted { discount, net } (amount over the cap becomes payable).
function clampStaffDiscount(patientId, calc) {
  const { remaining } = staffAllowance(patientId);
  if (calc.discount <= remaining) return { ...calc, cap_excess: 0 };
  const allowed = remaining;
  const shortfall = round(calc.discount - allowed);
  // `cap_excess` is reported, not just absorbed. The shortfall disappears into
  // `net` otherwise, and then nothing downstream — the receipt, the staff
  // statement, the ledger narration — can tell an ordinary staff bill from one
  // the employee is paying for only because their year's allowance ran out.
  return { ...calc, discount: allowed, net: round(calc.net + shortfall), cap_excess: shortfall };
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = { staffAllowance, clampStaffDiscount, capFor };
