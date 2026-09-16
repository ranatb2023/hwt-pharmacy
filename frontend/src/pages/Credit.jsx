import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { printPaper } from '../print.js';
import { Alert, money } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, CTL, LABEL } from '../components/ws/index.jsx';

// Credit accounts and their settlement.
//
// The hand-written register, with the two things paper cannot do: it ages the
// debt, and it prints. Everything here is looked up by MOBILE, because that is
// how the counter finds an account — nobody remembers an account number.
//
// The rule this screen depends on lives in the sale route: a credit sale never
// posts cash. Money reaches the drawer here, at settlement, and nowhere else.
//
// PHASE 09 — screens 12 (the credit half) and 14 (hwt-client/design/stitch).
// Accounts on the left; the settlement workstation on the right for the one
// picked: unsettled bills, the till entry, the 80mm receipt. The mockup offers
// a picker to choose which invoices a payment clears — not built: allocation
// is oldest-first by design (Phase 04), so the screen SHOWS the allocation
// after posting rather than pretending it is a choice.

const KIND_LABEL = { 'customer-credit': 'Credit', staff: 'Staff', department: 'Department', vendor: 'Vendor', 'dialysis-demand': 'Dialysis demand' };
const KIND_TONE = { 'customer-credit': 'blue', staff: 'green', department: 'amber', vendor: 'gray', 'dialysis-demand': 'gray' };
const QUICK = [100, 500, 1000];
const n2 = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


export function Tag({ tone, children }) {
  const t = {
    red: 'text-rose-900 bg-rose-100 border-rose-300', amber: 'text-amber-900 bg-amber-100 border-amber-300',
    blue: 'text-sky-900 bg-sky-100 border-sky-300', gray: 'text-slate-700 bg-slate-100 border-slate-300',
    green: 'text-emerald-900 bg-emerald-100 border-emerald-300',
  }[tone] || 'text-slate-700 bg-slate-100 border-slate-300';
  return <span className={`text-[9px] font-semibold px-1 py-px rounded border whitespace-nowrap uppercase ${t}`}>{children}</span>;
}

