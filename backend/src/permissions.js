// Central catalogue of permission keys enforced across the system.
const PERMISSIONS = {
  PATIENT_VIEW: 'patient.view',
  PATIENT_MANAGE: 'patient.manage',
  TOKEN_MANAGE: 'token.manage',
  CONSULT_MANAGE: 'consult.manage',
  LAB_VIEW: 'lab.view',
  LAB_MANAGE: 'lab.manage',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  PHARMACY_DISPENSE: 'pharmacy.dispense',
  PHARMACY_SELL: 'pharmacy.sell',
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
  BILLING_OVERRIDE: 'billing.override',   // manual discounts / overrides
  VENDOR_VIEW: 'vendor.view',
  VENDOR_MANAGE: 'vendor.manage',
  RETURN_MANAGE: 'return.manage',
  DIALYSIS_VIEW: 'dialysis.view',
  DIALYSIS_MANAGE: 'dialysis.manage',
  CASH_MANAGE: 'cash.manage',
  DONOR_MANAGE: 'donor.manage',
  SYNC_MANAGE: 'sync.manage',
  REPORT_VIEW: 'report.view',
  USER_MANAGE: 'user.manage',
  AUDIT_VIEW: 'audit.view',
};

const ALL = Object.values(PERMISSIONS);

// Predefined roles shipped with the system.
const DEFAULT_ROLES = [
  { name: 'Administrator', description: 'Full system access', permissions: ALL },
  {
    name: 'Receptionist',
    description: 'Patient registration and tokens',
    permissions: [
      PERMISSIONS.PATIENT_VIEW, PERMISSIONS.PATIENT_MANAGE,
      PERMISSIONS.TOKEN_MANAGE, PERMISSIONS.BILLING_VIEW,
    ],
  },
  {
    name: 'Doctor',
    description: 'Consultation and EMR',
    permissions: [
      PERMISSIONS.PATIENT_VIEW, PERMISSIONS.CONSULT_MANAGE,
      PERMISSIONS.LAB_VIEW, PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.DIALYSIS_VIEW, PERMISSIONS.DIALYSIS_MANAGE,
    ],
  },
  {
    name: 'Lab Technician',
    description: 'Laboratory work-list and results',
    permissions: [
      PERMISSIONS.PATIENT_VIEW, PERMISSIONS.LAB_VIEW, PERMISSIONS.LAB_MANAGE,
    ],
  },
  {
    name: 'Pharmacist',
    description: 'Dispensing, sales and stock',
    permissions: [
      PERMISSIONS.PATIENT_VIEW, PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_MANAGE,
      PERMISSIONS.PHARMACY_DISPENSE, PERMISSIONS.PHARMACY_SELL,
      PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.VENDOR_VIEW, PERMISSIONS.VENDOR_MANAGE, PERMISSIONS.RETURN_MANAGE,
      PERMISSIONS.CASH_MANAGE,
    ],
  },
  {
    name: 'Cashier',
    description: 'Billing, payments and cash flow',
    permissions: [
      PERMISSIONS.PATIENT_VIEW, PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.CASH_MANAGE, PERMISSIONS.RETURN_MANAGE,
    ],
  },
];

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES };
