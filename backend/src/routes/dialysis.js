const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { resolveEntitlement } = require('../billingRules');
const { newBillNo, wrap } = require('../utils');
const { consumeFEFO, paidStatus } = require('./pharmacy');
const { getSetting } = require('../settings');
const { newPatientCode, newQrToken } = require('../utils');
const { businessDate } = require('../businessDay');
const D = require('../dialysisDemand');
const L = require('../ledger');

const router = express.Router();
router.use(authenticate);

// --- Stations ---
router.get(
  '/stations',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => res.json(db.prepare('SELECT * FROM dialysis_stations WHERE is_active = 1 ORDER BY name').all()))
);

router.post(
  '/stations',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    if (!req.body?.name) return res.status(400).json({ error: 'Station name required' });
    const info = db.prepare('INSERT INTO dialysis_stations (name) VALUES (?)').run(req.body.name);
    res.status(201).json(db.prepare('SELECT * FROM dialysis_stations WHERE id = ?').get(info.lastInsertRowid));
  })
);

// --- Sessions list (optionally by date) ---
router.get(
  '/sessions',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const date = req.query.date;
    const base = `SELECT s.*, p.full_name, p.patient_code, p.category, st.name AS station_name, u.full_name AS staff_name
                  FROM dialysis_sessions s
                  JOIN patients p ON p.id = s.patient_id
                  LEFT JOIN dialysis_stations st ON st.id = s.station_id
                  LEFT JOIN users u ON u.id = s.staff_id`;
    const rows = date
      ? db.prepare(`${base} WHERE date(s.scheduled_at) = ? ORDER BY s.scheduled_at`).all(date)
      : db.prepare(`${base} ORDER BY s.scheduled_at DESC LIMIT 100`).all();
    res.json(rows);
  })
);

