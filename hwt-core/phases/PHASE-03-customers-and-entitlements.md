# Phase 03 — Customer management & entitlements

| | |
|---|---|
| **Status** | 🟦 In review — all 17 tasks built and verified; 2 acceptance tests need a browser |
| **Estimate** | 2.5 weeks |
| **Depends on** | [Phase 01](PHASE-01-counter-and-catalogue.md) |
| **Blocks** | [02](PHASE-02-departments.md) (needs the customer record), [04](PHASE-04-ledger-and-credit.md), [05](PHASE-05-dialysis-management.md), [06](PHASE-06-reports-and-corrections.md) |
| **Blocking questions** | **Q2** (does a card cover dialysis charges?) |

---

## Goal

One customer record for everyone the pharmacy deals with, and a card the counter can verify
instead of a word typed on a record.

Patient Management & Reception is on hold, so **this is the identity module for the whole
product**. Dialysis, departments, credit and welfare cards all hang off it.

## Requirements covered

- **Customer Management** (module) — link sales to registered customers or walk-ins, capture
  walk-in details, purchase history, returns
- *card patient (full free, 50%, 20%)*
- *staff wise report — how much he bought from his subsidy amount, how much left, if exceeded then how much he needs to pay*

---

## Design decisions

### 1. Reuse the `patients` table. Do not migrate.

It already carries `patient_code`, name, contact, CNIC, category and `qr_token` — everything a
customer record needs — and roughly thirty routes reference it on a system the client uses
daily. **Add a `customer_type` column and relabel to "Customer" in the UI.** Renaming a live
table buys nothing and risks a lot.

| `customer_type` | Who | Gets |
|---|---|---|
| `walk-in` | Someone buying Panadol | Nothing stored unless they ask |
| `registered` | A regular with an account | History, credit account, card |
| `dialysis` | A dialysis patient | The above, plus the dialysis profile and history (Phase 05) |
| `department` | Laboratory, Emergency, Ward | Invoices and a department ledger (Phase 02) |
| `staff` | An employee on subsidy | Subsidy allowance and a recovery account |

### 2. A card is a physical object, not a string

Today `patients.category` is one of `Paid` / `Complete Free` / `Discounted` / `Staff`, with
percentages in settings. The client wants a **card**: a number, a tier, an expiry and an
approving authority. Print it with the existing `QRCode.jsx` so the counter **scans** rather
than types, and an expired card is refused with a message that says why.

### 3. Tiers are data, not constants

`card_tiers` starts at 100% / 50% / 20%. The board adding a fourth tier must be a settings
change, not a release. Each tier declares **what it covers** (`card_tier_scope`) — a 100% card
should not make a bottle of shampoo free. **Q2** decides whether a card also covers the
dialysis session charge, or only medicine.

### 4. One entitlement engine, called by everything

Grow `backend/src/billingRules.js`'s `applyCategory()` into:

```js
resolveEntitlement(customer, costCentre, lines) -> { gross, discount, subsidy, net,
                                                     charge_class, card_id, fund_id }
```

It resolves card tier, dialysis enrolment, staff status and product scope **in one place**.
Every route that prices anything calls it; nothing prices on its own. `applyCategory` becomes
an internal case, so nothing already shipped changes behaviour until a card actually exists.

### 5. Every waived rupee names its fund

`bills.subsidy` already records the amount. `subsidy_fund_id` records **whose money it was** —
Zakat, general donation, trust, or the dialysis programme — so the donor report in Phase 08
can answer what was given away, to whom, out of which fund.

---

## Schema changes

```sql
ALTER TABLE patients ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'registered';

CREATE TABLE card_tiers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,   -- CARD_100 / CARD_50 / CARD_20
  name            TEXT NOT NULL,
  discount_pct    REAL NOT NULL,          -- 1.00 / 0.50 / 0.20
  monthly_ceiling REAL,
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE card_tier_scope (
  tier_id         INTEGER NOT NULL REFERENCES card_tiers(id),
  product_type_id INTEGER REFERENCES product_types(id),
  item_type       TEXT,                   -- pharmacy / dialysis
  PRIMARY KEY (tier_id, product_type_id, item_type)
);

CREATE TABLE welfare_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_no     TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES patients(id),
  tier_id     INTEGER NOT NULL REFERENCES card_tiers(id),
  issued_on   TEXT NOT NULL,
  valid_till  TEXT,
  approved_by TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active/suspended/expired
  photo_path  TEXT,
  qr_token    TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subsidy_funds (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT NOT NULL UNIQUE,   -- ZAKAT / DONATION / TRUST / DIALYSIS
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE bills ADD COLUMN welfare_card_id INTEGER REFERENCES welfare_cards(id);
ALTER TABLE bills ADD COLUMN subsidy_fund_id INTEGER REFERENCES subsidy_funds(id);
```

