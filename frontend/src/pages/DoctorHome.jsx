import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Select from '../components/Select.jsx';
import { Icon } from '../components/icons.jsx';
import { CategoryBadge, StatusBadge, Alert } from '../components/ui.jsx';

const DEPTS = ['OPD', 'Medicine', 'Surgery', 'Gynae', 'Pediatrics', 'Dialysis'];

// Doctor home = a waiting-patient worklist. Land → one click to consult.
export default function DoctorHome() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [dept, setDept] = useState(user?.department && DEPTS.includes(user.department) ? user.department : 'OPD');
  const [rows, setRows] = useState([]);
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get(`/tokens/queue/${encodeURIComponent(dept)}`)
      .then((r) => { setRows(r); setLoading(false); })
      .catch((e) => { setErr(e.message); setLoading(false); });
  }
  useEffect(() => { load(); }, [dept]);

  async function open(e) {
    e.preventDefault();
    const k = key.trim();
    if (!k) return;
    setErr('');
    try {
      const p = await api.get(`/patients/resolve/${encodeURIComponent(k)}`);
      nav(`/patients/${p.id}`);
    } catch (e) { setErr(e.message); }
  }

  const waiting = rows.filter((t) => t.status !== 'done' && t.status !== 'cancelled');

  return (
    <div>
      <div className="hub-welcome">
        <h2>Welcome, {user?.full_name || 'Doctor'}</h2>
        <div className="muted">Open a patient record, or consult the next waiting patient.</div>
      </div>

      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <form className="hub-search" onSubmit={open}>
        <div className="input-ico" style={{ flex: 1 }}>
          <input value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="Scan QR card or enter Patient ID to open a record…" />
          <span className="lead"><Icon name="search" size={18} /></span>
        </div>
        <button className="btn primary">Open record</button>
      </form>

      <div className="card">
        <div className="dh-head">
          <span className="dh-title"><Icon name="queue" size={18} /> Waiting Patients
            <span className="count">{waiting.length} waiting</span></span>
          <div className="flex" style={{ gap: 8 }}>
            <Select value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 170 }}>
              {DEPTS.map((d) => <option key={d}>{d}</option>)}
            </Select>
            <button className="btn ghost sm" onClick={load}><Icon name="returns" size={15} /> Refresh</button>
          </div>
        </div>

        {loading ? (
          <div className="dh-empty muted">Loading…</div>
        ) : waiting.length === 0 ? (
          <div className="dh-empty">
            <Icon name="check" size={30} strokeWidth={2.5} />
            <div>No patients waiting in {dept}.</div>
            <div className="muted sm">Patients routed here by reception will appear automatically.</div>
          </div>
        ) : (
          <div className="dh-list">
            {waiting.map((t) => (
              <div key={t.id} className="dh-row" role="button" tabIndex={0}
                onClick={() => nav(`/consultation/${t.visit_id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') nav(`/consultation/${t.visit_id}`); }}>
                <div className="dh-tok">#{t.token_number}</div>
                <div className="dh-info">
                  <div className="dh-name">{t.full_name} <CategoryBadge category={t.category} /></div>
                  <div className="muted mono sm">{t.patient_code}</div>
                </div>
                <StatusBadge status={t.status} />
                <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); nav(`/consultation/${t.visit_id}`); }}>
                  Consult <Icon name="arrowright" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dh-links">
        {can('lab.view') && <button className="dh-link" onClick={() => nav('/lab')}><Icon name="lab" size={17} /> Laboratory</button>}
        {can('dialysis.view') && <button className="dh-link" onClick={() => nav('/dialysis')}><Icon name="dialysis" size={17} /> Dialysis</button>}
        {can('patient.view') && <button className="dh-link" onClick={() => nav('/patients')}><Icon name="patients" size={17} /> All Patients</button>}
      </div>
    </div>
  );
}
