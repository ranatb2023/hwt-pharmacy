const express = require('express');
const { db } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap } = require('../utils');
const { businessDate } = require('../businessDay');
const { postCashIfOpen, openSessionFor } = require('./cashflow');
const L = require('../ledger');

const router = express.Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// Customer credit — who owes what, and settling it.
// ---------------------------------------------------------------------------

const ACCOUNT_SELECT = `
  SELECT a.*, p.name, p.contact, p.cnic, p.party_type, p.customer_id, p.vendor_id
    FROM ledger_accounts a JOIN parties p ON p.id = a.party_id`;

// Everyone with an account, searchable by mobile first — an account here is
// looked up by phone, not by a code anybody memorises.
router.get(
  '/accounts',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    const kind = req.query.kind || null;
    const owing = req.query.owing === '1';
    const like = `%${q}%`;

    const rows = db
      .prepare(
        `${ACCOUNT_SELECT}
          WHERE a.is_active = 1
            AND (:kind IS NULL OR a.ledger_kind = :kind)
            AND (:owing = 0 OR a.balance > 0)
            AND (:q = '' OR p.contact LIKE :like OR p.name LIKE :like OR p.cnic LIKE :like)
          ORDER BY
            CASE WHEN p.contact = :q THEN 0 WHEN p.contact LIKE :prefix THEN 1 ELSE 2 END,
            a.balance DESC
          LIMIT 100`
      )
      .all({ kind, owing: owing ? 1 : 0, q, like, prefix: `${q}%` });
    res.json(rows);
  })
);

// Open (or find) an account for a customer. Called from the counter the moment
// someone asks to buy on credit.
router.post(
  '/accounts',
  requirePermission(PERMISSIONS.BILLING_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const kind = b.ledger_kind || 'customer-credit';
    if (!L.KINDS.includes(kind)) return res.status(400).json({ error: `Unknown account kind: ${kind}` });

    const out = db.transaction(() => {
      let party;
      if (b.customer_id) {
        const customer = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.customer_id);
        if (!customer) { const e = new Error('Customer not found'); e.status = 404; throw e; }
        party = L.partyFor({ customer });
      } else if (b.vendor_id) {
        const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(b.vendor_id);
        if (!vendor) { const e = new Error('Vendor not found'); e.status = 404; throw e; }
        party = L.partyFor({ vendor });
      } else {
        if (!b.name || !String(b.name).trim()) {
          const e = new Error('A name is required to open an account.');
          e.status = 400;
          throw e;
        }
        // An account with no way to reach the holder is a donation, not credit.
        if (!b.contact || !String(b.contact).trim()) {
          const e = new Error('A mobile number is required — it is how the account is looked up and how the money is chased.');
          e.status = 400;
          throw e;
        }
        party = L.partyFor({ name: b.name.trim(), contact: b.contact.trim(), cnic: b.cnic });
      }
      const acct = L.accountFor(party.id, kind, { credit_limit: b.credit_limit });
      if (b.credit_limit !== undefined) {
        db.prepare('UPDATE ledger_accounts SET credit_limit = ? WHERE id = ?')
          .run(b.credit_limit === '' || b.credit_limit == null ? null : Number(b.credit_limit), acct.id);
      }
      return acct.id;
    })();

    audit(req, 'ledger.account.open', 'ledger_account', out, { kind });
    res.status(201).json(db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(out));
  })
);

router.put(
  '/accounts/:id',
  requirePermission(PERMISSIONS.BILLING_MANAGE),
  wrap((req, res) => {
    const a = db.prepare('SELECT * FROM ledger_accounts WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Account not found' });
    const b = req.body || {};
    db.prepare('UPDATE ledger_accounts SET credit_limit = ?, is_active = ? WHERE id = ?')
      .run(
        b.credit_limit === '' || b.credit_limit == null ? null : Number(b.credit_limit),
        b.is_active != null ? (b.is_active ? 1 : 0) : a.is_active,
        a.id
      );
    audit(req, 'ledger.account.update', 'ledger_account', a.id, b);
    res.json(db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(a.id));
  })
);

