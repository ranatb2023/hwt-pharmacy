import React, { useEffect, useState } from 'react';
import { PortalAuth, PortalHeader } from './DonorPortal.jsx';

const money = (n) => 'Rs ' + Number(n || 0).toLocaleString();

async function getMe(token) {
  const res = await fetch('/api/portal/patient/me', { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function PatientPortal() {
  const [token, setToken] = useState(sessionStorage.getItem('patient_token') || '');
  const [code, setCode] = useState(sessionStorage.getItem('patient_code') || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  function load(t = token) { getMe(t).then(setData).catch((e) => setErr(e.message)); }
  useEffect(() => { if (token) load(); }, []);

  function onAuth(t, n, patientCode) {
    sessionStorage.setItem('patient_token', t); sessionStorage.setItem('patient_code', patientCode || '');
    setToken(t); setCode(patientCode || ''); load(t);
  }
  function logout() { sessionStorage.removeItem('patient_token'); setToken(''); setData(null); }

  if (!token) return <PortalAuth kind="patient" onAuth={onAuth} />;

  return (
    <div className="portal">
      <PortalHeader title="My Health Records" name={data?.patient?.full_name || ''} patientCode={code} onLogout={logout} sync={data?.last_sync} />
      <div className="portal-body">
        {err && <div className="alert err">{err}</div>}
        {data && (
          <div className="no-print" style={{ textAlign: 'right', marginBottom: 12 }}>
            <button className="btn ghost sm" onClick={() => window.print()}>🖨 Download / Print</button>
          </div>
        )}
        {data && (
          <div className="grid cols-2">
            <Section title="Consultations" rows={data.consultations} cols={['created_at', 'diagnosis', 'complaint']} labels={['Date', 'Diagnosis', 'Complaint']} />
            <Section title="Prescriptions" rows={data.prescriptions} cols={['medicine_name', 'dosage', 'frequency', 'duration']} labels={['Medicine', 'Dosage', 'Frequency', 'Duration']} />
            <Section title="Lab Results" rows={data.lab} cols={['test_name', 'result_value', 'status', 'report_path']} labels={['Test', 'Result', 'Status', 'Report']}
              render={{ report_path: (v) => (v ? <a href={v} target="_blank" rel="noreferrer">📄 view</a> : '—') }} />
            <Section title="Bills" rows={data.bills} cols={['bill_no', 'net_amount', 'status']} labels={['Bill No', 'Amount', 'Status']} render={{ net_amount: money }} />
          </div>
        )}
        <div className="muted mt" style={{ textAlign: 'center' }}>Your records are private to you. Data reflects the last successful sync from the hospital.</div>
      </div>
    </div>
  );
}

function Section({ title, rows, cols, labels, render = {} }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <thead><tr>{labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>
          {(rows || []).map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{render[c] ? render[c](r[c]) : (c === 'created_at' && r[c] ? r[c].slice(0, 10) : (r[c] ?? '—'))}</td>)}</tr>
          ))}
          {(!rows || !rows.length) && <tr><td colSpan={cols.length} className="muted">None on record.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
