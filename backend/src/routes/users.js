const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS, ALL } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

router.get(
  '/roles',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const roles = db.prepare('SELECT * FROM roles ORDER BY name').all();
    roles.forEach((r) => (r.permissions = JSON.parse(r.permissions || '[]')));
    res.json({ roles, all_permissions: ALL });
  })
);

router.post(
  '/roles',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Role name required' });
    const perms = (b.permissions || []).filter((p) => ALL.includes(p));
    const info = db
      .prepare('INSERT INTO roles (name, description, permissions, is_system) VALUES (?, ?, ?, 0)')
      .run(b.name, b.description || null, JSON.stringify(perms));
    audit(req, 'role.create', 'role', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.get(
  '/',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.id, u.username, u.full_name, u.department, u.is_active, u.last_login, r.name AS role
           FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`
        )
        .all()
    );
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    if (!b.username || !b.password || !b.full_name || !b.role_id) {
      return res.status(400).json({ error: 'username, password, full_name, role_id required' });
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username);
    if (exists) return res.status(409).json({ error: 'Username already exists' });
    const hash = bcrypt.hashSync(b.password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (username, full_name, password_hash, role_id, department)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(b.username, b.full_name, hash, b.role_id, b.department || null);
    audit(req, 'user.create', 'user', info.lastInsertRowid, { username: b.username });
    res.status(201).json({ id: info.lastInsertRowid, username: b.username });
  })
);

// Deactivate without deleting historical activity.
router.put(
  '/:id/active',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const active = (req.body || {}).is_active ? 1 : 0;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active, req.params.id);
    audit(req, 'user.active', 'user', req.params.id, { active });
    res.json({ ok: true });
  })
);

module.exports = router;
