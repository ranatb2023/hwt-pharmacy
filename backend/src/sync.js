const { db } = require('./db');

const insertSync = db.prepare(
  `INSERT INTO sync_records (entity, entity_id, operation, payload)
   VALUES (@entity, @entity_id, @operation, @payload)`
);

// Queue a change for the cloud tier. Offline-first: this never blocks the
// operation; the sync engine drains the queue when connectivity is available.
function queueSync(entity, entityId, payload, operation = 'upsert') {
  try {
    insertSync.run({
      entity,
      entity_id: entityId != null ? String(entityId) : null,
      operation,
      payload: payload ? JSON.stringify(payload) : null,
    });
  } catch (err) {
    console.error('queueSync failed:', err.message);
  }
}

module.exports = { queueSync };
