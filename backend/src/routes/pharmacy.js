const express = require('express');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { resolveEntitlement } = require('../billingRules');
const { clampStaffDiscount, staffAllowance } = require('../staffCap');
const H = require('../handovers');
const crypto = require('crypto');
const { postCashIfOpen, openSessionFor } = require('./cashflow');
const { getSettings } = require('../settings');
const { buildDashboard, buildDayClose } = require('../pharmacyDashboard');
const { assertDayOpen, dayCloseFor, httpError } = require('../guards');
const { tzModifier, businessDate } = require('../businessDay');
const { newBillNo, wrap, pad } = require('../utils');
const pk = require('../packaging');
const L = require('../ledger');

const router = express.Router();
router.use(authenticate);

// Medicine that may only be handed over against a prescription. Schedule G
// items are restricted to use under medical supervision; narcotics fall under
// the Control of Narcotic Substances Act 1997 and additionally require a
// register entry naming the prescriber and the person collecting.
const RX_SCHEDULES = ['Rx', 'G', 'Narcotic'];
const REGISTERED_SCHEDULES = ['G', 'Narcotic'];

// FEFO: consume up to `qty` from the earliest-expiring batches with stock.
// Returns { dispensed, batches } where `batches` records what each batch gave
// up — the caller needs it for MRP verification and the controlled register.
// With opts.allowPartial the caller tolerates a shortfall; otherwise a
// shortfall throws (all-or-nothing).
//
// opts.costCentre / opts.chargeClass are written onto every movement this call
// creates. They are stamped HERE, in the same INSERT, rather than patched by the
// caller afterwards: an UPDATE that runs after the fact can miss rows, and a
// movement with no cost centre is invisible to every report in Phase 06.
function consumeFEFO(productId, qty, movementType, reference, userId, opts = {}) {
  assertDayOpen();
  let remaining = qty;
  const batches = db
    .prepare(
      `SELECT * FROM stock_batches
       WHERE product_id = ? AND quantity > 0 AND quarantined = 0
       ORDER BY (expiry_date IS NULL), expiry_date ASC, id ASC`
    )
    .all(productId);

  // Expiry is a local-calendar boundary, so compare against the hospital's day
  // rather than the UTC one — otherwise for five hours each night a batch that
  // has expired locally still reads as dispensable.
  const now = businessDate();
  const taken = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    // Never dispense expired stock (Drugs Act 1976).
    if (batch.expiry_date && batch.expiry_date < now) continue;
    const take = Math.min(batch.quantity, remaining);
    db.prepare('UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?').run(take, batch.id);
    db.prepare(
      `INSERT INTO stock_movements
         (product_id, batch_id, type, quantity, reference, reason, user_id, cost_centre, charge_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      productId, batch.id, movementType, -take, reference, movementType, userId,
      opts.costCentre || 'COUNTER', opts.chargeClass || null
    );
    taken.push({
      batch_id: batch.id,
      batch_no: batch.batch_no,
      expiry_date: batch.expiry_date,
      mrp: batch.mrp,
      cost_price: batch.cost_price,
      quantity: take,
    });
    remaining -= take;
  }
  if (remaining > 0 && !opts.allowPartial) {
    // Say which medicine, how much can go, and where the rest is (QA3 M5).
    const p = db.prepare('SELECT name, unit FROM products WHERE id = ?').get(productId) || { name: `product ${productId}`, unit: 'unit' };
    const held = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN quarantined = 1 THEN quantity ELSE 0 END), 0) AS quarantined,
                COALESCE(SUM(CASE WHEN quarantined = 0 AND expiry_date IS NOT NULL AND expiry_date < ? THEN quantity ELSE 0 END), 0) AS expired
           FROM stock_batches WHERE product_id = ? AND quantity > 0`
      )
      .get(now, productId);
    const available = qty - remaining;
    const where = [held.quarantined > 0 ? `${held.quarantined} in quarantine` : null, held.expired > 0 ? `${held.expired} expired` : null].filter(Boolean);
    const err = new Error(
      `${p.name}: only ${available} ${p.unit || 'unit'}(s) can be dispensed, ${qty} asked for.` + (where.length ? ` Also on the shelf but not for sale: ${where.join(', ')}.` : '')
    );
    err.status = 400;
    err.code = 'INSUFFICIENT_STOCK';
    err.product = p.name;
    err.available = available;
    err.requested = qty;
    err.quarantined = held.quarantined;
    err.expired = held.expired;
    throw err;
  }
  return { dispensed: qty - remaining, batches: taken };
}

// ---------------------------------------------------------------------------
// Counter dashboard (pharmacist home screen)
// ---------------------------------------------------------------------------
router.get(
  '/dashboard',
  requirePermission(PERMISSIONS.PHARMACY_SELL, PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    res.json(buildDashboard(req.user));
  })
);

// ---------------------------------------------------------------------------
// Day-end close-out (Z-report). Defaults to today; any past date re-prints.
// ---------------------------------------------------------------------------
// A closed day answers with the SNAPSHOT filed at close (QA S1-04); a live or
// reopened day is built fresh and says so.
function closeSummary(dc) {
  if (!dc) return null;
  const name = (id) => (id ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(id)?.full_name : null);
  return {
    status: dc.status, closed_at: dc.closed_at, closed_by: name(dc.closed_by), hash: dc.content_hash,
    reopened_at: dc.reopened_at, reopened_by: name(dc.reopened_by), reopen_reason: dc.reopen_reason, reclosed_at: dc.reclosed_at,
  };
}
router.get(
  '/day-close',
  requirePermission(PERMISSIONS.PHARMACY_SELL, PERMISSIONS.CASH_MANAGE, PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const date = req.query.date;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const day = date || businessDate();
    const dc = dayCloseFor(day);
    if (dc && dc.status === 'closed') {
      const snap = JSON.parse(dc.snapshot);
      snap.closed = closeSummary(dc);
      snap.from_snapshot = true;
      return res.json(snap);
    }
    const fresh = buildDayClose(day);
    fresh.closed = closeSummary(dc);
    fresh.from_snapshot = false;
    res.json(fresh);
  })
);

