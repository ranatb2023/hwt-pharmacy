# Architecture Overview

## System Architecture
The HMS is designed as an offline-first, web-based platform with two main tiers:

- **On-site hospital tier**: local server and hospital LAN for all clinical and administrative operations
- **Online cloud tier**: donor portal, patient portal, and management dashboard updated through synchronization

## Offline-First Design
- The hospital tier is the authoritative source of operational data.
- All modules must work fully without internet connectivity.
- Local data is recorded first and remains consistent even when sync is unavailable.
- Synchronization runs in the background and must not block hospital operations.

## Online Tier
- The online tier hosts external-facing portals for donors and patients.
- Only agreed data is synced from the hospital tier.
- Data is de-identified for donors and patient-specific only for authorized patient portal access.
- Online pages indicate the last successful sync time.

## Synchronization Layer
- Detects connectivity and transfers queued changes securely.
- Uses idempotent, resumable sync operations to avoid duplicates and data loss.
- Supports a manual encrypted export/import fallback when no direct connection exists.
- Provides sync status and pending item counts on both tiers.

## Core Modules
- Patient Management
- Token & Queue Management
- Doctor Consultation / EMR
- Laboratory Management
- Pharmacy Management
- Inventory & Stock Management
- Vendor / Customer Management
- Dialysis Management
- Billing and Cash Flow
- Reporting and Analytics
- Roles & Permissions

## Data Flow
1. Patient registration generates a unique Patient ID and token.
2. Doctor consults the patient, orders lab tests, and writes a prescription.
3. Laboratory and pharmacy perform work against the same Patient ID.
4. Billing applies the patient category and produces receipts.
5. Data is stored on the on-site database and queued for sync.
6. Sync engine exports agreed data to the cloud tier when connectivity is available.

## Key Data Entities
- Patient
- Visit / Encounter
- Token
- Consultation
- Lab Test Order & Result
- Prescription
- Product / Medicine
- Stock Batch
- Stock Movement
- Vendor / Purchase / Reclaim
- Customer / Sale
- Dialysis Session
- Bill / Transaction
- Cash Session
- User & Role
- Donor & Donation
- Sync Record

## Deployment Considerations
- Local on-site server must be accessible over hospital LAN from counters and department devices.
- Connect printers and QR/barcode scanners to relevant workstations.
- Use modern browsers such as Chrome, Edge, or Firefox.
- Secure online connections with HTTPS and encryption for synced payloads.
- Implement regular on-site backups independent of cloud sync.

## Security and Compliance
- Authenticate all users and enforce role-based access control.
- Hash passwords and store credentials securely.
- Audit all create/edit/delete/approve actions with user/timestamp.
- Restrict sensitive actions to authorized roles.
- Protect patient privacy and financial data.
- Keep donor portal data aggregated and de-identified.

## Performance Goals
- Patient lookup and common screens should respond within 2 seconds.
- QR scan should open patient records near-instantly.
- The local system should support simultaneous users across departments without data conflicts.
