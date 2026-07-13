import React, { useState, useEffect } from 'react';
import Select from "../components/Select.jsx";
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, CategoryBadge } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import QR from '../components/QRCode.jsx';

const CATEGORIES = ['Paid', 'Complete Free', 'Discounted', 'Staff'];
const DEPTS = ['OPD', 'Medicine', 'Surgery', 'Gynae', 'Pediatrics', 'Dialysis'];

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

// Two-step progress header (Identify → Details).
function Stepper({ step }) {
  const items = [{ n: 1, k: 'Step 1', v: 'Identify' }, { n: 2, k: 'Step 2', v: 'Details' }];
  return (
    <div className="stepper">
      {items.map((it, i) => (
        <React.Fragment key={it.n}>
          <div className={`node ${step === it.n ? 'active' : step > it.n ? 'done' : ''}`}>
            <span className="dot">{step > it.n ? <Icon name="check" size={17} strokeWidth={3} /> : it.n}</span>
            <span className="txt"><span className="k">{it.k}</span><span className="v">{it.v}</span></span>
          </div>
          {i === 0 && <div className={`bar ${step > 1 ? 'filled' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function RegisterPatient() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ full_name: '', gender: 'Male', age: '', contact: '', cnic: '',
    guardian_name: '', address: '', category: 'Paid', visit_type: 'OPD', department: 'OPD', consent_online: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [dupes, setDupes] = useState(null);
  const [matches, setMatches] = useState([]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  // Step 1: as the receptionist types a contact number or CNIC, look up any
  // existing patient with the same identifier so a returning patient is
  // surfaced before a duplicate record is created (FR-PAT-03/07).
  useEffect(() => {
    if (step !== 1) return;
    const contact = f.contact.trim();
    const cnic = f.cnic.trim();
    if (contact.length < 7 && cnic.length < 6) { setMatches([]); return; }
    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      if (contact) qs.set('contact', contact);
      if (cnic) qs.set('cnic', cnic);
      api.get(`/patients/lookup?${qs.toString()}`).then(setMatches).catch(() => setMatches([]));
    }, 350);
    return () => clearTimeout(t);
  }, [f.contact, f.cnic, step]);

  // Open a fresh visit/token for an existing patient instead of re-registering.
  async function issueForExisting(patient) {
    setErr(''); setBusy(true);
    try {
      const r = await api.post(`/patients/${patient.id}/visit`, { visit_type: f.visit_type, department: f.department });
      setDone({ patient: r.patient, visit_id: r.visit_id });
      setMatches([]);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function submit(e, force = false) {
    if (e) e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.post('/patients', { ...f, age: f.age ? Number(f.age) : null, force });
      setDone({ patient: r.patient, visit_id: r.visit_id });
      setDupes(null);
    } catch (e) {
      if (e.status === 409 && e.data?.duplicates) setDupes(e.data.duplicates);
      else setErr(e.message);
    } finally { setBusy(false); }
  }

  // ---------------- Success: token receipt ----------------
  if (done) {
    const p = done.patient;
    return (
      <div className="reg">
        <div className="card receipt" style={{ margin: '0 auto' }}>
          <Alert type="ok">Patient registered successfully.</Alert>
          <div className="right no-print mb"><button className="btn ghost sm" onClick={() => window.print()}>🖨 Print token</button></div>
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #cbd5e1', paddingBottom: 14, marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Hope Welfare Trust Hospital</h2>
            <div className="muted">Patient Registration Token</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}><QR value={p.patient_code} size={120} /></div>
          </div>
          <table>
            <tbody>
              <tr><th>Patient ID</th><td className="mono"><b>{p.patient_code}</b></td></tr>
              <tr><th>Name</th><td>{p.full_name}</td></tr>
              <tr><th>Gender / Age</th><td>{p.gender} · {p.age || '—'}</td></tr>
              <tr><th>Category</th><td>{p.category}</td></tr>
              <tr><th>Department</th><td>{f.department}</td></tr>
              <tr><th>QR Card Token</th><td className="mono">{p.qr_token}</td></tr>
              <tr><th>Date</th><td>{new Date().toLocaleString()}</td></tr>
            </tbody>
          </table>
          <div className="flex mt no-print">
            <button className="btn primary" onClick={() => nav(`/patients/${p.id}`)}>Open patient record</button>
            <button className="btn ghost" onClick={() => {
              setDone(null); setStep(1); setMatches([]);
              setF({ ...f, full_name: '', contact: '', cnic: '', guardian_name: '', address: '' });
            }}>Register another</button>
          </div>
        </div>
      </div>
    );
  }

  const Head = (
    <div className="reg-head">
      <div className="ico"><Icon name="register" size={26} /></div>
      <div>
        <h2>Register Patient</h2>
        <div className="sub">Find an existing record or create a new one — the Patient ID follows them through every department.</div>
      </div>
    </div>
  );

  // ---------------- Step 1: Identify ----------------
  if (step === 1) {
    return (
      <div className="reg">
        {Head}
        <div className="card">
          <Stepper step={1} />
          <h3 style={{ marginBottom: 4 }}>Look up the patient</h3>
          <div className="muted mb">Enter the phone number or CNIC. If they have visited before, open their existing record instead of creating a duplicate.</div>
          <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

          <div className="form-row">
            <div className="field"><label>Contact Number</label>
              <div className="input-ico">
                <input value={f.contact} onChange={set('contact')} placeholder="03xx-xxxxxxx" autoFocus inputMode="tel" />
                <span className="lead"><Icon name="phone" size={18} /></span>
              </div>
            </div>
            <div className="field"><label>CNIC</label>
              <div className="input-ico">
                <input value={f.cnic} onChange={set('cnic')} placeholder="xxxxx-xxxxxxx-x" />
                <span className="lead"><Icon name="idcard" size={18} /></span>
              </div>
            </div>
          </div>

          {matches.length > 0 && (
            <div className="match-card">
              <div className="hd"><Icon name="check" size={18} strokeWidth={2.5} /> Returning patient found</div>
              {matches.map((m) => (
                <div className="match-row" key={m.id}>
                  <div className="av">{initials(m.full_name)}</div>
                  <div className="info">
                    <div className="nm">{m.full_name} <span className="badge blue mono">{m.patient_code}</span> <CategoryBadge category={m.category} /></div>
                    <div className="meta">{[m.contact, m.cnic, [m.gender, m.age ? `${m.age}y` : null].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ')}</div>
                  </div>
                  <div className="acts">
                    <button type="button" className="btn ghost sm" onClick={() => nav(`/patients/${m.id}`)}>Open record</button>
                    <button type="button" className="btn primary sm" disabled={busy} onClick={() => issueForExisting(m)}>Issue token</button>
                  </div>
                </div>
              ))}
              <div className="foot">Not the same person? Continue below to register a new patient.</div>
            </div>
          )}

          <div className="reg-actions">
            <button type="button" className={matches.length > 0 ? 'btn' : 'btn primary'} onClick={() => { setErr(''); setStep(2); }}>
              Continue as new patient
              <Icon name="register" size={17} />
            </button>
            <button type="button" className="btn ghost" onClick={() => nav('/patients')}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Step 2: Details ----------------
  return (
    <div className="reg">
      {Head}
      <form className="card" onSubmit={submit}>
        <Stepper step={2} />

        <div className="id-summary">
          <div className="items">
            <div><div className="k">Contact</div><div className="v">{f.contact || '—'}</div></div>
            <div><div className="k">CNIC</div><div className="v mono">{f.cnic || '—'}</div></div>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => { setDupes(null); setStep(1); }}>← Edit</button>
        </div>

        <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
        {dupes && (
          <div className="alert" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
            <b>Possible duplicate.</b> A patient with matching details already exists:
            <ul style={{ margin: '6px 0' }}>
              {dupes.map((d) => (
                <li key={d.id}><a onClick={() => nav(`/patients/${d.id}`)}>{d.patient_code} — {d.full_name}{d.contact ? ` (${d.contact})` : ''}</a></li>
              ))}
            </ul>
            <div className="flex mt">
              <button type="button" className="btn sm" onClick={() => submit(null, true)} disabled={busy}>Register anyway</button>
              <button type="button" className="btn ghost sm" onClick={() => setDupes(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="reg-sec">
          <div className="sec-title"><Icon name="user" size={15} /> Patient Information</div>
          <div className="field">
            <label>Full Name *</label>
            <input value={f.full_name} onChange={set('full_name')} required autoFocus placeholder="Patient's full name" />
          </div>
          <div className="form-row cols-3">
            <div className="field"><label>Gender</label>
              <Select value={f.gender} onChange={set('gender')}><option>Male</option><option>Female</option><option>Other</option></Select></div>
            <div className="field"><label>Age</label><input type="number" min="0" value={f.age} onChange={set('age')} placeholder="Years" /></div>
            <div className="field"><label>Guardian Name</label><input value={f.guardian_name} onChange={set('guardian_name')} placeholder="Next of kin" /></div>
          </div>
          <div className="field"><label>Address</label><input value={f.address} onChange={set('address')} placeholder="Village / town / district" /></div>
        </div>

        <div className="reg-sec">
          <div className="sec-title"><Icon name="stethoscope" size={15} /> Visit &amp; Billing</div>
          <div className="form-row cols-3">
            <div className="field"><label>Billing Category</label>
              <Select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div className="field"><label>Visit Type</label>
              <Select value={f.visit_type} onChange={set('visit_type')}><option>OPD</option><option>Follow-up</option><option>Dialysis</option></Select></div>
            <div className="field"><label>Department</label>
              <Select value={f.department} onChange={set('department')}>{DEPTS.map((d) => <option key={d}>{d}</option>)}</Select></div>
          </div>
          <div className="consent-row">
            <input type="checkbox" checked={f.consent_online} onChange={set('consent_online')} id="consent" />
            <label htmlFor="consent">Patient consents to online record storage (patient portal)</label>
          </div>
        </div>

        <div className="reg-actions">
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Register & Issue Token'}</button>
          <button type="button" className="btn ghost" onClick={() => { setDupes(null); setStep(1); }}>← Back</button>
        </div>
      </form>
    </div>
  );
}
