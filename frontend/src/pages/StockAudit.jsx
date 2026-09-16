import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { printPaper } from '../print.js';
import { BTN, BTN_PRIMARY, BTN_SM, CTL, NUM, PageHead, Notice, Kpi, Card, Pill, Chips, Search, Tbl, Empty, Bar } from '../components/ws/admin.jsx';

// Physical stock audit — Phase 10, screen
// `physical_stock_audit_cycle_count_stock_adjustment_workstation`.
//
// The one management workstation that had a route and no screen:
// POST /inventory/products/:id/adjust (per batch, signed quantity, reason)
// existed since Phase 02 with nothing calling it. This is the count sheet in
// front of it: pick a medicine, count each batch, post the variances.
//
// Counts live in this browser until posted — there is no cycle-count table,
// and the mockup's blind-count sessions, zones and second-pharmacist sign-off
// are not modelled. What IS posted is real: a signed stock movement per batch
// with the reason, and the audit log entry the route already writes.

export default function StockAudit() {
  const { can, user } = useAuth();
  const [products, setProducts] = useState([]);
  const [dash, setDash] = useState(null);
  const [q, setQ] = useState('');
  const [pill, setPill] = useState('all');
  const [sel, setSel] = useState(null);
  const [batches, setBatches] = useState([]);
  const [counts, setCounts] = useState({});        // batch id -> counted qty (string)
  const [reason, setReason] = useState('');
  const [posted, setPosted] = useState([]);          // this session's posted adjustments
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);

  const load = useCallback((term = q) => {
    const qs = term.trim().length >= 2 ? `?q=${encodeURIComponent(term.trim())}` : '';
    api.get(`/inventory/products${qs}`).then(setProducts).catch((e) => setErr(e.message));
    api.get('/pharmacy/dashboard').then(setDash).catch(() => setDash(null));
  }, [q]);
  useEffect(() => { const id = setTimeout(() => load(q), 250); return () => clearTimeout(id); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.addEventListener('hwt:refresh', () => load()); return () => window.removeEventListener('hwt:refresh', () => load()); }, [load]);

  const open = useCallback((p) => {
    setSel(p); setCounts({}); setReason('');
    api.get(`/inventory/products/${p.id}/batches`).then((bs) => setBatches(bs.filter((b) => b.quantity > 0 || b.quarantined))).catch(() => setBatches([]));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); post(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const variances = useMemo(() => batches.map((b) => {
    const c = counts[b.id];
    const counted = c === undefined || c === '' ? null : Number(c);
    return { b, counted, delta: counted == null ? null : counted - b.quantity };
  }), [batches, counts]);
  const changed = variances.filter((v) => v.delta != null && v.delta !== 0);
  const matched = variances.filter((v) => v.delta === 0).length;
  const sessionVar = posted.reduce((t, p) => t + p.delta * p.cost, 0);

  async function post() {
    if (!sel || !changed.length || busy || !can('inventory.manage')) return;
    if (!reason.trim()) { setErr('Give the reason for the adjustment — it is written on every movement.'); return; }
    setBusy(true); setErr('');
    try {
      for (const v of changed) {
        await api.post(`/inventory/products/${sel.id}/adjust`, { batch_id: v.b.id, quantity: v.delta, reason: reason.trim(), type: 'adjust' });
        setPosted((ps) => [{ product: sel.name, batch: v.b.batch_no, delta: v.delta, cost: v.b.cost_price, at: new Date() }, ...ps]);
      }
      setMsg(`${changed.length} adjustment${changed.length === 1 ? '' : 's'} posted for ${sel.name}.`);
      open(sel); load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const rows = products.filter((p) => pill === 'all' ? true : pill === 'controlled' ? (p.drug_schedule === 'G' || p.drug_schedule === 'Narcotic') : pill === 'low' ? p.on_hand <= p.reorder_level : pill === 'value' ? p.on_hand * p.sale_price >= 10000 : true);
  const st = dash?.stock;

  return (
    <>
      <PageHead title="Physical Stock Audit, Cycle Count & Stock Adjustment" sub="Count what is on the shelf against what the ledger says, batch by batch, and post the difference as a signed movement with a reason."
        chip={<Pill tone="sky" mono>FEFO batch ledger</Pill>}
        right={<>
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Print discrepancy sheet</button>
          {can('inventory.manage') && <button type="button" className={BTN_PRIMARY} onClick={post} disabled={!changed.length || busy}><Icon name="check" size={14} /> Post adjustments <kbd className="kbd-hint text-[10px] font-mono bg-blue-800/60 px-1.5 py-0.5 rounded border border-blue-300/40">F9</kbd></button>}
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Total formulary value" value={money(st?.value_at_cost || 0)} icon="billing" sub={st ? `${st.skus} registered SKUs · at retail ${money(st.value_at_retail)}` : ''} />
        <Kpi label="Counted this session" value={posted.length} unit="adjustments" tone="sky" icon="check" sub={posted.length ? `last: ${posted[0].product}` : 'nothing posted yet'} />
        <Kpi label="Discrepancy variance (session)" value={`${sessionVar < 0 ? '− ' : '+ '}${money(Math.abs(sessionVar))}`} tone={sessionVar < 0 ? 'rose' : sessionVar > 0 ? 'amber' : 'emerald'} icon="trend" sub="at batch cost, posted this session" />
        <Kpi label="Quarantined batches" value={st?.quarantined_batches ?? '—'} unit="batches" tone={st?.quarantined_batches ? 'amber' : 'emerald'} icon="warning" sub={st ? `${money(st.quarantined_value)} held off the shelf` : ''} />
      </div>

      <Card>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[280px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Icon name="search" size={15} /></div>
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} className={`${CTL} pl-9 pr-16`} placeholder="Search by molecule, brand, batch or DRAP reg… [Ctrl+F]" />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center"><span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">Ctrl+F</span></div>
          </div>
          <Chips value={pill} onChange={setPill} items={[['all', 'All medicines', products.length], ['low', 'At or under reorder', products.filter((p) => p.on_hand <= p.reorder_level).length], ['controlled', 'High-value / controlled', products.filter((p) => p.drug_schedule === 'G' || p.drug_schedule === 'Narcotic').length], ['value', 'Shelf value ≥ Rs 10,000', products.filter((p) => p.on_hand * p.sale_price >= 10000).length]]} />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <Card className="xl:col-span-7" flush title="Active Formulary Audit Roster" sub="Pick a medicine to count its batches" right={<Pill tone="navy" mono>FIRST EXPIRED FIRST OUT</Pill>}>
          <Tbl stack head={['SKU / molecule & brand', 'Schedule', 'Ledger stock', 'Reorder', 'Shelf value', 'Status']} right={[2, 3, 4]}>
            {rows.map((p) => (
              <tr key={p.id} onClick={() => open(p)} className={`cursor-pointer ${sel?.id === p.id ? '!bg-blue-50/60' : ''}`}>
                <td><div className="font-bold text-[#0284c7]">{p.name}{p.strength ? <span className="text-slate-500 font-normal"> {p.strength}</span> : null}</div><div className="text-[11px] text-slate-500">{[p.generic_name, p.manufacturer, p.drap_reg_no ? `DRAP ${p.drap_reg_no}` : null].filter(Boolean).join(' • ')}</div></td>
                <td><Pill tone={p.drug_schedule === 'Narcotic' || p.drug_schedule === 'G' ? 'rose' : p.drug_schedule === 'Rx' ? 'sky' : 'slate'}>{p.drug_schedule || 'OTC'}</Pill></td>
                <td className="text-right font-mono font-bold">{p.on_hand.toLocaleString()} <span className="text-slate-500 font-normal">{p.unit}</span></td>
                <td className="text-right font-mono text-slate-600">{p.reorder_level}</td>
                <td className="text-right font-mono">{money(p.on_hand * p.sale_price)}</td>
                <td>{posted.some((x) => x.product === p.name) ? <Pill tone="emerald">ADJUSTED</Pill> : sel?.id === p.id ? <Pill tone="sky">COUNTING</Pill> : <Pill tone="slate">NOT COUNTED</Pill>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}><Empty>No medicine matches.</Empty></td></tr>}
          </Tbl>
          <div className="px-5 py-2.5 border-t border-slate-200 text-[11px] text-slate-500">Showing {rows.length} of {products.length}{products.length >= 100 ? ' — type to search the rest' : ''}</div>
        </Card>

        <div className="xl:col-span-5 space-y-4">
          {sel ? (
            <Card flush title="Selected item audit dossier" right={changed.length ? <Pill tone="rose">{changed.length} variance{changed.length === 1 ? '' : 's'}</Pill> : matched ? <Pill tone="emerald">matched</Pill> : null}>
              <div className="px-5 py-4 border-b border-slate-200">
                <div className="text-lg font-extrabold text-[#0b1f3d] font-headline">{sel.name} {sel.strength}</div>
                <div className="text-xs text-slate-500">{[sel.generic_name, sel.manufacturer].filter(Boolean).join(' • ')} · ledger {sel.on_hand.toLocaleString()} {sel.unit}</div>
              </div>
              <div className="divide-y divide-slate-100">
                {variances.map(({ b, counted, delta }) => (
                  <div key={b.id} className={`px-5 py-3 ${b.quarantined ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-mono font-bold text-sm text-slate-900">{b.batch_no || `batch #${b.id}`} {b.quarantined ? <Pill tone="amber">quarantined</Pill> : null}</div>
                        <div className="text-[11px] text-slate-500 font-mono">exp {b.expiry_date || '—'} · cost {money(b.cost_price)}{b.vendor_name ? ` · ${b.vendor_name}` : ''}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded border border-slate-200 px-2 py-1"><div className="text-[9px] font-bold uppercase text-slate-500">Ledger</div><div className="font-mono font-bold">{b.quantity}</div></div>
                        <div className="rounded border border-[#0284c7] px-1 py-1"><div className="text-[9px] font-bold uppercase text-[#0284c7]">Counted</div><input type="number" min="0" value={counts[b.id] ?? ''} placeholder={String(b.quantity)} onChange={(e) => setCounts({ ...counts, [b.id]: e.target.value })} className="w-16 h-6 min-h-0 p-0 text-center font-mono font-bold text-xs border-0 focus:ring-0" /></div>
                        <div className={`rounded border px-2 py-1 ${delta == null ? 'border-slate-200' : delta === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}><div className="text-[9px] font-bold uppercase text-slate-500">Variance</div><div className={`font-mono font-bold ${delta == null ? 'text-slate-400' : delta === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta == null ? '—' : delta > 0 ? `+${delta}` : delta}</div></div>
                      </div>
                    </div>
                    {delta != null && delta !== 0 && <div className="text-[11px] text-rose-700 font-mono mt-1 text-right">{delta > 0 ? 'surplus' : 'shortage'} {money(Math.abs(delta) * b.cost_price)} at cost</div>}
                  </div>
                ))}
                {batches.length === 0 && <Empty>No batch holds stock.</Empty>}
              </div>
              <div className="px-5 py-4 border-t border-slate-200 space-y-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Root cause / reason (written on every movement)</div>
                  <input className={CTL} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 1 pack damaged blister, counter-02 · recount by second pharmacist" />
                </div>
                <div className="text-[11px] text-slate-500">Counted by <b>{user?.full_name}</b>. Posting writes a signed stock movement per batch and an audit-log entry; the ledger figure moves to the counted one.</div>
                {can('inventory.manage') && (
                  <button type="button" onClick={post} disabled={!changed.length || busy} className="w-full py-2.5 px-3 bg-[#0b1f3d] hover:bg-[#122e54] disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-md font-bold text-sm flex items-center justify-between">
                    <span className="inline-flex items-center gap-2"><Icon name="check" size={15} /> {busy ? 'Posting…' : 'Post stock adjustment & commit ledger'}</span>
                    <kbd className="kbd-hint bg-white/15 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-white/30">F9</kbd>
                  </button>
                )}
              </div>
            </Card>
          ) : (
            <div className="bg-white rounded-lg border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500"><Icon name="box" size={22} /><div className="mt-2 font-semibold text-slate-700">No item under audit</div><div className="mt-1">Pick a medicine from the roster to count its batches.</div></div>
          )}

          <Card flush title="Adjustments posted this session" right={<Pill tone="slate">{posted.length}</Pill>}>
            <Tbl stack head={['When', 'Medicine', 'Batch', 'Δ', 'At cost']} right={[3, 4]} dense>
              {posted.map((p, i) => <tr key={i}><td className="font-mono">{p.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td><td className="font-semibold">{p.product}</td><td className="font-mono">{p.batch || '—'}</td><td className={`text-right font-mono font-bold ${p.delta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{p.delta > 0 ? `+${p.delta}` : p.delta}</td><td className="text-right font-mono">{money(p.delta * p.cost)}</td></tr>)}
              {posted.length === 0 && <tr><td colSpan={5}><Empty>Nothing posted yet.</Empty></td></tr>}
            </Tbl>
          </Card>
        </div>
      </div>
      <Notice tone="amber" title="What is and is not recorded">Every posted line is a real stock movement with your name, the batch and the reason, visible in the movement ledger and the audit log. Blind-count sessions, audit zones and a second pharmacist's sign-off are not modelled — the count sheet is this screen, printed.</Notice>
    </>
  );
}
