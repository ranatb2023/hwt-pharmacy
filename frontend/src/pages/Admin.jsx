import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Select from '../components/Select.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { printPaper } from '../print.js';
import {
  BTN, BTN_PRIMARY, BTN_DARK, BTN_SM, CTL, NUM, LABEL, HINT,
  PageHead, Notice, Kpi, Card, Pill, Chips, Search, Field, Toggle, Tbl, Avatar, Empty, Bar,
} from '../components/ws/admin.jsx';

// Administration — Phase 10, the pharmacy_admin_* screens in the sidebar frame.
//
// One route per tab (/admin/<tab>) so the sidebar deep-links into each screen.
// Every handler and payload below is what the earlier phases verified; the
// mockups became the skin. What a mockup shows and the record does not hold
// (prescriber licences, supervisor PINs, hash chains, cluster telemetry) is
// listed in PHASE-10 and not drawn.

const TABS = {
  users: Users, roles: Roles, employees: Employees, catalogue: Catalogue,
  dialysis: DialysisForm, settings: Settings, audit: AuditLog, subsidy: Subsidy, sync: Sync,
};

export default function Admin() {
  const { can } = useAuth();
  const { tab: routeTab } = useParams();
  const nav = useNavigate();
  const tab = routeTab && TABS[routeTab] ? routeTab : 'users';
  useEffect(() => { if (!routeTab) nav('/admin/users', { replace: true }); }, [routeTab, nav]);
  if (tab === 'sync' && !can('sync.manage')) return <Empty>Sync needs the sync-manage permission.</Empty>;
  const Screen = TABS[tab];
  return <Screen can={can} />;
}

