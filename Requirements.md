HOPE WELFARE TRUST
Hope Welfare Trust Hospital


Software Requirements Specification
Hospital Management System (HMS)
Offline-First (Kashmir) • Online Donor & Patient Portals • Pharmacy • Laboratory • Dialysis • Billing
Document Reference: HWT-HMS-SRS

Document Title
Software Requirements Specification (SRS)
Project
Hope Welfare Trust Hospital Management System
Client
Hope Welfare Trust
Version
1.1 (Draft for Client Review)
Date
19 June 2026
Status
Draft – pending client sign-off
Classification
Confidential


Table of Contents
1. Introduction	3
1.1 Purpose	3
1.2 Document Conventions	3
1.3 Intended Audience	3
1.4 Project Scope	3
1.5 Definitions, Acronyms & Abbreviations	4
1.6 References	5
2. Overall Description	6
2.1 Product Perspective	6
2.2 Product Functions (Summary)	6
2.3 User Classes and Characteristics	7
2.4 Operating Environment	7
2.5 Design and Implementation Constraints	8
2.6 Assumptions and Dependencies	8
2.7 Deployment Architecture: Offline-First with Online Sync	9
3. End-to-End Paperless Patient Journey	11
3.1 Journey Steps	11
3.2 Notes on the Journey	11
4. System Modules & Functional Requirements	13
4.1 Patient Management & Reception	13
4.2 Token & Queue Management	13
4.3 Doctor Consultation (Electronic Medical Record)	14
4.4 Laboratory Management	14
4.5 Pharmacy Management	15
4.6 Inventory & Stock Management	15
4.7 Vendor (Supplier) Management	16
4.8 Customer Management	16
4.9 Dialysis Management	17
4.10 Billing, Patient Categories, Discounts & Staff Cap	17
4.11 Refunds, Stock Returns & Vendor Reclaim	18
4.12 Cash Flow & Cash Float Management	19
4.13 Pharmacy QR Card	19
4.14 Roles & Permissions (Access Control)	20
4.15 Reporting & Analytics	20
4.16 Donor Portal (Online)	22
4.17 Patient Portal (Online)	22
4.18 Offline Operation & Data Synchronisation	23
5. Key Data Entities	24
6. External Interface Requirements	25
6.1 User Interfaces	25
6.2 Hardware Interfaces	25
6.3 Software Interfaces	25
6.4 Communication Interfaces	25
7. Non-Functional Requirements	26
8. Requirement Traceability – Client Brief Coverage	28
9. Assumptions, Constraints & Acceptance	29
9.1 Assumptions	29
9.2 Constraints	29
9.3 Acceptance Criteria (high level)	29
10. Open Items to Confirm with the Client	30
11. Revision History & Sign-off	31
11.1 Revision History	31
11.2 Sign-off	31
Tip: In Microsoft Word, right-click the table above and choose “Update Field” → “Update entire table” to populate page numbers.

1. Introduction
1.1 Purpose
This Software Requirements Specification (SRS) defines the functional and non-functional requirements for the Hope Welfare Trust Hospital Management System (referred to as “the System” or “HMS”). The System is a centralised, web-based platform that digitises the hospital’s end-to-end patient journey - from reception and doctor consultation through laboratory testing, pharmacy dispensing, dialysis, billing, and inventory - with the explicit goal of creating a fully paperless workflow.
The document serves as the agreed baseline between Hope Welfare Trust (the Client) and the development team. It will be used to guide design, development, testing, and final acceptance of the delivered software.
1.2 Document Conventions
Each functional requirement carries a unique identifier in the form FR-<MODULE>-<NUMBER> (for example, FR-PHA-03). Non-functional requirements use NFR-<NUMBER>.
Requirement priority is expressed using the MoSCoW scale:
Must - essential for the first release; the System is not acceptable without it.
Should - important, but the release can proceed without it if necessary.
Could - desirable enhancement, included if time and budget allow.
1.3 Intended Audience
This document is written for the Hope Welfare Trust management and operational stakeholders (administration, pharmacy, laboratory, accounts, and clinical staff), as well as the project’s development, QA, and deployment team. Sections 1 to 3 are written in plain language for non-technical readers; Sections 4 onward contain the detailed requirements used by the technical team.
1.4 Project Scope
The System will manage the complete operational lifecycle of Hope Welfare Trust Hospital across the following functional areas. Because the hospital is located in Kashmir, where reliable internet is not available, the operational system is designed to run fully offline on-site, while a separate online layer serves donors and patients and is kept up to date by synchronisation (see Section 2.7).
Offline-first hospital operations - all clinical, pharmacy, laboratory, dialysis, inventory, billing, and cash functions run on a local server over the hospital LAN and require no internet connection.
Online donor portal - transparency and impact dashboards, donations/pledges, and reports, accessible over the internet.
Online patient portal - patients (or their family) can view their reports, prescriptions, and visit history once data has synced.
Data synchronisation - the offline hospital system syncs selected data to the online layer whenever any connectivity becomes available.
Patient registration and reception, with token-based routing between departments.
Doctor consultation with electronic patient records, test ordering, and prescription against live pharmacy stock.
Laboratory management, including test ordering, result entry, and digital report upload.
Pharmacy management with paid sales, prescription dispensing, and a QR-based pharmacy card.
Inventory and stock management for medicines and consumables.
Vendor and customer management, including medicine refund/reclaim to vendors and stock returns.
Dialysis management for scheduling and recording dialysis sessions.
Billing with multiple patient categories - Complete Free (charity), Paid, Discounted, and Staff (with an annual discount cap).
Cash flow and cash float (till) management for counters.
Role-based access control (Roles and Permissions).
Comprehensive reporting and analytics, including discount and subsidy reporting.

Out of scope (this release): Online patient self-booking/appointment requests, insurance/TPA claim processing, payroll/HR, in-patient ward and bed management, radiology PACS/imaging storage, and accounting-ledger replacement. (Note: patients can view their records online via the patient portal - this is in scope; only self-booking is deferred.) These can be considered in later phases and are noted as open items in Section 10.

