import React, { useCallback, useEffect, useState } from 'react';
import Select from '../components/Select.jsx';
import { api } from '../api.js';
import { printPaper } from '../print.js';
import { money } from '../components/ui.jsx';

// The demand form.
//
// This screen is the unit's paper form, not an improvement on it: two columns,
// the same rows in the same order, the same wording — "Inj-Antibiotec" spelt the
// way the unit spells it. A nurse holding the paper must find the same row in
// the same place. Recognition is most of what makes a paper-to-screen move work,
// so nothing here is tidied.
//
// The two-step workflow comes from the two signature lines at the foot of the
// paper. Demanding moves NO stock; the pharmacy's issue is what deducts it.

const STATUS_TONE = {
  demanded: 'amber', issued: 'blue', short: 'red', billed: 'green', cancelled: 'gray',
};

export default function Demands({ can, onErr, onDone }) {
  const [view, setView] = useState('list');
  const [status, setStatus] = useState('demanded');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [sheet, setSheet] = useState(false);

  const load = useCallback(() => {
    api.get(`/dialysis/demands${status ? `?status=${status}` : ''}`)
      .then(setRows).catch((e) => onErr(e.message));
  }, [status]);
  useEffect(() => { load(); }, [status]);

  if (view === 'new') {
    return (
      <NewDemand
        onCancel={() => setView('list')}
        onErr={onErr}
        onDone={(d) => { setView('list'); load(); onDone(`${d.demand_no} raised.`); setOpen(d); }}
      />
    );
  }

  return (
    <div>
      <div className="card mb">
        <div className="filter-bar">
          <div className="field">
            <label>Show</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="demanded">Waiting to be issued</option>
              <option value="issued">Issued</option>
              <option value="short">Short-issued</option>
              <option value="billed">Billed</option>
              <option value="">Everything</option>
            </Select>
          </div>
          {rows.length > 0 && (
            <button className="btn ghost" onClick={() => setSheet(true)}>
              Print the sheets
            </button>
          )}
          {can('dialysis.manage') && (
            <button className="btn primary" onClick={() => setView('new')}>New demand</button>
          )}
        </div>
      </div>

      {sheet && <DemandSheets demands={rows} onClose={() => setSheet(false)} />}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Demand</th><th>Patient</th><th>Date</th><th>Shift</th>
              <th>Status</th><th className="right">Cost</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="mono sm"><b>{d.demand_no}</b></td>
                <td>
                  <b>{d.full_name}</b>
                  <div className="muted sm mono">{d.reg_no || d.patient_code}</div>
                </td>
                <td className="sm">{d.demand_date}</td>
                <td className="sm">{d.shift_name || '—'}</td>
                <td><span className={`badge ${STATUS_TONE[d.status] || 'gray'}`}>{d.status}</span></td>
                <td className="right">{d.total_cost ? money(d.total_cost) : <span className="muted">—</span>}</td>
                <td className="right">
                  <button className="btn ghost sm" onClick={() => setOpen(d)}>Open</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7}>
                <div className="empty">
                  <b>Nothing here.</b>
                  {status === 'demanded'
                    ? ' The unit has not raised any demands waiting to be issued.'
                    : ' Try another status.'}
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <DemandDetail id={open.id} can={can} onErr={onErr}
          onClose={() => setOpen(null)}
          onDone={(m) => { onDone(m); load(); }} />
      )}
    </div>
  );
}

// ===========================================================================
// New demand — the paper form, on screen
// ===========================================================================

