import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Select from '../components/Select.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money, strengthOf } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, BTN_GO, CTL, NUM, LABEL } from '../components/ws/index.jsx';

// Inventory: the shelf, batch by batch, and what the law asks of it.
//
// PHASE 09 — screens 06 / 07 / 08 (hwt-client/design/stitch). The list on the
// left, the medicine under inspection on the right with its batches; the
// receive form (08) and the medicine master (07) are the same two forms this
// page always had, in the design's clothes. Every figure comes from the
// products list, the alerts route and — when the user may read it — the
// dashboard's stock, expiry and compliance blocks. Nothing is drawn.
//
// Mockup elements not built, and why: "therapeutic class" and "WHO ATC code"
// have no columns; the "DRAP regulatory gap" tile is derivable (medicine with
// no registration number) and IS built; the "supplier claim voucher" is the
// existing vendor reclaim, reached from the batch that needs it.

const SCHEDULES = ['OTC', 'Rx', 'G', 'Narcotic'];
const SCHEDULE_LABEL = { OTC: 'OTC', Rx: 'Rx', G: 'Sch. G', Narcotic: 'Controlled' };
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const daysLeft = (iso) => (iso ? Math.round((new Date(iso) - Date.now()) / 86400000) : null);


export default function Inventory() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState({ low_stock: [], near_expiry: [], near_expiry_days: 90 });
  const [dash, setDash] = useState(null);       // stock / expiry / compliance blocks, when permitted
  const [q, setQ] = useState('');
  const [schedule, setSchedule] = useState('');
  const [pill, setPill] = useState('all');
  const [selected, setSelected] = useState(null);
  const [batches, setBatches] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [receiveFor, setReceiveFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const searchRef = useRef(null);

  // The list is a server search when there is a term and the first hundred
  // otherwise — the same route as before, so the row shape is unchanged.
  const load = useCallback((term = q) => {
    const qs = term.trim().length >= 2 ? `?q=${encodeURIComponent(term.trim())}` : '';
    api.get(`/inventory/products${qs}`).then(setProducts).catch((e) => setErr(e.message));
    api.get('/inventory/alerts').then(setAlerts).catch(() => {});
    // A stock clerk without the dashboard permission still gets the page; the tiles then
    // fall back to what the list itself can say.
    api.get('/pharmacy/dashboard').then(setDash).catch(() => setDash(null));
  }, [q]);
  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setTimeout(() => load(q), 250);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBatches = useCallback((p) => {
    if (!p) { setBatches([]); return; }
    api.get(`/inventory/products/${p.id}/batches`).then(setBatches).catch(() => setBatches([]));
  }, []);
  useEffect(() => { loadBatches(selected); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the dossier on the same medicine after a receive or an edit.
  useEffect(() => {
    if (!selected) return;
    const fresh = products.find((p) => p.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearIds = useMemo(() => new Set(alerts.near_expiry.map((b) => b.product_id)), [alerts]);
  const isLow = (p) => p.on_hand <= p.reorder_level;
  const drapMissing = (p) => p.drug_schedule !== 'OTC' && !(p.drap_reg_no || '').trim();
  const controlled = (p) => p.drug_schedule === 'G' || p.drug_schedule === 'Narcotic';

  const rows = products
    .filter((p) => !schedule || (p.drug_schedule || 'OTC') === schedule)
    .filter((p) => pill === 'all' ? true
      : pill === 'low' ? isLow(p)
        : pill === 'expiry' ? nearIds.has(p.id)
          : pill === 'drap' ? drapMissing(p)
            : pill === 'controlled' ? controlled(p) : true);

  const counts = {
    all: products.length,
    low: products.filter(isLow).length,
    expiry: products.filter((p) => nearIds.has(p.id)).length,
    drap: products.filter(drapMissing).length,
    controlled: products.filter(controlled).length,
  };

  // The tiles. Dashboard figures when we have them (whole shelf, at cost);
  // otherwise the loaded rows (never more than the list shows, and never cost).
  const tiles = dash ? {
    retail: money(dash.stock.value_at_retail), cost: money(dash.stock.value_at_cost), skus: dash.stock.skus,
    near30: dash.expiry.within_30.batches, quarantined: dash.stock.quarantined_batches,
    out: dash.stock.out_of_stock, low: dash.stock.low_stock,
    drap: dash.compliance.missing_drap_reg, aboveMrp: dash.compliance.priced_above_mrp,
    claimable: dash.expiry.claimable, partial: false,
  } : {
    retail: money(products.reduce((t, p) => t + p.on_hand * p.sale_price, 0)), cost: null, skus: products.length,
    near30: alerts.near_expiry.filter((b) => b.days_left <= 30).length, quarantined: null,
    out: products.filter((p) => p.on_hand <= 0).length, low: products.filter((p) => p.on_hand > 0 && isLow(p)).length,
    drap: counts.drap, aboveMrp: products.filter((p) => p.mrp > 0 && p.sale_price > p.mrp).length,
    claimable: null, partial: true,
  };
  const soonest = alerts.near_expiry[0];

  // Alt+N new medicine, F3 receive into the medicine under inspection, Esc
  // clears the search. Never while typing in a field (Esc excepted — that IS
  // the search box being cleared).
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = ['input', 'textarea', 'select'].includes(tag);
      if (receiveFor || editing || showNew) return;
      if (e.altKey && (e.key === 'n' || e.key === 'N') && can('inventory.manage')) { e.preventDefault(); setShowNew(true); }
      else if (e.key === 'F3' && can('inventory.manage')) {
        e.preventDefault();
        if (selected) setReceiveFor(selected);
        else { searchRef.current?.focus(); setMsg('Pick the medicine first — click its row (or find it above), then press F3 to receive stock into it.'); }
      }
      else if (e.key === 'Escape') {
        if (document.activeElement === searchRef.current || !typing) { e.preventDefault(); setQ(''); searchRef.current?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [receiveFor, editing, showNew, selected, can]);

  const done = (m) => { setMsg(m); setReceiveFor(null); setEditing(null); setShowNew(false); load(q); loadBatches(selected); };

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      {/* Title + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Pharmacy Inventory, Batches &amp; DRAP Compliance</h1>
            {dash && (
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase ${dash.compliance.total ? 'text-amber-800 bg-amber-100 border-amber-300' : 'text-emerald-800 bg-emerald-100 border-emerald-300'}`}>
                {dash.compliance.total ? `${dash.compliance.total} compliance gap${dash.compliance.total === 1 ? '' : 's'}` : 'compliance clear'}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">Stock is held per batch and sold FEFO. A medicine needs a DRAP registration number, a batch and an expiry on every receipt, and a shelf price at or under its MRP.</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <button type="button" className={BTN} onClick={() => load(q)}><Icon name="returns" size={13} /> Refresh</button>
          {can('inventory.manage') && (
            <>
              <button type="button" className={BTN_DARK} onClick={() => setShowNew(true)}><Icon name="plus" size={13} /> New medicine master <Kbd className="!bg-slate-700 !border-slate-600 !text-white">Alt+N</Kbd></button>
              <button type="button" className={BTN} onClick={() => (selected ? setReceiveFor(selected) : (searchRef.current?.focus(), setMsg('Pick the medicine first — click its row (or find it above), then press F3 to receive stock into it.')))}
                title={selected ? `Receive ${selected.name}` : 'Pick a medicine, then receive into it'}>
                <Icon name="box" size={13} /> {selected ? `Receive into ${selected.name}` : 'Receive stock / GRN'} <Kbd>F3</Kbd>
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Tile label="Active stock valuation" value={tiles.retail} icon="trend"
          sub={tiles.cost ? <>Cost: <b className="font-mono">{tiles.cost}</b> · {tiles.skus} SKUs</> : `${tiles.skus} SKUs${tiles.partial ? ' listed' : ''} · at retail`} />
        <Tile label={`Near-expiry watch (≤${alerts.near_expiry_days} days)`} value={alerts.near_expiry.length} unit={(alerts.near_expiry.length) === 1 ? 'batch' : 'batches'} icon="clock"
          tone={tiles.near30 ? 'danger' : 'ok'}
          sub={soonest ? `${soonest.name} · ${soonest.days_left < 0 ? 'expired' : `${soonest.days_left}d left`}${tiles.quarantined ? ` · ${tiles.quarantined} quarantined` : ''}` : 'nothing inside the window'}
          right={tiles.claimable?.batches ? <span className="text-[9px] font-bold uppercase text-rose-900 bg-rose-100 border border-rose-300 px-1 rounded">claim due · {tiles.claimable.batches}</span> : null} />
        <Tile label="Stock-out / reorder alert" value={tiles.out + tiles.low} unit={(tiles.out + tiles.low) === 1 ? 'item' : 'items'} icon="warning"
          tone={tiles.out ? 'danger' : tiles.low ? 'warn' : 'ok'}
          sub={tiles.out || tiles.low ? `${tiles.out} out of stock · ${tiles.low} at or under reorder` : 'all items above reorder level'}
          right={alerts.low_stock.length ? <button type="button" onClick={() => setPill('low')} className="text-[9px] font-bold uppercase text-amber-900 bg-amber-100 border border-amber-300 px-1 rounded">show</button> : null} />
        <Tile label="DRAP regulatory gap" value={tiles.drap} unit="missing reg. no" icon="shield"
          tone={tiles.drap ? 'warn' : 'ok'}
          sub={tiles.aboveMrp ? `${tiles.aboveMrp} priced above MRP` : 'no medicine priced above MRP'}
          right={tiles.drap ? <button type="button" onClick={() => setPill('drap')} className="text-[9px] font-bold uppercase text-amber-900 bg-amber-100 border border-amber-300 px-1 rounded">audit</button> : null} />
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        {/* ================= LEFT: the shelf ============================== */}
        <div className="col-span-12 2xl:col-span-8 bg-white rounded-md border border-slate-300 shadow-xs">
          <div className="p-3 border-b border-slate-200 flex flex-col md:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Icon name="barcode" size={16} /></div>
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
                className="block w-full h-9 min-h-0 pl-9 pr-20 py-0 text-sm bg-slate-50 border border-slate-300 rounded focus:border-slate-800 focus:bg-white focus:ring-1 focus:ring-slate-800 font-medium text-slate-900 placeholder-slate-400"
                placeholder="Scan barcode or type brand / generic / SKU / DRAP number…" />
              <div className="absolute inset-y-0 right-0 pr-2 flex items-center"><Kbd>Esc</Kbd><span className="text-[10px] text-slate-500 ml-1">clear</span></div>
            </div>
            <select value={schedule} onChange={(e) => setSchedule(e.target.value)} className={`${CTL} md:w-52`}>
              <option value="">All drug schedules</option>
              <option value="Rx">Prescription only (Rx)</option>
              <option value="OTC">Over the counter (OTC)</option>
              <option value="G">Schedule G</option>
              <option value="Narcotic">Controlled drugs</option>
            </select>
          </div>
          <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-1 flex-wrap">
            {[['all', 'All medicines'], ['low', 'Low stock'], ['expiry', 'Near expiry'], ['drap', 'DRAP missing'], ['controlled', 'Schedule G / controlled']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPill(k)}
                className={`h-7 min-h-[44px] lg:min-h-0 px-2.5 text-[11px] font-semibold rounded border ${pill === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'} ${k !== 'all' && counts[k] && pill !== k ? (k === 'low' || k === 'expiry' ? '!text-rose-800' : '!text-amber-800') : ''}`}>
                {l} ({counts[k]})
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="table-stack w-full text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 pl-3 pr-2">Product &amp; formula</th>
                  <th className="text-left py-2 px-2">Schedule</th>
                  <th className="text-left py-2 px-2">DRAP reg</th>
                  <th className="text-right py-2 px-2">On hand</th>
                  <th className="text-right py-2 px-2 whitespace-nowrap">Price / MRP</th>
                  <th className="text-right py-2 pl-2 pr-3"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => {
                  const on = selected?.id === p.id;
                  const near = alerts.near_expiry.filter((b) => b.product_id === p.id).sort((a, b) => a.days_left - b.days_left)[0];
                  return (
                    <tr key={p.id} onClick={() => setSelected(p)}
                      className={`cursor-pointer ${on ? 'bg-sky-50 shadow-[inset_3px_0_0_#0369a1]' : 'hover:bg-slate-50'}`}>
                      <td className="py-2 pl-3 pr-2" data-label="">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                          <span>{p.name}{strengthOf(p) ? <span className="text-slate-500 font-normal"> {strengthOf(p)}</span> : null}</span>
                          {isLow(p) && <Tag tone={p.on_hand <= 0 ? 'red' : 'amber'}>{p.on_hand <= 0 ? 'out of stock' : 'low stock'}</Tag>}
                          {near && <Tag tone={near.days_left <= 30 ? 'red' : 'amber'}>{near.days_left < 0 ? 'expired batch' : `${near.days_left}d left`}</Tag>}
                          {p.is_refrigerated ? <Tag tone="blue">2–8 °C</Tag> : null}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {[p.generic_name, p.form, p.units_per_strip > 1 ? `${p.units_per_strip}/strip` : null,
                            p.strips_per_box > 1 ? `${p.strips_per_box} strips/box` : null,
                            p.units_per_strip > 1 && !p.allow_loose ? 'full strips only' : null, p.sku].filter(Boolean).join(' • ')}
                        </div>
                        {near && <div className="text-[10px] font-mono text-slate-500">Batch {near.batch_no || '—'} • exp {near.expiry_date}{near.quarantined ? ' • quarantined' : ''}</div>}
                      </td>
                      <td className="py-2 px-2" data-label="Schedule"><Tag tone={{ OTC: 'gray', Rx: 'blue', G: 'amber', Narcotic: 'red' }[p.drug_schedule] || 'gray'}>{SCHEDULE_LABEL[p.drug_schedule] || 'OTC'}</Tag></td>
                      <td className="py-2 px-2 font-mono text-slate-600" data-label="DRAP reg">
                        {p.drap_reg_no || (p.drug_schedule !== 'OTC' ? <Tag tone="amber">missing</Tag> : <span className="text-slate-400">—</span>)}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap" data-label="On hand">
                        <div className={`font-mono font-bold ${p.on_hand <= 0 ? 'text-rose-700' : isLow(p) ? 'text-amber-700' : 'text-slate-900'}`}>{p.on_hand.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{p.stock_label || `${p.on_hand} ${p.unit || ''}`} • reorder {p.reorder_level}</div>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap font-mono" data-label="Price / MRP">
                        <div className="font-bold text-slate-900">{money(p.sale_price)}<span className="text-[10px] text-slate-500 font-normal">/{p.unit || 'unit'}</span></div>
                        <div className={`text-[10px] ${p.mrp > 0 && p.sale_price > p.mrp ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>
                          {p.strip_price != null ? `${money(p.strip_price)}/strip • ` : ''}MRP {p.mrp > 0 ? money(p.mrp) : '—'}
                        </div>
                      </td>
                      <td className="py-2 pl-2 pr-3 text-right whitespace-nowrap" data-label="">
                        {can('inventory.manage') && (
                          <div className="inline-flex gap-1">
                            <button type="button" className="h-6 min-h-[44px] lg:min-h-0 px-2 text-[10px] font-semibold rounded border bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                              onClick={(e) => { e.stopPropagation(); setSelected(p); setEditing(p); }}>Edit</button>
                            <button type="button" className="h-6 min-h-[44px] lg:min-h-0 px-2 text-[10px] font-semibold rounded border bg-slate-800 text-white border-slate-900 hover:bg-slate-900"
                              onClick={(e) => { e.stopPropagation(); setSelected(p); setReceiveFor(p); }}>Receive</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-500">
                    <span className="ws-empty">{q.trim().length >= 2 ? `No medicine matches “${q}”.` : 'Nothing in this view.'}</span>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
            <span>Showing {rows.length} of {products.length} loaded{q.trim().length >= 2 ? ' (search)' : products.length >= 100 ? ' — type to search the rest' : ''}</span>
            <span>{alerts.near_expiry.length} batch{alerts.near_expiry.length === 1 ? '' : 'es'} inside the {alerts.near_expiry_days}-day expiry window</span>
          </div>
        </div>

        {/* ================= RIGHT: the dossier ============================ */}
        <div className="col-span-12 2xl:col-span-4">
          {selected ? (
            <Dossier product={selected} batches={batches} alerts={alerts} can={can} dash={dash}
              onReceive={() => setReceiveFor(selected)} onEdit={() => setEditing(selected)}
              onClaim={(b) => nav('/vendors', { state: { reclaim: { vendor_id: b.vendor_id, product_id: selected.id, batch_id: b.id } } })}
              onClose={() => setSelected(null)} />
          ) : (
            <div className="bg-white rounded-md border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
              <Icon name="box" size={22} />
              <div className="mt-2 font-semibold text-slate-700">No medicine under inspection</div>
              <div className="mt-1">Click a row to see its batches, packaging and expiry position.</div>
            </div>
          )}
        </div>
      </div>

      {receiveFor && <ReceiveModal product={receiveFor} batches={receiveFor.id === selected?.id ? batches : null} onClose={() => setReceiveFor(null)} onDone={done} onErr={setErr} />}
      {showNew && <ProductModal onClose={() => setShowNew(false)} onDone={done} onErr={setErr} />}
      {editing && <ProductModal product={editing} batches={editing.id === selected?.id ? batches : null} onClose={() => setEditing(null)} onDone={done} onErr={setErr} />}
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
    <div className="ws-tile bg-white border min-w-0" data-tone={tone}>
      <div className="flex items-start justify-between gap-2">
        <div className="ws-tile-label text-[10px] font-bold uppercase tracking-wide text-slate-500 line-clamp-2 min-h-[2.4em] leading-[1.2]">{label}</div>
        <div className="flex items-center gap-1.5 shrink-0">{right && <span className="hidden sm:inline-flex">{right}</span>}<span className="text-slate-400"><Icon name={icon} size={16} /></span></div>
      </div>
      {right && <div className="sm:hidden mt-1">{right}</div>}
      <div className={`ws-tile-value ws-tile-mono font-bold leading-tight mt-0.5 ${t}`}>{value} {unit && <span className="text-[11px] font-sans font-semibold text-slate-500">{unit}</span>}</div>
      <div className="ws-tile-sub text-[10px] text-slate-500 line-clamp-2">{sub}</div>
    </div>
  );
}

function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className={LABEL}>{label}</label>
      {children}
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
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

// ---------------------------------------------------------------------------
// The dossier — the medicine under inspection and its batches
// ---------------------------------------------------------------------------
function Dossier({ product: p, batches, alerts, can, dash, onReceive, onEdit, onClaim, onClose }) {
  const perStrip = p.units_per_strip || 1;
  const perBox = p.units_per_box || perStrip;
  const live = batches.filter((b) => b.quantity > 0);
  const claimDays = dash?.expiry?.claim_window_days || null;
  const claimable = live.filter((b) => b.claim_status === 'none' && b.expiry_date && (claimDays ? daysLeft(b.expiry_date) <= claimDays : daysLeft(b.expiry_date) <= alerts.near_expiry_days))
    .sort((a, b) => daysLeft(a.expiry_date) - daysLeft(b.expiry_date))[0];

  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 rounded-t-md">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Active batch dossier</span>
          <div className="flex items-center gap-1">
            {live.some((b) => b.quarantined) && <Tag tone="red">quarantined batch</Tag>}
            <button type="button" className="text-slate-400 hover:text-slate-700 text-xs px-1" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="font-bold text-base text-slate-900 mt-0.5">{p.name} {p.strength && <span className="text-slate-500 font-normal">{p.strength}</span>}</div>
        <div className="text-[11px] text-slate-500">{[p.generic_name, p.form, p.manufacturer].filter(Boolean).join(' • ')}</div>
        <div className="flex items-center gap-1 mt-1">
          <Tag tone={{ OTC: 'gray', Rx: 'blue', G: 'amber', Narcotic: 'red' }[p.drug_schedule] || 'gray'}>{SCHEDULE_LABEL[p.drug_schedule] || 'OTC'}</Tag>
          {p.drap_reg_no ? <Tag tone="green">DRAP {p.drap_reg_no}</Tag> : p.drug_schedule !== 'OTC' ? <Tag tone="amber">DRAP missing</Tag> : null}
          {p.is_refrigerated ? <Tag tone="blue">2–8 °C</Tag> : null}
          {p.barcode ? <span className="text-[10px] font-mono text-slate-500">• {p.barcode}</span> : null}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Packaging math */}
        <div className="bg-sky-50 border border-sky-200 rounded px-3 py-2 text-[11px] text-sky-900">
          <div className="font-bold uppercase tracking-wide text-[9px] mb-0.5">Packaging breakdown</div>
          {perStrip > 1 ? (
            <><b>1 box = {p.strips_per_box || 1} strip{(p.strips_per_box || 1) === 1 ? '' : 's'} = {perBox} {p.unit || 'unit'}s.</b> Stock is counted in {p.unit || 'unit'}s, sellable as
              {perBox > perStrip ? <> <b>box</b>,</> : null} <b>strip</b>{p.allow_loose ? <> or <b>loose {p.unit || 'unit'}s</b></> : <> — <b>full strips only</b></>} from the counter shelf.</>
          ) : (
            <>Sold by the <b>{p.unit || 'unit'}</b>{perBox > 1 ? <>; a box holds <b>{perBox}</b></> : null}. Stock is counted in {p.unit || 'unit'}s.</>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">On shelf</div>
            <div className={`font-mono font-bold text-base ${p.on_hand <= 0 ? 'text-rose-700' : p.on_hand <= p.reorder_level ? 'text-amber-700' : 'text-slate-900'}`}>{p.on_hand.toLocaleString()} <span className="text-[10px] font-sans font-normal text-slate-500">{p.unit || 'unit'}</span></div>
            <div className="text-[10px] text-slate-500 font-mono">{p.stock_label} • reorder at {p.reorder_level}</div>
          </div>
          <div className="border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Sells at</div>
            <div className="font-mono font-bold text-base text-slate-900">{money(p.sale_price)}<span className="text-[10px] font-sans font-normal text-slate-500">/{p.unit || 'unit'}</span></div>
            <div className="text-[10px] text-slate-500 font-mono">
              {p.strip_price != null ? `${money(p.strip_price)}/strip` : ''}{p.box_price != null ? ` • ${money(p.box_price)}/box` : ''}{p.mrp > 0 ? ` • MRP ${money(p.mrp)}` : ' • no MRP'}
            </div>
          </div>
        </div>

        {/* Batches, soonest expiry first — the order FEFO will take them. */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-1">
            <span>Batches on shelf (FEFO order)</span><span>{live.length} live</span>
          </div>
          {live.length === 0 ? <div className="text-xs text-slate-500 py-2">No stock in any batch.</div> : (
            <div className="divide-y divide-slate-100">
              {live.map((b) => {
                const d = daysLeft(b.expiry_date);
                const tone = d == null ? 'text-slate-500' : d < 0 ? 'text-rose-700 font-bold' : d <= 30 ? 'text-rose-700 font-semibold' : d <= alerts.near_expiry_days ? 'text-amber-700 font-semibold' : 'text-slate-600';
                return (
                  <div key={b.id} className={`py-1.5 flex items-start justify-between gap-2 text-xs ${b.quarantined ? 'opacity-70' : ''}`}>
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-slate-800">Batch {b.batch_no || '—'}{b.quarantined ? <Tag tone="red"> quarantined</Tag> : null}{b.claim_status !== 'none' ? <> <Tag tone="gray">{b.claim_status}</Tag></> : null}</div>
                      <div className={`text-[10px] font-mono ${tone}`}>
                        {b.expiry_date ? <>exp {b.expiry_date} · {d < 0 ? `expired ${-d}d ago` : `${d}d left`}</> : 'no expiry recorded'}
                        {b.vendor_name ? ` · ${b.vendor_name}` : ''}
                      </div>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="font-bold text-slate-900">{b.quantity.toLocaleString()} <span className="text-[10px] font-sans font-normal text-slate-500">{p.unit || 'unit'}</span></div>
                      <div className="text-[10px] text-slate-500">@ {money(b.cost_price)} cost{b.mrp ? ` · MRP ${money(b.mrp)}` : ''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Claim window: the existing vendor reclaim, reached from the batch. */}
        {claimable && (
          <div className="bg-rose-50 border border-rose-200 rounded px-3 py-2 text-[11px] text-rose-900">
            <div className="flex items-center justify-between">
              <span className="font-bold uppercase tracking-wide text-[9px]">Supplier claim window</span>
              <span className="font-mono font-bold">{daysLeft(claimable.expiry_date) < 0 ? 'expired' : `${daysLeft(claimable.expiry_date)} days left`}</span>
            </div>
            <div className="mt-0.5">
              Batch <b className="font-mono">{claimable.batch_no || '—'}</b> ({claimable.quantity} {p.unit || 'unit'}) expires {claimable.expiry_date}
              {claimDays ? ` — inside the ${claimDays}-day window distributors accept returns in.` : '.'}
              {claimable.vendor_id ? '' : ' No supplier was recorded on this batch, so pick the vendor on the next screen.'}
            </div>
            {can('vendor.manage') && (
              <button type="button" onClick={() => onClaim(claimable)}
                className="mt-1.5 w-full h-8 bg-rose-700 hover:bg-rose-800 text-white rounded font-bold text-[11px] inline-flex items-center justify-center gap-1.5">
                <Icon name="file" size={13} /> Record supplier claim (reclaim)
              </button>
            )}
          </div>
        )}

        {can('inventory.manage') && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button type="button" className={`${BTN_DARK} justify-center`} onClick={onReceive}><Icon name="box" size={13} /> Receive stock <Kbd className="!bg-slate-700 !border-slate-600 !text-white">F3</Kbd></button>
            <button type="button" className={`${BTN} justify-center`} onClick={onEdit}>Edit medicine master</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 08 — receive stock / GRN
// ---------------------------------------------------------------------------
function ReceiveModal({ product, batches, onClose, onDone, onErr }) {
  const { user } = useAuth();
  const perStrip = product.units_per_strip || 1;
  const perBox = product.units_per_box || perStrip;
  const [f, setF] = useState({
    quantity: '', uom: perBox > 1 ? 'box' : 'unit', batch_no: '', expiry_date: '',
    manufacturer: product.manufacturer || '', cost_price: '', mrp: '', vendor_id: '', reference: '',
  });
  const unitsIn = (u) => (u === 'box' ? perBox : u === 'strip' ? perStrip : 1);
  const receivedBase = Number(f.quantity || 0) * unitsIn(f.uom);
  const [vendors, setVendors] = useState([]);
  const [history, setHistory] = useState(batches || []);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api.get('/vendors').then(setVendors).catch(() => {}); }, []);
  useEffect(() => {
    if (batches) return;
    api.get(`/inventory/products/${product.id}/batches`).then(setHistory).catch(() => {});
  }, [product.id, batches]);

  // Whether a batch number and expiry are required is decided ONCE, on the
  // server, from product_types.is_medicine. The browser reads the answer.
  const needsBatch = product.is_medicine !== 0;
  const complete = f.quantity && (!needsBatch || (f.batch_no.trim() && f.expiry_date));
  const costUnit = f.cost_price ? r2(Number(f.cost_price) / unitsIn(f.uom)) : null;
  const mrpUnit = f.mrp !== '' ? r2(Number(f.mrp) / unitsIn(f.uom)) : null;
  const batchCost = receivedBase * (costUnit || 0);
  const retailYield = receivedBase * product.sale_price;
  const margin = batchCost > 0 ? retailYield - batchCost : null;
  const overMrp = mrpUnit != null && mrpUnit > 0 && costUnit != null && costUnit > mrpUnit;
  const shelfLife = f.expiry_date ? daysLeft(f.expiry_date) : null;
  const vendor = vendors.find((v) => String(v.id) === String(f.vendor_id));
  // Bounds on the expiry (UI-03): today at the earliest, ten years at most —
  // the same bound the server applies. A field-level failure reaches the
  // primary button and the preview (UI-02).
  const today = new Date().toISOString().slice(0, 10);
  const maxExpiry = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 10); return d.toISOString().slice(0, 10); })();
  const expiryBad = shelfLife != null && shelfLife <= 0;
  const expiryFar = !!f.expiry_date && f.expiry_date > maxExpiry;
  const problem = overMrp ? 'Trade price cannot exceed the MRP printed on the pack.'
    : expiryBad ? `This batch expired on ${f.expiry_date} and cannot be received.`
      : expiryFar ? `An expiry of ${f.expiry_date} is more than ten years away — check the year on the pack.`
        : null;

  const save = useCallback(async () => {
    if (!complete || busy || problem) return;
    setBusy(true);
    try {
      const r = await api.post(`/inventory/products/${product.id}/receive`, {
        ...f,
        quantity: Number(f.quantity),
        cost_price: Number(f.cost_price || 0),
        mrp: f.mrp === '' ? null : Number(f.mrp),
        vendor_id: f.vendor_id ? Number(f.vendor_id) : null,
        reference: f.reference || undefined,
      });
      onDone(`Received ${r.received} of ${product.name}. On hand: ${r.on_hand_label}.`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [complete, busy, problem, product, f, onDone, onErr]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F9') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [save, onClose]);

  const uomName = f.uom === 'unit' ? (product.unit || 'unit') : f.uom;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !max-w-5xl !rounded-md !p-0 text-slate-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Inward stock receiving &amp; GRN (goods received note)</div>
            <div className="text-sm font-bold text-slate-900">{product.name} {product.strength && <span className="text-slate-500 font-normal">{product.strength}</span>}</div>
          </div>
          <div className="flex items-center gap-1">
            {needsBatch && <Tag tone="blue">batch &amp; expiry required</Tag>}
            {product.is_refrigerated ? <Tag tone="blue">cold chain 2–8 °C</Tag> : null}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-0">
          <div className="col-span-12 lg:col-span-8 p-4 space-y-4 border-r border-slate-200">
            {needsBatch && (
              <div className="text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2">
                Batch number and expiry date are required for medicine — they are what make a recall or an expiry claim against the distributor possible.
              </div>
            )}

            <div>
              <SectionHead n="1" title="Batch & expiry registration" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="Quantity *" hint={receivedBase > 0 ? `= ${receivedBase.toLocaleString()} ${product.unit || 'unit'}${receivedBase === 1 ? '' : 's'} into stock` : `entered per ${uomName}`}>
                  <input type="number" min="1" className={NUM} value={f.quantity} onChange={set('quantity')} autoFocus placeholder="0" />
                </Field>
                <Field label="Received as" hint={perStrip > 1 ? `1 box = ${product.strips_per_box || 1} strips = ${perBox} ${product.unit || 'unit'}s` : null}>
                  <Select value={f.uom} onChange={set('uom')}>
                    <option value="unit">{product.unit || 'unit'} (loose)</option>
                    {perStrip > 1 && <option value="strip">strip ({perStrip} {product.unit || 'unit'})</option>}
                    {perBox > perStrip && <option value="box">box ({perBox} {product.unit || 'unit'})</option>}
                  </Select>
                </Field>
                <Field label={`Batch no ${needsBatch ? '*' : ''}`} hint="stamped on box & blister foil">
                  <input className={`${CTL} font-mono`} value={f.batch_no} onChange={set('batch_no')} placeholder="e.g. B-9921" />
                </Field>
                <Field label={`Expiry date ${needsBatch ? '*' : ''}`}
                  hint={shelfLife == null ? 'as printed' : expiryBad ? 'already expired — cannot be received' : expiryFar ? 'more than ten years away — check the year' : shelfLife <= 180 ? `${shelfLife} days of shelf life — short` : `${Math.round(shelfLife / 30)} months of shelf life`}>
                  <input type="date" min={today} max={maxExpiry} aria-label="Expiry date" className={`${CTL} font-mono ${expiryBad || expiryFar ? '!border-rose-500' : ''}`} value={f.expiry_date} onChange={set('expiry_date')} />
                </Field>
              </div>
            </div>

            <div>
              <SectionHead n="2" title="Pricing & distributor margin" sub="stored per base unit, entered per pack" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Field label={`Trade price per ${uomName}`} hint={costUnit != null ? `= ${money(costUnit)} per ${product.unit || 'unit'}` : 'ex-tax invoice cost'}>
                  <div className="relative"><span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-slate-500 font-mono">Rs</span>
                    <input type="number" step="0.01" min="0" className={`${NUM} pl-7`} value={f.cost_price} onChange={set('cost_price')} placeholder="0.00" /></div>
                </Field>
                <Field label={`MRP per ${uomName}`} hint={mrpUnit != null ? `= ${money(mrpUnit)} per ${product.unit || 'unit'}` : product.mrp > 0 ? `master MRP ${money(product.mrp * unitsIn(f.uom))} per ${uomName}` : 'as printed on the pack'}>
                  <div className="relative"><span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-slate-500 font-mono">Rs</span>
                    <input type="number" step="0.01" min="0" className={`${NUM} pl-7 ${overMrp ? '!border-rose-500' : ''}`} value={f.mrp} onChange={set('mrp')} placeholder="as printed" /></div>
                </Field>
                <div className="col-span-2 grid grid-cols-3 gap-2">
                  <Mini label="Batch cost" value={money(batchCost)} />
                  <Mini label="Retail yield" value={money(retailYield)} sub={`@ ${money(product.sale_price)}/${product.unit || 'unit'}`} />
                  <Mini label="Pharmacy margin" value={margin == null ? '—' : money(margin)} tone={margin == null ? '' : margin < 0 ? 'text-rose-700' : 'text-emerald-700'}
                    sub={margin != null && batchCost > 0 ? `${Math.round((margin / batchCost) * 100)}% on cost` : null} />
                </div>
              </div>
              {problem && <div className="text-[11px] text-rose-800 mt-1.5">{problem}</div>}
            </div>

            <div>
              <SectionHead n="3" title="Vendor & traceability" sub="chain of custody" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Field label="Manufacturer"><input className={CTL} value={f.manufacturer} onChange={set('manufacturer')} placeholder="as printed on the pack" /></Field>
                <Field label="Supplier / distributor" hint={vendor ? 'the batch is tied to this supplier for any expiry claim' : 'not recorded — no supplier claim will be possible'}>
                  <Select value={f.vendor_id} onChange={set('vendor_id')}>
                    <option value="">— Not recorded —</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </Select>
                </Field>
                <Field label="Delivery challan / invoice no" hint="written on the stock movement"><input className={`${CTL} font-mono`} value={f.reference} onChange={set('reference')} placeholder="e.g. DC-2026-8819" /></Field>
              </div>
            </div>

            <div className="flex items-center gap-1.5 pt-1">
              <button type="button" className={`${BTN_GO} flex-1`} onClick={save} disabled={!complete || busy || !!problem} title={problem || undefined}>
                <span className="inline-flex items-center gap-1.5"><Icon name="check" size={14} /> {busy ? 'Receiving…' : 'Receive into stock'}</span>
                <kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
              </button>
              <button type="button" className={`${BTN} h-9`} onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
            </div>
          </div>

          {/* GRN preview */}
          <div className="col-span-12 lg:col-span-4 p-4 bg-slate-50 space-y-3">
            <div className="bg-white border border-slate-300 rounded p-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">GRN preview</span>
                <span className="text-[10px] font-mono text-slate-500">on receipt</span>
              </div>
              <dl className="text-[11px] space-y-1">
                <Row k="Item" v={`${product.name}${product.strength ? ` ${product.strength}` : ''}`} />
                <Row k="Form" v={[product.form, product.generic_name].filter(Boolean).join(' · ') || '—'} />
                <Row k="DRAP reg" v={product.drap_reg_no || (product.drug_schedule !== 'OTC' ? 'missing' : '—')} tone={!product.drap_reg_no && product.drug_schedule !== 'OTC' ? 'text-amber-700' : ''} mono />
                <div className="border-t border-dashed border-slate-200 my-1" />
                <Row k="Current stock on shelf" v={`${product.on_hand.toLocaleString()} ${product.unit || 'unit'}`} mono />
                <Row k="(+) Incoming" v={`${receivedBase.toLocaleString()} ${product.unit || 'unit'}`} mono tone="text-emerald-700" />
                <Row k="New physical balance" v={`${(product.on_hand + receivedBase).toLocaleString()} ${product.unit || 'unit'}`} mono strong />
                <div className="border-t border-dashed border-slate-200 my-1" />
                <Row k="Batch" v={f.batch_no || '—'} mono />
                <Row k="Expiry" v={f.expiry_date || '—'} mono tone={expiryBad || expiryFar ? 'text-rose-700 font-bold' : ''} />
                <Row k="Invoice payable" v={money(batchCost)} mono strong />
                <Row k="Supplier" v={vendor?.name || '—'} />
                <Row k="Challan" v={f.reference || '—'} mono />
              </dl>
            </div>
            {problem && <div className="text-[11px] text-rose-900 bg-rose-50 border border-rose-300 rounded px-3 py-2"><b>Cannot receive.</b> {problem}</div>}
            <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Icon name="shield" size={12} /> Received by <b>{user?.full_name}</b> — recorded on the stock movement with the batch.</div>

            <div className="bg-white border border-slate-300 rounded p-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Historical batches</span>
                <span className="text-[10px] font-mono text-slate-500">last 3 intakes</span>
              </div>
              {history.length === 0 ? <div className="text-[11px] text-slate-500 py-1">No batch has been received yet.</div> : (
                [...history].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at))).slice(0, 3).map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 py-1 text-[11px] border-b border-slate-100 last:border-b-0">
                    <div>
                      <div className="font-mono font-semibold text-slate-800">{b.batch_no || '—'}</div>
                      <div className="text-[10px] text-slate-500 font-mono">rcvd {String(b.received_at || '').slice(0, 10)} · exp {b.expiry_date || '—'} · @ {money(b.cost_price)}</div>
                    </div>
                    <Tag tone={b.quantity > 0 ? 'green' : 'gray'}>{b.quantity > 0 ? `active · ${b.quantity} left` : 'depleted'}</Tag>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, tone = '' }) {
  return (
    <div className="border border-slate-200 rounded px-2 py-1.5 bg-white">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono font-bold text-xs ${tone || 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Row({ k, v, mono, strong, tone = '' }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
      <dt className="shrink-0">{k}</dt><dd className={`m-0 text-right truncate ${mono ? 'font-mono' : ''} ${tone}`}>{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 07 — the medicine master
//
// The fields below "Regulatory" are what makes a medicine legal to stock and
// sell in Pakistan: a DRAP registration number, the notified maximum retail
// price, and the schedule that decides whether it may be handed over without a
// prescription.
// ---------------------------------------------------------------------------
function ProductModal({ product, batches, onClose, onDone, onErr }) {
  const editing = !!product;
  const [f, setF] = useState({
    name: product?.name || '',
    sku: product?.sku || '',
    generic_name: product?.generic_name || '',
    strength: product?.strength || '',
    form: product?.form || 'Tablet',
    unit: product?.unit || 'unit',
    units_per_strip: product?.units_per_strip || 1,
    strips_per_box: product?.strips_per_box || 1,
    allow_loose: product?.allow_loose == null ? true : !!product.allow_loose,
    product_type_id: product?.product_type_id || '',
    manufacturer_id: product?.manufacturer_id || '',
    manufacturer: product?.manufacturer || '',
    barcode: product?.barcode || '',
    drap_reg_no: product?.drap_reg_no || '',
    drug_schedule: product?.drug_schedule || 'OTC',
    mrp: product?.mrp ?? '',
    sale_price: product?.sale_price ?? '',
    reorder_level: product?.reorder_level ?? 10,
    is_refrigerated: !!product?.is_refrigerated,
  });
  const set = (k) => (e) => { setDirty(true); setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); };
  const [busy, setBusy] = useState(false);

  const price = Number(f.sale_price || 0);
  const mrp = f.mrp === '' ? null : Number(f.mrp);
  const overMrp = mrp != null && mrp > 0 && price > mrp;
  const needsDrap = f.drug_schedule !== 'OTC' && !f.drap_reg_no.trim();

  // Packaging. Prices are held per base unit; the strip and box figures are
  // shown so the pharmacist can check them against the printed pack.
  const perStrip = Number(f.units_per_strip) > 0 ? Math.floor(Number(f.units_per_strip)) : 1;
  const perBox = Number(f.strips_per_box) > 0 ? Math.floor(Number(f.strips_per_box)) : 1;
  const unitsPerBox = perStrip * perBox;

  // Whichever of the three boxes you type in rewrites the stored per-unit
  // price, so box, strip and tablet can never disagree — there is only ever one
  // number.
  const setStripPrice = (v) => setF({ ...f, sale_price: perStrip > 0 ? r2(Number(v || 0) / perStrip) : Number(v || 0) });
  const setStripMrp = (v) => setF({ ...f, mrp: perStrip > 0 ? r2(Number(v || 0) / perStrip) : Number(v || 0) });
  const setBoxPrice = (v) => setF({ ...f, sale_price: unitsPerBox > 0 ? Number(v || 0) / unitsPerBox : Number(v || 0) });
  const setBoxMrp = (v) => setF({ ...f, mrp: unitsPerBox > 0 ? Number(v || 0) / unitsPerBox : Number(v || 0) });

  // The managed lists. Dosage form decides whether a batch and expiry are
  // required on receipt; the company decides whose row the margin report lands in.
  const [types, setTypes] = useState([]);
  const [makers, setMakers] = useState([]);
  const [units, setUnits] = useState([]);
  const [newMaker, setNewMaker] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [shelf, setShelf] = useState(batches || []);
  useEffect(() => {
    api.get('/inventory/product-types').then(setTypes).catch(() => {});
    api.get('/inventory/manufacturers').then(setMakers).catch(() => {});
    api.get('/inventory/base-units').then(setUnits).catch(() => {});
    if (editing && !batches) api.get(`/inventory/products/${product.id}/batches`).then(setShelf).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing the dosage form suggests its unit, but only while the field is
  // still the meaningless schema default.
  const pickType = (e) => {
    const id = e.target.value;
    const t = types.find((x) => String(x.id) === String(id));
    const untouched = !f.unit || f.unit === 'unit';
    setF({ ...f, product_type_id: id, unit: untouched && t?.default_unit ? t.default_unit : f.unit });
  };
  const type = types.find((x) => String(x.id) === String(f.product_type_id));
  const valid = !!f.name && !!f.product_type_id && !!f.unit && !overMrp && !needsDrap;

  const save = useCallback(async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body = {
        ...f,
        sale_price: price,
        mrp: f.mrp === '' ? null : mrp,
        units_per_strip: perStrip,
        strips_per_box: perBox,
        allow_loose: f.allow_loose ? 1 : 0,
        reorder_level: Number(f.reorder_level),
        product_type_id: f.product_type_id || null,
        // An id when picked from the list; a name when it is a new company,
        // which the server creates rather than dropping on the floor.
        manufacturer_id: f.manufacturer_id || null,
        manufacturer: f.manufacturer_id ? undefined : (f.manufacturer || null),
      };
      delete body.form;
      if (editing) await api.put(`/inventory/products/${product.id}`, body);
      else await api.post('/inventory/products', body);
      onDone(`Product "${f.name}" ${editing ? 'updated' : 'created'}.`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [valid, busy, f, price, mrp, perStrip, perBox, editing, product, onDone, onErr]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F9') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [save, onClose]);

  // Checks satisfied by a DEFAULT show as neutral until the form has been
  // touched (UI report 6.1): a checklist that starts half green says nothing.
  const [dirty, setDirty] = useState(!!editing);
  const checks = [
    ['Brand name', !!f.name, false],
    ['Dosage form & base unit', !!f.product_type_id && !!f.unit, false],
    [f.drug_schedule === 'OTC' ? 'Schedule (general sale)' : 'Schedule + DRAP registration', !needsDrap, true],
    ['Packaging valid', perStrip >= 1 && perBox >= 1, true],
    ['Selling price at or under MRP', !overMrp && price > 0, false],
    ['Reorder level set', Number(f.reorder_level) > 0, true],
  ].map(([label, okay, defaulted]) => [label, okay, defaulted && !dirty]);
  const live = shelf.filter((b) => b.quantity > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !max-w-6xl !rounded-md !p-0 text-slate-800 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Medicine master &amp; DRAP formulary specification</div>
            <div className="text-sm font-bold text-slate-900">{editing ? `Edit — ${product.name}` : 'New medicine'}</div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <button type="button" className={BTN} onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
            <button type="button" className={`${BTN_GO} h-8`} onClick={save} disabled={!valid || busy}>
              <span>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save medicine master'}</span>
              <kbd className="kbd-hint bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-[10px] border border-emerald-600">F9</kbd>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 flex-1 min-h-0 overflow-y-auto lg:overflow-visible">
          <div className="col-span-12 lg:col-span-8 p-4 space-y-4 lg:border-r border-slate-200 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
            <div>
              <SectionHead n="1" title="Brand & clinical identification" right={<span className="text-[10px] text-slate-500">* required</span>} />
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="Brand name *" hint="as registered on the packaging" className="sm:col-span-2">
                  <input className={CTL} value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Augmentin, Panadol, Amoxil" />
                </Field>
                <Field label="Generic name (active ingredient)" className="sm:col-span-2"><input className={CTL} value={f.generic_name} onChange={set('generic_name')} placeholder="e.g. Amoxicillin Trihydrate" /></Field>
                <Field label="Strength / dosage"><input className={CTL} value={f.strength} onChange={set('strength')} placeholder="e.g. 500mg, 125mg/5ml" /></Field>
                <Field label="Dosage form *" hint={type ? (type.is_medicine ? 'medicine — batch & expiry required on receipt' : 'sundry — may be received without a batch') : null}>
                  <Select value={f.product_type_id} onChange={pickType}>
                    <option value="">Choose…</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                <Field label="Base unit *" hint="the smallest thing sold">
                  <Select value={newUnit ? '__new' : f.unit}
                    onChange={(e) => {
                      if (e.target.value === '__new') { setNewUnit(' '); setF({ ...f, unit: '' }); }
                      else { setNewUnit(''); setF({ ...f, unit: e.target.value }); }
                    }}>
                    <option value="">Choose…</option>
                    {units.map((u) => <option key={u.id} value={u.name}>{u.name} — {u.descr}</option>)}
                    <option value="__new">+ New unit…</option>
                  </Select>
                </Field>
                {newUnit !== '' && (
                  <Field label="New unit name"><input className={CTL} value={f.unit} onChange={set('unit')} autoFocus placeholder="short, e.g. patch" /></Field>
                )}
                <Field label="Internal SKU code"><input className={`${CTL} font-mono`} value={f.sku} onChange={set('sku')} placeholder="e.g. MED-AMOX-500" /></Field>
                <Field label="Barcode (EAN-13)"><input className={`${CTL} font-mono`} value={f.barcode} onChange={set('barcode')} placeholder="scan the pack" /></Field>
              </div>
            </div>

            <div>
              <SectionHead n="2" title="Packaging" sub="how the medicine is boxed" />
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                <Field label={`${f.unit || 'Units'} per strip`} hint="sealed within one blister strip"><input type="number" min="1" className={NUM} value={f.units_per_strip} onChange={set('units_per_strip')} /></Field>
                <Field label="Strips per box" hint="packed in one carton"><input type="number" min="1" className={NUM} value={f.strips_per_box} onChange={set('strips_per_box')} /></Field>
                <div className="sm:col-span-2 text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2">
                  One box = <b>{perBox} strip{perBox === 1 ? '' : 's'}</b> = <b>{unitsPerBox} {f.unit || 'unit'}{unitsPerBox === 1 ? '' : 's'}</b>.
                  Stock is counted in {f.unit || 'unit'}s, so any of the three can be sold from the same shelf.
                </div>
              </div>
              {perStrip > 1 && (
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-2 cursor-pointer">
                  <input type="checkbox" checked={f.allow_loose} onChange={set('allow_loose')} />
                  Strip may be broken for loose sale — untick for a course that must be sold whole
                </label>
              )}
            </div>

            <div>
              <SectionHead n="3" title="Regulatory" sub="DRAP compliance" />
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                <Field label="Drug schedule *" hint={f.drug_schedule === 'Narcotic' ? 'register entry with CNIC at every sale' : f.drug_schedule === 'G' ? 'prescriber recorded at every sale' : f.drug_schedule === 'Rx' ? 'prescription reference at checkout' : 'sold without a prescription'} className="sm:col-span-2">
                  <Select value={f.drug_schedule} onChange={set('drug_schedule')}>
                    <option value="OTC">OTC — general sale</option>
                    <option value="Rx">Rx — prescription only</option>
                    <option value="G">Schedule G — under medical supervision</option>
                    <option value="Narcotic">Controlled drug — register entry required</option>
                  </Select>
                </Field>
                <Field label={`DRAP registration no ${f.drug_schedule !== 'OTC' ? '*' : ''}`} hint="Drug Regulatory Authority of Pakistan" className="sm:col-span-2">
                  <input className={`${CTL} font-mono ${needsDrap ? '!border-amber-500' : ''}`} value={f.drap_reg_no} onChange={set('drap_reg_no')} placeholder="e.g. 012345" />
                </Field>
                <Field label="Manufacturer" className="sm:col-span-2">
                  <Select value={f.manufacturer_id === '' && newMaker ? '__new' : f.manufacturer_id}
                    onChange={(e) => {
                      if (e.target.value === '__new') { setF({ ...f, manufacturer_id: '' }); setNewMaker(' '); }
                      else { setNewMaker(''); setF({ ...f, manufacturer_id: e.target.value, manufacturer: '' }); }
                    }}>
                    <option value="">— none —</option>
                    {makers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    <option value="__new">+ New company…</option>
                  </Select>
                </Field>
                {newMaker !== '' && (
                  <Field label="New company name" className="sm:col-span-2"><input className={CTL} value={f.manufacturer} onChange={set('manufacturer')} autoFocus placeholder="exactly as printed on the pack" /></Field>
                )}
                <label className="sm:col-span-2 md:col-span-4 inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={f.is_refrigerated} onChange={set('is_refrigerated')} />
                  Cold chain — must be stored at 2–8 °C (flagged at receipt, on the shelf and at the counter)
                </label>
              </div>
            </div>

            <div>
              <SectionHead n="4" title="Pricing & reorder" sub="one stored price per base unit; type whichever pack you read" />
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                <Field label={`MRP per ${f.unit || 'unit'}`} hint="notified maximum retail">
                  <input type="number" step="0.01" min="0" className={NUM} value={f.mrp} onChange={set('mrp')} placeholder="0.00" />
                </Field>
                <Field label={`Selling price per ${f.unit || 'unit'}`} hint={overMrp ? 'above MRP — not permitted' : 'what the counter charges'}>
                  <input type="number" step="0.01" min="0" className={`${NUM} ${overMrp ? '!border-rose-500' : ''}`} value={f.sale_price} onChange={set('sale_price')} placeholder="0.00" />
                </Field>
                {perStrip > 1 && (
                  <>
                    <Field label="MRP per strip" hint="printed on the pack">
                      <input type="number" step="0.01" min="0" className={NUM} value={mrp != null ? r2(mrp * perStrip) : ''} onChange={(e) => setStripMrp(e.target.value)} />
                    </Field>
                    <Field label="Selling price per strip">
                      <input type="number" step="0.01" min="0" className={NUM} value={r2(price * perStrip)} onChange={(e) => setStripPrice(e.target.value)} />
                    </Field>
                  </>
                )}
                {unitsPerBox > perStrip && (
                  <>
                    <Field label="MRP per box" hint="printed on the carton">
                      <input type="number" step="0.01" min="0" className={NUM} value={mrp != null ? r2(mrp * unitsPerBox) : ''} onChange={(e) => setBoxMrp(e.target.value)} />
                    </Field>
                    <Field label="Selling price per box">
                      <input type="number" step="0.01" min="0" className={NUM} value={r2(price * unitsPerBox)} onChange={(e) => setBoxPrice(e.target.value)} />
                    </Field>
                  </>
                )}
                <Field label="Reorder level" hint={`in ${f.unit || 'unit'}s — alerts when stock reaches it`}>
                  <input type="number" min="0" className={NUM} value={f.reorder_level} onChange={set('reorder_level')} />
                </Field>
              </div>
              {overMrp && <div className="text-[11px] text-rose-800 mt-1.5">Selling price is above the maximum retail price. Selling a medicine above its notified MRP is not permitted.</div>}
              {needsDrap && <div className="text-[11px] text-amber-800 mt-1.5">Prescription medicine needs its DRAP registration number recorded.</div>}
            </div>
          </div>

          {/* Live preview + checklist */}
          <div className="col-span-12 lg:col-span-4 p-4 bg-slate-50 space-y-3 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
            <div className="bg-white border border-slate-300 rounded p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-200 pb-1.5 mb-2">Live POS item presentation</div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 text-sm truncate">{f.name || 'Brand name'} <span className="text-slate-500 font-normal">{f.strength}</span></div>
                  <div className="text-[11px] text-slate-500 truncate">{[f.generic_name, type?.name].filter(Boolean).join(' • ') || 'generic • form'}</div>
                  <div className="flex items-center gap-1 mt-1">
                    <Tag tone={{ OTC: 'gray', Rx: 'blue', G: 'amber', Narcotic: 'red' }[f.drug_schedule]}>{SCHEDULE_LABEL[f.drug_schedule]}</Tag>
                    {f.is_refrigerated && <Tag tone="blue">2–8 °C</Tag>}
                    {f.drap_reg_no ? <Tag tone="green">DRAP {f.drap_reg_no}</Tag> : null}
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div className="font-bold text-slate-900">{money(price)}<span className="text-[10px] text-slate-500 font-normal">/{f.unit || 'unit'}</span></div>
                  {perStrip > 1 && <div className="text-[10px] text-slate-600">{money(r2(price * perStrip))}/strip</div>}
                  {unitsPerBox > perStrip && <div className="text-[10px] text-slate-600">{money(r2(price * unitsPerBox))}/box</div>}
                  <div className="text-[10px] text-slate-500">MRP {mrp != null && mrp > 0 ? money(mrp) : '—'}</div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-[10px] text-slate-500 font-mono">
                {f.sku || 'SKU —'} • {f.barcode || 'no barcode'}{editing ? ` • ${product.on_hand.toLocaleString()} ${f.unit || 'unit'} on shelf` : ''}
              </div>
            </div>

            <div className="bg-white border border-slate-300 rounded p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 border-b border-slate-200 pb-1.5 mb-2">DRAP Form 12 validation</div>
              <ul className="m-0 p-0 list-none space-y-1">
                {checks.map(([label, okay, neutral]) => (
                  <li key={label} className={`flex items-center gap-2 text-[11px] ${neutral ? 'text-slate-400' : okay ? 'text-emerald-800' : 'text-slate-500'}`} title={neutral ? 'Using the default — confirm it' : undefined}>
                    <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold border ${neutral ? 'bg-slate-50 border-slate-200 text-slate-400' : okay ? 'bg-emerald-100 border-emerald-300' : 'bg-white border-slate-300'}`}>{neutral ? '○' : okay ? '✓' : '·'}</span>
                    {label}{neutral && <span className="text-[10px] text-slate-400">default</span>}
                  </li>
                ))}
              </ul>
            </div>

            {editing && (
              <div className="bg-white border border-slate-300 rounded p-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Active batches on shelf</span>
                  <span className="text-[10px] font-mono text-slate-500">{live.length}</span>
                </div>
                {live.length === 0 ? <div className="text-[11px] text-slate-500 py-1">No stock in any batch.</div> : live.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 py-1 text-[11px] border-b border-slate-100 last:border-b-0">
                    <span className="font-mono text-slate-800">{b.batch_no || '—'} <span className="text-slate-500">exp {b.expiry_date || '—'}</span></span>
                    <span className="font-mono font-bold">{b.quantity.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sm:hidden shrink-0 bg-white border-t border-slate-200 p-3 flex gap-2">
          <button type="button" className={`${BTN} flex-1 justify-center`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${BTN_GO} flex-1`} onClick={save} disabled={!valid || busy}>
            <span>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save medicine master'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
