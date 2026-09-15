const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { wrap } = require('../utils');
const { businessDate } = require('../businessDay');
const { complianceGaps } = require('../pharmacyDashboard');

const router = express.Router();
router.use(authenticate);

// Management dashboard — daily operational visibility.
router.get(
  '/dashboard',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const today = businessDate();
    const one = (sql, ...args) => db.prepare(sql).get(...args);

    res.json({
      patients_today: one("SELECT COUNT(*) c FROM patients WHERE bizdate(created_at)=?", today).c,
      patients_total: one('SELECT COUNT(*) c FROM patients').c,
      tokens_today: one('SELECT COUNT(*) c FROM tokens WHERE token_date=?', today).c,
      lab_pending: one("SELECT COUNT(*) c FROM lab_orders WHERE status!='completed'").c,
      revenue_today: one("SELECT COALESCE(SUM(paid_amount),0) s FROM bills WHERE bizdate(created_at)=?", today).s,
      subsidy_today: one("SELECT COALESCE(SUM(subsidy),0) s FROM bills WHERE bizdate(created_at)=?", today).s,
      low_stock: one(
        `SELECT COUNT(*) c FROM (
           SELECT p.id FROM products p LEFT JOIN stock_batches b ON b.product_id=p.id
           WHERE p.is_active=1 GROUP BY p.id
           HAVING COALESCE(SUM(b.quantity),0) <= p.reorder_level)`
      ).c,
      // QA S2-13: the same figure the Inventory screen shows, so the two never
      // disagree about DRAP compliance.
      compliance: complianceGaps(),
    });
  })
);

// Discount / subsidy report by period.
router.get(
  '/subsidy',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '2999-12-31';
    const rows = db
      .prepare(
        `SELECT category,
                COUNT(*) AS bills,
                COALESCE(SUM(gross_amount),0) AS gross,
                COALESCE(SUM(discount),0) AS discount,
                COALESCE(SUM(subsidy),0) AS subsidy,
                COALESCE(SUM(net_amount),0) AS net
         FROM bills WHERE bizdate(created_at) BETWEEN ? AND ?
         GROUP BY category ORDER BY category`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Recent audit trail.
router.get(
  '/audit',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200').all());
  })
);

// --- Date range helper ---
// QA S3-25: a reversed range is an error, not an empty report.
function range(req) {
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(from) || !ok(to)) { const e = new Error('Dates must be YYYY-MM-DD'); e.status = 400; e.code = 'BAD_DATE'; throw e; }
  if (from > to) { const e = new Error(`The "to" date (${to}) is before the "from" date (${from}).`); e.status = 400; e.code = 'RANGE_REVERSED'; throw e; }
  return { from, to };
}

// Every calendar day in a range, so a report never silently skips a day with
// no trading (QA S3-27). Capped at a year.
function eachDay(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 366) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// Revenue — grouped by day, category, or bill type.
router.get(
  '/revenue',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const group = ['day', 'category', 'type'].includes(req.query.group) ? req.query.group : 'day';
    const col = group === 'day' ? "bizdate(created_at)" : group === 'category' ? 'category' : 'bill_type';
    const rows = db
      .prepare(
        `SELECT ${col} AS label, COUNT(*) AS bills,
                COALESCE(SUM(gross_amount),0) AS gross,
                COALESCE(SUM(discount),0) AS discount,
                COALESCE(SUM(subsidy),0) AS subsidy,
                COALESCE(SUM(net_amount),0) AS net,
                COALESCE(SUM(paid_amount),0) AS collected
         FROM bills WHERE bizdate(created_at) BETWEEN ? AND ?
         GROUP BY ${col} ORDER BY ${col}`
      )
      .all(from, to);
    if (group !== 'day') return res.json(rows);

    // QA S2-10: "reconciled" means the DRAWER was counted, not that collected
    // equals net. Each day carries its till state from the sessions of that
    // day: balanced, a variance, not counted, or no till at all.
    const tills = db
      .prepare(
        `SELECT bizdate(opened_at) AS d, COUNT(*) n,
                SUM(CASE WHEN status = 'closed' AND counted_cash IS NOT NULL THEN 1 ELSE 0 END) counted,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) open,
                COALESCE(SUM(variance), 0) variance
           FROM cash_sessions WHERE bizdate(opened_at) BETWEEN ? AND ? GROUP BY d`
      )
      .all(from, to);
    const closed = db.prepare('SELECT business_date, status FROM day_closes WHERE business_date BETWEEN ? AND ?').all(from, to);
    const byDay = Object.fromEntries(rows.map((r) => [r.label, r]));
    const zero = { bills: 0, gross: 0, discount: 0, subsidy: 0, net: 0, collected: 0 };
    const filled = eachDay(from, to).filter((d) => d <= businessDate() || byDay[d]).map((d) => {
      const r = byDay[d] || { label: d, ...zero };
      const t = tills.find((x) => x.d === d);
      const dc = closed.find((x) => x.business_date === d);
      let till;
      if (!t) till = { status: 'no_till', label: r.bills ? 'No till' : '—' };
      else if (t.open > 0) till = { status: 'open', label: 'Till open' };
      else if (t.counted === 0) till = { status: 'not_counted', label: 'Not counted' };
      else if (Math.abs(t.variance) < 0.005) till = { status: 'balanced', label: 'Balanced' };
      else till = { status: 'variance', label: `Variance Rs ${Math.round(t.variance * 100) / 100}`, variance: Math.round(t.variance * 100) / 100 };
      return { ...r, till, day_closed: dc ? dc.status : null };
    });
    res.json(filled);
  })
);