1.5 Definitions, Acronyms & Abbreviations
Term
Meaning
HMS
Hospital Management System - the software described in this document.
SRS
Software Requirements Specification - this document.
OPD
Outpatient Department - walk-in consultation, the primary flow is described here.
EMR
Electronic Medical Record - the patient’s digital clinical history.
Patient ID
Unique number assigned to a patient at registration; printed on the token receipt and encoded in the QR card.
Token Receipt
Printed slip issued at reception carrying the Patient ID, used to route the patient between rooms.
QR Card
Pharmacy card carrying a QR code that encodes the Patient ID for quick scanning.
Cash Float
The fixed opening cash is placed in a counter till at the start of a shift, reconciled at close.
Cash Flow
The record of all money received and paid out across the hospital over a period.
Reclaim / Refund to Vendor
Returning purchased medicine to the supplier and recovering its value (credit or cash).
Stock Return
Medicine returned to stock by a customer or from a department.
RBAC
Role-Based Access Control - permissions granted by user role.
Complete Free
A fully subsidised charity patient who pays nothing for covered services.
MoSCoW
Prioritisation scale: Must / Should / Could / Won’t.

1.6 References
Client requirements brief and feature list supplied by Hope Welfare Trust.
Hope Welfare Trust paperless patient journey description (reproduced in Section 3).
IEEE/ISO/IEC 29148:2018 - guidance on requirements specification structure.

2. Overall Description
2.1 Product Perspective
The HMS is a new, self-contained, multi-user system that replaces the hospital’s current paper-based and manual processes. It is built around a single shared patient identity: once a patient is registered at reception, the same Patient ID follows them through every department, so the doctor, laboratory, pharmacy, dialysis unit, and accounts all read from and write to one record. This single source of truth is what makes the paperless journey possible.
The System is intended to be deployed as a web application accessible on the hospital’s internal network from reception, consultation rooms, the laboratory, the pharmacy counter, the dialysis unit, and the accounts office.
2.2 Product Functions (Summary)
At a high level, the System provides the following capabilities. Each is detailed in Section 4.
Module
Primary Purpose
Key Users
Patient Management
Register patients, maintain demographics and history, issue tokens.
Receptionist
Token & Queue
Route patients between departments using a Patient ID token.
All front-line staff
Consultation (EMR)
View patient record, order tests, and prescribe against livestock.
Doctor
Laboratory
Receive test orders, record results, and upload reports.
Lab technician
Pharmacy
Dispense prescriptions, sell medicine, and print reports.
Pharmacist
Inventory & Stock
Track medicine and consumable stock, batches, and expiry.
Pharmacy / Store
Vendor Management
Manage suppliers, purchases, returns, and reclaims.
Procurement / Accounts
Customer Management
Manage walk-in pharmacy customers and their history.
Pharmacist
Dialysis
Schedule and record dialysis sessions and consumables.
Dialysis staff
Billing & Discounts
Apply patient category, discounts, staff cap; collect payment.
Accounts / Counter
Refunds & Returns
Handle medicine returns and vendor reclaims.
Pharmacy / Accounts
Cash Flow & Float
Manage till floats and record all cash movement.
Counter / Accounts
Roles & Permissions
Control who can see and do what.
Administrator
Reporting
Operational, financial, discount, and subsidy reports.
Management
Donor Portal (online)
Impact/transparency dashboards, donations, and reports.
Donors
Patient Portal (online)
View own reports, prescriptions, and visit history.
Patients/family
Offline & Sync
Run the hospital fully offline; sync to the online layer when connected.
System / Admin

2.3 User Classes and Characteristics
User Class
Description & Typical Tasks
Administrator
Configures the System, manages users, roles, and permissions, price lists, discount rules, and patient categories. Has the broadest access.
Receptionist
Registers and searches patients, captures demographics, issues token receipts, and directs patients to the correct room.
Doctor
Opens a patient by ID/QR, reviews history and lab reports, records diagnosis, orders laboratory tests, and prescribes medicine while viewing live pharmacy stock.
Laboratory Technician
Views ordered tests for a patient, records results, and uploads the test report against the patient’s record.
Pharmacist
Opens a patient by ID/QR, views the prescription, dispenses medicine, sells over-the-counter items, handles returns, and prints the patient and test reports.
Dialysis Staff
Schedules and records dialysis sessions, consumables used, and session outcomes.
Accounts / Cashier
Manages billing, discounts, refunds, cash float, and cash flow, and reconciles tills.
Management
Views dashboards and reports (financial, operational, discount/subsidy). Typically read-only.
Donor (online)
An external user who accesses the online donor portal to view the trust’s impact and transparency reports and to make or pledge donations. Sees only aggregate, de-identified information.
Patient (online)
Patient or authorised family member who logs in to the online patient portal to view their own reports, prescriptions, and visit history once synced.

