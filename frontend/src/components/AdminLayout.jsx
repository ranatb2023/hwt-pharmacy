import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Icon } from './icons.jsx';
import { printPaper } from '../print.js';
import pkg from '../../package.json';
import { useConnection, setOnline } from '../connection.js';
import { getTheme, toggleTheme } from '../theme.js';
import { OfflineOverlay } from './ws/index.jsx';
import { GENERIC } from '../pages/Reports.jsx';
import RouteErrorBoundary from './RouteErrorBoundary.jsx';

// The management shell — Phase 10.
//
// Every one of the 43 management mockups in stitch_offline_pharmacy_pos_redesign
// sits in this frame: a dark navy sidebar (w-64, #0b1f3d) carrying the whole
// menu, a white header with the screen's title and breadcrumb, a scrolling
// workspace, and a telemetry footer. The markup is the executive dashboard's,
// class for class; the FIGURES are the system's. The mockups carry "LAN
// 192.168.1.10 · Node 01 OK · Ping 0.38ms · Build 4.19.2-LTS"; here the host is
// the one the browser is talking to, the ping is measured, the node state is
// whether the server answered, and the build is package.json.
//
// One sidebar for every screen. The mockups' sidebars disagree with each other
// (each was drawn alone); this list is the System Settings mockup's, which
// mirrors the real Administration tabs one for one, plus Dialysis and
// Profitability, which the product has and the mockups forgot.

export const MAIN = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/pharmacy', label: 'Pharmacy Counter', icon: 'pharmacy', perm: 'pharmacy.sell', kbd: 'F1' },
  { to: '/pharmacy-close', label: 'Day Close', icon: 'clock', perm: 'pharmacy.sell' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory', perm: 'inventory.view' },
  { to: '/departments', label: 'Departments', icon: 'patients', perm: 'pharmacy.dispense' },
  { to: '/customers', label: 'Customers & Cards', icon: 'user', perm: 'patient.view' },
  { to: '/credit', label: 'Credit Accounts', icon: 'billing', perm: 'billing.view' },
  { to: '/dialysis', label: 'Dialysis', icon: 'dialysis', perm: 'dialysis.view' },
  { to: '/billing', label: 'Billing', icon: 'billing', perm: 'billing.view', hospital: true },
  { to: '/returns', label: 'Returns', icon: 'returns', perm: 'return.manage' },
  { to: '/cashflow', label: 'Cash Flow', icon: 'cashflow', perm: 'cash.manage' },
  { to: '/vendors', label: 'Vendors', icon: 'vendors', perm: 'vendor.view' },
  { to: '/stock-audit', label: 'Stock Audit', icon: 'box', perm: 'inventory.manage' },
  { to: '/reports', label: 'Reports', icon: 'reports', perm: 'report.view', children: [
    ['/reports/revenue', 'Revenue & Sales'], ['/admin/subsidy', 'Subsidy & Zakat'], ['/reports/velocity', 'Fast / Slow Moving'],
    ['/reports/expiry', 'Expiry & Wastage'], ['/margin', 'Category & Margin'],
  ] },
];
export const ADMIN = [
  { to: '/admin/users', label: 'Users', icon: 'user', perm: 'user.manage' },
  { to: '/admin/roles', label: 'Roles & Permissions', icon: 'shield', perm: 'user.manage' },
  { to: '/admin/employees', label: 'Employees', icon: 'patients', perm: 'user.manage' },
  { to: '/admin/catalogue', label: 'Catalogue', icon: 'box', perm: 'user.manage' },
  { to: '/admin/dialysis', label: 'Dialysis Form', icon: 'dialysis', perm: 'user.manage' },
  { to: '/admin/settings', label: 'Settings', icon: 'admin', perm: 'user.manage' },
  { to: '/admin/audit', label: 'Audit Log', icon: 'file', perm: 'user.manage' },
  { to: '/admin/subsidy', label: 'Subsidy Report', icon: 'idcard', perm: 'user.manage' },
  { to: '/admin/sync', label: 'Sync', icon: 'arrowright', perm: 'sync.manage' },
  { to: '/amend', label: 'Corrections', icon: 'billing', perm: 'billing.amend' },
];

// The sidebar, grouped by the work it is for (UI report N1/N2). Every daily
// destination sits above the fold on a 666px viewport; Admin is collapsed
// until an admin screen is open or the user opens it, and that choice is
// remembered on this machine.
const byTo = (list, to) => list.find((i) => i.to === to);
export const GROUPS = [
  { title: 'Counter', items: ['/pharmacy', '/pharmacy-close', '/returns'].map((t) => byTo(MAIN, t)) },
  { title: 'Stock', items: [byTo(MAIN, '/inventory'), byTo(MAIN, '/stock-audit'), byTo(MAIN, '/vendors'), byTo(ADMIN, '/admin/catalogue')] },
  { title: 'People', items: ['/customers', '/credit', '/dialysis'].map((t) => byTo(MAIN, t)) },
  { title: 'Money', items: [byTo(MAIN, '/cashflow'), byTo(MAIN, '/departments'), byTo(MAIN, '/billing')] },
  { title: 'Insight', items: [byTo(MAIN, '/reports'), byTo(ADMIN, '/admin/subsidy'), byTo(ADMIN, '/admin/audit')] },
  { title: 'Admin', collapsible: true, items: ['/admin/users', '/admin/roles', '/admin/employees', '/admin/settings', '/admin/sync', '/amend', '/admin/dialysis'].map((t) => byTo(ADMIN, t)) },
].map((g) => ({ ...g, items: g.items.filter(Boolean) }));

// Title and breadcrumb for the header. A page can override the title by
// rendering its own <h1>; this is what the frame shows above it.
const TITLES = {
  '/': ['Management Dashboard', null],
  '/pharmacy': ['Pharmacy Counter (POS)', 'Clinical Operations'],
  '/pharmacy-close': ['Day-End Close & Z-Report', 'Clinical Operations'],
  '/inventory': ['Inventory, Batches & DRAP Compliance', 'Clinical Operations'],
  '/departments': ['Department Indents & Ward Accounts', 'Clinical Operations'],
  '/customers': ['Customers & Patients Directory', 'Patients & Welfare'],
  '/credit': ['Patient Credit Ledger & Receivables', 'Patients & Welfare'],
  '/returns': ['Customer Returns & Refund Audit', 'Finance & Billing'],
  '/cashflow': ['Cash Flow, Float & Till Sessions', 'Finance & Billing'],
  '/vendors': ['Suppliers, Vendors & Procurement', 'Procurement & Supply Chain'],
  '/billing': ['Clinical Invoicing', 'Finance & Billing'],
  '/reports/revenue': ['Revenue & Sales Summary', 'Reports & Analytics'],
  '/reports/velocity': ['Drug Velocity & Formulary Turn Analysis', 'Reports & Analytics'],
  '/reports/expiry': ['Expiry & Stock Wastage Ledger', 'Reports & Analytics'],
  '/reports': ['Reports & Analytics', 'Administration'],
  '/margin': ['Category & Profit Margin Analysis', 'Reports & Analytics'],
  '/stock-audit': ['Physical Stock Audit & Cycle Count', 'Inventory'],
  '/amend': ['Bill Corrections', 'Administration'],
  '/dialysis': ['Dialysis Unit', 'Clinical Operations'],
  '/admin/users': ['Users, Roles & Prescribers', 'Administration'],
  '/admin/roles': ['Roles & Permissions', 'Administration'],
  '/admin/employees': ['Hospital Staff Medical Allowances & Quotas', 'Administration'],
  '/admin/catalogue': ['Drug Catalogue, Dosage Forms & Manufacturers', 'Administration'],
  '/admin/dialysis': ['Dialysis Demand Form', 'Administration'],
  '/admin/settings': ['System Settings', 'Administration'],
  '/admin/audit': ['Audit Trail & Compliance Register', 'Administration'],
  '/admin/subsidy': ['Zakat & Welfare Subsidy Report', 'Administration'],
  '/admin/sync': ['Offline Sync', 'Administration'],
  '/admin': ['Administration', null],
};

const initials = (n) => (n || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

// Reachability and round trip to the server, measured — the footer's "ping"
// and the sidebar's "node OK" are this, not a string.
export function useHealth() {
  const [h, setH] = useState({ ok: true, ms: null });
  useEffect(() => {
    let alive = true;
    async function ping() {
      const t0 = performance.now();
      let ok = false;
      try { ok = (await fetch('/api/health', { cache: 'no-store' })).ok; } catch { ok = false; }
      if (alive) setH({ ok, ms: ok ? Math.round((performance.now() - t0) * 100) / 100 : null });
      setOnline(ok);
    }
    ping();
    const id = setInterval(ping, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return h;
}

export function useTill() {
  const [till, setTill] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = () => api.get('/cashflow/current').then((r) => alive && setTill(r?.session || null)).catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    window.addEventListener('hwt:till', tick);
    return () => { alive = false; clearInterval(id); window.removeEventListener('hwt:till', tick); };
  }, []);
  return till;
}

export default function AdminLayout() {
  const { user, logout, can, hospitalMode, config } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const health = useHealth();
  const till = useTill();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  const visible = (items) => items.filter((i) => (!i.perm || can(i.perm)) && (!i.hospital || hospitalMode));
  const conn = useConnection();
  const [theme, setTheme] = useState(getTheme());
  // Below `lg` the sidebar is an off-canvas drawer (mobile spec, item 1): it
  // closes after every navigation, on Esc, and on a tap outside; the page
  // behind cannot scroll while it is open.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [navOpen]);
  const onAdminRoute = GROUPS.find((g) => g.collapsible)?.items.some((i) => loc.pathname === i.to || loc.pathname.startsWith(`${i.to}/`));
  const [adminOpen, setAdminOpen] = useState(() => { try { return localStorage.getItem('hwt.nav.admin') === 'open'; } catch { return false; } });
  const toggleAdmin = () => setAdminOpen((v) => { try { localStorage.setItem('hwt.nav.admin', v ? 'closed' : 'open'); } catch { /* fine */ } return !v; });
  const key = Object.keys(TITLES).filter((k) => loc.pathname === k || (k !== '/' && loc.pathname.startsWith(k + '/'))).sort((a, b) => b.length - a.length)[0] || '/';
  const generic = GENERIC[loc.pathname.replace(/^\/reports\//, '')];
  const [title, crumb] = generic ? [generic.title, 'Reports & Analytics'] : TITLES[key];

  // F5 refreshes the page's data (pages listen for the event and re-fetch),
  // Alt+E prints the workspace. Neither steals a key from a field being typed in.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === 'F5') { e.preventDefault(); window.dispatchEvent(new CustomEvent('hwt:refresh')); }
      else if (e.altKey && (e.key === 'e' || e.key === 'E') && !['input', 'textarea', 'select'].includes(tag)) { e.preventDefault(); printPaper('a4', { modal: false }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const link = ({ isActive }) => `flex items-center gap-3 px-3 py-2.5 lg:py-1 rounded-md text-[13px] font-medium transition-colors ${
    isActive ? 'bg-[#0369a1] text-white font-semibold shadow-sm' : 'text-slate-300 hover:text-white hover:bg-[#122e54]'}`;

  return (
    <div className="app-shell h-screen flex overflow-hidden text-slate-800 bg-[#f8f9ff] antialiased font-sans">
      {/* ================= Sidebar ================= */}
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden no-print" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}
      <aside
        id="app-sidebar"
        className={[
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200',
          navOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:transition-none',
          'bg-[#0b1f3d] flex flex-col justify-between shrink-0 select-none border-r border-[#15345f] no-print',
        ].join(' ')}
      >
        <div className="flex flex-col min-h-0 flex-1">
          <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-10 h-10 rounded bg-[#0284c7] flex items-center justify-center text-white shadow-sm">
                <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-.75 4.5h1.5v4.5h4.5v1.5h-4.5v4.5h-1.5v-4.5h-4.5v-1.5h4.5v-4.5z" /></svg>
              </div>
              <div>
                <div className="text-[#0b1f3d] font-extrabold text-sm leading-tight uppercase tracking-wide font-headline">Hope Welfare</div>
                <div className="text-[11px] font-semibold text-[#0284c7] leading-tight">{config.pharmacy_name || 'Trust Hospital & Pharmacy'}</div>
              </div>
            </div>
            <button type="button" onClick={() => setNavOpen(false)} aria-label="Close menu"
              className="lg:hidden -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="px-4 py-2 bg-[#08172c] border-b border-[#142e53] flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 font-mono truncate">
              <span className={`inline-block w-2 h-2 rounded-full ${health.ok ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              LAN: {host}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${health.ok ? 'bg-[#0f2d59] text-sky-300' : 'bg-rose-900 text-rose-200'}`}>{health.ok ? 'Node OK' : 'Unreachable'}</span>
          </div>
          <nav className="p-2 pb-2 space-y-0.5 overflow-y-auto min-h-0 flex-1 overscroll-contain">
            {visible(MAIN.slice(0, 1)).map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={link}>
                {({ isActive }) => (<><span className={isActive ? 'text-white' : 'text-sky-400'}><Icon name={i.icon} size={16} /></span><span className="flex-1">{i.label}</span></>)}
              </NavLink>
            ))}
            {GROUPS.map((g) => {
              const items = visible(g.items);
              if (!items.length) return null;
              const open = !g.collapsible || adminOpen || onAdminRoute;
              return (
                <div key={g.title}>
                  {g.collapsible ? (
                    <button type="button" onClick={toggleAdmin} className="w-full flex items-center justify-between py-2.5 lg:pt-2 lg:pb-0.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200" aria-expanded={open}>
                      <span>{g.title}</span><span className="font-mono">{open ? '▾' : '▸'}</span>
                    </button>
                  ) : (
                    <div className="pt-2 pb-0.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.title}</div>
                  )}
                  {open && items.map((i) => (
                    <React.Fragment key={i.to}>
                      <NavLink to={i.to} end={i.end} className={link}>
                        {({ isActive }) => (
                          <>
                            <span className={isActive ? 'text-white' : 'text-sky-400'}><Icon name={i.icon} size={16} /></span>
                            <span className="flex-1">{i.label}</span>
                            {i.kbd && <span className="kbd-hint text-[10px] font-mono font-bold bg-[#0f2d59] text-sky-300 px-1.5 py-0.5 rounded">{i.kbd}</span>}
                          </>
                        )}
                      </NavLink>
                      {i.children && (loc.pathname.startsWith('/reports') || loc.pathname === '/margin' || loc.pathname === '/admin/subsidy') && (
                        <div className="ml-4 pl-3 border-l border-[#15345f] space-y-0.5 my-1">
                          {i.children.map(([to, label]) => (
                            <NavLink key={to} to={to} className={({ isActive }) => `block px-3 py-2.5 lg:py-1.5 rounded text-[13px] ${isActive ? 'text-white font-semibold bg-[#122e54]' : 'text-slate-400 hover:text-white hover:bg-[#122e54]'}`}>
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 mr-2 align-middle" />{label}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              );
            })}
          </nav>
        </div>
        <div className="p-3 bg-[#08182e] border-t border-[#15345f]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded bg-[#f59e0b] text-[#0b1f3d] font-black text-sm flex items-center justify-center shrink-0 shadow">{initials(user?.full_name)}</div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate leading-tight m-0">{user?.full_name}</p>
              <p className="text-[11px] text-slate-400 truncate m-0">{user?.role}{user?.department ? ` · ${user.department}` : ''}</p>
            </div>
          </div>
          {/* On phones the theme toggle lives here, not in the header (item 2). */}
          <button type="button" onClick={() => setTheme(toggleTheme())}
            className="lg:hidden w-full flex items-center justify-center gap-2 py-3 px-2 mb-2 rounded text-xs font-semibold text-slate-300 hover:text-white bg-[#0f2d59] hover:bg-[#1a447e] transition-colors">
            {theme === 'night' ? '☀ Day mode' : '☾ Night mode'}
          </button>
          <button type="button" onClick={() => { logout(); nav('/login'); }}
            className="w-full flex items-center justify-center gap-2 py-3 lg:py-1.5 px-2 rounded text-xs font-semibold text-slate-300 hover:text-white bg-[#0f2d59] hover:bg-[#1a447e] transition-colors">
            <Icon name="logout" size={13} /> Sign Out Session
          </button>
        </div>
      </aside>

      {/* ================= Main ================= */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="min-h-[3.5rem] lg:h-16 bg-white border-b border-slate-200 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 shrink-0 shadow-sm no-print">
          <div className="flex items-center gap-2 lg:gap-3 min-w-0 flex-1">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-controls="app-sidebar" aria-expanded={navOpen}
              className="lg:hidden -ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100">
              <Icon name="menu" size={20} />
            </button>
            <div className="min-w-0">
              {crumb && <div className="hidden lg:block text-[12px] text-slate-600 leading-tight">{crumb} <span className="text-slate-400 mx-1">/</span> <span className="text-[#0369a1] font-semibold">{title}</span></div>}
              <h1 className="truncate lg:whitespace-normal lg:overflow-visible text-base sm:text-lg lg:text-xl font-extrabold text-[#0b1f3d] tracking-tight font-headline m-0 leading-tight">{title}</h1>
            </div>
            {!crumb && <span className="hidden lg:inline-flex shrink-0 items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">{hospitalMode ? 'Hospital Core' : 'Clinical POS Core'}</span>}
          </div>
          <div className="flex items-center gap-1.5 lg:gap-4 shrink-0">
            <div className={`inline-flex items-center px-2 lg:px-3 py-1.5 rounded text-xs font-semibold shadow-sm border ${health.ok && conn.online ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}
              title={health.ok && conn.online ? 'Counter Connected' : 'Cannot reach server'}>
              <span className={`w-2 h-2 rounded-full ${health.ok && conn.online ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
              <span className="hidden md:inline ml-2">{health.ok && conn.online ? 'Counter Connected' : 'Cannot reach server'}</span>
            </div>
            <div className="hidden xl:flex text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded border border-slate-200 items-center gap-1.5">
              <Icon name="clock" size={13} />
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div className="flex items-center gap-1.5 lg:border-l lg:border-slate-200 lg:pl-3">
              <button type="button" onClick={() => setTheme(toggleTheme())} title={theme === 'night' ? 'Day mode' : 'Night mode'}
                className="hidden sm:inline-flex h-11 w-11 lg:h-auto lg:w-auto items-center justify-center lg:px-2.5 lg:py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded transition-colors">
                {theme === 'night' ? '☀' : '☾'}
              </button>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('hwt:refresh'))} title="Refresh (F5)" aria-label="Refresh"
                className="inline-flex h-11 w-11 lg:h-auto lg:w-auto items-center justify-center lg:px-2.5 lg:py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded transition-colors gap-1">
                <Icon name="returns" size={13} /> <span className="kbd-hint hidden lg:inline">F5</span>
              </button>
              <button type="button" onClick={() => printPaper('a4', { modal: false })} title="Print / export this screen (Alt+E)" aria-label="Export"
                className="inline-flex h-11 px-3 lg:h-auto lg:py-1.5 items-center justify-center gap-1 whitespace-nowrap text-xs font-bold text-white bg-[#0284c7] hover:bg-blue-600 rounded transition-colors shadow-sm">
                <Icon name="printer" size={13} /> <span className="hidden sm:inline">Export</span> <span className="kbd-hint hidden lg:inline">[Alt+E]</span>
              </button>
            </div>
          </div>
        </header>

        <OfflineOverlay />
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="min-h-full flex flex-col gap-4 p-3 sm:p-4 lg:gap-6 lg:p-6 ws-content admin-content">
            <RouteErrorBoundary resetKey={loc.pathname}>
              <Outlet key={loc.pathname === '/pharmacy' ? 'pos' : `e${conn.epoch}`} />
            </RouteErrorBoundary>
          </div>
        </main>

        <footer className="bg-white border-t border-slate-200 py-2.5 px-6 text-[11px] text-slate-500 hidden md:flex flex-wrap items-center justify-between gap-2 select-none no-print shrink-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${health.ok && conn.online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span className={`font-mono font-semibold ${health.ok && conn.online ? 'text-slate-700' : 'text-rose-700'}`}>LAN Master: {host}{health.ok && conn.online ? '' : ' — unreachable'}</span>
            <span className="text-slate-300">•</span>
            <span>{health.ok && conn.online ? 'SQLite WAL Active' : 'no answer from the server'}</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-600 font-mono">Ping: {health.ok && conn.online && health.ms != null ? `${health.ms}ms` : '—'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-600 font-medium">{till ? `${till.counter} Online` : 'No till open'}</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-600 font-semibold">{config.pharmacy_license_no ? `Drug Sale Licence ${config.pharmacy_license_no}` : 'Licence not recorded'}</span>
            <span className="text-slate-300">•</span>
            <span className="text-blue-700 font-mono font-bold">Build v{pkg.version}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
