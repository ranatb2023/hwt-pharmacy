# OPEN QUESTIONS

Thirteen answers that change the build. Each records the **working assumption** we proceed on
if no answer arrives, so nothing stalls — but an assumption that turns out wrong costs rework
in the phase named.

**When an answer arrives:** fill in the Answer row, date it, and copy the decision into the
decision log in [STATUS.md](STATUS.md). An answer that only exists in a WhatsApp message does
not exist.

Nothing here blocks **Phase 00 or 01**. Those can start today.

---

## Q1 — "reports as is": keep the existing reports, or an as-on-date stock report?

| | |
|---|---|
| **Blocks** | Nothing. Affects scope inside Phase 06 |
| **Assumption** | Leave the current reports untouched and add the new ones beside them |
| **If wrong** | A stock-in-hand *as on a date* report is about a day's work in Phase 06 |
| **Answer** | ⬜ *pending* |

## Q2 — Does a welfare card cover the dialysis session charge, or only medicine?

| | |
|---|---|
| **Blocks** | **Phase 03** |
| **Assumption** | Medicine and the dialysis session charge at the same tier; cosmetics and general items never |
| **If wrong** | `card_tier_scope` is built for this, but the seed data and the entitlement tests change. It is a design decision, not a later toggle |
| **Answer** | ⬜ *pending* |

## Q3 — Do card holders and dialysis patients share one customer record?

| | |
|---|---|
| **Blocks** | Nothing — decided, recorded here so it is not re-opened |
| **Assumption** | **Yes.** One customer record; `customer_type` distinguishes them. The counter sells a dialysis patient a cosmetic like anyone else, and the unit sees their history |
| **If wrong** | Splitting them later means duplicate identities and two credit accounts per person |
| **Answer** | ✅ Confirmed by scope (dialysis "registers customer") — 2026-09-07 |

## Q4 — Who may be given credit, and is there a credit limit?

| | |
|---|---|
| **Blocks** | ~~Phase 04~~ — **Phase 04 is built on the assumption.** Still needs confirming |
| **Assumption** | Registered customers, staff and departments; walk-ins need a name and a mobile. A per-party credit limit that **warns** rather than blocks, overridable with `billing.override` |
| **As built** | Over-limit returns `409 OVER_CREDIT_LIMIT` naming the projected balance and offering `retry_with: { accept_over_limit: true }`; the counter shows the balance, the limit and an "allow over the limit" tick box. A limit of `null` means no limit and never warns |
| **If wrong** | A hard block is a one-line change — drop the `accept_over_limit` escape in `pharmacy.js`. Opening credit to anyone who asks is a policy decision the trust should make deliberately: the difference between a controlled ledger and a growing bad debt |
| **Answer** | ⬜ *pending* |

## Q5 — "Full box price": the MRP printed on the pack, or a discounted bulk rate?

| | |
|---|---|
| **Blocks** | Nothing. Affects Phase 01 |
| **Assumption** | The MRP printed on the pack. The pharmacist types the box price; the system derives the per-unit price |
| **If wrong** | A bulk-box rate is a **different feature** and would break the invariant that keeps box, strip and tablet prices from drifting apart. It should be modelled as a discount rule, not a second stored price |
| **Answer** | ⬜ *pending* |

## Q6 — How many dialysis shifts a day, and what are they called?

| | |
|---|---|
| **Blocks** | **Phase 05** |
| **Assumption** | Two shifts, "Morning" and "Evening" |
| **If wrong** | `dialysis_shifts` is seeded data so a third is trivial — but the unit's own names must be on screen from day one, because the form is filed by shift and every dialysis report groups by it |
| **Answer** | ⬜ *pending* |

## Q7 — Which SKUs sit behind the multi-product rows on the demand form?

| | |
|---|---|
| **Blocks** | **Phase 05** |
| **Assumption** | None — this genuinely has to be answered |
| **Rows affected** | `Syringe 1cc / 3cc / 10cc` · `Inj-Antibiotec / Vancare` · `N/S 1000 / 100 ml` |
| **What is needed** | Half a day with the dialysis unit in-charge, mapping every printed row to its product(s) and naming a default. **The largest single source of wrong stock deductions in the whole plan, and it costs nothing to prevent before the build starts** |
| **Answer** | ⬜ *pending* |

## Q8 — Is the demand form's "Total Cost" at cost price or at MRP?

| | |
|---|---|
| **Blocks** | **Phase 05** |
| **Assumption** | Batch cost price — the trust is accounting for what the medicine cost it, not what it would have sold for |
| **If wrong** | It decides what the dialysis programme is charged, and the two give very different donor reports. Costing at MRP makes the programme look expensive and the pharmacy look profitable; costing at cost is the truthful expense figure. Ask the trust's accountant, not only the unit |
| **Answer** | ⬜ *pending* |

## Q9 — Does the trust report on the fiscal year, 1 July – 30 June?

