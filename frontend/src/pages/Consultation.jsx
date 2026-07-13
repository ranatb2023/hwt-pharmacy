import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, Loading, CategoryBadge } from '../components/ui.jsx';

export default function Consultation() {
  const { visitId } = useParams();
  const nav = useNavigate();
  const [visit, setVisit] = useState(null);
  const [patient, setPatient] = useState(null);
  const [tests, setTests] = useState([]);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ complaint: '', diagnosis: '', notes: '', referral: '',
    vitals: { bp: '', pulse: '', temp: '', weight: '', spo2: '' } });
  const [rx, setRx] = useState([{ medicine_name: '', product_id: '', dosage: '', frequency: '', duration: '' }]);
  const [labIds, setLabIds] = useState([]);

  useEffect(() => {
    // Reset the form when moving to another patient (e.g. "Save & see next"),
    // otherwise the previous consultation's entries would carry over.
    setForm({ complaint: '', diagnosis: '', notes: '', referral: '', vitals: { bp: '', pulse: '', temp: '', weight: '', spo2: '' } });
    setRx([{ medicine_name: '', product_id: '', dosage: '', frequency: '', duration: '' }]);
    setLabIds([]);
    setMsg('');
    async function load() {
      try {
        const [ctx, t, prods] = await Promise.all([
          api.get(`/consultations/context/${visitId}`),
          api.get('/lab/tests').catch(() => []),
          api.get('/inventory/products').catch(() => []),
        ]);
        setVisit(ctx.visit);
        setPatient(ctx.patient);
        setTests(t);
        setProducts(prods);
      } catch (e) { setErr(e.message); }
    }
    load();
  }, [visitId]);

  const setV = (k) => (e) => setForm((f) => ({ ...f, vitals: { ...f.vitals, [k]: e.target.value } }));
  const setRxRow = (i, k, val) => setRx((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: val } : r)));
  const addRx = () => setRx((r) => [...r, { medicine_name: '', product_id: '', dosage: '', frequency: '', duration: '' }]);
  const toggleLab = (id) => setLabIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function save(goNext = false) {
    setErr(''); setBusy(true);
    try {
      const prescriptions = rx
        .filter((r) => r.medicine_name.trim())
        .map((r) => ({ ...r, product_id: r.product_id ? Number(r.product_id) : null }));
      await api.post('/consultations', {
        visit_id: Number(visitId),
        complaint: form.complaint, diagnosis: form.diagnosis, notes: form.notes, referral: form.referral,
        vitals: form.vitals, prescriptions, lab_test_ids: labIds,
      });
      setMsg('Consultation saved. Lab and pharmacy can now see the orders.');
      if (goNext) { await goToNext(); }
      else { setTimeout(() => nav(patient ? `/patients/${patient.id}` : '/'), 1200); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Mark this patient done in the queue and jump to the next waiting patient's
  // consultation; if none remain, return to the doctor home.
  async function goToNext() {
    const deptName = visit?.department || 'OPD';
    try {
      const q = await api.get(`/tokens/queue/${encodeURIComponent(deptName)}`);
      const curr = q.find((t) => String(t.visit_id) === String(visitId));
      if (curr) { try { await api.put(`/tokens/${curr.id}/status`, { status: 'done' }); } catch { /* non-blocking */ } }
      const next = q.find((t) => String(t.visit_id) !== String(visitId) && t.status !== 'done' && t.status !== 'cancelled');
      nav(next ? `/consultation/${next.visit_id}` : '/');
    } catch { nav('/'); }
  }

  function onPickProduct(i, productId) {
    const prod = products.find((p) => String(p.id) === String(productId));
    setRx((rows) => rows.map((r, idx) => (idx === i ? { ...r, product_id: productId, medicine_name: prod ? prod.name : r.medicine_name } : r)));
  }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok">{msg}</Alert>

      {patient ? (
        <div className="card mb">
          <div className="flex between">
            <div><b style={{ fontSize: 16 }}>{patient.full_name}</b> <CategoryBadge category={patient.category} />
              <span className="muted mono"> · {patient.patient_code}</span></div>
            <div className="muted">{patient.gender} · {patient.age || '—'}y</div>
          </div>
        </div>
      ) : <div className="card mb muted">Visit #{visitId}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>Clinical Notes</h3>
          <div className="field"><label>Presenting Complaint</label><input value={form.complaint} onChange={(e) => setForm({ ...form, complaint: e.target.value })} /></div>
          <div className="field"><label>Diagnosis</label><input value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></div>
          <div className="field"><label>Notes</label><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="field"><label>Referral</label><input value={form.referral} onChange={(e) => setForm({ ...form, referral: e.target.value })} /></div>

          <h3 className="mt">Vitals</h3>
          <div className="form-row cols-3">
            <div className="field"><label>BP</label><input value={form.vitals.bp} onChange={setV('bp')} placeholder="120/80" /></div>
            <div className="field"><label>Pulse</label><input value={form.vitals.pulse} onChange={setV('pulse')} /></div>
            <div className="field"><label>Temp °F</label><input value={form.vitals.temp} onChange={setV('temp')} /></div>
            <div className="field"><label>Weight kg</label><input value={form.vitals.weight} onChange={setV('weight')} /></div>
            <div className="field"><label>SpO₂ %</label><input value={form.vitals.spo2} onChange={setV('spo2')} /></div>
          </div>
        </div>

        <div>
          <div className="card mb">
            <div className="card-title-row"><h3>Prescription</h3><button className="btn ghost sm" onClick={addRx}>+ Add</button></div>
            {rx.map((r, i) => (
              <div key={i} className="mb" style={{ borderBottom: '1px solid #eef2f7', paddingBottom: 8 }}>
                <div className="field" style={{ marginBottom: 6 }}>
                  <Select value={r.product_id} onChange={(e) => onPickProduct(i, e.target.value)}>
                    <option value="">— Select from stock (or type below) —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} (stock: {p.on_hand})</option>)}
                  </Select>
                </div>
                <input placeholder="Medicine name" value={r.medicine_name} onChange={(e) => setRxRow(i, 'medicine_name', e.target.value)} style={{ marginBottom: 6 }} />
                <div className="form-row cols-3">
                  <input placeholder="Dosage" value={r.dosage} onChange={(e) => setRxRow(i, 'dosage', e.target.value)} />
                  <input placeholder="Frequency" value={r.frequency} onChange={(e) => setRxRow(i, 'frequency', e.target.value)} />
                  <input placeholder="Duration" value={r.duration} onChange={(e) => setRxRow(i, 'duration', e.target.value)} />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Order Lab Tests</h3>
            <div className="flex wrap">
              {tests.map((t) => (
                <label key={t.id} className="flex" style={{ gap: 6, margin: 0, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: labIds.includes(t.id) ? 'var(--primary-soft)' : '#fff' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={labIds.includes(t.id)} onChange={() => toggleLab(t.id)} />
                  {t.name} <span className="muted">Rs{t.price}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex mt">
        <button className="btn primary" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save Consultation'}</button>
        <button className="btn accent" onClick={() => save(true)} disabled={busy}>Save &amp; see next →</button>
        <button className="btn ghost" onClick={() => nav(-1)}>Cancel</button>
      </div>
    </div>
  );
}
