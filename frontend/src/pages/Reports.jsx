import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { printPaper } from '../print.js';
import { BTN, BTN_PRIMARY, BTN_SM, CTL, PageHead, Kpi, Card, Pill, Chips, Search, Tbl, Empty, Bar } from '../components/ws/admin.jsx';

// Reports & Analytics — Phase 10.
//
// Four screens the client drew (revenue & sales, drug velocity, expiry &
// wastage, and the category margin — which lives on /margin) plus every other
// report the system already had, each under /reports/<key> so the sidebar can
// deep-link. The generic reports keep their column specs and the CSV export;
// the drawn ones get their KPI strips and side panels, every figure from the
// same endpoints as before (velocity is one new route, see reports.js).

const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// Column spec: key, label, and optional type ('money' | 'date').
export const GENERIC = {
  'stock-valuation': { title: 'Stock Valuation', endpoint: '/reports/stock-valuation', cols: [['name', 'Product'], ['on_hand', 'On Hand'], ['cost_value', 'Cost Value', 'money'], ['sale_value', 'Sale Value', 'money']] },
  receivables: { title: 'Receivables (non-paid customers)', endpoint: '/reports/receivables', pick: (d) => d.accounts, cols: [['name', 'Customer'], ['contact', 'Mobile'], ['balance', 'Owes', 'money'], ['current', '0-30', 'money'], ['d30', '31-60', 'money'], ['d60', '61-90', 'money'], ['d90', '90+', 'money'], ['last_payment', 'Last paid'], ['oldest', 'Oldest bill']] },
  'credit-daybook': { title: 'Credit Given vs Recovered', endpoint: '/reports/credit-daybook', pick: (d) => [...d.given.rows.map((r) => ({ ...r, direction: 'given' })), ...d.recovered.rows.map((r) => ({ ...r, direction: 'recovered' }))], cols: [['direction', 'Direction'], ['name', 'Customer'], ['contact', 'Mobile'], ['bill_no', 'Bill'], ['narration', 'Note'], ['amount', 'Amount', 'money']] },
  'staff-allowances': { title: 'Staff Allowances', endpoint: '/reports/staff-allowances', cols: [['patient_code', 'Code'], ['full_name', 'Staff member'], ['contact', 'Contact'], ['entitlement', 'Entitlement', 'money'], ['consumed', 'Used', 'money'], ['remaining', 'Remaining', 'money'], ['recoverable', 'To recover', 'money']] },
  'hospital-expense': { title: 'Hospital Expense (by department)', endpoint: '/reports/hospital-expense', dated: true, pick: (d) => d.by_department, cols: [['code', 'Code'], ['name', 'Department'], ['in_charge', 'Signs for it'], ['invoices', 'Invoices'], ['amount', 'Invoiced', 'money'], ['paid', 'Paid', 'money']] },
  vendors: { title: 'Vendor Payables', endpoint: '/reports/vendors', cols: [['name', 'Vendor'], ['purchased', 'Purchased', 'money'], ['paid', 'Paid', 'money'], ['reclaimed', 'Reclaimed', 'money'], ['balance', 'Payable', 'money']] },
  returns: { title: 'Returns', endpoint: '/reports/returns', dated: true, cols: [['return_no', 'Return No'], ['created_at', 'Date', 'date'], ['customer', 'Customer'], ['refund_amount', 'Refund', 'money'], ['restocked', 'Restocked'], ['writtenoff', 'Written Off'], ['reason', 'Reason']] },
  cashflow: { title: 'Cash Flow', endpoint: '/reports/cashflow', dated: true, cols: [['counter', 'Counter'], ['user_name', 'User'], ['opened_at', 'Opened', 'date'], ['closed_at', 'Closed', 'date'], ['opening_float', 'Float', 'money'], ['expected_cash', 'Expected', 'money'], ['counted_cash', 'Counted', 'money'], ['variance', 'Variance', 'money'], ['status', 'Status']] },
  'stock-movements': { title: 'Stock Movement Ledger', endpoint: '/reports/stock-movements', dated: true, cols: [['created_at', 'Time', 'date'], ['product_name', 'Product'], ['type', 'Type'], ['quantity', 'Qty'], ['reference', 'Reference'], ['reason', 'Reason']] },
  'staff-discount': { title: 'Staff Discount vs Cap', endpoint: '/reports/staff-discount', cols: [['patient_code', 'Staff ID'], ['full_name', 'Name'], ['used', 'Used', 'money'], ['remaining', 'Remaining', 'money'], ['cap', 'Annual Cap', 'money']] },
  dialysis: { title: 'Dialysis Activity', endpoint: '/reports/dialysis', dated: true, cols: [['category', 'Category'], ['sessions', 'Sessions'], ['gross', 'Gross', 'money'], ['subsidy', 'Subsidy', 'money'], ['net', 'Net', 'money']] },
  patients: { title: 'Patient Register', endpoint: '/reports/patients', dated: true, hospital: true, cols: [['patient_code', 'Patient ID'], ['full_name', 'Name'], ['gender', 'Gender'], ['age', 'Age'], ['category', 'Category'], ['contact', 'Contact'], ['registered', 'Registered']] },
  lab: { title: 'Lab Productivity', endpoint: '/reports/lab', dated: true, hospital: true, cols: [['test_name', 'Test'], ['ordered', 'Ordered'], ['completed', 'Completed'], ['revenue', 'Revenue', 'money']] },
};

