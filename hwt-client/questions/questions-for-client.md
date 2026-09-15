# Questions for Hope Welfare Trust

**Print this and take it to the meeting.** Written for the client, not for developers — no
table names, no jargon.

Each question says what we will assume if we do not hear back, so nothing stops. But an
assumption that turns out wrong means work has to be redone, so the earlier these are
answered the cheaper they are.

---

## Ask the dialysis unit in-charge — 30 minutes, highest value

### 1. Which exact medicines are behind the combined rows on your demand form?

Three rows on your form each cover more than one item:

- **"Syringe 1cc / 3cc / 10cc"** — three different syringes
- **"Inj-Antibiotec / Vancare"** — two different injections
- **"N/S 1000 / 100 ml"** — two different bag sizes

When a nurse writes a quantity on one of those rows, the system has to know **which** item
came off the shelf, or the stock count will be wrong every time.

*We need: for each row, the exact products, and which one to show as the default.*

> **This is the most valuable half-hour in the whole project.** It prevents the largest single
> source of wrong stock figures, and it costs nothing to do before we start building.

### 2. How many dialysis shifts run in a day, and what do you call them?

Your form has a "Shift" box at the top. We need the list — Morning, Evening, and any third —
in the words your staff use.

*If we do not hear: we will assume two, "Morning" and "Evening".*

### 3. Is the "Total Cost" on your form the cost price, or the selling price?

Your form already has a Total Cost cell per patient. We need to know which number goes in it:

- **What the medicine cost the trust** (what was paid to the distributor), or
- **What it would have sold for at the counter** (the printed MRP)

They give very different figures in the donor and expense reports. This one is worth asking
the trust's accountant, not only the unit.

*If we do not hear: we will use the cost price.*

---

## Ask the administrator or trust office

### 4. Is there any computer anywhere with an internet connection?

You have asked for the **Donor Portal** and the **Patient Portal**, which are online. The
pharmacy has no internet, and that is not going to change.

Our plan is to write an encrypted file onto a USB stick at the pharmacy, and for someone to
carry it to a machine that does have internet, where the two portals live.

*We need to know: does such a machine exist, where is it, and who would carry the stick, how
often? If nobody has internet at all, tell us — we will build the export and stop there
rather than build portals with nowhere to live.*

### 5. Which departments will send prescriptions to the pharmacy, and who signs for each?

Our list: **Laboratory · Emergency · Ward / IPD · Operating Theatre · Administration ·
Dialysis.** Add or remove as needed.

For each one we need the name of the person responsible, because it prints on the issue slip
and it is who we come back to if a slip is questioned.

### 6. When the pharmacy invoices a department, at what rate?

- **Cost price** — what the trust paid for the medicine, or
- **Cost plus a percentage**, or
- **The printed selling price (MRP)**

This changes what "hospital expense" means in every report.

*If we do not hear: we will use the cost price, since this is money moving inside the same
organisation.*

### 7. Who is allowed to buy on udhaar, and is there a limit?

- Registered customers and staff only, or walk-in customers as well?
- Is there a maximum a person can owe?
- When they reach it, should the system **warn** the pharmacist, or **refuse** the sale?

*If we do not hear: registered customers, staff and departments; walk-ins need a name and a
mobile number; and the system warns rather than refuses.*

### 8. Does the trust's financial year run 1 July to 30 June?

It matters for the annual reports, and for whether a staff member's yearly medicine allowance
resets in January or in July.

*If we do not hear: we will use 1 July to 30 June.*

### 9. When a staff member goes over their medicine allowance, how do they pay it back?

- Deducted from their salary, or
- Paid at the counter like any other bill?

*If we do not hear: paid at the counter, and it will sit on their account until cleared.*

---

## Two things we have assumed — please correct us if we are wrong

### 10. "Reports as is"

We have read this as: **leave the reports you already have exactly as they are**, and add the
new ones next to them. If you meant a stock-in-hand report as on a chosen date, tell us — it
is a small addition.

### 11. "Full box price"

We have read this as: **the price printed on the box**, so the pharmacist types what they read
off the pack and the system works out the strip and tablet prices from it.

If you meant a **cheaper rate for buying a whole box**, that is a different thing and we
should discuss it — a second price stored separately would eventually disagree with the first
one.

---

## For your information — what we decided without asking

| Decision | Why |
|---|---|
| **Keep the current technology** (Node, SQLite, React) | It is already the right choice for a site with no internet and power cuts. One program, one database file, nothing to install on the counter computers |
| **A UPS on the server, switch and printer** | So a power cut cannot lose a sale that was half-recorded |
| **Automatic backups, hourly and weekly to USB** | And we will restore one onto a spare machine to prove it works, before we rely on it |
| **The cash drawer is the last thing we build** | You asked for this, and it is right — the drawer is a control on top of accounting that has to be trustworthy first |
| **One customer record per person** | A dialysis patient who also buys a bottle of shampoo at the counter is one person, not two records |
