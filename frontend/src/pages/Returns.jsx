import React, { useState } from 'react';
import { api } from '../api.js';
import { Alert, money } from '../components/ui.jsx';

export default function Returns() {
  const [billNo, setBillNo] = useState('');
  const [bill, setBill] = useState(null);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  async function lookup(e) {
    e.preventDefault();
    setErr(''); setBill(null); setDone(null);
    try {
      const b = await api.get(`/returns/bill/${encodeURIComponent(billNo.trim())}`);
      setBill(b);
      setLines(b.items.map((i) => ({ product_id: i.ref_id, description: i.description, max: i.quantity, unit_price: i.unit_price, quantity: 0, saleable: true })));
    } catch (e) { setErr(e.message); }
  }

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const refund = lines.reduce((s, l) => s + Number(l.unit_price) * Number(l.quantity || 0), 0);

  async function submit() {
    const items = lines.filter((l) => l.quantity > 0).map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_price: l.unit_price, saleable: l.saleable }));
    if (!items.length) return setErr('Enter a quantity to return.');
    try {
      const r = await api.post('/returns', { bill_id: bill.id, reason, items });
      setDone(r);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <div className="card mb">
        <h3>Customer Return</h3>
        <form className="flex" onSubmit={lookup}>
          <input placeholder="Enter pharmacy Bill No (e.g. INV-202607-00001)" value={billNo} onChange={(e) => setBillNo(e.target.value)} style={{ maxWidth: 340 }} />
          <button className="btn">Look up</button>
        </form>
      </div>

      {done && (
        <div className="card receipt" style={{ maxWidth: 480 }}>
          <Alert type="ok">Return {done.returnNo} processed. Saleable stock returned to inventory.</Alert>
          <div className="flex between"><b>Refund issued</b><b>{money(done.refund)}</b></div>
          <button className="btn primary mt" onClick={() => { setDone(null); setBill(null); setBillNo(''); }}>New Return</button>
        </div>
      )}

      {bill && !done && (
        <div className="card">
          <div className="muted mb">Bill <b className="mono">{bill.bill_no}</b> · {bill.customer_name || 'Registered patient'} · Category {bill.category}</div>
          <table>
            <thead><tr><th>Item</th><th>Sold</th><th>Return Qty</th><th>Saleable?</th><th className="right">Refund</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td>{l.max}</td>
                  <td><input type="number" min="0" max={l.max} value={l.quantity} onChange={(e) => setLine(i, 'quantity', Math.min(l.max, Math.max(0, Number(e.target.value))))} style={{ width: 70 }} /></td>
                  <td><input type="checkbox" style={{ width: 'auto' }} checked={l.saleable} onChange={(e) => setLine(i, 'saleable', e.target.checked)} /> <span className="muted">{l.saleable ? 'restock' : 'write-off'}</span></td>
                  <td className="right">{money(Number(l.unit_price) * Number(l.quantity || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="field mt"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong medicine / unused" /></div>
          <div className="flex between mt">
            <b>Total refund: {money(refund)}</b>
            <button className="btn primary" onClick={submit} disabled={refund <= 0}>Process Return</button>
          </div>
          {refund > 5000 && <div className="muted mt">Note: refunds above Rs 5,000 require billing-override authorization.</div>}
        </div>
      )}
    </div>
  );
}
