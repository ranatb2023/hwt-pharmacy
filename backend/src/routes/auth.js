const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET, JWT_EXPIRES } = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const { getSettings } = require('../settings');

const router = express.Router();

// S2-12: failed sign-ins are recorded, slowed down and, after five in a row,
// locked out for a quarter of an hour. Counter accounts are short PINs on a
// LAN; without this a brute-force run is a few seconds of work and leaves no
// trace. An administrator can lift a lock early (POST /users/:id/unlock).
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const WINDOW_MINUTES = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recentFailures(username, ip) {
  return db
    .prepare(
      `SELECT COUNT(*) c FROM login_attempts
        WHERE ok = 0 AND created_at >= datetime('now', ?) AND (username = ? OR (ip IS NOT NULL AND ip = ?))`
    )
    .get(`-${WINDOW_MINUTES} minutes`, username, ip).c;
}

router.post(
  '/login',
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const ip = req.ip || null;

    const user = db
      .prepare(
        `SELECT u.*, r.name AS role, r.permissions
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.username = ?`
      )
      .get(username);

    // A locked account answers 423 without checking the password, so the lock
    // cannot be used as an oracle either.
    if (user && user.locked_until && user.locked_until > new Date().toISOString().slice(0, 19).replace('T', ' ')) {
      audit({ ip }, 'auth.login_blocked', 'user', user.id, { username, ip, locked_until: user.locked_until });
      return res.status(423).json({
        error: `This account is locked after repeated failed sign-ins. Try again after ${user.locked_until} UTC, or ask an administrator to unlock it.`,
        code: 'ACCOUNT_LOCKED', retry_after: user.locked_until,
      });
    }

    if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
      db.prepare('INSERT INTO login_attempts (username, ip, ok) VALUES (?, ?, 0)').run(username, ip);
      const fails = recentFailures(username, ip);
      let locked = null;
      if (user) {
        const n = (user.failed_logins || 0) + 1;
        locked = n >= LOCK_AFTER
          ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString().slice(0, 19).replace('T', ' ')
          : null;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(n, locked, user.id);
        if (locked) audit({ ip }, 'auth.lockout', 'user', user.id, { username, ip, failures: n, locked_until: locked });
      }
      audit({ ip }, 'auth.login_failed', 'user', user ? user.id : null, { username, ip, recent_failures: fails });
      // Exponential backoff per username / IP: 250ms, 500ms, 1s … capped at 8s.
      await sleep(Math.min(8000, 250 * 2 ** Math.max(0, fails - 1)));
      if (locked) {
        return res.status(423).json({ error: 'Too many failed sign-ins — this account is locked for 15 minutes.', code: 'ACCOUNT_LOCKED', retry_after: locked });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare('INSERT INTO login_attempts (username, ip, ok) VALUES (?, ?, 1)').run(username, ip);
    db.prepare("UPDATE users SET last_login = datetime('now'), failed_logins = 0, locked_until = NULL WHERE id = ?").run(user.id);
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    audit({ user }, 'auth.login', 'user', user.id);

    res.json({
      token,
      config: publicConfig(),
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        department: user.department,
        permissions: JSON.parse(user.permissions || '[]'),
      },
    });
  })
);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user, config: publicConfig() });
});

// The shape the app runs in, returned with the identity so the frontend renders
// the right shell on first paint instead of flashing hospital modules that a
// standalone pharmacy install does not have. Deliberately not the whole
// settings object — no pricing or discount rules leak to non-billing users.
function publicConfig() {
  const s = getSettings();
  return {
    deployment_mode: s.deployment_mode,
    pharmacy_name: s.pharmacy_name,
    pharmacy_license_no: s.pharmacy_license_no,
    pharmacy_address: s.pharmacy_address,
    pharmacy_contact: s.pharmacy_contact,
    counter_discount_pct: s.counter_discount_pct,
    near_expiry_days: s.near_expiry_days,
  };
}

module.exports = router;