2.4 Operating Environment
The System operates as two connected tiers (described in detail in Section 2.7):
On-site hospital tier (offline): a local server at the hospital running all operational modules, with department PCs/laptops connecting over the hospital LAN. This tier requires no internet. The pharmacy and reception counters use a label/receipt printer and a QR/barcode scanner.
Online tier (cloud): the donor portal, patient portal, and trust dashboard, hosted on the internet and accessed by external users (donors, patients, management) from outside Kashmir.
Connectivity at the hospital is intermittent or absent. Synchronisation between the tiers uses whatever link is occasionally available (for example, a mobile-data hotspot, a satellite link, or a periodic connection), and falls back to manual encrypted transfer when no link exists for an extended period.
All tiers are accessed through a modern web browser (Google Chrome, Microsoft Edge, or Firefox - current versions).
2.5 Design and Implementation Constraints
Offline-first: the on-site hospital system must remain fully functional with no internet connection; loss of connectivity must never interrupt clinical or counter operations.
Local system is the source of truth for all operational data; the online tier is a synchronised, largely read-only view for donors and patients.
Synchronisation must run in the background and must not block or slow front-line operations.
The same Patient ID must be usable across all modules and both tiers; it is generated once at registration and never reused.
All clinical and financial actions must be attributable to the logged-in user and time-stamped (audit trail).
The System must support both QR/barcode scanning and manual Patient ID entry as equivalent inputs.
Discounts, free-of-charge, and staff-cap rules are configurable by the Administrator rather than hard-coded.
Stock movements (sale, dispense, return, reclaim, expiry) must always keep the inventory balance consistent.
2.6 Assumptions and Dependencies
Local power resilience: the hospital provides backup power (UPS and/or generator) so the local server and counters keep running during outages.
Each department has at least one networked computer with the necessary peripherals (printer/scanner) on the hospital LAN.
Some form of intermittent connectivity is available for sync, or the Client accepts periodic manual sync where none exists (to be confirmed - see Section 10).
Cloud hosting and a domain name are available for the online donor and patient portals.
Staff are assigned individual login accounts; shared accounts are discouraged for audit integrity.
The Client will provide master data: medicine list, test catalogue with prices, vendor list, and staff list.
The Client will confirm the exact rules for the Complete Free category and the staff discount cap (see Section 10).
Regular local backups are maintained on-site, independently of the cloud.
2.7 Deployment Architecture: Offline-First with Online Sync
This section explains how the System works, given that the hospital in Kashmir has little or no reliable internet, yet donors and patients (who do have internet elsewhere) need an online view. The design separates the System into an offline on-site tier and an online cloud tier, joined by a synchronisation layer.


Figure 1 - Offline on-site hospital tier, synchronising to the online cloud tier.
2.7.1 On-Site Hospital Tier (Offline)
A local server installed at the hospital is the system of record. Every operational module - reception, doctor/EMR, laboratory, pharmacy, inventory, dialysis, billing and cash - runs against this local server over the hospital LAN. The complete paperless patient journey of Section 3 is performed entirely offline; no step depends on the internet.
2.7.2 Online Cloud Tier
A cloud-hosted layer provides the donor portal (Section 4.16), the patient portal (Section 4.17), and the trust/management dashboard. It is accessed over the internet by users who are not at the hospital. It holds only the data that has been synced up from the hospital, and exposes donor-facing information in aggregate, de-identified form.
2.7.3 Synchronisation Layer
A sync engine keeps the cloud tier up to date with the hospital. Its behaviour:
All transactions are recorded locally first and remain valid offline; nothing is lost if there is no connection.
When any connectivity becomes available, queued changes are transmitted to the cloud automatically; the transfer resumes safely if interrupted.
Sync of operational/impact data is primarily one-way (hospital → cloud). A limited reverse flow (cloud → hospital) can carry items such as online donations/pledges, if required.
Data is encrypted in transit and at rest, and only the agreed data set leaves the hospital (donor impact figures and patient-portal records - not internal cash/vendor detail unless the trust wants it).
Where no link is available for an extended period, an encrypted data package can be exported and imported manually as a fallback.
Each side shows its sync status (last successful sync, items pending) so staff and management know how current the online view is.

Why this matters: The hospital keeps running no matter the internet or power situation, because everything important happens on the local server. Donors and patients still get an online window into the hospital - it simply reflects the state as of the last successful sync rather than the live second-by-second state.


3. End-to-End Paperless Patient Journey
The primary objective of the System is to make the patient journey paperless except for a single token receipt and the final printed reports handed over at the pharmacy. The journey below is the workflow the System must support exactly, with the system touchpoint shown for each step.
3.1 Journey Steps
Step
What Happens
System Action
1. Reception
Patient arrives and gives their details to the receptionist.
The receptionist registers the patient (or finds an existing record), the System assigns/confirms a Patient ID, and prints a token receipt showing the Patient ID. Patient is directed to the doctor’s room.
2. Consultation
Patient enters the doctor’s room with the token.
The doctor enters/scans the Patient ID and views the full patient record. If tests are required, the doctor adds them to the System and directs the patient to the laboratory.
3. Laboratory
The patient shows the token at the lab.
Lab technician enters/scans the Patient ID, sees the tests ordered by the doctor, performs them, and uploads the test report(s) into the patient’s record.
4. Diagnosis
Patient returns to the doctor.
Doctor enters/scans the Patient ID, reviews the uploaded test report(s), records the diagnosis, and prescribes medicine - while viewing which medicines are available in the pharmacy and their stock levels.
5. Pharmacy
The patient shows the token at the pharmacy.
The pharmacist enters/scans the Patient ID, sees the prescription, dispenses the medicine, and prints a copy of the patient detail report and all test reports. The patient then leaves the hospital.


Key principle: The Patient ID (entered manually or scanned from the QR card / token) is the single thread that connects reception, the doctor, the lab, and the pharmacy. No information is re-keyed and no paper file travels with the patient - only the token receipt and the final printed reports.

3.2 Notes on the Journey
A returning patient is found by searching the existing record rather than re-registering, so their history is preserved.
The QR pharmacy card (Section 4.13) lets the lab, pharmacy and doctor open the record by scanning instead of typing the ID.
Where the patient is Complete Free, Staff, or Discounted, the billing rules of Section 4.10 are applied automatically at the relevant counter.
Dialysis patients follow a dedicated flow (Section 4.9) rather than the OPD consultation flow, but use the same Patient ID and billing rules.
The entire journey runs on the on-site offline system; it does not depend on internet connectivity. Donor and patient online views are updated afterwards by sync (Section 2.7 and 4.18).

