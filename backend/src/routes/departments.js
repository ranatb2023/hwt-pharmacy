const express = require('express');
const { db, nextSeq, ensureDepartmentCustomers } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap, pad, newBillNo } = require('../utils');
const H = require('../handovers');
const { businessDate } = require('../businessDay');
const { consumeFEFO, fullBill } = require('./pharmacy');
const pk = require('../packaging');

const router = express.Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// Departments: prescription in, invoice out.
//
// The laboratory, emergency and the wards are OUTSIDE this product — their
// modules are on hold. They send a paper prescription to the counter, someone
// types it here, stock goes out FEFO, and an invoice goes back. Those invoices
// are the hospital's expense.
//
// This is deliberately NOT a silent internal transfer valued at cost with no
// paperwork. A department in-charge can be shown the invoice, the ledger the
// pharmacy already needs for customer credit is reused, and "hospital expense by
// department" becomes a GROUP BY rather than a second accounting mechanism.
// ---------------------------------------------------------------------------

const INVOICE_BASES = ['cost', 'cost_plus', 'mrp'];

// What one base unit of a product costs this department.
//
// Q12 assumption: batch COST price. This is money moving inside one
// organisation, so the point is expense tracking, not margin — charging MRP
// would make the department look expensive and the pharmacy look profitable on
// the same rupee. `invoice_basis` is on the table so the trust can decide
// otherwise without a release.
function rateFor(dept, product, batches) {
  if (dept.invoice_basis === 'mrp') return Number(product.mrp || product.sale_price || 0);

  // Cost is the weighted average of the batches actually consumed, not the
  // product's current cost: two batches bought at different prices must not
  // both be charged at whichever was cheapest.
  let value = 0;
  let qty = 0;
  for (const b of batches || []) {
    value += Number(b.cost_price || 0) * b.quantity;
    qty += b.quantity;
  }
  const avg = qty > 0 ? value / qty : 0;
  const markup = dept.invoice_basis === 'cost_plus' ? 1 + Number(dept.markup_pct || 0) : 1;
  return avg * markup;
}

// --- Department master -----------------------------------------------------

