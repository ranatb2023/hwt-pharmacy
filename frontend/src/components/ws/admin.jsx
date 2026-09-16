import React from 'react';
import { Icon } from '../icons.jsx';

// The management frame's vocabulary — Phase 10. The classes are the
// pharmacy_admin_* mockups': white cards with a hairline border and a soft
// shadow, KPI tiles with an icon square, uppercase tracking on table heads and
// section labels, pills for state. Kept small so every screen reads the same.

export const BTN = 'h-9 min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-3 bg-white hover:bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-700 inline-flex items-center gap-1.5 text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shadow-sm';
export const BTN_PRIMARY = 'h-9 min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-3.5 bg-[#0284c7] hover:bg-blue-600 text-white rounded-md font-bold inline-flex items-center gap-1.5 text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shadow-sm';
export const BTN_DARK = 'h-9 min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-3.5 bg-[#0b1f3d] hover:bg-[#122e54] text-white rounded-md font-bold inline-flex items-center gap-1.5 text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';
export const BTN_SM = 'h-7 min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded font-semibold text-slate-700 inline-flex items-center gap-1 text-[11px] whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';
export const CTL = 'h-10 min-h-0 py-0 px-3 text-sm border border-slate-300 rounded-md bg-white focus:border-[#0284c7] focus:ring-1 focus:ring-[#0284c7] w-full';
export const NUM = `${CTL} font-mono`;
export const LABEL = 'block text-[13px] font-semibold text-slate-800 mb-1.5';
export const HINT = 'text-[11px] text-slate-500 mt-1';

export function Kbd({ children }) {
  return <kbd className="kbd-hint text-[10px] font-mono font-bold bg-white/20 px-1.5 py-0.5 rounded border border-white/30">{children}</kbd>;
}

// The page's own title row: title + subtitle on the left, actions on the right.
// The frame's header already names every screen this sits on, so the title
// is not drawn twice (client, 2026-09-14): only the chip (a period, a
// count) and the subheading show. `title` is kept on the call sites as the
// screen's name for the record; it prints on paper.
export function PageHead({ title, sub, chip, right }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        {title && <h2 className="ws-h1 print:!block text-base font-bold text-slate-900 m-0">{title}</h2>}
        {chip && <div className="flex items-center gap-2 flex-wrap print:hidden">{chip}</div>}
        {sub && <p className="text-xs text-slate-500 mt-1 mb-0 max-w-3xl">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap print:hidden">{right}</div>}
    </div>
  );
}

