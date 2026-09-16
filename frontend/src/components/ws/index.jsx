import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { api } from '../../api.js';
import { Icon } from '../icons.jsx';
import Connectivity from '../Connectivity.jsx';
import { useConnection, retryNow } from '../../connection.js';
import { getTheme, toggleTheme } from '../../theme.js';
import pkg from '../../../package.json';

// The workstation shell — the pieces every one of the sixteen redesigned screens
// shares (hwt-client/design/stitch): a white header carrying the counter, the
// connection, the clock, the user and the till; a keyboard-driven nav dock; and
// a dark status footer. Everything on them is REAL. The mockups carry
// placeholders ("192.168.1.100", "Shift A", "Drug DB rev 2026.09.01") and a
// figure that cannot be verified is worse than no figure — a cashier learns to
// stop reading the bar.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// The control classes every counter page shares. They are CSS classes, not
// Tailwind strings, because the FRAME decides their look (styles.css,
// "Workstation controls"): 32px / slate-800 in the dock, 40px / navy in the
// admin sidebar — the same page, the same handlers, two skins.
export const CTL = 'ws-ctl';
export const NUM = 'ws-ctl ws-num';
export const BTN = 'ws-btn';
export const BTN_DARK = 'ws-btn ws-btn-dark';
export const BTN_GO = 'ws-btn ws-btn-go';
export const LABEL = 'ws-label';

// When the server is unreachable every screen says so, in the same words, on
// top of whatever it was showing (UI report 9.2). The page stays mounted
// underneath — a basket mid-sale must survive the cable being kicked — but
// nothing on it can be read as current or acted on until the server answers.
export function OfflineOverlay() {
  const { online, since } = useConnection();
  if (online) return null;
  const at = since ? since.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/55 backdrop-blur-[1px] flex items-start justify-center p-6 no-print" role="alert" aria-live="assertive">
      <div className="mt-16 w-full max-w-xl bg-white border-2 border-rose-500 rounded-lg shadow-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-rose-100 text-rose-700 flex items-center justify-center shrink-0"><Icon name="warning" size={18} /></div>
          <div className="min-w-0">
            <div className="text-base font-extrabold text-rose-900">Cannot reach the pharmacy server</div>
            <p className="text-sm text-slate-700 mt-1 mb-0">
              Nothing on this screen can be trusted until the connection returns — the figures are stale and nothing can be saved.
              Check the LAN cable and that the server machine is switched on, then tell the administrator.
            </p>
            <div className="text-xs text-slate-500 mt-2 font-mono">{at ? `Unreachable since ${at} · ` : ''}retrying every 5 seconds</div>
            <button type="button" onClick={retryNow} className="mt-3 h-9 px-4 rounded-md bg-[#0b1f3d] hover:bg-[#122e54] text-white text-sm font-bold">Retry now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// A keyboard hint, drawn the way the mockups draw them everywhere.
export function Kbd({ children, className = '' }) {
  return (
    <kbd className={`kbd-hint inline-block font-mono text-[11px] leading-none text-slate-600 bg-slate-100 border border-slate-200 rounded px-1 py-0.5 ${className}`}>
      {children}
    </kbd>
  );
}

// A bordered white block. The design has no drop shadows to speak of; the
// hierarchy comes from borders and the slate ground behind them.
export function Panel({ children, className = '', flush = false }) {
  return (
    <div className={`bg-white rounded-md border border-slate-300 shadow-xs ${flush ? '' : 'p-3'} ${className}`}>
      {children}
    </div>
  );
}

export function PanelHead({ title, kbd, right, children }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        {title}
        {kbd && <Kbd>{kbd}</Kbd>}
      </div>
      <div className="flex items-center gap-2">{right}{children}</div>
    </div>
  );
}

