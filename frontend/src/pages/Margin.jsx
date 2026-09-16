import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { printPaper } from '../print.js';
import { Alert, money } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { BTN, BTN_PRIMARY, CTL, PageHead, Kpi, Card, Pill, Tbl, Empty } from '../components/ws/admin.jsx';
import { downloadCSV } from './Reports.jsx';

// "how much company earn on their sales" — the client's words.
//
// Margin = what the counter took, minus what those goods cost the trust. Keyed
// on `cost_centre = 'COUNTER'`: dialysis consumables and department issues take
// stock off the shelf with no counter revenue behind them, and counting them
// here drives the margin negative and makes the whole report unbelievable.
// Cost comes from the batch that actually went out, not a product average.
//
// PHASE 10 — screen `category_profit_margin_analysis_report`. Same route, same
// groupings; the mockup's "regulatory SRO cap" and audit hash are not things.

const GROUPS = [['type', 'Product type'], ['manufacturer', 'Company'], ['vendor', 'Distributor'], ['product', 'Product']];
const PERIODS = [['', 'No breakdown'], ['day', 'Daily'], ['month', 'Monthly'], ['year', 'Annual']];
const BTN_DARK = 'h-9 px-3.5 bg-[#0b1f3d] hover:bg-[#122e54] text-white rounded-md font-bold inline-flex items-center gap-1.5 text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';

