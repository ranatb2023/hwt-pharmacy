# Hope Welfare Trust Hospital Management System

## Project Overview
Hope Welfare Trust Hospital Management System (HMS) is an offline-first, web-based hospital management solution designed for Hope Welfare Trust.
The system supports complete patient lifecycle management across reception, doctor consultation, laboratory, pharmacy, dialysis, billing, inventory, vendor management, cash management, and reporting.

## Purpose
This repository contains the initial project documents and planning assets needed to begin design and development of the HMS.

## Key Features
- Patient registration, token issuance, longitudinal patient history
- Doctor consultation with EMR, test ordering, and prescription against live pharmacy stock
- Laboratory test processing, result entry, and digital report uploads
- Pharmacy dispensing, sales, returns, batch tracking, and QR-based patient access
- Inventory management with batch, expiry, low-stock, and valuation tracking
- Billing with patient categories: Complete Free, Paid, Discounted, and Staff
- Dialysis scheduling and session management
- Vendor purchase and reclaim management
- Offline-first operation with an online donor portal and patient portal via sync
- Role-based access control and audit logging

## Documents
- `PROJECT_PLAN.md` — project phases, milestones, assumptions, and next steps
- `ARCHITECTURE_OVERVIEW.md` — system architecture, offline/online tiers, sync model, and data flow
- `MODULES_AND_FEATURES.md` — module breakdown, core functional requirements, and key entities

## Next Steps
1. Review and approve the requirement summary and project plan.
2. Select the technology stack for frontend, backend, local hosting, and sync.
3. Create the initial system design and data model.
4. Begin implementation of the offline on-site application and synchronization engine.

## Notes
This project is structured around the SRS in `Requirements.md` and emphasizes a fully operational offline hospital system with a synchronized online layer for donors and patients.
