import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { printPaper } from '../print.js';
import { Alert, money } from '../components/ui.jsx';

// Correcting a bill that was keyed wrong — "if billed miss entered then it
// should be edited by the admin if session closed".
//
// The word to be careful about is *edited*. Editing the original is the one
// thing this screen must not do: last Tuesday's till was counted and closed,
// and if a Tuesday bill changes on Friday then Tuesday's reprinted day book no
// longer matches the cash counted that evening. The day stops being evidence.
//
// So the screen is explicit that it writes a credit note and a corrected bill,
// shows the money that has to change hands, and refuses to proceed without a
// reason. An unexplained correction is worth nothing to an auditor.

export default function Amend() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [bill, setBill] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function find(e) {
    e?.preventDefault();
    setErr(''); setBill(null);
    try {
      const r = await api.get(`/billing/lookup?bill_no=${encodeURIComponent(q.trim())}`);
      setBill(r);
    } catch (ex) { setErr(ex.message); }
  }

  if (!can('billing.amend')) {
    return (
      <div className="card">
        <div className="empty">
          <b>You do not have permission to amend bills.</b>
          This is a separate authority from a counter discount — an administrator grants
          <b> billing.amend</b> deliberately.
        </div>
      </div>
    );
  }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="card mb no-print">
        <form className="filter-bar" onSubmit={find}>
          <div className="field">
            <label>Bill number</label>
            <input value={q} autoFocus placeholder="INV-202609-00001"
              onChange={(e) => setQ(e.target.value)} />
            <div className="muted sm">
              The original is never changed. A correction writes a credit note and a corrected
              bill, and moves the money on today&apos;s till.
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={!q.trim()}>Find</button>
        </form>
      </div>

      {bill && (
        <AmendBill bill={bill} onErr={setErr}
          onDone={(m) => { setMsg(m); find(); }} />
      )}
    </div>
  );
}

