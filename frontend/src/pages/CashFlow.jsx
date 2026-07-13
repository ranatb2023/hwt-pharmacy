import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { api } from '../api.js';
import { Alert, StatusBadge, money } from '../components/ui.jsx';

export default function CashFlow() {
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [openFloat, setOpenFloat] = useState('5000');
  const [counter, setCounter] = useState('Counter 1');
  const [tx, setTx] = useState({ type: 'in', category: 'sale', amount: '', reason: '' });
  const [counted, setCounted] = useState('');

  function load() {
    api.get('/cashflow/current').then((r) => setSession(r.session)).catch((e) => setErr(e.message));
    api.get('/cashflow/sessions').then(setSessions).catch(() => {});
  }
  useEffect(load, []);

  async function open() {
    try { await api.post('/cashflow/open', { counter, opening_float: Number(openFloat) }); setMsg('Cash session opened.'); load(); }
    catch (e) { setErr(e.message); }
  }
  async function addTx() {
    if (!tx.amount) return;
    try { const s = await api.post('/cashflow/transaction', { session_id: session.id, ...tx, amount: Number(tx.amount) }); setSession(s); setTx({ ...tx, amount: '', reason: '' }); load(); }
    catch (e) { setErr(e.message); }
  }
  async function close() {
    try { await api.post(`/cashflow/${session.id}/close`, { counted_cash: Number(counted) }); setMsg('Session closed and reconciled.'); setSession(null); setCounted(''); load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="grid cols-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {!session ? (
          <div className="card">
            <h3>Open Cash Session</h3>
            <div className="field"><label>Counter</label><input value={counter} onChange={(e) => setCounter(e.target.value)} /></div>
            <div className="field"><label>Opening Float</label><input type="number" value={openFloat} onChange={(e) => setOpenFloat(e.target.value)} /></div>
            <button className="btn primary" onClick={open}>Open Session</button>
          </div>
        ) : (
          <div className="card">
            <div className="flex between"><h3 style={{ margin: 0 }}>{session.counter}</h3><StatusBadge status={session.status} /></div>
            <div className="grid cols-4 mt" style={{ gap: 10 }}>
              <Metric label="Opening" value={money(session.opening_float)} />
              <Metric label="Cash In" value={money(session.summary.cash_in)} />
              <Metric label="Cash Out" value={money(session.summary.cash_out)} />
              <Metric label="Expected" value={money(session.summary.expected)} accent />
            </div>
            <h3 className="mt">Record Movement</h3>
            <div className="form-row cols-3">
              <div className="field"><label>Type</label><Select value={tx.type} onChange={(e) => setTx({ ...tx, type: e.target.value })}><option value="in">Cash In</option><option value="out">Cash Out</option></Select></div>
              <div className="field"><label>Category</label><Select value={tx.category} onChange={(e) => setTx({ ...tx, category: e.target.value })}><option>sale</option><option>payment</option><option>petty</option><option>expense</option><option>misc</option></Select></div>
              <div className="field"><label>Amount</label><input type="number" value={tx.amount} onChange={(e) => setTx({ ...tx, amount: e.target.value })} /></div>
            </div>
            <div className="field"><label>Reason</label><input value={tx.reason} onChange={(e) => setTx({ ...tx, reason: e.target.value })} /></div>
            <button className="btn accent" onClick={addTx} disabled={!tx.amount}>Add Transaction</button>

            <h3 className="mt">Close & Reconcile</h3>
            <div className="flex"><input type="number" placeholder="Counted cash" value={counted} onChange={(e) => setCounted(e.target.value)} />
              <button className="btn primary" onClick={close} disabled={counted === ''}>Close Session</button></div>
            {counted !== '' && <div className="muted mt">Variance: {money(Number(counted) - session.summary.expected)}</div>}
          </div>
        )}

        <div className="card">
          <h3>Transactions {session && `(${session.transactions?.length || 0})`}</h3>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table><thead><tr><th>Time</th><th>Type</th><th>Category</th><th className="right">Amount</th></tr></thead>
              <tbody>{(session?.transactions || []).map((t) => (
                <tr key={t.id}><td className="muted">{t.created_at?.slice(11, 16)}</td><td><span className={`badge ${t.type === 'in' ? 'green' : 'amber'}`}>{t.type}</span></td><td>{t.category}</td><td className="right">{money(t.amount)}</td></tr>
              ))}
                {!session && <tr><td colSpan={4} className="muted">Open a session to record transactions.</td></tr>}</tbody></table>
          </div>
        </div>
      </div>

      <div className="card mt">
        <h3>Recent Sessions</h3>
        <table><thead><tr><th>Counter</th><th>User</th><th>Opened</th><th>Closed</th><th className="right">Expected</th><th className="right">Counted</th><th className="right">Variance</th><th>Status</th></tr></thead>
          <tbody>{sessions.map((s) => (
            <tr key={s.id}><td>{s.counter}</td><td>{s.user_name}</td><td className="muted">{s.opened_at?.slice(0, 16)}</td><td className="muted">{s.closed_at?.slice(0, 16) || '—'}</td>
              <td className="right">{s.expected_cash != null ? money(s.expected_cash) : '—'}</td><td className="right">{s.counted_cash != null ? money(s.counted_cash) : '—'}</td>
              <td className="right">{s.variance != null ? <span className={`badge ${s.variance === 0 ? 'green' : 'red'}`}>{money(s.variance)}</span> : '—'}</td><td><StatusBadge status={s.status} /></td></tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return <div className="stat" style={{ padding: 12 }}><div className="label">{label}</div><div className="value" style={{ fontSize: 18, color: accent ? 'var(--primary)' : undefined }}>{value}</div></div>;
}