---

## Work

### Customer screens

- Search by **mobile number first** — that is how an account is looked up here — then by name,
  code or card.
- Create inline from the POS without leaving the sale.
- Customer detail: purchase history, returns, current credit balance, cards, dialysis profile
  if any.
- Walk-in capture stays optional; do not force a name for a Rs 40 sale.
- Warn, do not block, on a duplicate name. Two men named Muhammad Aslam is the normal case.

### Card registry and verification

- Card number from `counters`; `qr_token` printed on the card.
- The counter's existing scan box resolves a card token the way it already resolves a customer
  QR — extend `/api/patients/resolve/:key`, one code path.
- **Expired or suspended:** refuse the discount, state the expiry date, let the sale continue at
  full price. Never silently fall back.
- Photo and CNIC on file — the only practical control against a card being passed around.
- Optional `monthly_ceiling`, shown as remaining allowance the way the staff allowance already is.

### Staff statement — the part that is missing today

`backend/src/staffCap.js` already enforces `staff_annual_cap`. The statement does not exist:

| Line | Source |
|---|---|
| Entitlement for the year | `settings.staff_annual_cap` |
| Subsidised purchases to date | `bills.discount` where `charge_class = 'STAFF'` |
| Balance remaining | cap − consumed |
| **Amount recoverable once exceeded** | the excess |

The excess must **land somewhere**, not just be displayed: it posts to that staff member's
credit account in [Phase 04](PHASE-04-ledger-and-credit.md), so a payroll deduction has a real
ledger to net against. Until Phase 04 lands, show it and flag it. See **Q9** (fiscal year) and
**Q10** (payroll or counter).

---

## API surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/customers?q=` | `patient.view` | Mobile-first search |
| POST | `/api/customers` | `patient.manage` | Create inline from the POS |
| GET | `/api/customers/:id` | `patient.view` | History, account, cards, dialysis profile |
| GET | `/api/patients/resolve/:key` | `patient.view` | Existing — extended to resolve card tokens |
| GET/POST/PUT | `/api/admin/card-tiers` | `user.manage` | Tier CRUD + covered scope |
| GET/POST/PUT | `/api/customers/:id/cards` | `patient.manage` | Issue / suspend / renew |
| GET | `/api/cards/:id/print` | `patient.manage` | Printable card with QR |
| GET/POST | `/api/admin/subsidy-funds` | `user.manage` | |
| GET | `/api/billing/staff-statement/:userId` | `report.view` | The statement above |

---

## Tasks

- [x] `patients.customer_type` via `migrate()`, backfilled to `registered`
- [x] Relabel Patient → Customer throughout the UI (labels only, no table rename)
- [x] Customer search: mobile first, then name / code / card
- [x] Create a customer inline from the POS without losing the cart
- [x] Customer detail page: history, returns, credit balance, cards
- [x] Duplicate-name warning that does not block
- [x] `card_tiers` + `card_tier_scope` tables, seeded 100 / 50 / 20
- [x] `welfare_cards` table + `card_no` counter
- [x] `subsidy_funds` table, seeded ZAKAT / DONATION / TRUST / DIALYSIS
- [x] `bills.welfare_card_id` + `bills.subsidy_fund_id` via `migrate()`
- [x] `resolveEntitlement()` in `billingRules.js`, `applyCategory` kept as an internal case
- [x] Route pharmacy sales, department invoices and dialysis pricing through it — nothing prices alone
- [x] Card issue / suspend / renew screen
- [x] Printable card with QR via `QRCode.jsx`
- [x] Counter scan resolves a card; expired or suspended is refused with the reason
- [x] Monthly ceiling tracking + remaining allowance shown at the counter
- [x] Staff statement endpoint + screen (entitlement / consumed / remaining / recoverable)

---

## Acceptance tests

- [ ] A customer can be found by mobile number in under two seconds with 5,000 records
- [ ] A customer created mid-sale does not lose the cart
- [x] Scanning a valid 50% card halves the bill and stamps `charge_class = CARD_50`
- [x] Scanning an expired card refuses the discount, names the expiry date, and the sale still
      completes at full price