// Close the day: every till of the day counted, the sheet snapshotted and
// hashed, the date locked. Reprints return the snapshot.
router.post(
  '/day-close/close',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const day = (req.body || {}).date || businessDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (day > businessDate()) return res.status(400).json({ error: 'A future day cannot be closed' });
    const existing = dayCloseFor(day);
    if (existing && existing.status === 'closed') throw httpError(409, 'DAY_CLOSED', `${day} is already closed.`);
    const openTills = db
      .prepare(`SELECT counter FROM cash_sessions WHERE status = 'open' AND date(opened_at, ?) <= ?`)
      .all(tzModifier(getSettings()), day);
    if (openTills.length) {
      throw httpError(409, 'TILL_OPEN', `Count and close ${openTills.map((t) => t.counter).join(', ')} before closing the day.`);
    }
    const snapshot = buildDayClose(day);
    const json = JSON.stringify(snapshot);
    const hash = crypto.createHash('sha256').update(json).digest('hex');
    if (existing) {
      db.prepare(`UPDATE day_closes SET status = 'closed', snapshot = ?, content_hash = ?, reclosed_at = datetime('now') WHERE id = ?`)
        .run(json, hash, existing.id);
    } else {
      db.prepare('INSERT INTO day_closes (business_date, snapshot, content_hash, closed_by) VALUES (?, ?, ?, ?)')
        .run(day, json, hash, req.user.id);
    }
    audit(req, 'day.close', 'day_close', day, { hash, bills: snapshot.footer.bills, net: snapshot.footer.net, reclosed: !!existing });
    res.status(201).json({ date: day, hash, closed: closeSummary(dayCloseFor(day)) });
  })
);

// Reopen a closed day. Administrator only, reason required, audited, and the
// sheet says REOPENED on every print from then on.
router.post(
  '/day-close/reopen',
  requirePermission(PERMISSIONS.DAY_REOPEN, PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const reason = String(b.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to reopen a closed day', code: 'REASON_REQUIRED' });
    const dc = dayCloseFor(b.date);
    if (!dc || dc.status !== 'closed') return res.status(404).json({ error: 'That day is not closed' });
    db.prepare(`UPDATE day_closes SET status = 'reopened', reopened_by = ?, reopened_at = datetime('now'), reopen_reason = ? WHERE id = ?`)
      .run(req.user.id, reason, dc.id);
    audit(req, 'day.reopen', 'day_close', dc.business_date, { reason, hash_at_close: dc.content_hash });
    res.json({ date: dc.business_date, closed: closeSummary(dayCloseFor(dc.business_date)) });
  })
);

// ---------------------------------------------------------------------------
// Fast counter lookup (FR-PHA-11) — price, MRP, live stock, batch and expiry
// for a medicine, by name, generic, SKU or scanned barcode.
// ---------------------------------------------------------------------------
router.get(
  '/lookup',
  requirePermission(PERMISSIONS.PHARMACY_SELL, PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const products = db
      .prepare(
        `SELECT * FROM products
         WHERE is_active = 1
           AND (name LIKE ? OR generic_name LIKE ? OR sku LIKE ? OR barcode = ? OR drap_reg_no LIKE ?)
         ORDER BY
           CASE WHEN barcode = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END,
           name
         LIMIT 15`
      )
      .all(like, like, like, q, like, q, `${q}%`);

    const batchStmt = db.prepare(
      `SELECT id, batch_no, expiry_date, quantity, cost_price, mrp, quarantined,
              CAST(julianday(expiry_date) - julianday(?) AS INTEGER) AS days_left
       FROM stock_batches
       WHERE product_id = ? AND quantity > 0
       ORDER BY (expiry_date IS NULL), expiry_date ASC`
    );

    const today = businessDate();
    for (const p of products) {
      const batches = batchStmt.all(today, p.id);
      // Sellable = not quarantined and not past its printed expiry date. This is
      // the number the counter quotes; the raw total would over-promise.
      p.batches = batches;
      p.on_hand = batches.reduce((s, b) => s + b.quantity, 0);
      p.sellable = batches
        .filter((b) => !b.quarantined && (!b.expiry_date || b.expiry_date >= today))
        .reduce((s, b) => s + b.quantity, 0);
      p.next_expiry = batches.find((b) => !b.quarantined && b.expiry_date)?.expiry_date || null;
      p.requires_prescription = RX_SCHEDULES.includes(p.drug_schedule);
      // Strip/box sizes, derived prices and the shelf reading of stock.
      Object.assign(p, pk.withPackaging(p, p.sellable));
    }
    res.json(products);
  })
);