// --- Schedule (conflict check on station + time window) ---
router.post(
  '/sessions',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.patient_id || !b.scheduled_at) return res.status(400).json({ error: 'patient_id and scheduled_at required' });
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Avoid double-booking a station at the same scheduled time.
    if (b.station_id) {
      const clash = db
        .prepare(
          `SELECT 1 FROM dialysis_sessions
           WHERE station_id = ? AND scheduled_at = ? AND status != 'cancelled'`
        )
        .get(b.station_id, b.scheduled_at);
      if (clash) return res.status(409).json({ error: 'Station already booked for that time' });
    }

    const info = db
      .prepare(
        `INSERT INTO dialysis_sessions (patient_id, station_id, staff_id, scheduled_at, duration_min, base_charge, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(b.patient_id, b.station_id || null, b.staff_id || req.user.id, b.scheduled_at, b.duration_min || 240,
           b.base_charge != null ? Number(b.base_charge) : Number(getSetting('dialysis_charge')), b.notes || null, req.user.id);
    audit(req, 'dialysis.schedule', 'dialysis_session', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM dialysis_sessions WHERE id = ?').get(info.lastInsertRowid));
  })
);

// --- Complete a session ----------------------------------------------------
//
// ONE BILLING PATH. This route predates Phase 05 and used to deduct its own
// consumables and raise its own bill, which meant a session that had already
// been demanded, issued and billed could be billed AGAIN here — two invoices for
// one session and the stock deducted twice, with the second bill never reaching
// the dialysis ledger.
//
// Everything now goes through the demand: it is the record that knows what left
// the shelf, which batch it came from and who collected it. A session completed
// with consumables typed directly raises a demand behind the scenes and issues
// it, so there is no second way for stock to move.
router.post(
  '/sessions/:id/complete',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const session = db.prepare('SELECT * FROM dialysis_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'Session already completed', code: 'ALREADY_COMPLETED' });
    }
    const b = req.body || {};
    const consumables = (b.consumables || []).filter((c) => c.product_id && c.quantity > 0);

    // A demand already raised against this session is the authority on what was
    // used. Typing consumables here as well would double-count them.
    const existing = db
      .prepare("SELECT * FROM dialysis_demands WHERE session_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1")
      .get(session.id);
    if (existing && consumables.length) {
      return res.status(409).json({
        error: `${existing.demand_no} already records what this session used. `
          + 'Add anything else to that demand rather than typing it here.',
        code: 'DEMAND_EXISTS',
        demand_no: existing.demand_no,
        demand_id: existing.id,
      });
    }

    const out = db.transaction(() => {
      db.prepare(
        `UPDATE dialysis_sessions SET status = 'completed', pre_vitals = ?, post_vitals = ?, notes = ?
          WHERE id = ?`
      ).run(
        b.pre_vitals ? JSON.stringify(b.pre_vitals) : session.pre_vitals,
        b.post_vitals ? JSON.stringify(b.post_vitals) : session.post_vitals,
        b.notes || session.notes,
        session.id
      );

      // Already billed through its demand: close the session and stop.
      if (existing && existing.status === 'billed') {
        return { billed: false, reason: 'already billed on ' + existing.demand_no, demand_id: existing.id };
      }
      // Demanded but not yet issued — billing it here would charge for medicine
      // that has not left the shelf.
      if (existing && existing.status === 'demanded') {
        return { billed: false, reason: `${existing.demand_no} is still waiting to be issued`, demand_id: existing.id };
      }

      let demand = existing;
      if (!demand) {
        // No demand yet. Raise one from whatever was typed, so the session's
        // consumables are real rows that can be reported on rather than a JSON
        // blob nothing can query.
        const demandNo = D.nextDemandNo();
        const info = db
          .prepare(
            `INSERT INTO dialysis_demands
               (demand_no, session_id, customer_id, shift_id, demand_date, status, demanded_by, created_by)
             VALUES (?, ?, ?, ?, ?, 'demanded', ?, ?)`
          )
          .run(demandNo, session.id, session.patient_id, session.shift_id || null,
            String(session.scheduled_at).slice(0, 10), req.user.full_name || null, req.user.id);
        const id = info.lastInsertRowid;
        const ins = db.prepare(
          `INSERT INTO dialysis_demand_items (demand_id, product_id, label, qty_demanded, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        );
        consumables.forEach((c, i) => {
          const pr = db.prepare('SELECT name FROM products WHERE id = ?').get(c.product_id);
          if (!pr) { const e = new Error(`Product ${c.product_id} not found`); e.status = 400; throw e; }
          ins.run(id, c.product_id, pr.name, Math.max(0, parseInt(c.quantity, 10) || 0), i);
        });
        demand = db.prepare('SELECT * FROM dialysis_demands WHERE id = ?').get(id);
        D.issueDemand(demand, { consumeFEFO, userId: req.user.id, allowPartial: true });
        // Whoever completed the session is the one who handled the medicine.
        db.prepare(
          `INSERT INTO handovers (context, ref_id, customer_id, taken_by, relation, user_id)
           VALUES ('dialysis-demand', ?, ?, ?, 'Self', ?)`
        ).run(demand.id, session.patient_id, b.taken_by || 'Given during the session', req.user.id);
        demand = db.prepare('SELECT * FROM dialysis_demands WHERE id = ?').get(id);
      }

      const bill = D.billDemand(demand, { userId: req.user.id });
      return { billed: true, demand_id: demand.id, ...bill };
    })();

    audit(req, 'dialysis.complete', 'dialysis_session', session.id, out);
    res.json({ ...out, session: db.prepare('SELECT * FROM dialysis_sessions WHERE id = ?').get(session.id) });
  })
);

// --- Period activity report ---
router.get(
  '/report',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '2999-12-31';
    const rows = db
      .prepare(
        `SELECT p.category, COUNT(*) AS sessions,
                COALESCE(SUM(b.gross_amount),0) AS gross,
                COALESCE(SUM(b.subsidy),0) AS subsidy,
                COALESCE(SUM(b.net_amount),0) AS net
         FROM dialysis_sessions s
         JOIN patients p ON p.id = s.patient_id
         LEFT JOIN bills b ON b.id = s.bill_id
         WHERE s.status = 'completed' AND date(s.scheduled_at) BETWEEN ? AND ?
         GROUP BY p.category`
      )
      .all(from, to);
    res.json(rows);
  })
);