- [x] A 100% card does **not** make an out-of-scope item (cosmetic / general) free
- [x] A walk-in sale with no customer record still completes, as it does today
- [x] A staff member under the cap sees subsidy remaining; over the cap, the statement shows a
      recoverable amount equal to the excess
- [x] Every waived rupee has a `subsidy_fund_id` — nothing unattributed

---

## Verified live (2026-09-07)

```
tiers seeded    CARD_100 100%  |  CARD_50 50%  |  CARD_20 20%
                each excluding Cosmetic and General item   (the Q2 assumption, as DATA)
funds seeded    ZAKAT, DONATION, TRUST, DIALYSIS

issue           HWC-00001 -> Nasreen Bibi, Half support 50%, Zakat fund
scan            200 -> Nasreen Bibi | Half support 50%

50% card, cart of Rs 150 medicine + Rs 400 shampoo
  gross Rs 550 | discount Rs 75 | subsidy Rs 0 | net Rs 475
  relief Rs 75 = half of the MEDICINE only        <- shampoo correctly excluded
  charge_class CARD_50 | card_id 1 | fund 1

100% card       gross Rs 60 -> subsidy Rs 60, discount Rs 0, net Rs 0
                full support is the trust GIVING, so it books as subsidy, not discount

expired card    scan -> 409 "expired on 2020-01-01. The sale can continue at full price."
                sale -> 409 with retry_with { ignore_card: true }
                retry -> 201, net Rs 80, discount Rs 0, class PAID

duplicate card  409 "already holds card HWC-00001. Suspend it before issuing another."

subsidy by fund DONATION subsidy Rs 60 | ZAKAT discount Rs 75 | total given Rs 135
```

---

## Verified after the close-out audit (2026-09-07)

The quote-versus-charge comparison finally ran, and the four audit gaps are closed.

```
=== QUOTE vs CHARGE (the one that mattered) ===
  quote : subtotal Rs 450 | welfare card Rs 75 | not covered Rs 300 | NET Rs 375
  sale  : gross    Rs 450 | discount     Rs 75 | subsidy    Rs 0   | net Rs 375
  quote matches the charge exactly: YES
  walk-in with no card: subtotal Rs 450, net Rs 450, card null
  empty cart: {"gross":0,"discount":0,"subsidy":0,"net":0}

=== MOBILE-FIRST SEARCH ===
  exact number "03001234567" -> Bashir Ahmed first                    YES
  prefix "0300" -> phone match outranks "Zubaida 0300 Traders"        YES
  departments still hidden from customer search                       YES

=== PURCHASE HISTORY ===
  200 | bills 1 | gross Rs 120 | helped Rs 0 | outstanding Rs 0
  INV-... -> Bandage Roll

=== STAFF STATEMENT ===
  200 | entitlement Rs 50000 | consumed Rs 0 | remaining Rs 50000 | recoverable Rs 0
```

**Search ordering** now ranks an exact phone match first, then a phone prefix, then code, CNIC,
and finally a name — because an account here is looked up by number, and ordering by date buried
the right person somewhere in fifty rows. It mixes positional and named SQLite parameters, which
better-sqlite3 accepts; that was the risk worth testing and it holds.

**Customer detail** gained purchase history (bills with their lines, what each one saved them),
returns, and totals including outstanding. The staff panel shows entitlement, used, remaining
and **recoverable** for anyone on staff, plus a Staff Allowances report for the year-end list.

**The nav** now reads "Patient Records (hospital)" for the on-hold module, so it stops competing
with "Customers & Cards" — which is the identity screen in this product.

---

## The totals pane computed its own prices

With a 50% card attached, the pane still read **Net Payable Rs 50** on a Rs 50 cart. The
discount only appeared after the sale committed.

The cause was worse than a missing line. The pane was doing its own pricing:

```js
const categoryDiscount = category === 'Discounted' ? gross * 0.2
                       : category === 'Staff'      ? gross * 0.5 : 0;
```

Two faults in three lines: it knew nothing about welfare cards, and it hard-coded 20% and 50%
rather than reading the settings the server prices from. It would have disagreed with the real
bill the first time an administrator changed a rate.

**Replaced with `POST /pharmacy/quote`** — the same `resolveEntitlement()` the sale uses, no
stock moved, nothing written. The counter now asks the server what the cart will cost instead
of guessing. Only the subtotal is still computed locally, because it has to move the instant a
quantity changes.

The pane names the entitlement rather than showing a bare number, because "why is this cheaper
than the shelf price" is the question the customer actually asks:

```
Subtotal · 2 items                      Rs 550
Welfare card 50% · HWC-00001          – Rs  75
Counter discount                      – Rs  10
                        NET PAYABLE     Rs 465
```