export default function Credit() {
  const { can } = useAuth();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [owingOnly, setOwingOnly] = useState(true);
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (owingOnly) p.set('owing', '1');
    api.get(`/ledger/accounts${p.toString() ? `?${p}` : ''}`)
      .then((rs) => { setRows(rs); setOpen((o) => (o ? rs.find((r) => r.id === o.id) || o : o)); })
      .catch((e) => setErr(e.message));
  }, [q, owingOnly]);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);

  // Arriving from a customer's file ("Pay / Settle"): open that account.
  useEffect(() => {
    const id = location.state?.accountId;
    if (!id) return;
    setOwingOnly(false);
    api.get('/ledger/accounts').then((rs) => { const a = rs.find((r) => r.id === id); if (a) setOpen(a); }).catch(() => {});
    window.history.replaceState({}, '');
  }, [location.state]);

  const customers = rows.filter((r) => r.ledger_kind !== 'vendor');
  const total = customers.reduce((t, r) => t + (r.balance > 0 ? r.balance : 0), 0);
  const over = customers.filter((a) => a.credit_limit != null && a.balance > a.credit_limit).length;

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="ws-crumb text-[10px] font-bold uppercase tracking-wider text-slate-500">Patients &amp; accounts › customer directory › settle account &amp; cash receipt</div>
          <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Patient Credit Settlement Workstation</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={load}><Icon name="returns" size={13} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Tile label="Total outstanding" value={money(total)} tone={total > 0 ? 'warn' : 'ok'} sub={`${customers.filter((a) => a.balance > 0).length} account${customers.filter((a) => a.balance > 0).length === 1 ? '' : 's'} owe${owingOnly ? '' : ' (of those listed)'}`} />
        <Tile label="Over their limit" value={over} unit={(over) === 1 ? 'account' : 'accounts'} tone={over ? 'danger' : 'ok'} sub={over ? 'no more credit until settled' : 'everyone inside their limit'} />
        <Tile label="Staff accounts owing" value={customers.filter((a) => a.ledger_kind === 'staff' && a.balance > 0).length} unit={(customers.filter((a) => a.ledger_kind === 'staff' && a.balance > 0).length) === 1 ? 'account' : 'accounts'} sub="allowance excess, recovered from pay" />
        <Tile label="Under settlement" value={open ? open.name : '—'} mono={false} sub={open ? `${KIND_LABEL[open.ledger_kind] || open.ledger_kind} · ${open.contact || 'no mobile'}` : 'pick an account'} />
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        {/* ================= LEFT: accounts ================================= */}
        <div className="col-span-12 xl:col-span-4 bg-white rounded-md border border-slate-300 shadow-xs print:hidden">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400"><Icon name="search" size={14} /></div>
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus className={`${CTL} pl-8`} placeholder="Mobile number or name — mobile first" />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} /> Only those who owe
            </label>
          </div>
          <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
            {customers.map((a) => {
              const overLimit = a.credit_limit != null && a.balance > a.credit_limit;
              const on = open?.id === a.id;
              return (
                <button type="button" key={a.id} onClick={() => setOpen(a)}
                  className={`w-full text-left px-3 py-2 flex items-start justify-between gap-3 ${on ? 'bg-sky-50 shadow-[inset_3px_0_0_#0369a1]' : 'hover:bg-slate-50'}`}>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5">{a.name} <Tag tone={KIND_TONE[a.ledger_kind] || 'gray'}>{KIND_LABEL[a.ledger_kind] || a.ledger_kind}</Tag></div>
                    <div className="text-[10px] text-slate-500 font-mono">{a.contact || 'no mobile'}{a.credit_limit != null ? ` · limit ${money(a.credit_limit)}` : ' · no limit'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono font-bold text-xs ${a.balance > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{money(a.balance)}</div>
                    {overLimit && <Tag tone="red">over limit</Tag>}
                  </div>
                </button>
              );
            })}
            {customers.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                {q ? <><b>No account matches “{q}”.</b><br />Try the mobile number — that is the reliable key.</>
                  : owingOnly ? <><b>Nobody owes anything.</b><br />Untick “only those who owe” to see every account.</>
                    : <><b className="ws-empty">No accounts yet.</b><br />An account opens itself the first time someone buys on credit at the counter.</>}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
            <span>{customers.length} account{customers.length === 1 ? '' : 's'}</span><span>Outstanding {money(total)}</span>
          </div>
        </div>

        {/* ================= RIGHT: settlement ============================== */}
        <div className="col-span-12 xl:col-span-8 print:col-span-12">
          {open ? (
            <Settlement key={open.id} account={open} can={can} onErr={setErr} onDone={(m) => { setMsg(m); load(); }} />
          ) : (
            <div className="bg-white rounded-md border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 print:hidden">
              <Icon name="billing" size={22} />
              <div className="mt-2 font-semibold text-slate-700">No account under settlement</div>
              <div className="mt-1">Find the customer by mobile on the left.</div>
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

// ---------------------------------------------------------------------------
// Screen 14 — settle one account
// ---------------------------------------------------------------------------
function Settlement({ account, can, onErr, onDone }) {
  const { user, config } = useAuth();
  const nav = useNavigate();
  const [st, setSt] = useState(null);
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);     // the receipt just posted
  const [noTill, setNoTill] = useState(false);
  const [limitEdit, setLimitEdit] = useState(null);

  const load = useCallback(() => {
    api.get(`/ledger/accounts/${account.id}/statement`).then(setSt).catch((e) => onErr(e.message));
  }, [account.id, onErr]);
  useEffect(() => { load(); }, [load]);

  const balance = st?.closing ?? account.balance;
  const due = Number(amount || 0);
  const change = method === 'cash' && tendered !== '' ? Number(tendered) - due : null;
  const shortTendered = method === 'cash' && tendered !== '' && change < 0;
  // The bills still carrying a balance, oldest first — the order the payment
  // will be applied in. Debit entries with a bill are what the ledger holds.
  const bills = useMemo(() => (st?.entries || []).filter((e) => e.debit > 0), [st]);
  const age = st?.aging;

  const settle = useCallback(async (acceptNoTill = false) => {
    if (!(due > 0) || busy || shortTendered || !can('cash.manage')) return;
    setBusy(true);
    try {
      const r = await api.post(`/ledger/accounts/${account.id}/settle`, { amount: due, method, note: note || undefined, accept_no_till: acceptNoTill || undefined });
      setLast({ ...r, method, tendered: method === 'cash' && tendered !== '' ? Number(tendered) : due, change: Math.max(0, change || 0), at: new Date(), offTill: acceptNoTill });
      setAmount(''); setTendered(''); setNote(''); setNoTill(false);
      load();
      onDone(`Received ${money(r.entry.credit)} from ${account.name}.` + (acceptNoTill ? ' Recorded off-till — it is not in any drawer.' : ''));
    } catch (e) {
      if (e.data?.code === 'TILL_NOT_OPEN') setNoTill(true);
      else onErr(e.message);
    } finally { setBusy(false); }
  }, [due, busy, shortTendered, can, account, method, note, tendered, change, load, onDone, onErr]);

  async function saveLimit() {
    try {
      await api.put(`/ledger/accounts/${account.id}`, { credit_limit: limitEdit === '' ? null : Number(limitEdit) });
      setLimitEdit(null); onDone('Credit limit updated.');
    } catch (e) { onErr(e.message); }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F9' || (e.altKey && (e.key === 's' || e.key === 'S'))) { e.preventDefault(); settle(false); }
      else if (e.key === 'F4') { e.preventDefault(); document.getElementById('settle-tendered')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settle]);

  const initials = (account.name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

  return (
    <div className="grid grid-cols-12 gap-3 items-start">
      <div className="col-span-12 lg:col-span-7 flex flex-col gap-3 print:hidden">
        {/* Who */}
        <div className="bg-white rounded-md border border-slate-300 shadow-xs p-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded bg-slate-800 text-white font-bold text-sm flex items-center justify-center shrink-0">{initials}</div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">{account.name} <Tag tone={KIND_TONE[account.ledger_kind] || 'gray'}>{KIND_LABEL[account.ledger_kind] || account.ledger_kind}</Tag>
                  {account.credit_limit != null && balance > account.credit_limit && <Tag tone="red">over limit</Tag>}</div>
                <div className="text-[11px] text-slate-500 font-mono">{account.contact || 'no mobile'}{account.cnic ? ` · CNIC ${account.cnic}` : ''}{account.customer_id ? ` · HWT-${String(account.customer_id).padStart(6, '0')}` : ''}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {account.customer_id && <button type="button" className={BTN} onClick={() => nav('/customers', { state: { customerId: account.customer_id } })}>View file</button>}
              <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={13} /> Statement</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="border border-slate-200 rounded px-2.5 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Approved credit limit</div>
              {limitEdit == null ? (
                <div className="font-mono font-bold text-sm text-slate-900 flex items-center justify-between">{account.credit_limit == null ? <span className="text-slate-400 font-normal">no limit</span> : money(account.credit_limit)}
                  {can('billing.manage') && <button type="button" className="text-[10px] font-semibold text-slate-500 hover:text-slate-800" onClick={() => setLimitEdit(account.credit_limit ?? '')}>edit</button>}</div>
              ) : (
                <div className="flex items-center gap-1 mt-0.5">
                  <input type="number" min="0" className={`${CTL} font-mono !h-7`} value={limitEdit} onChange={(e) => setLimitEdit(e.target.value)} placeholder="blank = no limit" />
                  <button type="button" className={`${BTN} !h-7`} onClick={saveLimit}>Save</button>
                  <button type="button" className={`${BTN} !h-7 !bg-white`} onClick={() => setLimitEdit(null)}>✕</button>
                </div>
              )}
            </div>
            <div className="border border-rose-200 bg-rose-50 rounded px-2.5 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wide text-rose-800">Total dues outstanding</div>
              <div className="font-mono font-black text-base text-rose-900">{money(balance)}</div>
              <div className="text-[10px] text-rose-800">{age?.oldest ? `oldest unpaid ${age.oldest}` : balance > 0 ? 'unsettled' : 'nothing owed'}</div>
            </div>
            <div className="border border-slate-200 rounded px-2.5 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Available credit</div>
              <div className={`font-mono font-bold text-sm ${account.credit_limit != null && account.credit_limit - balance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{account.credit_limit == null ? '—' : money(account.credit_limit - balance)}</div>
              <div className="text-[10px] text-slate-500">{account.credit_limit ? `${Math.max(0, Math.round(((account.credit_limit - balance) / account.credit_limit) * 100))}% of limit` : 'no limit set'}</div>
            </div>
          </div>
          {age && age.total > 0 && (
            <div className="grid grid-cols-4 gap-1 mt-2 text-[10px]">
              {[['0–30 days', age.current, ''], ['31–60', age.d30, ''], ['61–90', age.d60, 'text-amber-700'], ['Over 90', age.d90, 'text-rose-700']].map(([l, v, c]) => (
                <div key={l} className="border border-slate-200 rounded px-2 py-1 flex justify-between"><span className="text-slate-500">{l}</span><span className={`font-mono font-semibold ${v > 0 ? c : 'text-slate-400'}`}>{n2(v)}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Unsettled bills */}
        <div className="bg-white rounded-md border border-slate-300 shadow-xs">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Credit invoices on the ledger</span>
            <span className="text-[10px] text-slate-500">payment is applied <b>oldest first</b> — by design, not by choice</span>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
              <tr><th className="text-left py-2 pl-3 pr-2">Date</th><th className="text-left py-2 px-2">Ref</th><th className="text-left py-2 px-2">Particulars</th><th className="text-right py-2 px-2">Charged</th><th className="text-right py-2 pl-2 pr-3">Balance after</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bills.map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 pl-3 pr-2 font-mono">{e.entry_date}</td>
                  <td className="py-1.5 px-2 font-mono">{e.bill_no || e.reference || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-700">{e.narration || '—'}</td>
                  <td className="py-1.5 px-2 text-right font-mono font-bold">{n2(e.debit)}</td>
                  <td className="py-1.5 pl-2 pr-3 text-right font-mono">{n2(e.balance)}</td>
                </tr>
              ))}
              {st && bills.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">Nothing charged to this account yet.</td></tr>}
              {!st && <tr><td colSpan={5} className="py-4 text-center text-slate-500">Loading…</td></tr>}
            </tbody>
          </table>
          {(st?.entries || []).some((e) => e.credit > 0) && (
            <div className="px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
              {st.entries.filter((e) => e.credit > 0).length} payment{st.entries.filter((e) => e.credit > 0).length === 1 ? '' : 's'} received so far · {money(st.entries.reduce((t, e) => t + e.credit, 0))}
            </div>
          )}
        </div>

        {last?.applied_to && (
          <div className="text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2">
            <b>Applied oldest first:</b> {last.applied_to.map((c) => `${c.ref} ${money(c.applied)}${c.fully ? ' (cleared)' : ''}`).join(', ') || 'nothing outstanding'}{last.unapplied > 0 ? ` · ${money(last.unapplied)} left on account as credit` : ''}
          </div>
        )}
      </div>

      {/* Till entry + receipt */}
      <div className="col-span-12 lg:col-span-5 flex flex-col gap-3 print:col-span-12">
        <div className="bg-white rounded-md border border-slate-300 shadow-xs print:hidden">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700 inline-flex items-center gap-1.5"><Icon name="cashflow" size={13} /> Cash counter till entry</span>
            <span className="text-[10px] font-mono text-slate-500">{user?.full_name}</span>
          </div>
          {can('cash.manage') ? (
            <div className="p-3 space-y-3">
              <div>
                <label className={LABEL}>Payment method</label>
                <div className="grid grid-cols-3 gap-1">
                  {[['cash', 'Cash'], ['card', 'Card'], ['online', 'Online / transfer']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setMethod(k)}
                      className={`h-8 text-[11px] font-semibold rounded border ${method === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between"><label className={LABEL}>Amount to settle</label>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setAmount(String(Math.max(0, balance)))} className="h-5 px-1.5 text-[10px] font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">Full ({n2(balance)})</button>
                    <button type="button" onClick={() => setAmount('')} className="h-5 px-1.5 text-[10px] font-semibold rounded border bg-white border-slate-300 hover:bg-slate-100">Clear</button>
                  </div></div>
                <div className="relative"><span className="absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-500 font-mono font-semibold">Rs</span>
                  <input type="number" min="0" step="0.01" max={balance} className={`${CTL} font-mono text-right pl-9 h-10 text-base font-bold`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={n2(balance)} /></div>
                {due > balance + 0.001 && <div className="text-[11px] text-rose-700 mt-1">More than is owed ({money(balance)}). The server will refuse — record an advance separately if that is intended.</div>}
              </div>
              {method === 'cash' && (
                <div>
                  <div className="flex items-center justify-between"><label className={LABEL}>Cash tendered</label><span className="text-[10px] text-slate-500 font-mono"><Kbd>F4</Kbd></span></div>
                  <div className="relative"><span className="absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-500 font-mono font-semibold">Rs</span>
                    <input id="settle-tendered" type="number" min="0" className={`${CTL} font-mono text-right pl-9 h-10 text-base font-bold`} value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={n2(due)} /></div>
                  <div className="grid grid-cols-4 gap-1 mt-1.5">
                    {QUICK.map((n) => <button key={n} type="button" onClick={() => setTendered(String(Number(tendered || 0) + n))} className="h-6 text-[10px] font-mono font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">+{n.toLocaleString()}</button>)}
                    <button type="button" onClick={() => setTendered(String(due))} className="h-6 text-[10px] font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">Exact</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Total due to settle</div><div className="font-mono font-bold text-slate-900">{money(due)}</div></div>
                    <div className={`rounded px-2.5 py-1.5 border ${shortTendered ? 'bg-rose-50 border-rose-300' : 'bg-emerald-50 border-emerald-300'}`}><div className={`text-[9px] font-bold uppercase tracking-wide ${shortTendered ? 'text-rose-900' : 'text-emerald-900'}`}>{shortTendered ? 'Still short' : 'Change to return'}</div><div className={`font-mono font-bold ${shortTendered ? 'text-rose-900' : 'text-emerald-900'}`}>{change == null ? '—' : money(Math.abs(change))}</div></div>
                  </div>
                </div>
              )}
              <div><label className={LABEL}>Receipt remarks / payer</label><input aria-label="Receipt remarks / payer" className={CTL} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid by son Muhammad Tariq, cash drawer #1" /></div>

              {noTill && (
                <div className="text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  <b>No till is open.</b> This cash has nowhere to land, so it will not appear on any day-end reconciliation.
                  <div className="flex gap-1.5 mt-2">
                    <button type="button" className={BTN_DARK} onClick={() => nav('/cashflow')}>Open the till first</button>
                    <button type="button" className={BTN} onClick={() => settle(true)} disabled={busy}>Record it anyway — off-till</button>
                    <button type="button" className={`${BTN} !bg-white`} onClick={() => setNoTill(false)}>Cancel</button>
                  </div>
                </div>
              )}

              <button type="button" onClick={() => settle(false)} disabled={!(due > 0) || busy || shortTendered || due > balance + 0.001}
                className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm flex items-center justify-between shadow-xs">
                <span className="inline-flex items-center gap-1.5"><Icon name="printer" size={14} /> {busy ? 'Posting…' : 'Post payment & print receipt'}</span>
                <kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
              </button>
              <div className="text-[10px] text-slate-500">Applied to the oldest bill first. Cash reaches the open till now as a credit recovery — a credit sale never touched it.</div>
            </div>
          ) : (
            <div className="p-3 text-xs text-slate-500">Taking a payment needs the cash-manage permission.</div>
          )}
        </div>

        {/* The 80mm receipt — the last one posted, or a preview of this one. */}
        <div className="bg-white rounded-md border border-slate-300 shadow-xs p-3 print:border-0 print:shadow-none">
          <div className="flex items-center justify-between mb-2 print:hidden">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{last ? 'Receipt posted' : '80mm receipt preview'}</span>
            <div className="flex gap-1">
              <button type="button" className={`${BTN} !h-7`} onClick={() => printPaper('thermal', { modal: false })}><Icon name="printer" size={12} /> 80mm</button>
              <button type="button" className={`${BTN} !h-7`} onClick={() => printPaper('a4', { modal: false })}>A4</button>
            </div>
          </div>
          <div className="receipt mx-auto font-mono text-xs text-slate-900">
            <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
              <div className="font-sans font-bold text-sm">{config.pharmacy_name || 'Pharmacy'}</div>
              {config.pharmacy_contact && <div className="text-[10px] text-slate-600">{config.pharmacy_contact}</div>}
              <div className="text-[10px] text-slate-600 mt-1 uppercase font-sans font-semibold">Official cash receipt voucher</div>
            </div>
            <div className="text-[10px] space-y-0.5">
              <div className="flex justify-between"><span>Slip</span><span>{last ? `CR-${last.entry.id}` : '—'}</span></div>
              <div className="flex justify-between"><span>Date</span><span>{(last ? last.at : new Date()).toLocaleString('en-GB')}</span></div>
              <div className="flex justify-between"><span>Customer</span><span className="font-sans">{account.name}</span></div>
              <div className="flex justify-between"><span>Account</span><span>{KIND_LABEL[account.ledger_kind] || account.ledger_kind}{account.contact ? ` · ${account.contact}` : ''}</span></div>
              <div className="flex justify-between"><span>Cashier</span><span className="font-sans">{user?.full_name}</span></div>
            </div>
            <div className="border-t border-slate-300 mt-2 pt-1.5 text-[10px] uppercase text-slate-600 flex justify-between"><span>Particulars</span><span>Amount</span></div>
            {(last?.applied_to || []).map((c) => (
              <div key={c.ref} className="flex justify-between py-0.5"><span>{c.ref}{c.fully ? ' (cleared)' : ''}</span><span>{money(c.applied)}</span></div>
            ))}
            {!last && bills.slice(0, 4).map((e) => <div key={e.id} className="flex justify-between py-0.5 text-slate-500"><span>{e.bill_no || e.reference || e.entry_date}</span><span>{money(e.debit)}</span></div>)}
            <div className="border-t border-slate-300 mt-1.5 pt-1.5 space-y-0.5">
              <div className="flex justify-between font-bold text-sm"><span className="font-sans">Settled total</span><span>{money(last ? last.entry.credit : due)}</span></div>
              <div className="flex justify-between text-[10px]"><span>Payment mode</span><span className="uppercase">{(last ? last.method : method)}{last?.offTill ? ' (no till)' : ''}</span></div>
              {(last ? last.method : method) === 'cash' && (
                <>
                  <div className="flex justify-between text-[10px]"><span>Amount tendered</span><span>{money(last ? last.tendered : Number(tendered || due))}</span></div>
                  <div className="flex justify-between text-[10px]"><span>Change paid back</span><span>{money(last ? last.change : Math.max(0, change || 0))}</span></div>
                </>
              )}
              <div className="flex justify-between text-[10px] font-bold"><span>Ledger remaining</span><span>{money(last ? last.account.balance : Math.max(0, balance - due))}{(last ? last.account.balance : balance - due) <= 0 ? ' (CLEARED)' : ''}</span></div>
            </div>
            {(last?.entry?.narration && note === '') && <div className="text-[10px] text-slate-600 mt-1 font-sans">{last.entry.narration}</div>}
            <div className="flex justify-between gap-4 mt-5 text-[10px] font-sans"><span>Received by ________</span><span>Customer ________</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