// ---------------------------------------------------------------------------
// Settings — `system_settings_rules_workstation` / `system_settings_drap_regulatory_workstation`
// ---------------------------------------------------------------------------
const ROUNDING_OPTIONS = [
  ['none', 'No rounding — bill the exact paisa'],
  ['rupee', 'Round each line to the nearest rupee'],
  ['five', 'Round each line to the nearest Rs 5'],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Settings() {
  const [form, setForm] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/settings').then((r) => {
      const f = { ...r.settings };
      f.discount_pct = Math.round(f.discount_pct * 100);
      f.staff_pct = Math.round(f.staff_pct * 100);
      f.counter_discount_pct = Math.round(f.counter_discount_pct * 100);
      setForm(f);
    }).catch((e) => setErr(e.message));
  }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = useCallback(async () => {
    if (!form || busy) return;
    setErr(''); setMsg(''); setBusy(true);
    try {
      await api.put('/settings', {
        ...form,
        discount_pct: Number(form.discount_pct) / 100,
        staff_pct: Number(form.staff_pct) / 100,
        counter_discount_pct: Number(form.counter_discount_pct) / 100,
      });
      setMsg('Settings saved. Sign out and back in for a deployment-mode change to take effect.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [form, busy]);

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  if (!form) return <Empty>Loading…</Empty>;
  const isHospital = form.deployment_mode === 'hospital';
  const num = (k, label, hint, unit, step = '1') => (
    <Field key={k} label={label} hint={hint}>
      <div className="relative">
        <input type="number" min="0" step={step} className={`${NUM} ${unit ? 'pr-14' : ''}`} value={form[k] ?? ''} onChange={set(k)} />
        {unit && <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-500">{unit}</span>}
      </div>
    </Field>
  );
  const SaveBtn = <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy}><Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save Settings'} <kbd className="kbd-hint text-[10px] font-mono bg-blue-800/60 px-1.5 py-0.5 rounded border border-blue-300/40">Ctrl+S</kbd></button>;

  return (
    <>
      <PageHead title="System Settings" sub="Administrator-configurable. Changes apply to new bills, counter sales and receipts immediately; existing records are unchanged." right={SaveBtn} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <Notice title="System Settings & Rules" right={<Pill tone="sky" mono>LIVE PRODUCTION</Pill>}>Changes apply to all new bills, counter sales and receipts immediately.</Notice>

      <Card title="Operational Mode" right={<span className="text-[11px] font-mono text-slate-500">NODE_PROFILE_CONFIG</span>}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <Field label="Hospital / Pharmacy Operational Mode" className="lg:col-span-7">
            <Select value={form.deployment_mode} onChange={set('deployment_mode')}>
              <option value="pharmacy">Standalone Pharmacy — Phase 1 (sales, inventory, vendors, dialysis & cash)</option>
              <option value="hospital">Integrated Hospital Suite — Phase 2 (patients, tokens, clinic, laboratory)</option>
            </Select>
          </Field>
          <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-xs text-slate-600 flex items-start gap-2 mt-0 lg:mt-7">
            <Icon name="shield" size={14} />
            <span>{isHospital
              ? 'Every module is active: patients, tokens, consultations, laboratory and dialysis alongside the pharmacy.'
              : 'In standalone mode the hospital modules (patients, tokens, clinic, laboratory) stay hidden. Ward indents and dialysis run. No data is lost either way.'}</span>
          </div>
        </div>
      </Card>

      <Card title="Pharmacy Information (printed on bills & receipts)" right={<Pill tone="sky">Printed on cash memo & day-end report</Pill>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {(!form.pharmacy_license_no || !form.pharmacy_address || !form.pharmacy_contact) && (
            <div className="md:col-span-3 text-xs text-rose-900 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              <b>Required for a complete slip.</b> A retail pharmacy invoice carries the pharmacy's name and address and its drug sale licence number; the footer reads "Licence not recorded" and every slip and day-end sheet prints without it until these are filled in.
            </div>
          )}
          <Field label="Pharmacy Name *" hint="Appears on the receipt header and the day-end sheet."><input className={CTL} value={form.pharmacy_name ?? ''} onChange={set('pharmacy_name')} /></Field>
          <Field label="Drug Sale Licence Number *" hint="Retail pharmacy licence — printed on every receipt."><input className={`${CTL} font-mono ${!form.pharmacy_license_no ? '!border-rose-400' : ''}`} value={form.pharmacy_license_no ?? ''} onChange={set('pharmacy_license_no')} placeholder="e.g. DSL-09/LHR/PB-2024-8841" /></Field>
          <Field label="Phone Number *"><input className={`${CTL} font-mono ${!form.pharmacy_contact ? '!border-rose-400' : ''}`} value={form.pharmacy_contact ?? ''} onChange={set('pharmacy_contact')} placeholder="+92 42 … / 0300-…" /></Field>
          <Field label="Pharmacy Address *" className="md:col-span-3"><input className={`${CTL} ${!form.pharmacy_address ? '!border-rose-400' : ''}`} value={form.pharmacy_address ?? ''} onChange={set('pharmacy_address')} /></Field>
        </div>
        <p className="text-[11px] text-slate-500 mt-4 mb-0">Lead pharmacist name and registration, and the tax / NTN number, are not held yet — they are on the client's question list before a setting is added.</p>
      </Card>

      <Card title="Sales & Medicine Rules" right={<span className="text-xs text-slate-500">Enforced at the counter</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {num('counter_discount_pct', 'Maximum discount a cashier can give without an override (%)', 'Above this the sale needs billing override.', '%')}
          {num('near_expiry_days', 'Near-expiry alert (days before expiry)', 'Amber warning at the counter and on the shelf.', 'Days')}
          {num('expiry_claim_days', 'Return-to-distributor window for expiring stock (days)', 'How far ahead distributors accept expiry claims.', 'Days')}
          {num('max_parked_sales', 'Maximum held bills at the counter at one time', 'Customers on hold at once.')}
        </div>
        <div className="grid grid-cols-1 gap-3 mt-5">
          <Toggle checked={Number(form.enforce_mrp) === 1} onChange={(v) => setForm({ ...form, enforce_mrp: v ? 1 : 0 })}
            title="Block selling medicine above the government printed price (MRP)" sub="Prevents any bill line from exceeding the notified maximum retail price." />
          <Toggle checked={Number(form.enforce_rx) === 1} onChange={(v) => setForm({ ...form, enforce_rx: v ? 1 : 0 })}
            title="Require a doctor's prescription for Rx and Schedule G medicine" sub="The cashier must enter the prescriber and prescription reference before billing." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-5">
          <Field label="Loose-sale rounding" hint="A whole strip still bills at its printed price; only a loose line is rounded.">
            <Select value={form.loose_rounding || 'rupee'} onChange={(e) => setForm({ ...form, loose_rounding: e.target.value })}>
              {ROUNDING_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Fiscal year starts in" hint="Staff allowances and the annual reports run on this year.">
            <Select value={String(form.fiscal_year_start_month ?? 7)} onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          {num('tz_offset_hours', 'Time zone offset from UTC (hours)', 'Pakistan Standard Time is +5. Every business day is filed on it.', 'h')}
        </div>
      </Card>

      <Card title="Discounts & Welfare Rules" right={<Pill tone="emerald">Trust board approved</Pill>}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {num('discount_pct', 'Standard discount for the Discounted category (%)', 'Applied when no welfare card decides the price.', '%')}
          {num('staff_pct', 'Share of a staff bill covered by the allowance (%)', '100 = the allowance pays the whole bill until it runs out.', '%')}
          {num('staff_annual_cap', 'Staff annual medicine allowance — trust default (Rs)', 'Per employee, per fiscal year; a person can be given their own cap.', 'Rs')}
          {num('refund_auth_threshold', 'Refund amount needing billing override (Rs)', 'Above this a refund needs someone with billing override.', 'Rs')}
          {isHospital && num('consultation_fee', 'Consultation fee (Rs)', null, 'Rs', '0.01')}
          {isHospital && num('dialysis_charge', 'Dialysis base charge (Rs)', null, 'Rs', '0.01')}
        </div>
        {!isHospital && <p className="text-[11px] text-slate-500 mt-4 mb-0">Consultation and dialysis base charges apply once the hospital modules are switched on. Their saved values are kept.</p>}
      </Card>

      <div className="flex items-center justify-between gap-3 bg-white rounded-lg border border-slate-200 px-5 py-3 shadow-sm">
        <span className="text-xs text-slate-500 flex items-center gap-2"><Icon name="check" size={14} /> Every rule above is read by the counter, the receipt and the reports — there is no second copy.</span>
        {SaveBtn}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Users — `users_roles_prescribers_governance_workstation` / `staff_users_directory_workstation`
// ---------------------------------------------------------------------------
function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [chip, setChip] = useState('all');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ username: '', full_name: '', password: '', role_id: '', department: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const load = useCallback(() => {
    api.get('/users').then(setUsers).catch((e) => setErr(e.message));
    api.get('/users/roles').then((r) => setRoles(r.roles)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  async function create(e) {
    e.preventDefault(); setErr('');
    try {
      await api.post('/users', { ...f, role_id: Number(f.role_id) });
      setMsg(`${f.full_name} can now sign in as ${f.username}.`);
      setF({ username: '', full_name: '', password: '', role_id: '', department: '' }); setAdding(false); load();
    } catch (e2) { setErr(e2.message); }
  }
  async function toggle(u) {
    try { await api.put(`/users/${u.id}/active`, { is_active: u.is_active ? 0 : 1 }); load(); } catch (e2) { setErr(e2.message); }
  };
  // QA S2-12: lift a lockout early.
  const unlock = async (u) => {
    try { await api.post(`/users/${u.id}/unlock`, {}); load(); } catch (e2) { setErr(e2.message); }
  }

  const roleNames = [...new Set(users.map((u) => u.role))];
  const rows = users
    .filter((u) => chip === 'all' || u.role === chip)
    .filter((u) => !q.trim() || [u.full_name, u.username, u.department, u.role].some((s) => (s || '').toLowerCase().includes(q.trim().toLowerCase())));
  const roleTone = (r) => (/admin/i.test(r) ? 'violet' : /pharm/i.test(r) ? 'sky' : /cash/i.test(r) ? 'amber' : /doctor/i.test(r) ? 'rose' : 'slate');

  return (
    <>
      <PageHead title="Staff & Users Directory" sub="Who can sign in, and as what. An employee who only buys at the staff rate is not a user — they are on the Employees screen."
        right={<>
          <Search value={q} onChange={setQ} placeholder="Quick search staff…" className="w-64" />
          <button type="button" className={BTN_PRIMARY} onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add Staff Member</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Total staff members" value={users.length} unit={(users.length) === 1 ? 'user' : 'users'} icon="patients" sub="Registered on this server" />
        <Kpi label="Active accounts" value={users.filter((u) => u.is_active).length} unit="active" tone="emerald" icon="check" sub="Can sign in on the LAN" />
        <Kpi label="Signed in recently" value={users.filter((u) => u.last_login && Date.now() - new Date(`${String(u.last_login).replace(' ', 'T')}Z`) < 7 * 86400000).length} unit="this week" tone="sky" icon="clock" sub="From the last-login stamp" />
        <Kpi label="Roles in use" value={roleNames.length} unit={(roleNames.length) === 1 ? 'role' : 'roles'} icon="shield" sub={roleNames.slice(0, 3).join(', ')} />
      </div>

      <div className={`grid grid-cols-1 ${adding ? 'xl:grid-cols-12' : ''} gap-6 items-start`}>
        <Card className={adding ? 'xl:col-span-8' : ''} flush
          title="Enterprise User Roster" sub={`Showing ${rows.length} of ${users.length} staff accounts`}
          right={<Chips value={chip} onChange={setChip} items={[['all', 'All Users', users.length], ...roleNames.map((r) => [r, r, users.filter((u) => u.role === r).length])]} />}>
          <Tbl stack head={['Staff member', 'Username / department', 'Assigned role', 'Last sign-in', 'Status', 'Actions']} right={[5]}>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><div className="flex items-center gap-3"><Avatar name={u.full_name} tone={roleTone(u.role)} /><div><div className="font-bold text-slate-900 text-[13px]">{u.full_name}</div><div className="text-[11px] text-slate-500">User #{u.id}</div></div></div></td>
                <td><span className="font-mono text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">{u.username}</span><div className="text-[11px] text-slate-500 mt-1">{u.department || '—'}</div></td>
                <td><Pill tone={roleTone(u.role)}>{u.role}</Pill></td>
                <td className="font-mono text-slate-600">{u.last_login ? String(u.last_login).slice(0, 16) : 'never'}</td>
                <td><Pill tone={u.locked ? 'amber' : u.is_active ? 'emerald' : 'rose'}>{u.locked ? 'LOCKED' : u.is_active ? 'ACTIVE' : 'INACTIVE'}</Pill></td>
                <td className="text-right">
                  {u.locked ? <button type="button" className={`${BTN_SM} !text-amber-800 mr-1`} onClick={() => unlock(u)} title={`Locked until ${u.locked_until} UTC after repeated failed sign-ins`}>Unlock</button> : null}
                  <button type="button" className={`${BTN_SM} ${u.is_active ? '!text-rose-700' : '!text-emerald-700'}`} onClick={() => toggle(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}><Empty>No staff account matches.</Empty></td></tr>}
          </Tbl>
        </Card>

        {adding && (
          <Card className="xl:col-span-4" title="Add New Staff Member" sub="Login details — the person can change the password on first sign-in"
            right={<button type="button" className={BTN_SM} onClick={() => setAdding(false)}>Close</button>}>
            <form onSubmit={create} className="space-y-4">
              <Field label="Full name" required hint="Shown on receipts and the audit trail."><input className={CTL} value={f.full_name} onChange={set('full_name')} required autoFocus placeholder="e.g. Dr. Hamza Tariq" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username" required><input className={`${CTL} font-mono`} value={f.username} onChange={set('username')} required placeholder="hamza.pharm" /></Field>
                <Field label="Password" required><input type="password" className={`${CTL} font-mono`} value={f.password} onChange={set('password')} required /></Field>
              </div>
              <Field label="User role" required hint="What the account may do — see Roles & Permissions.">
                <Select value={f.role_id} onChange={set('role_id')} required><option value="">— Select —</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
              </Field>
              <Field label="Department"><input className={CTL} value={f.department} onChange={set('department')} placeholder="e.g. Central Pharmacy" /></Field>
              <p className="text-[11px] text-slate-500 m-0">Council licence numbers and prescriber authority are not held on a user — on the client's question list.</p>
              <button type="submit" className={`${BTN_PRIMARY} w-full justify-center`}>Create user account</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Roles — `roles_permissions_governance_matrix`
// ---------------------------------------------------------------------------
const PERM_GROUPS = [
  ['Counter & billing', ['pharmacy.sell', 'pharmacy.dispense', 'billing.view', 'billing.manage', 'billing.override', 'billing.amend', 'return.manage', 'cash.manage']],
  ['Stock & pricing', ['inventory.view', 'inventory.manage', 'vendor.view', 'vendor.manage']],
  ['Customers & welfare', ['patient.view', 'patient.manage', 'dialysis.view', 'dialysis.manage', 'donor.manage']],
  ['Hospital modules (on hold)', ['token.manage', 'consult.manage', 'lab.view', 'lab.manage']],
  ['Administration', ['user.manage', 'report.view', 'audit.view', 'sync.manage']],
];
const PERM_TEXT = {
  'pharmacy.sell': ['Dispense medicine & print bills', 'Ring up sales at the counter, hold and resume baskets, print receipts.'],
  'pharmacy.dispense': ['Dispense against slips & indents', 'Work the department requisition queue and issue FEFO.'],
  'billing.view': ['View bills & accounts', 'Read bills, credit accounts and statements.'],
  'billing.manage': ['Manage accounts & settle', 'Open credit accounts, set limits, take settlements.'],
  'billing.override': ['Approve extra discounts & high refunds', 'Above the counter cap or the refund threshold.'],
  'billing.amend': ['Correct a closed bill', 'Credit note plus corrected bill, never an edit.'],
  'return.manage': ['Customer returns & refunds', 'Take stock back, restock or write off, refund.'],
  'cash.manage': ['Till sessions & cash movements', 'Open, move cash, count and close the till.'],
  'inventory.view': ['See the shelf', 'Products, batches, expiry, valuation.'],
  'inventory.manage': ['Receive & adjust stock', 'GRN, new medicine master, quarantine, adjustments.'],
  'vendor.view': ['See suppliers', 'Vendor files, ledger, orders.'],
  'vendor.manage': ['Buy, pay & reclaim', 'Goods received, payment vouchers, reclaims.'],
  'patient.view': ['See customers', 'Customer files and cards.'],
  'patient.manage': ['Register customers & issue cards', 'New customers, employees, welfare cards.'],
  'dialysis.view': ['See the dialysis unit', 'Schedule, sessions, demands.'],
  'dialysis.manage': ['Run the dialysis unit', 'Register patients, schedule, issue demands.'],
  'donor.manage': ['Donor portal', 'Phase 08.'],
  'token.manage': ['Tokens & queue', 'Hospital mode.'], 'consult.manage': ['Consultations', 'Hospital mode.'],
  'lab.view': ['Laboratory (view)', 'Hospital mode.'], 'lab.manage': ['Laboratory (manage)', 'Hospital mode.'],
  'user.manage': ['Users, roles & settings', 'Administration.'],
  'report.view': ['Reports & analytics', 'Every report and the management dashboard.'],
  'audit.view': ['Audit trail', 'Read the audit log.'],
  'sync.manage': ['Offline sync', 'Run and inspect the sync engine.'],
};

function Roles() {
  const [data, setData] = useState({ roles: [], all_permissions: [] });
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [nf, setNf] = useState({ name: '', description: '', permissions: [] });
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  // On a narrow screen the role list stacks above the editor; picking a role
  // scrolls the editor into view instead of leaving it six cards down.
  const editorRef = useRef(null);
  const focusEditor = () => {
    if (!window.matchMedia('(max-width: 1279px)').matches) return;
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const load = useCallback(() => api.get('/users/roles').then((d) => { setData(d); setSel((s) => s || d.roles[0] || null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const r = await api.post('/users/roles', nf);
      setMsg(`Role "${r.name}" created with ${nf.permissions.length} permissions.`);
      setCreating(false); setNf({ name: '', description: '', permissions: [] }); load();
    } catch (e) { setErr(e.message); }
  }
  const role = creating ? null : sel;
  const has = (p) => (creating ? nf.permissions.includes(p) : !!role?.permissions.includes(p));
  const flip = (p) => setNf({ ...nf, permissions: nf.permissions.includes(p) ? nf.permissions.filter((x) => x !== p) : [...nf.permissions, p] });
  const roles = data.roles.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHead title="Roles & Permissions" sub="A role is a named set of permissions. System roles are defined in code and refreshed at every start; custom roles are yours." />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <Notice>Controlled medicines need a prescriber recorded at the counter and a CNIC for narcotics. That is enforced by the sale, not by a permission — a permission decides who may reach the counter at all.</Notice>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <Card className="xl:col-span-4" title="Roles" right={<Pill tone="slate">{data.roles.length} defined</Pill>}>
          <Search value={q} onChange={setQ} placeholder="Filter roles…" className="mb-3" />
          <div className="space-y-2">
            {roles.map((r) => (
              <button type="button" key={r.id} onClick={() => { setSel(r); setCreating(false); focusEditor(); }}
                className={`w-full text-left rounded-md border p-3 transition-colors ${!creating && sel?.id === r.id ? 'border-[#0284c7] ring-1 ring-[#0284c7] bg-blue-50/40' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900">{r.name}</div>
                  <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{r.permissions.length}</span>
                </div>
                <p className="text-xs text-slate-500 m-0 mt-1">{r.description || '—'}</p>
                <div className="mt-2"><Pill tone={r.is_system ? 'navy' : 'sky'} mono>{r.is_system ? 'SYSTEM' : 'CUSTOM'}</Pill></div>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setCreating(true); setNf({ name: '', description: '', permissions: [] }); focusEditor(); }}
            className="w-full mt-3 h-10 border border-dashed border-slate-300 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-[#0284c7]">+ New Role</button>
        </Card>

        <div ref={editorRef} className="xl:col-span-8 scroll-mt-3">
        <Card flush>
          <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 flex-wrap">
            {creating ? (
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Role name" required><input className={CTL} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} autoFocus placeholder="e.g. Stock Inspector" /></Field>
                <Field label="Description"><input className={CTL} value={nf.description} onChange={(e) => setNf({ ...nf, description: e.target.value })} placeholder="What this role is for" /></Field>
              </div>
            ) : role ? (
              <div>
                <h2 className="text-lg font-extrabold text-[#0b1f3d] m-0 font-headline flex items-center gap-2">{role.name} {role.is_system && <Pill tone="navy" mono>SYSTEM</Pill>}</h2>
                <p className="text-xs text-slate-500 m-0 mt-1">{role.description || 'No description.'} · {role.permissions.length} of {data.all_permissions.length} permissions.</p>
              </div>
            ) : <Empty>Pick a role.</Empty>}
            <div className="flex items-center gap-2">
              {creating ? (
                <>
                  <button type="button" className={BTN} onClick={() => setCreating(false)}>Cancel</button>
                  <button type="button" className={BTN_PRIMARY} onClick={create} disabled={!nf.name.trim()}>Save role</button>
                </>
              ) : role?.is_system ? <Pill tone="slate">read-only — defined in code</Pill> : role ? <Pill tone="slate">custom role · permissions fixed at creation</Pill> : null}
            </div>
          </div>
          <div className="p-5 space-y-6">
            {PERM_GROUPS.map(([group, keys]) => (
              <div key={group}>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 m-0 mb-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#0284c7]" />{group}</h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden">
                  {keys.filter((k) => data.all_permissions.includes(k)).map((k) => (
                    <label key={k} className={`flex items-start justify-between gap-3 px-4 py-3 ${creating ? 'cursor-pointer hover:bg-slate-50' : ''} ${has(k) ? 'bg-emerald-50/30' : ''}`}>
                      <div>
                        <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">{PERM_TEXT[k]?.[0] || k} <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{k}</span></div>
                        <div className="text-xs text-slate-500">{PERM_TEXT[k]?.[1] || ''}</div>
                      </div>
                      <input type="checkbox" className="mt-1 !w-4 !h-4 accent-[#0284c7]" checked={has(k)} disabled={!creating} onChange={() => creating && flip(k)} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Employees — `staff_medical_allowances_welfare_quotas` / `add_staff_medical_allowance_workstation` / `staff_medical_quota_utilization_ledger`
//
// An employee is a CUSTOMER of the pharmacy with `category = 'Staff'`, not a
// system user — the cleaner who never logs in still buys medicine at the staff
// rate. The cap is per employee, falling back to the trust default in Settings.
// ---------------------------------------------------------------------------
const PRESETS = [[10000, 'Support staff'], [20000, 'Nursing / technical'], [35000, 'Clinical officers'], [50000, 'Consultants / HOD']];

function Employees({ can }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [f, setF] = useState({ full_name: '', designation: '', contact: '', cnic: '', staff_cap: '' });

  const load = useCallback(() => { api.get('/reports/staff-allowances').then(setRows).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  async function register() {
    try {
      await api.post('/patients', {
        full_name: f.full_name.trim(), designation: f.designation.trim() || null, contact: f.contact.trim() || null, cnic: f.cnic.trim() || null,
        category: 'Staff', customer_type: 'staff', staff_cap: f.staff_cap === '' ? null : Number(f.staff_cap), force: true,
      });
      setAdding(false); setF({ full_name: '', designation: '', contact: '', cnic: '', staff_cap: '' }); load();
      setMsg(`${f.full_name} registered as staff.`);
    } catch (e) { setErr(e.message); }
  }
  async function saveCap(row, value) {
    try {
      await api.put(`/patients/${row.id}`, { staff_cap: value === '' ? null : Number(value) });
      setEditing(null); load();
      setMsg(value === '' ? `${row.full_name} now uses the trust default.` : `${row.full_name}'s allowance set to Rs ${Number(value).toLocaleString()}.`);
    } catch (e) { setErr(e.message); }
  }
  function openLedger(row) {
    api.get(`/reports/staff-statement/${row.id}`).then((st) => setLedger({ row, st })).catch((e) => setErr(e.message));
  }

  const list = rows.filter((r) => !q.trim() || [r.full_name, r.patient_code, r.contact, r.designation].some((s) => (s || '').toLowerCase().includes(q.trim().toLowerCase())));
  const budget = rows.reduce((t, r) => t + Number(r.entitlement || 0), 0);
  const used = rows.reduce((t, r) => t + Number(r.consumed || 0), 0);
  const year = rows[0]?.year;

  return (
    <>
      <PageHead title="Hospital Staff Medical Allowances & Quotas" sub={`Each employee buys at the staff rate until the yearly allowance runs out, then pays the difference. A blank cap means the trust default from Settings.${year ? ` Fiscal year ${year}.` : ''}`}
        right={<>
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Export List</button>
          {can('patient.manage') && <button type="button" className={BTN_PRIMARY} onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add Staff Allowance</button>}
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Registered staff" value={rows.length} unit="staff" icon="patients" sub="On the staff rate" />
        <Kpi label="Total yearly budget" value={money(budget)} icon="billing" sub="Sum of every employee's allowance" />
        <Kpi label="Allowance used" value={money(used)} tone="amber" icon="trend" sub={budget ? `${Math.round((used / budget) * 100)}% spent this fiscal year` : '—'} />
        <Kpi label="Remaining balance" value={money(Math.max(0, budget - used))} tone="emerald" icon="check" sub={rows.filter((r) => r.exceeded_by > 0).length ? `${rows.filter((r) => r.exceeded_by > 0).length} over their cap` : 'Nobody over their cap'} />
      </div>

      {adding && (
        <Card title="Assign Staff Medical Allowance" sub="Register the employee and set their annual medicine quota" right={<Pill tone="emerald">{year ? `FY ${year} active` : 'active'}</Pill>}>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full name" required className="md:col-span-2"><input className={CTL} value={f.full_name} autoFocus onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
              <Field label="Designation"><input className={CTL} value={f.designation} placeholder="Nurse, Technician, Cleaner…" onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
              <Field label="Mobile" hint="How the counter finds them."><input className={`${CTL} font-mono`} value={f.contact} placeholder="03xxxxxxxxx" onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
              <Field label="CNIC"><input className={`${CTL} font-mono`} value={f.cnic} placeholder="optional" onChange={(e) => setF({ ...f, cnic: e.target.value })} /></Field>
            </div>
            <div className="xl:col-span-5">
              <Field label="Annual medical limit (Rs)" hint="Leave blank for the trust default.">
                <div className="relative"><span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-500 font-mono">Rs</span>
                  <input type="number" min="0" className={`${NUM} pl-9 text-lg font-bold`} value={f.staff_cap} placeholder="trust default" onChange={(e) => setF({ ...f, staff_cap: e.target.value })} /></div>
              </Field>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-4 mb-2">Recommended trust benefit tiers</div>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, staff_cap: String(v) })}
                    className={`text-left rounded-md border px-3 py-2 ${String(v) === f.staff_cap ? 'border-[#0284c7] bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <div className="font-mono font-bold text-sm text-slate-900">Rs {v.toLocaleString()}</div><div className="text-[11px] text-slate-500">{l}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-200">
            <button type="button" className={BTN_PRIMARY} onClick={register} disabled={!f.full_name.trim()}>Save quota & register</button>
            <button type="button" className={BTN} onClick={() => setAdding(false)}>Discard</button>
            <span className="text-[11px] text-slate-500 ml-2">Monthly ceilings, co-pay tiers and dependents are not modelled — the allowance is one annual amount.</span>
          </div>
        </Card>
      )}

      <Card flush title="Staff Medical Allowance Ledger & Welfare Quotas" sub="Employees and clinical staff covered under the trust's staff allowance"
        right={<Search value={q} onChange={setQ} placeholder="Search staff name, CNIC, employee ID…" className="w-72" />}>
        <Tbl stack head={['Staff member', 'CNIC & mobile', 'Designation', 'Annual quota', 'Utilised', 'Remaining balance', 'On credit', 'Status', 'Actions']} right={[3, 4, 5, 6, 8]}>
          {list.map((r) => {
            const pct = r.entitlement ? Math.min(100, Math.round((r.consumed / r.entitlement) * 100)) : 0;
            const status = r.exceeded_by > 0 ? ['rose', 'Over cap'] : pct >= 90 ? ['amber', 'Near limit'] : ['emerald', 'Active'];
            return (
              <tr key={r.id}>
                <td><div className="font-bold text-slate-900 text-[13px]">{r.full_name}</div><div className="text-[11px] text-slate-500 font-mono">{r.patient_code}</div></td>
                <td className="font-mono text-slate-600"><div>{r.cnic || '—'}</div><div className="text-[11px]">{r.contact || '—'}</div></td>
                <td>{r.designation ? <Pill tone="slate">{r.designation}</Pill> : <span className="text-slate-400">—</span>}</td>
                <td className="text-right">
                  {editing === r.id ? (
                    <input type="number" min="0" defaultValue={r.staff_cap ?? ''} autoFocus placeholder="default" className={`${NUM} !h-8 !w-32 text-right`}
                      onBlur={(e) => saveCap(r, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveCap(r, e.target.value); if (e.key === 'Escape') setEditing(null); }} />
                  ) : (<><div className="font-mono font-bold">{money(r.entitlement)}</div><div className="text-[10px] text-slate-500">{r.uses_default_cap ? 'Trust default' : 'Set for this person'}</div></>)}
                </td>
                <td className="text-right font-mono">{money(r.consumed)}</td>
                <td className="text-right"><div className={`font-mono font-bold ${r.exceeded_by > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{r.exceeded_by > 0 ? `− ${money(r.exceeded_by)}` : money(r.remaining)}</div><Bar pct={pct} tone={status[0]} /></td>
                <td className="text-right font-mono">{r.on_credit > 0 ? <b>{money(r.on_credit)}</b> : <span className="text-slate-400">—</span>}</td>
                <td><Pill tone={status[0]}>{status[1]}</Pill></td>
                <td className="text-right whitespace-nowrap">
                  {can('patient.manage') && editing !== r.id && <button type="button" className={BTN_SM} onClick={() => setEditing(r.id)}>Edit quota</button>}
                  <button type="button" className={`${BTN_SM} ml-1 !text-[#0284c7]`} onClick={() => openLedger(r)}>Ledger</button>
                </td>
              </tr>
            );
          })}
          {list.length === 0 && <tr><td colSpan={9}><Empty><b>No employees registered yet.</b> Register one and they can buy at the staff rate straight away.</Empty></td></tr>}
        </Tbl>
        <div className="px-5 py-2.5 border-t border-slate-200 text-[11px] text-slate-500">Showing {list.length} of {rows.length} staff allowances</div>
      </Card>

      {ledger && <StaffLedger row={ledger.row} st={ledger.st} onClose={() => setLedger(null)} />}
    </>
  );
}

function StaffLedger({ row, st, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const months = Math.max(1, Math.round((Date.now() - new Date(st.from)) / (30 * 86400000)));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !max-w-5xl !rounded-lg !p-0 overflow-hidden text-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] text-slate-500">Employees & quotas <span className="text-slate-300 mx-1">/</span> {row.full_name} ({row.patient_code}) <span className="text-slate-300 mx-1">/</span> Utilisation ledger</div>
            <h2 className="text-lg font-extrabold text-[#0b1f3d] m-0 font-headline flex items-center gap-2">Staff Medical Quota Ledger <Pill tone="emerald" mono>FY {st.year}</Pill></h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: true })}><Icon name="printer" size={14} /> Print ledger</button>
            <button type="button" className={BTN} onClick={onClose}>Back <kbd className="kbd-hint text-[10px] font-mono bg-slate-100 px-1 rounded border border-slate-200">Esc</kbd></button>
          </div>
        </div>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label={`Annual allocation (FY ${st.year})`} value={money(st.entitlement)} icon="billing" sub={`${st.from} → ${st.to}`} />
            <Kpi label="Utilised to date" value={money(st.subsidy_consumed)} tone="amber" icon="trend" sub={`${(st.bills || []).length} bill${(st.bills || []).length === 1 ? '' : 's'}`} />
            <Kpi label="Remaining balance" value={money(st.remaining)} tone={st.remaining > 0 ? 'emerald' : 'rose'} icon="check" sub={`Burn ≈ ${money(Math.round(st.subsidy_consumed / months))} / month`} />
            <Kpi label="To recover" value={money(st.recoverable)} tone={st.recoverable > 0 ? 'rose' : 'slate'} icon="warning" sub={st.exceeded_by > 0 ? `Over the cap by ${money(st.exceeded_by)}` : 'Nothing owed'} />
          </div>
          <Card flush title="Dispensing against the allowance" sub="Every staff-rate bill this fiscal year">
            <Tbl stack head={['Date', 'Bill', 'Gross', 'Covered by allowance', 'Paid', 'Owed']} right={[2, 3, 4, 5]} dense>
              {(st.bills || []).map((b) => (
                <tr key={b.id || b.bill_no}>
                  <td className="font-mono">{String(b.created_at || '').slice(0, 10)}</td>
                  <td className="font-mono font-semibold">{b.bill_no}</td>
                  <td className="text-right font-mono">{money(b.gross_amount)}</td>
                  <td className="text-right font-mono text-emerald-700">{money((b.discount || 0) + (b.subsidy || 0))}</td>
                  <td className="text-right font-mono">{money(b.paid_amount)}</td>
                  <td className={`text-right font-mono ${b.net_amount - b.paid_amount > 0 ? 'text-rose-700 font-bold' : ''}`}>{money(b.net_amount - b.paid_amount)}</td>
                </tr>
              ))}
              {(st.bills || []).length === 0 && <tr><td colSpan={6}><Empty>Nothing bought on the allowance this year.</Empty></td></tr>}
            </Tbl>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalogue — `medicine_types_packaging_catalogue_master`, `dosage_form_packaging_simple`,
// `drug_manufacturers_simple`, `merge_duplicate_manufacturers_workstation`
//
// Dosage form decides whether a batch number and expiry are required on receipt
// (is_medicine). Manufacturer decides whose row the margin report lands in, and
// free text is what turns one company into three: GSK, G.S.K, Glaxo.
// ---------------------------------------------------------------------------
const SCHED = { OTC: ['slate', 'General sale (OTC)'], Rx: ['sky', 'Doctor prescription (Rx)'], G: ['rose', 'Controlled (Schedule G)'], Narcotic: ['rose', 'Controlled drug'] };

function Catalogue() {
  const [types, setTypes] = useState([]);
  const [makers, setMakers] = useState([]);
  const [units, setUnits] = useState([]);
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [newUnit, setNewUnit] = useState({ name: '', descr: '' });
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [newType, setNewType] = useState({ name: '', is_medicine: true, default_schedule: 'OTC' });
  const [newMaker, setNewMaker] = useState('');
  const [mergeFrom, setMergeFrom] = useState(null);
  const [mergeInto, setMergeInto] = useState('');
  const [editType, setEditType] = useState(null);

  const load = useCallback(() => {
    api.get('/inventory/product-types').then(setTypes).catch((e) => setErr(e.message));
    api.get('/inventory/manufacturers').then(setMakers).catch((e) => setErr(e.message));
    api.get('/inventory/base-units').then(setUnits).catch((e) => setErr(e.message));
    api.get('/inventory/products').then(setProducts).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  const wrap = (fn) => async () => {
    setErr(''); setMsg('');
    try { const m = await fn(); if (m) setMsg(m); load(); } catch (e) { setErr(e.message); }
  };
  const addType = wrap(async () => {
    if (!newType.name.trim()) return null;
    await api.post('/inventory/product-types', { name: newType.name.trim(), is_medicine: newType.is_medicine, default_schedule: newType.default_schedule });
    setNewType({ name: '', is_medicine: true, default_schedule: 'OTC' });
    return `Added "${newType.name.trim()}".`;
  });
  const saveType = wrap(async () => {
    await api.put(`/inventory/product-types/${editType.id}`, { name: editType.name, is_medicine: editType.is_medicine ? 1 : 0, default_schedule: editType.default_schedule, default_unit: editType.default_unit || null, is_active: editType.is_active ? 1 : 0 });
    setEditType(null);
    return `"${editType.name}" saved.`;
  });
  const toggleActive = (t) => wrap(async () => { await api.put(`/inventory/product-types/${t.id}`, { is_active: t.is_active ? 0 : 1 }); return `"${t.name}" ${t.is_active ? 'deactivated' : 'reactivated'}.`; })();
  const addMaker = wrap(async () => {
    if (!newMaker.trim()) return null;
    await api.post('/inventory/manufacturers', { name: newMaker.trim() }); setNewMaker('');
    return `Added "${newMaker.trim()}".`;
  });
  const addUnit = wrap(async () => {
    if (!newUnit.name.trim()) return null;
    await api.post('/inventory/base-units', { name: newUnit.name.trim(), descr: newUnit.descr.trim() || null }); setNewUnit({ name: '', descr: '' });
    return `Added "${newUnit.name.trim()}".`;
  });
  const doMerge = wrap(async () => {
    const into = makers.find((m) => String(m.id) === String(mergeInto));
    if (!mergeFrom || !into) return null;
    const r = await api.post(`/inventory/manufacturers/${mergeFrom.id}/merge-into/${into.id}`);
    setMergeFrom(null); setMergeInto('');
    return `Merged "${r.merged}" into "${r.into}" — ${r.products_moved} product${r.products_moved === 1 ? '' : 's'} moved.`;
  });

  const term = q.trim().toLowerCase();
  const tRows = types.filter((t) => !term || t.name.toLowerCase().includes(term));
  const mRows = makers.filter((m) => !term || m.name.toLowerCase().includes(term));
  const uRows = units.filter((u) => !term || u.name.toLowerCase().includes(term) || (u.descr || '').toLowerCase().includes(term));
  const countByType = (id) => products.filter((p) => p.product_type_id === id).length;

  return (
    <>
      <PageHead title="Medicine Types, Packaging & Formulations" sub="Dosage forms decide whether a batch and expiry are required on receipt; base units are what every stock figure is counted in; manufacturers are whose row the margin report lands in."
        right={<>
          <Search value={q} onChange={setQ} placeholder="Search dosage form, packaging unit, manufacturer…" className="w-80" />
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Export Catalogue</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <Notice right={<Pill tone="sky">{types.filter((t) => t.is_active).length} dosage forms active</Pill>}>All dosage forms define batch and expiry rules and the default sale restriction for medicines created under them. The MRP rule itself lives in Settings.</Notice>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <Card className="xl:col-span-7" flush title="Dosage Forms & Drug Schedules" sub="Physical formulations, expiry requirements and sale restrictions" right={<Pill tone="sky">{types.length} types</Pill>}>
          <Tbl stack head={['Form name', 'Batch & expiry', 'Prescription rule', 'Counted in', 'Medicines', 'Actions']} right={[4, 5]}>
            {tRows.map((t) => (
              <tr key={t.id} className={t.is_active ? '' : 'opacity-50'}>
                <td><div className="font-bold text-slate-900 text-[13px]">{t.name}</div>{!t.is_active && <div className="text-[10px] text-rose-700 font-semibold uppercase">deactivated</div>}</td>
                <td><Pill tone={t.is_medicine ? 'emerald' : 'slate'}>{t.is_medicine ? 'Required' : 'Optional'}</Pill></td>
                <td><Pill tone={SCHED[t.default_schedule]?.[0] || 'slate'}>{SCHED[t.default_schedule]?.[1] || t.default_schedule || 'General sale (OTC)'}</Pill></td>
                <td className="font-mono text-slate-700">{t.default_unit || <span className="text-slate-400">—</span>}</td>
                <td className="text-right font-mono">{countByType(t.id)}</td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className={`${BTN_SM} !text-[#0284c7]`} onClick={() => setEditType({ ...t })}>Edit</button>
                  <button type="button" className={`${BTN_SM} ml-1 ${t.is_active ? '!text-slate-500' : '!text-emerald-700'}`} onClick={() => toggleActive(t)}>{t.is_active ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>
            ))}
          </Tbl>
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/60">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Inline quick add dosage form</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input className={`${CTL} !w-56 !h-9`} placeholder="Form name (e.g. Lozenges)" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
              <label className="inline-flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="!w-4 !h-4 accent-[#0284c7]" checked={newType.is_medicine} onChange={(e) => setNewType({ ...newType, is_medicine: e.target.checked })} /> Batch & expiry required</label>
              <select className={`${CTL} !w-52 !h-9`} value={newType.default_schedule} onChange={(e) => setNewType({ ...newType, default_schedule: e.target.value })}>
                <option value="OTC">General sale (OTC)</option><option value="Rx">Doctor prescription (Rx)</option><option value="G">Controlled (Schedule G)</option>
              </select>
              <button type="button" className={BTN_PRIMARY} onClick={addType} disabled={!newType.name.trim()}>+ Add Form</button>
            </div>
          </div>
        </Card>

        <div className="xl:col-span-5 space-y-6">
          <Card flush title="Packaging Base Units & Conversion" sub="The smallest thing that can be handed over — printed on the receipt" right={<Pill tone="emerald">{units.length} units</Pill>}>
            <Tbl stack head={['Unit', 'Usage description', 'Suggested by']} dense>
              {uRows.map((u) => {
                const from = types.filter((t) => t.default_unit === u.name).map((t) => t.name);
                return <tr key={u.id}><td className="font-mono font-bold text-[#0284c7]">{u.name}</td><td className="text-slate-700">{u.descr || '—'}</td><td className="text-[11px] text-slate-500">{from.length ? from.join(', ') : '—'}</td></tr>;
              })}
            </Tbl>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
              <input className={`${CTL} !h-9`} placeholder="Unit (e.g. patch)" value={newUnit.name} onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })} />
              <input className={`${CTL} !h-9`} placeholder="Usage" value={newUnit.descr} onChange={(e) => setNewUnit({ ...newUnit, descr: e.target.value })} />
              <button type="button" className={BTN_PRIMARY} onClick={addUnit} disabled={!newUnit.name.trim()}>+ Add</button>
            </div>
          </Card>

          <Card flush title="Approved Drug Manufacturers" sub="One row per company; merge the duplicates before a company-wise report"
            right={<button type="button" className={`${BTN} !bg-amber-500 !text-white !border-amber-500 hover:!bg-amber-600`} onClick={() => { setMergeFrom(makers[0] || null); setMergeInto(''); }} disabled={makers.length < 2}>Merge Duplicates</button>}>
            <Tbl stack head={['Manufacturer', 'Medicines', 'Action']} right={[1, 2]} dense>
              {mRows.map((m) => (
                <tr key={m.id}>
                  <td><div className="font-bold text-slate-900">{m.name}</div><div className="text-[10px] text-slate-500 font-mono">MFR-{String(m.id).padStart(5, '0')}</div></td>
                  <td className="text-right font-mono">{m.product_count}</td>
                  <td className="text-right"><button type="button" className={`${BTN_SM} !text-[#0284c7]`} onClick={() => { setMergeFrom(m); setMergeInto(''); }}>Merge away</button></td>
                </tr>
              ))}
              {mRows.length === 0 && <tr><td colSpan={3}><Empty>No companies recorded yet.</Empty></td></tr>}
            </Tbl>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
              <input className={`${CTL} !h-9`} placeholder="New company, e.g. Getz Pharma" value={newMaker} onChange={(e) => setNewMaker(e.target.value)} />
              <button type="button" className={BTN_PRIMARY} onClick={addMaker} disabled={!newMaker.trim()}>+ Add</button>
            </div>
            <p className="px-5 pb-4 text-[11px] text-slate-500 m-0">DML licence numbers, cities and GMP status are not held on a manufacturer — on the client's question list.</p>
          </Card>
        </div>
      </div>

      {mergeFrom && (
        <Card title="Merge Duplicate Pharmaceutical Manufacturers" sub="Moves every product from the duplicate onto the master, then deletes the duplicate. This cannot be undone." right={<Pill tone="rose">Irreversible</Pill>}>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
            <div className="rounded-md border border-rose-200 bg-rose-50/40 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-800 mb-2">Duplicate company (will be deleted)</div>
              <Select value={String(mergeFrom.id)} onChange={(e) => setMergeFrom(makers.find((m) => String(m.id) === e.target.value))}>
                {makers.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.product_count} linked</option>)}
              </Select>
              <div className="text-xs text-slate-600 mt-3">Products linked: <b className="font-mono">{mergeFrom.product_count}</b></div>
            </div>
            <div className="text-center text-xs font-bold text-slate-500">→<div className="text-[10px] font-normal">reassigns into</div></div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 mb-2">Primary master manufacturer (kept)</div>
              <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">Keep which company?</option>
                {makers.filter((m) => m.id !== mergeFrom.id).map((m) => <option key={m.id} value={m.id}>{m.name} — {m.product_count} linked</option>)}
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button type="button" className={`${BTN_PRIMARY} !bg-rose-600 hover:!bg-rose-700`} onClick={doMerge} disabled={!mergeInto}>Merge & delete duplicate</button>
            <button type="button" className={BTN} onClick={() => setMergeFrom(null)}>Cancel</button>
          </div>
        </Card>
      )}

      {editType && (
        <div className="modal-backdrop" onClick={() => setEditType(null)}>
          <div className="modal !max-w-2xl !rounded-lg !p-0 overflow-hidden text-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200"><div className="text-[11px] text-slate-500">Administration <span className="text-slate-300 mx-1">/</span> Dosage forms & packaging</div><h2 className="text-lg font-extrabold text-[#0b1f3d] m-0 font-headline">Dosage Form Configuration</h2></div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Dosage form name" required><input className={CTL} value={editType.name} onChange={(e) => setEditType({ ...editType, name: e.target.value })} /></Field>
              <Field label="Base unit it suggests" hint="Offered when a medicine of this form is created.">
                <Select value={editType.default_unit || ''} onChange={(e) => setEditType({ ...editType, default_unit: e.target.value })}>
                  <option value="">— none —</option>{units.map((u) => <option key={u.id} value={u.name}>{u.name} — {u.descr}</option>)}
                </Select>
              </Field>
              <Field label="Prescription dispensing authority (default for new medicines)" className="md:col-span-2">
                <div className="grid grid-cols-3 gap-2">
                  {[['OTC', 'General sale (OTC)', 'Over the counter, no prescription.'], ['Rx', 'Doctor Rx only', 'A prescription reference at the counter.'], ['G', 'Controlled (Sched G)', 'Prescriber and register entry.']].map(([k, l, s]) => (
                    <label key={k} className={`rounded-md border p-3 cursor-pointer ${editType.default_schedule === k ? 'border-[#0284c7] bg-blue-50' : 'border-slate-200'}`}>
                      <div className="flex items-center justify-between"><span className="text-sm font-semibold">{l}</span><input type="radio" checked={editType.default_schedule === k} onChange={() => setEditType({ ...editType, default_schedule: k })} /></div>
                      <div className="text-[11px] text-slate-500 mt-1">{s}</div>
                    </label>
                  ))}
                </div>
              </Field>
              <div className="md:col-span-2 space-y-2">
                <Toggle checked={!!editType.is_medicine} onChange={(v) => setEditType({ ...editType, is_medicine: v })} title="Require batch & expiry on receipt" sub="A medicine cannot be received without the batch that makes a recall or a claim possible." />
                <Toggle checked={!!editType.is_active} onChange={(v) => setEditType({ ...editType, is_active: v })} title="Active for dispensing" sub="Deactivated forms are kept for old products but not offered for new ones." />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={saveType} disabled={!editType.name.trim()}>Save dosage form</button>
              <button type="button" className={BTN} onClick={() => setEditType(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialysis: the demand form and the shifts (Phase 05, Q7) — in the new frame
// ---------------------------------------------------------------------------
function DialysisForm({ can }) {
  const [tpl, setTpl] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(null);
  const [nf, setNf] = useState({ name: '', starts_at: '', ends_at: '' });
  const load = useCallback(() => {
    api.get('/dialysis/template').then(setTpl).catch((e) => setErr(e.message));
    api.get('/dialysis/shifts').then(setShifts).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const unmapped = tpl ? tpl.items.filter((i) => !i.is_freetext && !(i.products || []).length) : [];

  return (
    <>
      <PageHead title="Dialysis Demand Form" sub="Every printed row on the unit's paper must point at the SKU it deducts. Until a row is mapped it cannot be issued — deducting the wrong syringe silently is worse than refusing." />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      {unmapped.length > 0 && <Notice tone="rose" title={`${unmapped.length} row${unmapped.length === 1 ? '' : 's'} cannot be issued yet`}>{unmapped.map((i) => i.printed_label).join(', ')} — each needs the product it deducts. Ask the unit in-charge.</Notice>}

      <Card title="Shifts" sub="The unit files by shift, so every dialysis report groups by one">
        <div className="flex items-center gap-2 flex-wrap">
          {shifts.map((s) => <Pill key={s.id} tone="sky">{s.name}{s.starts_at ? ` · ${s.starts_at}–${s.ends_at || ''}` : ''}</Pill>)}
          {shifts.length === 0 && <span className="text-xs text-slate-500">None yet.</span>}
        </div>
        {can('dialysis.manage') && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 items-end">
            <Field label="Add a shift"><input className={CTL} value={nf.name} placeholder="the unit's own name" onChange={(e) => setNf({ ...nf, name: e.target.value })} /></Field>
            <Field label="From"><input type="time" className={`${CTL} font-mono`} value={nf.starts_at} onChange={(e) => setNf({ ...nf, starts_at: e.target.value })} /></Field>
            <Field label="To"><input type="time" className={`${CTL} font-mono`} value={nf.ends_at} onChange={(e) => setNf({ ...nf, ends_at: e.target.value })} /></Field>
            <button type="button" className={`${BTN_PRIMARY} h-10`} disabled={!nf.name.trim()} onClick={async () => {
              try { await api.post('/dialysis/shifts', nf); setNf({ name: '', starts_at: '', ends_at: '' }); setMsg(`Shift ${nf.name} added.`); load(); } catch (e) { setErr(e.message); }
            }}>Add shift</button>
          </div>
        )}
      </Card>

      <Card flush title="The printed form, row by row" sub="What each row deducts when the unit issues it">
        <Tbl head={['Printed on the form', 'Col', 'Deducts', '']} right={[3]}>
          {(tpl?.items || []).map((it) => (
            <tr key={it.id}>
              <td><b className="text-slate-900">{it.printed_label}</b> {it.is_emergency === 1 && <Pill tone="rose">emergency</Pill>} {it.is_freetext === 1 && <Pill tone="slate">free text</Pill>}</td>
              <td className="font-mono">{it.column_no}</td>
              <td>{it.is_freetext === 1 ? <span className="text-slate-500">searches the whole catalogue</span>
                : (it.products || []).length ? (it.products || []).map((p) => <div key={p.id}>{p.name}{p.is_default === 1 && <span className="text-slate-500"> · usual</span>}</div>)
                  : <Pill tone="amber">not mapped</Pill>}</td>
              <td className="text-right">{can('dialysis.manage') && it.is_freetext !== 1 && <button type="button" className={`${BTN_SM} !text-[#0284c7]`} onClick={() => setEditing(it)}>Map</button>}</td>
            </tr>
          ))}
          {!tpl && <tr><td colSpan={4}><Empty>Loading…</Empty></td></tr>}
        </Tbl>
      </Card>
      {editing && <MapRow item={editing} onClose={() => setEditing(null)} onErr={setErr} onDone={(m) => { setEditing(null); setMsg(m); load(); }} />}
    </>
  );
}

function MapRow({ item, onClose, onErr, onDone }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState([]);
  const [picked, setPicked] = useState(item.products || []);
  const [def, setDef] = useState((item.products || []).find((p) => p.is_default === 1)?.id ?? (item.products || [])[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (term.trim().length < 2) { setHits([]); return undefined; }
    const id = setTimeout(() => { api.get(`/inventory/products?q=${encodeURIComponent(term.trim())}`).then((r) => setHits((r || []).slice(0, 8))).catch(() => setHits([])); }, 200);
    return () => clearTimeout(id);
  }, [term]);
  async function save() {
    setBusy(true);
    try { await api.put(`/dialysis/template/items/${item.id}`, { product_ids: picked.map((p) => p.id), default_product_id: def }); onDone(`${item.printed_label} mapped.`); }
    catch (e) { onErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !max-w-xl !rounded-lg !p-5 text-slate-800" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-extrabold text-[#0b1f3d] m-0 font-headline">{item.printed_label}</h3>
        <p className="text-xs text-slate-500 mt-1 mb-3">Which product does this row deduct? A row can cover several — mark the one the unit normally uses and it will be preselected on the demand form.</p>
        {picked.length > 0 && (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-md mb-3">
            {picked.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" checked={String(def) === String(p.id)} onChange={() => setDef(p.id)} /> {p.name}</label>
                <button type="button" className={BTN_SM} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <Field label="Add a product"><input className={CTL} value={term} autoFocus placeholder="search the catalogue…" onChange={(e) => setTerm(e.target.value)} /></Field>
        {hits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {hits.filter((h) => !picked.some((p) => p.id === h.id)).map((h) => (
              <button key={h.id} type="button" className={BTN_SM} onClick={() => { setPicked([...picked, h]); if (def == null) setDef(h.id); setTerm(''); setHits([]); }}>
                <b>{h.name}</b> <span className="text-slate-500">· {h.on_hand} in stock</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-200">
          <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy}>Save mapping</button>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log — `system_pharmacy_audit_history` / `audit_record_deep_inspection_workstation`
// ---------------------------------------------------------------------------
const AUDIT_GROUPS = [
  ['all', 'All logs', () => true],
  ['controlled', 'Controlled medicines', (a) => /controlled|narcotic|register/.test(a)],
  ['overrides', 'Discount overrides & corrections', (a) => /override|amend|discount/.test(a)],
  ['stock', 'Stock adjustments', (a) => /^stock\.|quarantine|receive|adjust|release/.test(a)],
  ['users', 'User logins & roles', (a) => /^auth\.|^user\.|^role|settings/.test(a)],
  ['returns', 'Returns & refunds', (a) => /^return\./.test(a)],
  ['cash', 'Till & cash', (a) => /^cash\.|ledger/.test(a)],
];
const actionTone = (a) => (/controlled|narcotic/.test(a) ? 'violet' : /return|amend|cancel|discard/.test(a) ? 'amber' : /quarantine|writeoff|override|delete/.test(a) ? 'rose' : /auth\.|user\./.test(a) ? 'slate' : /sale|receive|create|issue|settle/.test(a) ? 'emerald' : 'sky');

function AuditLog() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [sel, setSel] = useState(null);
  const load = useCallback(() => { api.get('/reports/audit').then(setRows).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  const count = (fn) => rows.filter((r) => fn(r.action || '')).length;
  const list = rows
    .filter((r) => AUDIT_GROUPS.find((g) => g[0] === group)[2](r.action || ''))
    .filter((r) => !q.trim() || [r.username, r.action, r.entity, r.detail, String(r.entity_id)].some((s) => (s || '').toLowerCase().includes(q.trim().toLowerCase())));
  const pretty = (d) => { try { return JSON.stringify(JSON.parse(d), null, 2); } catch { return d || ''; } };
  const brief = (d) => { try { const o = JSON.parse(d); return Object.entries(o).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch { return d || ''; } };

  return (
    <>
      <PageHead title="System & Pharmacy Audit History" sub="Every action that changed a record, who did it, and what it carried. Append-only; the latest 200 entries are shown."
        right={<>
          <button type="button" className={BTN} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Export audit log</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Actions logged" value={rows.length} unit={(rows.length) === 1 ? 'entry' : 'entries'} icon="file" sub="Saved permanently on the local server" />
        <Kpi label="Controlled drugs dispensed" value={count(AUDIT_GROUPS[1][2])} unit={(count(AUDIT_GROUPS[1][2])) === 1 ? 'entry' : 'entries'} tone="sky" icon="shield" sub="Register entries with a prescriber" />
        <Kpi label="Overrides & corrections" value={count(AUDIT_GROUPS[2][2])} unit={(count(AUDIT_GROUPS[2][2])) === 1 ? 'entry' : 'entries'} tone="amber" icon="warning" sub="Needed billing override or amend" />
        <Kpi label="Stock movements" value={count(AUDIT_GROUPS[3][2])} unit={(count(AUDIT_GROUPS[3][2])) === 1 ? 'entry' : 'entries'} tone="emerald" icon="box" sub="GRN, quarantine, adjustments" />
      </div>

      <Card flush>
        <div className="px-5 py-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Search value={q} onChange={setQ} placeholder="Search by staff name, bill number, entity or action…" className="flex-1 min-w-[280px]" />
            <button type="button" className={BTN} onClick={load}><Icon name="returns" size={14} /></button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Quick filters:</span>
            <Chips value={group} onChange={setGroup} items={AUDIT_GROUPS.map(([k, l, fn]) => [k, l, count(fn)])} />
          </div>
          <div className="text-[11px] text-slate-500 font-mono">Storage: <span className="text-emerald-700 font-bold">LOCAL SQLITE · WAL</span></div>
        </div>
        <Tbl stack head={['Date & time', 'Staff member', 'Action type', 'Details & reference', 'Entity', 'Origin', '']} right={[6]}>
          {list.map((a) => (
            <tr key={a.id} className={sel?.id === a.id ? '!bg-blue-50/60' : ''}>
              <td className="font-mono text-slate-700 whitespace-nowrap">{a.created_at}</td>
              <td><div className="font-semibold text-slate-900">{a.username || '—'}</div><div className="text-[11px] text-slate-500">user #{a.user_id ?? '—'}</div></td>
              <td><Pill tone={actionTone(a.action || '')} mono>{(a.action || '').toUpperCase()}</Pill></td>
              <td className="text-slate-600 max-w-md"><div className="truncate">{brief(a.detail)}</div></td>
              <td className="font-mono text-slate-600">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
              <td className="font-mono text-slate-500">{a.ip || '—'}</td>
              <td className="text-right"><button type="button" className={`${BTN_SM} !text-[#0284c7]`} onClick={() => setSel(a)}>Inspect</button></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7}><Empty>No entries match.</Empty></td></tr>}
        </Tbl>
        <div className="px-5 py-2.5 border-t border-slate-200 text-[11px] text-slate-500">Showing {list.length} of {rows.length} entries</div>
      </Card>

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal !max-w-3xl !rounded-lg !p-0 overflow-hidden text-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] text-slate-500">Administration <span className="text-slate-300 mx-1">/</span> Audit history <span className="text-slate-300 mx-1">/</span> <span className="font-mono">AUD-{sel.id}</span></div>
                <h2 className="text-lg font-extrabold text-[#0b1f3d] m-0 font-headline flex items-center gap-2"><Pill tone={actionTone(sel.action || '')} mono>{(sel.action || '').toUpperCase()}</Pill> {sel.entity}{sel.entity_id ? ` #${sel.entity_id}` : ''}</h2>
              </div>
              <button type="button" className={BTN} onClick={() => setSel(null)}>Back to audit ledger <kbd className="kbd-hint text-[10px] font-mono bg-slate-100 px-1 rounded border border-slate-200">Esc</kbd></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['Authorised actor', sel.username || '—', `user #${sel.user_id ?? '—'}`], ['Wall-clock timestamp', sel.created_at, 'server time, UTC'], ['Origin', sel.ip || '—', 'request address'], ['Record', `AUD-${sel.id}`, 'append-only']].map(([k, v, s]) => (
                  <div key={k} className="rounded-md border border-slate-200 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{k}</div><div className="font-mono font-bold text-sm text-slate-900 mt-1 truncate">{v}</div><div className="text-[11px] text-slate-500">{s}</div></div>
                ))}
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Recorded detail</div>
                <pre className="bg-[#0b1f3d] text-sky-100 text-[11px] font-mono rounded-md p-4 overflow-x-auto m-0 max-h-80">{pretty(sel.detail) || '(no detail recorded)'}</pre>
              </div>
              <p className="text-[11px] text-slate-500 m-0">The audit log is append-only in SQLite. It is not hash-chained or signed — the mockup's cryptographic seal is not a thing this system has.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Subsidy report — `zakat_welfare_subsidy_financial_report`
// ---------------------------------------------------------------------------
const CAT_TEXT = { 'Complete Free': '100% covered — the trust gives the medicine', Discounted: 'Standard discount category', Staff: 'Internal employee allowance', Paid: 'Full price — nothing waived' };

function Subsidy() {
  const [rows, setRows] = useState([]);
  const [funds, setFunds] = useState(null);
  const [cards, setCards] = useState([]);
  const [period, setPeriod] = useState('month');
  const [err, setErr] = useState('');
  const range = useMemo(() => {
    const now = new Date(); const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (period === 'month') return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
    if (period === 'year') return [`${now.getFullYear()}-01-01`, ymd(now)];
    return ['1970-01-01', '2999-12-31'];
  }, [period]);
  const load = useCallback(() => {
    const qs = `?from=${range[0]}&to=${range[1]}`;
    api.get(`/reports/subsidy${qs}`).then(setRows).catch((e) => setErr(e.message));
    api.get(`/reports/subsidy-by-fund${qs}`).then(setFunds).catch(() => setFunds(null));
    api.get('/cards').then(setCards).catch(() => {});
  }, [range]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('hwt:refresh', load); return () => window.removeEventListener('hwt:refresh', load); }, [load]);

  const tot = rows.reduce((a, r) => ({ bills: a.bills + r.bills, gross: a.gross + r.gross, discount: a.discount + r.discount, subsidy: a.subsidy + r.subsidy, net: a.net + r.net }), { bills: 0, gross: 0, discount: 0, subsidy: 0, net: 0 });
  const byFund = funds?.by_fund || [];
  const zakat = byFund.find((f) => /zakat/i.test(f.fund));
  const other = byFund.filter((f) => !/zakat/i.test(f.fund)).reduce((t, f) => t + f.given, 0);
  const label = { month: `This month (${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })})`, year: `This calendar year (${new Date().getFullYear()})`, all: 'All time' }[period];

  return (
    <>
      <PageHead title={null} sub="What the trust waived, out of whose money, and for whom — from the bills and the fund each card is attributed to."
        right={<>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={`${CTL} !w-64 !h-9`}>
            <option value="month">Period: this month</option><option value="year">Period: this calendar year</option><option value="all">Period: all time</option>
          </select>
          <button type="button" className={BTN_PRIMARY} onClick={() => printPaper('a4', { modal: false })}><Icon name="printer" size={14} /> Print official report</button>
        </>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Total subsidy & discounts given" value={money(tot.discount + tot.subsidy)} icon="idcard" sub={`Across ${tot.bills} bills · ${label}`} />
        <Kpi label="Zakat fund utilised" value={money(zakat?.given || 0)} tone="emerald" icon="shield" sub={zakat ? `${zakat.bills} bills on Zakat-attributed cards` : 'No Zakat fund set up under Tiers & funds'} />
        <Kpi label="Other welfare & donations" value={money(other)} tone="amber" icon="billing" sub={`${byFund.filter((f) => !/zakat/i.test(f.fund)).length} other funds, incl. unattributed`} />
        <Kpi label="Active welfare patients" value={cards.filter((c) => c.status === 'active' && !c.is_expired).length} unit="beneficiaries" tone="sky" icon="patients" sub="Verified welfare card holders" />
      </div>

      <Card flush title="Active Charity & Subsidy Funds" sub="Every rupee waived on a card is booked against the fund the card was issued under" right={<Pill tone="slate" mono>{funds ? `${funds.from} → ${funds.to}` : ''}</Pill>}>
        <Tbl stack head={['Fund name & donor source', 'Bills', 'Discounts given', 'Subsidy given', 'Total given', 'Status']} right={[1, 2, 3, 4]}>
          {byFund.map((f) => (
            <tr key={f.fund}>
              <td><div className="font-bold text-slate-900">{f.fund_name}</div><div className="text-[11px] text-slate-500 font-mono">{f.fund}</div></td>
              <td className="text-right font-mono">{f.bills}</td>
              <td className="text-right font-mono">{money(f.discount)}</td>
              <td className="text-right font-mono text-emerald-700">{money(f.subsidy)}</td>
              <td className="text-right font-mono font-bold">{money(f.given)}</td>
              <td><Pill tone={f.fund === 'UNATTRIBUTED' ? 'amber' : 'emerald'}>{f.fund === 'UNATTRIBUTED' ? 'Not attributed' : 'Active'}</Pill></td>
            </tr>
          ))}
          {byFund.length === 0 && <tr><td colSpan={6}><Empty>Nothing waived in this period.</Empty></td></tr>}
        </Tbl>
        <p className="px-5 py-3 border-t border-slate-200 text-[11px] text-slate-500 m-0">Allocated endowment balances are not held — a fund here is an attribution label, not an account with a balance. Ask before adding one.</p>
      </Card>

      <Card flush title="Discount & Subsidy Breakdown by Patient Category" sub="Reconciliation of gross billings against subsidies absorbed and net collections" right={<span className="text-xs text-slate-500 font-mono">Audit period: {label}</span>}>
        <Tbl stack head={['Patient category', 'Total bills', 'Gross amount', 'Discount', 'Trust subsidy', 'Net collected']} right={[1, 2, 3, 4, 5]}>
          {rows.map((r) => (
            <tr key={r.category}>
              <td><div className="font-bold text-slate-900">{r.category}</div><div className="text-[11px] text-slate-500">{CAT_TEXT[r.category] || ''}</div></td>
              <td className="text-right font-mono">{r.bills} bills</td>
              <td className="text-right font-mono">{money(r.gross)}</td>
              <td className="text-right font-mono text-emerald-700">{money(r.discount)}</td>
              <td className="text-right font-mono text-emerald-700">{money(r.subsidy)}</td>
              <td className="text-right font-mono font-bold">{money(r.net)}</td>
            </tr>
          ))}
          <tr className="!bg-slate-50 font-bold border-t-2 border-slate-300">
            <td>Total reconciliation</td><td className="text-right font-mono">{tot.bills} bills</td><td className="text-right font-mono">{money(tot.gross)}</td>
            <td className="text-right font-mono text-emerald-700">{money(tot.discount)}</td><td className="text-right font-mono text-emerald-700">{money(tot.subsidy)}</td><td className="text-right font-mono text-[#0284c7]">{money(tot.net)}</td>
          </tr>
        </Tbl>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sync — `offline_cloud_sync_outbox_engine_workstation` (Phase 08 not started)
// ---------------------------------------------------------------------------
function Sync() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => { api.get('/sync/status').then(setStatus).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  async function run() {
    try { const r = await api.post('/sync/run'); setMsg(`Synced ${r.synced} record(s).`); load(); } catch (e) { setErr(e.message); }
  }
  if (!status) return <Empty>Loading…</Empty>;
  return (
    <>
      <PageHead title="Sync Outbox & LAN Telemetry" sub="Operations are recorded locally and queued. Phase 08 carries the queue to the portals; until then this is what the engine holds."
        right={<button type="button" className={BTN_PRIMARY} onClick={run} disabled={!status.pending}><Icon name="returns" size={14} /> Sync now</button>} />
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <Notice tone="amber" title="Phase 08 — portals & sync — has not started">The cloud tier, the USB-carried transfer and the cluster telemetry in the mockup do not exist yet. The queue below is real; "sync now" stamps it as sent to the local tier.</Notice>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="Pending dispatch" value={status.pending} unit={(status.pending) === 1 ? 'mutation' : 'mutations'} tone={status.pending ? 'amber' : 'emerald'} icon="clock" sub="Queued on this node" />
        <Kpi label="Synced" value={status.synced} unit={(status.synced) === 1 ? 'record' : 'records'} tone="emerald" icon="check" sub="Stamped as sent" />
        <Kpi label="Connectivity" value="LAN only" mono={false} icon="shield" sub="No internet by design on this site" />
        <Kpi label="Last sync" value={status.last_sync ? String(status.last_sync).slice(0, 16).replace('T', ' ') : 'never'} mono icon="file" sub="Server time" />
      </div>
      <Card flush title="Sync Outbox Engine Pipeline" sub="Pending records by entity">
        <Tbl head={['Entity', 'Pending']} right={[1]}>
          {status.by_entity.map((e) => <tr key={e.entity}><td className="font-semibold">{e.entity}</td><td className="text-right font-mono">{e.c}</td></tr>)}
          {!status.by_entity.length && <tr><td colSpan={2}><Empty>Queue is empty — everything is in sync.</Empty></td></tr>}
        </Tbl>
      </Card>
    </>
  );
}