// Stock valuation — on-hand qty × cost, plus sale value.
router.get(
  '/stock-valuation',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.sale_price,
                COALESCE(SUM(b.quantity),0) AS on_hand,
                COALESCE(SUM(b.quantity * b.cost_price),0) AS cost_value,
                COALESCE(SUM(b.quantity),0) * p.sale_price AS sale_value
         FROM products p LEFT JOIN stock_batches b ON b.product_id = p.id
         WHERE p.is_active = 1
         GROUP BY p.id ORDER BY cost_value DESC`
      )
      .all();
    res.json(rows);
  })
);

// Vendor payables + purchase/reclaim totals.
router.get(
  '/vendors',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.VENDOR_VIEW),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT v.id, v.name, v.balance,
                COALESCE((SELECT SUM(total_amount) FROM purchases WHERE vendor_id=v.id),0) AS purchased,
                COALESCE((SELECT SUM(amount) FROM vendor_payments WHERE vendor_id=v.id),0) AS paid,
                COALESCE((SELECT SUM(value) FROM vendor_reclaims WHERE vendor_id=v.id),0) AS reclaimed
         FROM vendors v WHERE v.is_active = 1 ORDER BY v.balance DESC`
      )
      .all();
    res.json(rows);
  })
);

// Returns report.
router.get(
  '/returns',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.RETURN_MANAGE),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT r.return_no, r.created_at, r.refund_amount, r.reason,
                COALESCE(p.full_name, r.customer_name) AS customer,
                (SELECT SUM(quantity) FROM return_items WHERE return_id=r.id AND saleable=1) AS restocked,
                (SELECT SUM(quantity) FROM return_items WHERE return_id=r.id AND saleable=0) AS writtenoff
         FROM returns r LEFT JOIN patients p ON p.id = r.patient_id
         WHERE bizdate(r.created_at) BETWEEN ? AND ? ORDER BY r.created_at DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Cash flow report — session reconciliation by period.
