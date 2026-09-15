import React, { useCallback, useEffect, useState } from 'react';
import Select from '../components/Select.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { printPaper } from '../print.js';
import { Alert, money } from '../components/ui.jsx';
import Demands from './DialysisDemands.jsx';

// Dialysis Unit — the one full clinical module in this product.
//
// It registers its own patients (Reception is on hold), keeps their history,
// orders medicine on its own demand form and keeps its money separate from what
// the patient personally owes the shop.
//
// The demand screen is deliberately a copy of the unit's paper form: two
// columns, the same nineteen rows, the same wording. A nurse holding the paper
// has to find the same row in the same place — recognition is what gets a
// paper-to-screen move adopted, so nothing here is "improved".

const TABS = [
  ['patients', 'Patients'],
  ['schedule', 'Schedule'],
  ['demands', 'Demands'],
];

export default function Dialysis() {
  const { can } = useAuth();
  const [tab, setTab] = useState('patients');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="fx mb no-print">
        {TABS.map(([k, l]) => (
          <button key={k} className={`btn sm ${tab === k ? 'primary' : 'ghost'}`}
            onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'patients' && <Patients can={can} onErr={setErr} onDone={setMsg} />}
      {tab === 'schedule' && <Schedule can={can} onErr={setErr} onDone={setMsg} />}
      {tab === 'demands' && <Demands can={can} onErr={setErr} onDone={setMsg} />}
    </div>
  );
}

// ===========================================================================
// Patients
// ===========================================================================

function Patients({ can, onErr, onDone }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    api.get(`/dialysis/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then(setRows).catch((e) => onErr(e.message));
  }, [q]);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [q]);

  return (
    <div>
      <div className="card mb">
        <div className="filter-bar">
          <div className="field">
            <label>Find a patient</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
              placeholder="Name, mobile or DLY number" />
          </div>
          {can('dialysis.manage') && !adding && (
            <button className="btn primary" onClick={() => setAdding(true)}>Register a patient</button>
          )}
        </div>
      </div>

      {adding && (
        <RegisterPatient
          onCancel={() => setAdding(false)}
          onErr={onErr}
          onDone={(p) => { setAdding(false); load(); onDone(`${p.full_name} enrolled as ${p.reg_no}.`); }}
        />
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Reg. no</th><th>Patient</th><th>Mobile</th><th>Serology</th>
              <th>Access</th><th className="right">Per week</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono"><b>{r.reg_no}</b></td>
                <td>
                  <b>{r.full_name}</b>
                  <div className="muted sm mono">{r.patient_code}</div>
                </td>
                <td className="mono">{r.contact || <span className="muted">—</span>}</td>
                <td><Serology p={r} /></td>
                <td className="sm">{r.access_type || <span className="muted">—</span>}</td>
                <td className="right">{r.sessions_per_week || <span className="muted">—</span>}</td>
                <td className="right">
                  <button className="btn ghost sm" onClick={() => setOpen(r)}>History</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7}>
                <div className="empty">
                  <b>{q ? 'Nobody matches that.' : 'No patients enrolled yet.'}</b>
                  Register a patient and the unit can schedule and demand for them straight away.
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && <History patient={open} onClose={() => setOpen(null)} onErr={onErr} />}
    </div>
  );
}

// Serology decides the machine, so the OPERATIONAL fact travels with the name
// everywhere the name appears. The results themselves are health data on a
// shared counter screen (QA S2-11): the server sends only the isolation flag,
// and someone holding dialysis.serology can reveal the results — each reveal
// is audited. Nothing revealed is printed.
function Serology({ p, big }) {
  const { can } = useAuth();
  const [shown, setShown] = useState(null);
  const iso = p.isolation || 'unknown';
  const style = big ? { fontSize: 13 } : undefined;
  const flag = iso === 'dedicated'
    ? <span className="badge red" style={style}>Isolation — dedicated machine</span>
    : iso === 'standard'
      ? <span className="badge green" style={style}>standard machine</span>
      : <span className="muted sm">serology not recorded</span>;
  if (!can('dialysis.serology')) return flag;
  async function reveal(e) {
    e.stopPropagation();
    try { setShown(await api.post(`/dialysis/patients/${p.id}/serology-reveal`, {})); } catch { /* the flag stands */ }
  }
  return (
    <span className="fx" style={{ gap: 6, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
      {flag}
      {shown
        ? <span className="mono sm no-print">{[['hbsag', 'HBsAg'], ['hcv', 'HCV'], ['hiv', 'HIV']].map(([k, l]) => `${l} ${shown[k] || '—'}`).join(' · ')}{shown.serology_date ? ` (${shown.serology_date})` : ''}</span>
        : <button type="button" className="btn ghost sm no-print" onClick={reveal} title="Show the results — this is recorded in the audit log">reveal</button>}
    </span>
  );
}

const SEROLOGY = ['', 'negative', 'positive', 'pending'];

function RegisterPatient({ onCancel, onErr, onDone }) {
  const [f, setF] = useState({
    full_name: '', contact: '', cnic: '', gender: '', age: '',
    blood_group: '', access_type: '', diagnosis: '',
    hbsag: '', hcv: '', hiv: '', serology_date: '',
    dry_weight: '', sessions_per_week: 3,
    referring_dr: '', next_of_kin: '', next_of_kin_contact: '',
  });
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Someone already known to the shop must not become a second record. This is
  // the same person the counter sells to.
  useEffect(() => {
    if (!f.contact || f.contact.length < 7) { setDupes([]); return; }
    api.get(`/patients?q=${encodeURIComponent(f.contact)}`)
      .then((rows) => setDupes(rows.slice(0, 3))).catch(() => setDupes([]));
  }, [f.contact]);

  async function save(customerId) {
    setBusy(true);
    try {
      const p = await api.post('/dialysis/patients', {
        ...f,
        customer_id: customerId || undefined,
        age: f.age === '' ? null : Number(f.age),
        dry_weight: f.dry_weight === '' ? null : Number(f.dry_weight),
        sessions_per_week: f.sessions_per_week === '' ? null : Number(f.sessions_per_week),
      });
      onDone(p);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card mb">
      <div className="sec-title" style={{ marginTop: 0 }}>Register a dialysis patient</div>
      <div className="muted sm mb">
        This creates the customer record and the clinical profile together — the unit does not
        wait for a reception desk.
      </div>

      <div className="form-row">
        <div className="field"><label>Full name *</label>
          <input value={f.full_name} onChange={set('full_name')} autoFocus /></div>
        <div className="field"><label>Mobile</label>
          <input value={f.contact} onChange={set('contact')} placeholder="03xxxxxxxxx" /></div>
        <div className="field"><label>CNIC</label>
          <input value={f.cnic} onChange={set('cnic')} /></div>
        <div className="field"><label>Gender</label>
          <Select value={f.gender} onChange={set('gender')}>
            <option value="">—</option><option>Male</option><option>Female</option>
          </Select></div>
        <div className="field"><label>Age</label>
          <input type="number" min="0" value={f.age} onChange={set('age')} /></div>
        <div className="field"><label>Blood group</label>
          <input value={f.blood_group} onChange={set('blood_group')} placeholder="B+" /></div>
      </div>

      {dupes.length > 0 && (
        <div className="alert info">
          <b>Already on file.</b> Enrol the existing record rather than creating a second one —
          the counter and the unit must see one person.
          <div className="fx" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {dupes.map((d) => (
              <button key={d.id} className="btn ghost sm" disabled={busy}
                onClick={() => save(d.id)}>
                Enrol {d.full_name} ({d.patient_code})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sec-title">Clinical</div>
      <div className="form-row">
        <div className="field"><label>Access type</label>
          <Select value={f.access_type} onChange={set('access_type')}>
            <option value="">—</option>
            <option>AV fistula</option><option>Catheter</option><option>Graft</option>
          </Select></div>
        <div className="field"><label>Diagnosis</label>
          <input value={f.diagnosis} onChange={set('diagnosis')} placeholder="ESRD" /></div>
        <div className="field"><label>Dry weight (kg)</label>
          <input type="number" step="0.1" value={f.dry_weight} onChange={set('dry_weight')} /></div>
        <div className="field"><label>Sessions per week</label>
          <input type="number" min="1" max="7" value={f.sessions_per_week}
            onChange={set('sessions_per_week')} /></div>
      </div>

      <div className="sec-title">Serology <span className="muted">— decides which machine they can use</span></div>
      <div className="form-row">
        {[['hbsag', 'HBsAg'], ['hcv', 'HCV'], ['hiv', 'HIV']].map(([k, l]) => (
          <div className="field" key={k}><label>{l}</label>
            <Select value={f[k]} onChange={set(k)}>
              {SEROLOGY.map((s) => <option key={s} value={s}>{s || '—'}</option>)}
            </Select></div>
        ))}
        <div className="field"><label>Tested on</label>
          <input type="date" value={f.serology_date} onChange={set('serology_date')} /></div>
      </div>

      <div className="sec-title">Contact</div>
      <div className="form-row">
        <div className="field"><label>Referring doctor</label>
          <input value={f.referring_dr} onChange={set('referring_dr')} /></div>
        <div className="field"><label>Next of kin</label>
          <input value={f.next_of_kin} onChange={set('next_of_kin')} /></div>
        <div className="field"><label>Next of kin mobile</label>
          <input value={f.next_of_kin_contact} onChange={set('next_of_kin_contact')} /></div>
      </div>

      <div className="fx">
        <button className="btn primary" disabled={busy || !f.full_name.trim()}
          onClick={() => save(null)}>Register</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ===========================================================================
// History — what the unit reads before the next session, and prints for referral
// ===========================================================================

function History({ patient, onClose, onErr }) {
  const [h, setH] = useState(null);
  useEffect(() => {
    api.get(`/dialysis/patients/${patient.id}/history`)
      .then(setH).catch((e) => onErr(e.message));
  }, [patient.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="fx between">
          <div>
            <h3 style={{ margin: 0 }}>{patient.full_name}</h3>
            <div className="muted sm mono">
              {patient.reg_no} · {patient.patient_code} · {patient.contact || 'no mobile'}
            </div>
          </div>
          <Serology p={patient} big />
        </div>

        <dl className="wc-meta">
          <div><dt>Blood group</dt><dd>{patient.blood_group || '—'}</dd></div>
          <div><dt>Access</dt><dd>{patient.access_type || '—'}</dd></div>
          <div><dt>Dry weight</dt><dd>{patient.dry_weight ? `${patient.dry_weight} kg` : '—'}</dd></div>
          <div><dt>Enrolled</dt><dd>{patient.enrolled_on}</dd></div>
        </dl>

        {/* Two figures that must never be added together. One is what the trust
            has spent treating this person; the other is what they owe the shop. */}
        {h && (
          <div className="form-row" style={{ marginTop: 4 }}>
            <div className="alert info" style={{ margin: 0 }}>
              <b>Programme has spent {money(h.totals.programme_spend)}</b>
              <div className="sm">on {h.totals.sessions} completed session{h.totals.sessions === 1 ? '' : 's'}</div>
            </div>
            <div className={`alert ${h.totals.personally_owes > 0 ? 'err' : 'info'}`} style={{ margin: 0 }}>
              <b>Owes the shop {money(h.totals.personally_owes)}</b>
              <div className="sm">their own purchases — never netted against the above</div>
            </div>
          </div>
        )}

        {!h && <div className="loading">Loading…</div>}

        {h && (
          <>
            <div className="sec-title">Demands</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Demand</th><th>Date</th><th>Shift</th><th>Items</th>
                    <th>Status</th><th className="right">Cost</th></tr>
                </thead>
                <tbody>
                  {h.demands.map((d) => (
                    <tr key={d.id}>
                      <td className="mono sm">{d.demand_no}</td>
                      <td className="sm">{d.demand_date}</td>
                      <td className="sm">{d.shift_name || '—'}</td>
                      <td className="sm">
                        {d.items.map((i) => `${i.product_name || i.label} ×${i.qty_issued}`).join(', ') || '—'}
                      </td>
                      <td><StatusBadge s={d.status} /></td>
                      <td className="right">{money(d.total_cost)}</td>
                    </tr>
                  ))}
                  {h.demands.length === 0 && (
                    <tr><td colSpan={6} className="muted">No demands yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="sec-title">Sessions</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>When</th><th>Shift</th><th>Station</th><th>Staff</th>
                    <th>Pre / post</th><th className="right">Weight</th>
                    <th>Status</th><th className="right">Billed</th></tr>
                </thead>
                <tbody>
                  {h.sessions.slice(0, 30).map((s) => (
                    <tr key={s.id}>
                      <td className="sm">{String(s.scheduled_at).replace('T', ' ')}</td>
                      <td className="sm">{s.shift_name || '—'}</td>
                      <td className="sm">{s.station_name || '—'}</td>
                      <td className="sm">{s.staff_name || '—'}</td>
                      {/* The reason a dialysis history exists: what the patient
                          weighed and what their blood pressure did, session to
                          session. A cost column alone is an accounting record,
                          not a clinical one. */}
                      <td className="sm"><Vitals pre={s.pre_vitals} post={s.post_vitals} /></td>
                      <td className="right sm">{weightOf(s) || <span className="muted">—</span>}</td>
                      <td><StatusBadge s={s.status} /></td>
                      <td className="right sm">{s.bill_no ? money(s.gross_amount) : '—'}</td>
                    </tr>
                  ))}
                  {h.sessions.length === 0 && (
                    <tr><td colSpan={8} className="muted">Nothing scheduled yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="wc-foot no-print">
          <button className="btn" onClick={() => printPaper('a4', { modal: true })}>Print summary</button>
          <span className="wc-spacer" />
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Vitals are stored as a JSON snapshot per session. Parsed defensively: an old
// row may hold a string, a malformed blob, or nothing at all, and a history
// screen that throws on one bad session shows none of the good ones.
function parseVitals(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function Vitals({ pre, post }) {
  const a = parseVitals(pre);
  const b = parseVitals(post);
  if (!a && !b) return <span className="muted">—</span>;
  const bp = (v) => (v && (v.bp || (v.systolic && `${v.systolic}/${v.diastolic}`))) || null;
  const parts = [bp(a), bp(b)].filter(Boolean);
  if (!parts.length) return <span className="muted">recorded</span>;
  return <span className="mono">{parts.join(' → ')}</span>;
}

// Post-dialysis weight where it was recorded, otherwise pre. The number the
// unit actually looks back at.
function weightOf(s) {
  const a = parseVitals(s.pre_vitals);
  const b = parseVitals(s.post_vitals);
  const w = (b && (b.weight != null ? b.weight : b.dry_weight))
    != null ? (b.weight != null ? b.weight : b.dry_weight)
    : (a && (a.weight != null ? a.weight : a.dry_weight));
  return w != null ? `${w} kg` : null;
}

const STATUS_TONE = {
  demanded: 'amber', issued: 'blue', short: 'red', billed: 'green',
  cancelled: 'gray', scheduled: 'gray', completed: 'green', 'in-progress': 'blue',
};

function StatusBadge({ s }) {
  return <span className={`badge ${STATUS_TONE[s] || 'gray'}`}>{s}</span>;
}

// ===========================================================================
// Schedule
// ===========================================================================

const WEEKDAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];

function Schedule({ can, onErr, onDone }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState([]);
  const [stations, setStations] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [patients, setPatients] = useState([]);
  const [plan, setPlan] = useState({ patient_id: '', station_id: '', shift_id: '', weekdays: ['1', '3', '5'], weeks: 4, time: '08:00' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/dialysis/sessions?date=${date}`).then(setRows).catch((e) => onErr(e.message));
  }, [date]);
  useEffect(() => { load(); }, [date]);
  useEffect(() => {
    api.get('/dialysis/stations').then(setStations).catch(() => {});
    api.get('/dialysis/shifts').then(setShifts).catch(() => {});
    api.get('/dialysis/patients').then(setPatients).catch(() => {});
  }, []);

  const chosen = patients.find((p) => String(p.customer_id) === String(plan.patient_id));

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post('/dialysis/schedule/recurring', {
        ...plan,
        patient_id: Number(plan.patient_id),
        station_id: plan.station_id ? Number(plan.station_id) : null,
        shift_id: plan.shift_id ? Number(plan.shift_id) : null,
        weekdays: plan.weekdays.map(Number),
        weeks: Number(plan.weeks),
        from: date,
      });
      setResult(r);
      load();
      onDone(`${r.created.length} session${r.created.length === 1 ? '' : 's'} scheduled.`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {can('dialysis.manage') && (
        <div className="card mb">
          <div className="sec-title" style={{ marginTop: 0 }}>
            Weekly pattern <span className="muted">— most patients come the same days every week</span>
          </div>
          <div className="form-row">
            <div className="field"><label>Patient</label>
              <Select value={plan.patient_id} onChange={(e) => setPlan({ ...plan, patient_id: e.target.value })}>
                <option value="">Choose…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.customer_id}>{p.reg_no} — {p.full_name}</option>
                ))}
              </Select></div>
            <div className="field"><label>Station</label>
              <Select value={plan.station_id} onChange={(e) => setPlan({ ...plan, station_id: e.target.value })}>
                <option value="">Any</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              {/* Serology belongs HERE, where the machine is picked — not buried
                  in a profile tab nobody opens at the moment it matters. */}
              {chosen && <div className="sm" style={{ marginTop: 6 }}><Serology p={chosen} /></div>}
            </div>
            <div className="field"><label>Shift</label>
              <Select value={plan.shift_id} onChange={(e) => setPlan({ ...plan, shift_id: e.target.value })}>
                <option value="">—</option>
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select></div>
            <div className="field"><label>Time</label>
              <input type="time" value={plan.time} onChange={(e) => setPlan({ ...plan, time: e.target.value })} /></div>
            <div className="field"><label>For how many weeks</label>
              <input type="number" min="1" max="26" value={plan.weeks}
                onChange={(e) => setPlan({ ...plan, weeks: e.target.value })} /></div>
            <div className="field">
              <label>Days</label>
              <div className="fx" style={{ gap: 6, flexWrap: 'wrap' }}>
                {WEEKDAYS.map(([v, l]) => (
                  <label key={v} className="check sm">
                    <input type="checkbox" checked={plan.weekdays.includes(v)}
                      onChange={(e) => setPlan({
                        ...plan,
                        weekdays: e.target.checked
                          ? [...plan.weekdays, v]
                          : plan.weekdays.filter((d) => d !== v),
                      })} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button className="btn primary" disabled={busy || !plan.patient_id || !plan.weekdays.length}
            onClick={generate}>Generate schedule</button>

          {/* Conflicts are shown, never silently skipped: a nurse who asked for
              Mon/Wed/Fri and got Mon/Fri would not notice. */}
          {result && (
            <div className={`alert ${result.skipped.length ? 'err' : 'ok'} mt`}>
              <b>{result.created.length} of {result.requested} scheduled.</b>
              {result.skipped.length > 0 && (
                <ul style={{ margin: '6px 0 0 18px' }}>
                  {result.skipped.slice(0, 8).map((s, i) => (
                    <li key={i} className="sm">{String(s.at).replace('T', ' ')} — {s.why}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card mb">
        <div className="filter-bar">
          <div className="field"><label>Day</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Patient</th><th>Shift</th><th>Station</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="mono sm">{String(s.scheduled_at).slice(11, 16)}</td>
                <td><b>{s.full_name}</b><div className="muted sm mono">{s.patient_code}</div></td>
                <td className="sm">{s.shift_name || '—'}</td>
                <td className="sm">{s.station_name || '—'}</td>
                <td><StatusBadge s={s.status} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5}>
                <div className="empty"><b>Nothing scheduled for this day.</b>
                  Generate a weekly pattern above.</div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { Serology, StatusBadge };
