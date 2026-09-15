import React, { useState, useEffect, useCallback } from 'react';

// The strength, unless the brand name already carries it ("Amoxil 500mg" +
// "500mg" printed "Amoxil 500mg 500mg" — QA3 P6).
export function strengthOf(p) {
  if (!p || !p.strength) return null;
  return String(p.name || '').toLowerCase().includes(String(p.strength).toLowerCase()) ? null : p.strength;
}

// One formatter for every rupee figure (QA S4-29): two decimals, thousands
// separators, "Rs" lead. `Rs 2,848.5` and `Rs 897` on one screen read as two
// different kinds of number.
export function money(n) {
  return 'Rs ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The app's own confirm step (QA S3-26): restates the figures being committed
// in the app's visual language, works on a touch panel, and never hands the
// decision to a browser dialog. Enter confirms, Escape cancels — captured
// before the page's own key handlers see them.
export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'navy', onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onConfirm, onCancel]);
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4 no-print" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md p-5">
        <div className="text-base font-extrabold text-[#0b1f3d] font-headline">{title}</div>
        <div className="text-sm text-slate-700 mt-2 space-y-1">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="h-10 px-4 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" autoFocus className={`h-10 px-4 rounded-md text-sm font-bold text-white ${tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#0b1f3d] hover:bg-[#122e54]'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// `const [confirm, dialog] = useConfirm();` — `await confirm({ title, body })`
// resolves true or false; render `{dialog}` once in the page.
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const done = useCallback((v) => { setState((st) => { st?.resolve(v); return null; }); }, []);
  const dialog = state
    ? <ConfirmDialog title={state.title} body={state.body} confirmLabel={state.confirmLabel} cancelLabel={state.cancelLabel} tone={state.tone}
        onConfirm={() => done(true)} onCancel={() => done(false)} />
    : null;
  return [confirm, dialog];
}

export function CategoryBadge({ category }) {
  const map = {
    'Paid': 'gray',
    'Complete Free': 'green',
    'Discounted': 'amber',
    'Staff': 'blue',
  };
  return <span className={`badge ${map[category] || 'gray'}`}>{category}</span>;
}

export function StatusBadge({ status }) {
  const map = {
    waiting: 'amber', serving: 'blue', done: 'green', cancelled: 'red',
    ordered: 'amber', collected: 'blue', completed: 'green',
    registered: 'gray', 'in-consultation': 'blue', lab: 'amber', pharmacy: 'teal', billed: 'green',
    unpaid: 'red', partial: 'amber', paid: 'green',
  };
  return <span className={`badge ${map[status] || 'gray'}`}>{status}</span>;
}

export function Alert({ type = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`alert ${type === 'error' ? 'err' : type}`}>
      <span>{children}</span>
      {onClose && <a style={{ float: 'right' }} onClick={onClose}>✕</a>}
    </div>
  );
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}
