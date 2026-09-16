import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, CTL, LABEL } from '../components/ws/index.jsx';
import { printPaper } from '../print.js';

// Customer returns.
//
// PHASE 09 — screen 13 (hwt-client/design/stitch/13-returns-refund; the
// mockup rendered blank, its HTML outline was used). Find the bill, tick what
// is coming back and whether it can go back on the shelf, take the refund.
//
// QA 2026-09-14: everything is checked on the SERVER against the original
// bill — quantity, price, what already came back, what was paid. What this
// screen adds: the reason register (a picklist, required), the second
// person's credentials above the refund threshold, and the truth about the
// drawer — a cash refund is paid out of the open till and posted as cash out.

const fmtTs = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const REASON_LABEL = { 'wrong item': 'Wrong item dispensed', 'wrong strength': 'Wrong strength', 'patient reaction': 'Patient reaction', 'duplicate purchase': 'Duplicate purchase', damaged: 'Damaged', expired: 'Expired', 'unused course': 'Unused course', other: 'Other (say what)' };

export default function Returns() {
  const { config, user } = useAuth();
  const nav = useNavigate();
  const [billNo, setBillNo] = useState('');
  const [bill, setBill] = useState(null);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [auth, setAuth] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const [meta, setMeta] = useState({ reasons: Object.keys(REASON_LABEL), refund_auth_threshold: 5000 });
  const inputRef = useRef(null);

  const loadRecent = useCallback(() => { api.get('/returns').then(setRecent).catch(() => {}); }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);
  useEffect(() => { api.get('/returns/reasons').then(setMeta).catch(() => {}); }, []);

  const lookup = useCallback(async (e) => {
    e?.preventDefault();
    if (!billNo.trim()) return;
    setErr(''); setBill(null); setDone(null);
    try {
      const b = await api.get(`/returns/bill/${encodeURIComponent(billNo.trim())}`);
      setBill(b);
      setLines((b.lines || []).map((l) => ({
        product_id: l.product_id, description: `${l.name || l.description}${l.strength ? ` ${l.strength}` : ''}`, unit: l.unit,
        sold: l.sold, already: l.already_returned, max: l.returnable, unit_price: l.unit_price, quantity: 0,
        saleable: !l.is_refrigerated, cold: !!l.is_refrigerated,
      })));
    } catch (e2) { setErr(e2.message); }
  }, [billNo]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const gross = lines.reduce((s, l) => s + Number(l.unit_price) * Number(l.quantity || 0), 0);
  const ceiling = bill ? Number(bill.refund_ceiling ?? bill.paid_amount) : 0;
  const refund = Math.min(gross, ceiling);
  const capped = gross > ceiling + 0.001;
  const unitsBack = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const restock = lines.filter((l) => l.quantity > 0 && l.saleable).reduce((s, l) => s + Number(l.quantity), 0);
  const threshold = Number(bill?.refund_auth_threshold ?? meta.refund_auth_threshold ?? 0);
  const needsAuth = threshold > 0 && refund > threshold;
  const reasonOk = reason && (reason !== 'other' || reasonNote.trim());
  const authOk = !needsAuth || (auth.username.trim() && auth.password);
  const ledger = bill && bill.payment_method === 'credit' && bill.ledger_account_id;

  const submit = useCallback(async () => {
    if (!bill || busy || unitsBack <= 0 || !reasonOk || !authOk) return;
    const items = lines.filter((l) => l.quantity > 0).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), saleable: l.saleable }));
    if (!items.length) return setErr('Enter a quantity to return.');
    setBusy(true); setErr('');
    try {
      const r = await api.post('/returns', {
        bill_id: bill.id, reason, reason_note: reasonNote.trim() || undefined, items,
        authoriser: needsAuth ? { username: auth.username.trim(), password: auth.password } : undefined,
      });
      setDone({ ...r, lines: lines.filter((l) => l.quantity > 0), reason: reason === 'other' ? reasonNote.trim() : `${REASON_LABEL[reason] || reason}${reasonNote.trim() ? ` — ${reasonNote.trim()}` : ''}`, bill });
      setAuth({ username: '', password: '' });
      window.dispatchEvent(new CustomEvent('hwt:till'));
      loadRecent();
    } catch (e) {
      if (e.data?.code === 'TILL_NOT_OPEN') setErr('No till is open for you. A cash refund is paid out of an open till — open one in Cash Flow (Alt+7) first.');
      else setErr(e.message);
    } finally { setBusy(false); }
  }, [bill, busy, unitsBack, reasonOk, authOk, lines, reason, reasonNote, needsAuth, auth, loadRecent]);

  const reset = () => { setDone(null); setBill(null); setBillNo(''); setLines([]); setReason(''); setReasonNote(''); setAuth({ username: '', password: '' }); setErr(''); inputRef.current?.focus(); };

  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === 'F9') { e.preventDefault(); if (done) reset(); else submit(); }
      else if (e.key === 'Escape') {
        if (['input', 'textarea', 'select'].includes(tag) && document.activeElement !== inputRef.current) return;
        e.preventDefault(); if (bill || done) reset(); else nav('/pharmacy');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, done, bill, nav]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = ymd(new Date());
  const todays = recent.filter((r) => String(r.created_at || '').slice(0, 10) === today);
  const refundedToday = todays.reduce((t, r) => t + Number(r.refund_amount || 0), 0);
  const canSubmit = bill && !done && unitsBack > 0 && reasonOk && authOk && !busy;

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="ws-crumb text-[10px] font-bold uppercase tracking-wider text-slate-500">Counter › returns &amp; refunds</div>
          <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Customer Returns &amp; Refund Counter</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={() => nav('/pharmacy')}><Kbd>Esc</Kbd> Counter home</button>
          {bill && !done && (
            <button type="button" className={`${BTN_DARK} !bg-emerald-700 hover:!bg-emerald-800`} onClick={submit} disabled={!canSubmit}>
              <Icon name="returns" size={13} /> Process return &amp; refund <Kbd className="!bg-emerald-800 !border-emerald-600 !text-white">F9</Kbd>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Tile label="Returns today" value={todays.length} unit={(todays.length) === 1 ? 'slip' : 'slips'} sub={todays.length ? `last ${todays[0].return_no}` : 'none yet'} />
        <Tile label="Refunded today" value={money(refundedToday)} sub="paid out of the till, on the day-end sheet" tone={refundedToday > 0 ? 'warn' : ''} />
        <Tile label="Authorisation threshold" value={money(threshold)} sub="above it a second person with billing override signs" />
        <Tile label="Bill under review" value={bill ? bill.bill_no : '—'} sub={bill ? fmtTs(bill.created_at) : 'scan or type an invoice number'} mono />
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        {/* ================= LEFT: find the bill, tick the lines ============= */}
        <div className="col-span-12 xl:col-span-7 flex flex-col gap-3 print:hidden">
          <div className="bg-white rounded-md border border-slate-300 shadow-xs p-3">
            <form className="flex gap-2" onSubmit={lookup}>
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Icon name="barcode" size={16} /></div>
                <input ref={inputRef} value={billNo} onChange={(e) => setBillNo(e.target.value)} autoFocus autoComplete="off" aria-label="Invoice number"
                  className="block w-full h-9 min-h-0 pl-9 pr-3 py-0 text-sm bg-slate-50 border border-slate-300 rounded focus:border-slate-800 focus:bg-white focus:ring-1 focus:ring-slate-800 font-mono font-medium text-slate-900 placeholder-slate-400"
                  placeholder="Scan or enter the invoice number (e.g. INV-202609-00019)" />
              </div>
              <button type="submit" className={`${BTN_DARK} h-9`} disabled={!billNo.trim()}>Verify bill</button>
            </form>
            {bill && (
              <div className="mt-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-slate-600">
                <span>Dispensed: <b className="font-mono text-slate-800">{fmtTs(bill.created_at)}</b></span>
                <span>Customer: <b className="text-slate-800">{bill.customer_name || (bill.patient_id ? 'Registered customer' : 'Walk-in')}</b></span>
                <span>Category: <b className="text-slate-800">{bill.category}</b></span>
                <span>Paid by: <b className="text-slate-800 capitalize">{bill.payment_method}</b></span>
                <span>Bill total: <b className="font-mono text-slate-800">{money(bill.net_amount)}</b></span>
                <span>Paid: <b className="font-mono text-slate-800">{money(bill.paid_amount)}</b></span>
                {bill.refunded_so_far > 0 && <span>Already refunded: <b className="font-mono text-rose-700">{money(bill.refunded_so_far)}</b></span>}
                {bill.discount + bill.subsidy > 0 && <span>Relief on the bill: <b className="font-mono text-emerald-700">{money(bill.discount + bill.subsidy)}</b></span>}
                {bill.status === 'amended' && <span className="text-[9px] font-bold uppercase text-rose-900 bg-rose-100 border border-rose-300 px-1 rounded">amended — return against the corrected bill</span>}
              </div>
            )}
          </div>

          {bill && !done && (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Items on the bill — what is coming back</span>
                <span className="text-[10px] font-mono text-slate-500">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
              </div>
              <div className="overflow-x-auto"><table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
                  <tr><th className="text-left py-2 pl-3 pr-2">Medicine</th><th className="text-right py-2 px-2">Sold</th><th className="text-right py-2 px-2">Back already</th><th className="text-center py-2 px-2 w-40">Return qty</th><th className="text-left py-2 px-2">Condition</th><th className="text-right py-2 pl-2 pr-3">Refund</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => (
                    <tr key={i} className={l.quantity > 0 ? 'bg-sky-50/40' : ''}>
                      <td className="py-2 pl-3 pr-2"><div className="font-semibold text-slate-900">{l.description}</div><div className="text-[10px] text-slate-500 font-mono">@ {money(l.unit_price)} / {l.unit || 'unit'}{l.cold ? ' · cold chain — write-off only' : ''}</div></td>
                      <td className="py-2 px-2 text-right font-mono">{l.sold}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-500">{l.already || '—'}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" className="w-6 h-6 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded font-bold" onClick={() => setLine(i, 'quantity', Math.max(0, l.quantity - 1))} aria-label="One fewer">−</button>
                          <input type="number" min="0" max={l.max} value={l.quantity} aria-label={`Return quantity of ${l.description}`}
                            onChange={(e) => setLine(i, 'quantity', Math.min(l.max, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                            className="w-14 h-6 min-h-0 text-center font-mono font-bold text-xs bg-white border border-slate-300 rounded p-0" />
                          <button type="button" className="w-6 h-6 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded font-bold" onClick={() => setLine(i, 'quantity', Math.min(l.max, l.quantity + 1))} aria-label="One more">+</button>
                          <button type="button" className="ml-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800" onClick={() => setLine(i, 'quantity', l.max)} disabled={l.max === 0}>all</button>
                        </div>
                        {l.max === 0 && <div className="text-center text-[10px] text-rose-700 mt-0.5">fully returned</div>}
                      </td>
                      <td className="py-2 px-2">
                        <div className="inline-flex border border-slate-300 rounded overflow-hidden">
                          {[[true, 'Restock', 'sealed, unopened — held in quarantine until a pharmacist releases it'], [false, 'Write-off', 'opened or damaged — off the books']].map(([v, l2, title]) => (
                            <button key={String(v)} type="button" title={title} onClick={() => !(v && l.cold) && setLine(i, 'saleable', v)} disabled={v && l.cold}
                              className={`px-2 h-6 text-[10px] font-semibold ${l.saleable === v ? (v ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white') : 'bg-white text-slate-600 hover:bg-slate-100'} disabled:opacity-40`}>{l2}</button>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pl-2 pr-3 text-right font-mono font-bold">{money(Number(l.unit_price) * Number(l.quantity || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="p-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL} htmlFor="ret-reason">Reason for return *</label>
                  <select id="ret-reason" className={CTL} value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">Choose a reason…</option>
                    {(meta.reasons || Object.keys(REASON_LABEL)).map((r) => <option key={r} value={r}>{REASON_LABEL[r] || r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL} htmlFor="ret-note">{reason === 'other' ? 'Say what *' : 'Note (optional)'}</label>
                  <input id="ret-note" className={CTL} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="e.g. patient discharged, course stopped by the doctor" />
                </div>
              </div>
            </div>
          )}

          {!bill && !done && recent.length > 0 && (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md text-[11px] font-bold uppercase tracking-wide text-slate-700">Recent returns</div>
              <div className="overflow-x-auto"><table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
                  <tr><th className="text-left py-2 pl-3 pr-2">Return</th><th className="text-left py-2 px-2">When</th><th className="text-left py-2 px-2">Against</th><th className="text-left py-2 px-2">Customer</th><th className="text-left py-2 px-2">Reason</th><th className="text-right py-2 pl-2 pr-3">Refund</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5 pl-3 pr-2 font-mono font-semibold whitespace-nowrap">{r.return_no}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-600 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-600 whitespace-nowrap">{r.bill_no || '—'}</td>
                      <td className="py-1.5 px-2">{r.customer_name || '—'}</td>
                      <td className="py-1.5 px-2 text-slate-600">{r.reason || '—'}{r.authorised_by_name ? <span className="text-[10px] text-slate-500"> · authorised by {r.authorised_by_name}</span> : null}</td>
                      <td className="py-1.5 pl-2 pr-3 text-right font-mono font-bold">{money(r.refund_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </div>

        {/* ================= RIGHT: the refund ============================== */}
        <div className="col-span-12 xl:col-span-5 print:col-span-12">
          {done ? (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs p-4 print:border-0 print:shadow-none">
              <div className="print:hidden rounded border px-3 py-2 text-xs bg-emerald-50 border-emerald-300 text-emerald-900 mb-3">
                <b>Return {done.returnNo} processed.</b> {restock > 0 ? `${restock} unit${restock === 1 ? '' : 's'} back in quarantine — a pharmacist releases them to the shelf` : 'nothing restocked'}{unitsBack - restock > 0 ? `, ${unitsBack - restock} written off` : ''}. Refund {money(done.refund)}{done.refund_method === 'ledger' ? ' credited to the account' : ' paid out of the till'}.{done.capped ? ' The refund was capped at what was actually paid on the bill.' : ''}
              </div>
              <div className="receipt mx-auto font-mono text-slate-900 text-xs">
                <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
                  <div className="font-sans font-bold text-sm">{config.pharmacy_name || 'Pharmacy'}</div>
                  {config.pharmacy_address && <div className="text-[10px] text-slate-600 font-sans">{config.pharmacy_address}</div>}
                  {config.pharmacy_contact && <div className="text-[10px] text-slate-600 font-sans">{config.pharmacy_contact}</div>}
                  {config.pharmacy_license_no && <div className="text-[10px] text-slate-600 font-sans">Drug Sale Licence: {config.pharmacy_license_no}</div>}
                  <div className="text-[10px] text-slate-600">Return &amp; refund slip</div>
                  <div className="font-bold mt-1">{done.returnNo}</div>
                  <div className="text-[10px] text-slate-600">{new Date().toLocaleString('en-GB')} · against {done.bill.bill_no}</div>
                </div>
                {done.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2 py-0.5"><span className="font-sans">{l.description} × {l.quantity} {l.unit || ''}{l.saleable ? '' : ' (w/o)'}</span><span>{money(l.unit_price * l.quantity)}</span></div>
                ))}
                <div className="border-t border-slate-300 mt-2 pt-2 flex justify-between font-bold text-sm"><span className="font-sans">Refund{done.refund_method === 'ledger' ? ' (to account)' : ''}</span><span>{money(done.refund)}</span></div>
                {done.reason && <div className="text-[10px] text-slate-600 mt-1 font-sans">Reason: {done.reason}</div>}
                <div className="text-[10px] text-slate-600 mt-1 font-sans">Handled by {user?.full_name}{done.authorised_by ? ` · authorised by ${done.authorised_by}` : ''}</div>
                <div className="flex justify-between gap-6 mt-6 text-[10px] font-sans"><span>Refunded by ________</span><span>Received by ________</span></div>
              </div>
              <div className="print:hidden grid grid-cols-2 gap-2 mt-4">
                <button type="button" className={`${BTN} justify-center h-10`} onClick={() => printPaper('thermal', { modal: false })}><Icon name="printer" size={14} /> Print slip (80mm)</button>
                <button type="button" className="h-10 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-bold text-sm flex items-center justify-between" onClick={reset}>
                  <span>New return</span><kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs p-3 space-y-3">
              <div className="bg-navy-900 text-white rounded p-3 border border-navy-800">
                <div className="flex justify-between items-center text-[11px] text-slate-400 uppercase tracking-wider font-semibold"><span>{ledger ? 'Credit to account' : 'Refund to disburse'}</span><span className="font-mono bg-slate-800 px-1.5 rounded border border-slate-700">PKR</span></div>
                <div className="font-mono font-black text-3xl mt-1">{money(refund)}</div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-xs space-y-1 font-mono text-slate-300">
                  <div className="flex justify-between"><span className="font-sans text-slate-400">Units coming back</span><span>{unitsBack}</span></div>
                  <div className="flex justify-between"><span className="font-sans text-slate-400">To quarantine (restock)</span><span>{restock}</span></div>
                  <div className="flex justify-between"><span className="font-sans text-slate-400">Written off</span><span>{unitsBack - restock}</span></div>
                  {capped && <div className="flex justify-between text-amber-300"><span className="font-sans">Capped at what was paid</span><span>{money(ceiling)}</span></div>}
                </div>
              </div>
              {!bill && <div className="text-xs text-slate-500">Verify a bill on the left. Only what was dispensed on that bill can come back, at the price it was sold for, and never more than was paid.</div>}
              {bill && needsAuth && (
                <div className="text-[11px] rounded border px-3 py-2 bg-amber-50 border-amber-200 text-amber-900 space-y-2">
                  <div><b>Above {money(threshold)}.</b> A second person holding billing override authorises this refund with their own sign-in. Their name is recorded on the return.</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className={`${CTL} !bg-white`} placeholder="Authoriser username" aria-label="Authoriser username" autoComplete="off" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
                    <input className={`${CTL} !bg-white`} type="password" placeholder="Their password" aria-label="Authoriser password" autoComplete="new-password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                {ledger
                  ? <>This bill was on account. The refund is <b>credited to the customer's ledger</b> — no cash leaves the drawer.</>
                  : <>The refund is <b>paid out of your open till</b> and posted as cash out with the return number, so the drawer count at closing still ties. Restocked units are held in quarantine under their original batch until a pharmacist releases them.</>}
              </div>
              {bill && (
                <button type="button" onClick={submit} disabled={!canSubmit}
                  className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm flex items-center justify-between shadow-xs">
                  <span className="inline-flex items-center gap-1.5"><Icon name="check" size={14} /> {busy ? 'Processing…' : 'Process return & refund'}</span>
                  <kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
                </button>
              )}
              {bill && !reasonOk && unitsBack > 0 && <div className="text-[11px] text-rose-800">Choose a reason for the return register.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, unit, sub, tone = '', mono = true }) {
  const t = { danger: 'text-rose-700', warn: 'text-amber-700', ok: 'text-emerald-700' }[tone] || 'text-slate-900';
  return (
    <div className="ws-tile bg-white border" data-tone={tone}>
      <div className="ws-tile-label text-[10px] font-bold uppercase tracking-wide text-slate-500 line-clamp-2 min-h-[2.4em] leading-[1.2]">{label}</div>
      <div className={`ws-tile-value ${mono ? 'ws-tile-mono' : ''} font-bold leading-tight mt-0.5 break-words ${t}`}>{value} {unit && <span className="text-[11px] font-sans font-semibold text-slate-500">{unit}</span>}</div>
      <div className="ws-tile-sub text-[10px] text-slate-500 line-clamp-2">{sub}</div>
    </div>
  );
}