// The statement, with a running balance and the aging behind it.
router.get(
  '/accounts/:id/statement',
  requirePermission(PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const st = L.statement(req.params.id, { from: req.query.from, to: req.query.to });
    if (!st) return res.status(404).json({ error: 'Account not found' });
    st.aging = L.aging(req.params.id);
    res.json(st);
  })
);

// Take money against an account. Oldest bill first, and the cash goes to the till
// NOW — categorised as a recovery so the day book can show it apart from today's
// sales. This is the "cleared" half of "payment withheld when cleared".
router.post(
  '/accounts/:id/settle',
  requirePermission(PERMISSIONS.CASH_MANAGE, PERMISSIONS.BILLING_MANAGE),
  wrap((req, res) => {
    const acct = db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(req.params.id);
    if (!acct) return res.status(404).json({ error: 'Account not found' });

    const amount = L.round2(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    if (amount > acct.balance + 0.001) {
      return res.status(400).json({
        error: `${acct.name} owes ${acct.balance}. Taking ${amount} would leave the account in credit — record an advance separately if that is intended.`,
        code: 'OVERPAYMENT',
        balance: acct.balance,
      });
    }

    const method = ['cash', 'card', 'online'].includes(req.body?.method) ? req.body.method : 'cash';

    // Settlement is the ONLY moment credit becomes cash, so it is the one moment
    // that must not fail quietly. `postCashIfOpen` is a no-op when the user has
    // no open till — which meant taking Rs 5,000 off a customer's balance while
    // the drawer never saw the Rs 5,000, and unlike a sale there is no bill left
    // behind to find it by.
    //
    // Refuse rather than lose it. The override exists because a site that does
    // not run till sessions at all would otherwise be unable to take a payment;
    // taking it is a decision, and the audit log records that it was made.
    const till = method === 'cash' ? openSessionFor(req.user.id) : null;
    if (method === 'cash' && !till && !req.body?.accept_no_till) {
      return res.status(409).json({
        error: 'No till is open, so this cash has nowhere to land. Open the till first, '
          + 'or record the payment anyway if this counter does not use till sessions.',
        code: 'TILL_NOT_OPEN',
        retry_with: { accept_no_till: true },
      });
    }

    const offTill = method === 'cash' && !till;
    const out = db.transaction(() => {
      const allocation = L.allocate(acct.id, amount);
      const entry = L.post(acct.id, {
        credit: amount,
        // An off-till payment says so on the statement. Someone reconciling a
        // day that does not add up needs to see which receipts never reached a
        // drawer, and the ledger is the only record of them.
        narration: req.body?.note
          || `Payment received (${method}${offTill ? ', no till open' : ''})`,
        reference: req.body?.reference || null,
        user_id: req.user.id,
      });
      // Cash reaches the drawer at settlement, never at the sale.
      postCashIfOpen(req.user.id, amount, 'credit-recovery', `CREDIT-${acct.id}`, method);
      return { entry, allocation };
    })();

    audit(req, 'ledger.settle', 'ledger_account', acct.id, {
      amount, method, off_till: offTill ? 1 : 0, session_id: till ? till.id : null,
    });
    res.json({
      account: db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(acct.id),
      applied_to: out.allocation.cleared,
      unapplied: out.allocation.unapplied,
      entry: out.entry,
    });
  })
);

// A correction, or an opening balance. Append-only means the way to fix a wrong
// entry is another entry, never an edit.
router.post(
  '/accounts/:id/adjust',
  requirePermission(PERMISSIONS.BILLING_OVERRIDE),
  wrap((req, res) => {
    const acct = db.prepare('SELECT * FROM ledger_accounts WHERE id = ?').get(req.params.id);
    if (!acct) return res.status(404).json({ error: 'Account not found' });
    const b = req.body || {};
    if (!b.narration) return res.status(400).json({ error: 'Say why — an unexplained adjustment is indistinguishable from a mistake.' });
    const entry = db.transaction(() => L.post(acct.id, {
      debit: Number(b.debit || 0),
      credit: Number(b.credit || 0),
      narration: b.narration,
      user_id: req.user.id,
    }))();
    audit(req, 'ledger.adjust', 'ledger_account', acct.id, b);
    res.json({ entry, account: db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(acct.id) });
  })
);

module.exports = router;