// ===========================================================================
// PHASE 05 — the full module
// ===========================================================================

// --- Shifts (Q6) -----------------------------------------------------------
// The unit files by shift, so every dialysis screen and report groups by one.
router.get(
  '/shifts',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    res.json(db.prepare(
      'SELECT * FROM dialysis_shifts WHERE is_active = 1 ORDER BY sort_order, id'
    ).all());
  })
);

router.post(
  '/shifts',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Shift name is required' });
    const n = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM dialysis_shifts').get().n;
    const info = db
      .prepare('INSERT INTO dialysis_shifts (name, starts_at, ends_at, sort_order) VALUES (?, ?, ?, ?)')
      .run(b.name, b.starts_at || null, b.ends_at || null, b.sort_order != null ? b.sort_order : n);
    audit(req, 'dialysis.shift.create', 'dialysis_shift', info.lastInsertRowid, { name: b.name });
    res.status(201).json(db.prepare('SELECT * FROM dialysis_shifts WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.put(
  '/shifts/:id',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const cur = db.prepare('SELECT * FROM dialysis_shifts WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Shift not found' });
    const b = req.body || {};
    db.prepare(
      `UPDATE dialysis_shifts SET name = ?, starts_at = ?, ends_at = ?, sort_order = ?, is_active = ?
        WHERE id = ?`
    ).run(
      b.name ?? cur.name, b.starts_at ?? cur.starts_at, b.ends_at ?? cur.ends_at,
      b.sort_order ?? cur.sort_order,
      b.is_active != null ? (b.is_active ? 1 : 0) : cur.is_active, cur.id
    );
    audit(req, 'dialysis.shift.update', 'dialysis_shift', cur.id, { before: cur, after: b });
    res.json(db.prepare('SELECT * FROM dialysis_shifts WHERE id = ?').get(cur.id));
  })
);

// --- Patients --------------------------------------------------------------

