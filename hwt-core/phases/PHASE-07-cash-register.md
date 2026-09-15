# Phase 07 — Electronic cash register

| | |
|---|---|
| **Status** | ⬜ Not started |
| **Estimate** | 1 week |
| **Depends on** | everything — especially [04](PHASE-04-ledger-and-credit.md) and [06](PHASE-06-reports-and-corrections.md) |
| **Blocks** | nothing |
| **Blocking questions** | FBR Tier-1 status — see below |

---

## Goal

The drawer opens **only** when an invoice is generated; an administrator can open it without
one, and that fact is recorded.

The client asked for this to be last, and that is correct: **the drawer is a control on top
of accounting that must already be trustworthy.** The cash session, the variance calculation,
the credit-never-touches-the-till rule and the segmented day book all exist by now, so this
is the last mile rather than a new subsystem.

## Requirements covered

- *configure the electronic cash register — this should be the last phase*
- *cash register should be open only when the invoice is generated*
- *admin can open without the invoice*

---

## How it actually works

> **A browser cannot open a cash drawer.**
>
> The drawer hangs off the receipt printer's RJ11/RJ12 port and opens on an ESC/POS kick
> code — `ESC p m t1 t2`, commonly `1B 70 00 19 FA`. No web page can send that.
>
> The Node backend already runs on the counter machine, so the kick goes
> **backend → printer**, over a raw socket. This is also why the whole feature works with no
> internet at all.

Two paths, one endpoint:

| Call | Gate | Result |
|---|---|---|
| `POST /api/register/kick { bill_id }` | The bill was created **seconds ago**, by **this user**, at **this counter**, and settled in **cash or part-cash** | Drawer opens; `register_events.kind = 'sale-kick'` |
| `POST /api/register/kick { reason }` | Permission `register.open` | Drawer opens with no invoice; `register_events.kind = 'no-sale'`; written to `audit_log`; counted on the day book |

**A card, digital or credit sale must not open the drawer.** That restriction *is* the
control the client is asking for — and it is only enforceable because
[Phase 04](PHASE-04-ledger-and-credit.md) made credit a real payment method rather than a
cash sale with a note attached.

---

## Schema changes

See [DATABASE.md §3](../DATABASE.md#phase-07--cash-register). New: `register_events`.
New permission key `register.open`. New settings: `printer_mode`, `printer_host`,
`printer_port`, `drawer_pin`, `drawer_pulse_ms`.

---

## Work

### Printer transport

| Mode | Implementation | Recommendation |
|---|---|---|
| **Network** | Node `net` socket to `IP:9100`, write the kick bytes, close | **Preferred.** More reliable than the Windows spooler, keeps working when a counter PC is swapped, and any counter can print |
| USB raw | Windows printer share, raw pass-through | Fallback only |

`drawer_pin` (2 or 5) and `drawer_pulse_ms` are settings because the inexpensive drawers sold
here — Xprinter, Black Copper and clones — differ on both.

### Never roll back a sale on a kick failure

If the drawer does not open — the printer is off, the cable is out, or the power just went —
**the sale is still complete.** Surface the failure, offer a retry, and write
`register_events.kind = 'failed'`. Rolling back a committed sale because a solenoid did not
fire would be far worse than a drawer opened by hand.

### The no-sale line on the day book

`register_events` where `bill_id IS NULL`, counted and listed with user, time and reason.
**That line is the first thing an auditor looks at**, so it belongs on the printed day book
from day one, not behind a report filter.

---

## API surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/register/kick` | `cash.manage` | With `bill_id` — validated against the rules above |
| POST | `/api/register/kick` | `register.open` | With `reason` — the admin no-sale |
| GET | `/api/register/events?date=` | `report.view` | Feeds the day book |
| POST | `/api/register/test` | `user.manage` | Fire a test kick from Admin > Settings |

---

## Tasks

- [ ] `register_events` table
- [ ] `register.open` permission key, granted to Administrator only by default
- [ ] Printer settings in Admin (mode, host, port, drawer pin, pulse ms)
- [ ] Network transport: `net` socket to `IP:9100` with the ESC/POS kick bytes
- [ ] USB raw fallback via the Windows printer share
- [ ] `POST /api/register/kick` with `bill_id` — recency, user, counter and cash-method gates
- [ ] Reject the kick for card, digital and **credit** sales
- [ ] Admin no-sale path with a mandatory reason, written to `audit_log`
- [ ] Kick failure never rolls back the sale; retry offered; `failed` event written
- [ ] No-sale count and detail on the printed day book
- [ ] Test-kick button in Admin > Settings

---

## Acceptance tests

- [ ] Completing a **cash** sale opens the drawer once
- [ ] Completing a **card**, **online** or **credit** sale does **not** open the drawer
- [ ] Replaying the same `bill_id` a minute later is refused (recency gate)
- [ ] A cashier without `register.open` cannot perform a no-sale
- [ ] An admin no-sale opens the drawer, requires a reason, and appears on today's day book
      with user, time and reason
- [ ] Unplugging the printer and completing a cash sale: the sale completes, the failure is
      shown, a retry works, and a `failed` event is recorded
- [ ] The day book's no-sale count matches `register_events`

---

## Notes & decisions

- **Confirm before wiring: is the pharmacy an FBR Tier-1 retailer?** If it is, invoices must
  be POS-integrated with real-time fiscal reporting and an FBR invoice number and QR on the
  receipt — which would add an internet dependency this site does not have and cannot get.
  That would have to be resolved with the client **before** the receipt format is fixed. A
  welfare trust pharmacy usually falls outside Tier-1, but confirm it rather than discover it.
- Put the printer on the UPS ([Phase 00](PHASE-00-site-hardening.md)). A half-printed receipt
  at the moment of a power cut is a support call every time.
- The drawer is a control, not a feature. If the accounting underneath it is not already
  trustworthy, opening the drawer correctly proves nothing — which is exactly why the client
  was right to put this last.
