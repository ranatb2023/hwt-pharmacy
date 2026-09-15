# Phase 01 — Counter throughput & catalogue

| | |
|---|---|
| **Status** | 🟦 In review — all 18 tasks built; acceptance tests need a human at the screen |
| **Estimate** | 2 weeks |
| **Depends on** | [Phase 00](PHASE-00-site-hardening.md) |
| **Blocks** | [Phase 06](PHASE-06-reports-and-corrections.md) — "company-wise sale" needs `manufacturer` to be a managed list |
| **Blocking questions** | none (Q5 has a working assumption) |

---

## Goal

Make the counter survive five customers standing at it, and make the catalogue precise
enough that the profitability reports in Phase 06 have something honest to group by.

## Requirements covered

- *multiple patient handle at a time (4 to 5)*
- *dropdown list for product type*
- *full box price*
- *no needs for vendors to order medicine … when the order is delivered we just need to record the order*

---

## Schema changes

See [DATABASE.md §3](../DATABASE.md#phase-01--counter--catalogue) for the full DDL.

| Object | Purpose |
|---|---|
| `held_sales` | Parked carts, server-side so a reload or a power cut does not lose four customers |
| `product_types` | Managed dosage-form list; replaces free-text `products.form` |
| `manufacturers` | Managed company list; "company-wise sale" depends on it |
| `order_bookings` | A memo of what the order taker wrote in his own book. **Not** a purchase order |
| `products.product_type_id`, `products.manufacturer_id` | FKs to the two new lists |
| `purchases.order_booking_id` | Links a delivery back to the order it fulfils |
| settings `max_parked_sales` (5), `loose_rounding` (`rupee`) | |

---

## Work

### 1. Parked sales — four to five customers at once

A tab strip above the cart in `frontend/src/pages/Pharmacy.jsx`. Each tab is labelled with a
customer name or a token.

**Persist server-side, not in React state.** A shift lasts eight hours, and on this site a
browser reload is not hypothetical — it is what happens when the lights go out.

**Do not reserve stock on park.** A parked cart holds no stock; the existing availability
check at completion stays the only gate. Reserving would strand inventory every time a
customer walks off, and a pharmacy this size cannot carry phantom shortages.

Keyboard: the POS map is already **F2** search / **F3** quantity / **F4** tender / **F9**
complete / **Esc** clear. Add **F5** next tab and **F6** new tab. The counter runs on the
keyboard, not the mouse. Watch the existing `stopPropagation` handling in the qty and price
inputs — Escape inside an input must not clear the whole sale.

At day close, expire parked carts older than the shift and list them on the day book so
nothing disappears silently.

### 2. Product type as a managed list

Seed `product_types` with the shelf as it actually looks:

> Tablet · Capsule · Syrup · Suspension · Injection · IV infusion · Drops · Inhaler ·
> Ointment / Cream · Sachet · Suppository · Surgical / Disposable · Dressing ·
> Diagnostic / Test strip · Nutrition · Cosmetic · General item

Each row carries `is_medicine`, a default tax percentage and a default drug schedule.
Administrator-editable.

**Use the project's `<Select>` component, never a native `<select>`.** Note the known
limitation: `Select` is `position: absolute`, so it clips inside a scrollable modal. The
product form is a modal — if the menu clips, promote `Select` to a portal rather than
falling back to a native element.

**Retire the duplicated string predicate.** The "medicine needs batch and expiry" rule is
currently spelled `drug_schedule='OTC' AND form='Item'` in **both**
`backend/src/routes/inventory.js` and `backend/src/pharmacyDashboard.js`. Two copies of a
string comparison will drift — one of them already caused an uncloseable compliance gap.
Point both at `product_types.is_medicine`.

### 3. Manufacturer as a managed list

"Company-wise sale" in Phase 06 is only as good as this field. Free text gives you GSK,
G.S.K and Glaxo as three companies. Build `manufacturers` now, with a one-time merge screen
that lists the distinct existing `products.manufacturer` values and lets an administrator
map them onto canonical rows.

### 4. Full box price

`backend/src/packaging.js` already derives strip and box prices from the per-unit price, and
the product form already does bidirectional strip ↔ unit entry. Add the third leg:

- Type the **printed box MRP** → the form writes `mrp = boxMrp / unitsPerBox`.
- Type the **box cost** on receive → `cost_price = boxCost / unitsIn(product, 'box')`
  (the receive route already divides; confirm the box case).
- Show all three rates wherever the counter sees a price:
  **Box Rs 1,240 · Strip Rs 124 · Tab Rs 12.40**

**Keep the invariant:** one stored price per base unit. Do not add a per-box price column —
a stored box price and a stored unit price drift the first time one is edited.

**Rounding.** An Rs 155 strip of 14 capsules is Rs 11.0714 per capsule. Store the per-unit
price at full precision and round only the **line total**, or fourteen loose capsules will
not add up to one strip. Counters here round loose sales to the rupee, so add
`loose_rounding` (`none` / `rupee` / `five`) and apply it to the line, never to the stored
price.

### 5. Vendors — record deliveries, do not raise orders

The order taker comes in person and writes the order in his own book. There is no purchase
order for the system to issue.

- Keep the GRN exactly as it is.
- Add `order_bookings` as a memo: vendor, order taker's name and mobile, date booked,
  expected delivery, free-text notes, status. The counter can then see *"Getz order booked
  4 Sep — not yet delivered"*.
- A GRN may reference a booking, which closes it.
- Turn the reorder panel's output into a **printable demand slip** to hand the order taker.
  It suggests in boxes already. This is not a PO and should not look like one.

---

## API surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/pharmacy/held` | `pharmacy.sell` | Parked carts for this counter/user |
| POST | `/api/pharmacy/held` | `pharmacy.sell` | Park the current cart; 409 past `max_parked_sales` |
| PUT | `/api/pharmacy/held/:id` | `pharmacy.sell` | Update a parked cart |
| DELETE | `/api/pharmacy/held/:id` | `pharmacy.sell` | Discard |
| GET/POST/PUT | `/api/inventory/product-types` | `inventory.manage` | Admin CRUD |
| GET/POST/PUT | `/api/inventory/manufacturers` | `inventory.manage` | Admin CRUD + merge |
| GET/POST | `/api/vendors/bookings` | `vendor.manage` | Order-taker memo |
| GET | `/api/vendors/demand-slip` | `vendor.view` | Printable reorder slip, in boxes |

---

## Tasks

- [x] `held_sales` table in `schema.sql` + `migrate()`
- [x] `/api/pharmacy/held` GET / POST / PUT / DELETE
- [x] Tab strip UI in `Pharmacy.jsx`, labelled per customer
- [x] **F5** next tab / **F6** new tab, without breaking the existing F2–F9 / Esc map
- [x] `max_parked_sales` setting + Admin > Settings field
- [x] Expire stale parked carts at day close and list them on the day book
- [x] `product_types` table + seed the 17 rows
- [x] Admin screen for product types (CRUD, sort order, `is_medicine`)
- [x] `products.product_type_id`, backfilled from the existing `form` text
- [x] Product form uses `<Select>` for type; fix menu clipping in the modal if it appears
- [x] Replace the `form='Item'` predicate in `inventory.js` **and** `pharmacyDashboard.js`
- [x] `manufacturers` table + admin screen
- [x] One-time merge screen for existing free-text manufacturer values
- [x] `products.manufacturer_id`, backfilled through the merge
- [x] Box-price entry leg on the product form (box MRP → per-unit `mrp`)
- [x] Show Box / Strip / Unit rates on the counter lookup and the cart line
- [x] `loose_rounding` setting, applied to the line total only
- [x] `order_bookings` table, Vendors screen section, and the printable demand slip

---

## Backend status — complete and live-tested (2026-09-07)

Every endpoint below exists, is wired, and was exercised against a seeded database.
**Only the screens are outstanding.** A task above stays unticked until its UI exists, so
seven ticks understates what is built — this table is the accurate picture.

| Area | Backend | Frontend |
|---|---|---|
| Parked sales | ✅ table, full CRUD, cap enforced with a 409, **atomic swap via `replace_id`**, stale holds on the day-close | ✅ tab strip, F6 hold / F5 resume, stale section on the day book |
| Base units | ✅ `base_units` table + 15 seeded units, `product_types.default_unit`, unknown units join the list rather than living on one product | ✅ dropdown on the product form (pre-filled by dosage form), panel in Admin > Catalogue |
| Product types | ✅ table + 17 seeded rows, `GET/POST/PUT /api/inventory/product-types`, backfill from `form` | ⬜ admin screen, `<Select>` on the product form |
| `is_medicine` | ✅ one definition — `isMedicine()` + `MEDICINE_SQL` in `inventory.js`, and the compliance panel now reads the same column | — |
| Manufacturers | ✅ table, `GET/POST /api/inventory/manufacturers`, `POST /:id/merge-into/:targetId` (moves products, then deletes), backfill from free text | ⬜ admin + merge screen |
| Box price | ✅ `perUnitFromPack()`, `boxPrice()`, `rateCard()`; `box_mrp` and `rates` on every product payload | 🟨 three rates on the cart line ✅ · box-price entry on the product form ⬜ |
| Loose rounding | ✅ `roundLine()` + `loose_rounding` setting, applied to the line in the sale route | ⬜ Admin > Settings field |
| Order bookings | ✅ `order_bookings` table, `GET/POST/PUT /api/vendors/bookings`, `GET /api/vendors/demand-slip` (suggests in boxes) | ⬜ Vendors screen section, printable slip |

### Verified live

```
park 1-5 -> 201        park 6 -> 409 "You already have 5 customers on hold"
discard  -> 200        park again -> 201        cart survives the round trip

medicine without a batch      -> 400 "Batch number is required when receiving medicine."
general item without a batch  -> 201 accepted        (one predicate, both call sites)

merge "G.S.K" into "GSK"      -> 200, products moved, duplicate row gone

Panadol rates -> { unit: 2, strip: 20, box: 400 }   box_mrp 500

loose rounding, Rs 155 strip of 14:
   1 strip  -> Rs 155      3 loose -> Rs 33      14 loose -> Rs 155
   (14 loose equals the strip price exactly — the invariant holds)
```

### Migration checked against the real database

Run on a **copy** of `backend/data/hms.db`, which was never opened for writing:
11 bills preserved, all 11 products typed (7 Tablet, 2 Capsule, 1 Sachet, 1 General item),
2 manufacturers created from the existing free text, 0 untyped rows.

### Two defects found while building this

1. **Express route order.** `/api/vendors/bookings` and `/demand-slip` were appended after
   `router.get('/:id')`, so Express matched them as a vendor whose id was the string
   `"bookings"` and answered 404. Literal paths must be declared before parameterised ones;
   a comment now says so at the top of that block.
2. **Migration ordering.** The backfills were gated on "was the column just added", but on a
   fresh install `seed.js` inserts products *after* `migrate()` runs — so every product on a
   new install would have been left untyped. Both backfills now run on every start-up,
   scoped to rows that are still `NULL`, so they self-heal and also catch products created
   later by an import that did not set the fields.

---

## Acceptance tests

Six of the nine were verified programmatically against a seeded server (evidence in the
backend-status block above). The three left unticked need a person at the counter with a
browser — they are about reload behaviour and keyboard focus, which no API test can prove.


- [ ] Five carts can be parked, the sixth is refused with a clear message, and all five
      survive a browser reload **and** a server restart
- [ ] Switching tabs preserves each cart's lines, quantities, uom and discount exactly
- [ ] Esc inside a quantity input returns focus to the scan box and does **not** clear the sale
- [x] Every product has a `product_type_id`; creating a product with no type is refused
- [x] Receiving a Tablet with no batch/expiry is refused; receiving a General item is allowed
      — and the same rule now fires from one predicate, not two
- [x] After the merge, `SELECT DISTINCT manufacturer_id` shows no duplicate companies
- [x] Typing a box MRP of Rs 1,240 on a 10×10 pack sets the per-unit MRP to 12.40, and
      selling one box bills Rs 1,240 — not Rs 1,239.99
- [x] 14 loose capsules from an Rs 155 strip bill as Rs 155 under `loose_rounding = rupee`
- [x] A booked order appears against the vendor, and receiving a GRN against it closes it

---

## Notes & decisions

- **Q5 assumption:** "full box price" means the MRP printed on the pack, not a discounted
  bulk rate. A bulk rate would be a different feature and would break the pricing invariant.
- Parked carts hold no stock. This is deliberate and should be explained to the client so it
  is not reported as a bug.
