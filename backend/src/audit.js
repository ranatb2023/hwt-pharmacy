const { db } = require('./db');

const insertAudit = db.prepare(
  `INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail, ip)
   VALUES (@user_id, @username, @action, @entity, @entity_id, @detail, @ip)`
);

// Records an auditable action. Never throws into the request path.
function audit(req, action, entity, entityId, detail) {
  try {
    insertAudit.run({
      user_id: req.user?.id || null,
      username: req.user?.username || null,
      action,
      entity: entity || null,
      entity_id: entityId != null ? String(entityId) : null,
      detail: detail ? JSON.stringify(detail) : null,
      ip: req.ip || null,
    });
  } catch (err) {
    console.error('audit failed:', err.message);
  }
}

module.exports = { audit };