function AmendBill({ bill, onErr, onDone }) {
  const nav = useNavigate();
  const [lines, setLines] = useState(
    (bill.items || [])
      .filter((i) => i.item_type === 'pharmacy')
      .map((i) => ({ product_id: i.ref_id, name: i.description, quantity: i.quantity, unit: i.unit_price }))
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [chain, setChain] = useState([]);
  const [noTill, setNoTill] = useState(false);

  useEffect(() => {
    api.get(`/billing/${bill.id}/amendments`).then(setChain).catch(() => setChain([]));
    setResult(null);
  }, [bill.id]);

  const newTotal = lines.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unit || 0), 0);
  const delta = Math.round((bill.paid_amount - newTotal) * 100) / 100;

  async function submit(acceptNoTill) {
    setBusy(true);
    try {
      const r = await api.post(`/billing/${bill.id}/amend`, {
        reason: reason.trim(),
        lines: lines.filter((l) => Number(l.quantity) > 0)
          .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
        accept_no_till: acceptNoTill || undefined,
      });
      setResult(r);
      onDone(`${bill.bill_no} corrected — see ${r.corrected?.bill_no || r.credit_note.bill_no}.`);
    } catch (e) {
      // The API offers a way through; showing the message alone left the admin
      // stuck with a customer waiting and no button to press.
      if (e.data?.code === 'TILL_NOT_OPEN') setNoTill(true);
      else onErr(e.message);
    } finally { setBusy(false); }
  }

  const already = bill.status === 'amended';

  return (
    <div className="card">
      <div className="fx between">
        <div>
          <h3 style={{ margin: 0 }}>{bill.bill_no}</h3>
          <div className="muted sm">
            {String(bill.created_at).slice(0, 16).replace('T', ' ')} ·{' '}
            {bill.customer_name || 'Walk-in customer'} · {bill.category}
          </div>
        </div>
        <div className="right">
          <div className="muted sm">Charged</div>
          <b style={{ fontSize: 20 }}>{money(bill.net_amount)}</b>
        </div>
      </div>

      {already && (
        <div className="alert info mt">
          <b>This bill has already been corrected.</b> Amend the corrected bill instead, so the
          chain stays readable.
        </div>
      )}

      {chain.length > 0 && (
        <>
          <div className="sec-title">Corrections so far</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Original</th><th>Became</th><th>Reason</th><th>By</th><th>When</th></tr></thead>
              <tbody>
                {chain.map((c) => (
                  <tr key={c.id}>
                    <td className="mono sm">{c.original_no}</td>
                    <td className="mono sm">{c.corrected_no || 'cancelled'}</td>
                    <td className="sm">{c.reason}</td>
                    <td className="sm">{c.amended_by}</td>
                    <td className="sm">{String(c.created_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="sec-title">What it should have said</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th className="right">Was</th><th className="right">Should be</th>
              <th className="right">Rate</th><th className="right">Line</th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="right sm muted">
                  {(bill.items.find((x) => x.ref_id === l.product_id) || {}).quantity}
                </td>
                <td className="right">
                  <input type="number" min="0" value={l.quantity} style={{ maxWidth: 90, textAlign: 'center' }}
                    onChange={(e) => setLines(lines.map((x, n) =>
                      (n === i ? { ...x, quantity: e.target.value } : x)))} />
                </td>
                <td className="right sm">{money(l.unit)}</td>
                <td className="right">{money(Number(l.quantity || 0) * Number(l.unit || 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}><b>Corrected total</b></td>
              <td className="right"><b>{money(newTotal)}</b></td></tr>
          </tfoot>
        </table>
      </div>

      {/* Said in words. "-450" at a counter is ambiguous, and the person reading
          it has a customer standing in front of them. */}
      <div className={`alert ${delta === 0 ? 'info' : 'err'} mt`}>
        {delta > 0
          ? <><b>Refund {money(delta)} to the customer.</b> They were overcharged.</>
          : delta < 0
            ? <><b>Collect {money(Math.abs(delta))} from the customer.</b> They were undercharged.</>
            : <><b>No money changes hands.</b> Only the record changes.</>}
        <div className="sm">
          This posts to today&apos;s open till, marked as a correction to{' '}
          {String(bill.created_at).slice(0, 10)}. The original day&apos;s till stays closed.
        </div>
      </div>

      <div className="field">
        <label>Reason *</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="What was keyed wrong, and how you know" />
        <div className="muted sm">
          Recorded against the correction and shown on the day book. An unexplained correction
          is worth nothing to an auditor.
        </div>
      </div>

      {/* The money has nowhere to land. Say so before the correction is written,
          and give a way through rather than a dead end — a correction that
          quietly moves no cash is how a drawer ends a day short with nothing to
          explain it. */}
      {noTill && (
        <div className="alert err">
          <b>No till is open.</b> {delta === 0
            ? 'Nothing changes hands here, so this is safe to record.'
            : 'The refund or collection will not appear on any day-end reconciliation.'}
          <div className="fx" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn primary sm" onClick={() => nav('/cashflow')}>Open the till first</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => submit(true)}>
              Record it anyway — off-till
            </button>
            <button className="btn ghost sm" onClick={() => setNoTill(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="fx">
        <button className="btn primary" disabled={busy || !reason.trim() || already}
          onClick={() => submit(false)}>
          Write the correction
        </button>
      </div>

      {result && (
        <div className="alert ok mt" id="amend-result">
          <b>Done.</b> {result.original.bill_no} is marked amended and unchanged.
          <ul style={{ margin: '6px 0 0 18px' }}>
            <li className="sm">Credit note <b>{result.credit_note.bill_no}</b> reverses it in full.</li>
            {result.corrected && (
              <li className="sm">Corrected bill <b>{result.corrected.bill_no}</b> for {money(result.corrected.net)}.</li>
            )}
            <li className="sm">{result.cash_note}
              {result.posted_to_open_till ? ' — posted to today’s till.' : ' — no till was open.'}</li>
            <li className="sm">Stock has been returned and re-issued to match.</li>
          </ul>
          <button className="btn ghost sm no-print mt" onClick={() => printPaper('a4', { modal: false })}>
            Print
          </button>
        </div>
      )}
    </div>
  );
}