// Register a dialysis patient.
//
// ONE STEP, because Patient Management is on hold: the unit cannot wait for a
// reception desk that does not exist. This creates the customer record and the
// clinical profile together, so there is never a profile without an identity or
// an identity the unit cannot find.
//
// THE PROGRAMME COVERS THE TREATMENT, NOT THE PERSON.
//
// The first cut of this registered the customer as 'Complete Free', which made
// everything free for them FOREVER — a dialysis patient could walk up to the
// counter and take shampoo for nothing. The entitlement belongs to the demand,
// not to the human being, so it is applied in `billDemand()` where the demand is
// priced. Here they stay an ordinary customer who happens to be enrolled.
//
// This is also the only reading under which the client's "dialysis demands and
// patient khata should be seperate" means anything: if everything they touched
// were free, they would never have a khata balance to keep separate.
router.post(
  '/patients',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.full_name) return res.status(400).json({ error: 'Patient name is required' });

    // An existing customer can be enrolled without becoming a second record —
    // the counter and the unit must see one person.
    let customer = b.customer_id
      ? db.prepare('SELECT * FROM patients WHERE id = ?').get(b.customer_id)
      : null;
    if (b.customer_id && !customer) return res.status(404).json({ error: 'Customer not found' });
    if (customer) {
      const already = db.prepare('SELECT * FROM dialysis_patients WHERE customer_id = ?').get(customer.id);
      if (already) {
        return res.status(409).json({
          error: `${customer.full_name} is already enrolled as ${already.reg_no}.`,
          code: 'ALREADY_ENROLLED',
          reg_no: already.reg_no,
        });
      }
    }

    const out = db.transaction(() => {
      if (!customer) {
        const code = newPatientCode();
        const info = db
          .prepare(
            `INSERT INTO patients
               (patient_code, full_name, gender, dob, age, contact, cnic, guardian_name,
                address, category, customer_type, qr_token, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dialysis', ?, ?)`
          )
          .run(
            code, b.full_name, b.gender || null, b.dob || null, b.age || null,
            b.contact || null, b.cnic || null, b.guardian_name || null, b.address || null,
            b.category || 'Paid', newQrToken(), req.user.id
          );
        customer = db.prepare('SELECT * FROM patients WHERE id = ?').get(info.lastInsertRowid);
      } else {
        // Enrolling someone already known marks them as a dialysis patient and
        // changes NOTHING else — not their category, not their card, not what
        // they pay at the counter.
        db.prepare("UPDATE patients SET customer_type = 'dialysis' WHERE id = ?").run(customer.id);
      }

      const regNo = D.nextRegNo();
      const info = db
        .prepare(
          `INSERT INTO dialysis_patients
             (customer_id, reg_no, enrolled_on, blood_group, access_type, diagnosis,
              hbsag, hcv, hiv, serology_date, dry_weight, sessions_per_week, fund_id,
              referring_dr, next_of_kin, next_of_kin_contact, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          customer.id, regNo, b.enrolled_on || businessDate(),
          b.blood_group || null, b.access_type || null, b.diagnosis || null,
          b.hbsag || null, b.hcv || null, b.hiv || null, b.serology_date || null,
          b.dry_weight != null ? Number(b.dry_weight) : null,
          b.sessions_per_week != null ? Number(b.sessions_per_week) : null,
          b.fund_id || D.dialysisFundId(),
          b.referring_dr || null, b.next_of_kin || null, b.next_of_kin_contact || null,
          b.notes || null
        );
      db.prepare('UPDATE patients SET dialysis_reg_no = ? WHERE id = ?').run(regNo, customer.id);
      return { id: info.lastInsertRowid, regNo, customerId: customer.id };
    })();

    audit(req, 'dialysis.patient.register', 'dialysis_patient', out.id, { reg_no: out.regNo });
    res.status(201).json(dialysisPatient(out.customerId));
  })
);

const PATIENT_SELECT = `
  SELECT dp.*, p.full_name, p.patient_code, p.contact, p.cnic, p.gender, p.age,
         p.address, p.guardian_name, p.category, f.name AS fund_name
    FROM dialysis_patients dp
    JOIN patients p ON p.id = dp.customer_id
    LEFT JOIN subsidy_funds f ON f.id = dp.fund_id`;

function dialysisPatient(customerId) {
  return db.prepare(`${PATIENT_SELECT} WHERE dp.customer_id = ?`).get(customerId);
}

// QA S2-11: serology is health data on a shared counter screen. Every list
// and record carries the OPERATIONAL fact — does this patient need the
// dedicated machine — and the underlying results only on an explicit,
// audited reveal by someone holding dialysis.serology.
const SEROLOGY_FIELDS = ['hbsag', 'hcv', 'hiv', 'serology_date'];
function isolationOf(row) {
  const pos = SEROLOGY_FIELDS.slice(0, 3).some((k) => row[k] && /pos/i.test(String(row[k])));
  const tested = SEROLOGY_FIELDS.slice(0, 3).some((k) => row[k]);
  return pos ? 'dedicated' : tested ? 'standard' : 'unknown';
}
function redactSerology(row) {
  if (!row) return row;
  row.isolation = isolationOf(row);
  for (const k of SEROLOGY_FIELDS) delete row[k];
  return row;
}

router.get(
  '/patients',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `${PATIENT_SELECT}
          WHERE (:q = '' OR p.full_name LIKE :like OR p.contact LIKE :like
                 OR dp.reg_no LIKE :like OR p.patient_code LIKE :like)
            AND (:all = 1 OR dp.status = 'active')
          ORDER BY dp.reg_no`
      )
      .all({ q, like, all: req.query.all === '1' ? 1 : 0 });
    res.json(rows.map(redactSerology));
  })
);

// The results themselves, on request, audited (QA S2-11).
router.post(
  '/patients/:id/serology-reveal',
  requirePermission(PERMISSIONS.DIALYSIS_SEROLOGY),
  wrap((req, res) => {
    const row = db.prepare('SELECT id, reg_no, hbsag, hcv, hiv, serology_date FROM dialysis_patients WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dialysis patient not found' });
    audit(req, 'dialysis.serology_reveal', 'dialysis_patient', row.id, { reg_no: row.reg_no });
    res.json({ id: row.id, hbsag: row.hbsag, hcv: row.hcv, hiv: row.hiv, serology_date: row.serology_date, isolation: isolationOf(row) });
  })
);

router.get(
  '/patients/:id',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const row = db.prepare(`${PATIENT_SELECT} WHERE dp.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dialysis patient not found' });
    res.json(redactSerology(row));
  })
);

