import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, StatusBadge, CategoryBadge, money } from '../components/ui.jsx';
import { Modal, Actions } from './Vendors.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function Dialysis() {
  const { can } = useAuth();
  const [date, setDate] = useState(today());
  const [sessions, setSessions] = useState([]);
  const [stations, setStations] = useState([]);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [completing, setCompleting] = useState(null);

  function load() {
    api.get(`/dialysis/sessions?date=${date}`).then(setSessions).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, [date]);
  useEffect(() => {
    api.get('/dialysis/stations').then(setStations).catch(() => {});
    api.get('/inventory/products').then(setProducts).catch(() => {});
  }, []);

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <div className="card">
        <div className="flex between mb">
          <div className="flex"><label style={{ margin: 0 }}>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></div>
          {can('dialysis.manage') && <button className="btn primary" onClick={() => setScheduling(true)}>➕ Schedule Session</button>}
        </div>
        <table>
          <thead><tr><th>Time</th><th>Patient</th><th>Station</th><th>Status</th><th className="right">Action</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.scheduled_at?.slice(11, 16) || s.scheduled_at}</td>
                <td><b>{s.full_name}</b> <span className="muted mono">{s.patient_code}</span> <CategoryBadge category={s.category} /></td>
                <td>{s.station_name || '—'}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="right">{can('dialysis.manage') && s.status !== 'completed' && s.status !== 'cancelled' && <button className="btn accent sm" onClick={() => setCompleting(s)}>Complete</button>}
                  {s.bill_id && <span className="badge green">billed</span>}</td>
              </tr>
            ))}
            {!sessions.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>No sessions for {date}.</td></tr>}
          </tbody>
        </table>
      </div>

      {scheduling && <ScheduleModal stations={stations} onClose={() => setScheduling(false)} onDone={(m) => { setMsg(m); setScheduling(false); load(); }} onErr={setErr} />}
      {completing && <CompleteModal session={completing} products={products} onClose={() => setCompleting(null)} onDone={(m) => { setMsg(m); setCompleting(null); load(); }} onErr={setErr} />}
    </div>
  );
}

function ScheduleModal({ stations, onClose, onDone, onErr }) {
  const [q, setQ] = useState(''); const [patient, setPatient] = useState(null);
  const [f, setF] = useState({ station_id: '', scheduled_at: `${today()}T09:00`, base_charge: 2500, duration_min: 240 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function find() {
    try { const rows = await api.get(`/patients?q=${encodeURIComponent(q)}`); if (!rows.length) return onErr('No patient found.'); setPatient(rows[0]); }
    catch (e) { onErr(e.message); }
  }
  async function save() {
    if (!patient) return onErr('Select a patient.');
    try {
      await api.post('/dialysis/sessions', { patient_id: patient.id, station_id: f.station_id ? Number(f.station_id) : null, scheduled_at: f.scheduled_at.replace('T', ' '), base_charge: Number(f.base_charge), duration_min: Number(f.duration_min) });
      onDone(`Session scheduled for ${patient.full_name}.`);
    } catch (e) { onErr(e.message); }
  }
  return (
    <Modal title="Schedule Dialysis Session" onClose={onClose}>
      <div className="field"><label>Patient</label><div className="flex"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient ID / name" /><button className="btn" onClick={find}>Find</button></div>
        {patient && <div className="alert info mt">{patient.full_name} · {patient.patient_code} <CategoryBadge category={patient.category} /></div>}</div>
      <div className="form-row">
        <div className="field"><label>Station</label><Select value={f.station_id} onChange={set('station_id')}><option value="">Any</option>{stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div className="field"><label>Scheduled At</label><input type="datetime-local" value={f.scheduled_at} onChange={set('scheduled_at')} /></div>
        <div className="field"><label>Base Charge</label><input type="number" value={f.base_charge} onChange={set('base_charge')} /></div>
        <div className="field"><label>Duration (min)</label><input type="number" value={f.duration_min} onChange={set('duration_min')} /></div>
      </div>
      <Actions onClose={onClose} label="Schedule" onSave={save} disabled={!patient} />
    </Modal>
  );
}

function CompleteModal({ session, products, onClose, onDone, onErr }) {
  const [vitals, setVitals] = useState({ bp: '', weight: '' });
  const [rows, setRows] = useState([{ product_id: '', quantity: 1 }]);
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  async function save() {
    const consumables = rows.filter((r) => r.product_id && r.quantity > 0).map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity) }));
    try { const d = await api.post(`/dialysis/sessions/${session.id}/complete`, { post_vitals: vitals, consumables }); onDone(`Session completed. Bill ${d.billNo} · ${money(d.gross)}.`); }
    catch (e) { onErr(e.message); }
  }
  return (
    <Modal title={`Complete Session — ${session.full_name}`} onClose={onClose}>
      <div className="muted mb">Base charge {money(session.base_charge)} · Category {session.category} (billing applied automatically)</div>
      <div className="form-row"><div className="field"><label>Post BP</label><input value={vitals.bp} onChange={(e) => setVitals({ ...vitals, bp: e.target.value })} /></div>
        <div className="field"><label>Weight kg</label><input value={vitals.weight} onChange={(e) => setVitals({ ...vitals, weight: e.target.value })} /></div></div>
      <label>Consumables used (deducted from stock)</label>
      {rows.map((r, i) => (
        <div key={i} className="flex mb">
          <Select value={r.product_id} onChange={(e) => setRow(i, 'product_id', e.target.value)}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.sale_price)} · stock {p.on_hand}</option>)}</Select>
          <input type="number" min="1" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} style={{ width: 80 }} />
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => setRows((r) => [...r, { product_id: '', quantity: 1 }])}>+ Add consumable</button>
      <Actions onClose={onClose} label="Complete & Bill" onSave={save} />
    </Modal>
  );
}
