import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money, useConfirm } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK } from '../components/ws/index.jsx';
import { printPaper } from '../print.js';

// Day-end close-out — the sheet a pharmacy prints and files at closing.
//
// It answers the four questions asked every night: what did we sell, how was it
// paid for, does the drawer balance, and what controlled medicine left the
// shelf. Read-only for any past date, so it can be re-printed without altering
// the day it reports on.
//
// PHASE 09 — screen 04 (hwt-client/design/stitch/04-day-end-close). Two
// columns: on the left the working side, which is not printed — the session,
// a note-by-note drawer count that feeds `counted_cash`, and the controlled
// register check; on the right the audit sheet, which is the only thing that
// prints. Every figure on both comes from `/pharmacy/day-close`, footed on the
// server from the same rows the sections are built from.
//
// The mockup's "shift handover & safe drop" is shown as arithmetic (the float
// stays, the rest goes to the safe) and stored nowhere: no column exists for a
// safe drop and the phase doc keeps it that way.

// Notes and coins in circulation. Rs 20/10 and coins are pooled because nobody
// counts them one by one at closing time.
const NOTES = [5000, 1000, 500, 100, 50];

const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtTs = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const n2 = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PharmacyClose() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [date, setDate] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [reopenReason, setReopenReason] = useState('');
  const pingTill = () => window.dispatchEvent(new CustomEvent('hwt:till'));

  const load = useCallback((forDate) => {
    setD(null);
    const qs = forDate ? `?date=${encodeURIComponent(forDate)}` : '';
    api.get(`/pharmacy/day-close${qs}`)
      .then((r) => { setD(r); setDate(r.date); })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  // --- The drawer count ---------------------------------------------------
  // Notes are counted in the UI and only the total is stored, in the same
  // `counted_cash` column Cash Flow has always written. A count typed straight
  // into the total (no notes) is allowed too — that is how it was done before.
  // QA S3-17: the total is DERIVED from the note count and cannot be typed
  // over, and no denomination can go negative — otherwise the count is theatre.
  const [counts, setCounts] = useState({});
  const [pooled, setPooled] = useState('');   // Rs 20 / 10 / coins, as an amount
  const [notes, setNotes] = useState('');
  const nonNeg = (v) => (v === '' ? '' : String(Math.max(0, Math.floor(Number(v) || 0))));

  const noteTotal = NOTES.reduce((t, v) => t + v * Number(counts[v] || 0), 0) + Number(pooled || 0);
  const anyNotes = NOTES.some((v) => counts[v] !== undefined && counts[v] !== '') || pooled !== '';
  const counted = anyNotes ? noteTotal : null;

  // The till this count is for: the still-open session on the day shown. A
  // closed session is shown as it was counted; a past day is read-only.
  const openTill = d?.tills.find((t) => t.status === 'open') || null;
  const isToday = d && d.date === ymd(new Date());
  const canClose = !!openTill && isToday && can('cash.manage');
  const variance = counted == null || !openTill ? null : counted - openTill.expected;

  const closeShift = useCallback(async () => {
    if (!canClose || counted == null || busy) return;
    const okay = await confirm({
      title: `Close ${openTill.counter}?`,
      confirmLabel: 'Save & close shift',
      body: (
        <div className="font-mono text-sm space-y-1">
          <div className="flex justify-between"><span className="font-sans text-slate-600">System expected</span><span>{money(openTill.expected)}</span></div>
          <div className="flex justify-between"><span className="font-sans text-slate-600">Counted</span><b>{money(counted)}</b></div>
          <div className={`flex justify-between ${variance === 0 ? 'text-emerald-700' : 'text-rose-700'}`}><span className="font-sans">Variance</span><b>{variance === 0 ? 'Balanced' : `${variance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(variance))}`}</b></div>
          <div className="font-sans text-xs text-slate-500 pt-1">The count is written to the session and cannot be changed afterwards.</div>
        </div>
      ),
    });
    if (!okay) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/cashflow/${openTill.id}/close`, { counted_cash: counted, notes: notes || undefined });
      setMsg('Shift closed and reconciled. The sheet below is the one to file.');
      setCounts({}); setPooled(''); setNotes('');
      pingTill();
      load(date);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [canClose, counted, busy, openTill, variance, notes, load, date, confirm]);

  // The day itself (QA S1-04): every till counted, then the sheet is filed —
  // snapshotted and hashed — and the date is locked. Reopening is an
  // administrator's decision with a reason, and the sheet says so forever.
  const allTillsClosed = !!d && d.tills.every((t) => t.status === 'closed');
  const dayClosed = d?.closed?.status === 'closed';
  const dayReopened = d?.closed?.status === 'reopened';
  const closeDay = useCallback(async () => {
    if (!d || busy) return;
    const okay = await confirm({
      title: `Close ${d.date} and file the sheet?`,
      confirmLabel: 'Close the day',
      body: <div className="space-y-1"><div>{d.footer.bills} bills, net {money(d.footer.net)}, cash {money(d.footer.cash)}.</div><div className="text-xs text-slate-500">The figures are snapshotted and hashed. Nothing more can be posted to this date unless an administrator reopens it.</div></div>,
    });
    if (!okay) return;
    setBusy(true); setErr('');
    try { await api.post('/pharmacy/day-close/close', { date: d.date }); setMsg(`${d.date} is closed and its sheet is filed.`); load(d.date); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [d, busy, confirm, load]);
  const reopenDay = useCallback(async () => {
    if (!d || busy || !reopenReason.trim()) return;
    setBusy(true); setErr('');
    try { await api.post('/pharmacy/day-close/reopen', { date: d.date, reason: reopenReason.trim() }); setReopenReason(''); setMsg(`${d.date} reopened — the sheet will say so on every print.`); load(d.date); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [d, busy, reopenReason, load]);

  const print = useCallback(() => printPaper('a4', { modal: false }), []);

  // F8 print, F10 close the shift, Esc back to the counter — the keys the
  // mockup labels. Never stolen from a field that is being typed in.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F8') { e.preventDefault(); print(); }
      else if (e.key === 'F10') { e.preventDefault(); closeShift(); }
      else if (e.key === 'Escape') {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;
        e.preventDefault(); nav('/pharmacy');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [print, closeShift, nav]);

  // A single sentence the auditor can read instead of the tables, built from
  // the same numbers as the tables.
  const auditNote = useMemo(() => {
    if (!d) return '';
    if (!d.tills.length) return `No till session was opened on ${d.date}. Cash sales totalled Rs ${n2(d.sales.cash)}, but with no opening float recorded the drawer cannot be reconciled.`;
    const gap = d.cash_check && !d.cash_check.ok
      ? ` Cash taken at the counter was Rs ${n2(d.cash_check.cash_sales)}; Rs ${n2(d.cash_check.till_cash_in)} of it reached a till — Rs ${n2(d.cash_check.difference)} is unaccounted for.`
      : '';
    return d.tills.map((t) => {
      const opened = fmtTs(t.opened_at);
      const sales = t.expected - t.opening_float;
      const head = `${t.counter} opened ${opened} by ${t.user_name} with a float of Rs ${n2(t.opening_float)}. Net cash movement through the till was Rs ${n2(sales)}, so the drawer should hold Rs ${n2(t.expected)}.`;
      if (t.counted_cash == null) return `${head} It has not been counted yet.`;
      return `${head} Counted: Rs ${n2(t.counted_cash)}. Variance: ${t.variance === 0 ? 'nil' : `Rs ${t.variance > 0 ? '+' : ''}${n2(t.variance)}`}.`;
    }).join(' ') + gap;
  }, [d]);

  if (!d) return <div className="text-sm text-slate-500 p-6">{err ? <Alert type="error" onClose={() => setErr('')}>{err}</Alert> : 'Loading day-end summary…'}</div>;

  const s = d.sales;
  const tillExpected = d.tills.reduce((t, x) => t + (x.expected || 0), 0);
  const tillCounted = d.tills.reduce((t, x) => t + (x.counted_cash || 0), 0);
  const anyCounted = d.tills.some((x) => x.counted_cash != null);
  const dayVariance = anyCounted ? tillCounted - tillExpected : null;
  const pharmacistName = d.tills[0]?.user_name || user?.full_name || '';

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      {confirmDialog}

      {/* ---------------- Title row (not printed) -------------------------- */}
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Day-End Close &amp; Shift Cash Reconciliation</h1>
            {isToday && openTill && <span className="text-[10px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded uppercase">Till open</span>}
            {isToday && !openTill && d.tills.length > 0 && !dayClosed && <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-1.5 py-0.5 rounded uppercase">Tills reconciled</span>}
            {dayClosed && <span className="text-[10px] font-mono font-bold text-white bg-[#0b1f3d] border border-[#0b1f3d] px-1.5 py-0.5 rounded uppercase">Day closed · locked</span>}
            {dayReopened && <span className="text-[10px] font-mono font-bold text-rose-900 bg-rose-100 border border-rose-300 px-1.5 py-0.5 rounded uppercase">Reopened</span>}
          </div>
          <div className="text-xs text-slate-500">Reconcile the drawer, then print and file the audit sheet. Any past date can be re-printed.</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <input type="date" value={date} max={ymd(new Date())} onChange={(e) => load(e.target.value)}
            className="h-8 min-h-0 py-0 px-2 text-xs font-mono border border-slate-300 rounded bg-white w-40" />
          <button type="button" className={BTN} onClick={() => load(date)}><Icon name="returns" size={13} /> Refresh</button>
          <button type="button" className={BTN_DARK} onClick={print}><Icon name="printer" size={13} /> Print audit sheet <Kbd className="!bg-slate-700 !border-slate-600 !text-white">F8</Kbd></button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        {/* ================= LEFT: the working side (not printed) =========== */}
        <div className="col-span-12 xl:col-span-5 flex flex-col gap-3 no-print">

          {/* Session state */}
          <Card title="Shift terminal & session state" dot
            right={d.tills.length ? <span className="font-mono text-[10px] text-slate-500">{d.tills.map((t) => `SES-${t.id}`).join(' · ')}</span> : null}>
            {d.tills.length === 0 ? (
              <div className="text-xs text-slate-600">
                No till session was opened on {d.date}. Cash sales totalled <b className="font-mono">{money(s.cash)}</b>, but with no
                opening float recorded the drawer cannot be reconciled{isToday ? ' — open a cash session in Cash Flow at the start of the shift' : ''}.
              </div>
            ) : d.tills.map((t) => (
              <div key={t.id} className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-b border-slate-100 last:border-b-0 pb-2 mb-2 last:pb-0 last:mb-0">
                <KV k="Assigned counter" v={t.counter} />
                <KV k="Duty pharmacist" v={t.user_name} />
                <KV k="Session opened" v={fmtTs(t.opened_at)} mono />
                <KV k={t.status === 'closed' ? 'Reconciled at' : 'Reconciliation'} v={t.status === 'closed' ? fmtTs(t.closed_at) : 'pending — till still open'} mono tone={t.status === 'closed' ? '' : 'text-amber-700'} />
              </div>
            ))}
          </Card>

          {/* Drawer count */}
          <Card title="Physical cash drawer audit" sub="Tally the notes in the counter drawer"
            right={<span className="text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded">{canClose ? 'auto-calculated' : openTill ? 'read only' : 'counted'}</span>}>
            {openTill && canClose ? (
              <>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <tr><th className="text-left py-1.5 font-semibold">Note / coin</th><th className="text-center py-1.5 font-semibold w-24">Count</th><th className="text-right py-1.5 font-semibold">Total amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {NOTES.map((v) => (
                      <tr key={v}>
                        <td className="py-1.5 text-slate-700">PKR {v.toLocaleString()}</td>
                        <td className="py-1 text-center">
                          <input type="number" min="0" step="1" value={counts[v] ?? ''} placeholder="0" aria-label={`Count of PKR ${v} notes`}
                            onChange={(e) => setCounts({ ...counts, [v]: nonNeg(e.target.value) })}
                            className="w-20 h-7 min-h-0 py-0 px-2 text-center text-xs font-mono font-bold border border-slate-300 rounded bg-white focus:border-slate-800 focus:ring-1 focus:ring-slate-800" />
                        </td>
                        <td className="py-1.5 text-right font-semibold text-slate-800">{n2(v * Number(counts[v] || 0))}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1.5 text-slate-700">PKR 20 / 10 &amp; coins</td>
                      <td className="py-1 text-center text-[10px] text-slate-400 font-sans">as amount →</td>
                      <td className="py-1 text-right">
                        <input type="number" min="0" step="10" value={pooled} placeholder="0" aria-label="Small notes and coins, as an amount"
                          onChange={(e) => setPooled(nonNeg(e.target.value))}
                          className="w-28 h-7 min-h-0 py-0 px-2 text-right text-xs font-mono font-bold border border-slate-300 rounded bg-white focus:border-slate-800 focus:ring-1 focus:ring-slate-800" />
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1.5 text-xs">
                  <Row k="Opening float" v={money(openTill.opening_float)} />
                  <Row k="(+) Net cash through the till" v={money(openTill.expected - openTill.opening_float)} />
                  <Row k="System expected drawer cash" v={money(openTill.expected)} strong />
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-800">Actual counted physical cash</span>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-2 flex items-center text-[10px] text-slate-500 font-mono">Rs</span>
                      <input type="text" readOnly value={anyNotes ? n2(noteTotal) : ''} placeholder="count the notes above" aria-label="Counted physical cash (derived)"
                        className="w-44 h-8 min-h-0 py-0 pl-7 pr-2 text-right text-sm font-mono font-bold border border-slate-400 rounded bg-slate-50 text-slate-900" />
                    </div>
                  </div>
                  <div className={`mt-2 flex items-center justify-between rounded border px-3 py-2 ${
                    variance == null ? 'bg-slate-50 border-slate-200 text-slate-600'
                      : variance === 0 ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-rose-50 border-rose-300 text-rose-900'}`}>
                    <span className="font-semibold inline-flex items-center gap-1.5">
                      <Icon name={variance === 0 ? 'check' : 'warning'} size={13} /> Cash variance
                    </span>
                    <span className="font-mono font-bold">
                      {variance == null ? 'not counted yet'
                        : variance === 0 ? 'Balanced (Rs 0.00 discrepancy)'
                          : `${variance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(variance))}`}
                    </span>
                  </div>
                </div>

                {/* Arithmetic only — nothing here is stored. */}
                <div className="mt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Shift handover &amp; safe drop (suggested)</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Fig label="Float retained for next shift" value={money(openTill.opening_float)} />
                    <Fig label="Drop into the safe" value={counted == null ? '—' : money(Math.max(0, counted - openTill.opening_float))} tone="bg-emerald-50 border-emerald-300 text-emerald-900" />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Closing note (optional)</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Rs 100 short — change given twice on INV-…"
                    className="w-full h-8 min-h-0 py-0 px-2 text-xs border border-slate-300 rounded bg-white" />
                </div>

                <button type="button" onClick={closeShift} disabled={counted == null || busy}
                  className="mt-3 w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm flex items-center justify-between shadow-xs">
                  <span>{busy ? 'Closing…' : `Save & close shift — ${openTill.counter}`}</span>
                  <kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F10</kbd>
                </button>
              </>
            ) : openTill ? (
              <div className="text-xs text-slate-600">
                {isToday
                  ? <>A till is open on <b>{openTill.counter}</b> ({openTill.user_name}). Closing it needs the cash-manage permission.</>
                  : <>A till on <b>{openTill.counter}</b> was opened on {d.date} and is still open. Close it in Cash Flow — a count cannot be filed against a past day from here.</>}
              </div>
            ) : d.tills.length > 0 ? (
              <div className="space-y-2 text-xs">
                {d.tills.map((t) => (
                  <div key={t.id} className="space-y-1">
                    <Row k={`${t.counter} · opening float`} v={money(t.opening_float)} />
                    <Row k="System expected" v={money(t.expected)} />
                    <Row k="Counted" v={t.counted_cash == null ? '—' : money(t.counted_cash)} strong />
                    <div className={`flex items-center justify-between rounded border px-3 py-1.5 ${t.variance === 0 ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : t.variance == null ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-rose-50 border-rose-300 text-rose-900'}`}>
                      <span className="font-semibold">Cash variance</span>
                      <span className="font-mono font-bold">{t.variance == null ? '—' : t.variance === 0 ? 'Balanced' : `${t.variance > 0 ? '+' : ''}${money(t.variance)}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">Nothing to count — no till session on this date.</div>
            )}
          </Card>

          {/* The day (QA S1-04) */}
          {(isToday || dayClosed || dayReopened) && can('cash.manage') && (
            <Card title="Close the day" sub={dayClosed ? 'Filed — every reprint is the snapshot' : dayReopened ? 'Reopened — re-close when the correction is done' : 'Count every till, then file the sheet and lock the date'}>
              {dayClosed ? (
                <div className="text-xs space-y-2">
                  <div>Closed {fmtTs(d.closed.closed_at)} by <b>{d.closed.closed_by}</b>. Hash <span className="font-mono">{d.closed.hash?.slice(0, 16)}…</span></div>
                  {can('user.manage') && (
                    <div className="border-t border-slate-200 pt-2 space-y-1.5">
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500" htmlFor="reopen-reason">Reopen — administrator, reason required</label>
                      <input id="reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="e.g. a sale was keyed after close" className="w-full h-8 min-h-0 py-0 px-2 text-xs border border-slate-300 rounded bg-white" />
                      <button type="button" onClick={reopenDay} disabled={!reopenReason.trim() || busy} className="h-8 px-3 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded font-bold text-[11px]">Reopen {d.date}</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs space-y-2">
                  {!allTillsClosed && <div className="text-amber-800">Count and close every till first: {d.tills.filter((t) => t.status === 'open').map((t) => t.counter).join(', ') || 'none open'}.</div>}
                  {dayReopened && <div className="text-rose-800">Reopened {fmtTs(d.closed.reopened_at)} by <b>{d.closed.reopened_by}</b>: {d.closed.reopen_reason}</div>}
                  <button type="button" onClick={closeDay} disabled={!allTillsClosed || busy || !d.tills.length}
                    className="w-full py-2.5 px-3 bg-[#0b1f3d] hover:bg-[#122e54] disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm">
                    {dayReopened ? `Re-close ${d.date}` : `Close ${d.date} & lock the sheet`}
                  </button>
                </div>
              )}
            </Card>
          )}

          {/* Controlled register check */}
          <Card title="Controlled drug register (Schedule G / narcotic)" warn
            right={<span className="text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded">compliance check</span>}>
            {d.controlled.length === 0 ? (
              <div className="text-xs text-slate-600">No Schedule G or narcotic medicine was dispensed on {d.date}.</div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  <div>
                    <div className="font-semibold text-rose-900">Controlled entries today: <span className="font-mono">{d.controlled.length}</span></div>
                    <div className="text-[11px] text-rose-800 mt-0.5">
                      {d.controlled.map((c) => `${c.product_name} (qty ${c.quantity})`).join(' • ')}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-rose-900 bg-white border border-rose-300 px-1.5 py-0.5 rounded shrink-0">logged</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>Every entry carries a prescriber and the collector{d.controlled.some((c) => c.drug_schedule === 'Narcotic') ? "'s CNIC" : ''} — written at the counter, not editable afterwards.</span>
                  <span className="text-emerald-800 font-semibold whitespace-nowrap">{d.controlled.length} archived</span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ================= RIGHT: the audit sheet (what prints) ========== */}
        <div className="col-span-12 xl:col-span-7">
          <div className="dc-sheet bg-white rounded-md border border-slate-300 shadow-xs p-5 text-slate-900">
            <div className="text-center border-b-2 border-slate-900 pb-3 mb-4">
              <h2 className="text-lg font-bold m-0">{d.pharmacy.name || 'Pharmacy'}</h2>
              {d.pharmacy.address && <div className="text-[11px] text-slate-600">{d.pharmacy.address}</div>}
              {d.pharmacy.license_no && <div className="text-[11px] text-slate-600">Drug Sale Licence: {d.pharmacy.license_no}</div>}
              {d.pharmacy.contact && <div className="text-[11px] text-slate-600">{d.pharmacy.contact}</div>}
              <div className="mt-1.5 font-bold text-sm">Day-End Close Audit Sheet — <span className="font-mono">{d.date}</span></div>
              <div className="text-[11px] text-slate-500 font-mono">{d.from_snapshot ? 'Filed' : 'Generated'} {new Date(d.generated_at).toLocaleString('en-GB')}{d.closed?.hash ? ` · sha256 ${d.closed.hash.slice(0, 16)}…` : ''}</div>
            </div>

            {dayClosed && (
              <div className="mb-3 rounded border border-[#0b1f3d] bg-[#0b1f3d] text-white px-3 py-2 text-xs">
                <b>DAY CLOSED.</b> Filed {fmtTs(d.closed.closed_at)} by {d.closed.closed_by}. This print is the snapshot taken at close; the date accepts no further entries.
              </div>
            )}
            {dayReopened && (
              <div className="mb-3 rounded border-2 border-rose-600 bg-rose-50 text-rose-900 px-3 py-2 text-xs">
                <b>REOPENED</b> {fmtTs(d.closed.reopened_at)} by {d.closed.reopened_by}: {d.closed.reopen_reason}. Originally closed {fmtTs(d.closed.closed_at)} (sha256 {d.closed.hash?.slice(0, 16)}…). The figures below may differ from the sheet filed that evening.
              </div>
            )}
            {d.cash_check && !d.cash_check.ok && (
              <div className="mb-3 rounded border-2 border-rose-600 bg-rose-50 text-rose-900 px-3 py-2 text-xs">
                <b>CASH DOES NOT TIE.</b> Cash taken on bills: {money(d.cash_check.cash_sales)}. Cash that reached a till: {money(d.cash_check.till_cash_in)}. <b>Unaccounted: {money(d.cash_check.difference)}.</b>
              </div>
            )}
            {(d.alerts || []).map((a) => (
              <div key={a.code} className={`mb-2 rounded border px-3 py-2 text-xs ${a.severity === 'danger' ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>
                <b>{a.title}.</b> {a.detail}
              </div>
            ))}

            <Section title="Sales summary">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tile label="Bills" value={s.bills} sub="counter & department" />
                <Tile label="Units sold" value={s.units} sub="base units" />
                <Tile label="Gross retail" value={money(s.gross)} />
                <Tile label="Net taken" value={money(s.net)} sub="after relief" />
                <Tile label="Discount given" value={money(s.discount)} />
                <Tile label="Subsidy absorbed" value={money(s.subsidy)} sub="trust-funded" />
                <Tile label="Cost of goods" value={money(s.cogs)} sub="at batch cost" />
                <Tile label="Gross margin" value={<>{money(s.margin)} <span className="text-[11px] font-sans font-semibold text-slate-500">{s.margin_pct}%</span></>}
                  tone={s.margin < 0 ? 'text-rose-700' : 'text-emerald-700'} />
              </div>
            </Section>

            <Section title="Payments received">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tile label="Cash (drawer)" value={money(s.cash)} />
                <Tile label="Card / POS terminal" value={money(s.card)} />
                <Tile label="Online / bank transfer" value={money(s.online)} />
                <Tile label="Unpaid / on account" value={money(s.outstanding)} tone={s.outstanding > 0 ? 'text-rose-700' : ''} />
              </div>
            </Section>

            {/* The client asked for the day to be cut this way by name:
                "(card patient, dialysis patient, paid patient)". Built from
                charge_class and cost_centre, so every rupee lands in exactly one
                row and the rows sum to the footer. */}
            {d.segments?.length > 0 && (
              <Section title="Dispensing allocation & revenue ledger"
                right={d.footer && <span className="font-mono text-[11px] text-slate-600">Total turnover: <b>{money(d.footer.gross)}</b></span>}>
                <Tbl head={['Revenue category', 'Invoices', 'Gross retail', 'Discount', 'Subsidy / trust paid', 'Net']} right={[1, 2, 3, 4, 5]}>
                  {d.segments.map((x) => (
                    <tr key={x.segment}>
                      <td className="py-1.5 pr-2 font-semibold">{x.segment}</td>
                      <td className="py-1.5 text-right font-mono">{x.bills}</td>
                      <td className="py-1.5 text-right font-mono">{n2(x.gross)}</td>
                      <td className="py-1.5 text-right font-mono">{n2(x.discount)}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-700">{n2(x.subsidy)}</td>
                      <td className="py-1.5 text-right font-mono font-bold">{n2(x.net)}</td>
                    </tr>
                  ))}
                  {d.footer && (
                    <tr className="bg-slate-50 font-bold border-t-2 border-slate-900">
                      <td className="py-1.5 pr-2">Totals</td>
                      <td className="py-1.5 text-right font-mono">{d.footer.bills}</td>
                      <td className="py-1.5 text-right font-mono">{money(d.footer.gross)}</td>
                      <td className="py-1.5 text-right font-mono">{money(d.footer.discount)}</td>
                      <td className="py-1.5 text-right font-mono text-emerald-700">{money(d.footer.subsidy)}</td>
                      <td className="py-1.5 text-right font-mono">{money(d.footer.net)}</td>
                    </tr>
                  )}
                </Tbl>
              </Section>
            )}

            {d.by_department?.length > 0 && (
              <Section title="Department invoices — hospital expense">
                <Tbl head={['Department', 'Invoices', 'Value']} right={[1, 2]}>
                  {d.by_department.map((x) => (
                    <tr key={x.department}>
                      <td className="py-1.5 pr-2">{x.department}</td>
                      <td className="py-1.5 text-right font-mono">{x.invoices}</td>
                      <td className="py-1.5 text-right font-mono">{money(x.net)}</td>
                    </tr>
                  ))}
                </Tbl>
              </Section>
            )}

            {/* Given and recovered are never netted. One figure cannot tell an
                owner whether the amount owed is growing or shrinking. */}
            {d.credit && (d.credit.given.count > 0 || d.credit.recovered.count > 0) && (
              <Section title="Credit">
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Given today" value={money(d.credit.given.amount)} sub={`${d.credit.given.count} bill${d.credit.given.count === 1 ? '' : 's'}`} />
                  <Tile label="Recovered today" value={money(d.credit.recovered.amount)} sub={`${d.credit.recovered.count} payment${d.credit.recovered.count === 1 ? '' : 's'}`} tone="text-emerald-700" />
                </div>
              </Section>
            )}

            {/* A reprint of an amended day must SAY it was amended, or it silently
                disagrees with the sheet filed that evening. */}
            {d.amendments?.affecting_this_day?.length > 0 && (
              <Section title="Corrections to this day">
                <Tbl head={['Original', 'Now', 'Reason', 'Made on', 'By', 'Cash']} right={[5]}>
                  {d.amendments.affecting_this_day.map((a) => (
                    <tr key={a.id}>
                      <td className="py-1.5 font-mono">{a.original_no}</td>
                      <td className="py-1.5 font-mono">{a.corrected_no || 'cancelled'}</td>
                      <td className="py-1.5">{a.reason}</td>
                      <td className="py-1.5 font-mono">{a.made_on}</td>
                      <td className="py-1.5">{a.amended_by}</td>
                      <td className="py-1.5 text-right font-mono">{money(a.cash_delta)}</td>
                    </tr>
                  ))}
                </Tbl>
                <div className="text-[11px] text-slate-500 mt-1.5">
                  These were corrected after this day was closed. The till counted that evening is
                  unchanged; the money moved on the day the correction was made.
                </div>
              </Section>
            )}

            {d.amendments?.made_today?.filter((a) => a.for_date !== d.date).length > 0 && (
              <Section title="Corrections made today, for other days">
                <Tbl head={['For day', 'Original', 'Reason', 'Cash']} right={[3]}>
                  {d.amendments.made_today.filter((a) => a.for_date !== d.date).map((a) => (
                    <tr key={a.id}>
                      <td className="py-1.5 font-mono">{a.for_date}</td>
                      <td className="py-1.5 font-mono">{a.original_no}</td>
                      <td className="py-1.5">{a.reason}</td>
                      <td className="py-1.5 text-right font-mono">{money(a.cash_delta)}</td>
                    </tr>
                  ))}
                </Tbl>
              </Section>
            )}

            <Section title="Cash reconciliation">
              {d.tills.length === 0 ? (
                <div className="text-xs text-slate-600">
                  No till session was opened on {d.date}. Cash sales totalled <b className="font-mono">{money(s.cash)}</b>, but with no
                  opening float recorded the drawer cannot be reconciled.
                </div>
              ) : (
                <>
                  <Tbl head={['Counter', 'Operator', 'Opening float', 'Expected', 'Counted', 'Variance', 'Status']} right={[2, 3, 4, 5]}>
                    {d.tills.map((t) => (
                      <tr key={t.id}>
                        <td className="py-1.5">{t.counter}</td>
                        <td className="py-1.5">{t.user_name}</td>
                        <td className="py-1.5 text-right font-mono">{n2(t.opening_float)}</td>
                        <td className="py-1.5 text-right font-mono">{n2(t.expected)}</td>
                        <td className="py-1.5 text-right font-mono">{t.counted_cash == null ? '—' : n2(t.counted_cash)}</td>
                        <td className={`py-1.5 text-right font-mono font-bold ${t.variance == null ? '' : t.variance === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {t.variance == null ? '—' : `${t.variance > 0 ? '+' : ''}${n2(t.variance)}`}
                        </td>
                        <td className="py-1.5"><span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${t.status === 'closed' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>{t.status}</span></td>
                      </tr>
                    ))}
                  </Tbl>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                    <Tile label="Cash sales" value={money(s.cash)} />
                    <Tile label="Drawer expected" value={money(tillExpected)} />
                    <Tile label="Drawer counted" value={anyCounted ? money(tillCounted) : '—'} />
                    <Tile label="Variance" value={dayVariance == null ? 'not counted' : `${dayVariance > 0 ? '+' : ''}${money(dayVariance)}`}
                      tone={dayVariance == null ? 'text-slate-500' : dayVariance === 0 ? 'text-emerald-700' : 'text-rose-700'} />
                  </div>
                  {openTill && (
                    <div className="no-print text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 mt-2">
                      A till session is still open. Count the drawer on the left to record the cash and lock in the variance.
                    </div>
                  )}
                </>
              )}
            </Section>

            {d.refunds.length > 0 && (
              <Section title={`Refunds (${d.refunds.length})`}>
                <Tbl head={['Return no', 'Customer', 'Reason', 'Refund']} right={[3]}>
                  {d.refunds.map((r) => (
                    <tr key={r.return_no}>
                      <td className="py-1.5 font-mono">{r.return_no}</td>
                      <td className="py-1.5">{r.buyer}</td>
                      <td className="py-1.5 text-slate-500">{r.reason || '—'}</td>
                      <td className="py-1.5 text-right font-mono">{money(r.refund_amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t border-slate-300"><td colSpan={3} className="py-1.5 text-right">Total refunded</td><td className="py-1.5 text-right font-mono">{money(s.refund_amount)}</td></tr>
                </Tbl>
              </Section>
            )}

            <Section title={`Controlled drug register — ${d.date}`}>
              {d.controlled.length === 0 ? (
                <div className="text-xs text-slate-600">No Schedule G or narcotic medicine was dispensed on this date.</div>
              ) : (
                <Tbl head={['Entry', 'Medicine', 'Batch', 'Qty', 'Collected by', 'Prescriber', 'Pharmacist']} right={[3]}>
                  {d.controlled.map((c) => (
                    <tr key={c.entry_no}>
                      <td className="py-1.5 font-mono">{c.entry_no}</td>
                      <td className="py-1.5">{c.product_name} <span className="text-[9px] font-bold uppercase text-rose-900 bg-rose-100 border border-rose-300 px-1 rounded">{c.drug_schedule}</span></td>
                      <td className="py-1.5 font-mono">{c.batch_no || '—'}</td>
                      <td className="py-1.5 text-right font-mono">{c.quantity}</td>
                      <td className="py-1.5">{c.buyer || '—'}{c.buyer_cnic && <div className="text-[10px] text-slate-500 font-mono">{c.buyer_cnic}</div>}</td>
                      <td className="py-1.5">{c.prescriber_name || '—'}{c.prescription_ref && <div className="text-[10px] text-slate-500">Rx {c.prescription_ref}</div>}</td>
                      <td className="py-1.5">{c.pharmacist_name || '—'}</td>
                    </tr>
                  ))}
                </Tbl>
              )}
            </Section>

            <Section title={`Items sold (${d.items.length})`}>
              {d.items.length === 0 ? <div className="text-xs text-slate-600">Nothing was sold on this date.</div> : (
                <Tbl head={['Medicine', 'Bills', 'Units', 'Revenue']} right={[1, 2, 3]}>
                  {d.items.map((i) => (
                    <tr key={i.product_id ?? i.description}>
                      <td className="py-1">{i.description}</td>
                      <td className="py-1 text-right font-mono">{i.bills ?? '—'}</td>
                      <td className="py-1 text-right font-mono">{i.units} {i.unit || ''}</td>
                      <td className="py-1 text-right font-mono">{money(i.revenue)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t border-slate-300"><td className="py-1.5 text-right" colSpan={2}>Total</td><td className="py-1.5 text-right font-mono">{s.units}</td><td className="py-1.5 text-right font-mono">{money(s.gross)}</td></tr>
                </Tbl>
              )}
            </Section>

            <Section title={`Bills (${d.bills.length})`}>
              {d.bills.length === 0 ? <div className="text-xs text-slate-600">No bills were raised on this date.</div> : (
                <Tbl head={['Bill no', 'Time', 'Customer', 'Served by', 'Method', 'Net']} right={[5]}>
                  {d.bills.map((b) => (
                    <tr key={b.bill_no}>
                      <td className="py-1 font-mono">{b.bill_no}</td>
                      <td className="py-1 font-mono">{(b.created_at || '').slice(11, 16)}</td>
                      <td className="py-1">{b.buyer}</td>
                      <td className="py-1">{b.served_by || '—'}</td>
                      <td className="py-1">{b.payment_method}</td>
                      <td className="py-1 text-right font-mono">{money(b.net_amount)}</td>
                    </tr>
                  ))}
                </Tbl>
              )}
            </Section>

            {/* Baskets parked on an earlier day and never finished. Surfaced here
                rather than deleted quietly, because an empty slot at the counter
                with no explanation becomes a support call the next morning. */}
            {d.stale_holds?.length > 0 && (
              <Section title="Parked sales left from earlier days">
                <div className="text-[11px] text-slate-500 mb-1.5">
                  These customers were put on hold and never came back to the counter. Resume or
                  discard each one at the counter — they hold no stock, but they will keep appearing here.
                </div>
                <Tbl head={['Parked on', 'Customer', 'By']}>
                  {d.stale_holds.map((h) => (
                    <tr key={h.id}>
                      <td className="py-1 font-mono">{h.hold_date}</td>
                      <td className="py-1">{h.label || 'Customer'}</td>
                      <td className="py-1">{h.user_name || '—'}</td>
                    </tr>
                  ))}
                </Tbl>
              </Section>
            )}

            <div className="mt-4 text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 leading-relaxed">
              <span className="font-bold uppercase tracking-wide text-[10px] text-slate-500 mr-1">Cash reconciliation audit note:</span>
              {auditNote}
            </div>

            {/* The one line the owner reads. Computed server-side from the same
                rows the sections are built from, so it can never disagree with
                them — a day book whose total does not match its own sections is
                worse than no day book. */}
            {d.footer && (
              <Section title="The day in one line">
                <div className="grid grid-cols-4 gap-2">
                  <Tile label="Gross" value={money(d.footer.gross)} small />
                  <Tile label="Discount" value={money(d.footer.discount)} small />
                  <Tile label="Subsidy" value={money(d.footer.subsidy)} small />
                  <Tile label="Net" value={money(d.footer.net)} small />
                  <Tile label="Cash" value={money(d.footer.cash)} small />
                  <Tile label="Card" value={money(d.footer.card)} small />
                  <Tile label="Digital" value={money(d.footer.digital)} small />
                  <Tile label="On credit" value={money(d.footer.credit)} small />
                  <Tile label="Refunds" value={money(d.footer.refunds)} small />
                  <Tile label="Till expected" value={money(d.footer.till_expected)} small />
                  <Tile label="Counted" value={d.footer.till_counted == null ? 'not yet' : money(d.footer.till_counted)} small />
                  <Tile label="Variance" value={d.footer.variance == null ? '—' : money(d.footer.variance)} small
                    tone={d.footer.variance == null ? 'text-slate-500' : d.footer.variance === 0 ? 'text-emerald-700' : 'text-rose-700'} />
                </div>
              </Section>
            )}

            <div className="grid grid-cols-2 gap-10 mt-10">
              <div className="border-t border-slate-900 pt-2">
                <div className="font-semibold text-xs h-4">{pharmacistName}</div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>Pharmacist on duty — name &amp; signature</span>
                  <span className="font-mono">Time: ______</span>
                </div>
              </div>
              <div className="border-t border-slate-900 pt-2">
                <div className="font-semibold text-xs h-4 text-slate-400">[ pending verification ]</div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>Cash verified by — name &amp; signature</span>
                  <span className="font-mono">Date: ___/___/____</span>
                </div>
              </div>
            </div>

            <div className="no-print mt-5 pt-3 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-slate-500"><Kbd>Esc</Kbd> back to the counter</div>
              <div className="flex items-center gap-1.5">
                <button type="button" className={BTN} onClick={() => nav('/pharmacy')}>Return to POS</button>
                <button type="button" className={BTN_DARK} onClick={print}><Icon name="printer" size={13} /> Print audit sheet <Kbd className="!bg-slate-700 !border-slate-600 !text-white">F8</Kbd></button>
                {canClose && (
                  <button type="button" onClick={closeShift} disabled={counted == null || busy}
                    className="h-8 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-[11px] inline-flex items-center gap-1.5">
                    Save &amp; close shift <Kbd className="!bg-emerald-800 !border-emerald-600 !text-white">F10</Kbd>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sheet's vocabulary
// ---------------------------------------------------------------------------


function Card({ title, sub, dot, warn, right, children }) {
  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
            {dot && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
            {warn && <Icon name="warning" size={12} />}
            {title}
          </div>
          {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
        </div>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function KV({ k, v, mono, tone = '' }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{k}</div>
      <div className={`text-xs font-semibold text-slate-800 ${mono ? 'font-mono' : ''} ${tone}`}>{v}</div>
    </div>
  );
}

function Row({ k, v, strong }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold text-slate-900 border-t border-slate-200 pt-1.5' : 'text-slate-600'}`}>
      <span>{k}</span><span className="font-mono">{v}</span>
    </div>
  );
}

function Fig({ label, value, tone = 'bg-slate-50 border-slate-200 text-slate-800' }) {
  return (
    <div className={`rounded border px-3 py-2 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="font-mono font-bold text-sm mt-0.5">{value}</div>
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div className="mt-4 dc-sec">
      <div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-1 mb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Tile({ label, value, sub, tone = '', small }) {
  return (
    <div className="border border-slate-200 rounded px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono font-bold ${small ? 'text-xs' : 'text-base'} leading-tight mt-0.5 ${tone || 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Tbl({ head, right = [], children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-slate-500 border-b border-slate-300">
            {head.map((h, i) => <th key={h} className={`py-1 font-semibold ${right.includes(i) ? 'text-right' : 'text-left'} ${i === 0 ? 'pr-2' : 'px-1.5'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