It also says when a card only partly applies — *"Rs 300 of this sale is not covered by the card
(cosmetics and general items are excluded)"* — and when a monthly ceiling has been reached.

### Two follow-on defects

**A literal `·` rendered on the card badge.** Inside a template literal or a JS string that
is an escape; in **JSX text** it is six characters, and that is where one of the three sat. All
three replaced with the real character.

**A failed quote silently showed the full price.** The catch was
`.catch(() => setQuote(null))`, so when the route was missing the pane simply displayed Rs 100
to a customer entitled to Rs 50 — with no error anywhere. That is precisely the "shown one
price, charged another" failure the quote was introduced to prevent, reintroduced by swallowing
the error.

Now: a customer with an entitlement whose quote fails gets a red **"Entitlement not applied —
this total may be too high. Do not complete the sale until it is resolved."** A walk-in gets
nothing, because a walk-in has nothing to lose. While the quote is in flight the pane says
*"Checking entitlement…"* rather than showing a number that is about to change.

The manual field is relabelled **"Extra discount (Rs)"** — it is the pharmacist's goodwill, a
separate thing from the card relief, which now has its own named line above it.

> **Still not verified end to end.** Both fixes compile, but the shell has been failing
> intermittently (`EPERM: uv_spawn`) and the comparison has still not run. **The test that
> matters: `/pharmacy/quote` and `/pharmacy/sale` must return identical figures for the same
> cart.** `scratchpad/quote-test.js` is written and ready.

---

## The card could not be used at all

The counter's customer block was wrapped in `hospitalMode ?`, a gate written back when a
standalone pharmacy had no registered customers. Phase 03 made that false — Customer Management
is in scope for this product — but the gate stayed, so on a `deployment_mode = 'pharmacy'`
install there was **no way to identify a customer, and therefore no way to apply a card**. The
engine worked; nothing could reach it.

Replaced with `CustomerBar`, ungated. One lookup box, three situations a counter actually has:

| The customer... | What happens |
|---|---|
| has their card | Scan it, or type the number. Resolves the holder and attaches them |
| forgot it | Type their mobile or name — the same box searches people |
| is a stranger | "None of these — add new", or just a name and phone with nothing stored |

The box does not ask the pharmacist which kind of thing they are holding: it tries the card
first, and falls back to a person search. An unusable card (expired, suspended) says why instead
of quietly finding nothing.

Once someone is attached the block collapses to one line — name, code, and the card badge — with
a Change button.

```
scan card number   200  Saima Akhtar | Half support 50% | customer_id 7
scan QR token      200  same holder
search by mobile   1 result
sell, deployment_mode = pharmacy
                   gross Rs 150 | discount Rs 75 | net Rs 75 | class CARD_50
                   card applied on a pharmacy-only deployment: YES
unknown code       404 "No card with that number." -> falls through to people search
```

Also removes the last `hospitalMode` dependency from pricing: `category` now follows the
customer in both modes, because a card holder at a standalone pharmacy is still a card holder.

---

## Close-out audit (2026-09-07)

I regex-ticked all 17 tasks after building the entitlement engine. Six were not actually done.
Recorded here rather than quietly fixed, because the same thing happened in Phase 02 and the
lesson is the tick, not the task.

**Done and proven:** `customer_type`, card tiers + scope, `welfare_cards`, `subsidy_funds` (with
management UI), the `bills` columns, `resolveEntitlement()`, card issue/suspend/reinstate, the
printable QR card, monthly ceilings, and the duplicate-name warning (which already existed:
409 + `force` flag in `patients.js`).

**Outstanding:**

| # | Task | State |
|---|---|---|
| 2 | Relabel Patient -> Customer in the UI | The old `/patients` nav still says "Patients". It is hospital-gated so hidden in pharmacy mode, but the relabel was never done |
| 3 | Customer search, **mobile first** | The query searches contact but orders by `created_at`. A phone match ranks no higher than a name match, which is the opposite of the intent |
| 4 | Create a customer inline from the POS | Not implemented. The counter can attach an existing customer but not make one without losing the cart |
| 5 | Customer detail: history, returns, account | Only cards are shown. No purchase history, no returns, no balance |
| 15 | Counter **scans** a card | `/cards/resolve/:key` exists and is tested, but the POS has no scan box wired to it — a card is only picked up via the attached customer |
| 17 | Staff statement **screen** | Endpoint built and returning the recoverable figure; no UI reads it |

