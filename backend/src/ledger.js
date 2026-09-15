// The party ledger: customer credit, staff recovery, vendor payables, department
// accounts — one spine, one set of arithmetic.
//
// THE RULE THIS EXISTS TO ENFORCE
//
//   A credit sale must not post cash.
//
// Revenue is recognised when the medicine is handed over; cash is recognised
// when it is actually paid. If a credit sale pushes money into the till, the
// drawer can never be reconciled and every day-end variance becomes unexplainable
// — which is the whole reason the client asked for "payment withheld when
// cleared" in the first place.
//
// The balance column on ledger_accounts is a CACHE. It is written inside the
// same transaction as the entry that changed it, and `recompute()` can rebuild
// it from the entries at any time. The entries are the truth; the column is a
// convenience so a list of two hundred parties does not become two hundred
// SUM queries.
const { db } = require('./db');
const { businessDate } = require('./businessDay');

const KINDS = ['customer-credit', 'dialysis-demand', 'staff', 'vendor', 'department'];

// SIGN CONVENTION — read this before adding a kind.
//
// `balance` is what is OUTSTANDING on the account, in that account's own
// direction. `ledger_kind` says which direction that is:
//
//   customer-credit / staff / department / dialysis-demand -> they owe us
//   vendor                                                -> we owe them
//
// Either way a debit RAISES the outstanding amount and a credit CLEARS it, so
// aging, oldest-first allocation and the statement are one piece of arithmetic
// rather than four. The alternative — signing vendors negative — would print
// "Rs -45,000" on a payables screen and make every aging bucket need a special
// case.
//
// The one thing this costs: a report that sums across kinds is meaningless.
// `/reports/receivables` therefore excludes 'vendor' unless asked for it by
// name.

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

// A party is looked up by what it already is — a customer record, a vendor, a
// user — so the same person can never end up with two accounts of one kind.
function partyFor({ customer, vendor, user, party_type, name, contact, cnic }) {
  if (customer) {
    const found = db.prepare('SELECT * FROM parties WHERE customer_id = ?').get(customer.id);
    if (found) return found;
    const type = customer.customer_type === 'department' ? 'department'
      : customer.customer_type === 'staff' || customer.category === 'Staff' ? 'staff'
        : 'customer';
    const info = db
      .prepare('INSERT INTO parties (party_type, name, contact, cnic, customer_id) VALUES (?, ?, ?, ?, ?)')
      .run(type, customer.full_name, customer.contact || null, customer.cnic || null, customer.id);
    return db.prepare('SELECT * FROM parties WHERE id = ?').get(info.lastInsertRowid);
  }
  if (vendor) {
    const found = db.prepare('SELECT * FROM parties WHERE vendor_id = ?').get(vendor.id);
    if (found) return found;
    const info = db
      .prepare('INSERT INTO parties (party_type, name, contact, vendor_id) VALUES (?, ?, ?, ?)')
      .run('vendor', vendor.name, vendor.contact || null, vendor.id);
    return db.prepare('SELECT * FROM parties WHERE id = ?').get(info.lastInsertRowid);
  }
  if (user) {
    const found = db.prepare('SELECT * FROM parties WHERE user_id = ?').get(user.id);
    if (found) return found;
    const info = db
      .prepare('INSERT INTO parties (party_type, name, user_id) VALUES (?, ?, ?)')
      .run('staff', user.full_name, user.id);
    return db.prepare('SELECT * FROM parties WHERE id = ?').get(info.lastInsertRowid);
  }
  // A walk-in who wants credit. Name and mobile are the minimum: an account with
  // no way to contact the holder is a donation.
  const info = db
    .prepare('INSERT INTO parties (party_type, name, contact, cnic) VALUES (?, ?, ?, ?)')
    .run(party_type || 'customer', name, contact || null, cnic || null);
  return db.prepare('SELECT * FROM parties WHERE id = ?').get(info.lastInsertRowid);
}

