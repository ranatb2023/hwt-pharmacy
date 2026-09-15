// Who pays, and how much of it.
//
// ONE place decides that. Every route that prices anything calls
// `resolveEntitlement()`; nothing works it out for itself. The moment two
// screens each derive their own discount they disagree, and the one the
// customer is shown is not the one the report totals.
//
//   Complete Free -> net 0, full amount recorded as subsidy
//   Discounted    -> configurable percentage discount (Administrator-set)
//   Staff         -> staff percentage, clamped against an annual cap elsewhere
//   Paid          -> full amount payable
//
// A welfare card, when the customer has one, takes precedence over the category
// they were registered with — the card is the current decision, the category is
// the historical one.
const { db } = require('./db');
const { getSettings } = require('./settings');

// ---------------------------------------------------------------------------
// The category rules that shipped first. Kept as an internal case so nothing
// already live changes behaviour until a card actually exists for a customer.
// ---------------------------------------------------------------------------
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

const CATEGORY_CHARGE_CLASS = {
  'Paid': 'PAID',
  'Complete Free': 'ZAKAT',
  'Discounted': 'CARD_20',
  'Staff': 'STAFF',
};

// The live card for a customer, if any. Expiry is checked here rather than by a
// nightly job: a card that lapsed this morning must stop working this morning,
// and nothing on this site runs on a schedule.
function activeCard(customerId) {
  if (!customerId) return null;
  const card = db
    .prepare(
      `SELECT c.*, t.code AS tier_code, t.name AS tier_name, t.discount_pct, t.monthly_ceiling
         FROM welfare_cards c JOIN card_tiers t ON t.id = c.tier_id
        WHERE c.customer_id = ? AND c.status = 'active' AND t.is_active = 1
        ORDER BY t.discount_pct DESC LIMIT 1`
    )
    .get(customerId);
  if (!card) return null;
  if (card.valid_till && card.valid_till < new Date().toISOString().slice(0, 10)) {
    return { ...card, expired: true };
  }
  return card;
}

// Does this tier cover this line? Most specific rule wins: a rule naming the
// product type beats the tier's blanket default, so "everything except
// cosmetics" is two rows rather than a list of every type that IS covered.
function tierCovers(tierId, line) {
  const rules = db
    .prepare('SELECT * FROM card_tier_scope WHERE tier_id = ?')
    .all(tierId);
  if (!rules.length) return true;

  let verdict = true;
  let best = -1;
  for (const r of rules) {
    let specificity = 0;
    if (r.product_type_id != null) {
      if (r.product_type_id !== line.product_type_id) continue;
      specificity += 2;
    }
    if (r.item_type != null) {
      if (r.item_type !== (line.item_type || 'pharmacy')) continue;
      specificity += 1;
    }
    if (specificity >= best) {
      best = specificity;
      verdict = !!r.covered;
    }
  }
  return verdict;
}

// How much of this month's ceiling the card has already used.
function ceilingUsed(cardId) {
  const month = new Date().toISOString().slice(0, 7);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(discount + subsidy), 0) AS used
         FROM bills WHERE welfare_card_id = ? AND strftime('%Y-%m', created_at) = ?`
    )
    .get(cardId, month);
  return row.used;
}

// ---------------------------------------------------------------------------
// THE entitlement decision.
//
//   customer  the patients row (may be null for a walk-in)
//   lines     [{ amount, product_type_id?, item_type? }]
//   opts      { manualDiscount, costCentre, forceCategory }
//
// Returns the same shape applyCategory always did, plus what the bill needs to
// record about WHY: the charge class, the card and the fund that paid.
// ---------------------------------------------------------------------------
function resolveEntitlement(customer, lines, opts = {}) {
  const s = getSettings();
  const rows = Array.isArray(lines) ? lines : [{ amount: lines }];
  const gross = round(rows.reduce((t, l) => t + (Number(l.amount) || 0), 0));

  const category = opts.forceCategory || customer?.category || 'Paid';
  const card = opts.ignoreCard ? null : activeCard(customer?.id);

  // No live card: the category rules decide, exactly as before.
  if (!card || card.expired) {
    const calc = applyCategory(gross, category, opts);
    return {
      ...calc,
      charge_class: CATEGORY_CHARGE_CLASS[category] || 'PAID',
      card: null,
      card_id: null,
      fund_id: null,
      // Surfaced so the counter can say WHY the discount it expected is absent.
      card_refused: card?.expired
        ? { reason: 'expired', card_no: card.card_no, valid_till: card.valid_till }
        : null,
    };
  }

  // A card discounts only the lines its tier covers. The rest bill in full.
  let covered = 0;
  let uncovered = 0;
  for (const l of rows) {
    const amt = Number(l.amount) || 0;
    if (tierCovers(card.tier_id, l)) covered += amt;
    else uncovered += amt;
  }

  let relief = round(covered * card.discount_pct);

  // A monthly ceiling caps the help, it does not remove it: the customer pays
  // the excess rather than losing the whole entitlement.
  let ceiling_hit = false;
  if (card.monthly_ceiling > 0) {
    const left = Math.max(0, card.monthly_ceiling - ceilingUsed(card.id));
    if (relief > left) { relief = round(left); ceiling_hit = true; }
  }

  // A full-support card is the trust GIVING the medicine, which is a subsidy to
  // be reported to donors. A partial card is a discount. The distinction is what
  // makes "what did we give away" answerable.
  const isFull = card.discount_pct >= 1;
  let discount = isFull ? 0 : relief;
  let subsidy = isFull ? relief : 0;

  if (opts.manualDiscount) discount = round(discount + Number(opts.manualDiscount));

  const net = Math.max(0, round(gross - discount - subsidy));
  return {
    gross: round(gross),
    discount,
    subsidy,
    net,
    charge_class: card.tier_code,
    card: { card_no: card.card_no, tier: card.tier_name, pct: card.discount_pct },
    card_id: card.id,
    fund_id: card.fund_id || null,
    covered_amount: round(covered),
    uncovered_amount: round(uncovered),
    ceiling_hit,
    card_refused: null,
  };
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  applyCategory,
  resolveEntitlement,
  activeCard,
  tierCovers,
  ceilingUsed,
  CATEGORY_CHARGE_CLASS,
};