4. System Modules & Functional Requirements
This section describes each module, what it does, and its detailed functional requirements. Requirements are written so that each can be individually tested at acceptance.
4.1 Patient Management & Reception
Handles patient registration, search, demographics, and the issuing of the token receipt. This is the entry point of the paperless journey and the origin of the Patient ID used everywhere else.
Req. ID
Requirement
Priority
FR-PAT-01
Register a new patient, capturing name, gender, date of birth/age, contact number, address, CNIC/ID (optional), guardian/next-of-kin, and patient category (Complete Free / Paid / Discounted / Staff).
Must
FR-PAT-02
Automatically generate a unique, non-reusable Patient ID on registration.
Must
FR-PAT-03
Search for and retrieve an existing patient by Patient ID, name, contact number, or QR scan, to avoid duplicate registration of returning patients.
Must
FR-PAT-04
Print a token receipt showing the Patient ID (and patient name) to route the patient to the next room.
Must
FR-PAT-05
Maintain a longitudinal patient record (visits, diagnoses, prescriptions, lab reports, dialysis sessions), viewable in one place.
Must
FR-PAT-06
Edit/update patient demographics with the change recorded in the audit trail.
Must
FR-PAT-07
Flag and prevent (or warn about) likely duplicate records based on name + contact/CNIC.
Should
FR-PAT-08
Assign the patient to a doctor/department at registration and reflect this in the token.
Should
FR-PAT-09
Issue or link a QR pharmacy card to the patient (see 4.13).
Should
FR-PAT-10
Record the visit type (OPD consultation, lab-only, pharmacy-only, dialysis) for reporting.
Should

4.2 Token & Queue Management
Routes the patient between departments using the Patient ID token and gives each department a working list of who is waiting.
Req. ID
Requirement
Priority
FR-TOK-01
Generate a token tied to the Patient ID and the destination (doctor, lab, pharmacy, dialysis).
Must
FR-TOK-02
Allow any department to open the correct patient by entering or scanning the Patient ID from the token or QR card.
Must
FR-TOK-03
Show each department a queue/work-list of patients currently routed to it.
Should
FR-TOK-04
Update a patient’s status as they progress (registered → with doctor → in lab → back to doctor → in pharmacy → completed).
Should
FR-TOK-05
Reprint a token if the original is lost, without changing the Patient ID.
Could

4.3 Doctor Consultation (Electronic Medical Record)
Gives the doctor a single screen to review the patient, order tests, view results, record the diagnosis, and prescribe medicine against live pharmacy stock.
Req. ID
Requirement
Priority
FR-DOC-01
Open a patient by entering or scanning the Patient ID and display demographics and full visit history.
Must
FR-DOC-02
View previously uploaded laboratory reports for the patient, including those uploaded during the current visit.
Must
FR-DOC-03
Order one or more laboratory tests from the test catalogue and route the patient to the lab.
Must
FR-DOC-04
Record consultation notes, vitals, and the final diagnosis.
Must
FR-DOC-05
Create a prescription, selecting medicines from the catalogue with dosage, frequency, and duration.
Must
FR-DOC-06
While prescribing, show whether each medicine is available in the pharmacy and its current stock level, so the doctor can prescribe accordingly.
Must
FR-DOC-07
Warn the doctor when a prescribed medicine is out of stock or below a low-stock threshold.
Should
FR-DOC-08
Suggest available alternatives/substitutes when a medicine is unavailable.
Could
FR-DOC-09
Save the consultation so the prescription is immediately visible to the pharmacy and the order is visible to the lab.
Must
FR-DOC-10
Record referral to dialysis where applicable.
Should

4.4 Laboratory Management
Receives test orders placed by the doctor, records results, and uploads digital reports against the patient record so the doctor can review them.
Req. ID
Requirement
Priority
FR-LAB-01
Open a patient by entering or scanning the Patient ID and display the tests ordered by the doctor.
Must
FR-LAB-02
Maintain a configurable catalogue of laboratory tests with names, sample types, reference ranges, and prices.
Must
FR-LAB-03
Record test results (structured values and/or free text) for the ordered tests.
Must
FR-LAB-04
Upload a test report file (PDF/image) and attach it to the patient’s record for the current visit.
Must
FR-LAB-05
Mark a test as completed so its report becomes immediately visible to the doctor.
Must
FR-LAB-06
Apply the patient’s billing category to lab charges (Free / Paid / Discounted / Staff).
Must
FR-LAB-07
Print or reprint a lab report when required.
Should
FR-LAB-08
Maintain a lab work-list/queue of pending and completed tests.
Should
FR-LAB-09
Track laboratory consumables/reagents as inventory items (link to Section 4.6).
Could

4.5 Pharmacy Management
The pharmacy dispenses prescribed medicine against the Patient ID, sells over-the-counter items, applies the correct billing category, and prints the patient and test reports handed to the patient on the way out. The pharmacy is a paid module (sales are billed unless the patient is completely free).
Req. ID
Requirement
Priority
FR-PHA-01
Open a patient by entering or scanning the Patient ID (or QR card) and display the medicines prescribed by the doctor.
Must
FR-PHA-02
Dispense prescribed medicines, deducting the dispensed quantity from stock in real time.
Must
FR-PHA-03
Sell additional/over-the-counter items to the same patient or to a walk-in customer.
Must
FR-PHA-04
Generate a sale/dispense bill applying the patient’s category and any discount (see 4.10).
Must
FR-PHA-05
Print a copy of the patient detail report and all test reports for the patient at handover.
Must
FR-PHA-06
Select the correct batch when dispensing and follow first-expiry-first-out (FEFO) guidance.
Should
FR-PHA-07
Block or warn against dispensing expired stock.
Must
FR-PHA-08
Record the dispensing pharmacist and time against each transaction (audit).
Must
FR-PHA-09
Handle partial dispensing when the full prescribed quantity is unavailable, recording the shortfall.
Should
FR-PHA-10
Print a thermal/A5 sale receipt for paid transactions.
Should
FR-PHA-11
Look up a medicine’s price, stock, batch, and expiry quickly during a sale.
Must

4.6 Inventory & Stock Management
Tracks every medicine and consumable, by batch and expiry, and keeps the stock balance correct across purchases, sales, dispensing, returns, reclaims, and expiry write-offs.
Req. ID
Requirement
Priority
FR-INV-01
Maintain a medicine/product master with name, generic, form, strength, pack size, category, and selling price.
Must
FR-INV-02
Track stock by batch number, with manufacturer, expiry dates, and purchase cost.
Must
FR-INV-03
Increase stock on goods received against a vendor purchase (see 4.7).
Must
FR-INV-04
Decrease stock automatically on sale/dispense; adjust on returns, reclaims, and write-offs.
Must
FR-INV-05
Provide a live, accurate stock-on-hand figure per product and per batch at any time.
Must
FR-INV-06
Raise low-stock alerts against a configurable reorder level per product.
Must
FR-INV-07
Raise near-expiry and expired-stock alerts against configurable thresholds.
Must
FR-INV-08
Support manual stock adjustments (e.g., damage, count correction) with a reason and audit entry.
Must
FR-INV-09
Support stock transfer between locations/stores (e.g., main store to pharmacy counter).
Should
FR-INV-10
Provide a stock valuation (at cost) at a point in time.
Should
FR-INV-11
Maintain a complete stock-movement ledger (in/out) per product for traceability.
Must

