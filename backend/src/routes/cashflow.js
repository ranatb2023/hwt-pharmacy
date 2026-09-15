const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const { assertDayOpen } = require('../guards');

const router = express.Router();
router.use(authenticate);

// Expected cash = opening float + cash in − cash out.
function expectedCash(session) {
  const agg = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE 0 END),0) AS cin,
         COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE 0 END),0) AS cout
       FROM cash_transactions WHERE session_id = ?`
    )
    .get(session.id);
  return {
    cash_in: agg.cin,
    cash_out: agg.cout,
    expected: Number(session.opening_float) + agg.cin - agg.cout,
  };
}

// The user's open till, or undefined. Exported because "is there a drawer for
// this money to land in" is a question callers must be able to ask BEFORE they
// take the money — `postCashIfOpen` answering it silently afterwards is how cash
// goes missing.
function openSessionFor(userId) {
  return db
    .prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
    .get(userId);
}

// Auto-post a cash receipt to the user's open till session, if any (FR-BIL-09).
// No-op for card/online payments or when the user has no open session.
// Returns the session id the cash landed in, so the bill can record it.
function postCashIfOpen(userId, amount, category, reference, method = 'cash') {
  if (method !== 'cash' || !amount || amount <= 0) return null;
  const session = openSessionFor(userId);
  if (!session) return null;
  db.prepare(
    `INSERT INTO cash_transactions (session_id, type, category, amount, reason, reference, user_id)
     VALUES (?, 'in', ?, ?, ?, ?, ?)`
  ).run(session.id, category || 'sale', amount, 'Auto-posted from billing', reference || null, userId);
  return session.id;
}

// Cash OUT of a till — a refund (QA S2-06). Mirrors postCashIfOpen: the drawer
// ledger has to know about every rupee that leaves it, or the count at closing
// shows a variance nobody can explain.
function postCashOut(sessionId, amount, category, reference, reason, userId) {
  if (!amount || amount <= 0) return null;
  db.prepare(
    `INSERT INTO cash_transactions (session_id, type, category, amount, reason, reference, user_id)
     VALUES (?, 'out', ?, ?, ?, ?, ?)`
  ).run(sessionId, category || 'refund', amount, reason || null, reference || null, userId);
  return sessionId;
}

// Every open till, with its age. One counter, one drawer, one session (S2-07):
// the open route refuses a second session on a counter that already has one,
// and a session older than a day is flagged so it gets closed rather than
// forgotten with its float.
function openSessions() {
  return db
    .prepare(
      `SELECT cs.*, u.full_name AS user_name,
              ROUND((julianday('now') - julianday(cs.opened_at)) * 24, 1) AS age_hours
         FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
        WHERE cs.status = 'open' ORDER BY cs.opened_at ASC`
    )
    .all()
    .map((s) => ({ ...s, stale: s.age_hours >= 24 }));
}

// Current open session for this user (one till per user at a time).
router.get(
  '/current',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const session = db
      .prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(req.user.id);
    if (!session) return res.json({ session: null, others: openSessions() });
    session.summary = expectedCash(session);
    session.transactions = db
      .prepare('SELECT * FROM cash_transactions WHERE session_id = ? ORDER BY created_at DESC')
      .all(session.id);
    res.json({ session, others: openSessions().filter((s) => s.id !== session.id) });
  })
);

// Every open till on every counter (S2-07). An administrator sees the
// abandoned one from here and can force it closed.
router.get(
  '/open',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => res.json(openSessions()))
);

// Open a counter session with opening float.
router.post(
  '/open',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    assertDayOpen();
    const counter = String(b.counter || 'Counter 1').trim() || 'Counter 1';
    const openingFloat = Number(b.opening_float || 0);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) return res.status(400).json({ error: 'Opening float cannot be negative' });
    // Check and insert in one transaction: a double-click, or two tabs, could otherwise
    // slip a second session in between the two statements and leave the user with two
    // open tills — neither of which would then reconcile.
    let info;
    try {
      info = db.transaction(() => {
        const existing = db
          .prepare("SELECT 1 FROM cash_sessions WHERE user_id = ? AND status = 'open'")
          .get(req.user.id);
        if (existing) {
          const e = new Error('You already have an open cash session');
          e.status = 409; e.code = 'SESSION_OPEN';
          throw e;
        }
        // One drawer, one session (S2-07). Two cashiers on one physical
        // counter would each count the same notes against different floats.
        const holder = db
          .prepare(`SELECT cs.id, cs.opened_at, u.full_name FROM cash_sessions cs JOIN users u ON u.id = cs.user_id
                     WHERE cs.counter = ? AND cs.status = 'open'`)
          .get(counter);
        if (holder) {
          const e = new Error(`${counter} already has an open till (${holder.full_name}, since ${holder.opened_at}). Close it first, or open a different counter.`);
          e.status = 409; e.code = 'COUNTER_IN_USE'; e.holder = holder;
          throw e;
        }
        return db
          .prepare('INSERT INTO cash_sessions (counter, user_id, opening_float) VALUES (?, ?, ?)')
          .run(counter, req.user.id, openingFloat);
      })();
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message, code: err.code, holder: err.holder });
      throw err;
    }
    audit(req, 'cash.open', 'cash_session', info.lastInsertRowid, { float: b.opening_float });
    res.status(201).json(db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(info.lastInsertRowid));
  })
);

// Record a cash movement (petty cash, expense, misc in/out).
router.post(
  '/transaction',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    assertDayOpen();
    const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'").get(b.session_id);
    if (!session) return res.status(400).json({ error: 'No open session' });
    if (session.user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    const amount = Number(b.amount || 0);
    if (amount <= 0) return res.status(400).json({ error: 'Positive amount required' });
    if (!['in', 'out'].includes(b.type)) return res.status(400).json({ error: 'type must be in/out' });
    db.prepare(
      `INSERT INTO cash_transactions (session_id, type, category, amount, reason, reference, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(session.id, b.type, b.category || 'misc', amount, b.reason || null, b.reference || null, req.user.id);
    audit(req, 'cash.transaction', 'cash_session', session.id, { type: b.type, amount });
    const s = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id);
    s.summary = expectedCash(s);
    res.json(s);
  })
);

