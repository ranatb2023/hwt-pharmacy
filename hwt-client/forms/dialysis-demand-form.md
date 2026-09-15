# Dialysis Unit — Demand Form for Patient

**Source:** `Demand Form.pdf`, Hope Welfare Hospital, received 2026-09-07.
**Place the original PDF in this folder** — it was supplied in conversation, not in the repo.

Transcribed here so the build has something to work from and the wording cannot drift.
Implemented in [`../../hwt-core/phases/PHASE-05-dialysis-management.md`](../../hwt-core/phases/PHASE-05-dialysis-management.md).

---

## Layout of the paper form

- Hope Welfare Hospital logo, top left
- Title: **DIALYSIS UNIT** / *Demand Form for Patient*
- **Shift:** ______   **Date:** __ / __ / 20__
- **Three patient blocks per sheet**, each identical
- Footer: **Signatures — Demanded by: ______________  Issued by: ______________**

Each patient block:

| Pat. Name: | | | | |
|---|---|---|---|---|
| **Detail of Injections** | **Qty** | **Detail of Injections** | **Qty** | **Total Cost** |
| Inj-Neurobian | | Inj-Toralak | | *(one cell spanning*
| Inj-Mabil | | Inj-Aron Plus | | *all nine rows)* |
| Inj-Epocan 2000 | | Inj-Gentamycin | | |
| Inj-Epocan 4000 | | Syringe 1 cc/3cc/10 cc | | |
| Inj-Omeprazole | | Gauze | | |
| Inj-Antibiotec/Vancare | | IV set | | |
| Inj-Iron | | N/S 1000/100 ml | | |
| Inj-Paracetamol | | other | | |
| Inj-Hyzonate | | Emergency | | |

---

## The nineteen rows, in order

Seed `demand_template_items` with exactly this. **Keep the unit's wording** — the catalogue
name may be longer, but the screen must show what the nurse expects to read.

| Sort | Column 1 (left) | Column 2 (right) | Flags |
|---|---|---|---|
| 1 | Inj-Neurobian | Inj-Toralak | |
| 2 | Inj-Mabil | Inj-Aron Plus | |
| 3 | Inj-Epocan 2000 | Inj-Gentamycin | |
| 4 | Inj-Epocan 4000 | Syringe 1cc / 3cc / 10cc | ⚠ right |
| 5 | Inj-Omeprazole | Gauze | |
| 6 | Inj-Antibiotec / Vancare | IV set | ⚠ left |
| 7 | Inj-Iron | N/S 1000 / 100 ml | ⚠ right |
| 8 | Inj-Paracetamol | other | 🔓 right |
| 9 | Inj-Hyzonate | Emergency | 🔓🚨 right |

⚠ **one printed row, several SKUs** — needs a product set with a default. This is
**[Q7](../questions/questions-for-client.md)**, and it is the single most valuable answer to
get early.
🔓 `is_freetext` — searches the whole catalogue.
🚨 `is_emergency` — reported separately, billed on the same invoice.

---

## What the form told us about the design

These five readings changed the plan. They are recorded here so the reasoning survives.

**1. The demand is per patient, per shift — not a monthly store indent.**
This corrected our earlier assumption. One document is simultaneously the requisition, the
stock issue and the source of that patient's charge, so it is modelled as one record, not
three screens to reconcile afterwards.

**2. Two signature lines mean a two-step workflow.**
"Demanded by" is the dialysis unit. "Issued by" is the pharmacy. So:
`demanded → issued → billed`, with FEFO deduction at **issue**, not at demand.

**3. "Emergency" is already a printed row.**
The client's requirement that *"emergency medicine of dialysis should also be added in the
same invoice"* is **not a new feature** — it is a line the unit already fills in by hand. We
are automating something they do, not introducing something they do not.

**4. "Total Cost" is already on the form.**
The unit already costs each patient. We print it filled in. Whether that is cost price or MRP
is **Q8**.

**5. Three patient blocks to a sheet.**
Keep that on the printed output. Their filing does not have to change, which is most of what
makes a paper-to-screen move succeed.

---

## Fields to add that the paper does not have

The paper form works because the unit knows things it does not write down. The screen has to
carry them:

| Field | Why |
|---|---|
| Patient registration number (`DLY-0001`) | "Pat. Name" alone is ambiguous across two patients with the same name |
| Station / machine | Serology-positive patients are dialysed on assigned machines |
| `qty_issued` alongside `qty_demanded` | The paper cannot show a short issue; the screen must |
| Collector name, relation, CNIC | *"if someone else order the dialysis patient medicine then record the person who has taken the medicine"* |
| Batch and expiry per line | FEFO deduction happens behind the screen; the record must show which batch went out |

Do **not** add these to the printed sheet's main grid. Put them in the header or a footer
block, so the printed form still looks like the one they file.