4.7 Vendor (Supplier) Management
Manages suppliers and the purchasing of stock, and is the counterpart to the refund/reclaim process in Section 4.11.
Req. ID
Requirement
Priority
FR-VEN-01
Maintain a vendor master with name, contact, address, tax details, and payment terms.
Must
FR-VEN-02
Record purchase orders and goods-received entries that add stock with batch, expiry, and cost.
Must
FR-VEN-03
Track amounts payable to each vendor and payments made.
Must
FR-VEN-04
Record medicine returned/reclaimed to a vendor and the credit or refund received (see 4.11).
Must
FR-VEN-05
Maintain a per-vendor transaction history (purchases, returns, payments, balance).
Must
FR-VEN-06
Link each product/batch to the vendor it was purchased from.
Should

4.8 Customer Management
Manages pharmacy customers - both registered patients and walk-in buyers - and their purchase history. (“Vendors – Customers” in the brief.)
Req. ID
Requirement
Priority
FR-CUS-01
Record a pharmacy sale to a registered patient (linked by Patient ID) or to a walk-in customer.
Must
FR-CUS-02
Maintain basic walk-in customer details (name, contact) where provided.
Should
FR-CUS-03
Provide a customer/patient purchase history for returns and follow-up.
Should
FR-CUS-04
Support customer-side returns of previously sold medicine back into stock (see 4.11).
Must

4.9 Dialysis Management
Supports the hospital’s dialysis service: scheduling sessions, recording each session, the consumables used, and billing under the correct patient category.
Req. ID
Requirement
Priority
FR-DIA-01
Register/identify a dialysis patient by Patient ID and maintain their dialysis history.
Must
FR-DIA-02
Schedule dialysis sessions (date, time, machine/station, attending staff).
Must
FR-DIA-03
Record a completed session: duration, pre/post weight or vitals, and notes.
Must
FR-DIA-04
Record consumables used per session (e.g. dialyzer, tubing) and deduct them from inventory.
Should
FR-DIA-05
Apply the patient’s billing category to the session charge (Free / Paid / Discounted / Staff).
Must
FR-DIA-06
Maintain a dialysis schedule/work-list and avoid double-booking a station.
Should
FR-DIA-07
Report on dialysis sessions performed, by patient, period, and category.
Should

4.10 Billing, Patient Categories, Discounts & Staff Cap
Defines how charges are calculated across the hospital. Every billable service (consultation, lab test, medicine, dialysis) is priced from a master price list and then adjusted according to the patient’s category.
Patient Categories
Category
Billing Behaviour
Notes
Complete Free
Covered services are charged at zero to the patient (charity / fully subsidised).
The full “list” value is still recorded as a subsidy for reporting to the trust.
Paid
Charged at the full price-list rate.
Standard paying patient.
Discounted
Charged at price minus a configured discount (percentage or fixed amount).
The discount value is recorded for the discount report.
Staff
Discounted up to an annual cap (e.g., PKR 50,000 per staff member per year); beyond the cap, charged normally.
The system tracks each staff member’s discount used to date.


Req. ID
Requirement
Priority
FR-BIL-01
Maintain a configurable master price list for consultations, lab tests, medicines, and dialysis sessions.
Must
FR-BIL-02
Assign a billing category to each patient and apply it automatically wherever the patient is billed.
Must
FR-BIL-03
For Complete Free patients, charge zero for covered services while recording the full value as a subsidy given.
Must
FR-BIL-04
Apply configurable discounts (percentage or fixed) for discounted patients and record the discount amount.
Must
FR-BIL-05
For Staff, track discount consumed against an annual cap (default PKR 50,000/year); apply the discount only until the cap is reached, then bill normally.
Must
FR-BIL-06
Show the remaining staff discount allowance before applying it to a transaction.
Should
FR-BIL-07
Reset the staff annual cap automatically at the start of each defined year period.
Must
FR-BIL-08
Generate an itemised bill per visit and per transaction (consultation, lab, pharmacy, dialysis).
Must
FR-BIL-09
Record the payment method (cash, card, etc.) and link the receipt to the cash float/cash flow (4.12).
Must
FR-BIL-10
Require an authorised user to approve a category change or a manual/extra discount, with reason recorded.
Should
FR-BIL-11
Produce a discount/subsidy report showing the total value given by category, department, and period.
Must


To confirm with the Client: (1) exactly which services the Complete Free category covers (consultation only, or also lab, pharmacy, and dialysis); (2) whether the staff cap of 50k is per individual staff member or shared, and whether it covers dependents; (3) the year basis for the cap (calendar year or hospital financial year). See Section 10.

4.11 Refunds, Stock Returns & Vendor Reclaim
Covers money and stock flowing back: customers returning medicine, and the pharmacy returning medicine to a vendor to reclaim its value (for example, near-expiry, damaged, or over-supplied stock).
Req. ID
Requirement
Priority
FR-RET-01
Process a customer return of previously sold medicine, refunding the patient/customer and recording the reason.
Must
FR-RET-02
Return saleable stock back into inventory (correct batch) and exclude unsaleable stock from sale.
Must
FR-RET-03
Record a vendor reclaim/return: medicine sent back to a vendor with quantity, batch, reason, and value.
Must
FR-RET-04
Reduce inventory on a vendor reclaim and record the credit note or cash refund received from the vendor.
Must
FR-RET-05
Adjust the vendor’s payable balance by the reclaimed value.
Must
FR-RET-06
Require authorisation for refunds and reclaims above a configurable value, with a full audit trail.
Should
FR-RET-07
Report on all returns and reclaims by period, product, and vendor, including total value reclaimed.
Should
FR-RET-08
Write off expired/damaged stock that cannot be reclaimed, with reason and audit entry.
Must