// ---------------------------------------------------------------------------
// Quote — what this cart WILL cost, resolved by the same engine that will
// charge it. No stock moves, nothing is written.
//
// This exists so the counter never has to compute a discount itself. A price
// worked out in the browser and a price worked out on the server will diverge
// the first time one of them changes, and the customer is standing there
// looking at the wrong one.
// ---------------------------------------------------------------------------
router.post(
  '/quote',
  requirePermission(PERMISSIONS.PHARMACY_SELL),
  wrap((req, res) => {
    const b = req.body || {};
    const rows = Array.isArray(b.items) ? b.items : [];
    if (!rows.length) return res.json({ gross: 0, discount: 0, subsidy: 0, net: 0 });

    const customer = b.patient_id
      ? db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id)
      : null;

    const settings = getSettings();
    const lines = [];
    for (const i of rows) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(i.product_id);
      if (!product) continue;
      const uom = pk.UOMS.includes(i.uom) ? i.uom : 'unit';
      const qty = pk.toBaseUnits(product, i.quantity, uom);
      const unit = i.unit_price != null ? Number(i.unit_price) : product.sale_price;
      lines.push({
        amount: pk.roundLine(unit * qty, settings.loose_rounding),
        product_type_id: product.product_type_id,
        item_type: 'pharmacy',
      });
    }

    let calc = resolveEntitlement(customer, lines, {
      manualDiscount: b.manual_discount,
      forceCategory: customer ? undefined : (b.category || 'Paid'),
      ignoreCard: !!b.ignore_card,
    });

    // The sale route clamps a staff bill against the annual allowance, so the
    // quote has to as well. Without this the pane shows an employee "covered in
    // full" right up to the moment the sale charges them the excess — the same
    // quote-versus-charge divergence the quote endpoint exists to prevent.
    let allowance = null;
    if (calc.charge_class === 'STAFF' && b.patient_id) {
      calc = { ...calc, ...clampStaffDiscount(b.patient_id, calc) };
      const a = staffAllowance(b.patient_id);
      // What is left AFTER this basket, which is the figure the pharmacist needs
      // when the employee asks "how much have I got left".
      allowance = { ...a, left_after: pk.round2(Math.max(0, a.remaining - calc.discount)) };
    }
    res.json({ ...calc, staff_allowance: allowance });
  })
);

// ---------------------------------------------------------------------------
// Quarantine a batch — pull expired or damaged stock off the sellable shelf
// without deleting it, so it stays auditable until it is claimed or written off.
// ---------------------------------------------------------------------------
router.post(
  '/batches/:id/quarantine',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const on = req.body?.release ? 0 : 1;
    assertDayOpen();
    if (!on) {
      // Releasing quarantined stock for sale is a pharmacist's decision with a
      // reason on record (QA S1-05). Returned cold-chain medicine is never
      // released: its storage between sale and return cannot be verified.
      const reason = String(req.body?.reason || '').trim();
      if (!reason) throw httpError(400, 'REASON_REQUIRED', 'A reason is required to release quarantined stock for sale.');
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(batch.product_id);
      if (batch.origin === 'return' && product?.is_refrigerated) {
        throw httpError(400, 'COLD_CHAIN_NO_RELEASE', `${product.name} is a cold-chain item — returned units cannot go back on the shelf. Write them off.`);
      }
    }
    try {
      db.prepare('UPDATE stock_batches SET quarantined = ? WHERE id = ?').run(on, batch.id);
    } catch (e) {
      if (/EXPIRY_REQUIRED/.test(e.message)) throw httpError(400, 'EXPIRY_REQUIRED', 'This batch has no expiry date and cannot be released for sale. Write it off, or receive the stock properly with its batch and expiry.');
      throw e;
    }
    db.prepare(
      `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
       VALUES (?, ?, 'adjust', 0, ?, ?, ?)`
    ).run(
      batch.product_id,
      batch.id,
      batch.batch_no,
      on ? `Quarantined: ${req.body?.reason || 'expired / not fit for sale'}` : 'Released from quarantine',
      req.user.id
    );
    audit(req, on ? 'stock.quarantine' : 'stock.release', 'stock_batch', batch.id, { reason: req.body?.reason });
    res.json(db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batch.id));
  })
);

// Quarantine every batch that is already past its expiry date, in one action.
router.post(
  '/quarantine-expired',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const expired = db
      .prepare(
        `SELECT * FROM stock_batches
         WHERE quantity > 0 AND quarantined = 0
           AND expiry_date IS NOT NULL AND date(expiry_date) < date(?)`
      )
      .all(businessDate());
    const move = db.prepare(
      `INSERT INTO stock_movements (product_id, batch_id, type, quantity, reference, reason, user_id)
       VALUES (?, ?, 'adjust', 0, ?, 'Quarantined: expired stock', ?)`
    );
    db.transaction(() => {
      for (const b of expired) {
        db.prepare('UPDATE stock_batches SET quarantined = 1 WHERE id = ?').run(b.id);
        move.run(b.product_id, b.id, b.batch_no, req.user.id);
      }
    })();
    audit(req, 'stock.quarantine.expired', 'stock_batch', null, { batches: expired.length });
    res.json({ quarantined: expired.length, units: expired.reduce((s, b) => s + b.quantity, 0) });
  })
);

// ---------------------------------------------------------------------------
// Controlled-drug register (Schedule G / narcotics), newest first.
// Append-only: there is no edit or delete route by design.
// ---------------------------------------------------------------------------
router.get(
  '/controlled-register',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const settings = getSettings();
    const tz = tzModifier(settings);
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '2999-12-31';
    res.json(
      db
        .prepare(
          `SELECT * FROM controlled_register
           WHERE date(created_at, ?) BETWEEN ? AND ?
           ORDER BY id DESC LIMIT 500`
        )
        .all(tz, from, to)
    );
  })
);