export default function Margin() {
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [group, setGroup] = useState('type');
  const [period, setPeriod] = useState('');
  const [fiscal, setFiscal] = useState(false);
  const [fy, setFy] = useState('');
  const [years, setYears] = useState([]);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [threshold, setThreshold] = useState('all');
  const [d, setD] = useState(null);
  const [low, setLow] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/reports/fiscal-years').then((r) => setYears(r.years || [])).catch(() => {}); }, []);
  const params = useCallback((g) => {
    const p = new URLSearchParams({ group: g });
    if (period && g === group) p.set('period', period);
    if (fiscal) p.set('fiscal', '1');
    if (fy) p.set('fy', fy); else { p.set('from', from); p.set('to', to); }
    return p;
  }, [group, period, fiscal, fy, from, to]);
  const load = useCallback(() => {
    api.get(`/reports/margin?${params(group)}`).then(setD).catch((e) => setErr(e.message));
    // The low-margin panel always reads by product, whatever the table groups by.
    api.get(`/reports/margin?${params('product')}`).then(setLow).catch(() => setLow(null));
  }, [params, group]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  const all = d?.rows || [];
  const rows = all.filter((r) => threshold === 'all' ? true : threshold === 'low' ? r.margin_pct < 15 : threshold === 'neg' ? r.margin < 0 : r.margin_pct >= 30);
  const t = d?.totals;
  const best = all.length ? all.reduce((a, r) => (r.margin_pct > a.margin_pct ? r : a), all[0]) : null;
  const lowRows = (low?.rows || []).filter((r) => r.revenue > 0).sort((a, b) => a.margin_pct - b.margin_pct).slice(0, 5);
  const cols = [['group_name', d?.group_label || 'Group'], ['bills', 'Bills'], ['units', 'Units'], ['revenue', 'Revenue'], ['cost', 'Cost'], ['margin', 'Margin'], ['margin_pct', 'Margin %']];
  const status = (r) => (r.margin < 0 ? ['rose', 'LOSS'] : r.margin_pct < 15 ? ['amber', 'THIN'] : r.margin_pct >= 30 ? ['emerald', 'HIGH YIELD'] : ['sky', 'HEALTHY']);

  return (
    <>
      <PageHead title={null} sub="Counter sales only, against the cost of the batch that actually went out. Dialysis and department issues are excluded — they have no counter revenue behind them."
        chip={<Pill tone="slate" mono>{d?.label || `${d?.from || from} → ${d?.to || to}`}</Pill>}
        right={<>
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Print / PDF</button>
          <button type="button" className={BTN_DARK} onClick={() => downloadCSV(`margin-${group}`, cols, rows)} disabled={!rows.length}><Icon name="file" size={14} /> Export CSV / Excel</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <Card>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4 items-end">
          <Lbl label="Category scope"><select className={CTL} value={group} onChange={(e) => setGroup(e.target.value)}>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Lbl>
          <Lbl label="Financial year"><select className={CTL} value={fy} onChange={(e) => setFy(e.target.value)}><option value="">Use the dates</option>{years.map((y) => <option key={y.fy} value={y.fy}>FY {y.label}</option>)}</select></Lbl>
          <Lbl label="From date"><input type="date" className={`${CTL} font-mono`} value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!fy} /></Lbl>
          <Lbl label="To date"><input type="date" className={`${CTL} font-mono`} value={to} onChange={(e) => setTo(e.target.value)} disabled={!!fy} /></Lbl>
          <Lbl label="Breakdown"><select className={CTL} value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Lbl>
          <Lbl label="Threshold"><select className={CTL} value={threshold} onChange={(e) => setThreshold(e.target.value)}><option value="all">All margins</option><option value="low">Thin (&lt; 15%)</option><option value="neg">Loss-making</option><option value="high">High yield (≥ 30%)</option></select></Lbl>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap"><input type="checkbox" className="!w-4 !h-4 accent-[#0284c7]" checked={fiscal} onChange={(e) => setFiscal(e.target.checked)} /> Fiscal years</label>
            <button type="button" className={`${BTN_PRIMARY} h-10`} onClick={load}>Run</button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-3 mb-0">Fiscal year runs from month {d?.fiscal_year_start_month || 7} — set in Settings; the trust is audited on it.</p>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Total sales turnover" value={money(t?.revenue || 0)} icon="billing" sub={t ? `${t.bills} bills · COGS ${money(t.cost)}` : ''} />
        <Kpi label="Gross profit realised" value={money(t?.margin || 0)} tone={t && t.margin < 0 ? 'rose' : 'emerald'} icon="trend" sub={t ? `Blended net margin ${t.margin_pct}%` : ''} />
        <Kpi label="Highest margin group" value={best ? best.group_name : '—'} mono={false} tone="sky" icon="check" sub={best ? `${best.margin_pct}% on ${money(best.revenue)}` : 'nothing sold'} />
        <Kpi label="Units through the counter" value={(t?.units || 0).toLocaleString()} unit="units" icon="box" sub={t ? `${all.length} ${d.group_label?.toLowerCase() || 'group'}s with sales` : ''} />
      </div>

      <Card flush title="Category Margins & Cost of Goods Sold (COGS)" sub="Calculated against the batch cost of what left the shelf, not a product average" right={<Pill tone="slate">audited against inward purchase batches</Pill>}>
        <Tbl head={[d?.group_label || 'Group', 'Bills', 'Units sold', 'Total COGS (Rs)', 'Gross revenue (Rs)', 'Gross profit (Rs)', 'Margin %', 'Status']} right={[1, 2, 3, 4, 5, 6]}>
          {rows.map((r) => { const s = status(r); return (
            <tr key={`${r.group_id}-${r.group_name}`}>
              <td className="font-bold text-slate-900">{r.group_name}</td>
              <td className="text-right font-mono">{r.bills}</td>
              <td className="text-right font-mono">{r.units.toLocaleString()} <span className="text-slate-500">units</span></td>
              <td className="text-right font-mono">{money(r.cost)}</td>
              <td className="text-right font-mono">{money(r.revenue)}</td>
              <td className={`text-right font-mono font-bold ${r.margin < 0 ? 'text-rose-700' : ''}`}>{money(r.margin)}</td>
              <td className="text-right"><Pill tone={s[0]} mono>{r.margin_pct}%</Pill></td>
              <td><Pill tone={s[0]}>{s[1]}</Pill></td>
            </tr>
          ); })}
          {rows.length === 0 && <tr><td colSpan={8}><Empty><b>Nothing sold over the counter in this period.</b> Dialysis and department issues are deliberately excluded.</Empty></td></tr>}
          {t && rows.length > 0 && (
            <tr className="!bg-slate-50 font-bold border-t-2 border-slate-300">
              <td>Total summary</td><td className="text-right font-mono">{t.bills}</td><td className="text-right font-mono">{t.units.toLocaleString()} units</td>
              <td className="text-right font-mono">{money(t.cost)}</td><td className="text-right font-mono text-[#0284c7]">{money(t.revenue)}</td>
              <td className={`text-right font-mono ${t.margin < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(t.margin)}</td>
              <td className="text-right font-mono">{t.margin_pct}% avg</td><td className="text-[11px] text-slate-500">100% from the ledger</td>
            </tr>
          )}
        </Tbl>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Revenue vs Cost Distribution" sub="Cost share and gross profit per group" right={<span className="text-[10px] font-semibold text-slate-500 flex items-center gap-3"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-slate-300 rounded-sm" />COGS</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#0284c7] rounded-sm" />Gross profit</span></span>}>
          <div className="space-y-4">
            {all.slice(0, 8).map((r) => {
              const cp = r.revenue > 0 ? Math.max(0, Math.min(100, Math.round((r.cost / r.revenue) * 100))) : 0;
              return (
                <div key={`${r.group_id}-${r.group_name}`}>
                  <div className="flex items-center justify-between text-xs mb-1"><span className="font-semibold text-slate-800">{r.group_name}</span><span className="font-mono text-slate-600">Cost {money(r.cost)} ({cp}%) <span className="text-[#0284c7] font-bold">Margin {money(r.margin)} ({r.margin_pct}%)</span></span></div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex"><div className="h-full bg-slate-300" style={{ width: `${cp}%` }} /><div className="h-full bg-[#0284c7]" style={{ width: `${Math.max(0, 100 - cp)}%` }} /></div>
                </div>
              );
            })}
            {all.length === 0 && <Empty>Nothing to chart.</Empty>}
          </div>
          {t && <div className="mt-4 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-[11px] text-blue-900 font-mono">Total cost ratio: {t.revenue > 0 ? Math.round((t.cost / t.revenue) * 1000) / 10 : 0}% · net realised ratio: {t.margin_pct}%</div>}
        </Card>
        <Card title="Low-Margin & Subsidised Lines" sub="Medicines sold at or near cost in this period — by product, whatever the table groups by" right={<Pill tone="rose">{lowRows.length} lines</Pill>}>
          <div className="space-y-2">
            {lowRows.map((r) => (
              <div key={r.group_id} className={`rounded-md border px-3 py-2 ${r.margin < 0 ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center justify-between text-xs"><span className="font-bold text-slate-900">{r.group_name}</span><Pill tone={r.margin < 0 ? 'rose' : r.margin_pct < 15 ? 'amber' : 'emerald'} mono>Margin: {r.margin_pct}%</Pill></div>
                <div className="text-[11px] text-slate-600 font-mono mt-1">Cost {money(r.cost)} · billed {money(r.revenue)} · {r.units} units</div>
              </div>
            ))}
            {lowRows.length === 0 && <Empty>Nothing sold by product in this period.</Empty>}
          </div>
        </Card>
      </div>

      {d?.series?.length > 0 && (
        <Card flush title="Over time" sub={`${PERIODS.find((p) => p[0] === period)?.[1] || ''} breakdown of the same figures`}>
          <Tbl head={['Period', 'Revenue', 'Cost', 'Margin']} right={[1, 2, 3]} dense>
            {d.series.map((x) => <tr key={x.bucket}><td className="font-mono">{x.bucket}</td><td className="text-right font-mono">{money(x.revenue)}</td><td className="text-right font-mono">{money(x.cost)}</td><td className={`text-right font-mono font-bold ${x.margin < 0 ? 'text-rose-700' : ''}`}>{money(x.margin)}</td></tr>)}
          </Tbl>
        </Card>
      )}
    </>
  );
}

function Lbl({ label, children }) { return <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{label}</div>{children}</div>; }