4.12 Cash Flow & Cash Float Management
Manages money at the counter level. The cash float is the fixed opening cash placed in a till at the start of a shift; cash flow is the complete record of money in and out across the hospital.
Req. ID
Requirement
Priority
FR-CSH-01
Open a counter session by recording the opening cash float and the responsible user.
Must
FR-CSH-02
Record all cash received (sales, consultation, lab, dialysis) and cash paid out during the session.
Must
FR-CSH-03
Close a counter session by counting cash and reconciling against expected cash (float + receipts − payouts), recording any shortage/excess.
Must
FR-CSH-04
Maintain a cash flow record of all money movements over any chosen period, by counter and category.
Must
FR-CSH-05
Record petty cash and miscellaneous expenses against the cash flow.
Should
FR-CSH-06
Produce daily cash position and cash-flow reports (opening float, collections, payouts, closing balance).
Must
FR-CSH-07
Restrict float open/close and reconciliation to authorised roles, with an audit trail.
Must

4.13 Pharmacy QR Card
A card carrying a QR code that encodes the Patient ID, so the lab, pharmacy and doctor can open the correct record by scanning rather than typing - speeding up the paperless journey and reducing keying errors.
Req. ID
Requirement
Priority
FR-QR-01
Generate a QR code encoding the Patient ID and produce a printable pharmacy card.
Must
FR-QR-02
Open the correct patient record when the QR card is scanned at reception, doctor, lab, pharmacy, or dialysis.
Must
FR-QR-03
Treat a QR scan and a manual Patient ID entry as fully equivalent inputs everywhere.
Must
FR-QR-04
Reissue a QR card if lost, keeping the same Patient ID.
Should
FR-QR-05
Optionally print the QR code on the token receipt as well as on the card.
Could

4.14 Roles & Permissions (Access Control)
Controls who can see and do what. Access is granted by role so that, for example, a receptionist cannot dispense medicine and a pharmacist cannot edit price lists.
Req. ID
Requirement
Priority
FR-ROL-01
Provide predefined roles (Administrator, Receptionist, Doctor, Lab Technician, Pharmacist, Dialysis Staff, Accounts/Cashier, Management).
Must
FR-ROL-02
Allow the Administrator to create custom roles and assign granular permissions per module and action (view/create/edit/delete/approve).
Must
FR-ROL-03
Assign one or more roles to each user account.
Must
FR-ROL-04
Enforce permissions on every screen and action; hide or disable what a user may not access.
Must
FR-ROL-05
Require individual login credentials and support secure password policies.
Must
FR-ROL-06
Restrict sensitive actions (discount override, refunds, reclaims, price changes, float reconciliation) to authorised roles.
Must
FR-ROL-07
Maintain an audit log of logins and of every create/edit/delete/approve action with the user and timestamp.
Must
FR-ROL-08
Deactivate a user without deleting their historical activity.
Should

4.15 Reporting & Analytics
Provides operational and financial visibility for management, the accounts office, and the trust. Reports must be filterable by date range and, where relevant, by department, category, vendor, or staff member, and exportable (PDF/Excel).
Req. ID
Requirement
Priority
FR-REP-01
Discount & subsidy report - total value given by category (Free/Discounted/Staff), department, and period.
Must
FR-REP-02
Sales & revenue report - pharmacy, lab, consultation, and dialysis revenue by period and counter.
Must
FR-REP-03
Stock reports - stock-on-hand, low-stock, near-expiry/expired, and stock valuation.
Must
FR-REP-04
Stock movement/ledger report per product and batch.
Must
FR-REP-05
Vendor reports - purchases, payables, payments, and returns/reclaims by vendor and period.
Must
FR-REP-06
Returns & reclaim report - value of customer returns and vendor reclaims by period.
Must
FR-REP-07
Cash flow & cash float report - daily collections, payouts, float reconciliation, and shortages/excess.
Must
FR-REP-08
Patient & visit reports - registrations, visits, and category mix by period.
Should
FR-REP-09
Laboratory report - tests performed by type, period, and category.
Should
FR-REP-10
Dialysis report - sessions by patient, period, and category.
Should
FR-REP-11
Staff discount report - discount consumed vs. annual cap per staff member.
Must
FR-REP-12
Management dashboard - key daily figures (patients seen, revenue, subsidy given, low/expired stock).
Should
FR-REP-13
Export any report to PDF and Excel.
Must


4.16 Donor Portal (Online)
As a welfare trust, Hope Welfare relies on donors who fund free and subsidised care. The online donor portal gives donors transparency into the impact of their support and a channel to contribute. It is hosted online and shows data synced up from the hospital; donors see aggregate, de-identified information only - never individual patient medical details.
Req. ID
Requirement
Priority
FR-DON-01
Allow donors to register and log in securely to the online portal.
Must
FR-DON-02
Show an impact dashboard: number of Complete Free / subsidised patients treated, total value of free care given, and dialysis sessions funded, over selectable periods.
Must
FR-DON-03
Present fund-utilisation / where-funds-went summaries in aggregate, de-identified form.
Must
FR-DON-04
Let a donor record a donation or pledge, and optionally earmark it for a programme (e.g. dialysis, free medicine).
Must
FR-DON-05
Show each donor their own donation history and issue/download donation receipts.
Should
FR-DON-06
Publish and let donors download periodic transparency / annual impact reports.
Should
FR-DON-07
Integrate an online payment option for donations (subject to gateway availability - see Section 10).
Could
FR-DON-08
Ensure no patient's personally identifiable or medical information is ever exposed to donors.
Must
FR-DON-09
Reflect that figures are current as of the last successful sync, with the date shown.
Should

