import React, { useEffect, useState } from 'react';
import Select from "../../components/Select.jsx";
import { Link } from 'react-router-dom';

const money = (n) => 'Rs ' + Number(n || 0).toLocaleString();

async function call(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/portal${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function DonorPortal() {
  const [token, setToken] = useState(sessionStorage.getItem('donor_token') || '');
  const [name, setName] = useState(sessionStorage.getItem('donor_name') || '');
  const [dash, setDash] = useState(null);
  const [donations, setDonations] = useState([]);
  const [err, setErr] = useState('');

  function loadDash(t = token) {
    call('/donor/dashboard', 'GET', null, t).then(setDash).catch((e) => setErr(e.message));
    call('/donor/donations', 'GET', null, t).then(setDonations).catch(() => {});
  }
  useEffect(() => { if (token) loadDash(); }, []);

  function onAuth(t, n) {
    sessionStorage.setItem('donor_token', t); sessionStorage.setItem('donor_name', n);
    setToken(t); setName(n); loadDash(t);
  }
  function logout() { sessionStorage.removeItem('donor_token'); setToken(''); setDash(null); }

  if (!token) return <PortalAuth kind="donor" onAuth={onAuth} />;

  return (
    <div className="portal">
      <PortalHeader title="Donor Impact Portal" name={name} onLogout={logout} sync={dash?.last_sync} />
      <div className="portal-body">
        {err && <div className="alert err">{err}</div>}
        {dash && (
          <>
            <div className="grid cols-4 mb">
              <Stat label="Patients Served" value={dash.patients_served} />
              <Stat label="Complete-Free Patients" value={dash.free_patients} />
              <Stat label="Total Subsidy Given" value={money(dash.total_subsidy)} accent />
              <Stat label="Dialysis Sessions" value={dash.dialysis_sessions} />
              <Stat label="Lab Tests Done" value={dash.lab_tests_done} />
              <Stat label="Total Donations" value={money(dash.total_donations)} accent />
            </div>
            <div className="grid cols-2" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
              <Donate token={token} onDone={() => loadDash()} />
              <div className="card">
                <h3>Your Donations</h3>
                <table><thead><tr><th>Receipt</th><th>Purpose</th><th className="right">Amount</th></tr></thead>
                  <tbody>{donations.map((d) => <tr key={d.receipt_no}><td className="mono">{d.receipt_no}</td><td>{d.purpose}{d.is_pledge ? ' (pledge)' : ''}</td><td className="right">{money(d.amount)}</td></tr>)}
                    {!donations.length && <tr><td colSpan={3} className="muted">No donations yet.</td></tr>}</tbody></table>
              </div>
            </div>
            <div className="muted mt" style={{ textAlign: 'center' }}>Figures are aggregated and de-identified. No individual patient information is shown.</div>
          </>
        )}
      </div>
    </div>
  );
}

function Donate({ token, onDone }) {
  const [amount, setAmount] = useState(''); const [purpose, setPurpose] = useState('General fund');
  const [isPledge, setIsPledge] = useState(false); const [receipt, setReceipt] = useState(null); const [err, setErr] = useState('');
  async function submit() {
    try { const r = await call('/donor/donate', 'POST', { amount: Number(amount), purpose, is_pledge: isPledge }, token); setReceipt(r); setAmount(''); onDone(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="card">
      <h3>Make a Donation / Pledge</h3>
      {err && <div className="alert err">{err}</div>}
      {receipt && <div className="alert ok">Thank you! Receipt {receipt.receipt_no} for {money(receipt.amount)}.</div>}
      <div className="field"><label>Amount</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="field"><label>Purpose</label><Select value={purpose} onChange={(e) => setPurpose(e.target.value)}><option>General fund</option><option>Dialysis fund</option><option>Free medicine fund</option><option>Lab & diagnostics</option></Select></div>
      <label className="flex" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={isPledge} onChange={(e) => setIsPledge(e.target.checked)} /> This is a pledge (not yet paid)</label>
      <button className="btn primary mt" onClick={submit} disabled={!amount}>Donate</button>
    </div>
  );
}

// ---- shared portal pieces (used by patient portal too) ----
export function PortalAuth({ kind, onAuth }) {
  const isDonor = kind === 'donor';
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr('');
    try {
      if (isDonor) {
        const path = mode === 'login' ? '/donor/login' : '/donor/register';
        const r = await call(path, 'POST', f);
        onAuth(r.token, r.name);
      } else {
        const r = await call('/patient/login', 'POST', f);
        onAuth(r.token, r.name, r.patient_code);
      }
    } catch (e) { setErr(e.message); }
  }
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h2>Hope Welfare Trust</h2>
        <div className="sub">{isDonor ? 'Donor Impact Portal' : 'Patient Portal'}</div>
        {err && <div className="alert err">{err}</div>}
        {isDonor ? (
          <>
            {mode === 'register' && <div className="field"><label>Name</label><input onChange={set('name')} required /></div>}
            <div className="field"><label>Email</label><input type="email" onChange={set('email')} required /></div>
            {mode === 'register' && <div className="field"><label>Contact</label><input onChange={set('contact')} /></div>}
            <div className="field"><label>Password</label><input type="password" onChange={set('password')} required /></div>
            <button className="btn primary" style={{ width: '100%' }}>{mode === 'login' ? 'Sign in' : 'Register'}</button>
            <div className="login-hint">{mode === 'login' ? 'New donor?' : 'Have an account?'} <a onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Register' : 'Sign in'}</a><br />Demo: donor@example.com / donor123</div>
          </>
        ) : (
          <>
            <div className="field"><label>Patient ID</label><input placeholder="HWT-000001" onChange={set('patient_code')} required /></div>
            <div className="field"><label>Registered Contact Number</label><input onChange={set('contact')} required /></div>
            <button className="btn primary" style={{ width: '100%' }}>Access My Records</button>
            <div className="login-hint">Access requires prior consent given at registration.</div>
          </>
        )}
        <div className="mt" style={{ textAlign: 'center' }}><Link to="/login">← Staff login</Link></div>
      </form>
    </div>
  );
}

export function PortalHeader({ title, name, onLogout, sync, patientCode }) {
  return (
    <header className="portal-head">
      <div><b>{title}</b>{patientCode && <span className="mono" style={{ marginLeft: 8 }}>{patientCode}</span>}</div>
      <div className="flex">
        <span className="muted" style={{ fontSize: 12 }}>Last sync: {sync ? sync.slice(0, 19).replace('T', ' ') : 'pending'}</span>
        <span>{name}</span>
        <button className="btn ghost sm" onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}

export function Stat({ label, value, accent }) {
  return <div className="stat"><div className="label">{label}</div><div className="value" style={{ color: accent ? 'var(--primary)' : undefined }}>{value}</div></div>;
}