// Prescriptions for a patient with current dispensed flag + live stock.
router.get(
  '/prescriptions/:patientId',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT pr.*, p.sale_price, p.mrp, p.drug_schedule, p.strength, p.form,
                (SELECT COALESCE(SUM(quantity),0) FROM stock_batches
                 WHERE product_id = pr.product_id AND quarantined = 0
                   AND (expiry_date IS NULL OR date(expiry_date) >= date(?))) AS on_hand
         FROM prescriptions pr LEFT JOIN products p ON p.id = pr.product_id
         WHERE pr.patient_id = ? ORDER BY pr.created_at DESC`
      )
      .all(businessDate(), req.params.patientId);
    res.json(rows);
  })
);

// Dispense / sell: unified line-item billing that deducts stock via FEFO.
// body: { patient_id?, visit_id?, customer_name?, category?,
//         items:[{product_id, quantity, uom?: 'unit'|'strip'|'box', unit_price?}],
//         manual_discount?, paid_amount?, prescription_ref?, prescriber_name?, prescriber_reg_no?,
//         buyer_name?, buyer_cnic?, buyer_contact? }
//
// `quantity` is expressed in `uom` — the counter sends what the customer asked
// for ("2 strips"). Everything below works in base units, so each line is
// converted once, here, and never again.
router.post(
  '/sale',
  requirePermission(PERMISSIONS.PHARMACY_SELL, PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const b = req.body || {};
    const settings = getSettings();
    const listed = Array.isArray(b.items) ? b.items.filter((i) => i.product_id) : [];
    const badQty = listed.find((i) => !(Number(i.quantity) > 0) || !Number.isFinite(Number(i.quantity)));
    if (badQty) {
      const p = db.prepare('SELECT name FROM products WHERE id = ?').get(badQty.product_id);
      return res.status(400).json({ error: `${p ? p.name : `Product ${badQty.product_id}`}: the quantity must be a whole number above zero (got ${badQty.quantity}).`, code: 'INVALID_QUANTITY', product: p ? p.name : null });
    }
    const raw = listed;
    if (!raw.length) return res.status(400).json({ error: 'At least one item required', code: 'NO_ITEMS' });
    // H1 (QA3): every sale carries an idempotency key, so no client — the POS,
    // a script, a retrying LAN — can make the same sale twice. The POS sends
    // one per basket; a bare API call has to as well.
    if (!b.idempotency_key || !String(b.idempotency_key).trim()) {
      return res.status(400).json({ error: 'Every sale needs an idempotency_key (one per basket) so a retry cannot duplicate it.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }

    // Resolve packaging up front: a line carries both what was asked for and
    // the base-unit quantity that stock will actually move by.
    const items = [];
    for (const i of raw) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(i.product_id);
      if (!product) return res.status(400).json({ error: `Product ${i.product_id} not found` });
      const uom = pk.UOMS.includes(i.uom) ? i.uom : 'unit';
      const asked = Math.floor(Number(i.quantity));
      const baseQty = pk.toBaseUnits(product, asked, uom);
      if (baseQty <= 0) return res.status(400).json({ error: `Invalid quantity for ${product.name}` });

      // Refuse to break a strip that this product is not sold loose from.
      if (uom === 'unit' && !pk.canSellLoose(product) && baseQty % pk.unitsPerStrip(product) !== 0) {
        return res.status(400).json({
          error: `${product.name} is not sold loose — supply it in full strips of ${pk.unitsPerStrip(product)}.`,
          code: 'LOOSE_SALE_NOT_ALLOWED',
          product: product.name,
          units_per_strip: pk.unitsPerStrip(product),
        });
      }
      items.push({ product, uom, asked, quantity: baseQty, unit_price: i.unit_price });
    }

    // Resolve patient category (walk-in customers default to Paid).
    let category = b.category || 'Paid';
    let patient = null;
    if (b.patient_id) {
      patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });
      category = patient.category;
    }

    const canOverride = req.user.permissions.includes(PERMISSIONS.BILLING_OVERRIDE);
    const canOverridePrice = req.user.permissions.includes(PERMISSIONS.PHARMACY_OVERRIDE_PRICE);

    // --- The price is the CATALOGUE's, not the browser's (QA S1-02, S3-22) ---
    // A client unit_price is a REQUEST. Below the catalogue price and inside
    // the counter-discount band it is ordinary rounding-down; anything else is
    // a price override that needs pharmacy.override_price and is audited with
    // the before and after. Above the DRAP MRP is refused for everyone while
    // enforce_mrp is on; zero or negative is refused outright — a free line
    // comes from the customer's entitlement, never from a typed price.
    const overrides = [];
    for (const i of items) {
      const product = i.product;
      const catalogue = Number(product.sale_price) || 0;
      if (i.unit_price == null || i.unit_price === '') { i.unit_price = catalogue; continue; }
      const asked = Number(i.unit_price);
      if (!Number.isFinite(asked) || asked <= 0) {
        return res.status(400).json({ error: `${product.name} cannot be sold at Rs ${i.unit_price}. A free or subsidised line comes from the customer's card or category, not from the price.`, code: 'INVALID_PRICE', product: product.name });
      }
      if (Number(settings.enforce_mrp) && product.mrp > 0 && asked > product.mrp + 1e-9) {
        return res.status(400).json({ error: `${product.name} cannot be sold above its maximum retail price of Rs ${product.mrp}.`, code: 'ABOVE_MRP', product: product.name, mrp: product.mrp });
      }
      if (Math.abs(asked - catalogue) > 1e-6) {
        const band = catalogue * Number(settings.counter_discount_pct || 0);
        const withinBand = asked < catalogue && catalogue - asked <= band + 1e-9;
        if (!withinBand && !canOverridePrice) {
          return res.status(403).json({
            error: `${product.name} is priced at Rs ${catalogue}. Charging Rs ${asked} needs the price-override permission.`,
            code: 'PRICE_OVERRIDE_REQUIRED', product: product.name, catalogue, asked,
          });
        }
        overrides.push({ product_id: product.id, product: product.name, catalogue, charged: asked, uom: i.uom, within_band: withinBand });
      }
      i.unit_price = asked;
    }

    // --- The drawer (QA S1-03) and the tender (QA S3-21) ---------------------
    const method = ['cash', 'card', 'online', 'credit'].includes(b.payment_method) ? b.payment_method : 'cash';
    let tillSession = null;
    let tendered = null;
    if (method === 'cash') {
      tillSession = openSessionFor(req.user.id);
      if (!tillSession) {
        return res.status(409).json({ error: 'No till is open for you. Cash is taken into an open till session — open one in Cash Flow before the first cash sale.', code: 'TILL_NOT_OPEN' });
      }
      if (b.tendered == null || b.tendered === '') {
        return res.status(400).json({ error: 'Enter the cash received before completing a cash sale.', code: 'TENDER_REQUIRED' });
      }
      tendered = Number(b.tendered);
      if (!Number.isFinite(tendered) || tendered < 0) return res.status(400).json({ error: 'Cash tendered must be a positive amount', code: 'TENDER_REQUIRED' });
    }

    // --- Idempotency (QA S3-15): a retried request returns the bill it made ---
    const idem = b.idempotency_key ? String(b.idempotency_key).slice(0, 80) : null;
    if (idem) {
      const dup = db.prepare('SELECT id FROM bills WHERE idempotency_key = ?').get(idem);
      if (dup) { const bill = fullBill(dup.id); bill.duplicate = true; return res.status(200).json(bill); }
    }

    // A counter discount up to the configured cap is part of normal retail
    // trade (rounding a bill down to the nearest note). Anything beyond the cap
    // still needs a billing override.
    const manualDiscount = Number(b.manual_discount || 0);
    if (manualDiscount > 0 && !canOverride) {
      const cartGross = items.reduce((sum, i) => {
        const unit = i.unit_price != null ? Number(i.unit_price) : i.product.sale_price;
        return sum + unit * i.quantity;
      }, 0);
      const cap = cartGross * Number(getSettings().counter_discount_pct || 0);
      if (manualDiscount > cap) {
        return res.status(403).json({
          error: `A discount above Rs ${Math.floor(cap)} on this bill needs an authorised override.`,
          code: 'DISCOUNT_ABOVE_CAP',
          cap: Math.floor(cap),
        });
      }
    }

    // --- Legal gates, checked before any stock moves -----------------------
    // A prescription reference is satisfied either by a registered patient with
    // a doctor's prescription on file, or by the paper prescription's serial
    // being keyed in for a walk-in buyer.
    const hasRx = !!b.prescription_ref || !!b.patient_id;
    for (const i of items) {
      const product = i.product;

      if (Number(settings.enforce_rx) && RX_SCHEDULES.includes(product.drug_schedule) && !hasRx) {
        return res.status(400).json({
          error: `${product.name} is prescription-only (Schedule ${product.drug_schedule}). Open the patient record or enter the prescription reference before dispensing.`,
          code: 'PRESCRIPTION_REQUIRED',
          product: product.name,
        });
      }

      // Anything that gets a register entry needs a prescriber and a
      // prescription on record — the guard has to cover the same schedules the
      // register is written for, or the sale succeeds and files a blank row.
      if (REGISTERED_SCHEDULES.includes(product.drug_schedule)) {
        if (!b.prescriber_name || !b.prescription_ref) {
          return res.status(400).json({
            error: `${product.name} is a ${product.drug_schedule === 'Narcotic' ? 'controlled drug' : 'Schedule G medicine'} — the prescriber's name and the prescription reference are required for the register.`,
            code: 'CONTROLLED_DETAILS_REQUIRED',
            product: product.name,
          });
        }
        // The CNIC of the collector is specific to narcotics.
        if (product.drug_schedule === 'Narcotic' && !b.buyer_cnic) {
          return res.status(400).json({
            error: `${product.name} is a controlled drug — record the CNIC of the person collecting it.`,
            code: 'CONTROLLED_CNIC_REQUIRED',
            product: product.name,
          });
        }
      }

      // Price ceiling: DRAP notifies a maximum retail price and selling above it
      // is an offence. The ceiling is inclusive of tax, which is why no GST is
      // added on top of a counter line.
      const unit = i.unit_price != null ? Number(i.unit_price) : product.sale_price;
      if (Number(settings.enforce_mrp) && product.mrp > 0 && unit > product.mrp) {
        return res.status(400).json({
          error: `${product.name} cannot be sold above its maximum retail price of Rs ${product.mrp}.`,
          code: 'ABOVE_MRP',
          product: product.name,
          mrp: product.mrp,
        });
      }
    }

    const allowPartial = !!b.allow_partial;

    // Rough total for the credit-limit check only. The bill is priced properly
    // after FEFO; this just answers "is this sale going to push them over".
    const estimatedNet = pk.round2(items.reduce((sum, i) => {
      const unit = i.unit_price != null ? Number(i.unit_price) : i.product.sale_price;
      return sum + unit * i.quantity;
    }, 0));

    // Who is paying, decided once for the whole sale. FEFO stamps this on every
    // movement it creates and it runs before any amount is known — but the
    // answer depends on the customer's card and category, not on the total, so
    // it can be resolved up front with a zero amount.
    const customer = b.patient_id
      ? db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id)
      : null;
    const payer = resolveEntitlement(customer, [{ amount: 0, item_type: 'pharmacy' }], {
      forceCategory: customer ? undefined : category,
      ignoreCard: !!b.ignore_card,
    });
    // A card that has lapsed does not silently fall back to full price: the
    // pharmacist has to be able to explain the amount to the person in front of
    // them, or they will override it.
    //
    // But it must not BLOCK the sale either — the customer still needs their
    // medicine. The counter re-sends with ignore_card once the pharmacist has
    // told them the card has expired, which is a decision made knowingly rather
    // than a discount that quietly disappeared.
    if (payer.card_refused) {
      return res.status(409).json({
        error: `Card ${payer.card_refused.card_no} expired on ${payer.card_refused.valid_till}. `
          + 'Complete the sale at full price, or renew the card first.',
        code: 'CARD_EXPIRED',
        card: payer.card_refused,
        // The counter offers this as "Continue at full price".
        retry_with: { ignore_card: true },
      });
    }

    // --- Credit ------------------------------------------------------------
    // A credit sale needs somewhere to post the debt. Resolved here, before any
    // stock moves, so a missing or over-limit account fails with nothing to undo.
    let creditAccount = null;
    if (b.payment_method === 'credit') {
      if (!customer && !b.ledger_account_id) {
        return res.status(400).json({
          error: 'Credit needs an account. Identify the customer, or open an account for them first.',
          code: 'CREDIT_ACCOUNT_REQUIRED',
        });
      }
      creditAccount = b.ledger_account_id
        ? db.prepare('SELECT * FROM ledger_accounts WHERE id = ?').get(b.ledger_account_id)
        : (() => {
          const party = L.partyFor({ customer });
          // An employee's credit is a payroll matter, not a shop account, so it
          // posts to their staff account — one ledger for a deduction to net
          // against. This is also where the Phase 03 annual-cap excess lands:
          // the clamp pushes the over-cap amount into `net`, and `net` is what
          // is debited below.
          // An opening limit only applies to an account being created here; it
          // must never quietly rewrite the limit on an account that already
          // exists, or the counter could raise someone's limit by typing a
          // number into a sale.
          return L.accountFor(
            party.id,
            party.party_type === 'staff' ? 'staff' : 'customer-credit',
            b.credit_limit != null && b.credit_limit !== ''
              ? { credit_limit: Number(b.credit_limit) }
              : {}
          );
        })();
      if (!creditAccount) return res.status(404).json({ error: 'Credit account not found' });

      // Over the limit WARNS rather than blocks (Q4): a pharmacist who knows the
      // customer should be able to proceed, but not without seeing the number.
      // `accept_over_limit` is the counter saying it did.
      if (creditAccount.credit_limit != null && !b.accept_over_limit) {
        const projected = L.round2(creditAccount.balance + estimatedNet);
        if (projected > creditAccount.credit_limit) {
          return res.status(409).json({
            error: `This would take the account to Rs ${projected}, over the Rs ${creditAccount.credit_limit} limit.`,
            code: 'OVER_CREDIT_LIMIT',
            balance: creditAccount.balance, limit: creditAccount.credit_limit, projected,
            retry_with: { accept_over_limit: true },
          });
        }
      }
    }

    let result;
    try {
      result = db.transaction(() => {
      const billNo = newBillNo();

      // Consume stock first (FEFO), then price by what was actually dispensed so
      // a partial dispense bills only the supplied quantity (FR-PHA-09).
      let gross = 0;
      const lines = [];
      const shortfalls = [];
      for (const i of items) {
        const product = i.product;
        const unit = i.unit_price != null ? Number(i.unit_price) : product.sale_price;
        const requested = i.quantity; // already in base units
        const { dispensed, batches } = consumeFEFO(
          product.id, requested, 'dispense', billNo, req.user.id,
          { allowPartial, costCentre: 'COUNTER', chargeClass: payer.charge_class }
        );

        // The MRP printed on the pack belongs to the batch and can differ from
        // the product default after a price notification. Verify against what
        // actually left the shelf; throwing here rolls the whole sale back.
        if (Number(settings.enforce_mrp)) {
          for (const t of batches) {
            if (t.mrp > 0 && unit > t.mrp) {
              const e = new Error(
                `${product.name} batch ${t.batch_no || t.batch_id} is printed at Rs ${t.mrp} — it cannot be sold at Rs ${unit}.`
              );
              e.status = 400;
              throw e;
            }
          }
        }

        const shortfall = requested - dispensed;
        if (shortfall > 0) {
          shortfalls.push({
            product: product.name,
            requested, dispensed, shortfall,
            // Report the shortage the way it was asked for, not in raw tablets.
            requested_label: pk.formatQty(product, requested),
            dispensed_label: pk.formatQty(product, dispensed),
            shortfall_label: pk.formatQty(product, shortfall),
          });
        }
        if (dispensed > 0) {
          // The per-unit price keeps full precision; only the LINE is rounded.
          // Rounding the stored price instead makes fourteen loose capsules from
          // an Rs 155 strip bill Rs 154.98. A whole strip or box still bills at
          // exactly its printed price, because the rounding lands on a total that
          // is already whole.
          const line = pk.roundLine(unit * dispensed, settings.loose_rounding);
          gross += line;
          lines.push({ product, dispensed, unit, line, batches, uom: i.uom, asked: i.asked });
        }
      }
      if (!lines.length) { const e = new Error('Nothing could be dispensed — no stock available'); e.status = 400; throw e; }

      // One entitlement decision for the whole cart, made in billingRules.js.
      // The LINES are passed, not just the total, because a card's tier covers
      // some product types and not others — a 100% card must not make a
      // cosmetic free.
      let calc = resolveEntitlement(
        customer,
        lines.map((l) => ({
          amount: l.line,
          product_type_id: l.product.product_type_id,
          item_type: 'pharmacy',
        })),
        {
          manualDiscount: b.manual_discount,
          forceCategory: customer ? undefined : category,
          ignoreCard: !!b.ignore_card,
        }
      );
      // The staff cap clamps AFTER the entitlement is known: it limits what the
      // trust gives, it does not change who the giver is.
      if (calc.charge_class === 'STAFF' && b.patient_id) {
        calc = { ...calc, ...clampStaffDiscount(b.patient_id, calc) };
      }
      // Credit means nothing has been paid yet. Defaulting paid_amount to the
      // net — as a cash sale does — would mark the bill settled and leave the
      // debt invisible.
      const paidAmt = method === 'credit'
        ? Number(b.paid_amount || 0)
        : (b.paid_amount != null ? Number(b.paid_amount) : calc.net);
      // The tender has to cover the bill; the slip prints what was entered.
      let changeGiven = null;
      if (method === 'cash') {
        if (tendered + 1e-9 < calc.net) {
          throw httpError(400, 'TENDER_SHORT', `Cash received (Rs ${tendered}) is less than the Rs ${calc.net} payable.`);
        }
        changeGiven = pk.round2(tendered - calc.net);
      }
      const billInfo = db
        .prepare(
          `INSERT INTO bills
             (bill_no, visit_id, patient_id, customer_name, category, bill_type,
              cost_centre, charge_class, welfare_card_id, subsidy_fund_id, ledger_account_id,
              gross_amount, discount, subsidy, net_amount, paid_amount, payment_method, status, created_by,
              idempotency_key, tendered, change_given, cash_session_id)
           VALUES (?, ?, ?, ?, ?, 'pharmacy-sale', 'COUNTER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          billNo, b.visit_id || null, b.patient_id || null, b.customer_name || null, category,
          calc.charge_class || 'PAID',
          calc.card_id || null,
          calc.fund_id || null,
          creditAccount ? creditAccount.id : null,
          calc.gross, calc.discount, calc.subsidy, calc.net, paidAmt, method,
          paidStatus(calc.net, paidAmt), req.user.id,
          idem, tendered, changeGiven, method === 'cash' && paidAmt > 0 ? tillSession.id : null
        );
      const billId = billInfo.lastInsertRowid;

      const itemStmt = db.prepare(
        `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
         VALUES (?, 'pharmacy', ?, ?, ?, ?, ?)`
      );
      const registerStmt = db.prepare(
        `INSERT INTO controlled_register
           (entry_no, bill_id, bill_no, product_id, product_name, drug_schedule, batch_no, expiry_date,
            quantity, patient_id, patient_name, buyer_name, buyer_cnic, buyer_contact,
            prescriber_name, prescriber_reg_no, prescription_ref, pharmacist_id, pharmacist_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const registered = [];

      for (const p of lines) {
        // Quantity is stored in base units so it reconciles with stock; the
        // description carries how it was actually sold.
        // The line carries HOW it was sold (per tablet, per strip, per box),
        // never the quantity — that is the quantity column's job, and a
        // "Disprin — 1 tablet | QTY 1" slip reads twice (UI-10).
        const soldBy = p.uom === 'unit' || pk.unitsIn(p.product, p.uom) === 1
          ? (p.product.unit || 'unit')
          : p.uom;
        const desc = pk.unitsPerBox(p.product) > 1
          ? `${p.product.name} · per ${soldBy}`
          : p.product.name;
        itemStmt.run(billId, p.product.id, desc, p.dispensed, p.unit, p.line);

        // Controlled drugs get one register row per batch handed over, because
        // the register has to trace an individual pack back to its batch.
        if (REGISTERED_SCHEDULES.includes(p.product.drug_schedule)) {
          for (const t of p.batches) {
            const entryNo = `CDR-${pad(nextSeq('controlled'), 5)}`;
            registerStmt.run(
              entryNo, billId, billNo, p.product.id, p.product.name, p.product.drug_schedule,
              t.batch_no || null, t.expiry_date || null, t.quantity,
              b.patient_id || null, patient?.full_name || null,
              b.buyer_name || patient?.full_name || b.customer_name || null,
              b.buyer_cnic || patient?.cnic || null,
              b.buyer_contact || patient?.contact || null,
              b.prescriber_name || null, b.prescriber_reg_no || null, b.prescription_ref || null,
              req.user.id, req.user.full_name
            );
            registered.push(entryNo);
          }
        }

        // Fully-supplied prescription lines are marked dispensed; short lines stay pending.
        const short = shortfalls.find((s) => s.product === p.product.name);
        if (b.patient_id && !short) {
          db.prepare(
            `UPDATE prescriptions SET dispensed = 1
             WHERE patient_id = ? AND product_id = ? AND dispensed = 0`
          ).run(b.patient_id, p.product.id);
        }
      }
      // The narcotic register has always captured the collector. Mirror it into
      // the shared `handovers` record so "who took it" is one question against
      // one table, whether it was a controlled drug, a department runner or a
      // relative collecting a dialysis patient's medicine.
      if (registered.length && (b.buyer_name || b.customer_name)) {
        H.record({
          context: 'sale',
          ref_id: billId,
          customer_id: b.patient_id || null,
          taken_by: b.buyer_name || b.customer_name,
          relation: b.buyer_relation || (b.patient_id ? null : 'Self'),
          cnic: b.buyer_cnic || null,
          contact: b.buyer_contact || null,
          user_id: req.user.id,
        });
      }

      // THE RULE: a credit sale does not post cash. Revenue is recognised here;
      // cash is recognised at settlement. postCashIfOpen already ignores any
      // method other than 'cash', so 'credit' never reaches the drawer — but the
      // debit below is what makes the money recoverable rather than simply lost.
      postCashIfOpen(req.user.id, paidAmt, 'sale', billNo, method);

      if (creditAccount && calc.net > 0) {
        const n = `${lines.length} item${lines.length === 1 ? '' : 's'}`;
        L.post(creditAccount.id, {
          debit: calc.net,
          bill_id: billId,
          reference: billNo,
          narration: creditAccount.ledger_kind === 'staff'
            ? `Staff purchase — ${n}${calc.cap_excess > 0 ? ` (Rs ${calc.cap_excess} over the annual allowance)` : ''}`
            : `Credit — ${n}`,
          user_id: req.user.id,
        });
      }
      return { billId, billNo, shortfalls, registered };
      })();
    } catch (e) {
      // Two identical requests racing on one idempotency key: the second hits
      // the unique index; answer with the bill the first one made.
      if (idem && /idx_bills_idempotency|UNIQUE constraint failed: bills.idempotency_key/.test(e.message)) {
        const dup = db.prepare('SELECT id FROM bills WHERE idempotency_key = ?').get(idem);
        if (dup) { const bill = fullBill(dup.id); bill.duplicate = true; return res.status(200).json(bill); }
      }
      throw e;
    }

    audit(req, 'pharmacy.sale', 'bill', result.billId, {
      billNo: result.billNo,
      shortfalls: result.shortfalls,
      controlled: result.registered,
      till: tillSession ? tillSession.id : null,
    });
    if (overrides.length) {
      audit(req, 'pharmacy.price_override', 'bill', result.billId, { billNo: result.billNo, by: req.user.username, lines: overrides });
    }
    const bill = fullBill(result.billId);
    bill.shortfalls = result.shortfalls;
    bill.controlled_entries = result.registered;
    res.status(201).json(bill);
  })
);

