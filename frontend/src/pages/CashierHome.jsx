import React from 'react';
import Hub from '../components/Hub.jsx';

const OPTIONS = [
  { to: '/billing', perm: 'billing.view', icon: 'billing', title: 'Billing', desc: 'Generate itemised bills and collect payment.' },
  { to: '/patients', perm: 'patient.view', icon: 'patients', title: 'Find Patient', desc: 'Open a patient record to bill or review.' },
  { to: '/returns', perm: 'return.manage', icon: 'returns', title: 'Returns & Refunds', desc: 'Process refunds and record reasons.' },
  { to: '/cashflow', perm: 'cash.manage', icon: 'cashflow', title: 'Cash Flow', desc: 'Open/close the till and reconcile cash.' },
];

export default function CashierHome() {
  return <Hub options={OPTIONS} />;
}
