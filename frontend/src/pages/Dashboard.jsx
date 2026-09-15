import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { money, Alert, useConfirm, strengthOf } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { useHealth } from '../components/AdminLayout.jsx';
import { Card, Pill, Tbl, Empty, BTN_SM } from '../components/ws/admin.jsx';

// The Management Dashboard — Phase 10, screen `hospital_management_executive_dashboard`.
//
// Two homes from one page. `management` (an administrator, or anyone who
// reads the reports) is the mockup and nothing but the mockup, in the sidebar
// frame: welcome banner, eight KPI cards, six launchpads, today's register
// beside the ward indents. The counter user's home (the pharmacist, in the
// dock frame) is the same four sections with the counter's own panels folded
// in: medicine lookup, the action banners, reorder list, expiry & claims,
// moving today, controlled-drug register. The mockup's markup, the system's
// figures. Three sources, each fetched on its own so a missing permission
// blanks one block rather than the page:
//   /reports/dashboard   — patients, tokens, lab, revenue, subsidy, low stock
//   /pharmacy/dashboard  — bills, units, expiry, till, recent sales, stock,
//                          reorder list, top sellers, controlled register
//   /departments/requests?status=received — the ward indents
//
// Below the mockup's sections sit the pharmacy's own panels from the former
// pharmacy dashboard — medicine lookup, expiry & claims, reorder list, moving
// today, controlled register — in the same card language. Patients, tokens
// and the laboratory are the on-hold hospital module (SCOPE.md): in pharmacy
// mode their cards and tiles are replaced, not shown at zero.

const fmtTime = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const SCHED = { Rx: ['sky', 'Rx'], G: ['amber', 'Sch. G'], Narcotic: ['rose', 'Controlled'] };

