import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, CategoryBadge, StatusBadge, money } from '../components/ui.jsx';

export default function Billing() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [visitId, setVisitId] = useState(params.get('visit') || '');
  const [preview, setPreview] = useState(null);
  const [bill, setBill] = useState(null);
  const [method, setMethod] = useState('cash');
  const [err, setErr] = useState('');

  async function loadPreview(id) {
    setErr(''); setPreview(null); setBill(null);
    try {
      const p = await api.get(`/billing/visit/${id}/preview`);
      setPreview(p);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { if (visitId) loadPreview(visitId); }, []);

  async function finalize() {
    try {
      const b = await api.post(`/billing/visit/${visitId}`, {
        items: preview.items,
        paid_amount: preview.net,
        payment_method: method,
      });
      setBill(b);
      setPreview(null);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      <div className="card mb">
        <h3>Generate Clinical Bill</h3>
        <form className="flex" onSubmit={(e) => { e.preventDefault(); setParams({ visit: visitId }); loadPreview(visitId); }}>
          <input placeholder="Enter Visit ID" value={visitId} onChange={(e) => setVisitId(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="btn">Load</button>
        </form>
        <div className="muted mt">Tip: open a patient record and use “Generate Bill”, which brings you here with the visit pre-filled.</div>
      </div>

      {preview && (
        <div className="card receipt" style={{ maxWidth: 560 }}>
          <div className="flex between mb">
            <h3 style={{ margin: 0 }}>Bill Preview</h3>
            <span><CategoryBadge category={preview.category} /></span>
          </div>
          <div className="muted mb">{preview.visit.full_name} · <span className="mono">{preview.visit.patient_code}</span></div>
          {preview.staff_allowance && (
            <div className="alert info">
              Staff discount allowance {new Date().getFullYear()}: used {money(preview.staff_allowance.used)} of {money(preview.staff_allowance.cap)} ·
              <b> {money(preview.staff_allowance.remaining)} remaining</b>. Discount is capped to the remaining allowance.
            </div>
          )}
          <table>
            <thead><tr><th>Item</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {preview.items.map((i, idx) => <tr key={idx}><td>{i.description}</td><td className="right">{money(i.line_total)}</td></tr>)}
              {preview.items.length === 0 && <tr><td colSpan={2} className="muted">No billable items for this visit.</td></tr>}
            </tbody>
          </table>
          <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <Row label="Gross" value={money(preview.gross)} />
            {preview.discount > 0 && <Row label="Category Discount" value={'– ' + money(preview.discount)} />}
            {preview.subsidy > 0 && <Row label="Subsidy (Complete Free)" value={'– ' + money(preview.subsidy)} />}
            <Row label="Net Payable" value={money(preview.net)} bold />
          </div>
          {can('billing.manage') && preview.items.length > 0 && (
            <>
              {preview.net > 0 && (
                <div className="field mt"><label>Payment Method</label>
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="online">Online</option></Select>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Cash payments post to your open till session automatically.</div>
                </div>
              )}
              <button className="btn primary mt" style={{ width: '100%' }} onClick={finalize}>Finalize Bill</button>
            </>
          )}
        </div>
      )}

      {bill && <FinalBill bill={bill} onPay={can('billing.manage')} onUpdated={setBill} />}
    </div>
  );
}

function FinalBill({ bill, onPay, onUpdated }) {
  const [amount, setAmount] = useState(bill.net_amount - bill.paid_amount);
  async function pay() {
    try { const b = await api.post(`/billing/${bill.id}/pay`, { amount: Number(amount) }); onUpdated(b); }
    catch (e) { alert(e.message); }
  }
  const due = bill.net_amount - bill.paid_amount;
  return (
    <div className="card receipt" style={{ maxWidth: 560 }}>
      <Alert type="ok">Bill created.</Alert>
      <div className="right no-print mb"><button className="btn ghost sm" onClick={() => window.print()}>🖨 Print</button></div>
      <div style={{ textAlign: 'center', borderBottom: '1px dashed #cbd5e1', paddingBottom: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Hope Welfare Trust Hospital</h2>
        <div className="muted mono">{bill.bill_no}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th className="right">Amount</th></tr></thead>
        <tbody>{bill.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="right">{money(i.line_total)}</td></tr>)}</tbody>
      </table>
      <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Row label="Gross" value={money(bill.gross_amount)} />
        {bill.discount > 0 && <Row label="Discount" value={'– ' + money(bill.discount)} />}
        {bill.subsidy > 0 && <Row label="Subsidy" value={'– ' + money(bill.subsidy)} />}
        <Row label="Net" value={money(bill.net_amount)} bold />
        <Row label="Paid" value={money(bill.paid_amount)} />
        <Row label="Due" value={money(due)} />
        <div className="mt"><StatusBadge status={bill.status} /></div>
      </div>
      {onPay && due > 0 && (
        <div className="flex mt no-print">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn primary" onClick={pay}>Record Payment</button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }) {
  return <div className="flex between" style={{ padding: '4px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 16 : 14 }}><span>{label}</span><span>{value}</span></div>;
}