function csvCell(v) { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
export function downloadCSV(name, cols, rows) {
  const csv = cols.map((c) => c[1]).join(',') + '\n' + rows.map((r) => cols.map((c) => csvCell(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

export default function Reports() {
  const { key } = useParams();
  const nav = useNavigate();
  const { hospitalMode, can } = useAuth();
  const k = key || 'revenue';
  const generic = Object.entries(GENERIC).filter(([, v]) => !v.hospital || hospitalMode);

  // The five report links live in the sidebar's Reports submenu (no tab row
  // here — the client asked for only the period and the subheading at the
  // top); the ledger-style reports stay reachable from this picker, which
  // sits with the screen's actions.
  const more = (
    <select value={GENERIC[k] ? k : ''} onChange={(e) => e.target.value && (e.target.value === '__audit' ? nav('/admin/audit') : nav(`/reports/${e.target.value}`))} className={`${CTL} !w-56`}>
      <option value="">More reports…</option>
      {generic.map(([id, v]) => <option key={id} value={id}>{v.title}</option>)}
      {can('audit.view') && <option value="__audit">Audit log</option>}
    </select>
  );
  return k === 'velocity' ? <Velocity more={more} /> : k === 'expiry' ? <Expiry more={more} /> : GENERIC[k] ? <Generic id={k} def={GENERIC[k]} more={more} /> : <Revenue more={more} />;
}

// ---------------------------------------------------------------------------
// Revenue & sales — `daily_monthly_revenue_sales_audit_report`
// ---------------------------------------------------------------------------
function Revenue({ more }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState('day');
  const [rows, setRows] = useState([]);
  const [cat, setCat] = useState([]);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    // QA S3-25: a reversed range is said, not shown as an empty report.
    if (from > to) { setRows([]); setErr(`The "to" date (${to}) is before the "from" date (${from}).`); return; }
    setErr('');
    api.get(`/reports/revenue?from=${from}&to=${to}&group=${group}`).then(setRows).catch((e) => { setRows([]); setErr(e.message); });
    api.get(`/reports/subsidy?from=${from}&to=${to}`).then(setCat).catch(() => setCat([]));
  }, [from, to, group]);
  useEffect(load, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  const tot = rows.reduce((a, r) => ({ bills: a.bills + r.bills, gross: a.gross + r.gross, discount: a.discount + r.discount, subsidy: a.subsidy + r.subsidy, net: a.net + r.net, collected: a.collected + r.collected }), { bills: 0, gross: 0, discount: 0, subsidy: 0, net: 0, collected: 0 });
  const credit = Math.max(0, tot.net - tot.collected);
  const pct = (n) => (tot.net > 0 ? Math.round((n / tot.net) * 1000) / 10 : 0);
  const cols = [['label', 'Group'], ['bills', 'Bills'], ['gross', 'Gross'], ['discount', 'Discount'], ['subsidy', 'Subsidy'], ['net', 'Net'], ['collected', 'Collected']];

  return (
    <>
      <PageHead title={null} sub="Audited register entries from the bills table, footed the same way the day-end sheet is."
        chip={<Pill tone="slate" mono>{from} → {to}</Pill>}
        right={<>
          {more}
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Print / PDF</button>
          <button type="button" className={BTN_DARK} onClick={() => downloadCSV(`revenue-${from}_${to}`, cols, rows)} disabled={!rows.length}><Icon name="file" size={14} /> Export CSV / Excel</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <Card>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
          <Lbl label="Report type"><div className={`${CTL} flex items-center bg-slate-50 text-slate-600`}>Revenue & sales detailed</div></Lbl>
          <Lbl label="From date"><input type="date" className={`${CTL} font-mono`} value={from} onChange={(e) => setFrom(e.target.value)} /></Lbl>
          <Lbl label="To date"><input type="date" className={`${CTL} font-mono`} value={to} onChange={(e) => setTo(e.target.value)} /></Lbl>
          <Lbl label="Group by"><select className={CTL} value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Day (daily batch)</option><option value="category">Patient category</option><option value="type">Bill type</option></select></Lbl>
          <button type="button" className={`${BTN_PRIMARY} h-10 justify-center`} onClick={load}>Run</button>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Gross sales" value={money(tot.gross)} icon="billing" sub={`${tot.bills} bills across ${group === 'day' ? rows.length : '—'} ${group === 'day' ? 'days' : 'groups'}`} />
        <Kpi label="Total discounts" value={money(tot.discount)} tone="amber" icon="idcard" sub="Patient, staff and counter relief" />
        <Kpi label="Trust subsidy" value={money(tot.subsidy)} tone="sky" icon="shield" sub="Given in full by the trust" />
        <Kpi label="Cash received" value={money(tot.collected)} tone="emerald" icon="cashflow" sub={`+ ${money(credit)} on the credit ledger`} />
      </div>

      <Card flush title="Revenue Breakdown" sub={group === 'day' ? 'Every day in the range, zero days included. Settlement is what the ledger says; Till is what the drawer count said.' : 'Register entries grouped; Settlement is what the ledger says.'} right={<Pill tone="emerald">{rows.length} {group === 'day' ? 'days' : 'groups'}</Pill>}>
        <Tbl head={[group === 'day' ? 'Date' : group === 'category' ? 'Category' : 'Bill type', 'Bills', 'Gross (Rs)', 'Discount (Rs)', 'Subsidy (Rs)', 'Net (Rs)', 'Collected (Rs)', 'Credit (Rs)', 'Settlement', ...(group === 'day' ? ['Till'] : [])]} right={[1, 2, 3, 4, 5, 6, 7]}>
          {rows.map((r) => {
            const cr = Math.max(0, r.net - r.collected);
            return (
              <tr key={r.label}>
                <td className="font-mono font-semibold text-slate-900">{r.label}</td>
                <td className="text-right font-mono">{r.bills}</td>
                <td className="text-right font-mono">{money(r.gross)}</td>
                <td className={`text-right font-mono ${r.discount > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{money(r.discount)}</td>
                <td className={`text-right font-mono ${r.subsidy > 0 ? 'text-[#0284c7]' : 'text-slate-500'}`}>{money(r.subsidy)}</td>
                <td className="text-right font-mono font-bold">{money(r.net)}</td>
                <td className="text-right font-mono text-emerald-700 bg-emerald-50/40">{money(r.collected)}</td>
                <td className={`text-right font-mono ${cr > 0 ? 'text-rose-700' : 'text-slate-500'}`}>{money(cr)}</td>
                <td><Pill tone={r.bills === 0 ? 'slate' : cr > 0 ? 'amber' : 'emerald'}>{r.bills === 0 ? 'NO TRADING' : cr > 0 ? 'ON LEDGER' : 'SETTLED'}</Pill></td>
                {group === 'day' && (
                  <td>{r.till && r.till.status !== 'no_till'
                    ? <Pill tone={{ balanced: 'emerald', variance: 'rose', not_counted: 'amber', open: 'amber' }[r.till.status] || 'slate'}>{r.till.label}</Pill>
                    : r.bills > 0 ? <Pill tone="rose">NO TILL</Pill> : <span className="text-slate-400">—</span>}{r.day_closed === 'closed' && <span className="ml-1 text-[10px] font-mono text-slate-500">locked</span>}{r.day_closed === 'reopened' && <span className="ml-1 text-[10px] font-mono text-rose-700">reopened</span>}</td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={10}><Empty>No bills in this period.</Empty></td></tr>}
          {rows.length > 0 && (
            <tr className="!bg-slate-50 font-bold border-t-2 border-slate-300">
              <td>Total summary</td><td className="text-right font-mono">{tot.bills}</td><td className="text-right font-mono">{money(tot.gross)}</td>
              <td className="text-right font-mono text-amber-700">{money(tot.discount)}</td><td className="text-right font-mono text-[#0284c7]">{money(tot.subsidy)}</td>
              <td className="text-right font-mono">{money(tot.net)}</td><td className="text-right font-mono text-emerald-700 bg-emerald-50/40">{money(tot.collected)}</td>
              <td className="text-right font-mono text-rose-700">{money(credit)}</td><td className="text-[11px] text-slate-500">{tot.net > 0 ? `${pct(tot.collected)}% collected` : '—'}</td>
            </tr>
          )}
        </Tbl>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Settlement & Collection Distribution" sub="Realised cash against pending ledger dues" right={<Pill tone="slate" mono>Net {money(tot.net)}</Pill>}>
          <div className="space-y-4">
            <BarRow label="Collected at the counter" value={money(tot.collected)} pct={pct(tot.collected)} tone="emerald" />
            <BarRow label="Patient credit ledger (receivable due)" value={money(credit)} pct={pct(credit)} tone="rose" />
            <BarRow label="Trust welfare & Zakat subsidy" value={money(tot.subsidy)} pct={tot.gross > 0 ? Math.round((tot.subsidy / tot.gross) * 1000) / 10 : 0} tone="violet" note="of gross" />
          </div>
        </Card>
        <Card title="Dispensation by Patient Category" sub="Share of net by who was billed" right={<Pill tone="slate" mono>{cat.reduce((t, c) => t + c.bills, 0)} bills</Pill>}>
          <div className="space-y-4">
            {cat.map((c) => <BarRow key={c.category} label={c.category} value={money(c.net)} pct={pct(c.net)} tone={c.category === 'Paid' ? 'navy' : c.category === 'Complete Free' ? 'sky' : 'amber'} />)}
            {cat.length === 0 && <Empty>Nothing billed in this period.</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}

function Lbl({ label, children }) { return <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{label}</div>{children}</div>; }
function BarRow({ label, value, pct, tone, note }) {
  const t = { emerald: 'bg-emerald-500', rose: 'bg-rose-500', violet: 'bg-violet-500', sky: 'bg-[#0284c7]', amber: 'bg-amber-500', navy: 'bg-[#0b1f3d]' }[tone] || 'bg-slate-400';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5"><span className="flex items-center gap-2 font-semibold text-slate-800"><span className={`w-2.5 h-2.5 rounded-full ${t}`} />{label}</span><span className="font-mono"><b>{value}</b> <span className="text-slate-500">({pct}%{note ? ` ${note}` : ''})</span></span></div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${t}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drug velocity — `fast_slow_moving_drug_velocity_report`
// ---------------------------------------------------------------------------
const TIER = { fast: ['emerald', 'Fast moving'], moderate: ['sky', 'Moderate'], slow: ['amber', 'Slow moving'], dead: ['rose', 'Dead stock'] };
function Velocity({ more }) {
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(today());
  const [tier, setTier] = useState('all');
  const [sched, setSched] = useState('');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api.get(`/reports/velocity?from=${from}&to=${to}`).then(setD).catch((e) => setErr(e.message)); }, [from, to]);
  useEffect(load, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);
  const rows = (d?.rows || []).filter((r) => tier === 'all' || r.tier === tier).filter((r) => !sched || r.drug_schedule === sched)
    .filter((r) => !q.trim() || [r.name, r.generic_name, r.manufacturer, r.drap_reg_no].some((s) => (s || '').toLowerCase().includes(q.trim().toLowerCase())));
  const t = d?.totals;
  const stockLabel = (r) => (r.days_left == null ? ['slate', 'No demand'] : r.days_left <= 7 ? ['rose', 'Critical low'] : r.days_left <= 14 ? ['amber', 'Reorder trigger'] : r.on_hand <= r.reorder_level ? ['amber', 'At reorder'] : ['emerald', 'Buffer OK']);
  const action = (r) => (r.tier === 'dead' && r.on_hand > 0 ? 'Vendor return / claim' : r.days_left != null && r.days_left <= 7 ? 'Expedite order' : r.days_left != null && r.days_left <= 14 ? 'Add to demand slip' : r.next_expiry ? 'FEFO — no order needed' : 'No order needed');
  const cols = [['name', 'Medicine'], ['manufacturer', 'Company'], ['tier', 'Tier'], ['run_rate', 'Units/day'], ['units_out', 'Units out'], ['on_hand', 'On hand'], ['days_left', 'Days left'], ['next_expiry', 'Next expiry']];

  return (
    <>
      <PageHead title={null} sub="How fast each medicine leaves the shelf over the period, and how many days the shelf will last at that rate. Tiers are the run rate's reading, nothing stored."
        chip={<Pill tone="slate" mono>{d ? `${d.from} → ${d.to} · ${d.days} days` : ''}</Pill>}
        right={<>
          {more}
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Print report</button>
          <button type="button" className={BTN_DARK} onClick={() => downloadCSV(`velocity-${from}_${to}`, cols, rows)} disabled={!rows.length}><Icon name="file" size={14} /> Export CSV / Excel</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <Card>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 items-end">
          <Lbl label="Velocity classification"><select className={CTL} value={tier} onChange={(e) => setTier(e.target.value)}><option value="all">All tiers</option><option value="fast">Fast moving (≥10/day)</option><option value="moderate">Moderate (2–10/day)</option><option value="slow">Slow moving (&lt;2/day)</option><option value="dead">Dead stock (none out)</option></select></Lbl>
          <Lbl label="From"><input type="date" className={`${CTL} font-mono`} value={from} onChange={(e) => setFrom(e.target.value)} /></Lbl>
          <Lbl label="To"><input type="date" className={`${CTL} font-mono`} value={to} onChange={(e) => setTo(e.target.value)} /></Lbl>
          <Lbl label="Drug schedule"><select className={CTL} value={sched} onChange={(e) => setSched(e.target.value)}><option value="">All schedules</option><option value="OTC">OTC</option><option value="Rx">Rx</option><option value="G">Schedule G</option><option value="Narcotic">Controlled</option></select></Lbl>
          <Lbl label="Search"><Search value={q} onChange={setQ} placeholder="Medicine, generic, company…" /></Lbl>
          <button type="button" className={`${BTN_PRIMARY} h-10 justify-center`} onClick={load}>Run analysis</button>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Fast-moving velocity" value={t?.fast ?? '—'} unit="SKUs" tone="emerald" icon="trend" sub={t ? `${t.units_out.toLocaleString()} units out · ${money(t.value_out)} at sale price` : ''} />
        <Kpi label="Sluggish capital" value={money(rows.length ? (d?.rows || []).filter((r) => r.tier === 'slow').reduce((s, r) => s + r.on_hand_cost, 0) : 0)} tone="amber" icon="clock" sub={t ? `${t.slow} slow-moving SKUs · pause purchasing` : ''} />
        <Kpi label="Dormant & dead stock" value={money(t?.dead_cost || 0)} tone="rose" icon="warning" sub={t ? `${t.dead} SKUs with nothing out · return or claim` : ''} />
        <Kpi label="Stock-out risk" value={t?.stockout_soon ?? '—'} unit="SKUs" tone={t?.stockout_soon ? 'rose' : 'emerald'} icon="box" sub="Under 7 days of stock at today's rate" />
      </div>

      <Card flush title="Formulary Consumption Ledger & Inventory Run Rates" sub={`Calculated per ${d?.days || '—'}-day period from every dispense and sale movement`} right={<Pill tone="slate">Showing {rows.length} of {d?.rows?.length || 0} formulary lines</Pill>}>
        <Tbl head={['Medicine & formulation', 'Velocity tier', 'Daily run rate', 'Units out', 'Current stock', 'Days left', 'Next expiry', 'Stock balance', 'Procurement action']} right={[2, 3, 4, 5]}>
          {rows.map((r) => {
            const sl = stockLabel(r);
            return (
              <tr key={r.id}>
                <td><div className="font-bold text-slate-900 text-[13px]">{r.name}{r.strength ? <span className="text-slate-500 font-normal"> {r.strength}</span> : null}</div><div className="text-[11px] text-slate-500">{[r.manufacturer, r.generic_name, r.drap_reg_no ? `DRAP #${r.drap_reg_no}` : null].filter(Boolean).join(' • ')}</div></td>
                <td><Pill tone={TIER[r.tier][0]}>{TIER[r.tier][1]}</Pill></td>
                <td className="text-right font-mono">{r.run_rate} <span className="text-slate-500">{r.unit}/day</span></td>
                <td className="text-right font-mono">{r.units_out.toLocaleString()}</td>
                <td className="text-right font-mono">{r.on_hand.toLocaleString()} <span className="text-slate-500">{r.unit}</span></td>
                <td className={`text-right font-mono font-bold ${r.days_left == null ? 'text-slate-400' : r.days_left <= 7 ? 'text-rose-700' : r.days_left <= 14 ? 'text-amber-700' : 'text-[#0284c7]'}`}>{r.days_left == null ? (r.on_hand > 0 ? '>90' : '0') : r.days_left} days</td>
                <td className="font-mono text-slate-600">{r.next_expiry || '—'}</td>
                <td><Pill tone={sl[0]}>{sl[1]}</Pill></td>
                <td className="text-slate-700 text-[11px] font-semibold">{action(r)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={9}><Empty>{d ? 'No medicine matches.' : 'Loading…'}</Empty></td></tr>}
        </Tbl>
        {t && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600 flex items-center justify-between flex-wrap gap-3 font-mono">
            <span>Total catalogue: {t.skus} SKUs · on hand at cost {money(t.on_hand_cost)}</span>
            <span className="text-rose-700">Dead stock exposure: {t.on_hand_cost > 0 ? Math.round((t.dead_cost / t.on_hand_cost) * 1000) / 10 : 0}% of capital</span>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Velocity mix" sub="Share of SKUs by tier">
          {t && ['fast', 'moderate', 'slow', 'dead'].map((k) => <div key={k} className="mb-3"><BarRow label={TIER[k][1]} value={`${t[k]} SKUs`} pct={t.skus ? Math.round((t[k] / t.skus) * 1000) / 10 : 0} tone={TIER[k][0] === 'emerald' ? 'emerald' : TIER[k][0] === 'sky' ? 'sky' : TIER[k][0] === 'amber' ? 'amber' : 'rose'} /></div>)}
        </Card>
        <Card title="Suggested demand slip" sub="Fast movers with under 14 days of stock — the order taker's list" right={<button type="button" className={BTN_SM} onClick={() => window.location.assign('/vendors')}>Open demand slip</button>}>
          <div className="divide-y divide-slate-100">
            {(d?.rows || []).filter((r) => r.days_left != null && r.days_left <= 14).slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 text-xs"><span className="font-semibold text-slate-800">{r.name} {r.strength}</span><span className="font-mono"><Pill tone={r.days_left <= 7 ? 'rose' : 'amber'}>{r.days_left} days left</Pill> <span className="text-slate-500 ml-2">≈ {Math.ceil(r.run_rate * 30).toLocaleString()} {r.unit} / month</span></span></div>
            ))}
            {(d?.rows || []).filter((r) => r.days_left != null && r.days_left <= 14).length === 0 && <Empty>Nothing under 14 days of stock.</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Expiry & wastage — `expiry_stock_wastage_audit_report`
// ---------------------------------------------------------------------------
function Expiry({ more }) {
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [horizon, setHorizon] = useState('near');
  const [vendor, setVendor] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    api.get('/pharmacy/dashboard').then(setD).catch((e) => setErr(e.message));
    api.get('/inventory/alerts').then(setAlerts).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);
  const ex = d?.expiry;
  const batches = useMemo(() => (ex?.batches || [])
    .filter((b) => horizon === 'expired' ? b.days_left < 0 : horizon === '30' ? b.days_left <= 30 : true)
    .filter((b) => !vendor || b.vendor_name === vendor), [ex, horizon, vendor]);
  const vendors = [...new Set((ex?.batches || []).map((b) => b.vendor_name).filter(Boolean))];
  const byVendor = vendors.map((v) => { const bs = (ex?.batches || []).filter((b) => b.vendor_name === v && b.claim_status === 'none' && b.days_left <= (ex?.claim_window_days || 180)); return { v, n: bs.length, value: bs.reduce((t, b) => t + b.quantity * b.cost_price, 0) }; });
  const stockCost = d?.stock?.value_at_cost || 0;
  async function quarantine(b) {
    if (!window.confirm(`Pull batch ${b.batch_no || b.id} of ${b.name} from the shelf?`)) return;
    try { await api.post(`/pharmacy/batches/${b.id}/quarantine`, { reason: 'Pulled at expiry audit' }); setMsg(`${b.name} batch ${b.batch_no || ''} quarantined.`); load(); } catch (e) { setErr(e.message); }
  }
  async function quarantineExpired() {
    try { const r = await api.post('/pharmacy/quarantine-expired', {}); setMsg(`${r.quarantined ?? r.count ?? 'Expired'} batch(es) pulled from the shelf.`); load(); } catch (e) { setErr(e.message); }
  }
  const cols = [['name', 'Medicine'], ['batch_no', 'Batch'], ['vendor_name', 'Supplier'], ['expiry_date', 'Expiry'], ['days_left', 'Days left'], ['quantity', 'On hand'], ['cost_price', 'Cost'], [(b) => b.quantity * b.cost_price, 'Value at risk'], ['claim_status', 'Claim']];

  return (
    <>
      <PageHead title={null} sub={`Every batch inside the ${ex?.near_expiry_days || '—'}-day window, soonest first — the order FEFO will take it. Distributors accept claims up to ${ex?.claim_window_days || '—'} days ahead.`}
        chip={<Pill tone="sky" mono>business day {d?.business_date || ''}</Pill>}
        right={<>
          {more}
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Print / PDF</button>
          <button type="button" className={BTN_DARK} onClick={() => downloadCSV('expiry-audit', cols, batches)} disabled={!batches.length}><Icon name="file" size={14} /> Export CSV / Excel</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <Lbl label="Expiry horizon"><select className={CTL} value={horizon} onChange={(e) => setHorizon(e.target.value)}><option value="near">Near-expiry window ({ex?.near_expiry_days || 90} days)</option><option value="30">Critical horizon (&lt; 30 days)</option><option value="expired">Expired on the shelf</option></select></Lbl>
          <Lbl label="Licensed supplier"><select className={CTL} value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">All suppliers</option>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}</select></Lbl>
          <button type="button" className={`${BTN_PRIMARY} h-10 justify-center`} onClick={load}><Icon name="returns" size={14} /> Run audit</button>
          {can('inventory.manage') && <button type="button" className={`${BTN} h-10 justify-center !text-rose-700`} onClick={quarantineExpired} disabled={!ex?.expired?.batches}><Icon name="warning" size={14} /> Pull all expired off the shelf</button>}
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Expired stock value" value={money(ex?.expired?.value || 0)} tone={ex?.expired?.batches ? 'rose' : 'emerald'} icon="warning" sub={ex ? `${ex.expired.batches} batch${ex.expired.batches === 1 ? '' : 'es'} still on the shelf · ${d.stock.quarantined_batches} quarantined` : ''} />
        <Kpi label="Critical expiry (< 30 d)" value={money(ex?.within_30?.value || 0)} tone="rose" icon="clock" sub={ex ? `${ex.within_30.batches} batches · ${ex.within_30.units.toLocaleString()} units at risk` : ''} />
        <Kpi label="Claimable value" value={money(ex?.claimable?.value || 0)} tone="sky" icon="file" sub={ex ? `${ex.claimable.batches} batches inside the ${ex.claim_window_days}-day covenant` : ''} />
        <Kpi label="Total risk (near window)" value={stockCost ? `${Math.round(((ex?.near?.value || 0) / stockCost) * 1000) / 10}%` : '—'} tone="amber" icon="trend" sub={ex ? `${money(ex.near.value)} of ${money(stockCost)} shelf at cost` : ''} />
      </div>

      <Card flush title="Active Batches Audit Ledger" sub="Live sorting by first-expiry first-out; quarantined batches stay listed and flagged" right={<Pill tone="amber">{batches.length} batches flagged</Pill>}>
        <Tbl head={['Medicine & strength', 'Batch', 'Supplier / distributor', 'Expiry date', 'Days remaining', 'Stock on hand', 'Trade price', 'Valuation at risk', 'Claim status', '']} right={[5, 6, 7]}>
          {batches.map((b) => (
            <tr key={b.id} className={b.quarantined ? 'opacity-60' : ''}>
              <td><div className="font-bold text-slate-900">{b.name}{b.strength ? <span className="text-slate-500 font-normal"> {b.strength}</span> : null}</div><div className="text-[11px] text-slate-500">{b.drug_schedule}{b.quarantined ? ' • quarantined' : ''}</div></td>
              <td className="font-mono"><Pill tone="slate" mono>{b.batch_no || '—'}</Pill></td>
              <td className="text-slate-700">{b.vendor_name || <span className="text-slate-400">not recorded</span>}</td>
              <td className={`font-mono ${b.days_left < 0 ? 'text-rose-700 font-bold' : b.days_left <= 30 ? 'text-rose-700' : 'text-slate-700'}`}>{b.expiry_date}</td>
              <td><Pill tone={b.days_left < 0 ? 'rose' : b.days_left <= 30 ? 'rose' : b.days_left <= 60 ? 'amber' : 'emerald'}>{b.days_left < 0 ? `expired ${-b.days_left}d` : `${b.days_left} days left`}</Pill></td>
              <td className="text-right font-mono">{b.quantity.toLocaleString()}</td>
              <td className="text-right font-mono">{money(b.cost_price)}</td>
              <td className="text-right font-mono font-bold text-rose-700">{money(b.quantity * b.cost_price)}</td>
              <td><Pill tone={b.claim_status !== 'none' ? 'slate' : b.days_left <= (ex?.claim_window_days || 180) ? 'sky' : 'amber'}>{b.claim_status !== 'none' ? b.claim_status : b.days_left <= (ex?.claim_window_days || 180) ? 'Claimable' : 'FEFO push'}</Pill></td>
              <td className="text-right whitespace-nowrap">{can('inventory.manage') && !b.quarantined && <button type="button" className={`${BTN_SM} !text-rose-700`} onClick={() => quarantine(b)}>Pull</button>}</td>
            </tr>
          ))}
          {batches.length === 0 && <tr><td colSpan={10}><Empty>{d ? 'Nothing inside this horizon.' : 'Loading…'}</Empty></td></tr>}
        </Tbl>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-[11px] font-mono text-slate-600 flex items-center justify-between flex-wrap gap-2">
          <span>Consolidated audit balance: {batches.reduce((t, b) => t + b.quantity, 0).toLocaleString()} units · {money(batches.reduce((t, b) => t + b.quantity * b.cost_price, 0))} at cost</span>
          <span>{alerts ? `${alerts.near_expiry.length} batches inside the alert window` : ''}</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Distributor Expiry Claim Recovery Tracker" sub={`Batches still claimable, by supplier — record the reclaim on the vendor's page`} right={<Pill tone="slate" mono>policy: {ex?.claim_window_days || '—'} days</Pill>}>
          <div className="divide-y divide-slate-100">
            {byVendor.filter((x) => x.n > 0).map((x) => (
              <div key={x.v} className="py-3 flex items-center justify-between gap-3 text-xs">
                <div><div className="font-bold text-slate-900">{x.v}</div><div className="text-[11px] text-slate-500">{x.n} batch{x.n === 1 ? '' : 'es'} eligible</div></div>
                <div className="text-right"><div className="font-mono font-bold">{money(x.value)}</div><a href="/vendors" className="text-[11px] text-[#0284c7] font-semibold hover:underline">Record reclaim →</a></div>
              </div>
            ))}
            {byVendor.filter((x) => x.n > 0).length === 0 && <Empty>No claimable batch carries a supplier — receive stock against a vendor so a claim has someone to go to.</Empty>}
          </div>
        </Card>
        <Card title="FEFO Dispense Acceleration" sub="The counter always takes the soonest-expiring batch first; these are the ones it is working through">
          <div className="space-y-3">
            {(ex?.batches || []).filter((b) => b.days_left >= 0 && !b.quarantined).slice(0, 4).map((b) => {
              const total = alerts?.near_expiry?.find((a) => a.id === b.id)?.quantity ?? b.quantity;
              return (
                <div key={b.id} className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs">
                  <div className="flex items-center justify-between"><span className="font-semibold text-slate-800">{b.name} · batch {b.batch_no || '—'}</span><span className="font-mono text-slate-600">{b.quantity.toLocaleString()} left · {b.days_left}d</span></div>
                  <Bar pct={Math.max(3, Math.min(100, 100 - (b.days_left / (ex?.near_expiry_days || 90)) * 100))} tone={b.days_left <= 30 ? 'rose' : 'amber'} />
                  <div className="text-[10px] text-slate-500 mt-1">Target: sold out by {b.expiry_date}{total !== b.quantity ? '' : ''}</div>
                </div>
              );
            })}
            {(ex?.batches || []).length === 0 && <Empty>Nothing near expiry.</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The generic table reports (unchanged columns, restyled)
// ---------------------------------------------------------------------------
function Generic({ id, def, more }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setErr(''); setLoading(true);
    const params = new URLSearchParams();
    if (def.dated) { params.set('from', from); params.set('to', to); }
    const qs = params.toString();
    api.get(`${def.endpoint}${qs ? '?' + qs : ''}`)
      .then((r) => { const rs = def.pick ? def.pick(r) : r; setRows(Array.isArray(rs) ? rs : []); })
      .catch((e) => { setRows([]); setErr(e.message); })
      .finally(() => setLoading(false));
  }, [def, from, to]);
  useEffect(load, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  const fmt = (val, type) => (val == null || val === '' ? '—' : type === 'money' ? money(val) : type === 'date' ? String(val).slice(0, 16).replace('T', ' ') : val);
  const totals = {};
  def.cols.forEach((c) => { if (c[2] === 'money' || ['bills', 'ordered', 'completed', 'sessions', 'on_hand', 'restocked', 'writtenoff', 'invoices'].includes(c[0])) totals[c[0]] = rows.reduce((s, r) => s + (Number(r[c[0]]) || 0), 0); });

  return (
    <>
      <PageHead title={def.title} sub={def.dated ? `${from} → ${to}` : 'As of now'}
        right={<>
          {more}
          {def.dated && <><input type="date" className={`${CTL} !w-40 !h-9 font-mono`} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className={`${CTL} !w-40 !h-9 font-mono`} value={to} onChange={(e) => setTo(e.target.value)} /></>}
          <button type="button" className={BTN} onClick={load}>Run</button>
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })} disabled={!rows.length}><Icon name="printer" size={14} /> Print</button>
          <button type="button" className={BTN_DARK} onClick={() => downloadCSV(`${id}-${from}_${to}`, def.cols, rows)} disabled={!rows.length}><Icon name="file" size={14} /> Export CSV</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Card flush title={def.title} right={<Pill tone="slate">{rows.length} row{rows.length === 1 ? '' : 's'}</Pill>}>
        <Tbl head={def.cols.map((c) => c[1])} right={def.cols.map((c, i) => (c[2] === 'money' || totals[c[0]] != null ? i : -1)).filter((i) => i >= 0)}>
          {loading ? <tr><td colSpan={def.cols.length}><Empty>Loading…</Empty></td></tr> : rows.map((r, i) => (
            <tr key={i}>{def.cols.map((c) => <td key={c[0]} className={c[2] === 'money' || totals[c[0]] != null ? 'text-right font-mono' : ''}>{fmt(r[c[0]], c[2])}</td>)}</tr>
          ))}
          {!loading && !rows.length && <tr><td colSpan={def.cols.length}><Empty>No data for this period.</Empty></td></tr>}
          {rows.length > 0 && Object.keys(totals).length > 0 && (
            <tr className="!bg-slate-50 font-bold border-t-2 border-slate-300">
              {def.cols.map((c, idx) => <td key={c[0]} className={c[2] === 'money' || totals[c[0]] != null ? 'text-right font-mono' : ''}>{idx === 0 ? 'Total' : (totals[c[0]] != null ? fmt(totals[c[0]], c[2] === 'money' ? 'money' : undefined) : '')}</td>)}
            </tr>
          )}
        </Tbl>
      </Card>
    </>
  );
}

const BTN_DARK = 'h-9 px-3.5 bg-[#0b1f3d] hover:bg-[#122e54] text-white rounded-md font-bold inline-flex items-center gap-1.5 text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';
