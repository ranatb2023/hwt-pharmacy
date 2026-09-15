import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Connectivity from './Connectivity.jsx';
import { Icon } from './icons.jsx';

// `hospital: true` marks a module that only exists once the deployment is
// switched to Phase 2 — it depends on reception, a doctor or the lab creating
// records that a standalone pharmacy install never has.
const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', perm: null, end: true },
  // The on-hold hospital module. Named for what it is so it does not compete
  // with "Customers & Cards", which is the identity screen in this product.
  { to: '/patients', label: 'Patient Records (hospital)', icon: 'patients', perm: 'patient.view', hospital: true },
  { to: '/queue', label: 'Token & Queue', icon: 'queue', perm: 'token.manage', hospital: true },
  { to: '/lab', label: 'Laboratory', icon: 'lab', perm: 'lab.view', hospital: true },
  { to: '/pharmacy-dashboard', label: 'Pharmacy Dashboard', icon: 'pharmacy', perm: 'pharmacy.sell' },
  { to: '/pharmacy', label: 'Pharmacy Counter', icon: 'pharmacy', perm: 'pharmacy.sell' },
  { to: '/pharmacy-close', label: 'Day Close', icon: 'clock', perm: 'pharmacy.sell' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory', perm: 'inventory.view' },
  // Departments are customers of the pharmacy, not a hospital module: they send a
  // slip and get an invoice, so this stays visible even with the clinical modules off.
  { to: '/departments', label: 'Departments', icon: 'patients', perm: 'pharmacy.dispense' },
  // Customers and welfare cards. NOT hospital-gated: Patient Management is on
  // hold, so this is the identity screen for the whole product.
  { to: '/customers', label: 'Customers & Cards', icon: 'user', perm: 'patient.view' },
  { to: '/credit', label: 'Credit Accounts', icon: 'billing', perm: 'billing.view' },
  // NOT hospital-gated. Dialysis is one of the two modules this product is FOR
  // (SCOPE.md: "a pharmacy POS + dialysis management system"), and it was
  // filtered out with the on-hold clinical modules — so the whole of Phase 05
  // would have shipped invisible on every pharmacy-mode install.
  { to: '/dialysis', label: 'Dialysis', icon: 'dialysis', perm: 'dialysis.view' },
  { to: '/billing', label: 'Billing', icon: 'billing', perm: 'billing.view' },
  { to: '/returns', label: 'Returns', icon: 'returns', perm: 'return.manage' },
  { to: '/cashflow', label: 'Cash Flow', icon: 'cashflow', perm: 'cash.manage' },
  { to: '/vendors', label: 'Vendors', icon: 'vendors', perm: 'vendor.view' },
  { to: '/margin', label: 'Profitability', icon: 'reports', perm: 'report.view' },
  { to: '/reports', label: 'Reports', icon: 'reports', perm: 'report.view' },
  // Correcting a closed day is an administrator's job and a separate authority
  // from a counter discount, so it sits on its own rather than inside Billing.
  { to: '/amend', label: 'Corrections', icon: 'billing', perm: 'billing.amend' },
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
  '/pharmacy': 'Pharmacy Counter',
  '/pharmacy-dashboard': 'Pharmacy Dashboard',
  '/pharmacy-close': 'Day-End Close',
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
  const { user, logout, can, hospitalMode, config } = useAuth();
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
          <div className="brand-sub">{hospitalMode ? 'Hospital Management System' : (config.pharmacy_name || 'Pharmacy Management System')}</div>
        </div>
        <nav className="nav">
          {NAV.filter((n) => (!n.perm || can(n.perm)) && (hospitalMode || !n.hospital)).map((n) => (
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
          <div className="fx">
            {hospitalMode && can('patient.view') && (
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