4.17 Patient Portal (Online)
The online patient portal lets a patient (or an authorised family member) view their own records from anywhere with internet, once the hospital has synced. It is read-only and strictly limited to the logged-in patient’s own data.
Req. ID
Requirement
Priority
FR-PP-01
Allow a patient to securely access their own record using their Patient ID and a secure credential/verification.
Must
FR-PP-02
Display the patient’s visit history, diagnoses, prescriptions, and laboratory reports.
Must
FR-PP-03
Allow the patient to download/print their reports.
Should
FR-PP-04
Restrict every patient strictly to their own data; never expose other patients’ information.
Must
FR-PP-05
Indicate that data is current as of the last successful sync, with the date shown.
Should
FR-PP-06
Obtain and record patient consent for storing their records in the online tier.
Should
FR-PP-07
Online appointment/booking requests are deferred to a later phase (out of scope this release).
Could

4.18 Offline Operation & Data Synchronisation
This module defines how the System behaves with respect to connectivity. It is what makes the offline-first design of Section 2.7 work in practice, and is critical given the Kashmir location.
Req. ID
Requirement
Priority
FR-SYN-01
Run every operational module (Sections 4.1–4.15) fully offline on the local server, with no dependence on internet connectivity.
Must
FR-SYN-02
Record all transactions locally first; the local system remains the authoritative source of truth.
Must
FR-SYN-03
Detect when connectivity is available and automatically transmit queued changes to the online tier.
Must
FR-SYN-04
Resume an interrupted sync safely without duplicating or losing data (idempotent, resumable).
Must
FR-SYN-05
Encrypt synced data in transit and at rest; transmit only the agreed data set (donor impact figures and patient-portal records).
Must
FR-SYN-06
Support a limited reverse flow (online → hospital) for items such as online donations/pledges, where required.
Should
FR-SYN-07
Provide a manual encrypted export/import fallback for periods when no connection is available at all.
Should
FR-SYN-08
Display sync status on both tiers: last successful sync time and number of items pending.
Must
FR-SYN-09
Apply clear conflict-resolution rules, with the hospital record taking precedence for operational data.
Should
FR-SYN-10
Allow configuration of what data is synced and how often, by the Administrator.
Should
FR-SYN-11
Keep operational performance unaffected regardless of connectivity state (sync runs in the background).
Must


5. Key Data Entities
The following are the principal entities the System maintains. This is an indicative model for shared understanding; the final database design will be produced during the design phase.
Entity
Main Information Held
Patient
Patient ID, demographics, contact, category (Free/Paid/Discounted/Staff), QR card link, and visit history.
Visit / Encounter
Visit ID, Patient ID, date, type (OPD/lab/pharmacy/dialysis), assigned doctor, status.
Token
Token ID, Patient ID, destination department, status, timestamp.
Consultation
Visit ID, doctor, notes, vitals, diagnosis, ordered tests, and prescription.
Lab Test Order & Result
Visit ID, test(s) ordered, result values, uploaded report file, and status.
Prescription
Visit ID, medicines with dosage/frequency/duration, and prescribing doctor.
Medicine / Product
Product ID, name, generic, form, strength, pack, selling price, reorder level.
Stock Batch
Product ID, batch number, expiry, quantity on hand, purchase cost, vendor.
Stock Movement
Product/batch, type (purchase/sale/dispense/return/reclaim/adjustment/write-off), quantity, user, time.
Vendor
Vendor ID, contact, terms, payable balance, transaction history.
Purchase / Goods Received
Vendor, items with batch/expiry/cost, total value, date.
Customer
Patient link or walk-in details, purchase history.
Dialysis Session
Patient ID, date/time, station, staff, consumables, charge.
Bill / Transaction
Visit/sale reference, items, list value, discount/subsidy, payable, payment method.
Cash Session
Counter, user, opening float, collections, payouts, closing balance, variance.
User & Role
User account, assigned role(s), permissions, status, audit log entries.
Donor & Donation
Donor account, donations/pledges, earmarked programme, amount, date, receipt.
Sync Record
What was synced, direction, timestamp, status, pending/failed items.


6. External Interface Requirements
6.1 User Interfaces
A clean, web-based interface usable on standard desktop screens at each counter.
Fast patient lookup by ID, name, contact, or QR scan from any module.
Department-appropriate screens (reception, doctor, lab, pharmacy, dialysis, accounts) showing only what each role needs.
Clear stock, price, and discount information visible at the point of decision (e.g., doctor sees stock while prescribing).
6.2 Hardware Interfaces
QR/barcode scanner at reception, lab, and pharmacy for scanning the QR card/token.
Receipt/label printer at reception (tokens) and pharmacy (receipts and reports).
Standard A4 printer for lab and patient reports.
6.3 Software Interfaces
A modern web browser on each client device.
Server database for centralised storage.
PDF/Excel generation for reports and printed documents.
6.4 Communication Interfaces
Local network connectivity between counters and the server.
Secure (encrypted) connections for any access over the internet, if cloud-hosted.

7. Non-Functional Requirements
Req. ID
Requirement
Priority
NFR-01
Performance - patient lookup and common screens respond within ~2 seconds under normal load; QR scan opens the record near-instantly.
Must
NFR-02
Concurrency - supports multiple simultaneous users across reception, doctors, lab, pharmacy, and accounts without data conflicts.
Must
NFR-03
Security - enforce authenticated login, role-based access, and protection of patient and financial data; passwords stored securely (hashed).
Must
NFR-04
Data integrity - stock balances and cash positions must always reconcile; no transaction may leave the data inconsistent.
Must
NFR-05
Auditability - every clinical and financial action is attributable to a user and time-stamped and cannot be silently altered.
Must
NFR-06
Privacy & confidentiality - patient medical information is visible only to authorised roles.
Must
NFR-07
Reliability & availability - the System is available during all hospital operating hours; planned maintenance is scheduled outside peak times.
Must
NFR-08
Backup & recovery - automated regular backups with a documented restore procedure.
Must
NFR-09
Usability - front-line screens are simple enough for staff to use with minimal training.
Should
NFR-10
Scalability - the System accommodates growth in patients, products, and users without redesign.
Should
NFR-11
Maintainability - configuration (prices, discounts, categories, reorder levels) is changeable by an Administrator without code changes.
Should
NFR-12
Data retention - patient and transaction history is retained per the hospital’s retention policy.
Should
NFR-13
Offline availability - the on-site hospital system must run with zero internet connectivity for an indefinite period without loss of function.
Must
NFR-14
Power resilience - the System must tolerate power interruptions, relying on the hospital’s UPS/generator, and recover cleanly on restart.
Must
NFR-15
Sync reliability - synchronisation must be resumable and idempotent: no duplicate, lost, or corrupted data across interruptions.
Must
NFR-16
Sync security - all synced data is encrypted in transit and at rest; only the agreed data set leaves the hospital.
Must
NFR-17
Donor data privacy - the online donor view must contain only aggregate, de-identified information; no patient PII.
Must
NFR-18
Local-first independence - operational performance and availability must not depend on connectivity or on the cloud tier being reachable.
Must
NFR-19
Local backup - on-site backups are maintained independently of the cloud, so data survives even if sync has not run.
Must