router.put(
  '/patients/:id',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const cur = db.prepare('SELECT * FROM dialysis_patients WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Dialysis patient not found' });
    const b = req.body || {};
    // Serology is written only by someone allowed to see it; anyone else's
    // edit leaves the recorded results exactly as they are.
    if (!req.user.permissions.includes(PERMISSIONS.DIALYSIS_SEROLOGY)) for (const k of SEROLOGY_FIELDS) delete b[k];
    const keep = (k) => (b[k] !== undefined ? b[k] : cur[k]);
    db.prepare(
      `UPDATE dialysis_patients SET
         blood_group=@blood_group, access_type=@access_type, diagnosis=@diagnosis,
         hbsag=@hbsag, hcv=@hcv, hiv=@hiv, serology_date=@serology_date,
         dry_weight=@dry_weight, sessions_per_week=@sessions_per_week, fund_id=@fund_id,
         referring_dr=@referring_dr, next_of_kin=@next_of_kin,
         next_of_kin_contact=@next_of_kin_contact, status=@status, ended_on=@ended_on, notes=@notes
       WHERE id=@id`
    ).run({
      id: cur.id,
      blood_group: keep('blood_group'), access_type: keep('access_type'),
      diagnosis: keep('diagnosis'), hbsag: keep('hbsag'), hcv: keep('hcv'), hiv: keep('hiv'),
      serology_date: keep('serology_date'), dry_weight: keep('dry_weight'),
      sessions_per_week: keep('sessions_per_week'), fund_id: keep('fund_id'),
      referring_dr: keep('referring_dr'), next_of_kin: keep('next_of_kin'),
      next_of_kin_contact: keep('next_of_kin_contact'), status: keep('status'),
      ended_on: keep('ended_on'), notes: keep('notes'),
    });
    audit(req, 'dialysis.patient.update', 'dialysis_patient', cur.id, { before: cur, after: b });
    res.json(db.prepare(`${PATIENT_SELECT} WHERE dp.id = ?`).get(cur.id));
  })
);

// The history the unit consults before the next session, and prints for a
// referral. Sessions, vitals, what was consumed and what it cost — the JSON
// blob on `dialysis_sessions.consumables` could never answer the last one,
// which is why per-item dialysis consumption was invisible before this phase.
router.get(
  '/patients/:id/history',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const dp = db.prepare(`${PATIENT_SELECT} WHERE dp.id = ?`).get(req.params.id);
    if (!dp) return res.status(404).json({ error: 'Dialysis patient not found' });

    const sessions = db
      .prepare(
        `SELECT s.*, st.name AS station_name, sh.name AS shift_name,
                u.full_name AS staff_name, b.bill_no, b.gross_amount, b.subsidy, b.net_amount
           FROM dialysis_sessions s
           LEFT JOIN dialysis_stations st ON st.id = s.station_id
           LEFT JOIN dialysis_shifts sh ON sh.id = s.shift_id
           LEFT JOIN users u ON u.id = s.staff_id
           LEFT JOIN bills b ON b.id = s.bill_id
          WHERE s.patient_id = ?
          ORDER BY s.scheduled_at DESC`
      )
      .all(dp.customer_id);

    const demands = db
      .prepare(
        `SELECT d.id, d.demand_no, d.demand_date, d.status, d.total_cost, d.session_id,
                sh.name AS shift_name
           FROM dialysis_demands d
           LEFT JOIN dialysis_shifts sh ON sh.id = d.shift_id
          WHERE d.customer_id = ?
          ORDER BY d.demand_date DESC, d.id DESC`
      )
      .all(dp.customer_id);

    const itemStmt = db.prepare(
      `SELECT i.label, i.qty_demanded, i.qty_issued, i.unit_cost, i.line_total, i.is_emergency,
              pr.name AS product_name
         FROM dialysis_demand_items i
         LEFT JOIN products pr ON pr.id = i.product_id
        WHERE i.demand_id = ? AND i.qty_issued > 0
        ORDER BY i.sort_order, i.id`
    );
    for (const d of demands) d.items = itemStmt.all(d.id);

    // What the programme has spent on this patient, which is NOT what they owe.
    const party = db.prepare('SELECT id FROM parties WHERE customer_id = ?').get(dp.customer_id);
    const acct = party
      ? db.prepare("SELECT * FROM ledger_accounts WHERE party_id = ? AND ledger_kind = 'dialysis-demand'").get(party.id)
      : null;
    const own = party
      ? db.prepare("SELECT * FROM ledger_accounts WHERE party_id = ? AND ledger_kind = 'customer-credit'").get(party.id)
      : null;

    res.json({
      patient: dp,
      sessions,
      demands,
      totals: {
        sessions: sessions.filter((s) => s.status === 'completed').length,
        consumables_cost: D.round2(demands.reduce((t, d) => t + Number(d.total_cost || 0), 0)),
        // Two figures, never added together.
        programme_spend: acct ? acct.balance : 0,
        personally_owes: own ? own.balance : 0,
      },
    });
  })
);

