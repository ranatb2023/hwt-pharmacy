const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { db } = require('../db');

// Resolves the current user + role permissions from the bearer token.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.department, u.is_active,
                r.name AS role, r.permissions
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
      )
      .get(payload.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid or inactive user' });
    user.permissions = JSON.parse(user.permissions || '[]');
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Guards a route by permission key. Administrator implicitly passes.
function requirePermission(...keys) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    const ok = keys.some((k) => perms.includes(k));
    if (!ok) return res.status(403).json({ error: 'Permission denied', need: keys });
    next();
  };
}

module.exports = { authenticate, requirePermission };
