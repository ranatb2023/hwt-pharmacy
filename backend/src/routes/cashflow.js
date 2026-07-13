const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

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

// Auto-post a cash receipt to the user's open till session, if any (FR-BIL-09).
// No-op for card/online payments or when the user has no open session.
function postCashIfOpen(userId, amount, category, reference, method = 'cash') {
  if (method !== 'cash' || !amount || amount <= 0) return;
  const session = db.prepare("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").get(userId);
  if (!session) return;
  db.prepare(
    `INSERT INTO cash_transactions (session_id, type, category, amount, reason, reference, user_id)
     VALUES (?, 'in', ?, ?, ?, ?, ?)`
  ).run(session.id, category || 'sale', amount, 'Auto-posted from billing', reference || null, userId);
}

// Current open session for this user (one till per user at a time).
router.get(
  '/current',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const session = db
      .prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(req.user.id);
    if (!session) return res.json({ session: null });
    session.summary = expectedCash(session);
    session.transactions = db
      .prepare('SELECT * FROM cash_transactions WHERE session_id = ? ORDER BY created_at DESC')
      .all(session.id);
    res.json({ session });
  })
);

// Open a counter session with opening float.
router.post(
  '/open',
  requirePermission(PERMISSIONS.CASH_MANAGE),
  wrap((req, res) => {
    const existing = db.prepare("SELECT 1 FROM cash_sessions WHERE user_id = ? AND status = 'open'").get(req.user.id);
    if (existing) return res.status(409).json({ error: 'You already have an open cash session' });
    const b = req.body || {};
    const info = db
      .prepare('INSERT INTO cash_sessions (counter, user_id, opening_float) VALUES (?, ?, ?)')
      .run(b.counter || 'Counter 1', req.user.id, Number(b.opening_float || 0));
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
    const { expected } = expectedCash(session);
    const variance = counted - expected;
    db.prepare(
      `UPDATE cash_sessions SET status='closed', closed_at=datetime('now'),
         expected_cash=?, counted_cash=?, variance=?, notes=?
       WHERE id = ?`
    ).run(expected, counted, variance, (req.body || {}).notes || null, session.id);
    audit(req, 'cash.close', 'cash_session', session.id, { expected, counted, variance });
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
