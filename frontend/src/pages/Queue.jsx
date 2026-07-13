import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatusBadge, CategoryBadge, Alert } from '../components/ui.jsx';

const DEPTS = ['OPD', 'Medicine', 'Surgery', 'Gynae', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Dialysis'];

export default function Queue() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [dept, setDept] = useState('OPD');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');

  function load() {
    api.get(`/tokens/queue/${dept}`).then(setRows).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, [dept]);

  async function setStatus(id, status) {
    try { await api.put(`/tokens/${id}/status`, { status }); load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div className="card">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <div className="flex between mb">
        <div className="flex">
          <label style={{ margin: 0 }}>Department</label>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 200 }}>
            {DEPTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
        </div>
        <button className="btn ghost sm" onClick={load}>⟳ Refresh</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Token</th><th>Patient ID</th><th>Name</th><th>Category</th><th>Status</th><th className="right">Actions</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td><b style={{ fontSize: 16 }}>#{t.token_number}</b></td>
                <td className="mono">{t.patient_code}</td>
                <td>{t.full_name}</td>
                <td><CategoryBadge category={t.category} /></td>
                <td><StatusBadge status={t.status} /></td>
                <td className="right">
                  <div className="flex" style={{ justifyContent: 'flex-end' }}>
                    {can('consult.manage') && <button className="btn accent sm" onClick={() => nav(`/consultation/${t.visit_id}`)}>Consult</button>}
                    {t.status === 'waiting' && <button className="btn sm" onClick={() => setStatus(t.id, 'serving')}>Serve</button>}
                    {t.status !== 'done' && <button className="btn sm" onClick={() => setStatus(t.id, 'done')}>Done</button>}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>No tokens for {dept} today.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