function NewDemand({ onCancel, onErr, onDone }) {
  const [tpl, setTpl] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [patients, setPatients] = useState([]);
  const [head, setHead] = useState({
    customer_id: '', shift_id: '', demand_date: new Date().toISOString().slice(0, 10),
  });
  // Per template row: { qty, product_id }
  const [rows, setRows] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/dialysis/template').then((t) => {
      setTpl(t);
      if (t) {
        const init = {};
        for (const it of t.items) {
          const def = (it.products || []).find((p) => p.is_default) || (it.products || [])[0];
          init[it.id] = { qty: '', product_id: def ? String(def.id) : '' };
        }
        setRows(init);
      }
    }).catch((e) => onErr(e.message));
    api.get('/dialysis/shifts').then(setShifts).catch(() => {});
    api.get('/dialysis/patients').then(setPatients).catch(() => {});
  }, []);

  const setRow = (id, patch) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const cost = tpl ? tpl.items.reduce((t, it) => {
    const r = rows[it.id];
    const qty = Number(r?.qty || 0);
    if (!qty || !r?.product_id) return t;
    const p = (it.products || []).find((x) => String(x.id) === String(r.product_id));
    return t + qty * Number(p?.sale_price || 0);
  }, 0) : 0;

  async function save() {
    setBusy(true);
    try {
      const items = tpl.items
        .filter((it) => Number(rows[it.id]?.qty) > 0)
        .map((it) => ({
          template_item_id: it.id,
          product_id: rows[it.id].product_id ? Number(rows[it.id].product_id) : null,
          label: it.printed_label,
          qty_demanded: Number(rows[it.id].qty),
          is_emergency: !!it.is_emergency,
        }));
      const d = await api.post('/dialysis/demands', {
        ...head,
        customer_id: Number(head.customer_id),
        shift_id: head.shift_id ? Number(head.shift_id) : null,
        template_id: tpl.id,
        items,
      });
      onDone(d);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }

  if (!tpl) return <div className="card"><div className="loading">Loading the form…</div></div>;

  const col = (n) => tpl.items.filter((i) => i.column_no === n);
  const anyQty = tpl.items.some((it) => Number(rows[it.id]?.qty) > 0);

  return (
    <div className="card">
      <div className="sec-title" style={{ marginTop: 0 }}>{tpl.name}</div>

      <div className="form-row">
        <div className="field"><label>Patient *</label>
          <Select value={head.customer_id}
            onChange={(e) => setHead({ ...head, customer_id: e.target.value })}>
            <option value="">Choose…</option>
            {patients.map((p) => (
              <option key={p.id} value={p.customer_id}>{p.reg_no} — {p.full_name}</option>
            ))}
          </Select></div>
        <div className="field"><label>Shift</label>
          <Select value={head.shift_id} onChange={(e) => setHead({ ...head, shift_id: e.target.value })}>
            <option value="">—</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select></div>
        <div className="field"><label>Date</label>
          <input type="date" value={head.demand_date}
            onChange={(e) => setHead({ ...head, demand_date: e.target.value })} /></div>
      </div>

      {/* Two columns, exactly as the paper is laid out. */}
      <div className="dem-grid">
        {[1, 2].map((n) => (
          <div key={n} className="dem-col">
            <div className="dem-head">
              <span>Detail of Injections</span><span>Qty</span>
            </div>
            {col(n).map((it) => (
              <DemandRow key={it.id} item={it} value={rows[it.id] || {}}
                onChange={(patch) => setRow(it.id, patch)} onErr={onErr} />
            ))}
          </div>
        ))}
      </div>

      <div className="fx between mt">
        <div className="muted sm">
          Writing this demand moves no stock. The pharmacy deducts it when they issue.
        </div>
        <div><b>Estimated cost {money(cost)}</b></div>
      </div>

      <div className="fx mt">
        <button className="btn primary" disabled={busy || !head.customer_id || !anyQty}
          onClick={save}>Raise demand</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DemandRow({ item, value, onChange, onErr }) {
  const [hits, setHits] = useState([]);
  const [term, setTerm] = useState('');
  const products = item.products || [];
  const multi = products.length > 1;

  // "other" and "Emergency" are blank lines on the paper — anything in the
  // catalogue can go on them, so they search the lot rather than a fixed set.
  useEffect(() => {
    if (!item.is_freetext || term.trim().length < 2) { setHits([]); return; }
    const id = setTimeout(() => {
      api.get(`/inventory/products?q=${encodeURIComponent(term.trim())}`)
        .then((r) => setHits((r || []).slice(0, 6))).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(id);
  }, [term, item.is_freetext]);

  const chosen = products.find((p) => String(p.id) === String(value.product_id));

  return (
    <div className={`dem-row${item.is_emergency ? ' dem-emerg' : ''}`}>
      <div className="dem-label">
        {item.printed_label}
        {item.is_emergency && <span className="badge red sm">emergency</span>}
        {!item.is_freetext && !products.length && (
          <span className="badge amber sm" title="No SKU mapped — Admin > Dialysis Form">
            no SKU
          </span>
        )}
      </div>

      <div className="dem-pick">
        {/* A row that covers several SKUs shows the picker with the unit's usual
            one already selected, so the common case is still one keystroke. */}
        {multi && (
          <Select value={value.product_id || ''} onChange={(e) => onChange({ product_id: e.target.value })}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.on_hand != null ? ` — ${p.on_hand} left` : ''}
              </option>
            ))}
          </Select>
        )}
        {item.is_freetext && (
          <div className="dem-search">
            <input value={chosen ? chosen.name : term}
              placeholder="search the catalogue…"
              onChange={(e) => { setTerm(e.target.value); onChange({ product_id: '' }); }} />
            {hits.length > 0 && !chosen && (
              <div className="pos-cust-hits">
                {hits.map((h) => (
                  <button key={h.id} type="button" className="pos-cust-hit"
                    onClick={() => { onChange({ product_id: String(h.id) }); setHits([]); setTerm(h.name); }}>
                    <b>{h.name}</b>
                    <span className="muted sm">{h.on_hand} left · {money(h.sale_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!multi && !item.is_freetext && chosen && (
          <span className="muted sm">{chosen.name} · {chosen.on_hand} left</span>
        )}
      </div>

      <input className="dem-qty" type="number" min="0" value={value.qty ?? ''}
        onChange={(e) => onChange({ qty: e.target.value })} />
    </div>
  );
}

// ===========================================================================
// One demand — issue, bill, print
// ===========================================================================

function DemandDetail({ id, can, onClose, onErr, onDone }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hand, setHand] = useState({ taken_by: '', relation: 'Self', cnic: '', contact: '' });
  const [billed, setBilled] = useState(null);
  const [slip, setSlip] = useState(false);

  const load = useCallback(() => {
    api.get(`/dialysis/demands/${id}`).then(setD).catch((e) => onErr(e.message));
  }, [id]);
  useEffect(() => { load(); }, [id]);

  async function issue() {
    setBusy(true);
    try {
      const r = await api.post(`/dialysis/demands/${id}/issue`, hand);
      setD(r);
      // The slip is the thing the collector signs. Offering it the moment the
      // medicine changes hands is the only time it can actually be signed.
      setSlip(true);
      onDone(`${r.demand_no} issued${r.status === 'short' ? ' (short)' : ''}.`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }

  async function bill() {
    setBusy(true);
    try {
      const r = await api.post(`/dialysis/demands/${id}/bill`, {});
      setBilled(r);
      setD(r.demand);
      onDone(`${r.bill_no} raised.`);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }

  if (!d) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div id="demand-print">
          <div className="fx between">
            <div>
              <h3 style={{ margin: 0 }}>{d.full_name}</h3>
              <div className="muted sm mono">
                {d.reg_no || d.patient_code} · {d.demand_no} · {d.demand_date}
                {d.shift_name ? ` · ${d.shift_name} shift` : ''}
              </div>
            </div>
            <span className={`badge ${STATUS_TONE[d.status] || 'gray'}`}>{d.status}</span>
          </div>

          <div className="table-wrap mt">
            <table>
              <thead>
                <tr><th>Detail of Injections</th><th className="right">Qty</th>
                  <th className="right">Issued</th><th className="right">Rate</th>
                  <th className="right">Total Cost</th></tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.label || i.printed_label}
                      {i.is_emergency === 1 && <> <span className="badge red sm">emergency</span></>}
                      {i.product_name && <div className="muted sm">{i.product_name}</div>}
                      {i.batches?.length > 0 && (
                        <div className="muted sm mono">
                          batch {i.batches.map((b) => b.batch_no || b.batch_id).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="right">{i.qty_demanded}</td>
                    <td className="right">
                      {i.qty_issued < i.qty_demanded
                        ? <b style={{ color: 'var(--danger)' }}>{i.qty_issued}</b>
                        : i.qty_issued}
                    </td>
                    <td className="right sm">{i.unit_cost ? money(i.unit_cost) : '—'}</td>
                    <td className="right">{i.line_total ? money(i.line_total) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}><b>Total Cost</b></td>
                  <td className="right"><b>{money(d.total_cost)}</b></td></tr>
              </tfoot>
            </table>
          </div>

          {d.shortfalls?.length > 0 && (
            <div className="alert err mt">
              <b>Short issue.</b> The unit did not get everything it asked for:
              <ul style={{ margin: '6px 0 0 18px' }}>
                {d.shortfalls.map((s, i) => (
                  <li key={i} className="sm">{s.label} — asked {s.demanded}, got {s.issued}</li>
                ))}
              </ul>
            </div>
          )}

          {d.handover && (
            <dl className="wc-meta">
              <div><dt>Collected by</dt><dd>{d.handover.taken_by}</dd></div>
              <div><dt>Relation</dt><dd>{d.handover.relation || '—'}</dd></div>
              <div><dt>CNIC</dt><dd className="mono">{d.handover.cnic || '—'}</dd></div>
              <div><dt>Issued by</dt><dd>{d.issued_by_name || '—'}</dd></div>
            </dl>
          )}

          <div className="fx between" style={{ marginTop: 22 }}>
            <div className="sm">Demanded by ____________________</div>
            <div className="sm">Issued by ____________________</div>
          </div>
        </div>

        {billed && (
          <div className="alert ok mt no-print">
            <b>{billed.bill_no}</b> — the programme was charged {money(billed.programme_charged)};
            the patient pays {money(billed.net)}.
            {billed.emergency_total > 0 && <> Emergency items {money(billed.emergency_total)}, on this same invoice.</>}
            {billed.patient_charge && (
              <div className="sm" style={{ marginTop: 4 }}>
                {money(billed.patient_charge.amount)} was <b>not covered</b> by the programme and has
                gone to this patient&apos;s own credit account.
              </div>
            )}
          </div>
        )}

        {/* Issuing is the pharmacy's signature on the paper, and the client asked
            for the collector by name. It is required, not optional. */}
        {d.status === 'demanded' && can('pharmacy.dispense') && (
          <div className="no-print">
            <div className="sec-title">Who is collecting this?</div>
            <div className="form-row">
              <div className="field"><label>Name *</label>
                <input value={hand.taken_by} autoFocus
                  onChange={(e) => setHand({ ...hand, taken_by: e.target.value })} /></div>
              <div className="field"><label>Relation</label>
                <Select value={hand.relation} onChange={(e) => setHand({ ...hand, relation: e.target.value })}>
                  {['Self', 'Son', 'Daughter', 'Spouse', 'Brother', 'Sister', 'Attendant', 'Ambulance staff', 'Other']
                    .map((r) => <option key={r}>{r}</option>)}
                </Select></div>
              <div className="field"><label>CNIC</label>
                <input value={hand.cnic} onChange={(e) => setHand({ ...hand, cnic: e.target.value })} /></div>
              <div className="field"><label>Mobile</label>
                <input value={hand.contact} onChange={(e) => setHand({ ...hand, contact: e.target.value })} /></div>
            </div>
          </div>
        )}

        {slip && <HandoverSlip demand={d} onClose={() => setSlip(false)} />}

        <div className="wc-foot no-print">
          {d.handover && (
            <button className="btn" onClick={() => setSlip(true)}>Handover slip</button>
          )}
          {d.status === 'demanded' && can('pharmacy.dispense') && (
            <button className="btn primary" disabled={busy || !hand.taken_by.trim()} onClick={issue}>
              Issue &amp; deduct stock
            </button>
          )}
          {['issued', 'short'].includes(d.status) && can('billing.manage') && (
            <button className="btn primary" disabled={busy} onClick={bill}>Bill this session</button>
          )}
          <button className="btn" onClick={() => printPaper('a4', { modal: true })}>Print form</button>
          <span className="wc-spacer" />
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// The paper the collector signs.
//
// A relative collecting a patient's medicine carries the same audit weight as a
// controlled-drug sale, which is what the client asked for. That only holds if
// there is something with their name on it that they actually signed — a
// database row nobody signed proves nothing about who stood at the counter.
//
// Thumb impression as well as signature: literacy is not universal here, and a
// slip that only offers a signature line quietly excludes the people most likely
// to be collecting on someone else's behalf.
function HandoverSlip({ demand, onClose }) {
  const h = demand.handover || {};
  const issued = demand.items.filter((i) => i.qty_issued > 0);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hs">
          <div className="hs-head">
            <b>MEDICINE HANDOVER</b>
            <span className="mono">{demand.demand_no}</span>
          </div>

          <dl className="hs-meta">
            <div><dt>Patient</dt><dd>{demand.full_name}</dd></div>
            <div><dt>Reg. no</dt><dd className="mono">{demand.reg_no || demand.patient_code}</dd></div>
            <div><dt>Date</dt><dd>{demand.demand_date}</dd></div>
            <div><dt>Shift</dt><dd>{demand.shift_name || '\u2014'}</dd></div>
            <div><dt>Collected by</dt><dd><b>{h.taken_by || '\u2014'}</b></dd></div>
            <div><dt>Relation</dt><dd>{h.relation || '\u2014'}</dd></div>
            <div><dt>CNIC</dt><dd className="mono">{h.cnic || '\u2014'}</dd></div>
            <div><dt>Mobile</dt><dd className="mono">{h.contact || '\u2014'}</dd></div>
          </dl>

          <table className="hs-items">
            <thead><tr><th>Item</th><th className="right">Qty</th></tr></thead>
            <tbody>
              {issued.map((i) => (
                <tr key={i.id}>
                  <td>{i.product_name || i.label}</td>
                  <td className="right">{i.qty_issued}</td>
                </tr>
              ))}
              {issued.length === 0 && <tr><td colSpan={2} className="muted">Nothing issued.</td></tr>}
            </tbody>
          </table>

          <div className="hs-declare">
            I confirm I have received the medicine listed above on behalf of the patient named.
          </div>

          <div className="hs-signs">
            <div><div className="hs-line" />Signature of collector</div>
            <div><div className="hs-line hs-thumb" />Thumb impression</div>
            <div><div className="hs-line" />Issued by ({demand.issued_by_name || '\u2014'})</div>
          </div>
        </div>

        <div className="wc-foot no-print">
          <button className="btn primary" onClick={() => printPaper('thermal', { modal: true })}>
            Print slip (80mm)
          </button>
          <button className="btn ghost" onClick={() => printPaper('a4', { modal: true })}>Print A4</button>
          <span className="wc-spacer" />
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// The printed sheet — THREE PATIENT BLOCKS TO A PAGE
// ===========================================================================
//
// The unit's pad has three blocks per sheet and they file them that way. Keeping
// that on the printed output means their filing does not have to change, which
// is most of what makes a paper-to-screen move succeed. Printing one demand per
// A4 sheet would have tripled their paper and broken a filing system that works.
//
// The extra fields the screen knows and the paper never had — registration
// number, batch, collector — stay in the block header and footer, off the main
// grid, so the sheet still looks like the one they recognise.

const PER_SHEET = 3;

function DemandSheets({ demands, onClose }) {
  const [full, setFull] = useState(null);

  // The list rows carry no items; the sheet needs them.
  useEffect(() => {
    Promise.all(demands.slice(0, 60).map((d) => api.get(`/dialysis/demands/${d.id}`).catch(() => null)))
      .then((all) => setFull(all.filter(Boolean)));
  }, [demands]);

  const pages = [];
  for (let i = 0; i < (full || []).length; i += PER_SHEET) {
    pages.push(full.slice(i, i + PER_SHEET));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        {!full && <div className="loading">Gathering the demands…</div>}

        {full && (
          <>
            <div className="fx between no-print">
              <div>
                <h3 style={{ margin: 0 }}>Demand sheets</h3>
                <div className="muted sm">
                  {full.length} patient{full.length === 1 ? '' : 's'} · {pages.length} sheet
                  {pages.length === 1 ? '' : 's'} · three blocks to a page, as the pad is
                </div>
              </div>
            </div>

            <div className="dsheet">
              {pages.map((page, pi) => (
                <div className="dsheet-page" key={pi}>
                  <div className="fx between" style={{ marginBottom: 8, fontSize: 12 }}>
                    <b>DIALYSIS UNIT — Demand Form for Patient</b>
                    <span>Shift: {page[0]?.shift_name || '________'} &nbsp; Date: {page[0]?.demand_date}</span>
                  </div>

                  {page.map((d) => <SheetBlock key={d.id} d={d} />)}

                  <div className="dsheet-foot">
                    <span>Demanded by: ____________________</span>
                    <span>Issued by: ____________________</span>
                  </div>
                </div>
              ))}
            </div>

            {/* On screen the sheet is hidden by .dsheet { display: none } — it
                exists for the printer. Show a plain summary so the person
                clicking Print knows what is about to come out. */}
            <div className="table-wrap no-print mt">
              <table>
                <thead><tr><th>Sheet</th><th>Patients on it</th></tr></thead>
                <tbody>
                  {pages.map((page, i) => (
                    <tr key={i}>
                      <td className="mono sm">{i + 1}</td>
                      <td className="sm">{page.map((d) => d.full_name).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="wc-foot no-print">
          <button className="btn primary" disabled={!full}
            onClick={() => printPaper('a4', { modal: true })}>Print {pages.length} sheet
            {pages.length === 1 ? '' : 's'}</button>
          <span className="wc-spacer" />
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SheetBlock({ d }) {
  const col = (n) => d.items.filter((_, i) => i % 2 === (n - 1));
  const row = (i) => (
    <div className="r" key={i.id}>
      <span>
        {i.label || i.printed_label}
        {i.is_emergency === 1 ? ' *' : ''}
      </span>
      <b>{i.qty_issued || i.qty_demanded || ''}</b>
    </div>
  );
  return (
    <div className="dsheet-block">
      <h4>
        <span>Pat. Name: {d.full_name}</span>
        <span className="mono">{d.reg_no || d.patient_code} · {d.demand_no}</span>
      </h4>
      <div className="dsheet-grid">
        <div>{col(1).map(row)}</div>
        <div>{col(2).map(row)}</div>
      </div>
      <div className="dsheet-foot">
        <span>
          {d.handover ? `Collected by: ${d.handover.taken_by}` : 'Collected by: ______________'}
          {d.handover?.relation ? ` (${d.handover.relation})` : ''}
        </span>
        <span><b>Total Cost: {money(d.total_cost)}</b></span>
      </div>
    </div>
  );
}