// --- Recurring schedule ----------------------------------------------------

// Most patients come the same two or three days every week, so a weekly pattern
// is worth more than a calendar. Conflicts are REPORTED, not silently skipped:
// a nurse who asked for Mon/Wed/Fri and got Mon/Fri would not notice.
router.post(
  '/schedule/recurring',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.patient_id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    const days = Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [];
    if (!days.length) return res.status(400).json({ error: 'Pick at least one weekday' });
    const weeks = Math.min(Math.max(parseInt(b.weeks, 10) || 4, 1), 26);
    const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '08:00';
    const from = b.from || businessDate();

    const start = new Date(`${from}T00:00:00`);
    const wanted = [];
    for (let w = 0; w < weeks; w++) {
      for (const d of days) {
        const dt = new Date(start);
        const delta = (d - start.getDay() + 7) % 7;
        dt.setDate(start.getDate() + delta + w * 7);
        wanted.push(`${dt.toISOString().slice(0, 10)}T${time}`);
      }
    }
    wanted.sort();

    const clashStmt = db.prepare(
      `SELECT s.id, p.full_name FROM dialysis_sessions s JOIN patients p ON p.id = s.patient_id
        WHERE s.station_id = ? AND s.scheduled_at = ? AND s.status != 'cancelled'`
    );
    const existsStmt = db.prepare(
      "SELECT 1 FROM dialysis_sessions WHERE patient_id = ? AND scheduled_at = ? AND status != 'cancelled'"
    );
    const ins = db.prepare(
      `INSERT INTO dialysis_sessions
         (patient_id, station_id, staff_id, shift_id, scheduled_at, duration_min, base_charge, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const created = [];
    const skipped = [];
    db.transaction(() => {
      for (const at of wanted) {
        if (existsStmt.get(patient.id, at)) { skipped.push({ at, why: 'already scheduled' }); continue; }
        if (b.station_id) {
          const clash = clashStmt.get(b.station_id, at);
          if (clash) { skipped.push({ at, why: `station busy — ${clash.full_name}` }); continue; }
        }
        const info = ins.run(
          patient.id, b.station_id || null, b.staff_id || null, b.shift_id || null, at,
          b.duration_min || 240,
          b.base_charge != null ? Number(b.base_charge) : Number(getSetting('dialysis_charge')),
          req.user.id
        );
        created.push({ id: info.lastInsertRowid, at });
      }
    })();

    audit(req, 'dialysis.schedule.recurring', 'patient', patient.id,
      { created: created.length, skipped: skipped.length });
    res.status(201).json({ created, skipped, requested: wanted.length });
  })
);

// --- The demand form -------------------------------------------------------

// The template, as the nurse reads it: two columns, the paper's own order.
router.get(
  '/template',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW),
  wrap((req, res) => {
    const t = db.prepare('SELECT * FROM demand_templates WHERE is_active = 1 ORDER BY id LIMIT 1').get();
    if (!t) return res.json(null);
    const items = db
      .prepare(
        'SELECT * FROM demand_template_items WHERE template_id = ? AND is_active = 1 ORDER BY column_no, sort_order'
      )
      .all(t.id);
    const prodStmt = db.prepare(
      `SELECT p.id, p.name, p.unit, p.sale_price, tp.is_default,
              (SELECT COALESCE(SUM(quantity),0) FROM stock_batches sb
                WHERE sb.product_id = p.id AND sb.quarantined = 0) AS on_hand
         FROM demand_template_item_products tp
         JOIN products p ON p.id = tp.product_id
        WHERE tp.item_id = ?
        ORDER BY tp.is_default DESC, p.name`
    );
    for (const it of items) it.products = prodStmt.all(it.id);
    res.json({ ...t, items });
  })
);

// Map a printed row to its SKUs (Q7). The single most valuable thing the unit
// in-charge can do before this goes live: an unmapped row cannot be deducted.
router.put(
  '/template/items/:id',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const it = db.prepare('SELECT * FROM demand_template_items WHERE id = ?').get(req.params.id);
    if (!it) return res.status(404).json({ error: 'Template row not found' });
    const b = req.body || {};
    db.transaction(() => {
      db.prepare(
        `UPDATE demand_template_items
            SET printed_label = ?, column_no = ?, sort_order = ?, is_freetext = ?,
                is_emergency = ?, is_active = ?
          WHERE id = ?`
      ).run(
        b.printed_label ?? it.printed_label,
        b.column_no ?? it.column_no,
        b.sort_order ?? it.sort_order,
        b.is_freetext != null ? (b.is_freetext ? 1 : 0) : it.is_freetext,
        b.is_emergency != null ? (b.is_emergency ? 1 : 0) : it.is_emergency,
        b.is_active != null ? (b.is_active ? 1 : 0) : it.is_active,
        it.id
      );
      if (Array.isArray(b.product_ids)) {
        db.prepare('DELETE FROM demand_template_item_products WHERE item_id = ?').run(it.id);
        const ins = db.prepare(
          'INSERT OR IGNORE INTO demand_template_item_products (item_id, product_id, is_default) VALUES (?, ?, ?)'
        );
        b.product_ids.forEach((pid, i) => ins.run(it.id, pid, pid === b.default_product_id || (b.default_product_id == null && i === 0) ? 1 : 0));
      }
    })();
    audit(req, 'dialysis.template.update', 'demand_template_item', it.id, { after: b });
    res.json({ ok: true });
  })
);

// Create a demand. NO STOCK MOVES — that is the whole reason demand and issue
// are separate steps.
router.post(
  '/demands',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.customer_id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    const rows = (b.items || []).filter((i) => Number(i.qty_demanded) > 0);
    if (!rows.length) return res.status(400).json({ error: 'Write a quantity against at least one row' });

    const out = db.transaction(() => {
      const demandNo = D.nextDemandNo();
      const info = db
        .prepare(
          `INSERT INTO dialysis_demands
             (demand_no, session_id, customer_id, shift_id, demand_date, template_id,
              demanded_by, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          demandNo, b.session_id || null, patient.id, b.shift_id || null,
          b.demand_date || businessDate(), b.template_id || null,
          b.demanded_by || req.user.full_name || null, b.notes || null, req.user.id
        );
      const id = info.lastInsertRowid;
      const ins = db.prepare(
        `INSERT INTO dialysis_demand_items
           (demand_id, template_item_id, product_id, label, qty_demanded, is_emergency, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      rows.forEach((r, i) => ins.run(
        id, r.template_item_id || null, r.product_id || null,
        r.label || null, Math.max(0, parseInt(r.qty_demanded, 10) || 0),
        r.is_emergency ? 1 : 0, i
      ));
      return { id, demandNo };
    })();

    audit(req, 'dialysis.demand.create', 'dialysis_demand', out.id, { demand_no: out.demandNo });
    res.status(201).json(D.demandFull(out.id));
  })
);

// The pharmacy worklist, beside the department requests from Phase 02.
router.get(
  '/demands',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW, PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const status = req.query.status || null;
    const date = req.query.date || null;
    const rows = db
      .prepare(
        `${D.DEMAND_SELECT}
          WHERE (:status IS NULL OR d.status = :status)
            AND (:date IS NULL OR d.demand_date = :date)
            AND (:customer IS NULL OR d.customer_id = :customer)
          ORDER BY d.demand_date DESC, d.id DESC
          LIMIT 200`
      )
      .all({ status, date, customer: req.query.customer_id || null });
    res.json(rows);
  })
);

router.get(
  '/demands/:id',
  requirePermission(PERMISSIONS.DIALYSIS_VIEW, PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const d = D.demandFull(req.params.id);
    if (!d) return res.status(404).json({ error: 'Demand not found' });
    res.json(d);
  })
);

// Issue — the pharmacy's signature on the paper. FEFO happens here.
router.post(
  '/demands/:id/issue',
  requirePermission(PERMISSIONS.PHARMACY_DISPENSE),
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM dialysis_demands WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Demand not found' });
    if (d.status !== 'demanded') {
      return res.status(409).json({
        error: `${d.demand_no} is already ${d.status}. A demand is issued once.`,
        code: 'ALREADY_ISSUED',
      });
    }
    const b = req.body || {};
    // Who carried it away. The client asked for this by name, and a relative
    // collecting for a patient should carry the same audit weight as a
    // controlled-drug sale.
    if (!b.taken_by) {
      return res.status(400).json({
        error: 'Record who is collecting the medicine before issuing it.',
        code: 'HANDOVER_REQUIRED',
      });
    }

    const out = db.transaction(() => {
      const r = D.issueDemand(d, {
        consumeFEFO, userId: req.user.id,
        allowPartial: b.allow_partial !== false,
      });
      db.prepare(
        `INSERT INTO handovers (context, ref_id, customer_id, taken_by, relation, cnic, contact, user_id)
         VALUES ('dialysis-demand', ?, ?, ?, ?, ?, ?, ?)`
      ).run(d.id, d.customer_id, b.taken_by, b.relation || null, b.cnic || null,
        b.contact || null, req.user.id);
      return r;
    })();

    audit(req, 'dialysis.demand.issue', 'dialysis_demand', d.id,
      { demand_no: d.demand_no, total: out.total, short: out.short });
    res.json(D.demandFull(d.id));
  })
);

// Bill — one invoice: base charge + consumables + emergency, on the same paper.
router.post(
  '/demands/:id/bill',
  requirePermission(PERMISSIONS.BILLING_MANAGE),
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM dialysis_demands WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Demand not found' });
    if (d.status === 'billed') {
      return res.status(409).json({ error: `${d.demand_no} is already billed.`, code: 'ALREADY_BILLED' });
    }
    if (d.status === 'demanded') {
      return res.status(409).json({
        error: 'Issue the medicine before billing it — nothing has left the shelf yet.',
        code: 'NOT_ISSUED',
      });
    }
    const out = db.transaction(() => D.billDemand(d, { userId: req.user.id }))();
    audit(req, 'dialysis.demand.bill', 'dialysis_demand', d.id, out);
    res.json({ ...out, demand: D.demandFull(d.id) });
  })
);

router.post(
  '/demands/:id/cancel',
  requirePermission(PERMISSIONS.DIALYSIS_MANAGE),
  wrap((req, res) => {
    const d = db.prepare('SELECT * FROM dialysis_demands WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Demand not found' });
    if (d.status !== 'demanded') {
      return res.status(409).json({
        error: `${d.demand_no} is ${d.status}; stock has already moved. Correct it with a return.`,
      });
    }
    db.prepare("UPDATE dialysis_demands SET status = 'cancelled' WHERE id = ?").run(d.id);
    audit(req, 'dialysis.demand.cancel', 'dialysis_demand', d.id, {});
    res.json({ ok: true });
  })
);

module.exports = router;