// Close & reconcile against counted cash.
router.post(
  '/:id/close',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'").get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Open session not found' });
    if (session.user_id !== req.user.id && !req.user.permissions.includes(PERMISSIONS.USER_MANAGE)) {
      return res.status(403).json({ error: 'Not your session' });
    }
    const counted = Number((req.body || {}).counted_cash || 0);
    // S3-17: a drawer cannot hold a negative amount of cash.
    if (!Number.isFinite(counted) || counted < 0) return res.status(400).json({ error: 'Counted cash cannot be negative', code: 'NEGATIVE_COUNT' });
    // Sum the till and close it in ONE transaction. Read-then-write leaves a window in
    // which another tab's sale auto-posts cash (postCashIfOpen) after the total is taken
    // but before the session is marked closed: that cash stays in the ledger, is excluded
    // from expected_cash, and the day shows a phantom variance nobody can explain. The
    // day-end report has to tie to the drawer, so this cannot be racy.
    const { expected, variance } = db.transaction(() => {
      const fresh = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'").get(session.id);
      if (!fresh) {
        const e = new Error('Session was closed by someone else');
        e.status = 409;
        throw e;
      }
      const exp = expectedCash(fresh).expected;
      const varc = counted - exp;
      db.prepare(
        `UPDATE cash_sessions SET status='closed', closed_at=datetime('now'),
           expected_cash=?, counted_cash=?, variance=?, notes=?, closed_by=?
         WHERE id = ? AND status = 'open'`
      ).run(exp, counted, varc, (req.body || {}).notes || null, req.user.id, fresh.id);
      return { expected: exp, variance: varc };
    })();
    audit(req, 'cash.close', 'cash_session', session.id, { expected, counted, variance });
    res.json(db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id));
  })
);

// An administrator closes someone else's abandoned till (S2-07). No count is
// possible — the cashier is gone — so counted and variance stay NULL, the
// session is marked force-closed with the reason, and the audit trail says
// who did it. The day-end sheet shows it as "not counted".
router.post(
  '/:id/force-close',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to force-close a till', code: 'REASON_REQUIRED' });
    const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'").get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Open session not found' });
    const exp = expectedCash(session).expected;
    db.prepare(
      `UPDATE cash_sessions SET status='closed', closed_at=datetime('now'), expected_cash=?,
         counted_cash=NULL, variance=NULL, force_closed=1, closed_by=?, notes=?
       WHERE id = ? AND status = 'open'`
    ).run(exp, req.user.id, `FORCE CLOSED by ${req.user.full_name}: ${reason}`, session.id);
    audit(req, 'cash.force_close', 'cash_session', session.id, { reason, expected: exp, owner: session.user_id });
    res.json(db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id));
  })
);

// Recent sessions (daily cash position).
router.get(
  '/sessions',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT cs.*, u.full_name AS user_name FROM cash_sessions cs
         JOIN users u ON u.id = cs.user_id ORDER BY cs.opened_at DESC LIMIT 50`
      )
      .all();
    res.json(rows);
  })
);

module.exports = router;
module.exports.postCashIfOpen = postCashIfOpen;
module.exports.postCashOut = postCashOut;
module.exports.openSessionFor = openSessionFor;
module.exports.openSessions = openSessions;
