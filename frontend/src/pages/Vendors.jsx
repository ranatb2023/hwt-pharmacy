import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Select from '../components/Select.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, BTN_GO, CTL, NUM, LABEL } from '../components/ws/index.jsx';
import { printPaper } from '../print.js';

// Suppliers: who we buy from, what we owe them, and what we have asked for.
//
// PHASE 09 — screens 09 / 10 / 11 (hwt-client/design/stitch). The directory
// on the left and the vendor's file on the right (09); the vendor's ledger
// statement with the payment voucher beside it (10), reached from the file and
// left with Esc; the new-vendor form (11). Every figure is from `/vendors`,
// `/vendors/:id`, `/vendors/bookings` and the Phase 04 vendor ledger.
//
// What the mockups show and the vendor record does not hold — NTN, STRN, drug
// sale licence, bank account, credit terms, "credit rating" — is NOT built.
// Those are columns the client has to ask for (PHASE-09 screen map, 09 / 11).
// The form says so rather than silently dropping what is typed.

const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const code = (v) => `VEND-${String(v.id).padStart(5, '0')}`;
const n2 = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


export default function Vendors() {
  const { can } = useAuth();
  const location = useLocation();
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('file');        // 'file' | 'statement'
  const [q, setQ] = useState('');
  const [pill, setPill] = useState('all');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [modal, setModal] = useState(null);         // 'purchase' | 'payment' | 'reclaim' | 'order' | 'slip'
  const [preset, setPreset] = useState(null);       // reclaim preset handed over from Inventory

  const load = useCallback(() => {
    api.get('/vendors').then(setVendors).catch((e) => setErr(e.message));
    api.get('/inventory/products').then(setProducts).catch(() => {});
    api.get('/vendors/bookings').then(setBookings).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const openVendor = useCallback((v) => {
    api.get(`/vendors/${v.id}`).then(setSelected).catch((e) => setErr(e.message));
  }, []);
  const refreshSelected = useCallback(() => { if (selected) openVendor(selected); load(); }, [selected, openVendor, load]);

  // Arriving from a batch's claim window on the Inventory page: open the reclaim
  // on that vendor with the batch already chosen.
  useEffect(() => {
    const r = location.state?.reclaim;
    if (!r) return;
    setPreset(r);
    if (r.vendor_id) {
      api.get(`/vendors/${r.vendor_id}`).then((v) => { setSelected(v); setModal('reclaim'); }).catch((e) => setErr(e.message));
    } else setMsg('Pick the supplier this batch came from, then record the reclaim.');
    window.history.replaceState({}, '');
  }, [location.state]);

  const pending = bookings.filter((b) => b.status === 'booked' || b.status === 'partial');
  const week = ymd(new Date(Date.now() + 7 * 86400000));
  const today = ymd(new Date());
  const kpi = {
    payable: vendors.reduce((t, v) => t + Math.max(0, Number(v.balance || 0)), 0),
    owed: vendors.filter((v) => v.balance > 0).length,
    advance: vendors.reduce((t, v) => t + Math.max(0, -Number(v.balance || 0)), 0),
    pipeline: pending.length,
    dueWeek: pending.filter((b) => b.expected_on && b.expected_on <= week).length,
    overdue: pending.filter((b) => b.expected_on && b.expected_on < today).length,
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return vendors
      .filter((v) => !term || [v.name, v.contact, v.address].some((s) => (s || '').toLowerCase().includes(term)))
      .filter((v) => pill === 'all' ? true : pill === 'due' ? v.balance > 0 : pill === 'orders' ? pending.some((b) => b.vendor_id === v.id) : true);
  }, [vendors, q, pill, pending]);

  // Alt+N new vendor, F4 record an order, Alt+P pay the selected vendor, Esc
  // back from the statement. Never while typing.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || modal || showNew) return;
      if (e.altKey && (e.key === 'n' || e.key === 'N') && can('vendor.manage')) { e.preventDefault(); setShowNew(true); }
      else if (e.altKey && (e.key === 'p' || e.key === 'P') && selected && can('vendor.manage')) { e.preventDefault(); setModal('payment'); }
      else if (e.key === 'F4' && can('vendor.manage')) { e.preventDefault(); setModal('order'); }
      else if (e.key === 'Escape' && view === 'statement') { e.preventDefault(); setView('file'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, showNew, selected, view, can]);

  const done = (m) => { setMsg(m); setModal(null); setShowNew(false); setPreset(null); refreshSelected(); };

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="ws-crumb text-[10px] font-bold uppercase tracking-wider text-slate-500">Purchase &amp; supply · vendor accounts &amp; order booking</div>
          <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Suppliers, Purchase Ledger &amp; Distributor Orders</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={load}><Icon name="returns" size={13} /> Refresh</button>
          <button type="button" className={BTN} onClick={() => setModal('slip')}><Icon name="file" size={13} /> Demand slip</button>
          {can('vendor.manage') && (
            <>
              <button type="button" className={BTN} onClick={() => setModal('order')}>Record order <Kbd>F4</Kbd></button>
              <button type="button" className={BTN_DARK} onClick={() => setShowNew(true)}><Icon name="plus" size={13} /> New vendor account <Kbd className="!bg-slate-700 !border-slate-600 !text-white">Alt+N</Kbd></button>
            </>
          )}
        </div>
      </div>

      {/* KPI strip — every figure from the directory and the bookings. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Tile label="Total payables to vendors" value={money(kpi.payable)} tone={kpi.payable > 0 ? 'warn' : 'ok'} icon="vendors"
          sub={`${kpi.owed} account${kpi.owed === 1 ? '' : 's'} with a balance due`} />
        <Tile label="Orders booked (in pipeline)" value={kpi.pipeline} unit={(kpi.pipeline) === 1 ? 'order' : 'orders'} icon="box" tone={kpi.overdue ? 'danger' : ''}
          sub={kpi.pipeline ? [...new Set(pending.map((b) => b.vendor_name))].slice(0, 3).join(', ') : 'nothing awaiting delivery'}
          right={kpi.overdue ? <Tag tone="red">{kpi.overdue} overdue</Tag> : kpi.dueWeek ? <Tag tone="amber">{kpi.dueWeek} due this week</Tag> : null} />
        <Tile label="Advances held by vendors" value={money(kpi.advance)} icon="trend" tone={kpi.advance > 0 ? 'ok' : ''}
          sub={kpi.advance > 0 ? 'paid ahead of goods — offsets the next GRN' : 'no vendor holds an advance'} />
        <Tile label="Directory" value={vendors.length} unit={(vendors.length) === 1 ? 'vendor' : 'vendors'} icon="shield"
          sub="tax, licence and bank details not held — pending the client's answer" />
      </div>

      {view === 'statement' && selected ? (
        <Statement vendor={selected} can={can} onBack={() => setView('file')} onErr={setErr} onDone={done} onPay={() => setModal('payment')} />
      ) : (
        <div className="grid grid-cols-12 gap-3 items-start">
          {/* ================= LEFT: directory ============================ */}
          <div className="col-span-12 xl:col-span-5 bg-white rounded-md border border-slate-300 shadow-xs">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Vendors &amp; distributors</span>
              {can('vendor.manage') && <button type="button" className={`${BTN} !h-7`} onClick={() => setShowNew(true)}><Icon name="plus" size={12} /> New</button>}
            </div>
            <div className="p-3 border-b border-slate-200 space-y-2">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400"><Icon name="search" size={14} /></div>
                <input value={q} onChange={(e) => setQ(e.target.value)} className={`${CTL} pl-8`} placeholder="Search vendor name, contact or address…" />
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {[['all', `All vendors (${vendors.length})`], ['due', `Balance due (${vendors.filter((v) => v.balance > 0).length})`], ['orders', `Active orders (${new Set(pending.map((b) => b.vendor_id)).size})`]].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setPill(k)}
                    className={`h-7 px-2.5 text-[11px] font-semibold rounded border ${pill === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              {rows.map((v) => {
                const on = selected?.id === v.id;
                const orders = pending.filter((b) => b.vendor_id === v.id).length;
                return (
                  <button type="button" key={v.id} onClick={() => { openVendor(v); setView('file'); }}
                    className={`w-full text-left px-3 py-2.5 flex items-start justify-between gap-3 ${on ? 'bg-sky-50 shadow-[inset_3px_0_0_#0369a1]' : 'hover:bg-slate-50'}`}>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5">{v.name}{on && <Tag tone="blue">selected</Tag>}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{code(v)}{v.contact ? ` • ${v.contact}` : ''}</div>
                      <div className="text-[10px] text-slate-500 truncate">{v.address || '—'}{orders ? ` • ${orders} order${orders === 1 ? '' : 's'} booked` : ''}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-mono font-bold text-xs ${v.balance > 0 ? 'text-amber-700' : v.balance < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{money(Math.abs(v.balance))}</div>
                      <div className="text-[9px] uppercase font-bold text-slate-500">{v.balance > 0 ? 'payable' : v.balance < 0 ? 'advance' : 'clear'}</div>
                    </div>
                  </button>
                );
              })}
              {rows.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-500"><span className="ws-empty">No vendor matches.</span></div>}
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
              <span>Showing {rows.length} of {vendors.length}</span>
              <span>Directory balance: {money(kpi.payable - kpi.advance)}</span>
            </div>
          </div>

          {/* ================= RIGHT: the vendor's file ==================== */}
          <div className="col-span-12 xl:col-span-7">
            {!selected ? (
              <div className="bg-white rounded-md border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                <Icon name="vendors" size={22} />
                <div className="mt-2 font-semibold text-slate-700">No vendor selected</div>
                <div className="mt-1">Pick one from the directory to see orders, GRNs, payments and reclaims.</div>
              </div>
            ) : (
              <VendorFile vendor={selected} bookings={bookings.filter((b) => b.vendor_id === selected.id)} can={can}
                onStatement={() => setView('statement')} onAction={setModal} onBookingStatus={async (b, status) => {
                  try { await api.put(`/vendors/bookings/${b.id}`, { status }); load(); } catch (e) { setErr(e.message); }
                }} />
            )}
          </div>
        </div>
      )}

      {showNew && <NewVendor onClose={() => setShowNew(false)} onDone={done} onErr={setErr} />}
      {modal === 'order' && <OrderModal vendors={vendors} vendor={selected} onClose={() => setModal(null)} onDone={done} onErr={setErr} />}
      {modal === 'slip' && <DemandSlip onClose={() => setModal(null)} onErr={setErr} />}
      {modal === 'purchase' && selected && <PurchaseModal vendor={selected} products={products} bookings={bookings.filter((b) => b.vendor_id === selected.id && (b.status === 'booked' || b.status === 'partial'))} onClose={() => setModal(null)} onDone={done} onErr={setErr} />}
      {modal === 'payment' && selected && <PaymentModal vendor={selected} onClose={() => setModal(null)} onDone={done} onErr={setErr} />}
      {modal === 'reclaim' && selected && <ReclaimModal vendor={selected} products={products} preset={preset} onClose={() => { setModal(null); setPreset(null); }} onDone={done} onErr={setErr} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
function Tag({ tone, children }) {
  const t = {
    red: 'text-rose-900 bg-rose-100 border-rose-300', amber: 'text-amber-900 bg-amber-100 border-amber-300',
    blue: 'text-sky-900 bg-sky-100 border-sky-300', gray: 'text-slate-700 bg-slate-100 border-slate-300',
    green: 'text-emerald-900 bg-emerald-100 border-emerald-300',
  }[tone] || 'text-slate-700 bg-slate-100 border-slate-300';
  return <span className={`text-[9px] font-semibold px-1 py-px rounded border whitespace-nowrap uppercase ${t}`}>{children}</span>;
}
function Tile({ label, value, unit, sub, tone = '', icon, right }) {
  const t = { danger: 'text-rose-700', warn: 'text-amber-700', ok: 'text-emerald-700' }[tone] || 'text-slate-900';
  return (
    <div className="ws-tile bg-white border flex items-start justify-between gap-2" data-tone={tone}>
      <div className="min-w-0">
        <div className="ws-tile-label text-[10px] font-bold uppercase tracking-wide text-slate-500 line-clamp-2 min-h-[2.4em] leading-[1.2]">{label}</div>
        <div className={`ws-tile-value ws-tile-mono font-bold leading-tight mt-0.5 ${t}`}>{value} {unit && <span className="text-[11px] font-sans font-semibold text-slate-500">{unit}</span>}</div>
        <div className="ws-tile-sub text-[10px] text-slate-500 line-clamp-2">{sub}</div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0"><span className="text-slate-400"><Icon name={icon} size={16} /></span>{right}</div>
    </div>
  );
}
function Field({ label, hint, children, className = '' }) {
  return <div className={className}><label className={LABEL}>{label}</label>{children}{hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}</div>;
}
function SectionHead({ n, title, sub, right }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1.5 mb-2.5">
      <div className="flex items-center gap-2">
        <span className="h-5 w-5 rounded bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center">{n}</span>
        <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">{title}</span>
        {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
      </div>
      {right}
    </div>
  );
}
function Modal({ title, sub, right, children, onClose, wide, onSubmit }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'F9' && onSubmit) { e.preventDefault(); e.stopPropagation(); onSubmit(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onSubmit]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? '!max-w-5xl' : '!max-w-2xl'} !rounded-md !p-0 text-slate-800 overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div>
            {sub && <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{sub}</div>}
            <div className="text-sm font-bold text-slate-900">{title}</div>
          </div>
          {right}
        </div>
        {children}
      </div>
    </div>
  );
}
function Actions({ onClose, onSave, label, disabled, busy }) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3 border-t border-slate-200 bg-slate-50">
      <button type="button" className={`${BTN_GO} flex-1`} onClick={onSave} disabled={disabled || busy}>
        <span>{busy ? 'Working…' : label}</span>
        <kbd className="bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-[10px] border border-emerald-600">F9</kbd>
      </button>
      <button type="button" className={`${BTN} h-9`} onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 09 — the vendor's file
// ---------------------------------------------------------------------------
function VendorFile({ vendor: v, bookings, can, onStatement, onAction, onBookingStatus }) {
  const [tab, setTab] = useState('orders');
  const open = bookings.filter((b) => b.status === 'booked' || b.status === 'partial');
  const tabs = [
    ['orders', 'Booked orders & demand slips', open.length],
    ['grns', 'Purchase invoices & GRNs', v.purchases.length],
    ['payments', 'Payment vouchers', v.payments.length],
    ['reclaims', 'Reclaims & credits', v.reclaims.length],
  ];
  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0">
            {v.name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('')}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">{v.name} <span className="text-[10px] font-mono font-normal text-slate-500">{code(v)}</span>
              <Tag tone={v.balance > 0 ? 'amber' : v.balance < 0 ? 'green' : 'gray'}>{v.balance > 0 ? `payable ${money(v.balance)}` : v.balance < 0 ? `advance ${money(-v.balance)}` : 'clear'}</Tag>
            </div>
            <div className="text-[11px] text-slate-500 truncate">{[v.contact, v.address].filter(Boolean).join(' • ') || 'no contact on file'}{v.notes ? ` • ${v.notes}` : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={onStatement}><Icon name="file" size={13} /> Statement</button>
          {can('vendor.manage') && (
            <>
              <button type="button" className={BTN} onClick={() => onAction('payment')}>Pay <Kbd>Alt+P</Kbd></button>
              <button type="button" className={BTN} onClick={() => onAction('reclaim')}>Reclaim</button>
              <button type="button" className={BTN_DARK} onClick={() => onAction('purchase')}><Icon name="box" size={13} /> Goods received (GRN)</button>
            </>
          )}
        </div>
      </div>

      <div className="px-3 pt-2 flex items-center gap-1 flex-wrap border-b border-slate-200">
        {tabs.map(([k, l, n]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px ${tab === k ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {l} <span className="font-mono text-[10px] text-slate-400">{n}</span>
          </button>
        ))}
      </div>

      <div className="p-3">
        {tab === 'orders' && (
          <>
            <div className="text-[11px] text-slate-500 mb-2">
              The system issues no purchase orders. The order taker writes the order in his own book and that book stays authoritative;
              these rows are the memo the counter reads to answer &ldquo;did we order it?&rdquo;.
            </div>
            <Tbl head={['Booked', 'Order taker', 'What was ordered', 'Expected', 'Status', '']} right={[5]}>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="py-1.5 font-mono">{b.booked_on}</td>
                  <td className="py-1.5">{b.taker_name || '—'}{b.taker_contact ? <div className="text-[10px] text-slate-500 font-mono">{b.taker_contact}</div> : null}</td>
                  <td className="py-1.5 text-slate-600">{b.notes || '—'}</td>
                  <td className={`py-1.5 font-mono ${b.expected_on && b.expected_on < ymd(new Date()) && (b.status === 'booked' || b.status === 'partial') ? 'text-rose-700 font-bold' : ''}`}>{b.expected_on || '—'}</td>
                  <td className="py-1.5"><Tag tone={b.status === 'delivered' ? 'green' : b.status === 'cancelled' ? 'gray' : b.status === 'partial' ? 'amber' : 'blue'}>{b.status}</Tag>{b.deliveries ? <span className="text-[10px] text-slate-500 ml-1">{b.deliveries} GRN</span> : null}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {can('vendor.manage') && (b.status === 'booked' || b.status === 'partial') && (
                      <>
                        <button type="button" className="text-[10px] font-semibold text-emerald-800 hover:underline mr-2" onClick={() => onBookingStatus(b, 'delivered')}>Delivered</button>
                        <button type="button" className="text-[10px] font-semibold text-rose-700 hover:underline" onClick={() => onBookingStatus(b, 'cancelled')}>Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">No orders recorded with this vendor.</td></tr>}
            </Tbl>
          </>
        )}
        {tab === 'grns' && (
          <Tbl head={['GRN', 'Date', 'Invoice / challan', 'Total', 'Paid on receipt', 'Balance']} right={[3, 4, 5]}>
            {v.purchases.map((p) => (
              <tr key={p.id}>
                <td className="py-1.5 font-mono font-semibold">{p.grn_no}</td>
                <td className="py-1.5 font-mono">{String(p.created_at || '').slice(0, 10)}</td>
                <td className="py-1.5 font-mono">{p.invoice_no || '—'}{p.notes ? <div className="text-[10px] text-slate-500 font-sans">{p.notes}</div> : null}</td>
                <td className="py-1.5 text-right font-mono">{money(p.total_amount)}</td>
                <td className="py-1.5 text-right font-mono">{money(p.paid_amount)}</td>
                <td className="py-1.5 text-right font-mono font-bold">{money(p.total_amount - p.paid_amount)}</td>
              </tr>
            ))}
            {v.purchases.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">No goods received from this vendor yet.</td></tr>}
          </Tbl>
        )}
        {tab === 'payments' && (
          <Tbl head={['Date', 'Mode', 'Reference', 'Amount']} right={[3]}>
            {v.payments.map((p) => (
              <tr key={p.id}>
                <td className="py-1.5 font-mono">{String(p.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                <td className="py-1.5 capitalize">{p.method}</td>
                <td className="py-1.5 font-mono">{p.reference || '—'}</td>
                <td className="py-1.5 text-right font-mono font-bold text-emerald-700">{money(p.amount)}</td>
              </tr>
            ))}
            {v.payments.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-500">No payment recorded.</td></tr>}
          </Tbl>
        )}
        {tab === 'reclaims' && (
          <Tbl head={['Date', 'Product', 'Qty', 'Value', 'Settlement', 'Reason']} right={[2, 3]}>
            {v.reclaims.map((r) => (
              <tr key={r.id}>
                <td className="py-1.5 font-mono">{String(r.created_at || '').slice(0, 10)}</td>
                <td className="py-1.5 font-semibold">{r.product_name}</td>
                <td className="py-1.5 text-right font-mono">{r.quantity}</td>
                <td className="py-1.5 text-right font-mono">{money(r.value)}</td>
                <td className="py-1.5"><Tag tone={r.settlement === 'cash' ? 'green' : 'blue'}>{r.settlement === 'cash' ? 'cash refund' : 'credit note'}</Tag></td>
                <td className="py-1.5 text-slate-600">{r.reason || '—'}</td>
              </tr>
            ))}
            {v.reclaims.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">Nothing returned to this vendor.</td></tr>}
          </Tbl>
        )}
      </div>
    </div>
  );
}

function Tbl({ head, right = [], children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-300 bg-slate-50">
          {head.map((h, i) => <th key={i} className={`py-1.5 font-semibold ${right.includes(i) ? 'text-right' : 'text-left'} ${i === 0 ? 'pl-2 pr-1.5' : 'px-1.5'}`}>{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100 [&>tr>td:first-child]:pl-2 [&>tr>td]:px-1.5">{children}</tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 10 — the vendor's statement, with the payment voucher beside it
// ---------------------------------------------------------------------------
function Statement({ vendor: v, can, onBack, onErr, onDone, onPay }) {
  const [account, setAccount] = useState(undefined);   // undefined = loading, null = none yet
  const [st, setSt] = useState(null);
  const [filter, setFilter] = useState('all');
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/ledger/accounts?kind=vendor').then((as) => {
      const a = as.find((x) => x.vendor_id === v.id) || null;
      setAccount(a);
      if (a) api.get(`/ledger/accounts/${a.id}/statement`).then(setSt).catch((e) => onErr(e.message));
      else setSt(null);
    }).catch(() => setAccount(null));
  }, [v.id, onErr]);
  useEffect(load, [load]);

  const entries = (st?.entries || []).filter((e) => filter === 'all' ? true : filter === 'grn' ? e.debit > 0 : filter === 'pay' ? (e.credit > 0 && !/reclaim|credit note/i.test(e.narration || '')) : /reclaim|credit note/i.test(e.narration || ''));
  const ytdFrom = `${new Date().getFullYear()}-01-01`;
  const purchasesYtd = v.purchases.filter((p) => String(p.created_at) >= ytdFrom).reduce((t, p) => t + Number(p.total_amount || 0), 0);
  const reclaimsOpen = v.reclaims.reduce((t, r) => t + Number(r.value || 0), 0);
  const balance = st ? st.closing : v.balance;

  const post = useCallback(async () => {
    const amount = Number(pay.amount);
    if (!(amount > 0) || busy) return;
    setBusy(true);
    try {
      await api.post(`/vendors/${v.id}/payment`, { amount, method: pay.method, reference: pay.reference || undefined });
      setPay({ amount: '', method: 'cash', reference: '' });
      onDone(`Paid ${money(amount)} to ${v.name} by ${pay.method}.`);
      load();
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [pay, busy, v, onDone, onErr, load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div className="flex items-center gap-3">
          <button type="button" className={BTN} onClick={onBack}><Kbd>Esc</Kbd> Back to directory</button>
          <div>
            <div className="ws-crumb text-[10px] font-bold uppercase tracking-wider text-slate-500">Purchase &amp; supply › vendors &amp; distributors › vendor statement</div>
            <div className="text-sm font-bold text-slate-900">{v.name} <span className="font-mono text-[10px] font-normal text-slate-500">{code(v)}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={13} /> Print statement</button>
          {can('vendor.manage') && <button type="button" className={BTN_DARK} onClick={onPay}>Record payment voucher <Kbd className="!bg-slate-700 !border-slate-600 !text-white">Alt+P</Kbd></button>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Tile label="Current ledger balance" value={money(Math.abs(balance))} tone={balance > 0 ? 'warn' : balance < 0 ? 'ok' : ''} icon="vendors"
          sub={balance > 0 ? 'payable to the vendor' : balance < 0 ? 'advance — in credit with the vendor' : 'nothing outstanding'} />
        <Tile label="Total purchases (this year)" value={money(purchasesYtd)} icon="box" sub={`${v.purchases.length} GRN${v.purchases.length === 1 ? '' : 's'} on file`} />
        <Tile label="Reclaims & expiry credits" value={money(reclaimsOpen)} icon="returns" sub={`${v.reclaims.length} reclaim${v.reclaims.length === 1 ? '' : 's'} recorded`} />
        <Tile label="Aging" value={st?.aging?.d90 > 0 ? money(st.aging.d90) : st?.aging?.total > 0 ? money(st.aging.current + st.aging.d30 + st.aging.d60) : money(0)} icon="clock"
          tone={st?.aging?.d90 > 0 ? 'danger' : ''} sub={st?.aging?.d90 > 0 ? 'over 90 days — settle first' : st?.aging?.oldest ? `oldest unpaid ${st.aging.oldest}` : 'terms and credit limit not held'} />
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-12 xl:col-span-8 bg-white rounded-md border border-slate-300 shadow-xs print:col-span-12 print:border-0 print:shadow-none">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Official supplier ledger &amp; invoice history</div>
              <div className="text-[10px] text-slate-500 hidden print:block">{v.name} · {code(v)} · printed {new Date().toLocaleString('en-GB')}</div>
            </div>
            <div className="flex items-center gap-1 print:hidden">
              {[['all', 'All entries'], ['grn', 'Invoices / GRNs'], ['pay', 'Payments'], ['cn', 'Returns & credit notes']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)}
                  className={`h-6 px-2 text-[10px] font-semibold rounded border ${filter === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
              ))}
            </div>
          </div>
          {account === null ? (
            <div className="p-4 text-xs text-slate-600">
              No ledger account yet — nothing has been bought from or paid to {v.name} since the vendor ledger began.
              {v.balance ? <> The directory carries a balance of <b className="font-mono">{money(v.balance)}</b> from before.</> : null}
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-300">
                <th className="text-left py-1.5 pl-3 pr-1.5 font-semibold">Date</th><th className="text-left py-1.5 px-1.5 font-semibold">Ref / document</th>
                <th className="text-left py-1.5 px-1.5 font-semibold">Particulars</th><th className="text-right py-1.5 px-1.5 font-semibold">Debit (Rs)</th>
                <th className="text-right py-1.5 px-1.5 font-semibold">Credit (Rs)</th><th className="text-right py-1.5 pl-1.5 pr-3 font-semibold">Balance (Rs)</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {st && st.opening !== 0 && (
                  <tr className="text-slate-500"><td className="py-1.5 pl-3">—</td><td /><td className="py-1.5 px-1.5 italic">Brought forward</td><td /><td /><td className="py-1.5 pr-3 text-right font-mono">{n2(st.opening)}</td></tr>
                )}
                {entries.map((e) => {
                  const kind = e.debit > 0 ? 'Dr' : 'Cr';
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="py-1.5 pl-3 pr-1.5 font-mono whitespace-nowrap">{e.entry_date}</td>
                      <td className="py-1.5 px-1.5 font-mono">{e.reference || e.bill_no || '—'}</td>
                      <td className="py-1.5 px-1.5">{e.narration || '—'}</td>
                      <td className="py-1.5 px-1.5 text-right font-mono">{e.debit > 0 ? n2(e.debit) : ''}</td>
                      <td className="py-1.5 px-1.5 text-right font-mono text-emerald-700">{e.credit > 0 ? n2(e.credit) : ''}</td>
                      <td className="py-1.5 pl-1.5 pr-3 text-right font-mono font-bold whitespace-nowrap">{n2(Math.abs(e.balance))} <span className="text-[9px] text-slate-500 font-normal">{e.balance < 0 ? 'Cr' : kind === 'Dr' || e.balance > 0 ? 'Dr' : ''}</span></td>
                    </tr>
                  );
                })}
                {st && entries.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-500">Nothing in this view.</td></tr>}
                {!st && account && <tr><td colSpan={6} className="py-4 text-center text-slate-500">Loading statement…</td></tr>}
              </tbody>
              {st && (
                <tfoot><tr className="bg-slate-50 border-t-2 border-slate-900 font-bold">
                  <td className="py-2 pl-3" colSpan={3}>Closing balance</td>
                  <td className="py-2 px-1.5 text-right font-mono">{n2(st.entries.reduce((t, e) => t + e.debit, 0))}</td>
                  <td className="py-2 px-1.5 text-right font-mono text-emerald-700">{n2(st.entries.reduce((t, e) => t + e.credit, 0))}</td>
                  <td className="py-2 pr-3 text-right font-mono">{n2(Math.abs(st.closing))} <span className="text-[9px] text-slate-500 font-normal">{st.closing < 0 ? 'Cr' : 'Dr'}</span></td>
                </tr></tfoot>
              )}
            </table>
          )}
          <div className="px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono flex items-center justify-between">
            <span>Debit raises what we owe; a payment or credit note reduces it.</span>
            <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
          </div>
        </div>

        {/* Payment voucher */}
        <div className="col-span-12 xl:col-span-4 print:hidden">
          <div className="bg-white rounded-md border border-slate-300 shadow-xs">
            <div className="px-3 py-2 border-b border-slate-200 bg-navy-900 text-white rounded-t-md flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Payment issuance</div>
                <div className="text-xs font-bold">Record payment voucher</div>
              </div>
              <span className="text-[10px] font-mono bg-slate-800 border border-slate-700 px-1.5 rounded">PV</span>
            </div>
            {can('vendor.manage') ? (
              <div className="p-3 space-y-3">
                <Field label="Payment amount (PKR)" hint={balance > 0 ? `payable now ${money(balance)}` : balance < 0 ? `vendor already holds an advance of ${money(-balance)}` : 'nothing outstanding — this becomes an advance'}>
                  <div className="relative"><span className="absolute inset-y-0 left-2 flex items-center text-xs text-slate-500 font-mono">Rs</span>
                    <input type="number" min="0" step="0.01" className={`${NUM} pl-8 h-10 text-base font-bold`} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="0.00" /></div>
                </Field>
                <div className="grid grid-cols-3 gap-1">
                  <button type="button" onClick={() => setPay({ ...pay, amount: String(Math.max(0, balance)) })} className="h-7 text-[10px] font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">Full balance</button>
                  <button type="button" onClick={() => setPay({ ...pay, amount: String(Math.max(0, Math.round(balance / 2))) })} className="h-7 text-[10px] font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">Half</button>
                  <button type="button" onClick={() => setPay({ ...pay, amount: '' })} className="h-7 text-[10px] font-semibold rounded border bg-slate-100 border-slate-300 hover:bg-slate-200">Clear</button>
                </div>
                <div>
                  <label className={LABEL}>Payment mode</label>
                  <div className="grid grid-cols-3 gap-1">
                    {[['cash', 'Cash'], ['cheque', 'Cheque'], ['online', 'Online transfer']].map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setPay({ ...pay, method: k })}
                        className={`h-8 text-[11px] font-semibold rounded border ${pay.method === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <Field label={pay.method === 'cheque' ? 'Cheque no & bank' : pay.method === 'online' ? 'Transaction reference' : 'Voucher remark'} hint="written on the ledger entry">
                  <input className={`${CTL} font-mono`} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder={pay.method === 'cash' ? 'e.g. settlement against GRN-00012' : 'e.g. HBL #4920 / CHQ 00182'} />
                </Field>
                <button type="button" className={`${BTN_GO} w-full`} onClick={post} disabled={!(Number(pay.amount) > 0) || busy}>
                  <span className="inline-flex items-center gap-1.5"><Icon name="check" size={14} /> {busy ? 'Posting…' : 'Post payment voucher'}</span>
                </button>
                <div className="text-[10px] text-slate-500">Posts to the vendor&apos;s ledger and the directory balance at once. Cash paid out here is not drawn from a till session.</div>
              </div>
            ) : (
              <div className="p-3 text-xs text-slate-500">Recording a payment needs the vendor-manage permission.</div>
            )}
          </div>

          <div className="mt-3 bg-white rounded-md border border-slate-300 shadow-xs p-3 text-[11px] text-slate-600">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">Vendor banking &amp; regulatory</div>
            NTN, STRN, drug sale licence and bank account are not held on the vendor record. They are on the client&apos;s question list before a column is added.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 11 — new vendor. Only what the record holds.
// ---------------------------------------------------------------------------
function NewVendor({ onClose, onDone, onErr }) {
  const [f, setF] = useState({ name: '', contact: '', address: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useCallback(async () => {
    if (!f.name.trim() || busy) return;
    setBusy(true);
    try { await api.post('/vendors', f); onDone(`Vendor "${f.name}" created.`); }
    catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [f, busy, onDone, onErr]);
  return (
    <Modal title="Register new vendor / distributor" sub="Purchase & supply › vendors & distributors › new" onClose={onClose} onSubmit={save}>
      <div className="p-4 space-y-4">
        <div>
          <SectionHead n="1" title="Distributor & company identification" right={<span className="text-[10px] text-slate-500">* required</span>} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Distributor name *" hint="as it appears on their invoices" className="col-span-2"><input className={CTL} value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Muller & Phipps Pakistan (Pvt) Ltd" /></Field>
            <Field label="Contact / order booker" hint="name and mobile of who takes the order"><input className={CTL} value={f.contact} onChange={set('contact')} placeholder="e.g. Kashif Riaz 0321-4455667" /></Field>
            <Field label="Address"><input className={CTL} value={f.address} onChange={set('address')} placeholder="branch / city" /></Field>
            <Field label="Notes" hint="terms, delivery days, principals handled — free text" className="col-span-2"><input className={CTL} value={f.notes} onChange={set('notes')} placeholder="e.g. delivers Tue & Fri; GSK, Getz, Searle" /></Field>
          </div>
        </div>
        <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <b>Not stored yet:</b> NTN, STRN, drug sale licence, credit terms and settlement bank account. The vendor record has no columns for them;
          they are on the client&apos;s question list and will be added when answered, not typed into notes.
        </div>
      </div>
      <Actions onClose={onClose} onSave={save} label="Save vendor account" disabled={!f.name.trim()} busy={busy} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Orders booked and the demand slip.
//
// The system issues NO purchase orders. The order taker walks in, writes the
// order in his own book, and that book stays authoritative. These rows are a
// memo so the counter can answer "did we order Panadol?" without ringing him,
// and the slip is the sheet you hand him when he arrives.
// ---------------------------------------------------------------------------
function OrderModal({ vendors, vendor, onClose, onDone, onErr }) {
  const [f, setF] = useState({ vendor_id: vendor ? String(vendor.id) : '', taker_name: '', taker_contact: '', expected_on: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useCallback(async () => {
    if (!f.vendor_id || busy) return;
    setBusy(true);
    try { await api.post('/vendors/bookings', f); onDone('Order booking recorded.'); }
    catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [f, busy, onDone, onErr]);
  return (
    <Modal title="Record an order / demand note" sub="orders booked" onClose={onClose} onSubmit={save}>
      <div className="p-4 space-y-3">
        <div className="text-[11px] text-slate-500">The order taker&apos;s book is the real record. Note what he took so the counter knows what is coming.</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Distributor *" className="col-span-2">
            <Select value={f.vendor_id} onChange={set('vendor_id')}>
              <option value="">Choose…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Order taker / representative"><input className={CTL} value={f.taker_name} onChange={set('taker_name')} placeholder="who took it" autoFocus /></Field>
          <Field label="His mobile"><input className={`${CTL} font-mono`} value={f.taker_contact} onChange={set('taker_contact')} placeholder="03xx-xxxxxxx" /></Field>
          <Field label="Expected delivery"><input type="date" className={`${CTL} font-mono`} value={f.expected_on} onChange={set('expected_on')} /></Field>
          <Field label="What was ordered" hint="free text — medicines and quantities as written" className="col-span-2"><input className={CTL} value={f.notes} onChange={set('notes')} placeholder="e.g. Amoxil 500 ×10 box, Flagyl 400 ×5 box" /></Field>
        </div>
      </div>
      <Actions onClose={onClose} onSave={save} label="Save order booking" disabled={!f.vendor_id} busy={busy} />
    </Modal>
  );
}

// The sheet handed to the order taker. Suggested in BOXES, because that is the
// unit stock is actually bought in — nobody orders 340 tablets.
function DemandSlip({ onClose, onErr }) {
  const [slip, setSlip] = useState(null);
  useEffect(() => { api.get('/vendors/demand-slip').then(setSlip).catch((e) => onErr(e.message)); }, [onErr]);
  return (
    <Modal title="Demand slip" sub="what is at or below its reorder level, in boxes" onClose={onClose} wide
      right={<button type="button" className={BTN_DARK} onClick={() => printPaper('a4')}><Icon name="printer" size={13} /> Print</button>}>
      <div className="p-4" id="demand-slip">
        {!slip ? <div className="text-xs text-slate-500">Loading…</div> : (
          <>
            <div className="text-sm font-bold text-slate-900">{slip.pharmacy || 'Pharmacy'}</div>
            <div className="text-[10px] text-slate-500 font-mono mb-2">Order demand · {new Date(slip.generated_at).toLocaleString('en-GB')}</div>
            {slip.items.length === 0 ? <div className="text-xs text-slate-500">Nothing is at or below its reorder level.</div> : (
              <Tbl head={['Medicine', 'Company', 'In stock', 'Order']} right={[2, 3]}>
                {slip.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1.5 font-semibold">{i.name}{i.strength ? <span className="text-slate-500 font-normal"> {i.strength}</span> : ''}</td>
                    <td className="py-1.5 text-slate-600">{i.manufacturer || '—'}</td>
                    <td className="py-1.5 text-right font-mono">{i.on_hand_label}</td>
                    <td className="py-1.5 text-right font-mono"><b>{i.suggest_boxes} box</b><div className="text-[10px] text-slate-500">{i.units_per_box}/box</div></td>
                  </tr>
                ))}
              </Tbl>
            )}
            <div className="flex justify-between gap-6 mt-6 text-xs text-slate-700">
              <div>Given by ____________________</div><div>Order taker ____________________</div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Goods received against an invoice — the multi-line GRN
// ---------------------------------------------------------------------------
function PurchaseModal({ vendor, products, bookings, onClose, onDone, onErr }) {
  const blank = () => ({ product_id: '', quantity: 1, cost_price: '', mrp: '', batch_no: '', expiry_date: '' });
  const [invoice, setInvoice] = useState('');
  const [paid, setPaid] = useState('');
  const [booking, setBooking] = useState('');
  const [partial, setPartial] = useState(false);
  const [rows, setRows] = useState([blank()]);
  const [busy, setBusy] = useState(false);
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const total = rows.reduce((s, r) => s + Number(r.cost_price || 0) * Number(r.quantity || 0), 0);
  const prod = (id) => products.find((p) => String(p.id) === String(id));

  const save = useCallback(async () => {
    if (busy) return;
    const items = rows.filter((r) => r.product_id && r.quantity > 0).map((r) => ({
      ...r, product_id: Number(r.product_id), quantity: Number(r.quantity), cost_price: Number(r.cost_price || 0), mrp: r.mrp === '' ? undefined : Number(r.mrp),
    }));
    if (!items.length) return onErr('Add at least one line item.');
    const missing = items.find((it) => prod(it.product_id)?.is_medicine !== 0 && (!it.batch_no || !it.expiry_date));
    if (missing) return onErr(`${prod(missing.product_id)?.name}: a medicine needs its batch number and expiry.`);
    setBusy(true);
    try {
      const g = await api.post(`/vendors/${vendor.id}/purchase`, {
        invoice_no: invoice, paid_amount: Number(paid || 0), items,
        order_booking_id: booking ? Number(booking) : undefined, partial_delivery: partial || undefined,
      });
      onDone(`Received ${g.grnNo} from ${vendor.name} (${money(g.total)}).`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [busy, rows, invoice, paid, booking, partial, vendor, onDone, onErr]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title={`Goods received — ${vendor.name}`} sub="inward stock against a supplier invoice" onClose={onClose} onSubmit={save} wide
      right={<Tag tone="blue">quantities in base units</Tag>}>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="Supplier invoice / challan no"><input className={`${CTL} font-mono`} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. DC-2026-8819" autoFocus /></Field>
          <Field label="Paid on receipt (Rs)" hint="the rest goes on the vendor's account"><input type="number" min="0" className={NUM} value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" /></Field>
          <Field label="Against booked order" hint={booking ? 'marks the booking delivered' : 'optional'}>
            <Select value={booking} onChange={(e) => setBooking(e.target.value)}>
              <option value="">— none —</option>
              {bookings.map((b) => <option key={b.id} value={b.id}>{b.booked_on} · {b.taker_name || 'order'}{b.notes ? ` · ${b.notes.slice(0, 30)}` : ''}</option>)}
            </Select>
          </Field>
          {booking && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 self-end pb-2 cursor-pointer">
              <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Partial delivery — keep the order open
            </label>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-300">
              <th className="text-left py-1.5 pr-1.5 font-semibold w-[28%]">Medicine</th><th className="text-right py-1.5 px-1.5 font-semibold">Qty (units)</th>
              <th className="text-right py-1.5 px-1.5 font-semibold">Cost / unit</th><th className="text-right py-1.5 px-1.5 font-semibold">MRP / unit</th>
              <th className="text-left py-1.5 px-1.5 font-semibold">Batch</th><th className="text-left py-1.5 px-1.5 font-semibold">Expiry</th>
              <th className="text-right py-1.5 px-1.5 font-semibold">Line</th><th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const p = prod(r.product_id);
                return (
                  <tr key={i}>
                    <td className="py-1 pr-1.5">
                      <Select value={r.product_id} onChange={(e) => setRow(i, 'product_id', e.target.value)}>
                        <option value="">— choose —</option>
                        {products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.strength ? ` ${x.strength}` : ''}</option>)}
                      </Select>
                      {p && <div className="text-[10px] text-slate-500 font-mono">{p.stock_label} on shelf{p.units_per_box > 1 ? ` · ${p.units_per_box}/box` : ''}{p.is_medicine === 0 ? ' · sundry' : ''}</div>}
                    </td>
                    <td className="py-1 px-1.5"><input type="number" min="1" className={NUM} value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} /></td>
                    <td className="py-1 px-1.5"><input type="number" min="0" step="0.01" className={NUM} value={r.cost_price} onChange={(e) => setRow(i, 'cost_price', e.target.value)} placeholder="0.00" /></td>
                    <td className="py-1 px-1.5"><input type="number" min="0" step="0.01" className={NUM} value={r.mrp} onChange={(e) => setRow(i, 'mrp', e.target.value)} placeholder={p?.mrp > 0 ? String(p.mrp) : '—'} /></td>
                    <td className="py-1 px-1.5"><input className={`${CTL} font-mono`} value={r.batch_no} onChange={(e) => setRow(i, 'batch_no', e.target.value)} placeholder={p?.is_medicine === 0 ? 'optional' : 'required'} /></td>
                    <td className="py-1 px-1.5"><input type="date" className={`${CTL} font-mono`} value={r.expiry_date} onChange={(e) => setRow(i, 'expiry_date', e.target.value)} /></td>
                    <td className="py-1 px-1.5 text-right font-mono font-bold whitespace-nowrap">{money(Number(r.cost_price || 0) * Number(r.quantity || 0))}</td>
                    <td className="py-1 pl-1 text-right"><button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)} aria-label="Remove line">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" className={BTN} onClick={() => setRows((rs) => [...rs, blank()])}><Icon name="plus" size={12} /> Add line</button>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Invoice total</div>
            <div className="font-mono font-black text-lg text-slate-900">{money(total)}</div>
            <div className="text-[10px] text-slate-500 font-mono">paid now {money(Number(paid || 0))} · on account {money(Math.max(0, total - Number(paid || 0)))}</div>
          </div>
        </div>
      </div>
      <Actions onClose={onClose} onSave={save} label="Receive stock & raise payable" busy={busy} />
    </Modal>
  );
}

function PaymentModal({ vendor, onClose, onDone, onErr }) {
  const [f, setF] = useState({ amount: '', method: 'cash', reference: '' });
  const [busy, setBusy] = useState(false);
  const save = useCallback(async () => {
    const amount = Number(f.amount);
    if (!(amount > 0) || busy) return;
    setBusy(true);
    try { await api.post(`/vendors/${vendor.id}/payment`, { amount, method: f.method, reference: f.reference || undefined }); onDone(`Paid ${money(amount)} to ${vendor.name} by ${f.method}.`); }
    catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [f, busy, vendor, onDone, onErr]);
  return (
    <Modal title={`Payment voucher — ${vendor.name}`} sub="payment issuance" onClose={onClose} onSubmit={save}>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs">
          <span className="text-slate-600">Outstanding payable</span><span className="font-mono font-bold">{money(vendor.balance)}</span>
        </div>
        <Field label="Amount (PKR) *">
          <div className="relative"><span className="absolute inset-y-0 left-2 flex items-center text-xs text-slate-500 font-mono">Rs</span>
            <input type="number" min="0" step="0.01" className={`${NUM} pl-8 h-10 text-base font-bold`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus placeholder="0.00" /></div>
        </Field>
        <div>
          <label className={LABEL}>Payment mode</label>
          <div className="grid grid-cols-3 gap-1">
            {[['cash', 'Cash'], ['cheque', 'Cheque'], ['online', 'Online transfer']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF({ ...f, method: k })}
                className={`h-8 text-[11px] font-semibold rounded border ${f.method === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
        </div>
        <Field label="Reference" hint="cheque no, bank reference or a remark — written on the ledger entry"><input className={`${CTL} font-mono`} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <Actions onClose={onClose} onSave={save} label="Post payment voucher" disabled={!(Number(f.amount) > 0)} busy={busy} />
    </Modal>
  );
}

function ReclaimModal({ vendor, products, preset, onClose, onDone, onErr }) {
  const [f, setF] = useState({ product_id: preset?.product_id ? String(preset.product_id) : '', batch_id: preset?.batch_id ? String(preset.batch_id) : '', quantity: 1, value: '', reason: '', settlement: 'credit' });
  const [batches, setBatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const loadBatches = (pid) => {
    if (pid) api.get(`/inventory/products/${pid}/batches`).then((b) => setBatches(b.filter((x) => x.quantity > 0))).catch(() => setBatches([]));
    else setBatches([]);
  };
  useEffect(() => { loadBatches(f.product_id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function pickProduct(pid) { setF({ ...f, product_id: pid, batch_id: '' }); loadBatches(pid); }
  const batch = batches.find((b) => String(b.id) === String(f.batch_id));
  useEffect(() => { if (batch && preset && !f.quantity) setF((x) => ({ ...x, quantity: batch.quantity })); }, [batch]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = f.value !== '' ? Number(f.value) : batch ? batch.cost_price * Number(f.quantity || 0) : 0;

  const save = useCallback(async () => {
    if (!f.product_id || !f.batch_id || busy) return;
    setBusy(true);
    try {
      await api.post(`/vendors/${vendor.id}/reclaim`, { ...f, product_id: Number(f.product_id), batch_id: Number(f.batch_id), quantity: Number(f.quantity), value: f.value ? Number(f.value) : undefined });
      onDone(`Reclaim recorded — ${money(value)} ${f.settlement === 'cash' ? 'cash refund expected' : 'credit note against the account'}.`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [f, busy, vendor, value, onDone, onErr]);

  return (
    <Modal title={`Reclaim to ${vendor.name}`} sub="expiry / damage return — stock leaves the shelf, the vendor owes us" onClose={onClose} onSubmit={save}>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Product" className="col-span-2">
            <Select value={f.product_id} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">— choose —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.strength ? ` ${p.strength}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Batch" className="col-span-2" hint={batch ? `${batch.quantity} on hand · cost ${money(batch.cost_price)} · exp ${batch.expiry_date || '—'}${batch.vendor_name ? ` · from ${batch.vendor_name}` : ''}` : null}>
            <Select value={f.batch_id} onChange={set('batch_id')}>
              <option value="">— choose —</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no || 'batch'} · exp {b.expiry_date || '—'} · qty {b.quantity}</option>)}
            </Select>
          </Field>
          <Field label="Quantity (units)"><input type="number" min="1" max={batch?.quantity} className={NUM} value={f.quantity} onChange={set('quantity')} /></Field>
          <Field label="Value (Rs)" hint={f.value === '' ? `defaults to cost × qty = ${money(value)}` : null}><input type="number" min="0" className={NUM} value={f.value} onChange={set('value')} placeholder={n2(value)} /></Field>
          <Field label="Settlement">
            <Select value={f.settlement} onChange={set('settlement')}>
              <option value="credit">Credit note against the account</option>
              <option value="cash">Cash refund</option>
            </Select>
          </Field>
          <Field label="Reason"><input className={CTL} value={f.reason} onChange={set('reason')} placeholder="e.g. expiry within claim window" /></Field>
        </div>
      </div>
      <Actions onClose={onClose} onSave={save} label="Record reclaim" disabled={!f.product_id || !f.batch_id} busy={busy} />
    </Modal>
  );
}
