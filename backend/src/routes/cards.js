const express = require('express');
const crypto = require('crypto');
const { db, nextSeq } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../permissions');
const { audit } = require('../audit');
const { wrap, pad } = require('../utils');
const { activeCard, ceilingUsed } = require('../billingRules');

const router = express.Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// Welfare cards.
//
// A card is a physical object the counter verifies: a number, a tier, an expiry
// and an approving authority. That is the difference between an entitlement the
// trust can audit and a word somebody typed on a record.
// ---------------------------------------------------------------------------

const STATUSES = ['active', 'suspended', 'expired'];

// --- Tiers -----------------------------------------------------------------

router.get(
  '/tiers',
  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const tiers = db.prepare('SELECT * FROM card_tiers ORDER BY sort_order, discount_pct DESC').all();
    const scopeStmt = db.prepare(
      `SELECT s.*, pt.name AS product_type
         FROM card_tier_scope s LEFT JOIN product_types pt ON pt.id = s.product_type_id
        WHERE s.tier_id = ?`
    );
    for (const t of tiers) {
      t.scope = scopeStmt.all(t.id);
      t.cards = db.prepare("SELECT COUNT(*) c FROM welfare_cards WHERE tier_id = ? AND status = 'active'").get(t.id).c;
    }
    res.json(tiers);
  })
);

router.put(
  '/tiers/:id',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const t = db.prepare('SELECT * FROM card_tiers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tier not found' });
    const b = req.body || {};
    const pct = b.discount_pct != null ? Number(b.discount_pct) : t.discount_pct;
    if (!(pct >= 0 && pct <= 1)) {
      return res.status(400).json({ error: 'Discount must be between 0 and 100%.' });
    }
    db.prepare(
      `UPDATE card_tiers SET name = ?, discount_pct = ?, monthly_ceiling = ?, is_active = ? WHERE id = ?`
    ).run(
      b.name ? b.name.trim() : t.name,
      pct,
      b.monthly_ceiling === '' || b.monthly_ceiling == null ? null : Number(b.monthly_ceiling),
      b.is_active != null ? (b.is_active ? 1 : 0) : t.is_active,
      t.id
    );
    audit(req, 'card_tier.update', 'card_tier', t.id, b);
    res.json(db.prepare('SELECT * FROM card_tiers WHERE id = ?').get(t.id));
  })
);

// Which product types a tier covers. Replaces the whole scope for that tier so
// the caller never has to reason about which individual rules to delete.
router.put(
  '/tiers/:id/scope',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const t = db.prepare('SELECT * FROM card_tiers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Tier not found' });
    const rules = Array.isArray(req.body?.scope) ? req.body.scope : [];
    db.transaction(() => {
      db.prepare('DELETE FROM card_tier_scope WHERE tier_id = ?').run(t.id);
      const ins = db.prepare(
        'INSERT INTO card_tier_scope (tier_id, product_type_id, item_type, covered) VALUES (?, ?, ?, ?)'
      );
      for (const r of rules) {
        ins.run(t.id, r.product_type_id || null, r.item_type || null, r.covered ? 1 : 0);
      }
    })();
    audit(req, 'card_tier.scope', 'card_tier', t.id, { rules: rules.length });
    res.json({ ok: true, rules: rules.length });
  })
);

router.get(
  '/funds',
  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM subsidy_funds WHERE is_active = 1 ORDER BY code').all());
  })
);

