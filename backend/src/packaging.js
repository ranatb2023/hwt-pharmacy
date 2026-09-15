// Packaging and units of measure.
//
// A Pakistani pharmacy sells the same medicine at three levels:
//
//     box (dabba)  →  strip (patta)  →  loose tablet
//
// A customer asks for "do goli" (2 tablets), "aik patta" (one strip) or a full
// box, and the counter has to price and deduct all three from the same shelf.
//
// Everything downstream of this module — stock_batches.quantity, FEFO, bill
// line quantities, movement ledger — is denominated in BASE UNITS, the smallest
// thing that can be handed over: one tablet, one capsule, one bottle, one vial.
// Only the counter and the forms speak in strips and boxes; they convert here.
// Keeping one internal unit is what stops a half-strip from ever becoming
// unrepresentable in stock.
//
// Products that do not come in strips (syrups, injections, sundries) simply
// have units_per_strip = 1 and strips_per_box = 1, so the same arithmetic
// applies without special-casing them.

const UOMS = ['unit', 'strip', 'box'];

function unitsPerStrip(product) {
  const n = Number(product?.units_per_strip);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function stripsPerBox(product) {
  const n = Number(product?.strips_per_box);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

// Base units in one full box.
function unitsPerBox(product) {
  return unitsPerStrip(product) * stripsPerBox(product);
}

// How many base units one of the given unit of measure is worth.
function unitsIn(product, uom) {
  if (uom === 'box') return unitsPerBox(product);
  if (uom === 'strip') return unitsPerStrip(product);
  return 1;
}

// Convert a counter quantity ("3 strips") into base units ("30 tablets").
function toBaseUnits(product, qty, uom = 'unit') {
  const n = Math.floor(Number(qty) || 0);
  if (n <= 0) return 0;
  return n * unitsIn(product, uom);
}

// True when this product can be broken out of its strip. Antibiotics sold as a
// full course, sealed boxes and anything not strip-packed cannot be.
function canSellLoose(product) {
  if (unitsPerStrip(product) <= 1) return true; // already a single unit
  return product?.allow_loose == null ? true : !!product.allow_loose;
}

// Split a base-unit quantity into boxes / strips / loose, largest first. This
// is how a pharmacist reads a shelf: "four boxes, three strips and two loose",
// never "1,742 tablets".
function split(product, baseQty) {
  const total = Math.max(0, Math.floor(Number(baseQty) || 0));
  const perStrip = unitsPerStrip(product);
  const perBox = unitsPerBox(product);

  let rest = total;
  const boxes = perBox > perStrip ? Math.floor(rest / perBox) : 0;
  rest -= boxes * perBox;
  const strips = perStrip > 1 ? Math.floor(rest / perStrip) : 0;
  rest -= strips * perStrip;
  return { total, boxes, strips, units: rest };
}

// Short label for a quantity, e.g. "4 box + 3 strip + 2" or just "17".
// Zero components are dropped so the common cases stay terse.
function formatQty(product, baseQty, opts = {}) {
  const s = split(product, baseQty);
  const unitLabel = opts.unitLabel || product?.unit || 'unit';
  if (s.boxes === 0 && s.strips === 0) return `${s.total} ${unitLabel}`;
  const parts = [];
  if (s.boxes) parts.push(`${s.boxes} box`);
  if (s.strips) parts.push(`${s.strips} strip`);
  if (s.units) parts.push(`${s.units} ${unitLabel}`);
  return parts.join(' + ');
}

// How a sold line reads on the bill: what the customer asked for, with the
// base-unit count alongside so the quantity on the bill reconciles to stock.
//   ("2 strip (20 tab)")
function describeSale(product, qty, uom) {
  const n = Math.floor(Number(qty) || 0);
  const base = toBaseUnits(product, n, uom);
  if (uom === 'unit' || unitsIn(product, uom) === 1) return `${base} ${product?.unit || 'unit'}`;
  const label = uom === 'box' ? (n === 1 ? 'box' : 'boxes') : (n === 1 ? 'strip' : 'strips');
  return `${n} ${label} (${base} ${product?.unit || 'unit'})`;
}

// Price of one strip / one box, derived from the per-unit price. Prices are
// held per base unit so that loose sales, strip sales and box sales all come
// from one number and can never drift apart.
function priceFor(product, uom, perUnitPrice) {
  const unit = Number(perUnitPrice != null ? perUnitPrice : product?.sale_price) || 0;
  return round2(unit * unitsIn(product, uom));
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// The per-base-unit price implied by a price printed on a pack.
//
// Nobody knows the per-tablet price off the top of their head; they read the box.
// So the counter and the product form let you enter the price you can see, and the
// per-unit figure is derived here — the reverse of priceFor(). Full precision is
// kept deliberately: an Rs 155 strip of 14 is Rs 11.0714... per capsule, and
// rounding that to Rs 11.07 makes fourteen loose capsules cost Rs 154.98 instead
// of Rs 155. Round the LINE, never the stored price.
function perUnitFromPack(product, packPrice, uom) {
  const per = unitsIn(product, uom);
  const price = Number(packPrice) || 0;
  if (per <= 0) return 0;
  return price / per;
}

// What a whole box costs, for display beside the strip and unit rates.
function boxPrice(product, perUnitPrice) {
  return priceFor(product, 'box', perUnitPrice);
}

// Round a line total the way the counter does. Pakistani pharmacies do not hand
// back paisa: a loose sale is rounded to the rupee, sometimes to the nearest five.
// Applied to the line, so a whole strip still bills at exactly its printed price.
function roundLine(amount, mode = 'rupee') {
  const n = Number(amount) || 0;
  if (mode === 'five') return Math.round(n / 5) * 5;
  if (mode === 'rupee') return Math.round(n);
  return round2(n);
}

// All three rates a pharmacist might quote, from the one stored per-unit price.
// Returned together so the counter never has to do the arithmetic itself.
function rateCard(product, perUnitPrice) {
  const unit = Number(perUnitPrice != null ? perUnitPrice : product?.sale_price) || 0;
  const perStrip = unitsPerStrip(product);
  const perBox = unitsPerBox(product);
  return {
    unit: round2(unit),
    strip: perStrip > 1 ? round2(unit * perStrip) : null,
    box: perBox > perStrip ? round2(unit * perBox) : null,
    unit_name: product?.unit || 'unit',
  };
}

// Decorate a product row with everything the counter needs to show packaging.
function withPackaging(product, baseQty) {
  const perStrip = unitsPerStrip(product);
  const perBox = unitsPerBox(product);
  return {
    units_per_strip: perStrip,
    strips_per_box: stripsPerBox(product),
    units_per_box: perBox,
    allow_loose: canSellLoose(product) ? 1 : 0,
    strip_price: perStrip > 1 ? round2(product.sale_price * perStrip) : null,
    strip_mrp: perStrip > 1 && product.mrp > 0 ? round2(product.mrp * perStrip) : null,
    box_price: perBox > perStrip ? round2(product.sale_price * perBox) : null,
    box_mrp: perBox > perStrip && product.mrp > 0 ? round2(product.mrp * perBox) : null,
    rates: rateCard(product),
    ...(baseQty != null
      ? { stock_breakdown: split(product, baseQty), stock_label: formatQty(product, baseQty) }
      : {}),
  };
}

module.exports = {
  UOMS, unitsPerStrip, stripsPerBox, unitsPerBox, unitsIn, toBaseUnits,
  canSellLoose, split, formatQty, describeSale, priceFor, withPackaging, round2,
  perUnitFromPack, boxPrice, roundLine, rateCard,
};