export default function Dashboard({ management = false }) {
  const { user, can, hospitalMode, config } = useAuth();
  const nav = useNavigate();
  const health = useHealth();
  const [stats, setStats] = useState(null);
  const [ph, setPh] = useState(null);
  const [indents, setIndents] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    if (can('report.view') || can('billing.view')) api.get('/reports/dashboard').then(setStats).catch((e) => setErr(e.message)); else setStats({});
    if (can('pharmacy.sell') || can('pharmacy.dispense') || can('inventory.view')) api.get('/pharmacy/dashboard').then(setPh).catch(() => setPh({}));
    if (can('pharmacy.dispense') || can('inventory.view')) api.get('/departments/requests?status=received').then(setIndents).catch(() => {});
  }, [can]);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('hwt:refresh', load);
    const id = setInterval(load, 60000);
    return () => { window.removeEventListener('hwt:refresh', load); clearInterval(id); };
  }, [load]);

  async function quarantineExpired() {
    if (!(await confirm({ title: 'Quarantine every expired batch?', body: 'They will be blocked from sale but kept for the expiry claim.', confirmLabel: 'Quarantine all', tone: 'danger' }))) return;
    setBusy(true);
    try { const r = await api.post('/pharmacy/quarantine-expired', {}); setMsg(`${r.quarantined} expired batch(es) — ${r.units} units — moved to quarantine.`); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function quarantine(b) {
    try { await api.post(`/pharmacy/batches/${b.id}/quarantine`, { reason: 'Pulled from shelf at counter review' }); setMsg(`Batch ${b.batch_no || b.id} of ${b.name} quarantined.`); load(); }
    catch (e) { setErr(e.message); }
  }

  // The launchpads' keys. F1–F4 and F6 are the mockup's; F5 is the frame's refresh.
  const tiles = [
    ...(hospitalMode ? [
      { key: 'F1', to: '/patients/new', icon: 'register', title: 'Register Patient', desc: 'Create a new patient record, issue a consultation token, and verify welfare subsidy status.', perm: 'patient.manage' },
      { key: 'F2', to: '/queue', icon: 'queue', title: 'Queue Work-Lists', desc: 'View live department work-lists, call OPD tokens, and reassign patients to clinics.', perm: 'token.manage' },
      { key: null, to: '/lab', icon: 'lab', title: 'Laboratory Diagnostics', desc: 'Process ordered pathology tests, record results, and issue certified reports.', perm: 'lab.view', badge: stats?.lab_pending ? `${stats.lab_pending} Alerts` : null },
    ] : []),
    { key: hospitalMode ? 'F3' : 'F1', to: '/pharmacy', icon: 'pharmacy', title: 'Pharmacy Counter', desc: 'Dispense prescriptions, process subsidised OTC items, scan barcodes, and print thermal slips.', perm: 'pharmacy.sell' },
    { key: hospitalMode ? 'F4' : 'F3', to: '/inventory', icon: 'inventory', title: 'Inventory Control', desc: 'Manage pharmaceutical products, stock batches, supplier GRN receiving, and near-expiry quarantines.', perm: 'inventory.view' },
    ...(hospitalMode
      ? [{ key: 'F6', to: '/billing', icon: 'billing', title: 'Billing & Welfare Claims', desc: 'Generate itemised patient bills with automated welfare trust discounts and corporate credit rules.', perm: 'billing.view' }]
      : [
        { key: 'F2', to: '/pharmacy-close', icon: 'clock', title: 'Day-End Close', desc: 'Count the drawer, reconcile the till, and print the audit sheet that closes the day.', perm: 'pharmacy.sell' },
        { key: 'F4', to: '/departments', icon: 'patients', title: 'Department Indents', desc: 'Work the ward and unit requisition queue: match lines, dispense FEFO, invoice the department.', perm: 'pharmacy.dispense' },
        { key: 'F6', to: '/customers', icon: 'user', title: 'Customers & Welfare', desc: 'Customer files, welfare cards and tiers, credit accounts and their settlement.', perm: 'patient.view' },
        { key: 'F7', to: '/reports', icon: 'reports', title: 'Reports & Analytics', desc: 'Revenue, subsidy by fund, receivables, margin, expiry and wastage — every figure from the ledger.', perm: 'report.view' },
      ]),
  ].filter((t) => !t.perm || can(t.perm))
    .sort((a, b) => (a.key ? Number(a.key.slice(1)) : 99) - (b.key ? Number(b.key.slice(1)) : 99));

  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      const t = tiles.find((x) => x.key === e.key);
      if (t) { e.preventDefault(); nav(t.to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tiles, nav]);

  const s = stats || {};
  const till = ph?.till?.open ? ph.till : null;
  const sales = ph?.sales;
  const stock = ph?.stock; const expiry = ph?.expiry; const compliance = ph?.compliance; const controlled = ph?.controlled;
  const cards = hospitalMode ? [
    { label: 'Patients Today', value: s.patients_today ?? '—', tone: 'sky', foot: ['OPD Counter Active', <span className="text-emerald-600 font-semibold">↑ Ready</span>] },
    { label: 'Total Patients', value: s.patients_total ?? '—', tone: 'slate', foot: ['EMR Registered Profiles', <span className="text-slate-600 font-semibold">Hospital Core</span>] },
    { label: 'Tokens Today', value: s.tokens_today ?? '—', tone: 'slate', foot: [s.tokens_today ? 'Queue live' : 'Queue Line Empty', <span className="text-slate-500 font-medium">{till ? `${till.counter} Ready` : 'No till'}</span>] },
    { label: 'Lab Pending', value: s.lab_pending ?? '—', tone: 'amber', chip: 'Awaiting Pathologist Review' },
  ] : [
    { label: 'Bills Today', value: sales?.bills ?? '—', tone: 'sky', foot: [sales ? `${sales.units} units dispensed` : 'not available', null] },
    { label: 'Total Customers', value: s.patients_total ?? '—', tone: 'slate', foot: ['Registered files', null] },
    { label: 'Gross Margin Today', value: sales ? money(sales.margin) : '—', tone: 'slate', foot: [sales ? `${sales.margin_pct}% on cost of ${money(sales.cogs)}` : 'not available', null] },
    // The window is the setting's (QA S3-18), and the figure is that window's.
    { label: `Expiry Watch (≤${expiry?.near_expiry_days ?? config.near_expiry_days ?? 90} d)`, value: expiry?.near?.batches ?? '—', tone: 'amber', chip: expiry?.expired?.batches ? `${expiry.expired.batches} expired on the shelf` : `${expiry?.claimable?.batches ?? 0} claimable from distributors` },
  ];
  const gaps = s.compliance?.total ?? compliance?.total ?? 0;
  const cards2 = [
    { label: 'Revenue Today', value: stats || sales ? money(s.revenue_today ?? sales?.net ?? 0) : '—', tone: 'sky', foot: [till ? `Opening float ${money(till.opening_float)}` : 'No till open', null] },
    // 8.5: a zero-value card goes quiet rather than carrying a promotional caption.
    { label: 'Subsidy Today', value: stats || sales ? money(s.subsidy_today ?? sales?.subsidy ?? 0) : '—', tone: 'amber', foot: [(s.subsidy_today ?? sales?.subsidy ?? 0) > 0 ? 'Absorbed by the trust\'s funds' : 'No subsidy given today', null], amberFoot: (s.subsidy_today ?? sales?.subsidy ?? 0) > 0 },
    // The compliance line is the Inventory screen's own gap count (QA S2-13),
    // never a green tick on its own.
    { label: 'Low-Stock Items', value: s.low_stock ?? stock?.low_stock ?? '—', tone: (s.low_stock ?? stock?.low_stock ?? 0) > 0 ? 'amber' : 'slate', foot: [gaps > 0 ? <span className="text-amber-700 font-medium">{gaps} DRAP record gap{gaps === 1 ? '' : 's'}</span> : <span className="text-emerald-600 font-medium flex items-center gap-1"><Icon name="check" size={12} /> DRAP records complete</span>, <span className="text-slate-500 font-medium">{(s.low_stock ?? stock?.low_stock ?? 0) > 0 ? `${stock?.out_of_stock || 0} out of stock` : stock ? `${money(stock.value_at_cost)} at cost` : ''}</span>] },
    { label: 'Till Register Status', value: till ? 'Online' : 'Closed', tone: till ? 'emerald' : 'slate', text: true, foot: [till ? `${till.counter} · expected ${money(till.expected)}` : 'Open a till in Cash Flow', null] },
  ];

  return (
    <div className="space-y-6 w-full">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      {confirmDialog}

      {/* Banner */}
      <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#0284c7]" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#0b1f3d] tracking-tight flex items-center gap-2 font-headline m-0">
              Welcome, {user?.full_name}
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${till ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{till ? 'Shift Active' : 'No shift open'}</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1 mb-0">
              Role: <strong className="text-slate-800">{user?.role}</strong>{user?.department ? ` • ${user.department}` : ''} • {config.pharmacy_name || (hospitalMode ? 'Hospital' : 'Pharmacy')}. Use the menu or the hotkey launchpads below to enter a workstation.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-600 bg-slate-50 px-3.5 py-2 rounded-md border border-slate-200 shrink-0">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" /><span>SQLite WAL Engine</span></div>
            <span className="text-slate-300">|</span>
            <div>Business day: <span className="font-bold text-slate-800 font-mono">{ph?.business_date || '—'}</span></div>
            <span className="text-slate-300">|</span>
            <div>Latency: <span className={`font-mono font-bold ${health.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{health.ms == null ? '—' : `${health.ms}ms`}</span></div>
          </div>
        </div>
      </section>

      {/* Medicine lookup — "do we have it, what does it cost, when does it expire" without starting a sale */}
      {!management && (can('pharmacy.sell') || can('inventory.view')) && <Lookup onError={setErr} />}

      {/* KPIs */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...cards, ...cards2].map((c) => <Kpi key={c.label} {...c} />)}
        </div>
      </section>

      {/* Things that must be acted on, loudest first (the counter's home; the management KPIs carry the counts) */}
      {!management && expiry?.expired?.batches > 0 && (
        <Banner tone="rose" icon="warning" title={`${expiry.expired.batches} expired batch${expiry.expired.batches === 1 ? '' : 'es'} still on the shelf`}
          action={can('inventory.manage') && <button type="button" className="h-8 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold" disabled={busy} onClick={quarantineExpired}>Quarantine all</button>}>
          {expiry.expired.units} units, {money(expiry.expired.value)} at cost. Expired medicine must not be sold or displayed — dispensing already skips it, but the stock needs to be pulled and quarantined.
        </Banner>
      )}
      {!management && stock?.quarantined_batches > 0 && (
        <Banner tone="amber" icon="box" title={`${stock.quarantined_batches} batch${stock.quarantined_batches === 1 ? '' : 'es'} in quarantine`}
          action={can('vendor.view') && <Link to="/vendors" className={BTN_SM}>Vendor reclaim</Link>}>
          {stock.quarantined_units} units held out of sale, {money(stock.quarantined_value)} at cost. Raise a vendor reclaim or write them off.
        </Banner>
      )}
      {!management && compliance?.total > 0 && (
        <Banner tone="sky" icon="shield" title={`Drug-record gaps (${compliance.total})`} action={can('inventory.view') && <Link to="/inventory" className={BTN_SM}>Fix in inventory</Link>}>
          {[compliance.missing_drap_reg > 0 && `${compliance.missing_drap_reg} medicine(s) with no DRAP registration number`,
            compliance.missing_batch_info > 0 && `${compliance.missing_batch_info} batch(es) missing a batch number or expiry date`,
            compliance.missing_mrp > 0 && `${compliance.missing_mrp} product(s) with no MRP recorded`,
            compliance.priced_above_mrp > 0 && `${compliance.priced_above_mrp} product(s) priced above their MRP`].filter(Boolean).join(' · ')}
        </Banner>
      )}

      {/* States that should not coexist (QA S2-09): sales with no till, a
          margin no pharmacy trades at, an outlier bill, one medicine at two
          prices, a till left open overnight, undated stock. Shown to everyone. */}
      {(ph?.alerts || []).map((a) => (
        <Banner key={a.code} tone={a.severity === 'danger' ? 'rose' : 'amber'} icon="warning" title={a.title}
          action={a.code === 'SALES_OUTSIDE_TILL' || a.code === 'STALE_TILL' ? <Link to="/cashflow" className={BTN_SM}>Cash Flow</Link> : a.code === 'BATCH_NO_EXPIRY' ? <Link to="/inventory" className={BTN_SM}>Inventory</Link> : null}>
          {a.detail}
        </Banner>
      ))}

      {/* Launchpads */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 m-0">Service Workstations &amp; Quick Action Hub</h3>
          <span className="text-xs text-slate-400">Use shortcut keys or click a tile to enter a workstation</span>
        </div>
        {/* One compact row (UI report 8.7 / N3): the sidebar already carries
            these destinations; the tiles are the F-key map, not a second menu.
            The description is the tooltip. */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {tiles.map((t) => (
            <Link key={t.to} to={t.to} title={t.desc} className="group flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:border-[#0284c7] hover:shadow-md transition-all duration-150 no-underline text-inherit min-w-0">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-[#0284c7] flex items-center justify-center shrink-0"><Icon name={t.icon} size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-extrabold text-[#0b1f3d] group-hover:text-[#0284c7] font-headline leading-tight truncate">{t.title}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {t.key && <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 font-mono">{t.key}</span>}
                  {t.badge && <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200">{t.badge}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Activity: register + indents */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div>
              <h3 className="text-sm font-bold text-[#0b1f3d] m-0 font-headline">{hospitalMode ? 'Active Tokens & Consultation Queue' : "Today's Dispensing Register"}</h3>
              <p className="text-xs text-slate-500 m-0">{hospitalMode ? 'Live feed from OPD reception and primary triage desk' : 'The latest bills raised at the counter, newest first'}</p>
            </div>
            <span className="text-xs font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded">{till ? `${till.counter} · opened ${fmtTime(till.opened_at)}` : 'No till session'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-y border-slate-100">
                <tr><th className="py-2.5 px-3">Bill #</th><th className="py-2.5 px-3">Time</th><th className="py-2.5 px-3">Customer</th><th className="py-2.5 px-3">Category</th><th className="py-2.5 px-3 text-right">Amount</th><th className="py-2.5 px-3 text-right">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {(ph?.recent_sales || []).slice(0, 8).map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-mono font-bold text-[#0284c7] whitespace-nowrap">{b.bill_no}</td>
                    <td className="py-3 px-3 font-mono text-slate-500">{fmtTime(b.created_at)}</td>
                    <td className="py-3 px-3 font-medium max-w-[14rem] truncate" title={b.buyer}>{b.buyer}{b.patient_code ? <span className="text-slate-400 font-mono font-normal"> · {b.patient_code}</span> : null}</td>
                    <td className="py-3 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${b.category === 'Paid' ? 'bg-slate-100 text-slate-700' : b.category === 'Complete Free' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{b.category}</span></td>
                    <td className="py-3 px-3 text-right font-mono font-semibold whitespace-nowrap">{money(b.net_amount)}</td>
                    <td className="py-3 px-3 text-right whitespace-nowrap"><span className={`px-2 py-0.5 rounded font-medium ${b.payment_method === 'credit' ? 'bg-amber-50 text-amber-700' : b.status === 'amended' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{b.payment_method === 'credit' ? 'On account' : b.status === 'amended' ? 'Amended' : 'Paid'}</span></td>
                  </tr>
                ))}
                {ph && (ph.recent_sales || []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No bills yet today.</td></tr>}
                {!ph && <tr><td colSpan={6} className="py-6 text-center text-slate-500">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>Showing the latest {Math.min(8, (ph?.recent_sales || []).length)} bills of {ph?.business_date || 'today'}</span>
            <span className="flex items-center gap-3">
              {can('return.manage') && <Link to="/returns" className="text-slate-600 hover:underline font-semibold">Process a return</Link>}
              <Link to="/pharmacy-close" className="text-[#0284c7] hover:underline font-semibold">View the day book →</Link>
            </span>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm flex flex-col justify-between self-start">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="text-sm font-bold text-[#0b1f3d] m-0 font-headline">Ward &amp; Unit Indents</h3>
              <span className={`w-2.5 h-2.5 rounded-full ${indents.length ? 'bg-amber-500' : 'bg-emerald-500'}`} title="Requests awaiting pharmacy dispatch" />
            </div>
            <p className="text-xs text-slate-500 mb-4">{indents.length ? 'Medication & consumable requisitions awaiting dispense' : 'Nothing awaiting dispense'}</p>
            <div className="space-y-3">
              {indents.slice(0, 4).map((r) => (
                <div key={r.id} className="p-3 bg-slate-50 rounded border border-slate-200 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{r.department_name}{r.patient_name ? ` (${r.patient_name})` : ''}</div>
                    <div className="text-[11px] text-slate-500 truncate font-mono">{r.request_no} • {r.collected_by_name || 'collector not named'}</div>
                  </div>
                  <span className={`px-2 py-1 text-[11px] font-bold rounded whitespace-nowrap ${r.emergency_lines > 0 ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{r.emergency_lines > 0 ? 'Urgent ' : ''}{r.line_count} Line{r.line_count === 1 ? '' : 's'}</span>
                </div>
              ))}
              {indents.length > 4 && <div className="text-[11px] text-slate-500">+ {indents.length - 4} more in the queue</div>}
            </div>
          </div>
          {indents.length > 0 ? (
            <button type="button" onClick={() => nav('/departments')} disabled={!can('pharmacy.dispense')}
              className="w-full mt-4 py-2 px-3 bg-[#0b1f3d] hover:bg-[#122e54] disabled:opacity-40 text-white rounded text-xs font-bold transition-colors text-center">
              Process Requisitions Now
            </button>
          ) : (
            <Link to="/departments" className="block mt-3 text-xs text-[#0284c7] font-semibold hover:underline">Open the requisition queue →</Link>
          )}
        </div>
      </section>

      {/* The counter's own panels */}
      {!management && ph && expiry && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card flush title="Reorder List" sub="At or under the reorder level — order back to a month's cover" right={<>{(ph.reorder || []).length ? <Pill tone="amber">{ph.reorder.length} to order</Pill> : <Pill tone="emerald">all above reorder</Pill>}{can('inventory.manage') && <Link to="/inventory" className={BTN_SM}>Receive stock</Link>}</>}>
            {(ph.reorder || []).length === 0 ? <Empty>Every item is above its reorder level.</Empty> : (
              <Tbl head={['Medicine', 'On hand', 'Reorder at', 'Used (30 d)', 'Suggest']} right={[1, 2, 3, 4]} dense>
                {ph.reorder.map((r) => {
                  const target = Math.max(r.used_30d, r.reorder_level); const suggest = Math.max(0, target - r.on_hand);
                  const perBox = (r.units_per_strip || 1) * (r.strips_per_box || 1); const boxes = perBox > 1 ? Math.ceil(suggest / perBox) : null;
                  return (
                    <tr key={r.id}>
                      <td className="font-semibold text-slate-900">{r.name}{strengthOf(r) ? <span className="text-slate-500 font-normal"> {strengthOf(r)}</span> : null}</td>
                      <td className="text-right"><Pill tone={r.on_hand <= 0 ? 'rose' : 'amber'} mono>{r.on_hand}</Pill></td>
                      <td className="text-right font-mono">{r.reorder_level}</td>
                      <td className="text-right font-mono">{r.used_30d}</td>
                      <td className="text-right font-mono"><b>{suggest}</b> <span className="text-slate-500">{r.unit || ''}</span>{boxes ? <div className="text-[10px] text-slate-500">order {boxes} box{boxes === 1 ? '' : 'es'}</div> : null}</td>
                    </tr>
                  );
                })}
              </Tbl>
            )}
          </Card>

          <Card flush title="Expiry & Claims" sub="Soonest first — the order FEFO takes them" right={<><Pill tone="slate" mono>claim window {expiry.claim_window_days} d</Pill><Link to="/reports/expiry" className={BTN_SM}>Full ledger</Link></>}>
            <div className="grid grid-cols-4 gap-2 p-4 border-b border-slate-100">
              {[['rose', 'Expired', expiry.expired, 'off the shelf'], ['amber', 'Within 30 days', expiry.within_30, 'sell first'], ['sky', `Within ${expiry.near_expiry_days} days`, expiry.near, 'watch'], ['emerald', 'Still claimable', expiry.claimable, 'return to supplier']].map(([tone, label, b, note]) => (
                <div key={label} className={`rounded-md border px-3 py-2 ${{ rose: 'border-rose-200 bg-rose-50/40', amber: 'border-amber-200 bg-amber-50/40', sky: 'border-blue-200 bg-blue-50/40', emerald: 'border-emerald-200 bg-emerald-50/40' }[tone]}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
                  <div className={`font-mono font-extrabold text-xl ${{ rose: 'text-rose-700', amber: 'text-amber-700', sky: 'text-[#0284c7]', emerald: 'text-emerald-700' }[tone]}`}>{b.units}</div>
                  <div className="text-[10px] text-slate-500">{b.batches} batch{b.batches === 1 ? '' : 'es'} · {money(b.value)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wide text-slate-600 mt-1">{note}</div>
                </div>
              ))}
            </div>
            {expiry.batches.length === 0 ? <Empty>No batch expires within {expiry.near_expiry_days} days.</Empty> : (
              <Tbl head={['Medicine', 'Batch', 'Expires', 'Qty', 'Value', '']} right={[3, 4, 5]} dense>
                {expiry.batches.slice(0, 6).map((b) => (
                  <tr key={b.id} className={b.quarantined ? 'opacity-60' : ''}>
                    <td><div className="font-semibold text-slate-900">{b.name}{strengthOf(b) ? <span className="text-slate-500 font-normal"> {strengthOf(b)}</span> : null}</div>{b.vendor_name && <div className="text-[10px] text-slate-500">{b.vendor_name}</div>}</td>
                    <td className="font-mono">{b.batch_no || '—'}</td>
                    <td className="font-mono">{b.expiry_date} <Pill tone={b.days_left < 0 ? 'rose' : b.days_left <= 30 ? 'rose' : 'amber'}>{b.days_left < 0 ? 'expired' : `${b.days_left}d left`}</Pill></td>
                    <td className="text-right font-mono">{b.quantity}</td>
                    <td className="text-right font-mono">{money(b.quantity * b.cost_price)}</td>
                    <td className="text-right">{b.quarantined ? <Pill tone="rose">quarantined</Pill> : can('inventory.manage') ? <button type="button" className={`${BTN_SM} !text-rose-700`} onClick={() => quarantine(b)}>Pull</button> : null}</td>
                  </tr>
                ))}
              </Tbl>
            )}
          </Card>

          <Card title="Moving Today" sub="Units out per medicine, today" right={<Pill tone="slate">{sales?.distinct_items || 0} distinct item{sales?.distinct_items === 1 ? '' : 's'}</Pill>}>
            {(ph.top_sellers || []).length === 0 ? <Empty>Nothing dispensed yet today.</Empty> : (
              <div className="space-y-3">
                {ph.top_sellers.map((r) => { const max = ph.top_sellers.reduce((m, x) => Math.max(m, x.units), 0) || 1; return (
                  <div key={`${r.product_id}-${r.description}`}>
                    <div className="flex items-center justify-between text-xs mb-1"><span className="font-semibold text-slate-800">{r.description}</span><span className="font-mono"><b>{r.units}</b> <span className="text-slate-500">· {money(r.revenue)}</span></span></div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#0284c7]" style={{ width: `${(r.units / max) * 100}%` }} /></div>
                  </div>
                ); })}
                {sales?.subsidy + sales?.discount > 0 && <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">Free and discounted patients absorbed <b className="font-mono">{money(sales.subsidy + sales.discount)}</b> today.</div>}
              </div>
            )}
          </Card>

          <Card flush title="Controlled Drug Register" sub={controlled ? `${controlled.skus} item(s) · ${controlled.units} units held` : ''} right={<Pill tone={controlled?.today_entries ? 'violet' : 'slate'} mono>{controlled?.today_entries || 0} entries today</Pill>}>
            {!controlled || controlled.skus === 0 ? <Empty>No Schedule G or narcotic items are stocked.</Empty> : controlled.recent.length === 0 ? <Empty>No entries recorded yet.</Empty> : (
              <Tbl head={['Entry', 'Medicine', 'Qty', 'Collected by', 'Prescriber']} right={[2]} dense>
                {controlled.recent.slice(0, 6).map((r) => (
                  <tr key={r.entry_no}>
                    <td className="font-mono"><div>{r.entry_no}</div><div className="text-[10px] text-slate-500">{(r.created_at || '').slice(0, 10)}</div></td>
                    <td>{r.product_name} {SCHED[r.drug_schedule] && <Pill tone={SCHED[r.drug_schedule][0]}>{SCHED[r.drug_schedule][1]}</Pill>}</td>
                    <td className="text-right font-mono">{r.quantity}</td>
                    <td>{r.buyer_name || r.patient_name || '—'}{r.buyer_cnic && <div className="text-[10px] text-slate-500 font-mono">{r.buyer_cnic}</div>}</td>
                    <td>{r.prescriber_name || '—'}</td>
                  </tr>
                ))}
              </Tbl>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, foot, chip, text, amberFoot }) {
  const border = { sky: 'border-l-[#0284c7]', amber: 'border-l-[#f59e0b]', emerald: 'border-l-emerald-500', slate: 'border-l-slate-400' }[tone] || 'border-l-slate-400';
  const colour = { sky: 'text-[#0284c7]', amber: 'text-[#d97706]', emerald: 'text-emerald-600', slate: 'text-slate-900' }[tone] || 'text-slate-900';
  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-5 shadow-sm relative overflow-hidden flex flex-col justify-between border-l-4 ${border}`}>
      <div>
        <span className="text-[11px] font-bold text-slate-500 tracking-wider uppercase">{label}</span>
        <div className={`text-[clamp(1.35rem,1.9vw,1.875rem)] font-black mt-2 font-headline tracking-tight whitespace-nowrap tabular-nums ${colour}`}>{value}</div>
      </div>
      {chip ? (
        <div className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded w-fit mt-3">{chip}</div>
      ) : (
        <div className={`text-[11px] font-medium mt-3 flex flex-wrap items-center gap-x-3 gap-y-0.5 ${amberFoot ? 'text-amber-700' : 'text-slate-500'}`}>
          <span>{foot?.[0]}</span>{foot?.[1]}
        </div>
      )}
    </div>
  );
}

function Banner({ tone, icon, title, action, children }) {
  const t = { rose: 'bg-rose-50 border-rose-200 text-rose-900', amber: 'bg-amber-50 border-amber-200 text-amber-900', sky: 'bg-blue-50 border-blue-200 text-blue-900' }[tone];
  const ic = { rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700', sky: 'bg-blue-100 text-[#0284c7]' }[tone];
  return (
    <div className={`rounded-lg border px-5 py-4 flex items-start justify-between gap-4 ${t}`}>
      <div className="flex items-start gap-3"><div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${ic}`}><Icon name={icon} size={16} /></div><div><div className="text-sm font-bold">{title}</div><div className="text-xs mt-0.5 opacity-90">{children}</div></div></div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// One box the pharmacist types or scans into to answer "do we have it, what
// does it cost, which batch, when does it expire" without starting a sale.
function Lookup({ onError }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows(null); return undefined; }
    const t = setTimeout(() => { api.get(`/pharmacy/lookup?q=${encodeURIComponent(term)}`).then(setRows).catch((e) => onError(e.message)); }, 250);
    return () => clearTimeout(t);
  }, [q, onError]);
  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="p-4 flex items-center gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400"><Icon name="barcode" size={18} /></div>
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            className="block w-full h-11 min-h-0 pl-11 pr-28 py-0 text-sm bg-white border-[1.5px] border-slate-300 rounded-md focus:border-[#0284c7] focus:ring-1 focus:ring-[#0284c7] font-medium text-slate-900 placeholder-slate-400"
            placeholder="Look up a medicine — brand, generic, DRAP number, or scan a barcode…" />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center"><span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">[F2] Search</span></div>
        </div>
        {q && <button type="button" className={BTN_SM} onClick={() => { setQ(''); setRows(null); setOpen(null); }}>Clear</button>}
      </div>
      {rows && rows.length === 0 && <div className="px-4 pb-4 text-xs text-slate-500">No medicine matches “{q}”.</div>}
      {rows && rows.length > 0 && (
        <div className="border-t border-slate-200 divide-y divide-slate-100">
          {rows.map((p) => (
            <div key={p.id} className="px-4 py-3">
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 items-center cursor-pointer" role="button" tabIndex={0} onClick={() => setOpen(open === p.id ? null : p.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(open === p.id ? null : p.id); }}>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">{p.name}{p.strength && <span className="text-slate-500 font-normal">{p.strength}</span>}{SCHED[p.drug_schedule] && <Pill tone={SCHED[p.drug_schedule][0]}>{SCHED[p.drug_schedule][1]}</Pill>}{p.is_refrigerated ? <Pill tone="sky">2–8 °C</Pill> : null}</div>
                  <div className="text-[11px] text-slate-500">{[p.generic_name, p.form, p.units_per_strip > 1 ? `${p.units_per_strip}/strip` : null, p.strips_per_box > 1 ? `${p.strips_per_box} strips/box` : null, p.drap_reg_no ? `DRAP ${p.drap_reg_no}` : 'no DRAP number'].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-right min-w-[92px]"><div className="font-mono font-extrabold text-base">{money(p.units_per_strip > 1 ? p.strip_price : p.sale_price)}</div><div className="text-[11px] text-slate-500">{p.units_per_strip > 1 ? `/strip · ${money(p.sale_price)}/${p.unit}` : `MRP ${p.mrp > 0 ? money(p.mrp) : '—'}`}</div></div>
                <div className="text-right min-w-[92px]"><div className={`font-mono font-extrabold text-base ${p.sellable <= 0 ? 'text-rose-700' : ''}`}>{p.sellable}</div><div className="text-[11px] text-slate-500">{p.stock_label || 'sellable'}</div></div>
              </div>
              {open === p.id && (
                <div className="mt-3 bg-slate-50 border border-slate-200 rounded-md overflow-hidden">
                  {p.batches.length === 0 ? <div className="p-3 text-xs text-slate-500">No stock in any batch.</div> : (
                    <Tbl head={['Batch', 'Expiry', 'Qty', 'Cost', 'Pack MRP', '']} right={[2, 3, 4]} dense>
                      {p.batches.map((b) => (
                        <tr key={b.id} className={b.quarantined ? 'opacity-60' : ''}>
                          <td className="font-mono">{b.batch_no || '—'}</td>
                          <td className="font-mono">{b.expiry_date || '—'} {b.expiry_date && <Pill tone={b.days_left < 0 ? 'rose' : b.days_left <= 30 ? 'rose' : b.days_left <= 90 ? 'amber' : 'emerald'}>{b.days_left < 0 ? 'expired' : `${b.days_left}d`}</Pill>}</td>
                          <td className="text-right font-mono">{b.quantity}</td><td className="text-right font-mono">{money(b.cost_price)}</td><td className="text-right font-mono">{b.mrp > 0 ? money(b.mrp) : '—'}</td>
                          <td className="text-right">{b.quarantined ? <Pill tone="rose">quarantined</Pill> : ''}</td>
                        </tr>
                      ))}
                    </Tbl>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