// The blue plain-English notice at the top of most admin screens.
export function Notice({ title, children, right, tone = 'blue' }) {
  const t = tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-900' : tone === 'rose' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-blue-50 border-blue-200 text-blue-900';
  const ic = tone === 'amber' ? 'bg-amber-100 text-amber-700' : tone === 'rose' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-[#0284c7]';
  return (
    <div className={`rounded-lg border px-4 py-3 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 ${t}`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${ic}`}><Icon name={tone === 'blue' ? 'shield' : 'warning'} size={16} /></div>
        <div>
          {title && <div className="text-sm font-bold">{title}</div>}
          <div className="text-xs mt-0.5 opacity-90">{children}</div>
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Kpi({ label, value, unit, sub, tone = 'slate', icon, mono = true }) {
  const val = { sky: 'text-[#0284c7]', emerald: 'text-emerald-600', amber: 'text-[#d97706]', rose: 'text-rose-600', slate: 'text-[#0b1f3d]' }[tone] || 'text-[#0b1f3d]';
  const ic = { sky: 'bg-blue-50 text-[#0284c7]', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', slate: 'bg-slate-100 text-slate-600' }[tone] || 'bg-slate-100 text-slate-600';
  const dot = { sky: 'bg-blue-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', slate: 'bg-slate-400' }[tone] || 'bg-slate-400';
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-5 shadow-sm min-w-0">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-bold text-slate-500 tracking-wider uppercase line-clamp-2">{label}</span>
        {icon && <span className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${ic}`}><Icon name={icon} size={17} /></span>}
      </div>
      <div className={`text-xl sm:text-2xl lg:text-3xl font-extrabold mt-1 leading-tight ${val} ${mono ? 'font-mono tracking-tight' : 'font-headline'}`}>
        {value} {unit && <span className="text-sm font-sans font-semibold text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{sub}</div>}
    </div>
  );
}

export function Card({ title, sub, right, children, flush = false, className = '' }) {
  return (
    <section className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 flex-wrap">
          <div>
            {title && <h3 className="text-sm font-bold text-[#0b1f3d] m-0 font-headline flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#0284c7]" />{title}</h3>}
            {sub && <p className="text-xs text-slate-500 m-0 mt-0.5">{sub}</p>}
          </div>
          {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
        </div>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function Pill({ tone = 'slate', children, mono = false }) {
  const t = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200', sky: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200', rose: 'bg-rose-50 text-rose-700 border-rose-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200', slate: 'bg-slate-100 text-slate-700 border-slate-200',
    navy: 'bg-[#0b1f3d] text-white border-[#0b1f3d]',
  }[tone] || 'bg-slate-100 text-slate-700 border-slate-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border whitespace-nowrap ${mono ? 'font-mono' : ''} ${t}`}>{children}</span>;
}

export function Chips({ items, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {items.map(([k, label, n]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`h-8 min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-3 rounded-md text-xs font-semibold border transition-colors ${value === k ? 'bg-[#0284c7] text-white border-[#0284c7]' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}>
          {label}{n != null ? ` (${n})` : ''}
        </button>
      ))}
    </div>
  );
}

export function Search({ value, onChange, placeholder, kbd, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Icon name="search" size={15} /></div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${CTL} pl-9 ${kbd ? 'pr-14' : ''}`} />
      {kbd && <div className="absolute inset-y-0 right-0 pr-3 flex items-center"><span className="kbd-hint text-[10px] font-mono font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{kbd}</span></div>}
    </div>
  );
}

export function Field({ label, hint, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className={LABEL}>{label}{required && <span className="text-rose-600"> *</span>}</label>
      {children}
      {hint && <p className={`${HINT} m-0`}>{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, title, sub }) {
  return (
    <label className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 cursor-pointer hover:bg-slate-100/60">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 !w-4 !h-4 accent-[#0284c7]" />
      <div>
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </label>
  );
}

// `stack` turns the rows into cards under 768px (mobile spec, item 15): every
// cell gets its column heading as a `data-label`, which the CSS draws as the
// caption. A cell that spans columns, or one the caller labelled already, is
// left alone; an empty label hides the caption (row actions). `pin` keeps the
// first column in view while a wide report scrolls sideways.
function labelCells(children, labels) {
  return React.Children.map(children, (row) => {
    if (!React.isValidElement(row)) return row;
    if (row.type === React.Fragment) return React.cloneElement(row, {}, labelCells(row.props.children, labels));
    if (row.type !== 'tr') return row;
    let col = 0;
    const cells = React.Children.map(row.props.children, (cell) => {
      if (!React.isValidElement(cell)) return cell;
      const span = Number(cell.props.colSpan || 1);
      const i = col;
      col += span;
      if (cell.type !== 'td' || cell.props['data-label'] != null) return cell;
      return React.cloneElement(cell, { 'data-label': span > 1 ? '' : labels[i] ?? '' });
    });
    return React.cloneElement(row, {}, cells);
  });
}

export function Tbl({ head, right = [], children, dense, stack = false, pin = false, tight = false }) {
  const labels = head.map((h) => (typeof h === 'string' || typeof h === 'number' ? String(h) : ''));
  const px = tight ? 'px-2' : 'px-4';
  const tdPad = tight ? '[&>tr>td]:px-2' : '[&>tr>td]:px-4';
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-xs border-collapse ${stack ? 'table-stack' : ''} ${pin ? 'table-pin-first' : ''}`}>
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-bold border-b border-slate-200">
          <tr>{head.map((h, i) => <th key={i} className={`${dense ? 'py-2' : 'py-3'} ${px} ${right.includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody className={`divide-y divide-slate-100 ${tdPad} [&>tr>td]:py-3 [&>tr:hover]:bg-slate-50/70`}>{stack ? labelCells(children, labels) : children}</tbody>
      </table>
    </div>
  );
}

export function Avatar({ name, tone = 'sky' }) {
  const t = { sky: 'bg-blue-100 text-[#0284c7]', rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700', emerald: 'bg-emerald-100 text-emerald-700', slate: 'bg-slate-200 text-slate-700' }[tone];
  const i = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  return <span className={`w-9 h-9 rounded-full inline-flex items-center justify-center text-xs font-bold shrink-0 ${t}`}>{i}</span>;
}

export function Empty({ children }) {
  return <div className="py-8 text-center text-sm text-slate-500"><span className="ws-empty">{children}</span></div>;
}

export function Bar({ pct, tone = 'sky' }) {
  const t = { sky: 'bg-[#0284c7]', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500' }[tone];
  return <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-1"><div className={`h-full ${t}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}
