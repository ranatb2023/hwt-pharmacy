// Who physically carried the medicine away.
//
// ONE RECORD, THREE PLACES.
//
// This was captured three different ways before: `controlled_register.buyer_name`
// for narcotics, `department_requests.collected_by_name` for a department runner,
// and nothing at all for dialysis until the client asked for it —
//
//   "if someone else order the dialysis patient medicine then record the person
//    who has taken the medicine"
//
// Three half-implementations means three places to look when someone asks who
// collected a controlled drug last March, and three schemas to change when the
// answer needs a CNIC. `handovers` is the shared record; the older columns stay
// written so existing reports keep working, but this is the one to query.
const { db } = require('./db');

const CONTEXTS = ['sale', 'dialysis-demand', 'department'];

// Relations offered at the counter. Free text is still accepted — this is a
// convenience list, not a validation rule, because the real world produces
// "neighbour" and "rickshaw driver" often enough to matter.
const RELATIONS = [
  'Self', 'Son', 'Daughter', 'Spouse', 'Brother', 'Sister', 'Father', 'Mother',
  'Attendant', 'Ambulance staff', 'Other',
];

// Caller supplies the transaction. A handover that survives while the dispense
// it belongs to rolls back is a record of a collection that never happened.
function record({ context, ref_id, customer_id, taken_by, relation, cnic, contact, user_id }) {
  if (!CONTEXTS.includes(context)) throw new Error(`Unknown handover context: ${context}`);
  if (!taken_by || !String(taken_by).trim()) return null;
  const info = db
    .prepare(
      `INSERT INTO handovers (context, ref_id, customer_id, taken_by, relation, cnic, contact, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      context, ref_id || null, customer_id || null, String(taken_by).trim(),
      relation || null, cnic || null, contact || null, user_id || null
    );
  return db.prepare('SELECT * FROM handovers WHERE id = ?').get(info.lastInsertRowid);
}

function forRef(context, refId) {
  return db
    .prepare('SELECT * FROM handovers WHERE context = ? AND ref_id = ? ORDER BY id DESC')
    .all(context, refId);
}

function latest(context, refId) {
  return forRef(context, refId)[0] || null;
}

module.exports = { record, forRef, latest, CONTEXTS, RELATIONS };
