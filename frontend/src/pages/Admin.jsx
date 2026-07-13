import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, money } from '../components/ui.jsx';

export default function Admin() {
  const { can } = useAuth();
  const [tab, setTab] = useState('users');
  const tabs = [['users', 'Users'], ['roles', 'Roles'], ['settings', 'Settings'], ['audit', 'Audit Log'], ['subsidy', 'Subsidy Report']];
  if (can('sync.manage')) tabs.push(['sync', 'Sync']);
  return (
    <div>
      <div className="flex mb">
        {tabs.map(([k, l]) => (
          <button key={k} className={`btn sm ${tab === k ? 'primary' : 'ghost'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'roles' && <Roles />}
      {tab === 'settings' && <Settings />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'subsidy' && <Subsidy />}
      {tab === 'sync' && <Sync />}
    </div>
  );
}

const SETTING_FIELDS = [
  ['consultation_fee', 'Consultation Fee (Rs)', 'money'],
  ['dialysis_charge', 'Dialysis Base Charge (Rs)', 'money'],
  ['discount_pct', 'Discounted Category %', 'pct'],
  ['staff_pct', 'Staff Category %', 'pct'],
  ['staff_annual_cap', 'Staff Annual Discount Cap (Rs)', 'money'],
  ['refund_auth_threshold', 'Refund Authorisation Threshold (Rs)', 'money'],
];

function Settings() {
  const [form, setForm] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => {
    api.get('/settings').then((r) => {
      // percentages shown as whole numbers in the UI
      const f = { ...r.settings };
      f.discount_pct = Math.round(f.discount_pct * 100);
      f.staff_pct = Math.round(f.staff_pct * 100);
      setForm(f);
    }).catch((e) => setErr(e.message));
  }, []);
  if (!form) return <div className="loading">Loading…</div>;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function save() {
    setErr(''); setMsg('');
    try {
      const payload = { ...form, discount_pct: Number(form.discount_pct) / 100, staff_pct: Number(form.staff_pct) / 100 };
      await api.put('/settings', payload);
      setMsg('Settings saved. New prices and rules apply to future transactions.');
    } catch (e) { setErr(e.message); }
  }
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Pricing & Discount Rules</h3>
      <div className="muted mb">Administrator-configurable. Changes apply to new bills only; existing bills are unchanged.</div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <div className="form-row">
        {SETTING_FIELDS.map(([k, label, type]) => (
          <div className="field" key={k}>
            <label>{label}{type === 'pct' ? ' (0–100)' : ''}</label>
            <input type="number" min="0" step={type === 'pct' ? '1' : '0.01'} value={form[k]} onChange={set(k)} />
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={save}>Save Settings</button>
    </div>
  );
}

function Sync() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  function load() { api.get('/sync/status').then(setStatus).catch((e) => setErr(e.message)); }
  useEffect(load, []);
  async function run() {
    try { const r = await api.post('/sync/run'); setMsg(`Synced ${r.synced} record(s) to the cloud tier.`); load(); }
    catch (e) { setErr(e.message); }
  }
  if (!status) return <div className="loading">Loading…</div>;
  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <div className="grid cols-4 mb">
        <div className="stat accent"><div className="label">Pending</div><div className="value">{status.pending}</div></div>
        <div className="stat"><div className="label">Synced</div><div className="value">{status.synced}</div></div>
        <div className="stat"><div className="label">Connectivity</div><div className="value" style={{ fontSize: 18 }}><span className="badge green">online</span></div></div>
        <div className="stat"><div className="label">Last Sync</div><div className="value" style={{ fontSize: 14 }}>{status.last_sync ? status.last_sync.slice(0, 19).replace('T', ' ') : 'never'}</div></div>
      </div>
      <div className="card">
        <div className="flex between mb"><h3 style={{ margin: 0 }}>Sync Engine</h3><button className="btn primary" onClick={run} disabled={!status.pending}>⟳ Sync Now</button></div>
        <div className="muted mb">Offline-first: operations are recorded locally and queued. The engine drains the queue to the cloud tier (donor & patient portals) when connectivity is available — idempotent and resumable.</div>
        <table><thead><tr><th>Entity</th><th className="right">Pending</th></tr></thead>
          <tbody>{status.by_entity.map((e) => <tr key={e.entity}><td>{e.entity}</td><td className="right">{e.c}</td></tr>)}
            {!status.by_entity.length && <tr><td colSpan={2} className="muted">Queue is empty — everything is in sync.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ username: '', full_name: '', password: '', role_id: '', department: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function load() {
    api.get('/users').then(setUsers).catch((e) => setErr(e.message));
    api.get('/users/roles').then((r) => setRoles(r.roles)).catch(() => {});
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault(); setErr('');
    try { await api.post('/users', { ...f, role_id: Number(f.role_id) }); setMsg('User created.'); setF({ username: '', full_name: '', password: '', role_id: '', department: '' }); load(); }
    catch (e) { setErr(e.message); }
  }
  async function toggle(u) {
    await api.put(`/users/${u.id}/active`, { is_active: u.is_active ? 0 : 1 }).catch((e) => setErr(e.message));
    load();
  }

  return (
    <div className="grid cols-2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <div className="card table-wrap">
        <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Dept</th><th>Status</th><th></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td>{u.full_name}</td><td className="mono">{u.username}</td><td>{u.role}</td><td>{u.department || '—'}</td>
              <td><span className={`badge ${u.is_active ? 'green' : 'red'}`}>{u.is_active ? 'active' : 'inactive'}</span></td>
              <td className="right"><button className="btn ghost sm" onClick={() => toggle(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <form className="card" onSubmit={create}>
        <h3>Add User</h3>
        <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
        <div className="field"><label>Full Name *</label><input value={f.full_name} onChange={set('full_name')} required /></div>
        <div className="field"><label>Username *</label><input value={f.username} onChange={set('username')} required /></div>
        <div className="field"><label>Password *</label><input type="password" value={f.password} onChange={set('password')} required /></div>
        <div className="field"><label>Role *</label>
          <Select value={f.role_id} onChange={set('role_id')} required><option value="">— Select —</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
        <div className="field"><label>Department</label><input value={f.department} onChange={set('department')} /></div>
        <button className="btn primary">Create User</button>
      </form>
    </div>
  );
}

function Roles() {
  const [data, setData] = useState({ roles: [], all_permissions: [] });
  useEffect(() => { api.get('/users/roles').then(setData).catch(() => {}); }, []);
  return (
    <div className="card table-wrap">
      <h3>Roles & Permissions</h3>
      <table>
        <thead><tr><th>Role</th><th>Description</th><th>Permissions</th></tr></thead>
        <tbody>{data.roles.map((r) => (
          <tr key={r.id}><td><b>{r.name}</b></td><td className="muted">{r.description}</td>
            <td><div className="flex wrap" style={{ gap: 4 }}>{r.permissions.map((p) => <span key={p} className="badge gray">{p}</span>)}</div></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function AuditLog() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/reports/audit').then(setRows).catch((e) => setErr(e.message)); }, []);
  return (
    <div className="card table-wrap">
      <Alert type="error">{err}</Alert>
      <h3>Audit Log (recent 200)</h3>
      <table>
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody>{rows.map((a) => (
          <tr key={a.id}><td className="muted">{a.created_at}</td><td>{a.username || '—'}</td><td><span className="badge blue">{a.action}</span></td>
            <td>{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td><td className="muted mono" style={{ fontSize: 11 }}>{a.detail || ''}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Subsidy() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/reports/subsidy').then(setRows).catch((e) => setErr(e.message)); }, []);
  const tot = rows.reduce((a, r) => ({ gross: a.gross + r.gross, discount: a.discount + r.discount, subsidy: a.subsidy + r.subsidy, net: a.net + r.net }), { gross: 0, discount: 0, subsidy: 0, net: 0 });
  return (
    <div className="card table-wrap">
      <Alert type="error">{err}</Alert>
      <h3>Discount & Subsidy Report (all-time)</h3>
      <table>
        <thead><tr><th>Category</th><th className="right">Bills</th><th className="right">Gross</th><th className="right">Discount</th><th className="right">Subsidy</th><th className="right">Net Collected</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category}><td>{r.category}</td><td className="right">{r.bills}</td><td className="right">{money(r.gross)}</td><td className="right">{money(r.discount)}</td><td className="right">{money(r.subsidy)}</td><td className="right">{money(r.net)}</td></tr>
          ))}
          <tr style={{ fontWeight: 700 }}><td>Total</td><td></td><td className="right">{money(tot.gross)}</td><td className="right">{money(tot.discount)}</td><td className="right">{money(tot.subsidy)}</td><td className="right">{money(tot.net)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
