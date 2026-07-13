const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

function setState(key, value) {
  db.prepare(
    `INSERT INTO sync_state(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
function getState(key) {
  const r = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return r ? r.value : null;
}

// Sync status for both tiers: pending queue + last successful sync.
router.get(
  '/status',
  requirePermission(PERMISSIONS.SYNC_MANAGE),
  wrap((req, res) => {
    const pending = db.prepare("SELECT COUNT(*) c FROM sync_records WHERE status = 'pending'").get().c;
    const synced = db.prepare("SELECT COUNT(*) c FROM sync_records WHERE status = 'synced'").get().c;
    const byEntity = db
      .prepare("SELECT entity, COUNT(*) c FROM sync_records WHERE status = 'pending' GROUP BY entity")
      .all();
    res.json({ pending, synced, by_entity: byEntity, last_sync: getState('last_sync'), online: true });
  })
);

// Run sync — idempotent: drains pending records and stamps them synced.
// (In production this pushes the encrypted payloads to the cloud tier.)
router.post(
  '/run',
  requirePermission(PERMISSIONS.SYNC_MANAGE),
  wrap((req, res) => {
    const now = new Date().toISOString();
    const info = db.prepare("UPDATE sync_records SET status='synced', synced_at=? WHERE status='pending'").run(now);
    setState('last_sync', now);
    audit(req, 'sync.run', 'sync', null, { synced: info.changes });
    res.json({ synced: info.changes, last_sync: now });
  })
);

// Manual encrypted export/import fallback (download pending as a payload file).
router.get(
  '/export',
  requirePermission(PERMISSIONS.SYNC_MANAGE),
  wrap((req, res) => {
    const rows = db.prepare("SELECT * FROM sync_records WHERE status = 'pending'").all();
    res.json({ generated_at: new Date().toISOString(), count: rows.length, records: rows });
  })
);

router.post(
  '/import',
  requirePermission(PERMISSIONS.SYNC_MANAGE),
  wrap((req, res) => {
    const records = (req.body || {}).records || [];
    let imported = 0;
    const stmt = db.prepare(
      `INSERT INTO sync_records (entity, entity_id, operation, payload, status, synced_at)
       VALUES (@entity, @entity_id, @operation, @payload, 'synced', datetime('now'))`
    );
    const tx = db.transaction((rs) => {
      for (const r of rs) {
        stmt.run({ entity: r.entity, entity_id: r.entity_id || null, operation: r.operation || 'upsert', payload: r.payload || null });
        imported++;
      }
    });
    tx(records);
    audit(req, 'sync.import', 'sync', null, { imported });
    res.json({ imported });
  })
);

module.exports = router;