| | |
|---|---|
| **Blocks** | **Phase 06** |
| **Assumption** | Yes — Pakistan's financial year, and the trust's audited accounts will follow it |
| **If wrong** | A calendar-year "annual" report is the wrong year for their audit. Also check whether `staff_annual_cap`, documented as "per calendar year", should reset on 1 July |
| **Answer** | ⬜ *pending* |

## Q10 — Staff subsidy excess: payroll deduction, or paid at the counter?

| | |
|---|---|
| **Blocks** | **Phase 06** |
| **Assumption** | Paid at the counter, sitting on the staff member's credit account until cleared |
| **As built** | Phase 04 made this cheaper to answer either way. The excess **lands on the employee's `staff` ledger account regardless**, with the over-cap amount named in the narration ("Rs 4000 over the annual allowance"), so it is recorded and recoverable before the client decides. The open question is only how it comes *off*: at the counter, or as a payroll deduction netting against that account |
| **If wrong** | Salary deduction needs a monthly payroll export out of the staff ledger — roughly two extra days in Phase 06. The ledger it would read from already exists |
| **Answer** | ⬜ *pending* |

## Answered — staff medicine allowance

| | |
|---|---|
| **Question** | How much medicine may an employee draw before they pay full price, and how much of each bill does the allowance cover? |
| **Answer** | **Rs 20,000 per employee, per calendar year** — client, 2026-09-08 |
| **Correction** | 2026-09-08 — the allowance is **an amount of medicine, not a rate of discount**. Medicine is covered in full until the allowance runs out; then the employee pays. The 50% rate the code shipped with was an inherited assumption, never confirmed, and it made a Rs 50 purchase cost the employee Rs 25 instead of nothing |
| **As built** | A per-employee `patients.staff_cap`, falling back to the `staff_annual_cap` setting when blank, so raising the default still moves everyone who was never given a personal figure. `staff_pct` stays configurable at 1.00, so moving to part-coverage is a settings change rather than a release. The cap **caps the help, it does not withdraw it**: a basket that straddles the end of the allowance draws whatever is left and the employee pays only the remainder |
| **Booked as** | A **discount**, not a subsidy — an employment benefit rather than donor-funded charity, so it does not appear in the donor subsidy figures. Worth confirming if the trust funds staff medicine out of Zakat or a named fund, which would make it a subsidy against that fund |
| **Still open** | **Q9** could move the reset off the calendar year onto 1 July – 30 June; **Q10** decides how the excess is recovered |

## Q11 — Is there any internet-connected machine, and who carries the USB?

| | |
|---|---|
| **Blocks** | **Phase 08 — this phase cannot start without it** |
| **Assumption** | None. The whole phase is shaped by the answer |
| **Why it matters** | The client has put the Donor Portal, the Patient Portal and Sync in scope, and the site has no internet. Both are true, so the design has to absorb it: an encrypted, de-identified package written to a USB stick, carried to a machine that does have internet, imported there |
| **Three shapes** | *Office has internet, someone visits weekly* → build as designed, weekly cadence. *Nobody has internet at all* → build the export only; the portals have nowhere to live, say so and stop. *Pharmacy could get a mobile dongle* → reconsider a scheduled push, but the site must still never depend on it |
| **Answer** | ⬜ *pending* |

## Q12 — At what rate is a department invoiced?

| | |
|---|---|
| **Blocks** | **Phase 02** |
| **Assumption** | **Batch cost price.** This is an intra-organisation transfer whose purpose is expense tracking, not margin |
| **If wrong** | `invoice_basis` and `markup_pct` are already on the `departments` table, so cost-plus or MRP is configuration — but the decision changes what "hospital expense" *means*, so answer it before the report is built |
| **Answer** | ⬜ *pending* |

## Q13 — Which departments exist, and who signs for each?

| | |
|---|---|
| **Blocks** | **Phase 02** |
| **Assumption** | Laboratory · Emergency · Ward / IPD · OT · Administration · Dialysis |
| **Why it matters** | Fifteen minutes of conversation that prevents a month of "who authorised this" arguments. The in-charge name prints on the issue slip |
| **Answer** | ⬜ *pending* |

---

## Answered

| Q | Question | Answer | Date | By |
|---|---|---|---|---|
| — | Should we change the technology stack? | No — keep Node + Express + better-sqlite3 + React. See [TECHNOLOGY.md](TECHNOLOGY.md) | 2026-09-07 | Dev |
| — | Is the dialysis demand per patient or per unit? | **Per patient, per shift** — confirmed from the unit's own form | 2026-09-07 | Client (form) |
| — | Is this a hospital system or a pharmacy system? | **A pharmacy POS plus a full dialysis management system.** Reception, Queue, EMR and Laboratory on hold | 2026-09-07 | Client |
| — | Do departments consume stock internally, or get invoiced? | **Invoiced**, and those invoices are hospital expense | 2026-09-07 | Client |
| Q3 | One customer record for cards and dialysis? | Yes — `customer_type` on the existing `patients` table, no migration | 2026-09-07 | Dev + scope |
