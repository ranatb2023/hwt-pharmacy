import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Select from '../components/Select.jsx';
import { api } from '../api.js';
import { isTouch, useRevealOnSelect } from '../components/touch.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, CTL, LABEL } from '../components/ws/index.jsx';
import QRCode from '../components/QRCode.jsx';
import { printPaper } from '../print.js';

// Customers and their welfare cards.
//
// Patient Management is on hold, so this is the identity screen for the whole
// product: walk-ins who asked to be remembered, regulars with an account, dialysis
// patients, staff. Departments hold a record too but are managed on their own
// page and never appear here.
//
// Search is by MOBILE first. That is how an account is looked up in this country —
// not by a code nobody memorises.
//
// PHASE 09 — screen 12 (hwt-client/design/stitch/12-customer-cards-credit).
// Directory on the left, the customer's file on the right in place of the
// modal: dispense history, cards and entitlement, credit limit. "Pay / Settle"
// hands the account to the settlement workstation (screen 14). The card
// column reads one list of cards instead of one request per row.

const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function Tag({ tone, children }) {
  const t = {
    red: 'text-rose-900 bg-rose-100 border-rose-300', amber: 'text-amber-900 bg-amber-100 border-amber-300',
    blue: 'text-sky-900 bg-sky-100 border-sky-300', gray: 'text-slate-700 bg-slate-100 border-slate-300',
    green: 'text-emerald-900 bg-emerald-100 border-emerald-300',
  }[tone] || 'text-slate-700 bg-slate-100 border-slate-300';
  return <span className={`text-[9px] font-semibold px-1 py-px rounded border whitespace-nowrap uppercase ${t}`}>{children}</span>;
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
function Field({ label, hint, children, className = '' }) {
  return <div className={className}><label className={LABEL}>{label}</label>{children}{hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}</div>;
}

export default function Customers() {
  const { can } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [cards, setCards] = useState([]);       // every card (latest 100) — one request, not one per row
  const [accounts, setAccounts] = useState([]); // every ledger account (latest 100)
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('customers');
  // Narrow screens stack the directory above the file (mobile spec, item 4).
  const detailRef = useRevealOnSelect(open?.id);
  const listRef = useRef(null);
  const [pill, setPill] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const searchRef = useRef(null);

  const load = useCallback(() => {
    api.get(`/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch((e) => setErr(e.message));
  }, [q]);
  const loadSide = useCallback(() => {
    api.get('/cards').then(setCards).catch(() => {});
    api.get('/ledger/accounts').then(setAccounts).catch(() => {});
  }, []);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);
  useEffect(() => { loadSide(); }, [loadSide]);

  // Arriving from the settlement screen's "View file".
  useEffect(() => {
    const id = location.state?.customerId;
    if (!id) return;
    api.get(`/patients/${id}`).then(setOpen).catch(() => {});
    window.history.replaceState({}, '');
  }, [location.state]);

  const cardOf = useMemo(() => {
    const m = new Map();
    for (const c of cards) if (c.status === 'active' && !c.is_expired && !m.has(c.customer_id)) m.set(c.customer_id, c);
    return m;
  }, [cards]);
  const acctOf = useMemo(() => {
    const m = new Map();
    for (const a of accounts) if (a.customer_id && a.ledger_kind !== 'vendor' && !m.has(a.customer_id)) m.set(a.customer_id, a);
    return m;
  }, [accounts]);

  const isStaff = (c) => c.category === 'Staff' || c.customer_type === 'staff';
  const visible = rows.filter((c) => c.customer_type !== 'department')
    .filter((c) => pill === 'all' ? true : pill === 'cards' ? cardOf.has(c.id) : pill === 'staff' ? isStaff(c) : pill === 'due' ? (acctOf.get(c.id)?.balance || 0) > 0 : true);

  const outstanding = accounts.filter((a) => a.ledger_kind !== 'vendor').reduce((t, a) => t + Math.max(0, a.balance), 0);
  const activeCards = cards.filter((c) => c.status === 'active' && !c.is_expired).length;
  const soon = ymd(new Date(Date.now() + 30 * 86400000));
  const expiring = cards.filter((c) => c.status === 'active' && !c.is_expired && c.valid_till && c.valid_till <= soon).length;
  const overLimit = accounts.filter((a) => a.ledger_kind !== 'vendor' && a.credit_limit != null && a.balance > a.credit_limit).length;

  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (showNew) return;
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (['input', 'textarea', 'select'].includes(tag)) return;
      else if (e.altKey && (e.key === 'n' || e.key === 'N') && can('patient.manage')) { e.preventDefault(); setShowNew(true); }
      else if (e.altKey && (e.key === 'p' || e.key === 'P') && open && acctOf.get(open.id)) { e.preventDefault(); nav('/credit', { state: { accountId: acctOf.get(open.id).id } }); }
      else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNew, open, acctOf, can, nav]);

  const done = (m) => { setMsg(m); setShowNew(false); load(); loadSide(); };

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="ws-crumb text-[10px] font-bold uppercase tracking-wider text-slate-500">Patients &amp; accounts › customer directory &amp; welfare cards</div>
          <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Customer Accounts, Welfare Cards &amp; Credit Ledger</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={() => { load(); loadSide(); }}><Icon name="returns" size={13} /> Refresh</button>
          {can('patient.manage') && <button type="button" className={BTN_DARK} onClick={() => setShowNew(true)}><Icon name="plus" size={13} /> Register customer <Kbd className="!bg-slate-700 !border-slate-600 !text-white">Alt+N</Kbd></button>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Tile label="Total credit outstanding" value={money(outstanding)} tone={outstanding > 0 ? 'warn' : 'ok'} sub={`${accounts.filter((a) => a.ledger_kind !== 'vendor' && a.balance > 0).length} accounts owe · ${overLimit} over limit`} />
        <Tile label="Active welfare cards" value={activeCards} unit={(activeCards) === 1 ? 'card' : 'cards'} tone="ok" sub={expiring ? `${expiring} expire within 30 days` : 'none expiring within 30 days'} />
        <Tile label="Staff accounts" value={accounts.filter((a) => a.ledger_kind === 'staff').length} unit="on ledger" sub="allowance excess recovered from pay" />
        <Tile label="Customer under review" value={open ? open.full_name : '—'} mono={false} sub={open ? `${open.patient_code} · ${open.contact || 'no mobile'}` : 'pick one from the directory'} />
      </div>

      <div className="flex items-center gap-1 print:hidden">
        {[['customers', 'Directory'], ['cards', 'Welfare card register'], ['tiers', 'Tiers & funds']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`h-7 min-h-[44px] lg:min-h-0 touch:min-h-[44px] px-2.5 text-[11px] font-semibold rounded border ${tab === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
        ))}
      </div>

      {tab === 'customers' && (
        <div className="grid grid-cols-12 gap-3 items-start">
          <div ref={listRef} className="col-span-12 xl:col-span-5 bg-white rounded-md border border-slate-300 shadow-xs print:hidden scroll-mt-3">
            <div className="p-3 border-b border-slate-200 space-y-2">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400"><Icon name="search" size={14} /></div>
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} autoFocus className={`${CTL} pl-8 pr-10`} placeholder="Mobile number, name, customer ID or card number — mobile first" />
                <div className="absolute inset-y-0 right-0 pr-2 flex items-center"><Kbd>F2</Kbd></div>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {[['all', 'All accounts'], ['cards', 'Welfare cards'], ['staff', 'Staff'], ['due', 'Balance due']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setPill(k)}
                    className={`h-7 px-2.5 text-[11px] font-semibold rounded border ${pill === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              {visible.map((c) => {
                const card = cardOf.get(c.id); const acct = acctOf.get(c.id); const on = open?.id === c.id;
                const initials = (c.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
                return (
                  <button type="button" key={c.id} onClick={() => setOpen(c)}
                    className={`w-full text-left px-3 py-2 flex items-start gap-3 ${on ? 'bg-sky-50 shadow-[inset_3px_0_0_#0369a1]' : 'hover:bg-slate-50'}`}>
                    <div className={`h-8 w-8 rounded text-white font-bold text-[11px] flex items-center justify-center shrink-0 ${isStaff(c) ? 'bg-emerald-700' : card ? 'bg-sky-700' : 'bg-slate-700'}`}>{initials}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5">{c.full_name}
                        {card && <Tag tone="blue">{Math.round(card.discount_pct * 100)}% · {card.card_no}</Tag>}
                        {isStaff(c) && <Tag tone="green">staff</Tag>}
                        {acct?.credit_limit != null && acct.balance > acct.credit_limit && <Tag tone="red">over limit</Tag>}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">ID {c.patient_code}{c.contact ? ` · ${c.contact}` : ' · no mobile'}{c.cnic ? ` · ${c.cnic}` : ''}</div>
                      <div className="text-[10px] text-slate-500">
                        {acct ? <>{acct.credit_limit != null ? <>Limit <span className="font-mono">{money(acct.credit_limit)}</span> · </> : null}Owes <span className={`font-mono font-semibold ${acct.balance > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{money(acct.balance)}</span></> : 'No credit account'}
                      </div>
                    </div>
                  </button>
                );
              })}
              {visible.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-500">{q ? 'Nobody matches that.' : 'No customers in this view.'}</div>}
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
              <span>Showing {visible.length} of {rows.length}</span><span>Outstanding {money(outstanding)}</span>
            </div>
          </div>

          <div ref={detailRef} className="col-span-12 xl:col-span-7 print:col-span-12 scroll-mt-3">
            {open ? (
              <>
                <button type="button" className="xl:hidden ws-btn mb-2 print:hidden" onClick={() => { setOpen(null); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  ← Back to list
                </button>
              <CustomerFile key={open.id} customer={open} card={cardOf.get(open.id)} account={acctOf.get(open.id)} can={can}
                onClose={() => setOpen(null)} onErr={setErr} onDone={(m) => { setMsg(m); load(); loadSide(); }}
                onSettle={() => acctOf.get(open.id) && nav('/credit', { state: { accountId: acctOf.get(open.id).id } })} />
              </>
            ) : (
              <div className="bg-white rounded-md border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 print:hidden">
                <Icon name="patients" size={22} />
                <div className="mt-2 font-semibold text-slate-700">No customer under review</div>
                <div className="mt-1">Search by mobile or name to open an account.{can('patient.manage') && <> Or use <b>Register customer</b> to add one.</>}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'cards' && <CardRegister onErr={setErr} />}
      {tab === 'tiers' && (
        <div className="grid grid-cols-12 gap-3 items-start">
          <div className="col-span-12 xl:col-span-8"><Tiers can={can} onErr={setErr} onDone={(m) => setMsg(m)} /></div>
          <div className="col-span-12 xl:col-span-4"><Funds can={can} onErr={setErr} onDone={(m) => setMsg(m)} /></div>
        </div>
      )}

      {showNew && <NewCustomer onClose={() => setShowNew(false)} onDone={done} onErr={setErr} onOpen={setOpen} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The customer's file
// ---------------------------------------------------------------------------
function CustomerFile({ customer, card, account, can, onClose, onErr, onDone, onSettle }) {
  const [cards, setCards] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [funds, setFunds] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [printing, setPrinting] = useState(null);
  const [f, setF] = useState({ tier_id: '', fund_id: '', valid_till: '', approved_by: '' });
  const [hist, setHist] = useState(null);
  const [staff, setStaff] = useState(null);
  const [tab, setTab] = useState('ledger');
  const isStaff = customer.category === 'Staff' || customer.customer_type === 'staff';

  const load = useCallback(() => api.get(`/cards/customer/${customer.id}`).then(setCards).catch(() => {}), [customer.id]);
  useEffect(() => {
    load();
    api.get('/cards/tiers').then(setTiers).catch(() => {});
    api.get('/cards/funds').then(setFunds).catch(() => {});
    api.get(`/patients/${customer.id}/purchases`).then(setHist).catch(() => setHist({ bills: [], returns: [], totals: {} }));
    // Only an employee has an allowance; asking for anyone else's would 404.
    if (isStaff) api.get(`/reports/staff-statement/${customer.id}`).then(setStaff).catch(() => setStaff(null)); else setStaff(null);
  }, [customer.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function issue() {
    try {
      await api.post('/cards', { customer_id: customer.id, ...f });
      setIssuing(false); setF({ tier_id: '', fund_id: '', valid_till: '', approved_by: '' });
      load(); onDone('Card issued.');
    } catch (e) { onErr(e.message); }
  }
  async function setStatus(c, status) {
    try { await api.put(`/cards/${c.id}`, { status }); load(); onDone(`Card ${status}.`); } catch (e) { onErr(e.message); }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'F4' && card) { e.preventDefault(); setPrinting(cards.find((c) => c.id === card.id) || card); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, cards]);

  const initials = (customer.full_name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  const bills = hist?.bills || [];

  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs print:hidden">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-10 w-10 rounded text-white font-bold text-sm flex items-center justify-center shrink-0 ${isStaff ? 'bg-emerald-700' : card ? 'bg-sky-700' : 'bg-slate-700'}`}>{initials}</div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">{customer.full_name}
              {card ? <Tag tone="blue">{card.tier_name} · {Math.round(card.discount_pct * 100)}%</Tag> : <Tag tone="gray">no active card</Tag>}
              {isStaff && <Tag tone="green">staff{customer.designation ? ` · ${customer.designation}` : ''}</Tag>}
            </div>
            <div className="text-[11px] text-slate-500 font-mono">ID {customer.patient_code}{customer.cnic ? ` · CNIC ${customer.cnic}` : ''} · {customer.contact || 'no mobile'}{customer.address ? ` · ${customer.address}` : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {card && <button type="button" className={BTN} onClick={() => setPrinting(cards.find((c) => c.id === card.id) || card)}><Icon name="idcard" size={13} /> Print card <Kbd>F4</Kbd></button>}
          {account && (account.balance > 0 || can('cash.manage')) && <button type="button" className={BTN_DARK} onClick={onSettle}>Pay / settle <Kbd className="!bg-slate-700 !border-slate-600 !text-white">Alt+P</Kbd></button>}
          <button type="button" className={`${BTN} !bg-white`} onClick={onClose} aria-label="Close" title="Close">✕ <Kbd>Esc</Kbd></button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 border-b border-slate-200">
        <div className="border border-slate-200 rounded px-2.5 py-1.5"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Approved credit limit</div><div className="font-mono font-bold text-sm">{account ? (account.credit_limit == null ? <span className="text-slate-400 font-normal">no limit</span> : money(account.credit_limit)) : <span className="text-slate-400 font-normal">no account</span>}</div></div>
        <div className={`rounded px-2.5 py-1.5 border ${account?.balance > 0 ? 'bg-rose-50 border-rose-200' : 'border-slate-200'}`}><div className={`text-[9px] font-bold uppercase tracking-wide ${account?.balance > 0 ? 'text-rose-800' : 'text-slate-500'}`}>Balance owed</div><div className={`font-mono font-bold text-sm ${account?.balance > 0 ? 'text-rose-900' : 'text-slate-900'}`}>{money(account?.balance || 0)}</div></div>
        <div className="col-span-2 sm:col-span-1 border border-slate-200 rounded px-2.5 py-1.5"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Lifetime at this counter</div><div className="font-mono font-bold text-sm">{hist ? money(hist.totals.gross || 0) : '…'}</div><div className="text-[10px] text-slate-500">{hist ? `${hist.totals.bills || 0} bills · helped with ${money(hist.totals.helped || 0)}` : ''}</div></div>
      </div>

      <div className="px-3 pt-2 flex items-center gap-1 flex-wrap border-b border-slate-200">
        {[['ledger', `Ledger & dispense history (${bills.length})`], ['welfare', `Welfare cards & entitlement (${cards.length})`], ['credit', 'Credit & staff allowance']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-2.5 py-1.5 min-h-[44px] lg:min-h-0 touch:min-h-[44px] text-[11px] font-semibold border-b-2 -mb-px ${tab === k ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>

      <div className="p-3">
        {tab === 'ledger' && (
          <>
            {!hist && <div className="text-xs text-slate-500">Loading…</div>}
            {hist && bills.length === 0 && <div className="text-xs text-slate-500">Nothing bought here yet.</div>}
            {bills.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
                    <tr><th className="text-left py-2 pl-2 pr-1.5">Date</th><th className="text-left py-2 px-1.5">Bill</th><th className="text-left py-2 px-1.5">Dispensed items</th><th className="text-right py-2 px-1.5">Total</th><th className="text-right py-2 px-1.5">Relief</th><th className="text-right py-2 px-1.5">Net</th><th className="text-left py-2 pl-1.5 pr-2">Paid by</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bills.slice(0, 15).map((b) => (
                      <tr key={b.id}>
                        <td className="py-1.5 pl-2 pr-1.5 font-mono whitespace-nowrap">{(b.created_at || '').slice(0, 10)}</td>
                        <td className="py-1.5 px-1.5 font-mono font-semibold">{b.bill_no}{b.card_no && <div className="text-[10px] text-slate-500 font-normal">card {b.card_no}</div>}</td>
                        <td className="py-1.5 px-1.5 text-slate-700">{b.items.map((i) => i.description).join(', ') || '—'}</td>
                        <td className="py-1.5 px-1.5 text-right font-mono">{money(b.gross_amount)}</td>
                        <td className="py-1.5 px-1.5 text-right font-mono text-emerald-700">{b.discount + b.subsidy > 0 ? money(b.discount + b.subsidy) : ''}</td>
                        <td className="py-1.5 px-1.5 text-right font-mono font-bold">{money(b.net_amount)}</td>
                        <td className="py-1.5 pl-1.5 pr-2"><Tag tone={b.payment_method === 'credit' ? 'amber' : 'gray'}>{b.payment_method}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hist.returns.length > 0 && (
                  <div className="text-[11px] text-slate-500 mt-2">{hist.returns.length} return{hist.returns.length === 1 ? '' : 's'} — {hist.returns.map((r) => `${r.return_no} (${money(r.refund_amount)})`).join(', ')}</div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'welfare' && (
          <div className="space-y-2">
            {cards.length === 0 && !issuing && <div className="text-xs text-slate-500">No card has been issued to this customer.</div>}
            {cards.map((c) => {
              const state = c.is_expired ? 'expired' : c.status;
              return (
                <div key={c.id} className={`rounded border px-3 py-2 ${state === 'active' ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2"><b className="font-mono text-xs">{c.card_no}</b><span className="text-xs text-slate-700">{c.tier_name} · {Math.round(c.discount_pct * 100)}%</span><Tag tone={c.is_expired ? 'red' : c.status === 'active' ? 'blue' : 'gray'}>{state}</Tag></div>
                    <div className="flex items-center gap-1">
                      <button type="button" className={`${BTN} !h-6`} onClick={() => setPrinting(c)}>Print card</button>
                      {can('patient.manage') && c.status === 'active' && <button type="button" className={`${BTN} !h-6`} onClick={() => setStatus(c, 'suspended')}>Suspend</button>}
                      {can('patient.manage') && c.status === 'suspended' && <button type="button" className={`${BTN} !h-6`} onClick={() => setStatus(c, 'active')}>Reinstate</button>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-600">
                    <div>Issued <b className="font-mono">{c.issued_on}</b></div>
                    <div>Valid to <b className="font-mono">{c.valid_till || 'no expiry'}</b></div>
                    <div>Approved by <b>{c.approved_by || '—'}</b></div>
                    <div>Fund <b className="font-mono">{c.fund_code || 'not attributed'}</b></div>
                    {c.ceiling_left != null && <div className="col-span-2 md:col-span-4">This month: <b className="font-mono">{money(c.ceiling_used)}</b> used · <b className="font-mono">{money(c.ceiling_left)}</b> left of the ceiling</div>}
                  </div>
                </div>
              );
            })}
            {issuing ? (
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-2">Issue a new card</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Field label="Tier *">
                    <Select value={f.tier_id} onChange={(e) => setF({ ...f, tier_id: e.target.value })}>
                      <option value="">Choose…</option>
                      {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} · {Math.round(t.discount_pct * 100)}%</option>)}
                    </Select>
                  </Field>
                  <Field label="Paid for by">
                    <Select value={f.fund_id} onChange={(e) => setF({ ...f, fund_id: e.target.value })}>
                      <option value="">Not attributed</option>
                      {funds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Valid until"><input type="date" className={`${CTL} font-mono`} value={f.valid_till} onChange={(e) => setF({ ...f, valid_till: e.target.value })} /></Field>
                  <Field label="Approved by"><input className={CTL} value={f.approved_by} onChange={(e) => setF({ ...f, approved_by: e.target.value })} placeholder="who authorised it" /></Field>
                </div>
                <div className="text-[10px] text-slate-500 mt-1.5">Every rupee waived is recorded against the fund chosen here, so the trust can answer what was given away and out of whose money.</div>
                <div className="flex gap-1.5 mt-2">
                  <button type="button" className={BTN_DARK} onClick={issue} disabled={!f.tier_id}>Issue card</button>
                  <button type="button" className={BTN} onClick={() => setIssuing(false)}>Cancel</button>
                </div>
              </div>
            ) : can('patient.manage') && <button type="button" className={BTN} onClick={() => setIssuing(true)}><Icon name="plus" size={12} /> Issue a card</button>}
          </div>
        )}

        {tab === 'credit' && (
          <div className="space-y-3">
            {account ? (
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                <b>{account.ledger_kind === 'staff' ? 'Staff' : 'Credit'} account</b> — owes <span className="font-mono font-semibold">{money(account.balance)}</span>{account.credit_limit != null ? <> of a <span className="font-mono">{money(account.credit_limit)}</span> limit</> : ' · no limit set'}.
                The limit is changed on the settlement screen (Pay / settle).
              </div>
            ) : <div className="text-xs text-slate-500">No credit account. One opens itself the first time this customer buys on credit at the counter.</div>}
            {staff && (
              <div className="border border-emerald-200 bg-emerald-50/40 rounded p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-900 mb-1.5">Staff allowance {staff.year}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[['Entitlement', staff.entitlement], ['Used', staff.subsidy_consumed], ['Remaining', staff.remaining], ['To recover', staff.recoverable]].map(([l, v]) => (
                    <div key={l} className="border border-emerald-200 bg-white rounded px-2 py-1.5"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{l}</div><div className={`font-mono font-bold ${l === 'To recover' && v > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(v)}</div></div>
                  ))}
                </div>
                {staff.exceeded_by > 0 && <div className="text-[11px] text-rose-800 mt-1.5">Over the annual cap by {money(staff.exceeded_by)} — the excess is payable and already shows on the bills as unpaid.</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {printing && <PrintableCard card={printing} customer={customer} onClose={() => setPrinting(null)} />}
    </div>
  );
}

// The card the customer carries. The QR is what the counter scans, so it holds
// the opaque token rather than the card number — a number on a printed card can
// be copied by anyone who sees it.
function PrintableCard({ card, customer, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !max-w-md !rounded-md !p-4 text-slate-800" onClick={(e) => e.stopPropagation()}>
        <div id="welfare-card" className="border-2 border-clinical-primary rounded-md p-4">
          <div className="text-center mb-2"><b className="text-base">Hope Welfare Trust</b><div className="text-[11px] text-slate-500">Patient welfare card</div></div>
          <div className="flex justify-between gap-4">
            <div className="text-xs space-y-1.5">
              <div><div className="text-[10px] text-slate-500 uppercase">Name</div><b>{customer.full_name}</b></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Card no</div><b className="font-mono">{card.card_no}</b></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Support</div><b>{card.tier_name}</b></div>
              <div><div className="text-[10px] text-slate-500 uppercase">Valid until</div><b className="font-mono">{card.valid_till || 'no expiry'}</b></div>
            </div>
            {card.qr_token && <QRCode value={card.qr_token} size={110} />}
          </div>
          <div className="text-[10px] text-slate-500 text-center mt-3">Present this card at the pharmacy counter. Not transferable.</div>
        </div>
        <div className="flex gap-1.5 mt-3 no-print">
          <button type="button" className={BTN_DARK} onClick={() => printPaper('a4', { modal: true })}><Icon name="printer" size={13} /> Print</button>
          <button type="button" className={BTN} onClick={onClose}>Close <Kbd>Esc</Kbd></button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register a customer — the same record the counter creates on the fly.
// ---------------------------------------------------------------------------
function NewCustomer({ onClose, onDone, onErr, onOpen }) {
  const [f, setF] = useState({ full_name: '', contact: '', cnic: '', address: '', customer_type: 'registered', designation: '', staff_cap: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useCallback(async () => {
    if (!f.full_name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.post('/patients', { ...f, category: f.customer_type === 'staff' ? 'Staff' : undefined, staff_cap: f.customer_type === 'staff' ? f.staff_cap : undefined, designation: f.customer_type === 'staff' ? f.designation : undefined, force: true });
      const p = r.patient || r;
      onDone(`${f.full_name} registered as ${p.patient_code || 'a customer'}.`);
      if (p.id) onOpen(p);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [f, busy, onDone, onErr, onOpen]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'F9') { e.preventDefault(); e.stopPropagation(); save(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, save]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !max-w-2xl !rounded-md !p-0 text-slate-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Patients &amp; accounts</div><div className="text-sm font-bold text-slate-900">Register new customer / beneficiary</div></div>
        <div className="p-4 grid grid-cols-2 gap-2">
          <Field label="Full name *" className="col-span-2"><input className={CTL} value={f.full_name} onChange={set('full_name')} autoFocus placeholder="as on the CNIC" /></Field>
          <Field label="Mobile" hint="how the account is looked up — mobile first"><input className={`${CTL} font-mono`} value={f.contact} onChange={set('contact')} placeholder="03xx-xxxxxxx" /></Field>
          <Field label="CNIC"><input className={`${CTL} font-mono`} value={f.cnic} onChange={set('cnic')} placeholder="35202-1234567-1" /></Field>
          <Field label="Address" className="col-span-2"><input className={CTL} value={f.address} onChange={set('address')} /></Field>
          <Field label="Account type">
            <Select value={f.customer_type} onChange={set('customer_type')}>
              <option value="registered">Customer</option>
              <option value="staff">Staff — annual medicine allowance</option>
            </Select>
          </Field>
          {f.customer_type === 'staff' && (
            <>
              <Field label="Designation"><input className={CTL} value={f.designation} onChange={set('designation')} placeholder="e.g. Staff nurse" /></Field>
              <Field label="Annual allowance (Rs)" hint="blank = the trust default" className="col-span-2"><input type="number" min="0" className={`${CTL} font-mono text-right`} value={f.staff_cap} onChange={set('staff_cap')} placeholder="default" /></Field>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" className="flex-1 h-9 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-xs inline-flex items-center justify-between" onClick={save} disabled={!f.full_name.trim() || busy}>
            <span>{busy ? 'Saving…' : 'Register customer'}</span><kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-[10px] border border-emerald-600">F9</kbd>
          </button>
          <button type="button" className={`${BTN} h-9`} onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
        </div>
      </div>
    </div>
  );
}

// --- Card register -----------------------------------------------------------
function CardRegister({ onErr }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const id = setTimeout(() => { api.get(`/cards${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch((e) => onErr(e.message)); }, 200);
    return () => clearTimeout(id);
  }, [q, onErr]);
  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs">
      <div className="p-3 border-b border-slate-200"><input value={q} onChange={(e) => setQ(e.target.value)} className={CTL} placeholder="Card number, holder name or mobile" /></div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
            <tr><th className="text-left py-2 pl-3 pr-2">Card</th><th className="text-left py-2 px-2">Holder</th><th className="text-left py-2 px-2">Tier</th><th className="text-left py-2 px-2">Valid</th><th className="text-left py-2 px-2">Fund</th><th className="text-left py-2 pl-2 pr-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="py-1.5 pl-3 pr-2 font-mono font-semibold">{c.card_no}</td>
                <td className="py-1.5 px-2"><b>{c.full_name}</b><div className="text-[10px] text-slate-500 font-mono">{c.contact}</div></td>
                <td className="py-1.5 px-2">{c.tier_name} · {Math.round(c.discount_pct * 100)}%</td>
                <td className="py-1.5 px-2 font-mono">{c.valid_till || <span className="text-slate-400">no expiry</span>}</td>
                <td className="py-1.5 px-2 font-mono text-slate-600">{c.fund_code || '—'}</td>
                <td className="py-1.5 pl-2 pr-3"><Tag tone={c.is_expired ? 'red' : c.status === 'active' ? 'blue' : 'gray'}>{c.is_expired ? 'expired' : c.status}</Tag></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">No cards issued yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Funds -------------------------------------------------------------------
// Whose money paid for what was waived. Every discount and subsidy is booked
// against one of these, which is what lets the trust answer a donor asking what
// their money did.
function Funds({ can, onErr, onDone }) {
  const [funds, setFunds] = useState([]);
  const [f, setF] = useState({ code: '', name: '' });
  const load = useCallback(() => { api.get('/cards/funds').then(setFunds).catch((e) => onErr(e.message)); }, [onErr]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    try { await api.post('/cards/funds', { code: f.code, name: f.name }); setF({ code: '', name: '' }); load(); onDone('Fund added.'); }
    catch (e) { onErr(e.message); }
  }
  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md text-[11px] font-bold uppercase tracking-wide text-slate-700">Subsidy funds</div>
      <div className="p-3">
        <p className="text-[11px] text-slate-500 mt-0 mb-2">Every rupee the trust waives is booked against one of these. Without it the subsidy report can say how much was given away but not out of whose money.</p>
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200"><tr><th className="text-left py-1.5 px-2">Code</th><th className="text-left py-1.5 px-2">Fund</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {funds.map((x) => <tr key={x.id}><td className="py-1.5 px-2 font-mono">{x.code}</td><td className="py-1.5 px-2">{x.name}</td></tr>)}
            {funds.length === 0 && <tr><td colSpan={2} className="py-3 text-center text-slate-500">No funds available.</td></tr>}
          </tbody>
        </table>
        {can('user.manage') && (
          <div className="grid grid-cols-3 gap-2 mt-3 items-end">
            <Field label="Code"><input className={`${CTL} font-mono`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="ZAKAT" /></Field>
            <Field label="Fund name"><input className={CTL} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Zakat fund" /></Field>
            <button type="button" className={BTN_DARK} onClick={add} disabled={!f.code.trim() || !f.name.trim()}>Add fund</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tiers -------------------------------------------------------------------
function Tiers({ can, onErr, onDone }) {
  const [tiers, setTiers] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => { api.get('/cards/tiers').then(setTiers).catch((e) => onErr(e.message)); }, [onErr]);
  useEffect(() => { load(); }, [load]);
  async function save() {
    try {
      await api.put(`/cards/tiers/${edit.id}`, { name: edit.name, discount_pct: Number(edit.pctWhole) / 100, monthly_ceiling: edit.monthly_ceiling === '' ? null : Number(edit.monthly_ceiling) });
      setEdit(null); load(); onDone('Tier updated.');
    } catch (e) { onErr(e.message); }
  }
  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md text-[11px] font-bold uppercase tracking-wide text-slate-700">Welfare card tiers</div>
      <div className="p-3">
        <p className="text-[11px] text-slate-500 mt-0 mb-2">Tiers are data, not settings buried in the code — the board adding a fourth is a change here, not a release. Each tier also says <b>what it covers</b>: a 100% card should not make a bottle of shampoo free.</p>
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
            <tr><th className="text-left py-1.5 px-2">Tier</th><th className="text-right py-1.5 px-2">Support</th><th className="text-left py-1.5 px-2">Monthly ceiling</th><th className="text-left py-1.5 px-2">Not covered</th><th className="text-right py-1.5 px-2">Active cards</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tiers.map((t) => (
              <tr key={t.id}>
                <td className="py-1.5 px-2"><b>{t.name}</b><div className="text-[10px] text-slate-500 font-mono">{t.code}</div></td>
                <td className="py-1.5 px-2 text-right font-mono font-bold">{Math.round(t.discount_pct * 100)}%</td>
                <td className="py-1.5 px-2 font-mono">{t.monthly_ceiling ? money(t.monthly_ceiling) : <span className="text-slate-400">none</span>}</td>
                <td className="py-1.5 px-2 text-slate-600">{t.scope.filter((r) => !r.covered).map((r) => r.product_type).filter(Boolean).join(', ') || 'everything covered'}</td>
                <td className="py-1.5 px-2 text-right font-mono">{t.cards}</td>
                <td className="py-1.5 px-2 text-right">{can('user.manage') && <button type="button" className={`${BTN} !h-6`} onClick={() => setEdit({ ...t, pctWhole: Math.round(t.discount_pct * 100), monthly_ceiling: t.monthly_ceiling ?? '' })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && (
          <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Name"><input className={CTL} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Support %"><input type="number" min="0" max="100" className={`${CTL} font-mono text-right`} value={edit.pctWhole} onChange={(e) => setEdit({ ...edit, pctWhole: e.target.value })} /></Field>
              <Field label="Monthly ceiling (Rs, blank = none)"><input type="number" min="0" className={`${CTL} font-mono text-right`} value={edit.monthly_ceiling} onChange={(e) => setEdit({ ...edit, monthly_ceiling: e.target.value })} /></Field>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <button type="button" className={BTN_DARK} onClick={save}>Save</button>
              <button type="button" className={BTN} onClick={() => setEdit(null)}>Cancel</button>
              <span className="text-[11px] text-slate-500 ml-2">A ceiling caps the help, it does not remove it: past the limit the customer pays the excess rather than losing the entitlement.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
