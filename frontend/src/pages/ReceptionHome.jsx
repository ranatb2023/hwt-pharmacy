import React from 'react';
import Hub from '../components/Hub.jsx';

const OPTIONS = [
  { to: '/patients/new', perm: 'patient.manage', icon: 'register', title: 'Register Patient', desc: 'Create a new patient record and issue a token.' },
  { to: '/patients', perm: 'patient.view', icon: 'patients', title: 'All Patients', desc: 'Search and open existing patient records.' },
  { to: '/queue', perm: 'token.manage', icon: 'queue', title: 'Token & Queue', desc: 'Route patients and manage department queues.' },
  { to: '/billing', perm: 'billing.view', icon: 'billing', title: 'Billing', desc: 'Generate itemised bills and collect payment.' },
];

export default function ReceptionHome() {
  return <Hub options={OPTIONS} />;
}
