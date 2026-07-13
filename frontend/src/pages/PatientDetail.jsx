import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CategoryBadge, StatusBadge, Alert, Loading, money } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import QR from '../components/QRCode.jsx';
import QRCode from 'qrcode';

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

// Open a compact print window containing just the QR pharmacy card.
async function printQRCard(p) {
  const dataUrl = await QRCode.toDataURL(String(p.patient_code), { width: 220, margin: 1 });
  const w = window.open('', '_blank', 'width=380,height=460');
  w.document.write(`<html><head><title>QR Card ${p.patient_code}</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:24px" onload="window.print()">
      <h3 style="margin:0">Hope Welfare Trust Hospital</h3>
      <div style="color:#666;font-size:12px;margin-bottom:12px">Pharmacy QR Card</div>
      <img src="${dataUrl}" width="220" height="220" />
      <div style="font-family:monospace;font-size:18px;margin-top:8px">${p.patient_code}</div>
      <div style="margin-top:4px">${p.full_name}</div>
    </body></html>`);
  w.document.close();
}

const DEPTS = ['OPD', 'Medicine', 'Surgery', 'Gynae', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Dialysis'];

export default function PatientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [dept, setDept] = useState('OPD');

  function load() {
    api.get(`/patients/${id}`).then(setP).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, [id]);

  if (!p) return err ? <Alert type="error">{err}</Alert> : <Loading />;

  const activeVisit = p.visits?.find((v) => !['completed', 'billed'].includes(v.status)) || p.visits?.[0];

  async function issueToken() {
    try {
      const t = await api.post('/tokens', { visit_id: activeVisit.id, department: dept });
      setMsg(`Token #${t.token_number} issued for ${dept}.`);
      load();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div className="pd-topbar">
        <Link to="/patients" className="btn ghost sm"><Icon name="arrowleft" size={16} /> All patients</Link>
      </div>

      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="grid mb pd-cols">
        {/* Identity + demographics */}
        <div className="card">
          <div className="pd-head">
            <div className="pd-avatar">{initials(p.full_name)}</div>
            <div>
              <div className="pd-name"><h2>{p.full_name}</h2><CategoryBadge category={p.category} /></div>
              <div className="pd-code mono">{p.patient_code}</div>
            </div>
          </div>
          <div className="pd-facts">
            <Fact k="Gender" v={p.gender} />
            <Fact k="Age" v={p.age} />
            <Fact k="Contact" v={p.contact} />
            <Fact k="CNIC" v={p.cnic} mono />
            <Fact k="Guardian" v={p.guardian_name} />
            <Fact k="QR Token" v={p.qr_token} mono />
          </div>
        </div>

        {/* Actions */}
        <div className="card">
          <h3>Actions</h3>
          {can('token.manage') && activeVisit && (
            <div className="field">
              <label>Issue department token</label>
              <div className="flex">
                <Select value={dept} onChange={(e) => setDept(e.target.value)}>{DEPTS.map((d) => <option key={d}>{d}</option>)}</Select>
                <button className="btn primary sm" onClick={issueToken}>Issue</button>
              </div>
            </div>
          )}
          {can('consult.manage') && activeVisit && (
            <button className="btn accent mt pd-action" onClick={() => nav(`/consultation/${activeVisit.id}`)}>
              <Icon name="stethoscope" size={17} /> Start / Open Consultation
            </button>
          )}
          {can('billing.manage') && activeVisit && (
            <button className="btn mt pd-action" onClick={() => nav(`/billing?visit=${activeVisit.id}`)}>
              <Icon name="billing" size={17} /> Generate Bill
            </button>
          )}

          <div className="pd-qr" id="qr-card">
            <div className="pd-qr-frame"><QR value={p.patient_code} size={128} /></div>
            <div className="mono pd-qr-code">{p.patient_code}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>Pharmacy QR Card</div>
            <button className="btn ghost sm mt no-print pd-action" onClick={() => printQRCard(p)}>
              <Icon name="printer" size={16} /> Print QR Card
            </button>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <HistoryCard title="Consultations" icon="stethoscope" count={p.consultations?.length} empty="No consultations yet.">
          {p.consultations?.map((c) => (
            <div key={c.id} className="pd-row pd-row-block">
              <div className="flex between" style={{ width: '100%' }}><b>{c.diagnosis || 'Consultation'}</b><span className="muted">{c.created_at?.slice(0, 16)}</span></div>
              {c.complaint && <div className="muted sm">Complaint: {c.complaint}</div>}
              {c.vitals && <div className="muted sm">Vitals: {formatVitals(c.vitals)}</div>}
              {c.referral && <div className="muted sm">Referral: {c.referral}</div>}
            </div>
          ))}
        </HistoryCard>

        <HistoryCard title="Prescriptions" icon="pharmacy" count={p.prescriptions?.length} empty="No prescriptions yet.">
          {p.prescriptions?.map((r) => (
            <div key={r.id} className="pd-row">
              <div><b>{r.medicine_name}</b> <span className="muted">{[r.dosage, r.frequency, r.duration].filter(Boolean).join(' · ')}</span></div>
              {r.dispensed ? <span className="badge green">dispensed</span> : <span className="badge amber">pending</span>}
            </div>
          ))}
        </HistoryCard>

        <HistoryCard title="Lab Orders & Results" icon="lab" count={p.lab_orders?.length} empty="No lab orders.">
          {p.lab_orders?.map((l) => (
            <div key={l.id} className="pd-row">
              <div><b>{l.test_name}</b> {l.result_value && <span className="muted">→ {l.result_value}</span>}
                {l.report_path && <> · <a href={l.report_path} target="_blank" rel="noreferrer"><Icon name="file" size={13} /> report</a></>}</div>
              <StatusBadge status={l.status} />
            </div>
          ))}
        </HistoryCard>

        <HistoryCard title="Bills" icon="billing" count={p.bills?.length} empty="No bills.">
          {p.bills?.map((b) => (
            <div key={b.id} className="pd-row">
              <div className="mono">{b.bill_no} <span className="muted">{b.created_at?.slice(0, 10)}</span></div>
              <div className="flex"><span>{money(b.net_amount)}</span><StatusBadge status={b.status} /></div>
            </div>
          ))}
        </HistoryCard>
      </div>
    </div>
  );
}

function Fact({ k, v, mono }) {
  return (
    <div className="cell">
      <div className="k">{k}</div>
      <div className={`v ${mono ? 'mono' : ''}`}>{v || '—'}</div>
    </div>
  );
}

function HistoryCard({ title, icon, count, empty, children }) {
  const items = React.Children.toArray(children);
  const has = items.length > 0;
  return (
    <div className="card">
      <div className="pd-sec-head">
        <span className="ic"><Icon name={icon} size={18} /></span>
        <h3>{title}</h3>
        {has && <span className="count">{count ?? items.length}</span>}
      </div>
      {has ? <div>{children}</div> : <div className="pd-empty">{empty}</div>}
    </div>
  );
}

function formatVitals(v) {
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return Object.entries(o).map(([k, val]) => `${k}: ${val}`).join(', ');
  } catch { return ''; }
}
