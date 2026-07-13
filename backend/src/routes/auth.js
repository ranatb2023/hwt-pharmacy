const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET, JWT_EXPIRES } = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();

router.post(
  '/login',
  wrap((req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = db
      .prepare(
        `SELECT u.*, r.name AS role, r.permissions
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.username = ?`
      )
      .get(username);

    if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    audit({ user }, 'auth.login', 'user', user.id);

    res.json({
      token,
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
  res.json({ user: req.user });
});

module.exports = router;
