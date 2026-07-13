import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icon } from './icons.jsx';
import Connectivity from './Connectivity.jsx';

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

// Page titles shown next to the logo on sub-pages (home shows none).
const TITLES = {
  '/patients': 'Patients',
  '/patients/new': 'Register Patient',
  '/queue': 'Patient Queue',
  '/billing': 'Billing',
  '/lab': 'Laboratory',
  '/dialysis': 'Dialysis',
  '/inventory': 'Inventory',
  '/pharmacy': 'Pharmacy',
  '/returns': 'Returns & Refunds',
  '/vendors': 'Vendors',
  '/cashflow': 'Cash Flow',
};

// Simplified shell for role-focused users (reception, doctor): a single top bar
// (logo left; date, user and sign-out right) over a home hub and its sub-pages.
// No sidebar. Both this and the full sidebar Layout render <Outlet/>.
export default function HubLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const atHome = loc.pathname === '/';

  const title =
    TITLES[loc.pathname] ||
    (loc.pathname.startsWith('/patients/') ? 'Patient Record' :
     loc.pathname.startsWith('/consultation/') ? 'Consultation' : '');

  const now = new Date();

  return (
    <div className="rc-shell">
      <header className="rc-topbar no-print">
        <div className="rc-left">
          <div className="rc-brand" onClick={() => nav('/')} role="button" title="Go to home">
            <img className="rc-logo" src="/img/Hope-Charity-Logo.webp" alt="Hope Welfare Trust" />
            <span className="rc-brand-text">Hospital Management System</span>
          </div>
          {!atHome && (
            <>
              <span className="rc-sep" />
              <button className="rc-back" onClick={() => nav('/')}>
                <Icon name="dashboard" size={16} /> Home
              </button>
              {title && <span className="rc-page">{title}</span>}
            </>
          )}
        </div>

        <div className="rc-right">
          <Connectivity />
          <div className="rc-date">
            <div className="d1">{now.toLocaleDateString(undefined, { weekday: 'long' })}</div>
            <div className="d2">{now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
          <div className="rc-user">
            <div className="av">{initials(user?.full_name)}</div>
            <div className="rc-user-meta">
              <div className="nm">{user?.full_name}</div>
              <div className="role">{user?.role}{user?.department ? ` · ${user.department}` : ''}</div>
            </div>
          </div>
          <button className="rc-signout" onClick={logout} title="Sign out">
            <Icon name="logout" size={16} /> <span className="rc-signout-txt">Sign out</span>
          </button>
        </div>
      </header>

      <main className="rc-main">
        <div className="rc-body"><Outlet /></div>
      </main>
    </div>
  );
}
