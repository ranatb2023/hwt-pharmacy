import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Connectivity from './Connectivity.jsx';
import { Icon } from './icons.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', perm: null, end: true },
  { to: '/patients', label: 'Patients', icon: 'patients', perm: 'patient.view' },
  { to: '/queue', label: 'Token & Queue', icon: 'queue', perm: 'token.manage' },
  { to: '/lab', label: 'Laboratory', icon: 'lab', perm: 'lab.view' },
  { to: '/pharmacy', label: 'Pharmacy', icon: 'pharmacy', perm: 'pharmacy.sell' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory', perm: 'inventory.view' },
  { to: '/dialysis', label: 'Dialysis', icon: 'dialysis', perm: 'dialysis.view' },
  { to: '/billing', label: 'Billing', icon: 'billing', perm: 'billing.view' },
  { to: '/returns', label: 'Returns', icon: 'returns', perm: 'return.manage' },
  { to: '/cashflow', label: 'Cash Flow', icon: 'cashflow', perm: 'cash.manage' },
  { to: '/vendors', label: 'Vendors', icon: 'vendors', perm: 'vendor.view' },
  { to: '/reports', label: 'Reports', icon: 'reports', perm: 'report.view' },
  { to: '/admin', label: 'Administration', icon: 'admin', perm: 'user.manage' },
];

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

const TITLES = {
  '/': 'Management Dashboard',
  '/patients': 'Patient Management',
  '/queue': 'Token & Queue Management',
  '/lab': 'Laboratory',
  '/pharmacy': 'Pharmacy',
  '/inventory': 'Inventory & Stock',
  '/dialysis': 'Dialysis Management',
  '/billing': 'Billing',
  '/returns': 'Refunds & Returns',
  '/cashflow': 'Cash Flow & Float',
  '/vendors': 'Vendor / Supplier Management',
  '/reports': 'Reporting & Analytics',
  '/admin': 'Administration',
};

export default function Layout() {
  const { user, logout, can } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [scan, setScan] = useState('');
  const [scanErr, setScanErr] = useState('');

  async function openByCode(e) {
    e.preventDefault();
    const key = scan.trim();
    if (!key) return;
    setScanErr('');
    try {
      const p = await api.get(`/patients/resolve/${encodeURIComponent(key)}`);
      setScan('');
      nav(`/patients/${p.id}`);
    } catch (err) {
      setScanErr(err.message);
    }
  }
  const title =
    TITLES[loc.pathname] ||
    (loc.pathname.startsWith('/patients') ? 'Patient Management' :
     loc.pathname.startsWith('/consultation') ? 'Doctor Consultation' : 'HWT HMS');

  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="brand">
          <div className="brand-logo"><img src="/img/Hope-Charity-Logo.webp" alt="Hope Welfare Trust" /></div>
          <div className="brand-sub">Hospital Management System</div>
        </div>
        <nav className="nav">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-ico"><Icon name={n.icon} size={19} /></span>
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{initials(user?.full_name)}</div>
            <div className="user-meta">
              <div className="u-name">{user?.full_name}</div>
              <div className="u-role">{user?.role}</div>
            </div>
          </div>
          <button onClick={logout}><Icon name="logout" size={16} /> Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <h1>{title}</h1>
          <div className="flex">
            {can('patient.view') && (
              <form className="searchbox" onSubmit={openByCode} title="Scan the QR card or type the Patient ID, then press Enter">
                <span className="searchbox-ico"><Icon name="search" size={18} /></span>
                <input
                  value={scan}
                  onChange={(e) => { setScan(e.target.value); setScanErr(''); }}
                  placeholder="Scan QR / enter Patient ID"
                  aria-label="Scan QR or enter Patient ID"
                  style={{ width: 260, borderColor: scanErr ? 'var(--danger)' : undefined }}
                />
              </form>
            )}
            <Connectivity />
            <div className="muted" style={{ fontSize: 13 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
