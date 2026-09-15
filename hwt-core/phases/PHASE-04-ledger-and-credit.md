# Phase 04 — Party accounts & customer credit

| | |
|---|---|
| **Status** | 🟦 Built — 17 / 17 tasks, 9 / 9 acceptance tests verified live |
| **Estimate** | 2.5 weeks |
| **Depends on** | [Phase 02](PHASE-02-departments.md) |
| **Blocks** | [05](PHASE-05-dialysis-management.md), [06](PHASE-06-reports-and-corrections.md), [07](PHASE-07-cash-register.md) |
| **Blocking questions** | **Q4** (who gets credit, and is there a limit) |

---

## Goal

Replace the hand-written account with one that ages, prints and reconciles — and keep credit
out of the cash drawer so the till still balances at close.

## Requirements covered

- *udhaar khata (credit payment withheld when cleared)*
- *dialysis demands and patient khata should be seperate*
- *staff wise report … if exceeded then how much he needs to pay* (the recovery half)

---

## The rule that matters most

> **A credit sale must not post cash.**
>
> The pharmacy sale route currently calls `cashflow.postCashIfOpen` to push cash into the
> open till. A sale with `payment_method = 'credit'` must **skip that call**.
>
> Revenue is recognised at sale. Cash is recognised at settlement.
>
> This *is* the client's "payment withheld when cleared" requirement, stated as a rule.
> Without it the drawer can never be reconciled and [Phase 07](PHASE-07-cash-register.md) is
> pointless.

---

## Design decisions

### One ledger spine for five different things

`parties` + `ledger_accounts` + `ledger_entries`, where a party may be a patient, a walk-in
customer, a staff member, a department or a vendor. A credit sale posts a **debit**; a
settlement posts a **credit**; the balance is the sum of the entries.

`vendors.balance` already exists as a stored number. Keep it, but **as a cache updated inside
the same transaction as the entry** — never as the source of truth. A stored balance drifts
the first time a row is corrected, and Phase 06 will be correcting rows.

### Keyed on the mobile number

An account here is looked up by phone, not CNIC. Make `parties.contact` the primary indexed
search key, allow a party with no CNIC at all, and **warn rather than block** on a duplicate
name — two men named Muhammad Aslam is the normal case, not an error.

### Separate ledgers, same machinery

`UNIQUE (party_id, ledger_kind)` on `ledger_accounts` is what enforces the client's explicit
requirement:

| `ledger_kind` | What it is |
|---|---|
| `customer-credit` | Money this person owes |
| `dialysis-demand` | The unit's requisition against the trust's dialysis budget |
| `staff` | Subsidy excess to be recovered |
| `vendor` | Payables |
| `department` | Internal consumption charged to a cost centre |

A dialysis demand and a patient account are **two accounts, never netted, with separate
statements**. They can belong to the same person and still never touch.

### The sign convention — read before adding a kind

`balance` is what is **outstanding on the account, in that account's own direction**.
`ledger_kind` says which direction that is: a customer, staff member or department owes *us*;
a vendor is owed *by* us. Either way a debit raises the outstanding amount and a credit clears
it, so aging, oldest-first allocation and the statement are one piece of arithmetic rather
than four.

Signing vendors negative instead would print `Rs -45,000` on a payables screen and give every
aging bucket a special case. The price of this choice is that **a report summing across kinds
is meaningless** — which is why `/reports/receivables` excludes `vendor` unless asked for it
by name. That exclusion is the guard rail; do not remove it.

---

## Schema changes

