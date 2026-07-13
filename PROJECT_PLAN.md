# HMS Project Plan

## Purpose
This document defines the initial project plan for building the Hope Welfare Trust Hospital Management System.

## Project Scope
Build a hospital management system that runs fully offline on-site, with an online donor portal and patient portal that receive data via synchronization.

### In-Scope
- Offline hospital operations: reception, consultation, lab, pharmacy, dialysis, billing, inventory, vendor, cash, reporting
- Role-based access control and audit logging
- Online donor portal for impact reporting and donations
- Online patient portal for visit history and reports
- Data synchronization between on-site hospital tier and cloud tier

### Out-of-Scope for Initial Release
- Online patient self-booking/appointment requests
- Insurance/TPA claims processing
- Payroll/HR module
- In-patient ward and bed management
- Radiology/PACS imaging storage
- Full accounting ledger replacement

## Phases

### Phase 1: Requirements Validation and Architecture
- Review and confirm requirements with stakeholders
- Resolve open client items for connectivity, free care scope, staff cap rules, and data residency
- Define technology stack and deployment approach
- Produce architecture diagrams and database model

### Phase 2: Core Offline Hospital System
- Implement patient management, token/queue, doctor consultation, lab, pharmacy, inventory, billing, and cash flow
- Add QR card support and role-based access control
- Build audit logging and user management
- Validate offline functionality on local network

### Phase 3: Online Portals and Sync
- Build donor portal and patient portal read-only views
- Implement synchronization engine and status reporting
- Add export/import fallback for manual sync
- Secure cloud hosting and encryption for data in transit and at rest

### Phase 4: Reporting and Stabilization
- Implement operational, financial, stock, vendor, returns, dialysis, and dashboard reports
- Conduct usability testing and performance validation
- Perform backup, recovery, and power-resilience testing
- Prepare user documentation and training materials

### Phase 5: Acceptance and Deployment
- Execute user acceptance testing with Hope Welfare Trust staff
- Address defects and confirm acceptance criteria
- Deploy on-site hospital server and support initial go-live

## Milestones
- M1: Requirements and architecture approved
- M2: Offline hospital MVP complete
- M3: Synchronization and online portals operational
- M4: Reporting and QA complete
- M5: Production deployment and go-live

## Assumptions
- Hospital provides local network infrastructure, PCs, printers, scanners, and power backup
- Master data for medicines, tests, vendors, staff, and prices is available before implementation
- Staff logins are available and training is provided for acceptance testing
- Intermittent connectivity or manual sync method is available for online updates

## Open Items to Confirm
- Available network/connectivity options at the hospital
- Online donor portal content and payment gateway requirements
- Patient portal access, consent, and patient verification model
- Data residency and permitted cloud sync scope
- Exact coverage rules for Complete Free patients
- Staff discount cap details and reset period
- Number of counters/tills and cash float requirements
- Lab report production format and dialysis station count

## Risks
- No reliable internet may delay online portal sync and require manual fallback
- Incomplete master data may slow configuration of inventory, billing, and reports
- Role/permission errors may expose sensitive medical or financial data
- Offline sync failures may create data consistency issues if not properly managed

## Next Actions
- Confirm the technology stack and environment for the hospital on-site tier
- Draft the data model and API/service boundaries
- Assign development tasks to implementation teams