function paidStatus(net, paid) {
  if (paid >= net) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function fullBill(id) {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
  bill.items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(id);
  return bill;
}

// ---------------------------------------------------------------------------
// Parked sales — four or five customers at the counter at once
//
// Held on the SERVER, not in React state. A shift lasts eight hours, and on a
// load-shedding site a browser reload is not hypothetical: it is what happens
// when the lights go out. Four customers' baskets must not go with them.
//
// A parked cart holds NO STOCK. Reserving it would strand inventory every time
// a customer changes their mind and walks off, and a pharmacy this size cannot
// carry phantom shortages. Availability is checked once, at completion, exactly
// as it is for an unparked sale.
// ---------------------------------------------------------------------------

router.get(
  '/held',
  requirePermission(PERMISSIONS.PHARMACY_SELL),
  wrap((req, res) => {
    const rows = db
      .prepare('SELECT * FROM held_sales WHERE user_id = ? ORDER BY created_at')
      .all(req.user.id);
    res.json(
      rows.map((r) => ({ ...r, cart: safeParse(r.cart), stale: r.hold_date !== businessDate() }))
    );
  })
);

router.post(
  '/held',
  requirePermission(PERMISSIONS.PHARMACY_SELL),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.cart) return res.status(400).json({ error: 'Nothing to park' });
    const max = Number(getSettings().max_parked_sales || 5);

    const row = db.transaction(() => {
      // Resuming a parked customer parks the one at the counter in the same
      // breath. Doing it as two calls would trip the cap on the way through
      // (five held + the one being parked = six) and could leave a cart in
      // neither place if the second call failed. One transaction, one slot.
      if (b.replace_id) {
        const target = db.prepare('SELECT * FROM held_sales WHERE id = ? AND user_id = ?')
          .get(b.replace_id, req.user.id);
        if (!target) {
          const e = new Error('That parked sale is no longer there — it may have been completed elsewhere.');
          e.status = 404;
          throw e;
        }
        db.prepare('DELETE FROM held_sales WHERE id = ?').run(target.id);
      }

      const open = db.prepare('SELECT COUNT(*) c FROM held_sales WHERE user_id = ?').get(req.user.id).c;
      if (open >= max) {
        const e = new Error(
          `You already have ${open} customers on hold. Finish or discard one before parking another.`
        );
        e.status = 409;
        throw e;
      }
      const info = db
        .prepare(
          `INSERT INTO held_sales (label, counter, user_id, cart, hold_date)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(b.label || null, b.counter || null, req.user.id, JSON.stringify(b.cart), businessDate());
      return db.prepare('SELECT * FROM held_sales WHERE id = ?').get(info.lastInsertRowid);
    })();

    res.status(201).json({ ...row, cart: safeParse(row.cart) });
  })
);

router.put(
  '/held/:id',
  requirePermission(PERMISSIONS.PHARMACY_SELL),
  wrap((req, res) => {
    const held = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
    if (!held) return res.status(404).json({ error: 'Held sale not found' });
    if (held.user_id !== req.user.id) return res.status(403).json({ error: 'Not your held sale' });
    const b = req.body || {};
    db.prepare(
      "UPDATE held_sales SET label = ?, cart = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(b.label !== undefined ? b.label : held.label, JSON.stringify(b.cart ?? safeParse(held.cart)), held.id);
    const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(held.id);
    res.json({ ...row, cart: safeParse(row.cart) });
  })
);

router.delete(
  '/held/:id',
  requirePermission(PERMISSIONS.PHARMACY_SELL),
  wrap((req, res) => {
    const held = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
    if (!held) return res.status(404).json({ error: 'Held sale not found' });
    if (held.user_id !== req.user.id && !req.user.permissions.includes(PERMISSIONS.USER_MANAGE)) {
      return res.status(403).json({ error: 'Not your held sale' });
    }
    db.prepare('DELETE FROM held_sales WHERE id = ?').run(held.id);
    audit(req, 'pharmacy.held.discard', 'held_sale', held.id, { label: held.label });
    res.json({ ok: true });
  })
);

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

module.exports = { router, consumeFEFO, paidStatus, fullBill, RX_SCHEDULES };
