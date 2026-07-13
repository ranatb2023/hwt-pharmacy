import React from 'react';
import Hub from '../components/Hub.jsx';

const OPTIONS = [
  { to: '/lab', perm: 'lab.view', icon: 'lab', title: 'Lab Work-list', desc: 'Process ordered tests, record results and upload reports.' },
  { to: '/patients', perm: 'patient.view', icon: 'patients', title: 'Find Patient', desc: 'Open a patient record by name, ID or contact.' },
];

export default function LabHome() {
  return <Hub options={OPTIONS} />;
}