router.get(
  '/cashflow',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT cs.id, cs.counter, u.full_name AS user_name, cs.opened_at, cs.closed_at,
                cs.opening_float, cs.expected_cash, cs.counted_cash, cs.variance, cs.status
         FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
         WHERE bizdate(cs.opened_at) BETWEEN ? AND ? ORDER BY cs.opened_at DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Patient register.
router.get(
  '/patients',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT patient_code, full_name, gender, age, category, contact, bizdate(created_at) AS registered
         FROM patients WHERE bizdate(created_at) BETWEEN ? AND ? ORDER BY created_at DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Lab productivity — tests ordered vs completed.
router.get(
  '/lab',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.LAB_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT lt.name AS test_name,
                COUNT(*) AS ordered,
                SUM(CASE WHEN lo.status='completed' THEN 1 ELSE 0 END) AS completed,
                COALESCE(SUM(lo.price),0) AS revenue
         FROM lab_orders lo JOIN lab_tests lt ON lt.id = lo.lab_test_id
         WHERE bizdate(lo.created_at) BETWEEN ? AND ?
         GROUP BY lt.id ORDER BY ordered DESC`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Dialysis activity by category.
router.get(
  '/dialysis',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT p.category, COUNT(*) AS sessions,
                COALESCE(SUM(b.gross_amount),0) AS gross,
                COALESCE(SUM(b.subsidy),0) AS subsidy,
                COALESCE(SUM(b.net_amount),0) AS net
         FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id
         LEFT JOIN bills b ON b.id = s.bill_id
         WHERE s.status='completed' AND bizdate(s.scheduled_at) BETWEEN ? AND ?
         GROUP BY p.category`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Stock-movement ledger (FR-REP-04).
router.get(
  '/stock-movements',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const { from, to } = range(req);
    const rows = db
      .prepare(
        `SELECT m.created_at, p.name AS product_name, m.type, m.quantity, m.reference, m.reason
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         WHERE bizdate(m.created_at) BETWEEN ? AND ?
         ORDER BY m.created_at DESC LIMIT 500`
      )
      .all(from, to);
    res.json(rows);
  })
);

// Staff discount consumed vs annual cap, per staff member (FR-REP-11).
router.get(
  '/staff-discount',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    // THE SAME DEFINITION AS THE ENFORCER. This route was the last of three
    // different answers to "how much has this employee used": it keyed on
    // `category = 'Staff'` rather than `charge_class`, counted the calendar
    // year, summed only `discount`, and applied the trust-wide cap to everyone
    // regardless of their personal one. All four differed from `staffAllowance()`.
    //
    // Same keys, same year, same sum, same per-employee cap. Presented the way
    // this screen wants it — Staff ID, name, used, left — but it is the same
    // figure as `/reports/staff-allowances`, which is the point.
    const { capFor } = require('../staffCap');
    const B = require('../businessDay');
    const startMonth = B.fiscalStartMonth();
    const fy = req.query.fy ? Number(req.query.fy) : B.fiscalYearOf(B.businessDate(), startMonth);
    const { from, to } = B.fiscalRange(fy, startMonth);

    const rows = db
      .prepare(
        `SELECT p.id, p.patient_code, p.full_name, p.staff_cap,
                COALESCE(SUM(b.discount + b.subsidy),0) AS used
         FROM patients p
         LEFT JOIN bills b ON b.patient_id = p.id AND b.charge_class = 'STAFF'
              AND b.status != 'amended'
              AND bizdate(b.created_at) BETWEEN ? AND ?
         WHERE p.category = 'Staff' OR p.customer_type = 'staff'
         GROUP BY p.id ORDER BY used DESC`
      )
      .all(from, to);
    rows.forEach((r) => {
      r.cap = capFor(r);
      r.used = round2(r.used);
      r.remaining = round2(Math.max(0, r.cap - r.used));
      r.year = B.fiscalLabel(fy, startMonth);
    });
    res.json(rows);
  })
);

// ---------------------------------------------------------------------------
// Hospital expense — what the departments cost the trust.
//
// This is the number the trust budgets against, so it prints on one page. It is
// simply the department invoices for the period: the same documents the
// department in-charge was shown, not a separate calculation that could
// disagree with them.
// ---------------------------------------------------------------------------
router.get(
  '/hospital-expense',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const { from, to } = req.query;
    const start = from || `${String(new Date().getFullYear())}-01-01`;
    const end = to || new Date().toISOString().slice(0, 10);

    const byDepartment = db
      .prepare(
        `SELECT d.code, d.name, d.in_charge,
                COUNT(b.id) AS invoices,
                COALESCE(SUM(b.net_amount), 0) AS amount,
                COALESCE(SUM(b.paid_amount), 0) AS paid
           FROM departments d
           LEFT JOIN bills b ON b.department_id = d.id
                AND bizdate(b.created_at) BETWEEN ? AND ?
          WHERE d.is_active = 1
          GROUP BY d.id ORDER BY amount DESC`
      )
      .all(start, end);

    const byMonth = db
      .prepare(
        `SELECT bizmonth(b.created_at) AS month, d.code,
                COALESCE(SUM(b.net_amount), 0) AS amount
           FROM bills b JOIN departments d ON d.id = b.department_id
          WHERE bizdate(b.created_at) BETWEEN ? AND ?
          GROUP BY month, d.code ORDER BY month, d.code`
      )
      .all(start, end);

    const byItem = db
      .prepare(
        `SELECT d.code, p.name AS product, SUM(bi.quantity) AS quantity,
                COALESCE(SUM(bi.line_total), 0) AS amount
           FROM bill_items bi
           JOIN bills b ON b.id = bi.bill_id
           JOIN departments d ON d.id = b.department_id
           LEFT JOIN products p ON p.id = bi.ref_id
          WHERE bizdate(b.created_at) BETWEEN ? AND ?
          GROUP BY d.code, p.name ORDER BY amount DESC LIMIT 200`
      )
      .all(start, end);

    res.json({
      from: start,
      to: end,
      total: byDepartment.reduce((s, r) => s + r.amount, 0),
      by_department: byDepartment,
      by_month: byMonth,
      by_item: byItem,
    });
  })
);