router.get(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT d.*,
                  (SELECT COUNT(*) FROM department_requests r
                    WHERE r.department_id = d.id AND r.status = 'received') AS pending
             FROM departments d WHERE d.is_active = 1
            ORDER BY d.sort_order, d.name`
        )
        .all()
    );
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const code = (b.code || '').trim().toUpperCase();
    const name = (b.name || '').trim();
    if (!code || !name) return res.status(400).json({ error: 'Code and name are required' });
    if (db.prepare('SELECT id FROM departments WHERE code = ?').get(code)) {
      return res.status(400).json({ error: `Department "${code}" already exists` });
    }
    const info = db
      .prepare(
        `INSERT INTO departments (code, name, in_charge, contact, invoice_basis, markup_pct, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 99)`
      )
      .run(
        code, name, b.in_charge || null, b.contact || null,
        INVOICE_BASES.includes(b.invoice_basis) ? b.invoice_basis : 'cost',
        Number(b.markup_pct || 0)
      );
    // Same call the migration uses, so a department added here is not a second
    // class of department missing the record its invoices post against.
    ensureDepartmentCustomers();
    audit(req, 'department.create', 'department', info.lastInsertRowid, { code, name });
    res.status(201).json(db.prepare('SELECT * FROM departments WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.put(
  '/:id',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Department not found' });
    const b = req.body || {};
    db.prepare(
      `UPDATE departments SET name = ?, in_charge = ?, contact = ?,
         invoice_basis = ?, markup_pct = ?, is_active = ? WHERE id = ?`
    ).run(
      b.name ? b.name.trim() : d.name,
      b.in_charge ?? d.in_charge,
      b.contact ?? d.contact,
      INVOICE_BASES.includes(b.invoice_basis) ? b.invoice_basis : d.invoice_basis,
      b.markup_pct != null ? Number(b.markup_pct) : d.markup_pct,
      b.is_active != null ? (b.is_active ? 1 : 0) : d.is_active,
      d.id
    );
    audit(req, 'department.update', 'department', d.id, b);
    res.json(db.prepare('SELECT * FROM departments WHERE id = ?').get(d.id));
  })
);

// --- Requests --------------------------------------------------------------

router.get(
  '/requests',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const { status, department_id: deptId, date } = req.query;
    const rows = db
      .prepare(
        `SELECT r.*, d.name AS department_name, d.code AS department_code,
                b.bill_no, b.net_amount,
                (SELECT COUNT(*) FROM department_request_items i WHERE i.request_id = r.id) AS line_count,
                (SELECT COUNT(*) FROM department_request_items i WHERE i.request_id = r.id AND i.is_emergency = 1) AS emergency_lines,
                (SELECT COALESCE(SUM(i.qty_requested), 0) FROM department_request_items i WHERE i.request_id = r.id) AS units_requested
           FROM department_requests r
           JOIN departments d ON d.id = r.department_id
           LEFT JOIN bills b ON b.id = r.bill_id
          WHERE (? IS NULL OR r.status = ?)
            AND (? IS NULL OR r.department_id = ?)
            AND (? IS NULL OR r.requested_on = ?)
          ORDER BY r.created_at DESC LIMIT 200`
      )
      .all(status || null, status || null, deptId || null, deptId || null, date || null, date || null);
    res.json(rows);
  })
);

router.get(
  '/requests/:id',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.INVENTORY_VIEW),
  wrap((req, res) => {
    const r = db
      .prepare(
        `SELECT r.*, d.name AS department_name, d.code AS department_code, d.in_charge,
                b.bill_no, b.net_amount
           FROM department_requests r
           JOIN departments d ON d.id = r.department_id
           LEFT JOIN bills b ON b.id = r.bill_id
          WHERE r.id = ?`
      )
      .get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    r.items = db
      .prepare(
        `SELECT i.*, p.name AS product_name, p.strength, p.unit,
                p.units_per_strip, p.strips_per_box
           FROM department_request_items i
           LEFT JOIN products p ON p.id = i.product_id
          WHERE i.request_id = ?`
      )
      .all(r.id);
    for (const i of r.items) {
      if (!i.product_id) continue;
      i.requested_label = pk.formatQty(i, i.qty_requested);
      i.dispensed_label = pk.formatQty(i, i.qty_dispensed);
    }
    res.json(r);
  })
);

// Type a slip that arrived from a department. Lines the counter cannot match to
// a catalogue product are kept as free text and resolved before dispensing —
// refusing the whole slip because one handwritten name is unclear would send the
// runner back across the hospital.
router.post(
  '/requests',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const b = req.body || {};
    if (b.department_id == null || b.department_id === '') {
      return res.status(400).json({ error: 'No department was sent with this issue.' });
    }
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(Number(b.department_id));
    if (!dept) return res.status(404).json({ error: `Department ${b.department_id} not found` });
    const lines = (b.items || []).filter((i) => i.product_id || (i.label && i.label.trim()));
    if (!lines.length) return res.status(400).json({ error: 'At least one line is required' });
    // Stock leaving the pharmacy with nobody named against it is what a
    // department disputes three weeks later, when no one can answer.
    if (!b.collected_by_name || !String(b.collected_by_name).trim()) {
      return res.status(400).json({ error: 'Name of the person collecting the medicine is required.' });
    }

    const out = db.transaction(() => {
      const no = `REQ-${pad(nextSeq('dept_request'), 5)}`;
      const info = db
        .prepare(
          `INSERT INTO department_requests
             (request_no, department_id, patient_name, patient_ref, slip_ref, prescriber,
              collected_by_name, collected_by_cnic, collected_by_contact,
              requested_on, notes, received_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          no, dept.id, b.patient_name || null, b.patient_ref || null, b.slip_ref || null,
          b.prescriber || null,
          b.collected_by_name || null, b.collected_by_cnic || null, b.collected_by_contact || null,
          b.requested_on || businessDate(), b.notes || null, req.user.id
        );
      const reqId = info.lastInsertRowid;

      // The runner carrying the medicine back to the ward. Kept on the request
      // row as well, because existing reports read it there — but the shared
      // record is the one to query from now on.
      H.record({
        context: 'department',
        ref_id: reqId,
        customer_id: dept.customer_id || null,
        taken_by: b.collected_by_name,
        relation: 'Attendant',
        cnic: b.collected_by_cnic || null,
        contact: b.collected_by_contact || null,
        user_id: req.user.id,
      });

      const ins = db.prepare(
        `INSERT INTO department_request_items
           (request_id, product_id, label, uom, qty_requested, is_emergency)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const l of lines) {
        const product = l.product_id
          ? db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id)
          : null;
        const uom = pk.UOMS.includes(l.uom) ? l.uom : 'unit';
        // Stored in BASE UNITS like everything downstream; the slip's own
        // wording ("2 boxes") is converted here, once, at the edge.
        const qty = product ? pk.toBaseUnits(product, l.quantity, uom) : Number(l.quantity || 0);
        ins.run(reqId, product ? product.id : null, l.label || null, uom, qty, l.is_emergency ? 1 : 0);
      }
      // The counter path: the runner is at the till, the pharmacist scanned the
      // items, there is nothing to come back and match later. Create and
      // dispense in the SAME transaction so a failure leaves neither a phantom
      // slip nor stock that moved without an invoice.
      if (b.auto_dispense) {
        return { reqId, dispensed: dispenseRequest(reqId, req.user, { allowPartial: b.allow_partial !== false }) };
      }
      return { reqId, dispensed: null };
    })();

    audit(req, 'department.request', 'department_request', out.reqId, {
      department: dept.code, dispensed: !!out.dispensed,
    });
    if (out.dispensed) {
      return res.status(201).json({
        request: db.prepare('SELECT * FROM department_requests WHERE id = ?').get(out.reqId),
        status: out.dispensed.status,
        // fullBill(), not the bare row: the receipt renders the lines.
        bill: fullBill(out.dispensed.billId),
        shortfalls: out.dispensed.shortfalls,
      });
    }
    res.status(201).json(db.prepare('SELECT * FROM department_requests WHERE id = ?').get(out.reqId));
  })
);

// Dispense a slip and invoice the department, in one transaction. Either the
// stock moved and the invoice exists, or neither happened.
//
// Extracted from the route because TWO screens reach it: the Departments page,
// where a slip is typed and matched first, and the counter, where the runner is
// standing in front of the pharmacist and the whole thing happens at once. One
// implementation, so the pricing, the cost-centre stamping and the credit
// payment method cannot drift between them.
function dispenseRequest(requestId, user, opts = {}) {
  const request = db.prepare('SELECT * FROM department_requests WHERE id = ?').get(requestId);
  if (!request) { const e = new Error('Request not found'); e.status = 404; throw e; }
  if (request.status !== 'received') {
    const e = new Error(`This slip is already ${request.status}.`);
    e.status = 409;
    throw e;
  }
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(request.department_id);
  const items = db.prepare('SELECT * FROM department_request_items WHERE request_id = ?').all(request.id);

  const unresolved = items.filter((i) => !i.product_id);
  if (unresolved.length) {
    const e = new Error(
      `${unresolved.length} line(s) are not matched to a product yet: ${unresolved.map((i) => i.label).join(', ')}`
    );
    e.status = 400;
    e.code = 'UNRESOLVED_LINES';
    throw e;
  }

  const allowPartial = opts.allowPartial !== false;
  const billNo = newBillNo();
  const billInfo = db
    .prepare(
      `INSERT INTO bills
         (bill_no, customer_name, category, bill_type, cost_centre, charge_class,
          department_id, gross_amount, discount, subsidy, net_amount, paid_amount,
          payment_method, status, created_by)
       VALUES (?, ?, 'Paid', 'department-invoice', ?, 'DEPARTMENT', ?, 0, 0, 0, 0, 0, 'credit', 'unpaid', ?)`
    )
    .run(billNo, dept.name, dept.code, dept.id, user.id);
  if (dept.customer_id) {
    db.prepare('UPDATE bills SET patient_id = ? WHERE id = ?').run(dept.customer_id, billInfo.lastInsertRowid);
  }
  const billId = billInfo.lastInsertRowid;

  let gross = 0;
  const shortfalls = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    const { dispensed, batches } = consumeFEFO(
      product.id, item.qty_requested, 'dispense', billNo, user.id,
      { allowPartial, costCentre: dept.code, chargeClass: 'DEPARTMENT' }
    );

    const rate = pk.round2(rateFor(dept, product, batches));
    const line = pk.round2(rate * dispensed);
    gross += line;

    db.prepare(
      'UPDATE department_request_items SET qty_dispensed = ?, unit_price = ?, line_total = ? WHERE id = ?'
    ).run(dispensed, rate, line, item.id);

    if (dispensed < item.qty_requested) {
      shortfalls.push({
        product: product.name,
        requested: item.qty_requested,
        dispensed,
        shortfall_label: pk.formatQty(product, item.qty_requested - dispensed),
      });
    }

    if (dispensed > 0) {
      db.prepare(
        `INSERT INTO bill_items (bill_id, item_type, ref_id, description, quantity, unit_price, line_total)
         VALUES (?, 'pharmacy', ?, ?, ?, ?, ?)`
      ).run(
        billId, product.id,
        `${product.name}${product.strength ? ` ${product.strength}` : ''} — ${pk.formatQty(product, dispensed)}`,
        dispensed, rate, line
      );
    }
  }

  const net = pk.round2(gross);
  db.prepare('UPDATE bills SET gross_amount = ?, net_amount = ? WHERE id = ?').run(net, net, billId);

  const status = shortfalls.length ? 'short' : 'dispensed';
  db.prepare('UPDATE department_requests SET status = ?, bill_id = ?, issued_by = ? WHERE id = ?')
    .run(status, billId, user.id, request.id);

  return { requestId: request.id, billId, billNo, net, shortfalls, status, department: dept };
}

router.post(
  '/requests/:id/dispense',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const out = db.transaction(() =>
      dispenseRequest(req.params.id, req.user, { allowPartial: req.body?.allow_partial !== false })
    )();
    audit(req, 'department.dispense', 'department_request', out.requestId, {
      department: out.department.code, bill_no: out.billNo, net: out.net,
    });
    res.json({
      request_id: out.requestId,
      status: out.status,
      bill: fullBill(out.billId),
      shortfalls: out.shortfalls,
    });
  })
);

// Match a free-text line to a catalogue product before dispensing.
router.put(
  '/requests/:id/items/:itemId',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const item = db
      .prepare('SELECT * FROM department_request_items WHERE id = ? AND request_id = ?')
      .get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Line not found' });
    const request = db.prepare('SELECT status FROM department_requests WHERE id = ?').get(req.params.id);
    if (request.status !== 'received') {
      return res.status(409).json({ error: 'This slip has already been dispensed.' });
    }
    const b = req.body || {};
    const product = b.product_id
      ? db.prepare('SELECT * FROM products WHERE id = ?').get(b.product_id)
      : null;
    if (b.product_id && !product) return res.status(404).json({ error: 'Product not found' });

    const uom = pk.UOMS.includes(b.uom) ? b.uom : item.uom;
    const qty = b.quantity != null
      ? (product ? pk.toBaseUnits(product, b.quantity, uom) : Number(b.quantity))
      : item.qty_requested;

    db.prepare(
      'UPDATE department_request_items SET product_id = ?, uom = ?, qty_requested = ?, label = ? WHERE id = ?'
    ).run(product ? product.id : item.product_id, uom, qty, b.label ?? item.label, item.id);
    res.json(db.prepare('SELECT * FROM department_request_items WHERE id = ?').get(item.id));
  })
);

router.post(
  '/requests/:id/cancel',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const r = db.prepare('SELECT * FROM department_requests WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'received') {
      return res.status(409).json({ error: 'Only an un-dispensed slip can be cancelled.' });
    }
    db.prepare("UPDATE department_requests SET status = 'cancelled' WHERE id = ?").run(r.id);
    audit(req, 'department.request.cancel', 'department_request', r.id, { reason: req.body?.reason });
    res.json({ ok: true });
  })
);

// What this department has been invoiced, and what is still outstanding.
// Becomes a proper ledger account in Phase 04; until then it reads the bills.
router.get(
  '/:id/statement',
  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Department not found' });
    const bills = db
      .prepare(
        `SELECT b.id, b.bill_no, b.created_at, b.net_amount, b.paid_amount, b.status,
                r.request_no, r.patient_name
           FROM bills b LEFT JOIN department_requests r ON r.bill_id = b.id
          WHERE b.department_id = ? ORDER BY b.created_at DESC LIMIT 200`
      )
      .all(d.id);
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(net_amount),0) AS invoiced,
                COALESCE(SUM(paid_amount),0) AS paid
           FROM bills WHERE department_id = ?`
      )
      .get(d.id);
    res.json({ department: d, bills, ...totals, outstanding: pk.round2(totals.invoiced - totals.paid) });
  })
);

module.exports = router;
