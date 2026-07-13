import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatusBadge, Alert, CategoryBadge } from '../components/ui.jsx';

export default function Lab() {
  const { can } = useAuth();
  const [filter, setFilter] = useState('ordered');
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [active, setActive] = useState(null);
  const [result, setResult] = useState({ result_value: '', result_notes: '' });

  function load() {
    const qs = filter === 'all' ? '' : `?status=${filter}`;
    api.get(`/lab/orders${qs}`).then(setOrders).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, [filter]);

  const [file, setFile] = useState(null);

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); return; }
    if (f.size > 15 * 1024 * 1024) { setErr('File too large (max 15 MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, data: reader.result });
    reader.readAsDataURL(f);
  }

  async function saveResult() {
    try {
      const payload = { ...result };
      if (file) { payload.file_data = file.data; payload.file_name = file.name; }
      await api.put(`/lab/orders/${active.id}/result`, payload);
      setMsg(`Result recorded for ${active.test_name}${file ? ' with report attached' : ''}. Now visible to the doctor.`);
      setActive(null); setResult({ result_value: '', result_notes: '' }); setFile(null);
      load();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <div className="card">
        <div className="flex between mb">
          <div className="flex">
            {['ordered', 'collected', 'completed', 'all'].map((s) => (
              <button key={s} className={`btn sm ${filter === s ? 'primary' : 'ghost'}`} onClick={() => setFilter(s)}>{s}</button>
            ))}
          </div>
          <button className="btn ghost sm" onClick={load}>⟳ Refresh</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Patient</th><th>Test</th><th>Sample</th><th>Range</th><th>Result</th><th>Status</th><th className="right">Action</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.full_name}</b><br /><span className="muted mono">{o.patient_code}</span> <CategoryBadge category={o.category} /></td>
                  <td>{o.test_name}</td>
                  <td className="muted">{o.sample_type || '—'}</td>
                  <td className="muted">{o.normal_range || '—'} {o.unit}</td>
                  <td>{o.result_value || '—'}{o.report_path && <> · <a href={o.report_path} target="_blank" rel="noreferrer">📄 report</a></>}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="right">
                    {can('lab.manage') && o.status !== 'completed' && (
                      <div className="flex" style={{ justifyContent: 'flex-end' }}>
                        {o.status === 'ordered' && <button className="btn sm" onClick={() => api.put(`/lab/orders/${o.id}/collect`).then(load).catch((e) => setErr(e.message))}>Collect</button>}
                        <button className="btn accent sm" onClick={() => { setActive(o); setResult({ result_value: '', result_notes: '' }); }}>Enter Result</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>No {filter} tests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {active && (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Record Result — {active.test_name}</h3>
            <div className="muted mb">{active.full_name} · {active.patient_code} · Normal range: {active.normal_range || '—'} {active.unit}</div>
            <div className="field"><label>Result Value</label><input autoFocus value={result.result_value} onChange={(e) => setResult({ ...result, result_value: e.target.value })} /></div>
            <div className="field"><label>Notes / Interpretation</label><textarea rows={3} value={result.result_notes} onChange={(e) => setResult({ ...result, result_notes: e.target.value })} /></div>
            <div className="field"><label>Attach report file (PDF / image, optional)</label>
              <input type="file" accept="application/pdf,image/*" onChange={onFile} />
              {file && <div className="muted mt">Attached: {file.name}</div>}
            </div>
            <div className="flex">
              <button className="btn primary" onClick={saveResult}>Save & Mark Complete</button>
              <button className="btn ghost" onClick={() => { setActive(null); setFile(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