// ---------------------------------------------------------------------------
// Staff statement — what one employee has drawn against their allowance.
//
// The part that did not exist before: the amount RECOVERABLE once the cap is
// exceeded. Showing "you are over" without a figure leaves payroll guessing.
// ---------------------------------------------------------------------------
router.get(
  '/staff-statement/:customerId',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const { getSetting } = require('../settings');
    const person = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.customerId);
    if (!person) return res.status(404).json({ error: 'Customer not found' });

    const cap = require('../staffCap').capFor(person);
    // The SAME year the cap is enforced on. When the enforcer used the calendar
    // year and this used another, the two disagreed about the same number —
    // that already happened once in Phase 04 and is not worth repeating.
    const B = require('../businessDay');
    const startMonth = B.fiscalStartMonth();
    const fy = req.query.fy ? Number(req.query.fy) : B.fiscalYearOf(B.businessDate(), startMonth);
    const { from, to } = B.fiscalRange(fy, startMonth);
    const year = B.fiscalLabel(fy, startMonth);

    const bills = db
      .prepare(
        `SELECT id, bill_no, created_at, gross_amount, discount, subsidy, net_amount, paid_amount
           FROM bills
          WHERE patient_id = ? AND charge_class = 'STAFF' AND status != 'amended'
            AND bizdate(created_at) BETWEEN ? AND ?
          ORDER BY created_at DESC`
      )
      .all(person.id, from, to);

    const consumed = round2(bills.reduce((t, b) => t + b.discount + b.subsidy, 0));
    const purchases = round2(bills.reduce((t, b) => t + b.gross_amount, 0));
    const paid = round2(bills.reduce((t, b) => t + b.paid_amount, 0));

    // The excess is what the cap REFUSED to cover, so it is already sitting in
    // net_amount as money the staff member owes. It is reported separately so
    // payroll (or the counter) has one number to act on.
    const outstanding = round2(bills.reduce((t, b) => t + (b.net_amount - b.paid_amount), 0));

    res.json({
      staff: { id: person.id, code: person.patient_code, name: person.full_name, contact: person.contact },
      year, from, to, fiscal_year_start_month: startMonth,
      entitlement: cap,
      purchases,
      subsidy_consumed: consumed,
      remaining: round2(Math.max(0, cap - consumed)),
      exceeded_by: round2(Math.max(0, consumed - cap)),
      paid,
      recoverable: outstanding,
      bills,
    });
  })
);

// Everyone on staff, with how much of their allowance is left. The list the
// administrator reads at year end.
router.get(
  '/staff-allowances',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const { capFor } = require('../staffCap');
    const B = require('../businessDay');
    const startMonth = B.fiscalStartMonth();
    const fy = req.query.fy ? Number(req.query.fy) : B.fiscalYearOf(B.businessDate(), startMonth);
    const { from, to } = B.fiscalRange(fy, startMonth);
    const year = B.fiscalLabel(fy, startMonth);
    const rows = db
      .prepare(
        `SELECT p.id, p.patient_code, p.full_name, p.contact, p.cnic,
                p.designation, p.staff_cap, p.category, p.customer_type,
                COALESCE(SUM(b.discount + b.subsidy), 0) AS consumed,
                COALESCE(SUM(b.net_amount - b.paid_amount), 0) AS recoverable
           FROM patients p
           LEFT JOIN bills b ON b.patient_id = p.id AND b.charge_class = 'STAFF'
                AND b.status != 'amended'
                AND bizdate(b.created_at) BETWEEN ? AND ?
          WHERE p.category = 'Staff' OR p.customer_type = 'staff'
          GROUP BY p.id ORDER BY consumed DESC`
      )
      .all(from, to);

    // The credit account is what payroll actually nets against, so the list that
    // payroll reads should carry it. Without it the administrator has this
    // screen for "how much allowance is left" and a different screen for "how
    // much does he owe", and has to hold both in their head.
    const owed = db.prepare(
      `SELECT a.balance FROM ledger_accounts a
         JOIN parties p ON p.id = a.party_id
        WHERE p.customer_id = ? AND a.ledger_kind = 'staff'`
    );

    rows.forEach((r) => {
      const cap = capFor(r);
      r.entitlement = cap;
      r.uses_default_cap = r.staff_cap == null ? 1 : 0;
      r.remaining = round2(Math.max(0, cap - r.consumed));
      r.exceeded_by = round2(Math.max(0, r.consumed - cap));
      r.consumed = round2(r.consumed);
      r.recoverable = round2(r.recoverable);
      r.on_credit = round2((owed.get(r.id) || {}).balance || 0);
      r.year = year;
    });
    res.json(rows);
  })
);