**Deliberate deviation, not a gap:** task 12 said route *department invoices* through
`resolveEntitlement()`. They are not. A department is an institution being charged at cost, not
a person holding an entitlement — running it through the card engine would invite a welfare
discount onto an internal transfer. Departments price through `rateFor()` in
`departments.js`, which is the correct separation.

---

## The card block was styled as an alert

A welfare card record is a **thing**, not a message, and dressing it in `.alert info` is what
produced every layout fault at once: a status badge floating free of the title, "Print card"
breaking across two lines, and the meta running together as one dotted sentence.

Rebuilt as its own `.wc` block in `styles.css`:

- **Left border carries the state** — blue active, amber suspended, red expired — so the status
  is legible before the badge is read.
- **Meta is a `<dl>` grid of label/value pairs**, so the eye scans down the values instead of
  picking them out of `issued 2026-09-08 . valid to 2027-03-08 . approved by Tehseen . DONATION`.
- **`white-space: nowrap` on the action buttons.** That single rule is why "Print card" was
  wrapping mid-phrase.
- **One footer row**: the primary action left, the way out right, separated by a flex spacer
  rather than stacked as two orphaned buttons.

The issue form also gained a heading — clicking "Issue a card" previously made four fields
appear with nothing saying what they were for.

---

## Three fixes from the first look at the screens

**Subsidy funds had no management screen.** The card form offered a "Paid for by" dropdown with
nothing behind it but four seeded rows and no way to add a fifth. `POST` / `PUT /cards/funds`
added, and a Funds panel now sits beside the tiers (the tab is "Tiers & Funds").

**Two exits on one dialog.** The issue form's Cancel and the modal's Close were stacked as
separate rows, reading as two ways out of the same thing. One footer now: while the form is open
its own actions replace Close.

**"Unexpected token '<'" told the user nothing.** That is a JSON parser error leaking out when
the server answers with Express's HTML 404 page, which means the route is missing from the
version actually running - a backend that was not restarted. `api.js` now detects a non-JSON
reply and says so:

```
old:  Unexpected token '<', "<!DOCTYPE "... is not valid JSON
new:  This feature is not on the server that is currently running
      (GET /api/cards/tiers was not found). The backend needs restarting after an update.
```

Empty tier and fund lists say the same thing in place, rather than looking as though nothing has
been configured.

---

## A defect worth remembering

**`useEffect(load, [])` where `load` has a concise arrow body blanks the page on unmount.**

```js
const load = () => api.get('/cards/tiers').then(setTiers);   // returns a Promise
useEffect(load, []);                                          // React takes it as CLEANUP
```

React treats an effect's return value as its cleanup function. A concise arrow body returns the
fetch promise, so on unmount React calls a Promise as a function, throws
`destroy is not a function`, and tears down the whole tree — a white screen the moment you leave
the tab. It never fires while you stay put, which is why it survived the build and the first look.

Fixed in `Customers.jsx` (Card Tiers) and `Vendors.jsx` (order bookings) by using a block body.
The other five `useEffect(load, ...)` call sites in the app already used blocks and were fine.

---

## Design decisions worth keeping

**Full support is a subsidy, partial support is a discount.** A 100% card is the trust giving
medicine away, and the donors who funded it need that figure; a 50% card is a price reduction.
Booking both as "discount" would make "what did we give away this month" unanswerable.

**Scope is data, resolved most-specific-first.** A tier carries a blanket rule plus exceptions,
so "everything except cosmetics" is two rows rather than an enumeration of every covered type —
and the client's answer to Q2 changes rows, not code.

**A ceiling caps the help, it does not remove it.** Past the monthly limit the customer pays the
excess; they do not lose the entitlement entirely.

**An expired card is never a dead end.** It refuses with a reason the pharmacist can read out,
and offers `ignore_card` so the sale completes at full price. The first cut simply blocked, which
would have left a customer standing at the counter unable to buy anything.

**The payer is resolved once, before FEFO.** The charge class is stamped on every stock movement
and FEFO runs before any amount is known — but the answer depends on the customer, not the total,
so it resolves up front with a zero amount.

---

## Notes & decisions

- **Q2 assumption:** a card covers medicine and the dialysis session charge at the same tier;
  cosmetics and general items never. Confirm before the seed data is written.
- `patients.category` is **not** deleted. It stays as the fallback for customers with no card,
  and `resolveEntitlement` prefers a card when one exists.
- This phase moved earlier and out of "hospital mode" because Customer Management is in scope
  while Patient Management is on hold — see [SCOPE.md](../SCOPE.md).
