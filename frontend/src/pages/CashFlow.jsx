import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, CTL, NUM, LABEL } from '../components/ws/index.jsx';
import { printPaper } from '../print.js';

// The till.
//
// PHASE 09 — screen 15 (hwt-client/design/stitch/15-cashflow-till). Open a
// session, move cash in and out of it with a reason, see every session's
// variance. Closing the till — counting the notes — lives on the day-end
// close since Phase 09, so "Close till" goes there; the same route as before.
//
// The mockup's supervisor PIN and "kick drawer" are not built: there is no
// PIN on a user and no drawer hardware. The witness name is stored on the
// movement's reference, which is what an auditor asks for.

const MOVES = [
  ['drop', 'out', 'Safe drop (skim)', 'cash taken out of the drawer and put in the safe'],
  ['expense', 'out', 'Petty cash expense', 'paid out of the drawer — distilled water, a courier'],
  ['float', 'in', 'Float top-up', 'change brought in from the safe'],
  ['misc', 'in', 'Other cash in', 'anything else that went into the drawer'],
];
const QUICK = [100, 500, 1000, 5000];
const fmtTs = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');


export default function CashFlow() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [others, setOthers] = useState([]);       // open on other counters (QA S2-07)
  const [forceReason, setForceReason] = useState({});
  const pingTill = () => window.dispatchEvent(new CustomEvent('hwt:till'));
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [openFloat, setOpenFloat] = useState('5000');
  const [counter, setCounter] = useState('Counter 1');
  const [move, setMove] = useState('drop');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState('');
  const [last, setLast] = useState(null);   // the movement just posted, for the voucher
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/cashflow/current').then((r) => { setSession(r.session); setOthers(r.others || []); }).catch((e) => setErr(e.message));
    api.get('/cashflow/sessions').then(setSessions).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  async function open() {
    try {
      await api.post('/cashflow/open', { counter, opening_float: Number(openFloat) });
      // Cash custody changed hands: say so, and keep the new till card in view
      // rather than jumping to the movements form (UI-06).
      setMsg(`Till opened on ${counter} with a float of ${money(openFloat)} by ${user?.full_name}. Every cash sale now posts to this drawer.`);
      pingTill(); load();
      setTimeout(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 0; window.scrollTo(0, 0); }, 50);
    } catch (e) { setErr(e.message); }
  }
  async function forceClose(s) {
    const reason = (forceReason[s.id] || '').trim();
    if (!reason) return setErr('Give a reason for closing someone else\'s till.');
    try { await api.post(`/cashflow/${s.id}/force-close`, { reason }); setMsg(`${s.counter} (${s.user_name}) force-closed — no count, noted on the day-end sheet.`); pingTill(); load(); }
    catch (e) { setErr(e.message); }
  }

  const post = useCallback(async () => {
    if (!session || !(Number(amount) > 0) || busy) return;
    const [category, type, label] = MOVES.find((m) => m[0] === move);
    setBusy(true);
    try {
      const s = await api.post('/cashflow/transaction', { session_id: session.id, type, category, amount: Number(amount), reason: reason || label, reference: witness || undefined });
      setSession(s);
      setLast({ category, type, label, amount: Number(amount), reason: reason || label, witness, at: new Date(), counter: session.counter });
      setAmount(''); setReason(''); setWitness('');
      setMsg(`${label} of ${money(amount)} recorded.`);
      pingTill();
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [session, amount, busy, move, reason, witness, load]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === 'F9') { e.preventDefault(); post(); }
      else if (e.key === 'F10') { e.preventDefault(); nav('/pharmacy-close'); }
      else if (e.key === 'Escape' && !['input', 'textarea', 'select'].includes(tag)) { e.preventDefault(); nav('/pharmacy'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [post, nav]);

  const sum = session?.summary;
  const tx = session?.transactions || [];
  const sales = tx.filter((t) => t.type === 'in' && t.category === 'sale').reduce((s, t) => s + Number(t.amount), 0);
  const drops = tx.filter((t) => t.type === 'out').reduce((s, t) => s + Number(t.amount), 0);
  const rows = sessions.filter((s) => !filter || [s.counter, s.user_name].some((x) => (x || '').toLowerCase().includes(filter.toLowerCase())));

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="ws-crumb text-[10px] font-bold uppercase tracking-wider text-slate-500">Pharmacy cash management › till sessions &amp; float audit</div>
          <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Cash Flow &amp; Till Session Management</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={load}><Icon name="returns" size={13} /> Refresh</button>
          <button type="button" className={session ? BTN_DARK : BTN} onClick={() => nav('/pharmacy-close')} disabled={!session}>
            <Icon name="clock" size={13} /> Count &amp; close till <Kbd className={session ? '!bg-slate-700 !border-slate-600 !text-white' : ''}>F10</Kbd>
          </button>
        </div>
      </div>

      {/* KPI strip — from the open session, or blank when there is none. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Tile label="Active till status" value={session ? session.counter : 'No till open'} mono={false} tone={session ? 'ok' : 'warn'}
          sub={session ? `${user?.full_name} · opened ${fmtTs(session.opened_at)}` : 'open one below before taking cash'}
          right={<span className={`text-[9px] font-bold uppercase px-1 rounded border ${session ? 'text-emerald-900 bg-emerald-100 border-emerald-300' : 'text-amber-900 bg-amber-100 border-amber-300'}`}>{session ? 'open' : 'closed'}</span>} />
        <Tile label="Opening float" value={session ? money(session.opening_float) : '—'} sub="counted in at shift start" />
        <Tile label="Cash movements (this session)" value={sum ? `${sum.cash_in - sum.cash_out >= 0 ? '+' : '−'}${money(Math.abs(sum.cash_in - sum.cash_out)).replace('Rs ', '')}` : '—'}
          tone={sum && sum.cash_in - sum.cash_out < 0 ? 'danger' : ''} sub={session ? `sales ${money(sales)} · out ${money(drops)}` : ''} />
        <div className={`rounded-md border px-3 py-2 flex items-start justify-between gap-2 ${session ? 'bg-navy-900 text-white border-navy-800' : 'ws-tile bg-white border-slate-300'}`}>
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-wide ${session ? 'text-slate-200' : 'text-slate-500'}`}>Expected drawer cash</div>
            <div className={`font-mono text-lg font-bold leading-tight mt-0.5 ${session ? 'text-emerald-300' : 'text-slate-400'}`}>{sum ? money(sum.expected) : '—'}</div>
            <div className={`text-[10px] ${session ? 'text-slate-200' : 'text-slate-500'}`}>{session ? 'float + in − out, live' : 'no session open'}</div>
          </div>
          {session && <button type="button" onClick={() => nav('/pharmacy-close')} className="text-[9px] font-bold uppercase text-navy-900 bg-emerald-300 hover:bg-emerald-200 px-1.5 py-0.5 rounded">run audit count</button>}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        {/* ================= LEFT: operations =============================== */}
        <div className="col-span-12 xl:col-span-5 flex flex-col gap-3">
          {!session ? (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md text-[11px] font-bold uppercase tracking-wide text-slate-700">Open a till session</div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={LABEL}>Counter</label><input aria-label="Counter" className={CTL} value={counter} onChange={(e) => setCounter(e.target.value)} /></div>
                  <div><label className={LABEL} htmlFor="open-float">Opening float (Rs)</label><input id="open-float" type="number" min="0" className={NUM} value={openFloat} onChange={(e) => setOpenFloat(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } }} /></div>
                </div>
                <div className="text-[11px] text-slate-500">Count the float into the drawer first. Every cash sale from the counter posts itself to this session until it is closed.</div>
                <button type="button" className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-bold text-sm flex items-center justify-between shadow-xs" onClick={open}>
                  <span className="inline-flex items-center gap-1.5"><Icon name="cashflow" size={14} /> Open till session</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700 inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Active till operations &amp; cash movements</span>
                <span className="text-[10px] font-mono text-slate-500">SES-{session.id}</span>
              </div>
              <div className="p-3 space-y-3">
                <div>
                  <label className={LABEL}>Movement type / reason</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {MOVES.map(([k, type, label, hint]) => (
                      <button key={k} type="button" onClick={() => setMove(k)} title={hint}
                        className={`text-left px-2.5 py-2 rounded border ${move === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                        <div className="text-[11px] font-semibold">{label}</div>
                        <div className={`text-[9px] font-mono uppercase ${move === k ? 'text-emerald-300' : type === 'out' ? 'text-rose-700' : 'text-emerald-700'}`}>{type === 'out' ? 'cash out' : 'cash in'}</div>
                      </button>
                    ))}
                    <button type="button" onClick={() => nav('/pharmacy-close')} className="text-left px-2.5 py-2 rounded border bg-white text-slate-700 border-slate-300 hover:bg-slate-50">
                      <div className="text-[11px] font-semibold">Mid-shift count audit</div>
                      <div className="text-[9px] font-mono uppercase text-slate-500">opens the drawer count</div>
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between"><label className={LABEL}>Transaction amount (PKR)</label><span className="text-[10px] text-slate-500 font-mono">Pakistani rupee</span></div>
                  <div className="relative"><span className="absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-500 font-mono font-semibold">Rs</span>
                    <input type="number" min="0" className={`${NUM} pl-9 h-10 text-base font-bold`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[10px] text-slate-500 mr-1">Quick add:</span>
                    {QUICK.map((n) => <button key={n} type="button" onClick={() => setAmount(String(Number(amount || 0) + n))} className="h-6 px-2 text-[10px] font-mono font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">+{n.toLocaleString()}</button>)}
                    <button type="button" onClick={() => setAmount('')} className="h-6 px-2 text-[10px] font-semibold rounded border bg-white border-slate-300 hover:bg-slate-100">Clear</button>
                  </div>
                </div>
                <div><label className={LABEL}>Voucher reference / reason</label><input aria-label="Voucher reference / reason" className={CTL} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. mid-day skim to the hospital safe · distilled water purchase" /></div>
                <div><label className={LABEL}>Witness / safe slip no</label><input aria-label="Witness / safe slip no" className={CTL} value={witness} onChange={(e) => setWitness(e.target.value)} placeholder="e.g. Treasury officer, safe slip #8819" /></div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={post} disabled={!(Number(amount) > 0) || busy}
                    className="flex-1 py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm flex items-center justify-between shadow-xs">
                    <span className="inline-flex items-center gap-1.5"><Icon name="check" size={14} /> {busy ? 'Recording…' : 'Authorise & record'}</span>
                    <kbd className="bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
                  </button>
                  <button type="button" className={`${BTN} h-10`} disabled={!last} onClick={() => printPaper('thermal', { modal: false })}><Icon name="printer" size={13} /> Voucher slip</button>
                </div>
              </div>
            </div>
          )}

          {/* The voucher for the last movement — the only thing that prints. */}
          {last && (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs p-3 print:border-0 print:shadow-none">
              <div className="receipt mx-auto font-mono text-xs text-slate-900">
                <div className="text-center border-b border-dashed border-slate-400 pb-1.5 mb-1.5"><div className="font-sans font-bold">Cash movement voucher</div><div className="text-[10px] text-slate-600">{last.counter} · {last.at.toLocaleString('en-GB')}</div></div>
                <div className="flex justify-between py-0.5"><span className="font-sans">{last.label}</span><span className="font-bold">{last.type === 'out' ? '−' : '+'}{money(last.amount)}</span></div>
                <div className="text-[10px] text-slate-600 font-sans">{last.reason}</div>
                {last.witness && <div className="text-[10px] text-slate-600 font-sans">Witness: {last.witness}</div>}
                <div className="text-[10px] text-slate-600 font-sans">By {user?.full_name}</div>
                <div className="flex justify-between gap-4 mt-4 text-[10px] font-sans"><span>Cashier ________</span><span>Witness ________</span></div>
              </div>
            </div>
          )}

          {others.length > 0 && (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs print:hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md text-[11px] font-bold uppercase tracking-wide text-slate-700">Open on other counters</div>
              <div className="divide-y divide-slate-100">
                {others.map((s) => (
                  <div key={s.id} className="px-3 py-2 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div><b>{s.counter}</b> — {s.user_name} · opened {fmtTs(s.opened_at)} · float {money(s.opening_float)}</div>
                      {s.stale ? <span className="text-[9px] font-bold uppercase px-1 rounded border text-rose-900 bg-rose-100 border-rose-300">open {Math.round(s.age_hours)} h</span> : <span className="text-[9px] font-bold uppercase px-1 rounded border text-emerald-900 bg-emerald-100 border-emerald-300">open</span>}
                    </div>
                    {s.stale && <div className="text-[11px] text-rose-800">Left open for more than a day. Its float and takings are unreconciled until it is closed.</div>}
                    {can('user.manage') && (
                      <div className="flex gap-1.5">
                        <input className={`${CTL} !h-7`} placeholder="Reason to force-close (recorded)" aria-label="Force-close reason" value={forceReason[s.id] || ''} onChange={(e) => setForceReason({ ...forceReason, [s.id]: e.target.value })} />
                        <button type="button" className={`${BTN} !h-7 !text-rose-700 whitespace-nowrap`} onClick={() => forceClose(s)}>Force close</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[11px] text-slate-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 print:hidden">
            <b>Safe drops:</b> cash taken to the safe is recorded here as cash out, so the drawer count at closing matches what is left in it. The witness name goes on the movement.
          </div>
        </div>

        {/* ================= RIGHT: sessions & feed ========================== */}
        <div className="col-span-12 xl:col-span-7 flex flex-col gap-3 print:hidden">
          <div className="bg-white rounded-md border border-slate-300 shadow-xs">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Recent sessions &amp; variance log</span>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} className={`${CTL} !w-48 !h-7`} placeholder="Filter cashier or counter…" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
                  <tr><th className="text-left py-2 pl-3 pr-2">Counter</th><th className="text-left py-2 px-2">Operator</th><th className="text-left py-2 px-2">Opened</th><th className="text-left py-2 px-2">Closed</th><th className="text-right py-2 px-2">Float</th><th className="text-right py-2 px-2">Expected</th><th className="text-right py-2 px-2">Counted</th><th className="text-right py-2 px-2">Variance</th><th className="text-left py-2 pl-2 pr-3">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((s) => (
                    <tr key={s.id} className={s.status === 'open' ? 'bg-emerald-50/40' : ''}>
                      <td className="py-1.5 pl-3 pr-2 font-semibold">{s.counter}</td>
                      <td className="py-1.5 px-2">{s.user_name}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-600 whitespace-nowrap">{fmtTs(s.opened_at)}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-600 whitespace-nowrap">{s.closed_at ? fmtTs(s.closed_at) : '—'}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{money(s.opening_float)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{s.expected_cash != null ? money(s.expected_cash) : s.status === 'open' && sum && s.id === session?.id ? money(sum.expected) : '—'}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{s.counted_cash != null ? money(s.counted_cash) : '—'}</td>
                      <td className={`py-1.5 px-2 text-right font-mono font-bold ${s.variance == null ? '' : s.variance === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{s.variance == null ? '—' : `${s.variance > 0 ? '+' : ''}${money(s.variance)}`}</td>
                      <td className="py-1.5 pl-2 pr-3">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${s.status === 'open' ? 'text-emerald-900 bg-emerald-100 border-emerald-300' : s.force_closed ? 'text-rose-900 bg-rose-100 border-rose-300' : 'text-slate-700 bg-slate-100 border-slate-300'}`}>{s.force_closed ? 'force closed' : s.status}</span>
                        {s.status === 'open' && s.id === session?.id && <button type="button" className="ml-2 text-[10px] font-semibold text-slate-700 hover:underline" onClick={() => nav('/pharmacy-close')}>Close till</button>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-slate-500"><span className="ws-empty">No sessions yet.</span></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">Showing {rows.length} of {sessions.length} sessions</div>
          </div>

          <div className="bg-white rounded-md border border-slate-300 shadow-xs">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Current session drawer feed</span>
              <span className="text-[10px] font-mono text-slate-500">{tx.length} movement{tx.length === 1 ? '' : 's'}</span>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {tx.map((t) => (
                <div key={t.id} className="px-3 py-1.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{t.category === 'sale' ? 'Counter sale' : t.category === 'credit-recovery' ? 'Credit recovered' : (MOVES.find((m) => m[0] === t.category)?.[2] || t.category)}{t.reference ? <span className="text-slate-500 font-normal font-mono"> · {t.reference}</span> : null}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{fmtTs(t.created_at)}{t.reason && t.reason !== 'Auto-posted from billing' ? ` · ${t.reason}` : ''}</div>
                  </div>
                  <div className={`font-mono font-bold whitespace-nowrap ${t.type === 'in' ? 'text-emerald-700' : 'text-rose-700'}`}>{t.type === 'in' ? '+' : '−'}{money(t.amount)}</div>
                </div>
              ))}
              {!session && <div className="px-3 py-4 text-center text-xs text-slate-500">Open a session to see its movements.</div>}
              {session && tx.length === 0 && <div className="px-3 py-4 text-center text-xs text-slate-500"><span className="ws-empty">Nothing has moved yet this session.</span></div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone = '', mono = true, right }) {
  const t = { danger: 'text-rose-700', warn: 'text-amber-700', ok: 'text-emerald-700' }[tone] || 'text-slate-900';
  return (
    <div className="ws-tile bg-white border flex items-start justify-between gap-2" data-tone={tone}>
      <div className="min-w-0">
        <div className="ws-tile-label text-[10px] font-bold uppercase tracking-wide text-slate-500 line-clamp-2 min-h-[2.4em] leading-[1.2]">{label}</div>
        <div className={`ws-tile-value ${mono ? 'ws-tile-mono' : ''} font-bold leading-tight mt-0.5 break-words ${t}`}>{value}</div>
        <div className="ws-tile-sub text-[10px] text-slate-500 line-clamp-2">{sub}</div>
      </div>
      {right}
    </div>
  );
}