// What the trust gave away, and out of whose money. The donor-facing figure.
router.get(
  '/subsidy-by-fund',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(
        `SELECT COALESCE(f.code, 'UNATTRIBUTED') AS fund,
                COALESCE(f.name, 'Not attributed to a fund') AS fund_name,
                COUNT(b.id) AS bills,
                COALESCE(SUM(b.discount), 0) AS discount,
                COALESCE(SUM(b.subsidy), 0)  AS subsidy
           FROM bills b LEFT JOIN subsidy_funds f ON f.id = b.subsidy_fund_id
          WHERE (b.discount > 0 OR b.subsidy > 0)
            AND bizdate(b.created_at) BETWEEN ? AND ?
          GROUP BY b.subsidy_fund_id ORDER BY subsidy DESC, discount DESC`
      )
      .all(from, to);
    rows.forEach((r) => { r.given = round2(r.discount + r.subsidy); });
    res.json({ from, to, total_given: round2(rows.reduce((t, r) => t + r.given, 0)), by_fund: rows });
  })
);

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Receivables — who owes what, and for how long.
//
// Printed as a CALL LIST, because that is what it gets used for: a name, an
// amount, how overdue it is, and a mobile number to ring. A report that omits
// the phone number makes the person reading it go and look it up 40 times.
// ---------------------------------------------------------------------------
router.get(
  '/receivables',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const L = require('../ledger');
    const kind = req.query.kind || null;
    // Vendor accounts are payables, not receivables — money we owe, not money
    // owed to us. Summing them into this total would report the shop's debts as
    // its assets. They are reachable only by asking for `kind=vendor`.
    const accounts = db
      .prepare(
        `SELECT a.id, a.balance, a.credit_limit, a.ledger_kind,
                p.name, p.contact, p.party_type
           FROM ledger_accounts a JOIN parties p ON p.id = a.party_id
          WHERE a.balance > 0
            AND (? IS NULL OR a.ledger_kind = ?)
            AND (? IS NOT NULL OR a.ledger_kind <> 'vendor')
          ORDER BY a.balance DESC`
      )
      .all(kind, kind, kind);

    const lastPaid = db.prepare(
      "SELECT MAX(entry_date) AS d FROM ledger_entries WHERE account_id = ? AND credit > 0"
    );

    const rows = accounts.map((a) => {
      const age = L.aging(a.id);
      return {
        ...a,
        current: age.current, d30: age.d30, d60: age.d60, d90: age.d90,
        oldest: age.oldest,
        last_payment: lastPaid.get(a.id).d,
        over_limit: a.credit_limit != null && a.balance > a.credit_limit ? 1 : 0,
      };
    });

    const totals = rows.reduce((t, r) => ({
      balance: round2(t.balance + r.balance),
      current: round2(t.current + r.current),
      d30: round2(t.d30 + r.d30),
      d60: round2(t.d60 + r.d60),
      d90: round2(t.d90 + r.d90),
    }), { balance: 0, current: 0, d30: 0, d60: 0, d90: 0 });

    res.json({ generated_at: new Date().toISOString(), totals, accounts: rows });
  })
);

