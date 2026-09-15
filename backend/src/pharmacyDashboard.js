// Pharmacy counter dashboard — the single aggregate the pharmacist's home
// screen reads. Everything here is scoped to what a pharmacy in Pakistan has to
// watch during a shift: the day's till, the dispensing queue, expiry exposure
// (both the legal ban on selling expired stock and the distributor claim
// window), controlled-drug movement, and the DRAP data the product master must
// carry to survive an inspection.
const { db } = require('./db');
const { getSettings } = require('./settings');
const { tzModifier, businessDate } = require('./businessDay');

const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const num = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const rs = (n) => num(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// --- Sales / till -----------------------------------------------------------
// Counter takings for the day, split the way a pharmacy reconciles at closing:
// cash in the drawer versus card/online, plus the subsidy the trust absorbed.
function salesToday(tz, today) {
  const s = one(
    `SELECT COUNT(*) AS bills,
            COALESCE(SUM(gross_amount),0) AS gross,
            COALESCE(SUM(discount),0)     AS discount,
            COALESCE(SUM(subsidy),0)      AS subsidy,
            COALESCE(SUM(net_amount),0)   AS net,
            COALESCE(SUM(paid_amount),0)  AS paid,
            COALESCE(SUM(CASE WHEN payment_method='cash'   THEN paid_amount ELSE 0 END),0) AS cash,
            COALESCE(SUM(CASE WHEN payment_method='card'   THEN paid_amount ELSE 0 END),0) AS card,
            COALESCE(SUM(CASE WHEN payment_method='online' THEN paid_amount ELSE 0 END),0) AS online,
            COALESCE(SUM(CASE WHEN status!='paid' THEN net_amount - paid_amount ELSE 0 END),0) AS outstanding
     FROM bills
     WHERE bill_type = 'pharmacy-sale' AND date(created_at, ?) = ?`,
    tz, today
  );

  // Counter units only. Department invoices write bill_items with the same
  // item_type = 'pharmacy', so without the cost-centre filter a lab slip for 200
  // gauze would report as 200 units sold over the counter — the same mistake in
  // a new place as the COGS join this phase replaced.
  const items = one(
    `SELECT COALESCE(SUM(bi.quantity),0) AS units, COUNT(DISTINCT bi.ref_id) AS distinct_items
     FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
     WHERE bi.item_type = 'pharmacy' AND b.cost_centre = 'COUNTER'
       AND date(b.created_at, ?) = ?`,
    tz, today
  );

  // Cost of goods actually dispensed OVER THE COUNTER today, taken from the
  // batch each unit left. Movements are signed (negative out), hence the minus.
  //
  // Keyed on cost_centre, not on a join back to the bill type. Dialysis
  // consumables and department slips are deducted through the same 'dispense'
  // movement type, and every extra stream added to this system used to need
  // another clause in this join — which is how a day's dialysis cost once landed
  // in the counter's margin and reported it as a loss. The movement now says
  // where it went, so the question is answered directly.
  const cogs = one(
    `SELECT COALESCE(-SUM(m.quantity * COALESCE(sb.cost_price, 0)), 0) AS cogs
     FROM stock_movements m
     LEFT JOIN stock_batches sb ON sb.id = m.batch_id
     WHERE m.type = 'dispense' AND m.quantity < 0
       AND m.cost_centre = 'COUNTER'
       AND date(m.created_at, ?) = ?`,
    tz, today
  ).cogs;

  const refunds = one(
    `SELECT COUNT(*) AS count, COALESCE(SUM(refund_amount),0) AS amount
     FROM returns WHERE date(created_at, ?) = ?`,
    tz, today
  );

  return {
    bills: s.bills,
    gross: num(s.gross),
    discount: num(s.discount),
    subsidy: num(s.subsidy),
    net: num(s.net),
    paid: num(s.paid),
    outstanding: num(s.outstanding),
    cash: num(s.cash),
    card: num(s.card),
    online: num(s.online),
    units: items.units,
    distinct_items: items.distinct_items,
    cogs: num(cogs),
    // Margin is measured against what was actually billed, so category
    // discounts and the free-patient subsidy correctly reduce it.
    margin: num(s.net - cogs),
    margin_pct: s.net > 0 ? num(((s.net - cogs) / s.net) * 100) : 0,
    refunds: refunds.count,
    refund_amount: num(refunds.amount),
  };
}

// --- Dispensing work-list ---------------------------------------------------
// Patients the doctor has prescribed for but who have not collected yet. This
// is the pharmacist's queue — FR-PHA-01 without typing a Patient ID first.
function pendingPrescriptions(today, limit = 12) {
  return all(
    `SELECT p.id            AS patient_id,
            p.patient_code,
            p.full_name,
            p.category,
            p.contact,
            COUNT(pr.id)    AS pending_lines,
            MAX(pr.created_at) AS prescribed_at,
            SUM(CASE WHEN pr.product_id IS NULL THEN 1 ELSE 0 END) AS unlinked_lines,
            SUM(CASE WHEN pr.product_id IS NOT NULL AND COALESCE((
                  SELECT SUM(sb.quantity) FROM stock_batches sb
                  WHERE sb.product_id = pr.product_id AND sb.quarantined = 0
                    AND (sb.expiry_date IS NULL OR date(sb.expiry_date) >= date(?))
                ), 0) <= 0 THEN 1 ELSE 0 END) AS out_of_stock_lines
     FROM prescriptions pr
     JOIN patients p ON p.id = pr.patient_id
     WHERE pr.dispensed = 0
     GROUP BY p.id
     ORDER BY prescribed_at DESC
     LIMIT ?`,
    today, limit
  );
}

// Today's pharmacy tokens, so walk-ups routed by reception are visible too.
function pharmacyQueue(today) {
  return all(
    `SELECT t.id, t.token_number, t.status, t.visit_id,
            p.id AS patient_id, p.patient_code, p.full_name, p.category
     FROM tokens t JOIN patients p ON p.id = t.patient_id
     WHERE t.department = 'Pharmacy' AND t.token_date = ?
       AND t.status IN ('waiting','serving')
     ORDER BY t.token_number ASC`,
    today
  );
}

// --- Stock position ---------------------------------------------------------
function stockPosition() {
  const totals = one(
    `SELECT COUNT(*) AS skus,
            COALESCE(SUM(CASE WHEN on_hand <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
            COALESCE(SUM(CASE WHEN on_hand > 0 AND on_hand <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock
     FROM (
       SELECT p.id, p.reorder_level,
              COALESCE((SELECT SUM(sb.quantity) FROM stock_batches sb
                        WHERE sb.product_id = p.id AND sb.quarantined = 0), 0) AS on_hand
       FROM products p WHERE p.is_active = 1
     )`
  );

  // Valuation at cost (what the shelf is worth on the books) and at retail
  // (what it should ring up as) — both wanted at every stock-take.
  const value = one(
    `SELECT COALESCE(SUM(sb.quantity * sb.cost_price), 0) AS at_cost,
            COALESCE(SUM(sb.quantity * p.sale_price), 0)  AS at_retail
     FROM stock_batches sb JOIN products p ON p.id = sb.product_id
     WHERE sb.quantity > 0 AND sb.quarantined = 0 AND p.is_active = 1`
  );

  const quarantined = one(
    `SELECT COUNT(*) AS batches,
            COALESCE(SUM(sb.quantity), 0) AS units,
            COALESCE(SUM(sb.quantity * sb.cost_price), 0) AS value
     FROM stock_batches sb WHERE sb.quarantined = 1 AND sb.quantity > 0`
  );

  return {
    skus: totals.skus,
    out_of_stock: totals.out_of_stock,
    low_stock: totals.low_stock,
    value_at_cost: num(value.at_cost),
    value_at_retail: num(value.at_retail),
    quarantined_batches: quarantined.batches,
    quarantined_units: quarantined.units,
    quarantined_value: num(quarantined.value),
  };
}

// Reorder work-list, worst first, with the 30-day dispensing rate alongside so
// the buyer sizes the order from real movement instead of guessing.
function reorderList(tz, limit = 10) {
  return all(
    `SELECT p.id, p.name, p.strength, p.unit, p.reorder_level, p.pack_size,
            p.units_per_strip, p.strips_per_box,
            COALESCE((SELECT SUM(sb.quantity) FROM stock_batches sb
                      WHERE sb.product_id = p.id AND sb.quarantined = 0), 0) AS on_hand,
            COALESCE((SELECT -SUM(m.quantity) FROM stock_movements m
                      WHERE m.product_id = p.id AND m.quantity < 0
                        AND m.type IN ('dispense','sale')
                        AND date(m.created_at, ?) >= date('now', ?, '-30 day')), 0) AS used_30d
     FROM products p
     WHERE p.is_active = 1
     GROUP BY p.id
     HAVING on_hand <= p.reorder_level
     ORDER BY (on_hand * 1.0) / (CASE WHEN p.reorder_level > 0 THEN p.reorder_level ELSE 1 END) ASC,
              used_30d DESC
     LIMIT ?`,
    tz, tz, limit
  );
}

// --- Expiry exposure --------------------------------------------------------
// Three windows matter, and they are not the same thing:
//   expired      — illegal to sell (Drugs Act 1976); must come off the shelf
//   near expiry  — move it first (FEFO) or discount it
//   claim window — distributors accept expiry returns only some months ahead of
//                  the printed date, so stock past that cut-off can no longer be
//                  claimed and turns into a straight write-off
function expiryExposure(settings, today) {
  const near = Number(settings.near_expiry_days || 90);
  const claim = Number(settings.expiry_claim_days || 180);

  const bucket = (where, ...args) =>
    one(
      `SELECT COUNT(*) AS batches, COALESCE(SUM(sb.quantity),0) AS units,
              COALESCE(SUM(sb.quantity * sb.cost_price),0) AS value
       FROM stock_batches sb JOIN products p ON p.id = sb.product_id
       WHERE sb.quantity > 0 AND sb.expiry_date IS NOT NULL AND ${where}`,
      ...args
    );

  // The first three buckets describe what is still on the sellable shelf, so
  // they exclude quarantined stock — otherwise pulling a batch would never
  // clear the alert that told you to pull it, and the counter would be told to
  // "sell first" stock that dispensing refuses to touch.
  const shelf = 'sb.quarantined = 0 AND';
  const expired = bucket(`${shelf} date(sb.expiry_date) < date(?)`, today);
  const within30 = bucket(
    `${shelf} date(sb.expiry_date) >= date(?) AND date(sb.expiry_date) <= date(?, '+30 day')`,
    today, today
  );
  const withinNear = bucket(
    `${shelf} date(sb.expiry_date) >= date(?) AND date(sb.expiry_date) <= date(?, ?)`,
    today, today, `+${near} day`
  );
  // Claimable is deliberately not shelf-scoped: stock pulled into quarantine is
  // exactly what gets returned to the distributor. What disqualifies a batch is
  // having already been claimed, or having passed the date the distributor will
  // still accept it.
  const claimable = bucket(
    `date(sb.expiry_date) >= date(?) AND date(sb.expiry_date) <= date(?, ?) AND sb.claim_status = 'none'`,
    today, today, `+${claim} day`
  );

  // The batch-level list the pharmacist actually acts on: pull, discount, claim.
  // Quarantined batches stay in this list (flagged) so they remain visible.
  const batches = all(
    `SELECT sb.id, sb.batch_no, sb.expiry_date, sb.quantity, sb.cost_price,
            sb.quarantined, sb.claim_status, sb.vendor_id,
            p.id AS product_id, p.name, p.strength, p.drug_schedule,
            v.name AS vendor_name,
            CAST(julianday(sb.expiry_date) - julianday(?) AS INTEGER) AS days_left
     FROM stock_batches sb
     JOIN products p ON p.id = sb.product_id
     LEFT JOIN vendors v ON v.id = sb.vendor_id
     WHERE sb.quantity > 0 AND sb.expiry_date IS NOT NULL
       AND date(sb.expiry_date) <= date(?, ?)
     ORDER BY sb.expiry_date ASC
     LIMIT 25`,
    today, today, `+${near} day`
  );

  return {
    near_expiry_days: near,
    claim_window_days: claim,
    expired: { ...expired, value: num(expired.value) },
    within_30: { ...within30, value: num(within30.value) },
    near: { ...withinNear, value: num(withinNear.value) },
    claimable: { ...claimable, value: num(claimable.value) },
    batches,
  };
}

// --- Controlled drugs -------------------------------------------------------
// Schedule G and narcotic items must be reconcilable against the register at
// any time, so the counter sees today's entries and what is on the shelf.
function controlledDrugs(tz, today) {
  const entries = one(
    `SELECT COUNT(*) AS entries, COALESCE(SUM(quantity),0) AS units
     FROM controlled_register WHERE date(created_at, ?) = ?`,
    tz, today
  );
  // Count only products that actually have stock on the shelf. A plain
  // COUNT(DISTINCT p.id) over the LEFT JOIN counts every classified product
  // whether or not a batch matched, which reads as "2 items · 0 units held".
  const held = one(
    `SELECT COUNT(DISTINCT CASE WHEN sb.id IS NOT NULL THEN p.id END) AS skus,
            COALESCE(SUM(sb.quantity),0) AS units
     FROM products p LEFT JOIN stock_batches sb
       ON sb.product_id = p.id AND sb.quantity > 0 AND sb.quarantined = 0
     WHERE p.is_active = 1 AND p.drug_schedule IN ('G','Narcotic')`
  );
  const recent = all(
    `SELECT entry_no, product_name, drug_schedule, quantity, patient_name,
            buyer_name, buyer_cnic, prescriber_name, bill_no, created_at
     FROM controlled_register ORDER BY id DESC LIMIT 8`
  );
  return {
    today_entries: entries.entries,
    today_units: entries.units,
    skus: held.skus,
    units: held.units,
    recent,
  };
}

// --- Compliance gaps --------------------------------------------------------
// A DRAP inspection checks exactly these: is every medicine on the shelf a
// registered product, does every batch carry a batch number and expiry, and is
// the shelf price at or under the notified maximum retail price.
function complianceGaps() {
  const missingDrap = one(
    `SELECT COUNT(*) c FROM products
     WHERE is_active = 1 AND drug_schedule != 'OTC'
       AND (drap_reg_no IS NULL OR trim(drap_reg_no) = '')`
  ).c;
  // Only medicine is counted here. Goods receipt deliberately lets general-sale
  // sundries (bandages and the like) in without a batch or expiry, so counting
  // them would raise a gap the pharmacist has no way to close.
  //
  // This predicate MUST stay identical to the one the receive route enforces, or
  // the panel reports gaps that cannot be closed. It used to be a hand-copied
  // string comparison in both places; both now read product_types.is_medicine.
  const missingBatchInfo = one(
    `SELECT COUNT(*) c FROM stock_batches sb JOIN products p ON p.id = sb.product_id
     WHERE sb.quantity > 0
       AND (p.product_type_id IS NULL
            OR EXISTS (SELECT 1 FROM product_types pt
                        WHERE pt.id = p.product_type_id AND pt.is_medicine = 1))
       AND (sb.batch_no IS NULL OR trim(sb.batch_no) = '' OR sb.expiry_date IS NULL)`
  ).c;
  const missingMrp = one(
    "SELECT COUNT(*) c FROM products WHERE is_active = 1 AND (mrp IS NULL OR mrp <= 0)"
  ).c;
  const aboveMrp = one(
    `SELECT COUNT(*) c FROM products
     WHERE is_active = 1 AND mrp IS NOT NULL AND mrp > 0 AND sale_price > mrp`
  ).c;
  const coldChain = one(
    'SELECT COUNT(*) c FROM products WHERE is_active = 1 AND is_refrigerated = 1'
  ).c;
  return {
    missing_drap_reg: missingDrap,
    missing_batch_info: missingBatchInfo,
    missing_mrp: missingMrp,
    priced_above_mrp: aboveMrp,
    cold_chain_items: coldChain,
    total: missingDrap + missingBatchInfo + missingMrp + aboveMrp,
  };
}

// --- Movement / activity ----------------------------------------------------
function topSellers(tz, today, limit = 8) {
  return all(
    `SELECT bi.ref_id AS product_id, bi.description,
            SUM(bi.quantity) AS units, SUM(bi.line_total) AS revenue
     FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
     WHERE bi.item_type = 'pharmacy' AND date(b.created_at, ?) = ?
     GROUP BY bi.ref_id, bi.description
     ORDER BY units DESC LIMIT ?`,
    tz, today, limit
  );
}

// Today's bills, newest first (QA S2-08): the panel is titled "today's
// register", so it is scoped to the business day and ordered by the time it
// shows, not by id.
function recentSales(tz, today, limit = 8) {
  return all(
    `SELECT b.id, b.bill_no, b.category, b.net_amount, b.paid_amount, b.status,
            b.payment_method, b.created_at,
            COALESCE(p.full_name, b.customer_name, 'Walk-in customer') AS buyer,
            p.patient_code,
            (SELECT COUNT(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS lines
     FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
     WHERE b.bill_type = 'pharmacy-sale' AND date(b.created_at, ?) = ?
     ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
    tz, today, limit
  );
}

// --- Sanity assertions (QA S2-09, S1-03, S2-07, S1-05) ------------------------
// States that should not coexist, surfaced on the dashboard and at the top of
// the day-end sheet instead of sitting quietly in two different panels.
function sanityAlerts(tz, day, sales) {
  const alerts = [];
  const outside = one(
    `SELECT COUNT(*) n, COALESCE(SUM(paid_amount),0) amount FROM bills b
      WHERE b.bill_type = 'pharmacy-sale' AND b.payment_method = 'cash' AND b.paid_amount > 0
        AND b.status != 'amended' AND date(b.created_at, ?) = ?
        AND NOT EXISTS (SELECT 1 FROM cash_transactions ct WHERE ct.reference = b.bill_no AND ct.category = 'sale')`,
    tz, day
  );
  if (outside.n > 0) {
    alerts.push({ code: 'SALES_OUTSIDE_TILL', severity: 'danger',
      title: `${outside.n} cash bill${outside.n === 1 ? '' : 's'} totalling Rs ${rs(outside.amount)} ${outside.n === 1 ? 'was' : 'were'} taken with no till session open`,
      detail: 'That cash is in no drawer ledger and cannot be reconciled. Cash sales now refuse to complete without an open till.',
      amount: num(outside.amount), count: outside.n });
  }
  if (sales && sales.cogs > 0 && (sales.margin_pct > 60 || sales.margin_pct < 0)) {
    alerts.push({ code: 'MARGIN_OUT_OF_BAND', severity: 'warning',
      title: `Gross margin today is ${sales.margin_pct}% — outside the 0–60% band a pharmacy trades in`,
      detail: 'A line priced far from its cost, or a cost of zero on a batch, usually explains it. Check the day\'s bills and the batches they drew from.' });
  }
  const med = all(
    `SELECT net_amount FROM bills WHERE bill_type = 'pharmacy-sale' AND status != 'amended'
       AND date(created_at, ?) < ? AND date(created_at, ?) >= date(?, '-30 days') ORDER BY net_amount`,
    tz, day, tz, day
  ).map((r) => Number(r.net_amount));
  if (med.length >= 10) {
    const median = med[Math.floor(med.length / 2)];
    if (median > 0) {
      const big = all(
        `SELECT bill_no, net_amount FROM bills WHERE bill_type = 'pharmacy-sale' AND status != 'amended'
           AND date(created_at, ?) = ? AND net_amount > ? ORDER BY net_amount DESC LIMIT 5`,
        tz, day, median * 5
      );
      if (big.length) {
        alerts.push({ code: 'BILL_OUTLIER', severity: 'warning',
          title: `${big.length} bill${big.length === 1 ? '' : 's'} today ${big.length === 1 ? 'is' : 'are'} more than five times the trailing median of Rs ${rs(median)}`,
          detail: big.map((x) => `${x.bill_no} Rs ${rs(x.net_amount)}`).join(' · ') });
      }
    }
  }
  const spread = all(
    `SELECT p.name, MIN(bi.unit_price) mn, MAX(bi.unit_price) mx
       FROM bill_items bi JOIN bills b ON b.id = bi.bill_id JOIN products p ON p.id = bi.ref_id
      WHERE bi.item_type = 'pharmacy' AND b.status != 'amended' AND date(b.created_at, ?) = ?
      GROUP BY bi.ref_id HAVING mx > mn * 1.2 AND mn > 0`,
    tz, day
  );
  if (spread.length) {
    alerts.push({ code: 'PRICE_VARIANCE', severity: 'warning',
      title: `${spread.length} medicine${spread.length === 1 ? '' : 's'} sold at materially different prices today`,
      detail: spread.map((x) => `${x.name} Rs ${rs(x.mn)}–${rs(x.mx)}`).join(' · ') });
  }
  const stale = all(
    `SELECT cs.counter, cs.opened_at, u.full_name FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
      WHERE cs.status = 'open' AND cs.opened_at < datetime('now', '-24 hours')`
  );
  if (stale.length) {
    alerts.push({ code: 'STALE_TILL', severity: 'warning',
      title: `${stale.length} till session${stale.length === 1 ? '' : 's'} left open for more than a day`,
      detail: stale.map((s) => `${s.counter} — ${s.full_name}, since ${s.opened_at} UTC`).join(' · ') + '. Close it in Cash Flow, or an administrator can force-close it.' });
  }
  const undated = one(
    `SELECT COUNT(*) c, COALESCE(SUM(sb.quantity),0) units FROM stock_batches sb
       JOIN products p ON p.id = sb.product_id LEFT JOIN product_types pt ON pt.id = p.product_type_id
      WHERE sb.quantity > 0 AND sb.quarantined = 0 AND sb.expiry_date IS NULL AND COALESCE(pt.is_medicine, 1) = 1`
  );
  if (undated.c > 0) {
    alerts.push({ code: 'BATCH_NO_EXPIRY', severity: 'danger',
      title: `${undated.c} saleable batch${undated.c === 1 ? '' : 'es'} of medicine (${undated.units} units) ${undated.c === 1 ? 'has' : 'have'} no expiry date`,
      detail: 'FEFO cannot place them and the expiry watch cannot see them. Quarantine them, then write them off or receive them properly. New undated batches are now refused by the database.' });
  }
  return alerts;
}

// Open till for this pharmacist, so the shift's expected cash sits on the home
// screen rather than one click away in the cash module.
function tillStatus(userId) {
  const session = one(
    "SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
    userId
  );
  if (!session) return { open: false };
  const agg = one(
    `SELECT COALESCE(SUM(CASE WHEN type='in'  THEN amount ELSE 0 END),0) AS cin,
            COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE 0 END),0) AS cout
     FROM cash_transactions WHERE session_id = ?`,
    session.id
  );
  return {
    open: true,
    id: session.id,
    counter: session.counter,
    opened_at: session.opened_at,
    opening_float: num(session.opening_float),
    cash_in: num(agg.cin),
    cash_out: num(agg.cout),
    expected: num(Number(session.opening_float) + agg.cin - agg.cout),
  };
}

// --- Assembly ---------------------------------------------------------------
function buildDashboard(user) {
  const settings = getSettings();
  const tz = tzModifier(settings);
  const today = businessDate(settings);

  return {
    business_date: today,
    tz_offset_hours: Number(settings.tz_offset_hours || 0),
    sales: salesToday(tz, today),
    queue: pharmacyQueue(today),
    pending: pendingPrescriptions(today),
    stock: stockPosition(),
    reorder: reorderList(tz),
    expiry: expiryExposure(settings, today),
    controlled: controlledDrugs(tz, today),
    compliance: complianceGaps(),
    top_sellers: topSellers(tz, today),
    recent_sales: recentSales(tz, today),
    till: tillStatus(user.id),
    alerts: sanityAlerts(tz, today, salesToday(tz, today)),
  };
}

// --- Day-end close-out ------------------------------------------------------
// The Z-report a pharmacy prints and files at closing: what was sold, how it
// was paid for, what the drawer should hold against what was counted, every
// controlled-drug entry made, and what was refunded. Read-only — it reports on
// the day rather than altering it, so it can be re-printed at any time.
function buildDayClose(date) {
  const settings = getSettings();
  const tz = tzModifier(settings);
  const day = date || businessDate(settings);

  const sales = salesToday(tz, day);

  const byCategory = all(
    `SELECT category, COUNT(*) AS bills, COALESCE(SUM(net_amount),0) AS net,
            COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(subsidy),0) AS subsidy
     FROM bills
     WHERE bill_type = 'pharmacy-sale' AND date(created_at, ?) = ?
     GROUP BY category ORDER BY net DESC`,
    tz, day
  );

  // One row per PRODUCT (QA S3-16). The bill line's description carries how it
  // was sold ("Panadol — 2 strip"), so grouping on it split one medicine into
  // several rows; the name comes from the product, the unit from the product.
  const items = all(
    `SELECT COALESCE(p.name, bi.description) AS description, p.unit, bi.ref_id AS product_id,
            SUM(bi.quantity) AS units, SUM(bi.line_total) AS revenue, COUNT(DISTINCT b.id) AS bills
     FROM bill_items bi JOIN bills b ON b.id = bi.bill_id LEFT JOIN products p ON p.id = bi.ref_id
     WHERE bi.item_type = 'pharmacy' AND b.status != 'amended' AND date(b.created_at, ?) = ?
     GROUP BY bi.ref_id
     ORDER BY revenue DESC`,
    tz, day
  );

  const bills = all(
    `SELECT b.bill_no, b.created_at, b.category, b.gross_amount, b.discount,
            b.net_amount, b.paid_amount, b.payment_method, b.status,
            COALESCE(p.full_name, b.customer_name, 'Walk-in customer') AS buyer,
            u.full_name AS served_by
     FROM bills b
     LEFT JOIN patients p ON p.id = b.patient_id
     LEFT JOIN users u ON u.id = b.created_by
     WHERE b.bill_type = 'pharmacy-sale' AND date(b.created_at, ?) = ?
     ORDER BY b.created_at ASC, b.id ASC`,
    tz, day
  );

  const refunds = all(
    `SELECT r.return_no, r.refund_amount, r.reason, r.created_at,
            COALESCE(p.full_name, r.customer_name, 'Walk-in customer') AS buyer
     FROM returns r LEFT JOIN patients p ON p.id = r.patient_id
     WHERE date(r.created_at, ?) = ?
     ORDER BY r.created_at ASC, r.id ASC`,
    tz, day
  );

  const controlled = all(
    `SELECT entry_no, product_name, drug_schedule, batch_no, quantity,
            COALESCE(buyer_name, patient_name) AS buyer, buyer_cnic,
            prescriber_name, prescription_ref, pharmacist_name, created_at
     FROM controlled_register
     WHERE date(created_at, ?) = ?
     ORDER BY created_at ASC, id ASC`,
    tz, day
  );

  // Till sessions that were open on this day, with their reconciliation. A
  // session still open has no counted figure yet, so variance stays null.
  const tills = all(
    `SELECT cs.id, cs.counter, cs.status, cs.opening_float, cs.opened_at, cs.closed_at,
            cs.expected_cash, cs.counted_cash, cs.variance, u.full_name AS user_name,
            COALESCE((SELECT SUM(CASE WHEN ct.type='in' THEN ct.amount ELSE -ct.amount END)
                      FROM cash_transactions ct WHERE ct.session_id = cs.id), 0) AS net_movement
     FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
     WHERE date(cs.opened_at, ?) = ?
     ORDER BY cs.id ASC`,
    tz, day
  );

  // -------------------------------------------------------------------------
  // The segments the client asked for by name:
  //   "day end when session is closed it generates the report and print it
  //    (card patient, dialysis patient, paid patient)"
  //
  // Segmented on `charge_class` and `cost_centre` — who paid, and where it went.
  // Those two columns exist precisely so a day can be cut this way without a
  // status string having to mean two things at once.
  //
  // Every rupee has to land in exactly one segment, or the sections will not sum
  // to the gross and nobody will trust the sheet.
  // -------------------------------------------------------------------------
  const segments = all(
    `SELECT
        CASE
          WHEN b.cost_centre = 'DIALYSIS'        THEN 'Dialysis patients'
          WHEN b.bill_type = 'department-invoice' THEN 'Department invoices'
          WHEN b.charge_class = 'STAFF'          THEN 'Staff'
          WHEN b.charge_class LIKE 'CARD\_%' ESCAPE '\\' THEN 'Welfare card ' ||
               CASE b.charge_class WHEN 'CARD_100' THEN '100%'
                                   WHEN 'CARD_50'  THEN '50%'
                                   WHEN 'CARD_20'  THEN '20%'
                                   ELSE b.charge_class END
          WHEN b.charge_class = 'ZAKAT'          THEN 'Fully supported (Zakat)'
          ELSE 'Paid customers'
        END AS segment,
        COUNT(*) AS bills,
        COALESCE(SUM(b.gross_amount),0) AS gross,
        COALESCE(SUM(b.discount),0)     AS discount,
        COALESCE(SUM(b.subsidy),0)      AS subsidy,
        COALESCE(SUM(b.net_amount),0)   AS net,
        COALESCE(SUM(b.paid_amount),0)  AS paid
     FROM bills b
     WHERE date(b.created_at, ?) = ? AND b.status != 'amended' AND b.bill_type != 'credit-note'
     GROUP BY segment ORDER BY gross DESC`,
    tz, day
  );

  // Departments broken out, because "lab, emergency, ward" is how the owner
  // reads hospital expense.
  const byDepartment = all(
    `SELECT COALESCE(d.name, 'Unassigned') AS department, COUNT(*) AS invoices,
            COALESCE(SUM(b.net_amount),0) AS net
     FROM bills b LEFT JOIN departments d ON d.id = b.department_id
     WHERE b.bill_type = 'department-invoice' AND date(b.created_at, ?) = ?
       AND b.status != 'amended'
     GROUP BY d.id ORDER BY net DESC`,
    tz, day
  );

  // Credit given today and credit recovered today are two different facts and
  // are never netted: one is money going out on trust, the other coming back.
  const creditGiven = one(
    `SELECT COUNT(*) n, COALESCE(SUM(net_amount),0) amount FROM bills
      WHERE payment_method = 'credit' AND status != 'amended' AND date(created_at, ?) = ?`,
    tz, day
  );
  const creditRecovered = one(
    `SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount FROM cash_transactions
      WHERE category = 'credit-recovery' AND date(created_at, ?) = ?`,
    tz, day
  );

  // Corrections made today, and the days they put right — so a reprint of an
  // old day can point at them.
  const amendmentsToday = all(
    `SELECT a.id, a.for_date, a.reason, a.cash_delta,
            o.bill_no AS original_no, c.bill_no AS credit_note_no, n.bill_no AS corrected_no,
            u.full_name AS amended_by
       FROM bill_amendments a
       LEFT JOIN bills o ON o.id = a.original_id
       LEFT JOIN bills c ON c.id = a.credit_note_id
       LEFT JOIN bills n ON n.id = a.corrected_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE date(a.created_at, ?) = ?
      ORDER BY a.id`,
    tz, day
  );

  // ...and corrections made on ANY day that affect THIS day. Reprinting an
  // amended day must say so, or the reprint silently disagrees with the sheet
  // that was filed that evening.
  const amendmentsForThisDay = all(
    `SELECT a.id, a.reason, a.cash_delta, date(a.created_at, ?) AS made_on,
            o.bill_no AS original_no, n.bill_no AS corrected_no, u.full_name AS amended_by
       FROM bill_amendments a
       LEFT JOIN bills o ON o.id = a.original_id
       LEFT JOIN bills n ON n.id = a.corrected_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.for_date = ?
      ORDER BY a.id`,
    tz, day
  );

  // How the money actually arrived.
  const tender = all(
    `SELECT COALESCE(payment_method,'cash') AS method, COUNT(*) AS bills,
            COALESCE(SUM(paid_amount),0) AS amount
     FROM bills
     WHERE date(created_at, ?) = ? AND status != 'amended' AND bill_type != 'credit-note'
     GROUP BY method ORDER BY amount DESC`,
    tz, day
  );

  // Cash taken against cash that reached a drawer (QA S1-03 #3). Any gap is a
  // red band at the top of the sheet, not a quiet line.
  const cashCheck = (() => {
    const cashSales = one(
      `SELECT COALESCE(SUM(paid_amount),0) s FROM bills
        WHERE payment_method = 'cash' AND status != 'amended' AND bill_type NOT IN ('credit-note')
          AND date(created_at, ?) = ?`, tz, day).s;
    const tillIn = one(
      `SELECT COALESCE(SUM(amount),0) s FROM cash_transactions
        WHERE type = 'in' AND category = 'sale' AND date(created_at, ?) = ?`, tz, day).s;
    return { cash_sales: num(cashSales), till_cash_in: num(tillIn), difference: num(cashSales - tillIn), ok: Math.abs(cashSales - tillIn) < 0.005 };
  })();

  const stockMoved = one(
    `SELECT COALESCE(-SUM(m.quantity), 0) AS units_out
     FROM stock_movements m
     WHERE m.quantity < 0 AND m.type IN ('dispense','sale')
       AND m.cost_centre = 'COUNTER'
       AND date(m.created_at, ?) = ?`,
    tz, day
  ).units_out;

  return {
    date: day,
    generated_at: new Date().toISOString(),
    pharmacy: {
      name: settings.pharmacy_name,
      license_no: settings.pharmacy_license_no,
      address: settings.pharmacy_address,
      contact: settings.pharmacy_contact,
    },
    sales,
    segments,
    by_department: byDepartment,
    credit: {
      given: { count: creditGiven.n, amount: num(creditGiven.amount) },
      recovered: { count: creditRecovered.n, amount: num(creditRecovered.amount) },
    },
    tender,
    amendments: { made_today: amendmentsToday, affecting_this_day: amendmentsForThisDay },
    by_category: byCategory,
    items,
    bills,
    refunds,
    controlled,
    tills: tills.map((t) => ({
      ...t,
      opening_float: num(t.opening_float),
      expected: num(Number(t.opening_float) + t.net_movement),
      counted_cash: t.counted_cash == null ? null : num(t.counted_cash),
      variance: t.variance == null ? null : num(t.variance),
    })),
    units_out: stockMoved,
    cash_check: cashCheck,
    alerts: sanityAlerts(tz, day, sales),
    // Footed from the SAME rows the sections are built from, so the sections
    // always sum to the footer. Computing the footer with its own query is how
    // a day book ends up with a total that does not match its own sections.
    footer: (() => {
      const f = segments.reduce((t, s) => ({
        bills: t.bills + s.bills,
        gross: t.gross + s.gross,
        discount: t.discount + s.discount,
        subsidy: t.subsidy + s.subsidy,
        net: t.net + s.net,
        paid: t.paid + s.paid,
      }), { bills: 0, gross: 0, discount: 0, subsidy: 0, net: 0, paid: 0 });
      const byMethod = (m) => num((tender.find((t) => t.method === m) || {}).amount || 0);
      const till = tills.reduce((t, x) => ({
        expected: t.expected + Number(x.opening_float) + x.net_movement,
        counted: t.counted + (x.counted_cash == null ? 0 : Number(x.counted_cash)),
        variance: t.variance + (x.variance == null ? 0 : Number(x.variance)),
      }), { expected: 0, counted: 0, variance: 0 });
      return {
        bills: f.bills,
        gross: num(f.gross), discount: num(f.discount), subsidy: num(f.subsidy),
        net: num(f.net), paid: num(f.paid),
        cash: byMethod('cash'), card: byMethod('card'),
        digital: byMethod('online'), credit: byMethod('credit'),
        refunds: num(refunds.reduce((t, r) => t + Number(r.refund_amount || 0), 0)),
        till_expected: num(till.expected),
        till_counted: tills.some((t) => t.counted_cash != null) ? num(till.counted) : null,
        variance: tills.some((t) => t.variance != null) ? num(till.variance) : null,
      };
    })(),
    // Baskets parked before today and never finished. Listed rather than deleted:
    // a cart that vanishes overnight looks like lost data to whoever parked it,
    // and an unexplained empty slot at the counter is a support call. Whoever
    // closes the day decides whether to resume them or throw them away.
    stale_holds: db
      .prepare(
        `SELECT h.id, h.label, h.hold_date, u.full_name AS user_name
           FROM held_sales h LEFT JOIN users u ON u.id = h.user_id
          WHERE h.hold_date < ? ORDER BY h.hold_date, h.id`
      )
      .all(day),
  };
}

module.exports = { buildDashboard, buildDayClose, businessDate, tzModifier, complianceGaps, sanityAlerts };
