# Modules and Features

## Overview
This document summarizes the key modules, feature requirements, and entities needed to build the HMS.

## Module Breakdown

### Patient Management & Reception
- Register new patients with demographics, category, contact, CNIC, guardian, and visit type
- Generate unique Patient ID and issue a token receipt
- Search by Patient ID, name, contact, and QR scan
- Maintain longitudinal patient history and edit demographics with audit tracking
- Optionally assign doctor/department and link or print QR pharmacy cards

### Token & Queue Management
- Generate department-specific tokens tied to Patient ID
- Allow patient lookup by manual ID or QR scan
- Display queue/work-list for each department
- Track patient status from registration through completion
- Reprint token receipts without changing Patient ID

### Doctor Consultation (EMR)
- Open patient records with ID/QR scan
- View full visit history and lab results
- Order lab tests and route patients
- Record consultation notes, vitals, diagnosis, and referrals
- Create prescriptions with dosage, frequency, and duration
- Display pharmacy stock availability and low-stock warnings
- Save consultation data so lab and pharmacy see it immediately

### Laboratory Management
- Open patient by ID/QR and display ordered tests
- Configure lab test catalogue with sample type, range, and price
- Record results and upload PDF/image reports
- Mark tests complete and make reports visible to doctors
- Apply billing category to lab charges and print reports
- Maintain lab work-list/queue of pending/completed tests

### Pharmacy Management
- Open patient by ID/QR and view prescribed medicines
- Dispense medicines and deduct stock in real time
- Sell OTC items to patients or walk-in customers
- Generate sale bills applying patient category and discounts
- Print patient report copies and test reports at handover
- Enforce FEFO batch selection and warn on expired stock
- Support partial dispensing, returns, and sales receipts

### Inventory & Stock Management
- Maintain medicine/product master data
- Track stock by batch, expiry, manufacturer, and cost
- Add stock on purchase, reduce on sale/dispense, adjust on returns/reclaims/write-offs
- Show live stock-on-hand and batch details
- Raise low-stock and near-expiry/expired alerts
- Support manual stock adjustments and stock transfers
- Provide stock valuation and movement ledger reports

### Vendor / Supplier Management
- Maintain vendor master data and purchase records
- Record goods received with batch, expiry, and cost
- Track payables and payments per vendor
- Record vendor reclaims with quantity, batch, reason, and value
- Adjust vendor balances and preserve transaction history

### Customer Management
- Link pharmacy sales to registered patients or walk-in customers
- Capture walk-in customer details when available
- Provide purchase history for returns and follow-up
- Process customer returns with refunds and inventory corrections

### Dialysis Management
- Identify dialysis patients by Patient ID and maintain history
- Schedule sessions, assign station and staff, and avoid conflicts
- Record session details, vitals, consumables used, and charges
- Deduct consumables from inventory and apply billing category
- Report on dialysis activity by period and category

### Billing, Discounts, and Staff Cap
- Maintain pricing for consultation, lab, pharmacy, and dialysis
- Automatically apply patient category billing rules
- Charge Complete Free patients zero and record subsidy value
- Apply configured discounts for Discounted patients
- Track staff discount usage against an annual cap
- Show staff discount allowance before billing
- Produce itemized bills and link payments to cash flow
- Require authorization for overrides and manual discounts

### Refunds, Returns, and Reclaims
- Process customer medicine returns with refund reason
- Return saleable stock to inventory and exclude unsaleable items
- Record vendor returns/reclaims and receive credit or cash refund
- Adjust inventory and vendor payables accordingly
- Require authorization for high-value refunds and reclaims
- Write off expired/damaged stock with audit tracking

### Cash Flow & Cash Float
- Open/close counter sessions with opening float and responsible user
- Record all cash received and paid out during the session
- Reconcile expected cash against counted cash at close
- Track petty cash, miscellaneous expenses, and cash flow by period
- Produce daily cash position and float reconciliation reports

### Roles & Permissions
- Provide predefined roles and allow custom roles with granular permissions
- Assign roles to users and enforce access on every screen/action
- Support secure login credentials and password policies
- Restrict sensitive actions like discounts, refunds, and float reconciliation
- Maintain a complete audit log of user actions and login events
- Deactivate users without removing historical activity

### Reporting & Analytics
- Provide discount/subsidy, revenue, stock, vendor, returns, cash flow, patient, lab, and dialysis reports
- Offer management dashboard metrics for daily operational visibility
- Export reports to PDF and Excel
- Filter reports by date, department, category, vendor, and staff

### Donor Portal (Online)
- Secure donor registration and login
- Display impact dashboard and fund utilisation summaries
- Allow donations/pledges and issuance of receipts
- Keep donor data aggregated and de-identified
- Reflect data freshness based on last sync timestamp

### Patient Portal (Online)
- Secure patient access to their own visit history, prescriptions, and reports
- Allow patients to download/print their records
- Enforce strict data isolation per patient
- Show last sync date and record patient consent for online storage

### Offline Operation & Sync
- Keep all operational modules fully functional offline
- Record transactions locally first and remain source of truth
- Automatically sync when connectivity is available
- Ensure sync is encrypted, resumable, idempotent, and configurable
- Provide manual export/import fallback when needed
- Display sync status in both tiers and resolve conflicts in favor of hospital data

## Key Entities
- Patient
- Visit / Encounter
- Token
- Consultation
- Lab Test Order & Result
- Prescription
- Medicine/Product
- Stock Batch
- Stock Movement
- Vendor
- Purchase / Goods Received
- Customer
- Dialysis Session
- Bill / Transaction
- Cash Session
- User & Role
- Donor & Donation
- Sync Record

## Non-Functional Requirements to Target
- Fast lookup and screen response times
- Concurrent multi-user support without conflicts
- Strong authentication and role-based security
- Data integrity for stock and cash balances
- Comprehensive audit trails
- Patient privacy and data confidentiality
- Reliable offline availability and local backup
- Secure sync and cloud data handling