// Credit given today versus credit recovered today. These are two different
// things and the day book must not net them: one is money going out on trust,
// the other is money coming back, and an owner reading a single figure cannot
// tell whether the amount owed is growing or shrinking.
router.get(
  '/credit-daybook',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const { businessDate } = require('../businessDay');
    const day = req.query.date || businessDate();

    const given = db
      .prepare(
        `SELECT e.id, e.entry_date, e.debit AS amount, e.narration, b.bill_no,
                p.name, p.contact
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id
           JOIN parties p ON p.id = a.party_id
           LEFT JOIN bills b ON b.id = e.bill_id
          WHERE e.debit > 0 AND e.entry_date = ?
          ORDER BY e.id`
      )
      .all(day);

    const recovered = db
      .prepare(
        `SELECT e.id, e.entry_date, e.credit AS amount, e.narration, p.name, p.contact
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id
           JOIN parties p ON p.id = a.party_id
          WHERE e.credit > 0 AND e.entry_date = ?
          ORDER BY e.id`
      )
      .all(day);

    const sum = (rows) => round2(rows.reduce((t, r) => t + r.amount, 0));
    const outstanding = db
      .prepare('SELECT COALESCE(SUM(balance), 0) AS b FROM ledger_accounts WHERE balance > 0')
      .get().b;

    res.json({
      date: day,
      given: { count: given.length, amount: sum(given), rows: given },
      recovered: { count: recovered.length, amount: sum(recovered), rows: recovered },
      net_movement: round2(sum(given) - sum(recovered)),
      total_outstanding: round2(outstanding),
    });
  })
);

// ---------------------------------------------------------------------------
// Profitability — "how much company earn on their sales"
// ---------------------------------------------------------------------------
//
// Margin = what the counter took, minus what the goods cost the trust.
//
// Keyed on `cost_centre = 'COUNTER'`. Dialysis consumables and department issues
// deduct stock with no counter revenue behind them, so counting them here drives
// the margin negative and makes the whole report unbelievable — that was the
// Phase 02 defect and this is the query it was fixed for.
//
// Cost comes from THE BATCH THAT ACTUALLY WENT OUT, not the product default:
// two deliveries of the same medicine rarely cost the same, and margin is the
// one number where using an average quietly flatters a bad buying decision.
// THE GRAIN OF THIS REPORT IS THE BATCH, NOT THE BILL LINE.
//
// A sale of five tablets can draw three from one batch and two from another,
// and those two batches can have different costs AND different distributors.
// Joining bill_items to stock_movements therefore multiplies the line: the
// first version of this query reported Rs 20 of revenue on a Rs 10 sale, and
// every grouping was equally wrong, so comparing the groupings to each other
// did not reveal it.
//
// So the report is built from the movements, which are already one row per
// batch consumed, and the line's revenue is apportioned across them by
// quantity. `bills` is then a COUNT(DISTINCT), never a COUNT(*).
const SOLD_CTE = `
  WITH sold AS (
    SELECT b.id AS bill_id, b.created_at, sm.product_id, sm.batch_id,
           -sm.quantity AS qty,
           -sm.quantity * COALESCE(sb.cost_price, 0) AS cost,
           bi.line_total * (-sm.quantity * 1.0 / NULLIF(bi.quantity, 0)) AS revenue,
           sb.vendor_id
      FROM stock_movements sm
      JOIN bills b       ON b.bill_no = sm.reference
      JOIN bill_items bi ON bi.bill_id = b.id AND bi.ref_id = sm.product_id
                        AND bi.item_type = 'pharmacy'
      LEFT JOIN stock_batches sb ON sb.id = sm.batch_id
     WHERE sm.quantity < 0
       AND b.cost_centre = 'COUNTER'
       AND b.status != 'amended'
       AND b.bill_type != 'credit-note'
  )
`;

const MARGIN_GROUPS = {
  vendor: {
    label: 'Distributor',
    // vendor_id lives on the BATCH, which is why the batch has to be the grain:
    // one product's sale can legitimately span two distributors.
    join: 'LEFT JOIN vendors g ON g.id = s.vendor_id',
    key: 'COALESCE(g.id, 0)',
    name: "COALESCE(g.name, 'Not recorded')",
  },
  manufacturer: {
    label: 'Company',
    // manufacturer_id, not the free-text column: that is what stops GSK, G.S.K
    // and Glaxo appearing as three companies.
    join: 'JOIN products p ON p.id = s.product_id LEFT JOIN manufacturers g ON g.id = p.manufacturer_id',
    key: 'COALESCE(g.id, 0)',
    name: "COALESCE(g.name, 'Not recorded')",
  },
  product: {
    label: 'Product',
    join: 'JOIN products p ON p.id = s.product_id',
    key: 'p.id',
    name: 'p.name',
  },
  type: {
    label: 'Product type',
    join: 'JOIN products p ON p.id = s.product_id LEFT JOIN product_types g ON g.id = p.product_type_id',
    key: 'COALESCE(g.id, 0)',
    name: "COALESCE(g.name, 'Not set')",
  },
};