See [DATABASE.md §3](../DATABASE.md#phase-04--party-accounts--credit-account). New: `parties`,
`ledger_accounts`, `ledger_entries` (append-only). Added: `bills.ledger_account_id`, and
`credit` as a value of `bills.payment_method`.

---

## Work

### Credit at the counter

- Choose or create a party by mobile number, inline, without leaving the sale.
- Show the current balance and the credit limit before the sale is completed.
- Complete with `payment_method = 'credit'`, `status = 'unpaid'`, `charge_class = 'CREDIT'`.
- Post one debit `ledger_entries` row in the **same transaction** as the bill.
- **Do not call `postCashIfOpen`.**

### Settlement

Pick a party → outstanding bills oldest first → part or full payment → receipt → **cash posts
to the open till on the settlement date**, categorised so the day book can show "credit
recovered today" separately from "sales today".

Partial settlement allocates oldest-first and leaves the remainder outstanding. Do not let a
settlement create a negative balance without an explicit advance-payment entry.

### Aging

0–30 / 31–60 / 61–90 / 90+. Distributors here work on 30-day terms; mirroring those buckets
means the receivables report reads the way the owner already thinks.

### The account statement

Printable, per party: date, bill number, narration, debit, credit, running balance, closing
balance. **This is the page handed across the counter when someone asks what they owe**, so
it must print cleanly on the thermal printer as well as on A4.

### Staff recovery

The excess over `staff_annual_cap`, computed in [Phase 03](PHASE-03-customers-and-entitlements.md), posts
as a debit to that staff member's `staff` account. Payroll deduction versus counter payment
is **Q10**.

---

## API surface

Built on `/api/ledger/accounts`, not `/api/parties`. A party can hold several accounts and
every operation here is *on one account*, so addressing a party and then selecting a kind with
`?kind=` would have made the account id implicit in two places. Parties are created as a side
effect of `accountFor()`; they are never addressed on their own.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/ledger/accounts?q=&kind=&owing=1` | `billing.view` | Type-ahead; exact mobile ranks above a name containing the same digits |
| POST | `/api/ledger/accounts` | `billing.manage` | Create inline from the counter |
| PUT | `/api/ledger/accounts/:id` | `billing.manage` | Credit limit, active flag |
| GET | `/api/ledger/accounts/:id/statement` | `billing.view` | Ledger with running balance + aging |
| POST | `/api/ledger/accounts/:id/settle` | `cash.manage` | Oldest-first allocation, posts cash to the open till |
| POST | `/api/ledger/accounts/:id/adjust` | `billing.manage` | Reversing entry; never an edit |
| GET | `/api/reports/receivables?kind=` | `report.view` | Aging 30/60/90 with mobile numbers; excludes vendors |
| GET | `/api/reports/credit-daybook?date=` | `report.view` | Credit given today vs recovered today, never netted |

---

## Tasks

- [x] `parties` table + index on `contact`
- [x] `ledger_accounts` table with `UNIQUE (party_id, ledger_kind)`
- [x] `ledger_entries` table (append-only) + index on `(account_id, entry_date)`
- [x] `bills.ledger_account_id` via `migrate()`; `credit` added to `payment_method`
- [x] Party search / create by mobile, inline in the POS
- [x] **Credit sale skips `postCashIfOpen`** — and a regression test proves it
- [x] Debit entry written in the same transaction as the bill
- [x] Credit limit shown at the counter; over-limit warns (Q4 decides warn vs block)
- [x] Settlement screen with oldest-first allocation
- [x] Settlement posts cash to the open till, categorised as recovery not sale
- [x] **Settlement refuses cash when no till is open**, with an off-till override
- [x] Printable account statement (thermal **and** A4)
- [x] Receivables report with 30/60/90 aging and contact numbers
- [x] Credit day-book: given today vs recovered today
- [x] Derive `vendors.balance` from the ledger; keep the column as a same-transaction cache
- [x] Migrate existing vendor balances into `ledger_entries` as opening balances
- [x] Staff excess from Phase 03 posts to the staff account

---

## Acceptance tests

- [x] A credit sale with an open till of Rs 2,000 leaves `expected_cash` at Rs 2,000 —
      **the drawer does not move**
- [x] The same sale appears immediately on the party's statement as a debit
- [x] A part settlement posts to the open till, leaves the remainder outstanding, and
      allocates against the oldest bill first
- [x] The day book shows "credit given today" and "credit recovered today" as separate lines,
      and the till reconciles without credit sales in it
- [x] A party's `customer-credit` and `dialysis-demand` accounts show different balances and
      never appear summed anywhere
- [x] Aging buckets total exactly the sum of outstanding balances
- [x] `SUM(debit) − SUM(credit)` for every account equals its cached `balance`
- [x] Vendor balances after migration equal the pre-migration `vendors.balance` values
- [x] A cash settlement with no till open is refused and **leaves the balance unchanged**;
      card and online still settle; the off-till override records why on the statement

### Close-out audit — 2026-09-09

Four things the ticks had claimed and the code had not delivered. Found by auditing the
surface rather than re-reading the ticks, which is now the only way this phase gets closed.

**Cash could vanish at settlement.** `postCashIfOpen` is a no-op when the user has no open
till, so settling with the till closed reduced the customer's balance and put the money
nowhere — and unlike a sale there is no bill left behind to trace it by. Proved it: debt Rs 80
→ Rs 30, `cash_transactions` rows for `credit-recovery`: 0.

Settlement now refuses cash with no till open:

```
cash settlement -> 409 TILL_NOT_OPEN
"No till is open, so this cash has nowhere to land..."
retry_with: {"accept_no_till":true}
the debt was NOT reduced: still Rs 1200
```

Refusing rather than blocking outright: a site that never opens till sessions would otherwise
be unable to take a payment at all. Taking it off-till is a decision, and it is recorded as
one — `Payment received (cash, no till open)` on the statement, `off_till` in the audit log,
because whoever reconciles a day that does not add up needs to see which receipts never
reached a drawer. Card and online are unaffected; they never touch it.

**The statement did not print properly, on either paper.** There was no thermal handling
anywhere in the app, and nothing scoped printing to the dialog — so printing a statement put
the whole account list on the paper first. Now `printPaper()` injects the `@page` rule for the
length of the call (page size cannot be selected by a CSS class) and `body.printing-modal`
hides what the dialog covers. Two buttons, because guessing wrong wastes the customer's time
at the counter: **Print receipt (80mm)** and **Print A4**.

**A first-time credit customer got no confirmation.** The counter looked an account up but
never created one, so for someone who had never bought on credit the panel simply did not
render — the pharmacist picked "Credit", saw nothing, and learned an account had been opened
when the receipt printed. It now says so before the sale, and takes an opening limit:

```
accounts before the sale: 0
sale -> account opened with limit Rs 3000
a limit sent for an EXISTING account is ignored: still Rs 3000, not 999999
```

That last guard matters — without it the counter could raise anyone's credit limit by typing
a number into a sale.

**The docs named a ledger kind that does not exist** (`customer-account`; it is
`customer-credit`). Collateral damage from the blanket Urdu→English rename.

### Verified live — 2026-09-08

Against throwaway databases (`p04.db`, `p04b.db`, `p04c.db`, all removed afterwards). The live
`hms.db` was not touched.

**The rule.** Till opened at Rs 2,000. A credit sale left `expected_cash` at Rs 2,000; a cash
sale moved it to Rs 2,060; settling Rs 100 moved it to Rs 2,160. Credit reaches the drawer at
settlement and at no other moment.

**Aging, and why oldest-first matters.** Four debits at 120 / 75 / 45 / 5 days old:

```
90+ Rs 5000 | 61-90 Rs 3000 | 31-60 Rs 2000 | 0-30 Rs 1000
buckets total Rs 11000 | account balance Rs 11000
```

A Rs 6,000 part payment then cleared the 120-day debt and Rs 1,000 of the 75-day one:

```
90+ Rs 0 | 61-90 Rs 2000 | 31-60 Rs 2000 | 0-30 Rs 1000
oldest unpaid still dated 2026-06-25
```

Aging the *net balance* by today's date instead would have shown this account as entirely
current the moment the payment landed — which is how a 75-day debt stops being chased.

**Two accounts, one person.** The same party held a `customer-credit` at Rs 5,000 and a
`dialysis-demand` at Rs 7,500. Neither statement contained the other's entries, and asking for
the account a second time returned the same account rather than opening a second one.

**No cache drift.** Every `ledger_accounts.balance` equalled `SUM(debit) - SUM(credit)` over
its entries, checked across every account after each run.

**Vendor migration.** Four vendors were put back into their pre-ledger state — balance on the
column, nothing in the ledger — and the server started twice:

```
Generic Pharma Distributors: was Rs 45250.75, ledger Rs 45250.75
Sana Medical Store:          was Rs 12000,    ledger Rs 12000
Hilal Surgical:              was Rs 0,        ledger Rs 0
Rehmat Traders:              was Rs -500,     ledger Rs -500
```

Two start-ups, no doubling. A Rs 2,500 payment then moved the column and the ledger together
to Rs 9,500, and the statement read as a passbook:

```
2026-09-08  Opening balance carried in from the vendor record  Dr 12000  Cr 0     bal 12000
2026-09-08  Payment to vendor — cash                            Dr 0      Cr 2500  bal 9500
```

`/reports/receivables` returned no vendor rows; `?kind=vendor` returned them explicitly at
Rs 54,750.75.

**Staff cap — Rs 20,000 (client, 2026-09-08).** Dialyzer kits at Rs 1,200 to a Staff customer
on credit, 50% staff rate:

| Sale | Gross | Discount | Net | Allowance left |
|---|---|---|---|---|
| 20 kits | Rs 24,000 | Rs 12,000 | Rs 12,000 | Rs 8,000 |
| 20 kits | Rs 24,000 | **Rs 8,000** (clamped) | Rs 16,000 | Rs 0 |
| 5 kits | Rs 6,000 | Rs 0 | Rs 6,000 | Rs 0 |

The cap **caps the help, it does not withdraw it**: the second sale still got Rs 8,000 of
subsidy and the employee paid the Rs 4,000 excess. All three landed on one `staff` account
totalling Rs 34,000, and the ledger says why:

```
Dr 12000  bal 12000   Staff purchase — 1 item
Dr 16000  bal 28000   Staff purchase — 1 item (Rs 4000 over the annual allowance)
Dr 6000   bal 34000   Staff purchase — 1 item (Rs 3000 over the annual allowance)
```

---

## Notes & decisions

- **Q4 assumption — BUILT ON, still unconfirmed:** the credit limit **warns** rather than
  blocks. Over-limit returns `409 OVER_CREDIT_LIMIT` naming the projected balance, with
  `retry_with: { accept_over_limit: true }`; the counter shows an "allow over the limit"
  tick box. If the client wants a hard block this is a one-line change, but it must be asked
  — the two answers produce very different bad-debt behaviour.
- **Staff cap = Rs 20,000 per employee per year** (client, 2026-09-08). Stored as the
  `staff_annual_cap` setting, not a constant, and it resets on the calendar year. **Q9**
  (fiscal year) could still move that reset.
- **Q10 is now the only thing missing from staff recovery.** The excess lands on the
  employee's `staff` ledger account with the over-cap amount named in the narration, so it is
  recoverable either way — but whether it comes off payroll or is paid at the counter is
  still the client's call. Nothing in the build assumes an answer.
- **`clampStaffDiscount` now returns `cap_excess`.** It previously folded the shortfall into
  `net` and said nothing, which made an ordinary Rs 400 staff bill indistinguishable from one
  the employee was paying only because their year had run out.
- `ledger_entries` is append-only. A mistaken entry is corrected with a reversing entry, never
  by editing or deleting — the same discipline Phase 06 applies to bills.
- The statement must remain printable when the party has hundreds of rows; paginate the print
  by month.
