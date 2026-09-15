# Requirements brief — received 2026-09-07

**Recorded verbatim. Do not tidy, correct or translate.**
Our interpretation lives in [`../../hwt-core/`](../../hwt-core/), where it can be checked
against this original.

---

## Part 1 — the feature list

> multiple patient handle at a time (4 to 5)
> dropdown list for product type
> full box price
> dialysis patient (free medicine)
> lab uses products
> card patient (full free, 50%, 20%)
> hospital uses
> reports as is
> emergency cases uses
> all needs to seprate
> udhaar khata(credit payment withheld when cleared)
> configure the electronic cash register this should be the last phase cash register should be open only when the invoice is generated, admin can open without the invoice.
> reports of non-paid customer how much company earn on their sales(distribution wise sale, company wise sale, product wise sale(distributor sale, annually/ monthly))
> staff wise report how much he bought from his subsidy amount how much left from his subsidy amount if exceeded then how much he needs to pay
> dialysis demands and patient khata should be seperate
> if someone else order the dialysis patient medicine then record the person who has taken the medicine his relative or someone else
> emergency medicine of dialysis should also be added in the same invoice of dialysis patient
> if billed miss entered then it should be edited by the admin if session closed
> day end when session is closed it generates the report and print it (card patient, dialysis patient, paid patient)
> also no needs for vendors to order medicine because the order taker come physically and take the order and when the order is deliver we just need to record the order so that system will reflect the medicine as it is

> need you to seprate all the phases and consider this should be the pakistani market so work accordingly.

## Part 2 — site constraints

> the pharmacy portal in this folder is developen we need the ammendments in it also these
> features keep one thing in mind that the product is for those hostipal where no internet
> access only the lan setup is configured also their is loadsheading too you can we need to
> include this one too then make the full pharmacy phase plan also suggest which technology
> is best for us also the database attached is the dialysis demand form

*(The dialysis demand form is transcribed at
[`../forms/dialysis-demand-form.md`](../forms/dialysis-demand-form.md).)*

## Part 3 — scope decision

> do you that all these moduled are standalone so no link with each other only with the
> pharmacy from demand of labs, dialysis patient lab patient and emergency patient only
> dialysis module is full fledge in which they register customer order medicine from the
> pharmacy and keep the dialysis patient history for the future dialysis other then that all
> other uses from the different department should come to the pharmacy in the form of
> percription and these departements then charge accordingly by giving them invoice and these
> should be track in hospital expense also except from the Pharmacy Management, Inventory &
> Stock Management , Customer Management, Dialysis Management, Reporting & Analytics, Donor
> Portal (Online), Patient Portal (Online), Offline Operation & Sync other modules are on hold
> so think it like a pos system for the pharmacy and dialysis management system then create
> the plan accordingly also client related work should be in the seprate folder.

---

## How we read it

Recorded so the client can correct us if we read it wrong. Full reasoning in
[`../../hwt-core/SCOPE.md`](../../hwt-core/SCOPE.md).

| Their words | Our reading |
|---|---|
| *"all these moduled are standalone… only with the pharmacy"* | Lab, Emergency and the wards do **not** integrate. They send a paper prescription to the pharmacy counter |
| *"charge accordingly by giving them invoice"* | A department is a **customer that gets a real invoice**, not a silent internal stock transfer |
| *"track in hospital expense"* | Those invoices are the hospital's expense, reported by department and by period |
| *"only dialysis module is full fledge"* | Dialysis registers its own patients, keeps their history, and orders medicine on its own demand form |
| *"other modules are on hold"* | Reception, Token & Queue, Consultation/EMR and Laboratory are gated off. **The code is kept, not deleted** |
| *"a pos system for the pharmacy and dialysis management system"* | The one-line description of the product |
| *"client related work should be in the seprate folder"* | Read as: client-facing material — briefs, forms, questions, deliverables — separate from the build plan. This folder. **If a different separation was meant, say so and it moves** |
| *"reports as is"* | Read as: leave the existing reports alone, add the new ones beside them. Flagged as Q1 |
| *"full box price"* | Read as: the MRP printed on the pack, not a bulk discount rate. Flagged as Q5 |