router.get(
  '/margin',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const B = require('../businessDay');
    const g = MARGIN_GROUPS[req.query.group] ? req.query.group : 'manufacturer';
    const spec = MARGIN_GROUPS[g];

    // The period. `fiscal=1` on an annual report means 1 July - 30 June, which
    // is the year the trust is actually audited on.
    const period = ['day', 'month', 'year'].includes(req.query.period) ? req.query.period : null;
    const fiscal = req.query.fiscal === '1';
    const startMonth = B.fiscalStartMonth();
    let { from, to } = req.query;
    let label = null;
    if (req.query.fy) {
      const r = B.fiscalRange(Number(req.query.fy), startMonth);
      from = r.from; to = r.to;
      label = `FY ${B.fiscalLabel(Number(req.query.fy), startMonth)}`;
    }
    from = from || '1970-01-01';
    to = to || '2999-12-31';

    // One row per unit that left the counter, with what it sold for and what
    // that batch cost.
    const rows = db
      .prepare(
        `${SOLD_CTE}
         SELECT ${spec.key} AS group_id, ${spec.name} AS group_name,
                COUNT(DISTINCT s.bill_id) AS bills,
                COALESCE(SUM(s.qty), 0)     AS units,
                COALESCE(SUM(s.revenue), 0) AS revenue,
                COALESCE(SUM(s.cost), 0)    AS cost
           FROM sold s
           ${spec.join}
          WHERE bizdate(s.created_at) BETWEEN ? AND ?
          GROUP BY ${spec.key}
          ORDER BY revenue DESC`
      )
      .all(from, to);

    rows.forEach((r) => {
      r.revenue = round2(r.revenue);
      r.cost = round2(r.cost);
      r.margin = round2(r.revenue - r.cost);
      r.margin_pct = r.revenue > 0 ? round2((r.margin / r.revenue) * 100) : 0;
    });

    const totals = rows.reduce((t, r) => ({
      bills: t.bills + r.bills,
      units: t.units + r.units,
      revenue: round2(t.revenue + r.revenue),
      cost: round2(t.cost + r.cost),
    }), { bills: 0, units: 0, revenue: 0, cost: 0 });
    totals.margin = round2(totals.revenue - totals.cost);
    totals.margin_pct = totals.revenue > 0 ? round2((totals.margin / totals.revenue) * 100) : 0;

    // Optional breakdown over time, on the same basis.
    let series = [];
    if (period) {
      const bucket = period === 'day' ? 'bizdate(b.created_at)'
        : period === 'month' ? 'bizmonth(b.created_at)'
          : fiscal ? null : 'bizyear(b.created_at)';
      if (bucket) {
        series = db
          .prepare(
            `${SOLD_CTE}
             SELECT ${bucket.replace('b.created_at', 's.created_at')} AS bucket,
                    COALESCE(SUM(s.revenue), 0) AS revenue,
                    COALESCE(SUM(s.cost), 0) AS cost
               FROM sold s
              WHERE bizdate(s.created_at) BETWEEN ? AND ?
              GROUP BY bucket ORDER BY bucket`
          )
          .all(from, to);
      } else {
        // Fiscal years cannot be grouped by a SQL year function, because the
        // boundary is 1 July. Bucket by month, then fold.
        const months = db
          .prepare(
            `${SOLD_CTE}
             SELECT bizmonth(s.created_at) AS m,
                    COALESCE(SUM(s.revenue), 0) AS revenue,
                    COALESCE(SUM(s.cost), 0) AS cost
               FROM sold s
              WHERE bizdate(s.created_at) BETWEEN ? AND ?
              GROUP BY m ORDER BY m`
          )
          .all(from, to);
        const byFy = {};
        for (const m of months) {
          const fy = B.fiscalYearOf(`${m.m}-01`, startMonth);
          const k = B.fiscalLabel(fy, startMonth);
          byFy[k] = byFy[k] || { bucket: k, revenue: 0, cost: 0 };
          byFy[k].revenue += m.revenue;
          byFy[k].cost += m.cost;
        }
        series = Object.values(byFy);
      }
      series.forEach((x) => {
        x.revenue = round2(x.revenue);
        x.cost = round2(x.cost);
        x.margin = round2(x.revenue - x.cost);
      });
    }

    res.json({
      group: g,
      group_label: spec.label,
      from, to, label,
      fiscal, fiscal_year_start_month: startMonth,
      rows, totals, series,
    });
  })
);

// Which fiscal years there is data for, so the screen can offer them.
router.get(
  '/fiscal-years',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const B = require('../businessDay');
    const m = B.fiscalStartMonth();
    const months = db
      .prepare('SELECT DISTINCT bizmonth(created_at) AS m FROM bills WHERE created_at IS NOT NULL')
      .all()
      .map((r) => r.m)
      .filter(Boolean);
    const years = [...new Set(months.map((x) => B.fiscalYearOf(`${x}-01`, m)))].sort((a, b) => b - a);
    res.json({
      start_month: m,
      years: years.map((y) => ({ fy: y, label: B.fiscalLabel(y, m), ...B.fiscalRange(y, m) })),
    });
  })
);

// Drug velocity — how fast each medicine leaves the shelf, and how long what is
// on it will last. Units OUT are the counter's and the departments' issues
// (stock_movements type dispense/sale, negative); the run rate is per day over
// the period asked for; days left divides today's shelf by it. Tiers are the
// screen's reading of the run rate, not a stored attribute.
router.get(
  '/velocity',
  requirePermission(PERMISSIONS.REPORT_VIEW, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const to = req.query.to || businessDate();
    const from = req.query.from || new Date(new Date(to).getTime() - 89 * 86400000).toISOString().slice(0, 10);
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.strength, p.generic_name, p.drug_schedule, p.drap_reg_no, p.unit, p.sale_price, p.reorder_level,
                p.units_per_strip, p.strips_per_box, mf.name AS manufacturer,
                COALESCE((SELECT SUM(sb.quantity) FROM stock_batches sb WHERE sb.product_id = p.id AND sb.quarantined = 0), 0) AS on_hand,
                COALESCE((SELECT SUM(sb.quantity * sb.cost_price) FROM stock_batches sb WHERE sb.product_id = p.id AND sb.quarantined = 0), 0) AS on_hand_cost,
                COALESCE((SELECT -SUM(m.quantity) FROM stock_movements m
                           WHERE m.product_id = p.id AND m.quantity < 0 AND m.type IN ('dispense','sale')
                             AND bizdate(m.created_at) BETWEEN ? AND ?), 0) AS units_out,
                (SELECT MAX(bizdate(m.created_at)) FROM stock_movements m
                  WHERE m.product_id = p.id AND m.quantity < 0 AND m.type IN ('dispense','sale')) AS last_out,
                (SELECT MIN(sb.expiry_date) FROM stock_batches sb WHERE sb.product_id = p.id AND sb.quantity > 0 AND sb.quarantined = 0) AS next_expiry
           FROM products p LEFT JOIN manufacturers mf ON mf.id = p.manufacturer_id
          WHERE p.is_active = 1
          ORDER BY units_out DESC, p.name`
      )
      .all(from, to)
      .map((r) => {
        const rate = r.units_out / days;
        const daysLeft = rate > 0 ? Math.round(r.on_hand / rate) : null;
        const tier = r.units_out === 0 ? 'dead' : rate >= 10 ? 'fast' : rate >= 2 ? 'moderate' : 'slow';
        return { ...r, run_rate: Math.round(rate * 100) / 100, days_left: daysLeft, tier, value_out: Math.round(r.units_out * r.sale_price * 100) / 100 };
      });
    const sum = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
    res.json({
      from, to, days,
      totals: {
        skus: rows.length, units_out: sum('units_out'), value_out: Math.round(sum('value_out') * 100) / 100,
        on_hand_cost: Math.round(sum('on_hand_cost') * 100) / 100,
        fast: rows.filter((r) => r.tier === 'fast').length, moderate: rows.filter((r) => r.tier === 'moderate').length,
        slow: rows.filter((r) => r.tier === 'slow').length, dead: rows.filter((r) => r.tier === 'dead').length,
        dead_cost: Math.round(rows.filter((r) => r.tier === 'dead').reduce((t, r) => t + r.on_hand_cost, 0) * 100) / 100,
        stockout_soon: rows.filter((r) => r.days_left != null && r.days_left <= 7).length,
      },
      rows,
    });
  })
);

module.exports = router;
