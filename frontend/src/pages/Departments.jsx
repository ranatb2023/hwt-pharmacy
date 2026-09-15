import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Select from '../components/Select.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { Alert, money } from '../components/ui.jsx';
import { Kbd, BTN, BTN_DARK, CTL } from '../components/ws/index.jsx';
import { printPaper } from '../print.js';

// Departments: prescription in, invoice out.
//
// The laboratory, emergency and the wards are outside this product — their
// modules are on hold. A runner brings a paper slip to the counter, it is typed
// here, stock goes out FEFO, and an invoice goes back. Those invoices are the
// hospital's expense.
//
// PHASE 09 — screen 05 (hwt-client/design/stitch/05-dept-requisition-queue).
// The queue on the left, the slip being inspected on the right, in place of the
// modal it used to open in. ▲/▼ walk the queue, Enter inspects, F9 dispenses.
// The mockup's "ready for handover" and "dispatch" states do not exist in
// `department_requests` and are not shown; the urgency column is the slips'
// own emergency flag, which does.

const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const hhmm = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const ago = (s) => {
  if (!s) return '';
  const m = Math.round((Date.now() - new Date(`${String(s).replace(' ', 'T')}Z`)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};
const basisLabel = (d) => (!d ? '' : d.invoice_basis === 'cost' ? 'cost price'
  : d.invoice_basis === 'mrp' ? 'retail price (MRP)' : `cost plus ${Math.round(d.markup_pct * 100)}%`);


export default function Departments() {
  const { can } = useAuth();
  const [tab, setTab] = useState('pending');
  const [depts, setDepts] = useState([]);
  const [rows, setRows] = useState([]);          // every slip the server lists (latest 200)
  const [deptFilter, setDeptFilter] = useState('');
  const [open, setOpen] = useState(null);         // slip being inspected
  const [cursor, setCursor] = useState(0);        // the row ▲/▼ sit on
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.get('/departments').then(setDepts).catch((e) => setErr(e.message));
    api.get('/departments/requests').then(setRows).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);
  // A runner may be walking over while this screen is open. The counter polls
  // its till every 30 s; the queue does the same.
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  const today = ymd(new Date());
  const visible = useMemo(() => rows
    .filter((r) => (tab === 'pending' ? r.status === 'received' : true))
    .filter((r) => !deptFilter || String(r.department_id) === String(deptFilter))
    // Emergencies first, then oldest first — the order the counter should work
    // them in, which is not the order they were typed.
    .sort((a, b) => (tab === 'pending'
      ? ((b.emergency_lines > 0) - (a.emergency_lines > 0)) || String(a.created_at).localeCompare(String(b.created_at))
      : 0)), [rows, tab, deptFilter]);

  const pending = rows.filter((r) => r.status === 'received');
  const stat = pending.filter((r) => r.emergency_lines > 0).length;
  const issuedToday = rows.filter((r) => r.bill_no && r.requested_on === today);
  const shortToday = rows.filter((r) => r.status === 'short' && r.requested_on === today).length;

  const inspect = useCallback((r) => {
    if (!r) return;
    api.get(`/departments/requests/${r.id}`).then(setOpen).catch((e) => setErr(e.message));
  }, []);

  // ▲/▼ move the cursor, Enter inspects. Never while typing.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || creating || tab === 'depts') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(0, visible.length - 1))); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); inspect(visible[cursor]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, cursor, inspect, creating, tab]);
  useEffect(() => { setCursor(0); }, [tab, deptFilter]);

  const done = (m, fresh) => { setMsg(m); if (fresh !== undefined) setOpen(fresh); load(); };

  return (
    <div className="flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="ws-h1 text-base font-bold text-slate-900 m-0">Department Requisitions &amp; Ward Indents</h1>
            <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded uppercase">internal issue · on account</span>
          </div>
          <div className="text-xs text-slate-500">Slips that arrive from the wards, the lab and emergency. Stock goes out FEFO and an invoice goes back on the department&apos;s account.</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={BTN} onClick={load}><Icon name="returns" size={13} /> Refresh</button>
          {can('pharmacy.dispense') && (
            <button type="button" className={BTN_DARK} onClick={() => setCreating(true)}>
              <Icon name="plus" size={13} /> Issue to a department
            </button>
          )}
        </div>
      </div>

      {/* KPI strip — every figure is from the rows below it. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <Kpi label="Awaiting dispense" value={pending.length} unit={(pending.length) === 1 ? 'slip' : 'slips'}
          sub={[...new Set(pending.map((r) => r.department_name))].slice(0, 3).join(', ') || 'queue is clear'} tone={pending.length ? 'amber' : 'ok'} icon="clock" />
        <Kpi label="Emergency lines" value={stat} unit={(stat) === 1 ? 'slip' : 'slips'} sub={stat ? 'flagged on the slip — work these first' : 'none flagged'} tone={stat ? 'danger' : ''} icon="warning" />
        <Kpi label="Issued today" value={issuedToday.length} unit={(issuedToday.length) === 1 ? 'invoice' : 'invoices'}
          sub={money(issuedToday.reduce((t, r) => t + Number(r.net_amount || 0), 0)) + ' to departments'} icon="check" />
        <Kpi label="Short today" value={shortToday} unit={(shortToday) === 1 ? 'slip' : 'slips'} sub={shortToday ? 'invoiced for what left the shelf' : 'every line supplied in full'} tone={shortToday ? 'warn' : ''} icon="box" />
      </div>

      <div className="grid grid-cols-12 gap-3 items-start">
        {/* ================= LEFT: the queue ============================== */}
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-3 print:hidden">
          <div className="bg-white rounded-md border border-slate-300 shadow-xs">
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-md flex-wrap">
              <div className="flex items-center gap-1">
                {[['pending', `Awaiting dispense${pending.length ? ` (${pending.length})` : ''}`], ['all', 'All slips'], ['depts', 'Departments']]
                  .map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)}
                      className={`h-7 px-2.5 text-[11px] font-semibold rounded border ${tab === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>
                      {l}
                    </button>
                  ))}
              </div>
              {tab !== 'depts' && (
                <div className="flex items-center gap-2">
                  <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className={`${CTL} w-48`}>
                    <option value="">All departments</option>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.name}{d.pending ? ` (${d.pending} waiting)` : ''}</option>)}
                  </select>
                  <span className="text-[10px] text-slate-500 font-mono hidden md:inline"><Kbd>▲</Kbd><Kbd>▼</Kbd> move <Kbd>Enter</Kbd> inspect</span>
                </div>
              )}
            </div>

            {tab === 'depts' ? (
              <DepartmentList depts={depts} can={can} onErr={setErr} onDone={(m) => done(m)} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2 pl-3 pr-2">Slip &amp; time</th>
                      <th className="text-left py-2 px-2">Department &amp; patient</th>
                      <th className="text-left py-2 px-2">Prescribed by</th>
                      <th className="text-left py-2 px-2">Collected by</th>
                      <th className="text-right py-2 px-2">Lines</th>
                      <th className="text-right py-2 px-2">Invoice</th>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-right py-2 pl-2 pr-3"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((r, i) => {
                      const onCursor = i === cursor;
                      const isOpen = open?.id === r.id;
                      const stat = r.emergency_lines > 0 && r.status === 'received';
                      return (
                        <tr key={r.id} onClick={() => { setCursor(i); inspect(r); }}
                          className={`cursor-pointer ${isOpen ? 'bg-sky-50 shadow-[inset_3px_0_0_#0369a1]' : onCursor ? 'bg-slate-50' : 'hover:bg-slate-50'} ${stat ? 'bg-rose-50/40' : ''}`}>
                          <td className="py-2 pl-3 pr-2 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {stat && <Icon name="warning" size={13} />}
                              <div>
                                <div className="font-mono font-bold text-slate-900">{r.request_no}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{hhmm(r.created_at)} · {ago(r.created_at)}{r.slip_ref ? ` · slip ${r.slip_ref}` : ''}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <div className="font-semibold text-slate-800">{r.department_name}</div>
                            <div className="text-[10px] text-slate-500">{r.patient_name || '—'}{r.patient_ref ? ` · ${r.patient_ref}` : ''}</div>
                          </td>
                          <td className="py-2 px-2 text-slate-700">{r.prescriber || <span className="text-slate-400">—</span>}</td>
                          <td className="py-2 px-2">
                            <div className="text-slate-800">{r.collected_by_name || <span className="text-slate-400">—</span>}</div>
                            {r.collected_by_contact ? <div className="text-[10px] text-slate-500 font-mono">{r.collected_by_contact}</div> : null}
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">
                            <span className="font-mono font-bold">{r.line_count}</span>
                            <div className="text-[10px] text-slate-500 font-mono">{r.units_requested} units</div>
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap font-mono">
                            {r.bill_no ? <><b>{money(r.net_amount)}</b><div className="text-[10px] text-slate-500">{r.bill_no}</div></> : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap"><Status r={r} /></td>
                          <td className="py-2 pl-2 pr-3 text-right">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setCursor(i); inspect(r); }}
                              className={`h-6 px-2 text-[10px] font-semibold rounded border ${isOpen ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}>
                              {isOpen ? 'Inspecting' : r.status === 'received' ? 'Load' : 'View'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {visible.length === 0 && (
                      <tr><td colSpan={8} className="py-6 text-center text-slate-500">
                        <span className="ws-empty">{tab === 'pending' ? 'No slips waiting. When a runner brings one, type it here.' : 'Nothing yet.'}</span>
                      </td></tr>
                    )}
                  </tbody>
                </table>
                <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
                  <span>Refreshes every 30 s · {pending.length} slip{pending.length === 1 ? '' : 's'} pending</span>
                  <span>Showing {visible.length} of {rows.length}</span>
                </div>
              </div>
            )}
          </div>

          {depts.length > 0 && (
            <div className="flex items-center justify-between gap-3 bg-white rounded-md border border-slate-300 shadow-xs px-3 py-2 text-[11px] text-slate-600">
              <div className="flex items-center gap-2">
                <Icon name="shield" size={14} />
                <span>
                  <b>Internal transfer pricing:</b> each department is invoiced at its own basis —{' '}
                  {[...new Set(depts.map(basisLabel))].join(', ')} — with no counter margin and no cash. The amount goes on the department&apos;s account and into hospital expense.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ================= RIGHT: the slip under inspection =============== */}
        <div className="col-span-12 xl:col-span-4 print:col-span-12">
          {open ? (
            <SlipDetail key={open.id} slip={open} depts={depts} can={can}
              onClose={() => setOpen(null)} onErr={setErr} onDone={done} />
          ) : (
            <div className="bg-white rounded-md border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 print:hidden">
              <Icon name="file" size={22} />
              <div className="mt-2 font-semibold text-slate-700">No slip under inspection</div>
              <div className="mt-1">Pick one from the queue, or press <Kbd>Enter</Kbd> on the highlighted row.</div>
            </div>
          )}
        </div>
      </div>

      {creating && <SlipForm depts={depts} onClose={() => setCreating(false)} onErr={setErr} />}
    </div>
  );
}

function Kpi({ label, value, unit, sub, tone = '', icon }) {
  const t = { amber: 'text-amber-700', danger: 'text-rose-700', warn: 'text-amber-700', ok: 'text-emerald-700' }[tone] || 'text-slate-900';
  return (
    <div className="ws-tile bg-white border flex items-start justify-between gap-2" data-tone={tone}>
      <div className="min-w-0">
        <div className="ws-tile-label text-[10px] font-bold uppercase tracking-wide text-slate-500 line-clamp-2 min-h-[2.4em] leading-[1.2]">{label}</div>
        <div className={`ws-tile-value ws-tile-mono font-bold leading-tight mt-0.5 ${t}`}>{value} <span className="text-[11px] font-sans font-semibold text-slate-500">{unit}</span></div>
        <div className="ws-tile-sub text-[10px] text-slate-500 line-clamp-2">{sub}</div>
      </div>
      <div className="text-slate-400 shrink-0"><Icon name={icon} size={16} /></div>
    </div>
  );
}

function Status({ r }) {
  const stat = r.emergency_lines > 0 && r.status === 'received';
  const c = stat ? 'bg-rose-100 text-rose-900 border-rose-300'
    : r.status === 'received' ? 'bg-amber-50 text-amber-800 border-amber-300'
      : r.status === 'short' ? 'bg-rose-50 text-rose-800 border-rose-200'
        : r.status === 'cancelled' ? 'bg-slate-100 text-slate-600 border-slate-300'
          : 'bg-emerald-50 text-emerald-800 border-emerald-300';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${c}`}>
      {stat ? 'STAT · awaiting' : r.status === 'received' ? 'Awaiting pick' : r.status === 'short' ? 'Partially issued' : r.status}
    </span>
  );
}

// --- Department master -------------------------------------------------------

function DepartmentList({ depts, can, onErr, onDone }) {
  const [edit, setEdit] = useState(null);

  async function save() {
    try {
      await api.put(`/departments/${edit.id}`, edit);
      setEdit(null);
      onDone('Department updated.');
    } catch (e) { onErr(e.message); }
  }

  return (
    <div className="p-3">
      <p className="text-[11px] text-slate-500 mt-0 mb-2">
        Each department is a customer of the pharmacy: it sends a prescription and receives an
        invoice, and those invoices are the hospital&apos;s expense. The person named here signs for
        the stock, and their name prints on the issue slip.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-200">
            <tr><th className="text-left py-2 px-2">Code</th><th className="text-left py-2 px-2">Department</th><th className="text-left py-2 px-2">Signs for it</th><th className="text-left py-2 px-2">Invoiced at</th>
              <th className="text-right py-2 px-2">Awaiting</th><th className="text-right py-2 px-2"><span className="sr-only">Edit</span></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {depts.map((d) => (
              <tr key={d.id}>
                <td className="py-2 px-2 font-mono">{d.code}</td>
                <td className="py-2 px-2 font-semibold">{d.name}</td>
                <td className="py-2 px-2">{d.in_charge || <span className="text-[10px] font-bold uppercase text-amber-800 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded">not named</span>}
                  {d.contact ? <div className="text-[10px] text-slate-500 font-mono">{d.contact}</div> : null}</td>
                <td className="py-2 px-2">{basisLabel(d)}</td>
                <td className="py-2 px-2 text-right font-mono">{d.pending ? <span className="font-bold text-amber-700">{d.pending}</span> : '—'}</td>
                <td className="py-2 px-2 text-right">
                  {can('inventory.manage') && <button type="button" className={BTN} onClick={() => setEdit({ ...d })}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="Name"><input className={`${CTL} w-full`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Who signs for it"><input className={`${CTL} w-full`} value={edit.in_charge || ''} onChange={(e) => setEdit({ ...edit, in_charge: e.target.value })} placeholder="Name of the in-charge" /></Field>
            <Field label="Contact"><input className={`${CTL} w-full font-mono`} value={edit.contact || ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></Field>
            <Field label="Invoiced at">
              <Select value={edit.invoice_basis} onChange={(e) => setEdit({ ...edit, invoice_basis: e.target.value })}>
                <option value="cost">Cost price — what the trust paid</option>
                <option value="cost_plus">Cost plus a percentage</option>
                <option value="mrp">Retail price (MRP)</option>
              </Select>
            </Field>
            {edit.invoice_basis === 'cost_plus' && (
              <Field label="Markup %"><input type="number" min="0" className={`${CTL} w-full font-mono`} value={Math.round((edit.markup_pct || 0) * 100)}
                onChange={(e) => setEdit({ ...edit, markup_pct: Number(e.target.value) / 100 })} /></Field>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <button type="button" className={BTN_DARK} onClick={save}>Save</button>
            <button type="button" className={BTN} onClick={() => setEdit(null)}>Cancel</button>
            <span className="text-[11px] text-slate-500 ml-2">Cost price is the default because this is money moving inside one organisation — the point is expense tracking, not margin.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

// --- Typing a slip that arrived ---------------------------------------------

function SlipForm({ depts, onClose, onErr }) {
  const nav = useNavigate();
  const [f, setF] = useState({
    department_id: '', collected_by_name: '', collected_by_contact: '', collected_by_cnic: '',
    patient_name: '', patient_ref: '', slip_ref: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dept = depts.find((d) => String(d.id) === String(f.department_id));

  // No line entry here on purpose.
  //
  // The first version of this screen rebuilt the whole cart inside a modal —
  // a worse copy of the counter, with no scanner, no stock figures and no
  // keyboard shortcuts. This form captures only what the counter cannot infer
  // (which department, and who is carrying the medicine away) and then hands
  // off to the till, where the items are scanned exactly as for any other sale.
  function go() {
    if (!f.department_id || !f.collected_by_name.trim()) return;
    nav('/pharmacy', { state: { chargeTo: f } });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal !rounded-md !p-5 text-slate-800" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold m-0">Issue to a department</h3>
        <p className="text-xs text-slate-500 mt-1 mb-3">
          Say who it is for and who is collecting it. The counter opens next, and the medicines
          are scanned there the same way as any sale.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Department *">
            <Select value={f.department_id} onChange={set('department_id')}>
              <option value="">Choose…</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Collected by *">
            <input className={`${CTL} w-full`} value={f.collected_by_name} onChange={set('collected_by_name')}
              placeholder="Name of the person taking the medicine" autoFocus />
          </Field>
          <Field label="Their mobile"><input className={`${CTL} w-full font-mono`} value={f.collected_by_contact} onChange={set('collected_by_contact')} placeholder="03xx-xxxxxxx" /></Field>
          <Field label="CNIC (optional)"><input className={`${CTL} w-full font-mono`} value={f.collected_by_cnic} onChange={set('collected_by_cnic')} placeholder="35202-1234567-1" /></Field>
        </div>
        <div className="text-[11px] text-slate-500 mt-1.5 mb-3">
          &ldquo;Collected by&rdquo; is the runner, nurse or attendant standing at the counter — not the
          department. It is the answer when an invoice is queried weeks later.
        </div>

        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">For which patient <span className="font-normal normal-case">— optional</span></div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Patient / ward / bed"><input className={`${CTL} w-full`} value={f.patient_name} onChange={set('patient_name')} placeholder="As on the slip" /></Field>
          <Field label="Their MR number"><input className={`${CTL} w-full font-mono`} value={f.patient_ref} onChange={set('patient_ref')} /></Field>
          <Field label="Slip serial"><input className={`${CTL} w-full font-mono`} value={f.slip_ref} onChange={set('slip_ref')} placeholder="Their reference" /></Field>
        </div>

        {dept && (
          <div className="mt-3 text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2">
            Billed to <b>{dept.name}</b> on account at {basisLabel(dept)}. No cash is taken.
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-4">
          <button type="button" className={BTN_DARK} onClick={go} disabled={!f.department_id || !f.collected_by_name.trim()}>
            Continue to the counter <Icon name="arrowright" size={13} />
          </button>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Type-ahead against the counter's own lookup, so the same search that finds a
// medicine at the till finds it here.
function ProductPicker({ value, text, onText, onPick }) {
  const [rows, setRows] = useState([]);
  const [openList, setOpenList] = useState(false);

  useEffect(() => {
    if (value || !text || text.length < 2) { setRows([]); return undefined; }
    const id = setTimeout(() => {
      api.get(`/pharmacy/lookup?q=${encodeURIComponent(text)}`).then((r) => { setRows(r); setOpenList(true); }).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [text, value]);

  return (
    <div className="relative">
      <input value={text} placeholder="Type the medicine to match it"
        onChange={(e) => { onText(e.target.value); setOpenList(true); }}
        className={`${CTL} w-full ${value ? 'border-emerald-500' : ''}`} />
      {value && <div className="text-[10px] text-slate-500 mt-0.5">matched · {value.sellable} {value.unit} in stock</div>}
      {!value && text.length >= 2 && <div className="text-[10px] text-rose-700 mt-0.5">not matched — resolve before dispensing</div>}
      {openList && rows.length > 0 && !value && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-300 rounded shadow-lg max-h-52 overflow-y-auto">
          {rows.map((p) => (
            <div key={p.id} className="px-2.5 py-1.5 text-xs cursor-pointer hover:bg-sky-50 border-b border-slate-100 last:border-b-0"
              onClick={() => { onPick(p); setOpenList(false); setRows([]); }}>
              <b>{p.name}</b> {p.strength} <span className="text-slate-500">· {p.sellable} {p.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Inspecting / dispensing a slip -------------------------------------------

function SlipDetail({ slip, depts, can, onClose, onDone, onErr }) {
  const [busy, setBusy] = useState(false);
  const [shortfalls, setShortfalls] = useState(null);
  const [drafts, setDrafts] = useState({});   // unmatched line id -> typed text
  const unresolved = slip.items.filter((i) => !i.product_id);
  const isOpen = slip.status === 'received';
  const dept = depts.find((d) => d.id === slip.department_id);
  const asked = slip.items.reduce((t, i) => t + Number(i.qty_requested || 0), 0);

  const dispense = useCallback(async () => {
    if (!isOpen || busy || unresolved.length || !can('pharmacy.dispense')) return;
    setBusy(true);
    try {
      const r = await api.post(`/departments/requests/${slip.id}/dispense`, {});
      setShortfalls(r.shortfalls);
      const fresh = await api.get(`/departments/requests/${slip.id}`);
      onDone(`Dispensed. Invoice ${r.bill.bill_no} for ${money(r.bill.net_amount)}.`, fresh);
    } catch (e) { onErr(e.message); } finally { setBusy(false); }
  }, [isOpen, busy, unresolved.length, can, slip.id, onDone, onErr]);

  async function cancel() {
    const reason = window.prompt(`Return slip ${slip.request_no} to ${slip.department_name} without issuing? Reason:`);
    if (reason == null) return;
    try {
      await api.post(`/departments/requests/${slip.id}/cancel`, { reason });
      onDone(`Slip ${slip.request_no} returned to ${slip.department_name}.`, await api.get(`/departments/requests/${slip.id}`));
    } catch (e) { onErr(e.message); }
  }

  async function resolve(item, product) {
    try {
      await api.put(`/departments/requests/${slip.id}/items/${item.id}`, { product_id: product.id });
      onDone('Line matched.', await api.get(`/departments/requests/${slip.id}`));
    } catch (e) { onErr(e.message); }
  }

  // F9 dispenses the slip under inspection; Esc puts it down.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F9') { e.preventDefault(); dispense(); }
      else if (e.key === 'Escape') {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;
        e.preventDefault(); onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispense, onClose]);

  const statusTone = slip.status === 'received' ? 'bg-amber-100 text-amber-900 border-amber-300'
    : slip.status === 'short' ? 'bg-rose-100 text-rose-900 border-rose-300'
      : slip.status === 'cancelled' ? 'bg-slate-100 text-slate-600 border-slate-300' : 'bg-emerald-100 text-emerald-900 border-emerald-300';

  return (
    <div className="bg-white rounded-md border border-slate-300 shadow-xs print:border-0 print:shadow-none" id="dept-slip">
      {/* Top bar */}
      <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 rounded-t-md">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 print:hidden">Active requisition inspection</span>
          <span className="hidden print:block text-[10px] font-bold uppercase tracking-wide text-slate-500">Department issue note</span>
          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${statusTone}`}>
            {slip.status === 'received' ? (unresolved.length ? `${unresolved.length} to match` : 'ready to issue') : slip.status}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-1">
          <div className="font-mono font-bold text-base text-slate-900">{slip.request_no}</div>
          <div className="font-mono text-[11px] text-slate-500">{slip.requested_on} {hhmm(slip.created_at)}</div>
        </div>
        <div className="text-xs text-slate-700 mt-0.5">
          <b>{slip.department_name}</b> <span className="font-mono text-slate-500">· {slip.department_code}</span>
          {slip.slip_ref ? <span className="text-slate-500"> · their slip {slip.slip_ref}</span> : null}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Runner */}
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          <div className="h-8 w-8 rounded bg-slate-800 text-white flex items-center justify-center shrink-0"><Icon name="user" size={15} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-900 truncate">{slip.collected_by_name || 'Collector not named'}</div>
            <div className="text-[10px] text-slate-500 font-mono truncate">
              {[slip.collected_by_contact, slip.collected_by_cnic].filter(Boolean).join(' • ') || 'no contact on the slip'}
            </div>
          </div>
          <div className="text-[10px] text-slate-500 text-right shrink-0">collected by<br />(runner)</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Patient / bed</div>
            <div className="font-semibold text-slate-800">{slip.patient_name || '—'}{slip.patient_ref ? <span className="font-mono text-slate-500"> · {slip.patient_ref}</span> : null}</div>
          </div>
          <div className="border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Prescribed by</div>
            <div className="font-semibold text-slate-800">{slip.prescriber || '—'}</div>
          </div>
        </div>

        {/* The accounting notice — the same words the counter uses. */}
        <div className="text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2 print:hidden">
          <b>Charged to {slip.department_name} — on account.</b> Billed at {basisLabel(dept) || 'the department&apos;s basis'}. No money is taken and the
          drawer is not touched — the amount goes on the department&apos;s account and appears in hospital expense.
        </div>

        {/* Lines */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-1">
            <span>Items{isOpen ? '' : ' & what was issued'}</span>
            <span>{slip.items.length} line{slip.items.length === 1 ? '' : 's'} · {asked} units asked</span>
          </div>
          <div className="divide-y divide-slate-100">
            {slip.items.map((i) => {
              const short = i.qty_dispensed > 0 && i.qty_dispensed < i.qty_requested;
              return (
                <div key={i.id} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        {i.product_name
                          ? <span>{i.product_name}{i.strength ? <span className="text-slate-500 font-normal"> {i.strength}</span> : null}</span>
                          : <><span className="text-[9px] font-bold uppercase text-rose-900 bg-rose-100 border border-rose-300 px-1 rounded">not matched</span> <span>{i.label}</span></>}
                        {i.is_emergency ? <span className="text-[9px] font-bold uppercase text-rose-900 bg-rose-100 border border-rose-300 px-1 rounded">emergency</span> : null}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        asked {i.requested_label || i.qty_requested}
                        {i.qty_dispensed ? <> · issued <b className="text-slate-800">{i.dispensed_label || i.qty_dispensed}</b></> : null}
                        {short && <span className="text-rose-700 font-bold"> · short</span>}
                        {i.batch_no ? <> · batch {i.batch_no}</> : null}
                      </div>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="text-xs font-bold text-slate-900">{i.line_total ? money(i.line_total) : <span className="text-slate-400 font-normal">at dispense</span>}</div>
                      {i.unit_price ? <div className="text-[10px] text-slate-500">@ {money(i.unit_price)}/{i.unit || 'unit'}</div> : null}
                    </div>
                  </div>
                  {!i.product_id && isOpen && (
                    <div className="mt-1.5 print:hidden">
                      <ProductPicker value={null} text={drafts[i.id] ?? (i.label || '')}
                        onText={(v) => setDrafts({ ...drafts, [i.id]: v })} onPick={(p) => resolve(i, p)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Money */}
        <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-xs space-y-1">
          <div className="flex justify-between text-slate-600"><span>Basis</span><span className="font-mono">{basisLabel(dept) || '—'}</span></div>
          <div className="flex justify-between text-slate-600"><span>Counter cash payable</span><span className="font-mono">Rs 0.00 · till untouched</span></div>
          <div className="flex justify-between text-slate-600"><span>Cost centre</span><span className="font-mono">{slip.department_code} · {slip.department_name}</span></div>
          <div className="flex items-end justify-between border-t border-slate-200 pt-1.5 mt-1">
            <div>
              <div className="font-bold text-slate-900">Total charged to department</div>
              <div className="text-[10px] text-slate-500">{slip.bill_no ? `Invoice ${slip.bill_no}` : 'priced FEFO at dispense'}</div>
            </div>
            <div className="font-mono font-black text-xl text-slate-900">{slip.bill_no ? money(slip.net_amount) : '—'}</div>
          </div>
        </div>

        {unresolved.length > 0 && isOpen && (
          <div className="text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded px-3 py-2 print:hidden">
            {unresolved.length} line{unresolved.length === 1 ? '' : 's'} must be matched to a product before this slip can be dispensed.
          </div>
        )}
        {shortfalls?.length > 0 && (
          <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Short on: {shortfalls.map((s) => `${s.product} (${s.shortfall_label} not given)`).join(', ')}.
            The invoice covers only what actually left the shelf.
          </div>
        )}

        {slip.bill_no && (
          <div className="hidden print:flex justify-between gap-6 pt-8 text-xs">
            <div>Issued by ____________________<div className="text-[10px] text-slate-500">Pharmacy</div></div>
            <div>Received by ____________________<div className="text-[10px] text-slate-500">{slip.collected_by_name || slip.in_charge || slip.department_name}</div></div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-1.5 print:hidden">
          {isOpen && can('pharmacy.dispense') && (
            <button type="button" onClick={dispense} disabled={busy || unresolved.length > 0}
              className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm flex items-center justify-between shadow-xs">
              <span className="inline-flex items-center gap-1.5"><Icon name="check" size={14} /> {busy ? 'Dispensing…' : 'Confirm dispense & invoice'}</span>
              <kbd className="bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
            </button>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {slip.bill_no && (
              <button type="button" className={`${BTN} justify-center`} onClick={() => printPaper('a4', { modal: false })}>
                <Icon name="printer" size={13} /> Print issue note
              </button>
            )}
            {isOpen && can('pharmacy.dispense') && (
              <button type="button" className={`${BTN} justify-center !text-rose-700`} onClick={cancel}>
                <Icon name="cross" size={13} /> Return slip
              </button>
            )}
            <button type="button" className={`${BTN} justify-center ${slip.bill_no || (isOpen && can('pharmacy.dispense')) ? '' : 'col-span-2'}`} onClick={onClose}>
              Close <Kbd>Esc</Kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