router.post(
  '/funds',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const code = (b.code || '').trim().toUpperCase();
    const name = (b.name || '').trim();
    if (!code || !name) return res.status(400).json({ error: 'Code and name are required' });
    if (db.prepare('SELECT id FROM subsidy_funds WHERE code = ?').get(code)) {
      return res.status(400).json({ error: `Fund "${code}" already exists` });
    }
    const info = db.prepare('INSERT INTO subsidy_funds (code, name) VALUES (?, ?)').run(code, name);
    audit(req, 'subsidy_fund.create', 'subsidy_fund', info.lastInsertRowid, { code, name });
    res.status(201).json(db.prepare('SELECT * FROM subsidy_funds WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.put(
  '/funds/:id',
  requirePermission(PERMISSIONS.USER_MANAGE),
  wrap((req, res) => {
    const f = db.prepare('SELECT * FROM subsidy_funds WHERE id = ?').get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Fund not found' });
    const b = req.body || {};
    db.prepare('UPDATE subsidy_funds SET name = ?, is_active = ? WHERE id = ?')
      .run(b.name ? b.name.trim() : f.name, b.is_active != null ? (b.is_active ? 1 : 0) : f.is_active, f.id);
    audit(req, 'subsidy_fund.update', 'subsidy_fund', f.id, b);
    res.json(db.prepare('SELECT * FROM subsidy_funds WHERE id = ?').get(f.id));
  })
);

// --- Cards -----------------------------------------------------------------

function cardView(row) {
  if (!row) return null;
  const out = { ...row };
  if (row.monthly_ceiling > 0) {
    out.ceiling_used = ceilingUsed(row.id);
    out.ceiling_left = Math.max(0, row.monthly_ceiling - out.ceiling_used);
  }
  out.is_expired = !!(row.valid_till && row.valid_till < new Date().toISOString().slice(0, 10));
  return out;
}

const CARD_SELECT = `
  SELECT c.*, c.customer_id AS customer_id,
         t.code AS tier_code, t.name AS tier_name, t.discount_pct, t.monthly_ceiling,
         p.patient_code, p.full_name, p.contact, p.cnic,
         f.code AS fund_code
    FROM welfare_cards c
    JOIN card_tiers t ON t.id = c.tier_id
    JOIN patients p ON p.id = c.customer_id
    LEFT JOIN subsidy_funds f ON f.id = c.fund_id`;

router.get(
  '/',
  requirePermission(PERMISSIONS.PATIENT_VIEW, PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const q = (req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = q
      ? db.prepare(`${CARD_SELECT} WHERE c.card_no LIKE ? OR p.full_name LIKE ? OR p.contact LIKE ?
                    ORDER BY c.created_at DESC LIMIT 100`).all(like, like, like)
      : db.prepare(`${CARD_SELECT} ORDER BY c.created_at DESC LIMIT 100`).all();
    res.json(rows.map(cardView));
  })
);

// Scanned or typed at the counter. Answers WHY a card is not usable rather than
// simply not applying a discount — a pharmacist who cannot explain the price to
// the customer in front of them will override it.
router.get(
  '/resolve/:key',
  requirePermission(PERMISSIONS.PHARMACY_SELL, PERMISSIONS.BILLING_VIEW),
  wrap((req, res) => {
    const key = String(req.params.key || '').trim();
    const row = db.prepare(`${CARD_SELECT} WHERE c.qr_token = ? OR c.card_no = ?`).get(key, key);
    if (!row) return res.status(404).json({ error: 'No card with that number.' });

    const card = cardView(row);
    if (card.status === 'suspended') {
      return res.status(409).json({
        error: `Card ${card.card_no} is suspended. It cannot be used until an administrator reinstates it.`,
        code: 'CARD_SUSPENDED', card,
      });
    }
    if (card.is_expired) {
      return res.status(409).json({
        error: `Card ${card.card_no} expired on ${card.valid_till}. The sale can continue at full price.`,
        code: 'CARD_EXPIRED', card,
      });
    }
    res.json(card);
  })
);

router.get(
  '/customer/:customerId',
  requirePermission(PERMISSIONS.PATIENT_VIEW),
  wrap((req, res) => {
    const rows = db.prepare(`${CARD_SELECT} WHERE c.customer_id = ? ORDER BY c.created_at DESC`)
      .all(req.params.customerId);
    res.json(rows.map(cardView));
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.PATIENT_MANAGE),
  wrap((req, res) => {
    const b = req.body || {};
    const customer = db.prepare('SELECT * FROM patients WHERE id = ?').get(b.customer_id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (customer.customer_type === 'department') {
      return res.status(400).json({ error: 'A department cannot hold a welfare card.' });
    }
    const tier = db.prepare('SELECT * FROM card_tiers WHERE id = ?').get(b.tier_id);
    if (!tier) return res.status(404).json({ error: 'Tier not found' });

    // One live card per customer: two active cards would make "which discount
    // applies" a question with no answer at the counter.
    const existing = activeCard(customer.id);
    if (existing && !existing.expired) {
      return res.status(409).json({
        error: `${customer.full_name} already holds card ${existing.card_no}. Suspend it before issuing another.`,
        code: 'CARD_EXISTS',
      });
    }

    const out = db.transaction(() => {
      const no = `HWC-${pad(nextSeq('welfare_card'), 5)}`;
      const info = db
        .prepare(
          `INSERT INTO welfare_cards
             (card_no, customer_id, tier_id, fund_id, issued_on, valid_till, approved_by,
              qr_token, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          no, customer.id, tier.id, b.fund_id || null,
          b.issued_on || new Date().toISOString().slice(0, 10),
          b.valid_till || null, b.approved_by || null,
          crypto.randomBytes(16).toString('hex'),
          b.notes || null, req.user.id
        );
      return info.lastInsertRowid;
    })();

    audit(req, 'card.issue', 'welfare_card', out, { customer: customer.full_name, tier: tier.code });
    res.status(201).json(cardView(db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(out)));
  })
);

router.put(
  '/:id',
  requirePermission(PERMISSIONS.PATIENT_MANAGE),
  wrap((req, res) => {
    const card = db.prepare('SELECT * FROM welfare_cards WHERE id = ?').get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const b = req.body || {};
    if (b.status && !STATUSES.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    db.prepare(
      `UPDATE welfare_cards SET tier_id = ?, fund_id = ?, valid_till = ?, approved_by = ?,
         status = ?, notes = ? WHERE id = ?`
    ).run(
      b.tier_id || card.tier_id,
      b.fund_id !== undefined ? (b.fund_id || null) : card.fund_id,
      b.valid_till !== undefined ? (b.valid_till || null) : card.valid_till,
      b.approved_by ?? card.approved_by,
      b.status || card.status,
      b.notes ?? card.notes,
      card.id
    );
    audit(req, 'card.update', 'welfare_card', card.id, b);
    res.json(cardView(db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(card.id)));
  })
);

// What this card has actually been used for. The trust board asks; so does the
// card holder when they think they were charged wrongly.
router.get(
  '/:id/usage',
  requirePermission(PERMISSIONS.BILLING_VIEW, PERMISSIONS.REPORT_VIEW),
  wrap((req, res) => {
    const card = db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const bills = db
      .prepare(
        `SELECT id, bill_no, created_at, gross_amount, discount, subsidy, net_amount
           FROM bills WHERE welfare_card_id = ? ORDER BY created_at DESC LIMIT 200`
      )
      .all(card.id);
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS bills,
                COALESCE(SUM(discount),0) AS discount,
                COALESCE(SUM(subsidy),0)  AS subsidy,
                COALESCE(SUM(net_amount),0) AS paid
           FROM bills WHERE welfare_card_id = ?`
      )
      .get(card.id);
    res.json({ card: cardView(card), bills, ...totals, helped: totals.discount + totals.subsidy });
  })
);

module.exports = router;
