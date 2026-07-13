import React from 'react';
import Hub from '../components/Hub.jsx';

const OPTIONS = [
  { to: '/pharmacy', perm: 'pharmacy.sell', icon: 'pharmacy', title: 'Pharmacy', desc: 'Dispense prescriptions and sell OTC items.' },
  { to: '/inventory', perm: 'inventory.view', icon: 'inventory', title: 'Inventory', desc: 'Manage stock, batches and expiry alerts.' },
  { to: '/billing', perm: 'billing.view', icon: 'billing', title: 'Billing', desc: 'Generate itemised bills and collect payment.' },
  { to: '/returns', perm: 'return.manage', icon: 'returns', title: 'Returns', desc: 'Process customer returns and restock.' },
  { to: '/vendors', perm: 'vendor.view', icon: 'vendors', title: 'Vendors', desc: 'Suppliers, purchases and reclaims.' },
  { to: '/cashflow', perm: 'cash.manage', icon: 'cashflow', title: 'Cash Flow', desc: 'Open/close the till and reconcile cash.' },
];

export default function PharmacyHome() {
  return <Hub options={OPTIONS} />;
}