// A figure with its label — the "metric tile" the design uses across the top
// of most workstations. Numbers are mono so columns of them line up.
export function Metric({ label, value, sub, tone = 'default', mono = true, className = '' }) {
  const tones = {
    default: 'text-slate-900',
    ok: 'text-emerald-700',
    warn: 'text-amber-700',
    danger: 'text-rose-700',
    primary: 'text-clinical-primary',
  };
  return (
    <div className={`ws-tile bg-white border ${className}`} data-tone={tone}>
      <div className="ws-tile-label text-[10px] font-bold uppercase tracking-wide text-slate-500 line-clamp-2">{label}</div>
      <div className={`ws-tile-value mt-0.5 font-bold leading-tight ${mono ? 'ws-tile-mono' : ''} ${tones[tone] || tones.default}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// The dark "amount payable" panel — the one thing on a POS screen a customer
// reads from the other side of the counter, which is why it is the only dark
// block on the page.
export function DarkTotal({ label, value, sub }) {
  return (
    <div className="bg-navy-900 text-white rounded-md p-3 border border-navy-800">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-mono text-3xl font-bold leading-none mt-1.5 text-emerald-300">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1.5">{sub}</div>}
    </div>
  );
}

// Money the way the design prints it: mono, thousands separators, "Rs" lead.
export function rs(n) {
  const v = Number(n || 0);
  return `Rs ${v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// The clock — Pakistan time, ticking. The server files everything on the
// business day at UTC+5; the header should show the same day the records use.
// ---------------------------------------------------------------------------
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Live figures for the header and footer. Polled, not pushed — a LAN of two or
// three counters does not need a socket, and a poll survives the server
// restarting without the page noticing.
function useStation() {
  const [till, setTill] = useState(null);
  const [today, setToday] = useState(null);
  useEffect(() => {
    let alive = true;
    async function tick() {
      // Each call fails independently: a cashier without report.view still
      // gets their till figure, and a missing figure is left blank, never
      // faked.
      api.get('/cashflow/current').then((r) => alive && setTill(r?.session || null)).catch(() => {});
      api.get('/reports/dashboard').then((r) => alive && setToday(r)).catch(() => {});
    }
    tick();
    const id = setInterval(tick, 30000);
    // The till changed on some screen (opened, closed, a movement): re-read
    // now rather than at the next poll (QA S4-36).
    window.addEventListener('hwt:till', tick);
    return () => { alive = false; clearInterval(id); window.removeEventListener('hwt:till', tick); };
  }, []);
  return { till, today };
}

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------
export function WsHeader({ dayClose = true }) {
  const { user, logout, config } = useAuth();
  const nav = useNavigate();
  const now = useClock();
  const { till } = useStation();
  const { online } = useConnection();
  const [theme, setTheme] = useState(getTheme());
  // Phones (mobile spec, item 1): the bar keeps the logo, a short name, the
  // till chip, a status dot, the avatar and Sign out. Theme and Day Close move
  // into a small menu on the avatar; Day Close is a nav tab anyway.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const tillCash = till?.summary?.expected;
  const initials = (user?.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

  return (
    <header className="bg-white border-b border-slate-300 shadow-xs shrink-0 z-20 no-print">
      <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand + counter */}
        <button type="button" onClick={() => nav('/')} className="flex items-center gap-2 sm:gap-2.5 text-left group min-w-0"
          title="Home" aria-label="Home">
          <img src="/img/Hope-Charity-Logo.webp" alt="" className="h-7 w-7 sm:h-8 sm:w-8 object-contain shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className="font-bold text-slate-900 text-sm tracking-tight whitespace-nowrap truncate">
                <span className="sm:hidden">HWT</span>
                <span className="hidden sm:inline">HOPE WELFARE TRUST</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded">
                {till ? till.counter : 'No till open'}
              </span>
            </div>
            <div className="hidden sm:block truncate text-[11px] text-slate-500 leading-none mt-0.5">
              {config?.pharmacy_name || 'Pharmacy Management System'}
            </div>
          </div>
        </button>

        {/* Connection + clock, lg and up */}
        <div className="hidden lg:flex items-center gap-4 text-xs text-slate-600 shrink-0">
          <Connectivity />
          <div className="flex items-center gap-2 font-mono text-[11px] whitespace-nowrap">
            <Icon name="clock" size={14} />
            <span className="font-semibold text-slate-800">
              {now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <span className="text-slate-600 tabular-nums">
              {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>

        {/* User + till + actions */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Below lg nothing else says whether the server answers (item 15). */}
          <span role="status" aria-label={online ? 'Server connected' : 'Server unreachable'} title={online ? 'Server connected' : 'Server unreachable'}
            className={`lg:hidden h-2.5 w-2.5 rounded-full shrink-0 ${online ? 'bg-emerald-500' : 'bg-rose-500'}`} />

          <div className="flex items-center gap-2 sm:border-r sm:border-slate-200 sm:pr-3">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-bold text-slate-800 whitespace-nowrap">{user?.full_name}</div>
              <div className="text-[10px] text-slate-500 whitespace-nowrap">{user?.role}</div>
            </div>
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu"
                className="h-11 w-11 sm:h-7 sm:w-7 rounded bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-300 sm:pointer-events-none">
                {initials}
              </button>
              {menuOpen && (
                <div role="menu" className="sm:hidden absolute right-0 top-full mt-1 z-40 min-w-[12rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg text-sm">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <div className="text-xs font-bold text-slate-800">{user?.full_name}</div>
                    <div className="text-[11px] text-slate-500">{user?.role}</div>
                  </div>
                  <button type="button" role="menuitem" className="block w-full text-left px-3 py-3 hover:bg-slate-50"
                    onClick={() => { setTheme(toggleTheme()); setMenuOpen(false); }}>
                    {theme === 'night' ? '☀ Day mode' : '☾ Night mode'}
                  </button>
                  {dayClose && (
                    <button type="button" role="menuitem" className="block w-full text-left px-3 py-3 hover:bg-slate-50"
                      onClick={() => { setMenuOpen(false); nav('/pharmacy-close'); }}>
                      Day Close
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {tillCash != null && (
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-[10px] text-slate-500 font-semibold uppercase whitespace-nowrap">Till cash</span>
              <span className="text-xs font-mono font-bold text-slate-900 whitespace-nowrap">{rs(tillCash)}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setTheme(toggleTheme())} title={theme === 'night' ? 'Day mode' : 'Night mode'} aria-label={theme === 'night' ? 'Day mode' : 'Night mode'}
              className="hidden sm:inline-flex items-center justify-center min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded">
              {theme === 'night' ? '☀' : '☾'}
            </button>
            {dayClose && (
              <button type="button" onClick={() => nav('/pharmacy-close')}
                className="hidden sm:inline-flex items-center gap-1.5 whitespace-nowrap min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded"
                title="Day-end close">
                Day Close <Kbd>F10</Kbd>
              </button>
            )}
            <button type="button" onClick={logout}
              className="inline-flex h-11 w-11 sm:h-auto sm:w-auto items-center justify-center min-h-[44px] lg:min-h-0 touch:min-h-[44px] sm:p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 rounded"
              title="Sign out" aria-label="Sign out">
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// The nav dock
//
// ALT+DIGIT, NOT F-KEYS. The mockups put F-keys on the dock, but the POS page
// already uses F2–F9 for its own actions (search, qty, tender, hold, resume,
// complete) and the mockups disagree with themselves — F10 is Cash Flow on one
// screen and Day Close on another. F-keys belong to the page you are on;
// Alt+1..8 takes you to a different one, and never collides.
// ---------------------------------------------------------------------------
export const DOCK = [
  { to: '/pharmacy', label: 'Pharmacy Counter', perm: 'pharmacy.sell', title: 'Main POS' },
  { to: '/departments', label: 'Departments', perm: 'pharmacy.dispense', title: 'Department requisitions & ward indents' },
  { to: '/inventory', label: 'Inventory', perm: 'inventory.view', title: 'Inventory, batches & DRAP compliance' },
  { to: '/vendors', label: 'Vendors', perm: 'vendor.view', title: 'Vendors & orders' },
  { to: '/customers', label: 'Customers & Cards', perm: 'patient.view', title: 'Customers & welfare cards' },
  { to: '/returns', label: 'Returns', perm: 'return.manage', title: 'Returns & refunds' },
  { to: '/cashflow', label: 'Cash Flow', perm: 'cash.manage', title: 'Cash flow & till sessions' },
  { to: '/pharmacy-close', label: 'Day Close', perm: 'pharmacy.sell', title: 'Day-end close & Z-report' },
];

// Everything else stays reachable, under one menu, so the dock stays eight.
export const MORE = [
  { to: '/', label: 'Dashboard' },
  { to: '/credit', label: 'Credit Accounts', perm: 'billing.view' },
  { to: '/dialysis', label: 'Dialysis', perm: 'dialysis.view' },
  { to: '/margin', label: 'Category & Margin', perm: 'report.view' },
  { to: '/stock-audit', label: 'Stock Audit', perm: 'inventory.manage' },
  { to: '/reports', label: 'Reports', perm: 'report.view' },
  { to: '/amend', label: 'Corrections', perm: 'billing.amend' },
  { to: '/admin', label: 'Administration', perm: 'user.manage' },
];

export function WsNav() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const stripRef = useRef(null);
  const moreRef = useRef(null);
  const dock = DOCK.filter((d) => !d.perm || can(d.perm));
  const more = MORE.filter((d) => !d.perm || can(d.perm));

  useEffect(() => {
    function onKey(e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (!(n >= 1 && n <= dock.length)) return;
      // Never steal the key from something being typed.
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) && document.activeElement?.value) return;
      e.preventDefault();
      nav(dock[n - 1].to);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dock, nav]);

  // Mobile spec, item 3: the strip scrolls, so keep the current tab in view;
  // and close More after navigating.
  useEffect(() => {
    setOpen(false);
    stripRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!moreRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The More button and its menu sit OUTSIDE the scrolling strip (item 2):
  // `overflow-x: auto` clips the other axis too, so a menu inside the strip
  // rendered inside a 33px box and its links could not be reached.
  return (
    <nav className="bg-slate-50 border-b border-slate-300 px-3 flex items-stretch gap-1 shrink-0 no-print">
      <div ref={stripRef} className="nav-strip flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
        {dock.map((d, i) => (
          <NavLink key={d.to} to={d.to} title={`${d.title || d.label} (Alt+${i + 1})`}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-2.5 py-3 sm:py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-clinical-primary text-clinical-primary bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}>
            <Kbd className="hidden xl:inline-block">Alt+{i + 1}</Kbd>{d.label}
          </NavLink>
        ))}
      </div>
      {more.length > 0 && (
        <div className="relative shrink-0 flex items-center" ref={moreRef}>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-controls="ws-more-menu"
            className="flex items-center gap-1 min-h-[44px] sm:min-h-0 touch:min-h-[44px] px-2.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
            More <span className="text-[10px]">▾</span>
          </button>
          {open && (
            <div id="ws-more-menu" role="menu" className="absolute right-0 top-full mt-1 z-40 min-w-[11rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {more.map((d) => (
                <NavLink key={d.to} to={d.to} end={d.to === '/'} role="menuitem" onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block px-3 py-3 sm:py-2 text-sm ${isActive ? 'text-clinical-primary font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                  {d.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The status footer
// ---------------------------------------------------------------------------
export function WsFooter() {
  const { till, today } = useStation();
  const { online } = useConnection();
  const host = typeof window !== 'undefined' ? window.location.host : '';
  return (
    <footer className="bg-navy-900 text-slate-400 text-[11px] px-4 py-1.5 border-t border-navy-800 hidden md:flex items-center justify-between shrink-0 no-print">
      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-1.5 ${online ? 'text-slate-300' : 'text-rose-300 font-bold'}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
          {online ? 'Local SQLite' : 'Server unreachable'}
        </span>
        <span className="text-slate-600">|</span>
        <span className="font-mono">server {host}{online ? '' : ' — no answer'}</span>
        {till && (
          <>
            <span className="text-slate-600">|</span>
            <span>{till.counter} · opened {String(till.opened_at || '').slice(11, 16)}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        {today && (
          <span>
            Today&apos;s sales:{' '}
            <strong className="text-slate-200 font-mono">{rs(today.revenue_today)}</strong>
          </span>
        )}
        <span className="font-mono text-slate-300">v{pkg.version}</span>
      </div>
    </footer>
  );
}
