// Applies patient-category billing rules to a gross amount.
// Returns { gross, discount, subsidy, net } — one consistent place for the policy.
//
//   Complete Free -> net 0, full amount recorded as subsidy
//   Discounted    -> configurable percentage discount (Administrator-set)
//   Staff         -> staff discount percentage, tracked against an annual cap elsewhere
//   Paid          -> full amount payable
const { getSettings } = require('./settings');

function applyCategory(gross, category, opts = {}) {
  const s = getSettings();
  const g = Math.max(0, Number(gross) || 0);
  let discount = 0;
  let subsidy = 0;

  switch (category) {
    case 'Complete Free':
      subsidy = g;
      break;
    case 'Discounted':
      discount = round(g * (opts.discountPct ?? s.discount_pct));
      break;
    case 'Staff':
      discount = round(g * (opts.staffPct ?? s.staff_pct));
      break;
    case 'Paid':
    default:
      break;
  }

  // Extra manual discount (requires billing.override at the route layer).
  if (opts.manualDiscount) discount = round(discount + Number(opts.manualDiscount));

  const net = Math.max(0, round(g - discount - subsidy));
  return { gross: round(g), discount, subsidy, net };
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = { applyCategory };
