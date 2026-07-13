import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { money, Loading, Alert } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (can('report.view') || can('billing.view')) {
      api.get('/reports/dashboard').then(setStats).catch((e) => setErr(e.message));
    } else {
      setStats({});
    }
  }, []);

  if (!stats) return <Loading />;

  const cards = [
    { label: 'Patients Today', value: stats.patients_today, cls: 'accent' },
    { label: 'Total Patients', value: stats.patients_total },
    { label: 'Tokens Today', value: stats.tokens_today },
    { label: 'Lab Pending', value: stats.lab_pending, cls: 'warn' },
    { label: 'Revenue Today', value: money(stats.revenue_today), cls: 'accent' },
    { label: 'Subsidy Today', value: money(stats.subsidy_today), cls: 'warn' },
    { label: 'Low-Stock Items', value: stats.low_stock, cls: stats.low_stock > 0 ? 'danger' : '' },
  ];

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <div className="card mb">
        <h3>Welcome, {user?.full_name}</h3>
        <div className="muted">
          Role: <b>{user?.role}</b>{user?.department ? ` · ${user.department}` : ''}. Use the menu to open the module you need.
        </div>
      </div>

      {stats.patients_total != null && (
        <div className="grid cols-4 mb">
          {cards.map((c) => (
            <div key={c.label} className={`stat ${c.cls || ''}`}>
              <div className="label">{c.label}</div>
              <div className="value">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid cols-3">
        {can('patient.manage') && <QuickCard to="/patients/new" icon="register" title="Register Patient" desc="Create a new patient record and issue a token." />}
        {can('token.manage') && <QuickCard to="/queue" icon="queue" title="Queue" desc="View department work-lists and manage tokens." />}
        {can('lab.view') && <QuickCard to="/lab" icon="lab" title="Laboratory" desc="Process ordered tests and record results." />}
        {can('pharmacy.sell') && <QuickCard to="/pharmacy" icon="pharmacy" title="Pharmacy" desc="Dispense prescriptions and sell OTC items." />}
        {can('inventory.view') && <QuickCard to="/inventory" icon="inventory" title="Inventory" desc="Manage products, stock and alerts." />}
        {can('billing.view') && <QuickCard to="/billing" icon="billing" title="Billing" desc="Generate itemized bills with category rules." />}
      </div>
    </div>
  );
}

function QuickCard({ to, icon, title, desc }) {
  return (
    <Link to={to} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="flex between">
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={23} /></div>
        <span style={{ color: 'var(--primary)', fontSize: 20 }}>→</span>
      </div>
      <h3 style={{ margin: '14px 0 6px' }}>{title}</h3>
      <div className="muted">{desc}</div>
    </Link>
  );
}