// The account of a given kind for a party. A person can hold several — their own
// credit account and, if they are a dialysis patient, the unit's demand account — and
// those must never be added together.
function accountFor(partyId, kind = 'customer-credit', opts = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown ledger kind: ${kind}`);
  const found = db
    .prepare('SELECT * FROM ledger_accounts WHERE party_id = ? AND ledger_kind = ?')
    .get(partyId, kind);
  if (found) return found;
  const info = db
    .prepare('INSERT INTO ledger_accounts (party_id, ledger_kind, credit_limit) VALUES (?, ?, ?)')
    .run(partyId, kind, opts.credit_limit ?? null);
  return db.prepare('SELECT * FROM ledger_accounts WHERE id = ?').get(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

// One entry, and the cached balance moved by the same amount in the same
// statement pair. Callers must already be inside a transaction — a ledger entry
// that survives while the bill it belongs to rolls back is worse than no ledger.
function post(accountId, { debit = 0, credit = 0, narration, reference, bill_id, user_id, entry_date }) {
  const d = round2(debit);
  const c = round2(credit);
  if (d < 0 || c < 0) throw new Error('Ledger amounts cannot be negative — post the opposite side instead.');
  if (d === 0 && c === 0) return null;

  const info = db
    .prepare(
      `INSERT INTO ledger_entries
         (account_id, entry_date, bill_id, reference, narration, debit, credit, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(accountId, entry_date || businessDate(), bill_id || null, reference || null,
      narration || null, d, c, user_id || null);

  db.prepare('UPDATE ledger_accounts SET balance = round(balance + ? - ?, 2) WHERE id = ?')
    .run(d, c, accountId);

  return db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(info.lastInsertRowid);
}

// Rebuild a cached balance from the entries. The entries are the truth; this is
// how you prove the cache has not drifted, and how you repair it if it has.
function recompute(accountId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS bal FROM ledger_entries WHERE account_id = ?')
    .get(accountId);
  const bal = round2(row.bal);
  db.prepare('UPDATE ledger_accounts SET balance = ? WHERE id = ?').run(bal, accountId);
  return bal;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// The page handed across the counter when someone asks what they owe: every
// movement with a running balance, oldest first so it reads like a passbook.
function statement(accountId, { from, to } = {}) {
  const account = db
    .prepare(
      `SELECT a.*, p.name, p.contact, p.cnic, p.party_type
         FROM ledger_accounts a JOIN parties p ON p.id = a.party_id
        WHERE a.id = ?`
    )
    .get(accountId);
  if (!account) return null;

  // Anything before the window is compressed into one opening figure, so a
  // statement for "this month" still starts from the right number.
  const opening = from
    ? round2(
      db.prepare(
        'SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS b FROM ledger_entries WHERE account_id = ? AND entry_date < ?'
      ).get(accountId, from).b
    )
    : 0;

  const rows = db
    .prepare(
      `SELECT e.*, b.bill_no
         FROM ledger_entries e LEFT JOIN bills b ON b.id = e.bill_id
        WHERE e.account_id = ?
          AND (? IS NULL OR e.entry_date >= ?)
          AND (? IS NULL OR e.entry_date <= ?)
        ORDER BY e.entry_date, e.id`
    )
    .all(accountId, from || null, from || null, to || null, to || null);

  let running = opening;
  for (const r of rows) {
    running = round2(running + r.debit - r.credit);
    r.balance = running;
  }
  return { account, opening, entries: rows, closing: running };
}

// What is still owed, and for how long. Distributors here work on 30-day terms,
// so the buckets mirror what the owner already has in mind.
function aging(accountId) {
  const today = businessDate();
  const rows = db
    .prepare(
      `SELECT entry_date, debit, credit FROM ledger_entries
        WHERE account_id = ? ORDER BY entry_date, id`
    )
    .all(accountId);

  // Settle oldest-first against the debits, then age whatever remains by the
  // date of the debit it came from. Ageing the net balance by "today" would make
  // every account look current the moment a part payment arrived.
  const open = [];
  for (const r of rows) {
    if (r.debit > 0) open.push({ date: r.entry_date, left: r.debit });
    let pay = r.credit;
    while (pay > 0 && open.length) {
      const take = Math.min(pay, open[0].left);
      open[0].left = round2(open[0].left - take);
      pay = round2(pay - take);
      if (open[0].left <= 0) open.shift();
    }
  }

  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  const day = 86400000;
  for (const o of open) {
    const age = Math.floor((new Date(today) - new Date(o.date)) / day);
    if (age <= 30) buckets.current = round2(buckets.current + o.left);
    else if (age <= 60) buckets.d30 = round2(buckets.d30 + o.left);
    else if (age <= 90) buckets.d60 = round2(buckets.d60 + o.left);
    else buckets.d90 = round2(buckets.d90 + o.left);
  }
  buckets.total = round2(Object.values(buckets).reduce((a, b) => a + b, 0));
  buckets.oldest = open.length ? open[0].date : null;
  return buckets;
}

// Settle a payment against the oldest outstanding first. Returns what it cleared
// so the receipt can name the bills rather than just an amount.
function allocate(accountId, amount) {
  const rows = db
    .prepare(
      `SELECT e.id, e.entry_date, e.debit, e.credit, e.reference, b.bill_no
         FROM ledger_entries e LEFT JOIN bills b ON b.id = e.bill_id
        WHERE e.account_id = ? ORDER BY e.entry_date, e.id`
    )
    .all(accountId);

  const open = [];
  for (const r of rows) {
    if (r.debit > 0) open.push({ ref: r.bill_no || r.reference, date: r.entry_date, left: r.debit });
    let pay = r.credit;
    while (pay > 0 && open.length) {
      const take = Math.min(pay, open[0].left);
      open[0].left = round2(open[0].left - take);
      pay = round2(pay - take);
      if (open[0].left <= 0) open.shift();
    }
  }

  let left = round2(amount);
  const cleared = [];
  for (const o of open) {
    if (left <= 0) break;
    const take = Math.min(left, o.left);
    cleared.push({ ref: o.ref, date: o.date, applied: round2(take), fully: take >= o.left });
    left = round2(left - take);
  }
  return { cleared, unapplied: round2(left) };
}

module.exports = {
  KINDS, partyFor, accountFor, post, recompute, statement, aging, allocate, round2,
};
