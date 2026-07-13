import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CategoryBadge, Alert } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

export default function Patients() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');

  function load(query = '') {
    api.get('/patients' + (query ? `?q=${encodeURIComponent(query)}` : ''))
      .then(setRows).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <div className="card">
        <div className="flex between mb">
          <form className="flex" onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ flex: 1, maxWidth: 460 }}>
            <input placeholder="Search by Patient ID, name, contact or CNIC…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn">Search</button>
          </form>
          {can('patient.manage') && <Link to="/patients/new" className="btn primary"><Icon name="register" size={17} /> Register Patient</Link>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Patient ID</th><th>Name</th><th>Gender/Age</th><th>Contact</th><th>Category</th><th>Registered</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/patients/${p.id}`)}>
                  <td className="mono">{p.patient_code}</td>
                  <td><b>{p.full_name}</b></td>
                  <td>{[p.gender, p.age ? `${p.age}y` : null].filter(Boolean).join(' · ')}</td>
                  <td>{p.contact || '—'}</td>
                  <td><CategoryBadge category={p.category} /></td>
                  <td className="muted">{p.created_at?.slice(0, 10)}</td>
                  <td className="right"><Link to={`/patients/${p.id}`}>Open →</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>No patients found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