8. Requirement Traceability – Client Brief Coverage
This table confirms that every item from the Client’s original brief is addressed in this document, so nothing is lost between the brief and the specification.
Client Brief Item
Addressed In
Pharmacy Software (paid)
4.5 Pharmacy Management; 4.10 Billing
Discount (report)
4.10 Billing & Discounts; 4.15 Reporting (FR-REP-01)
Pharmacy card (QR)
4.13 Pharmacy QR Card
Stock Management
4.6 Inventory & Stock Management
Vendors – Customers
4.7 Vendor Management; 4.8 Customer Management
Inventory Management
4.6 Inventory & Stock Management
Complete Free
4.10 Patient Categories (Complete Free)
Refund Medicine to Vendor / Reclaim
4.11 Refunds, Returns & Vendor Reclaim
Staff Discount (50k/yearly)
4.10 Billing (Staff cap, FR-BIL-05/06/07); 4.15 (FR-REP-11)
Stock Return
4.11 Refunds, Stock Returns & Vendor Reclaim
Cash Flow
4.12 Cash Flow & Cash Float
Reporting
4.15 Reporting & Analytics
Cash Float
4.12 Cash Flow & Cash Float
Patient Management
4.1 Patient Management & Reception
Vendor Management
4.7 Vendor Management
Laboratory Management
4.4 Laboratory Management
Roles and Permissions
4.14 Roles & Permissions
Dialysis
4.9 Dialysis Management
Paperless customer journey
3. End-to-End Paperless Patient Journey
Works offline (Kashmir, no internet)
2.7 Deployment Architecture; 4.18 Offline Operation & Data Synchronisation
Online for donors
2.7 Deployment Architecture; 4.16 Donor Portal
Online for patients
2.7 Deployment Architecture; 4.17 Patient Portal
Offline + online data synchronisation
4.18 Offline Operation & Data Synchronisation


9. Assumptions, Constraints & Acceptance
9.1 Assumptions
Hardware (PCs, printers, scanners) and the network are provided and maintained by the hospital.
Master data (medicines, tests, prices, vendors, staff) is supplied by the Client before go-live.
Staff will be available for training and for user-acceptance testing.
9.2 Constraints
The paperless journey of Section 3 must be supported exactly as described.
Patient ID is the single identifier shared by all modules.
All financial and stock rules are configurable rather than hard-coded.
9.3 Acceptance Criteria (high level)
A patient can complete the full journey (reception → doctor → lab → doctor → pharmacy) using only the Patient ID/QR, with reports printed at the pharmacy.
All “Must” requirements in this document are demonstrated and passed testing.
Billing correctly applies Free, Paid, Discounted, and Staff (with cap) categories, and the discount/subsidy report reconciles.
Stock and cash balances reconcile after sales, dispensing, returns, reclaims, and float close.

10. Open Items to Confirm with the Client
The following points should be confirmed to finalise this specification. They do not block starting work on the core modules, but must be resolved before the related features are built.
#
Open Item
Why It Matters
1
What connectivity (if any) is realistically available at the hospital - a mobile-data signal, a satellite link (e.g., Starlink), periodic trips to a connected town, or none at all?
This is the single biggest decision: it determines the sync method, how fresh the online view can be, and whether manual sync is needed.
2
What exactly should donors see online - aggregate impact only, or more - and is an online payment gateway needed for donations?
Defines the donor portal (4.16) and any payment integration.
3
Should patients access their records online, and is that operationally and culturally desired? What consent model applies?
Defines the patient portal (4.17) and consent handling.
4
Data residency - which patient data is permitted to leave the hospital for the cloud, and under what safeguards?
Determines what the sync layer is allowed to transmit (4.18).
5
Power reliability - is a UPS and/or generator in place to keep the local server and counters running?
Underpins the offline-first guarantee (NFR-13/14).
6
Exact scope of the Complete Free category - does it cover consultation only, or also lab, pharmacy, and dialysis?
Determines billing rules and subsidy reporting.
7
Staff discount cap - is PKR 50,000/year per individual? Does it include dependents? Calendar or financial year?
Determines staff-cap tracking and reset logic.
8
Whether a separate consultation fee is charged, and its amount(s) per doctor/department.
Affects reception/billing and revenue reporting.
9
Number of physical counters/tills needing independent cash floats.
Affects cash float/session design.
10
Whether lab reports are produced inside the System or only uploaded as files.
Affects laboratory module depth.
11
Number of dialysis stations and typical weekly session volume.
Affects scheduling design.
12
Preferred QR card format and whether cards are pre-printed or printed on demand.
Affects the QR card module.


11. Revision History & Sign-off
11.1 Revision History
Version
Date
Summary of Changes
1.0
19 June 2026
Initial draft for client review, refined from the client requirements brief and patient-journey description.
1.1
19 June 2026
Added offline-first deployment architecture for the Kashmir location (Section 2.7), online Donor Portal (4.16) and Patient Portal (4.17), Offline Operation & Data Synchronisation (4.18), and related NFRs, traceability, and open items.


11.2 Sign-off
By signing below, the Client confirms that this specification correctly captures the requirements for the Hope Welfare Trust Hospital Management System.
