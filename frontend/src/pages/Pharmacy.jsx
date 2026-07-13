import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { api } from '../api.js';
import { CategoryBadge, Alert, money } from '../components/ui.jsx';

// Combined patient-detail + all test reports, printed at handover (FR-PHA-05).
async function printHandover(patientId) {
  const p = await api.get(`/patients/${patientId}`);
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const rows = (arr, cells) => (arr || []).map((r) => `<tr>${cells(r).map((c) => `<td style="padding:4px 8px;border-bottom:1px solid #eee">${c}</td>`).join('')}</tr>`).join('') || '<tr><td style="padding:4px 8px;color:#888">None</td></tr>';
  const html = `<html><head><title>${esc(p.patient_code)} — Patient Report</title></head>
    <body style="font-family:sans-serif;padding:24px;color:#111" onload="window.print()">
      <h2 style="margin:0">Hope Welfare Trust Hospital</h2>
      <div style="color:#555;margin-bottom:12px">Patient Detail & Reports</div>
      <table style="margin-bottom:14px"><tr><td style="padding:2px 12px 2px 0"><b>Patient ID</b></td><td>${esc(p.patient_code)}</td>
        <td style="padding:2px 12px"><b>Name</b></td><td>${esc(p.full_name)}</td></tr>
        <tr><td><b>Gender/Age</b></td><td>${esc(p.gender)} · ${esc(p.age)}</td><td style="padding:2px 12px"><b>Category</b></td><td>${esc(p.category)}</td></tr></table>
      <h3>Consultations & Diagnoses</h3>
      <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:4px 8px">Date</th><th style="text-align:left;padding:4px 8px">Diagnosis</th><th style="text-align:left;padding:4px 8px">Complaint</th></tr></thead>
        <tbody>${rows(p.consultations, (c) => [esc((c.created_at || '').slice(0, 10)), esc(c.diagnosis), esc(c.complaint)])}</tbody></table>
      <h3>Prescriptions</h3>
      <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:4px 8px">Medicine</th><th style="text-align:left;padding:4px 8px">Dosage</th><th style="text-align:left;padding:4px 8px">Frequency</th><th style="text-align:left;padding:4px 8px">Duration</th></tr></thead>
        <tbody>${rows(p.prescriptions, (r) => [esc(r.medicine_name), esc(r.dosage), esc(r.frequency), esc(r.duration)])}</tbody></table>
      <h3>Laboratory Reports</h3>
      <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:4px 8px">Test</th><th style="text-align:left;padding:4px 8px">Result</th><th style="text-align:left;padding:4px 8px">Status</th></tr></thead>
        <tbody>${rows(p.lab_orders, (l) => [esc(l.test_name), esc(l.result_value), esc(l.status) + (l.report_path ? ` (file: ${esc(l.report_path)})` : '')])}</tbody></table>
      <div style="margin-top:18px;color:#555;font-size:12px">Printed ${new Date().toLocaleString()}</div>
    </body></html>`;
  const w = window.open('', '_blank', 'width=800,height=700');
  w.document.write(html);
  w.document.close();
}

export default function Pharmacy() {
  const [products, setProducts] = useState([]);
  const [patientQ, setPatientQ] = useState('');
  const [patient, setPatient] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [pick, setPick] = useState('');
  const [allowance, setAllowance] = useState(null);
  const [method, setMethod] = useState('cash');
  const [allowPartial, setAllowPartial] = useState(false);

  useEffect(() => { api.get('/inventory/products').then(setProducts).catch((e) => setErr(e.message)); }, []);

  async function findPatient(e) {
    e.preventDefault();
    setErr('');
    try {
      const rows = await api.get(`/patients?q=${encodeURIComponent(patientQ)}`);
      if (!rows.length) { setErr('No patient found.'); return; }
      const p = rows[0];
      setPatient(p);
      setCustomerName('');
      const rx = await api.get(`/pharmacy/prescriptions/${p.id}`).catch(() => []);
      setPrescriptions(rx.filter((r) => !r.dispensed));
      setAllowance(p.category === 'Staff' ? await api.get(`/billing/staff-allowance/${p.id}`).catch(() => null) : null);
    } catch (e) { setErr(e.message); }
  }

  function addToCart(product, qty = 1) {
    setCart((c) => {
      const found = c.find((i) => i.product_id === product.id);
      if (found) return c.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + qty } : i));
      return [...c, { product_id: product.id, name: product.name, unit_price: product.sale_price, quantity: qty, on_hand: product.on_hand }];
    });
  }
  const setQty = (pid, q) => setCart((c) => c.map((i) => (i.product_id === pid ? { ...i, quantity: Math.max(1, q) } : i)));
  const removeItem = (pid) => setCart((c) => c.filter((i) => i.product_id !== pid));

  function addPrescription(r) {
    const prod = products.find((p) => p.id === r.product_id) || { id: r.product_id, name: r.medicine_name, sale_price: r.sale_price || 0, on_hand: r.on_hand };
    if (!prod.id) { setErr(`${r.medicine_name} is not linked to a stock product; add it manually.`); return; }
    addToCart(prod, 1);
  }

  const gross = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const category = patient?.category || 'Paid';
  const discount = category === 'Discounted' ? gross * 0.2 : category === 'Staff' ? gross * 0.5 : 0;
  const subsidy = category === 'Complete Free' ? gross : 0;
  const net = Math.max(0, gross - discount - subsidy);

  async function checkout() {
    setErr('');
    if (!cart.length) { setErr('Cart is empty.'); return; }
    try {
      const body = {
        patient_id: patient?.id || null,
        customer_name: patient ? null : (customerName || 'Walk-in customer'),
        category,
        payment_method: method,
        allow_partial: allowPartial,
        items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
      };
      const bill = await api.post('/pharmacy/sale', body);
      setReceipt(bill);
      setCart([]); setPrescriptions([]);
      api.get('/inventory/products').then(setProducts);
    } catch (e) { setErr(e.message); }
  }

  if (receipt) return <Receipt bill={receipt} onClose={() => { setReceipt(null); setPatient(null); setPatientQ(''); }} />;

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <div className="grid cols-2" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
        <div>
          <div className="card mb">
            <h3>Patient / Customer</h3>
            <form className="flex" onSubmit={findPatient}>
              <input placeholder="Patient ID, name or contact…" value={patientQ} onChange={(e) => setPatientQ(e.target.value)} />
              <button className="btn">Find</button>
              <button type="button" className="btn ghost" onClick={() => { setPatient(null); setPrescriptions([]); }}>Walk-in</button>
            </form>
            {patient ? (
              <>
                <div className="alert info mt">{patient.full_name} · <span className="mono">{patient.patient_code}</span> <CategoryBadge category={patient.category} /></div>
                {allowance && <div className="alert info">Staff allowance: <b>{money(allowance.remaining)}</b> of {money(allowance.cap)} remaining this year.</div>}
                <button className="btn ghost sm" onClick={() => printHandover(patient.id)}>🖨 Print Patient + Reports (handover)</button>
              </>
            ) : (
              <div className="field mt"><label>Walk-in customer name (optional)</label><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
            )}
            {prescriptions.length > 0 && (
              <div className="mt">
                <label>Pending prescriptions — click to add</label>
                {prescriptions.map((r) => (
                  <div key={r.id} className="flex between mb" style={{ padding: '6px 0', borderBottom: '1px solid #eef2f7' }}>
                    <div>{r.medicine_name} <span className="muted">{[r.dosage, r.frequency].filter(Boolean).join(' · ')}</span>
                      {r.product_id != null && <span className="muted"> · stock {r.on_hand}</span>}</div>
                    <button className="btn sm accent" onClick={() => addPrescription(r)}>Add</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Add Product</h3>
            <div className="flex">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">— Select product —</option>
                {products.map((p) => <option key={p.id} value={p.id} disabled={p.on_hand <= 0}>{p.name} · {money(p.sale_price)} · stock {p.on_hand}</option>)}
              </Select>
              <button className="btn primary" onClick={() => { const p = products.find((x) => String(x.id) === pick); if (p) addToCart(p); }}>Add</button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Sale / Dispense</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th>Qty</th><th className="right">Price</th><th className="right">Total</th><th></th></tr></thead>
              <tbody>
                {cart.map((i) => (
                  <tr key={i.product_id}>
                    <td>{i.name}{i.quantity > i.on_hand && <div className="badge red">exceeds stock {i.on_hand}</div>}</td>
                    <td><input type="number" min="1" value={i.quantity} onChange={(e) => setQty(i.product_id, Number(e.target.value))} style={{ width: 64 }} /></td>
                    <td className="right">{money(i.unit_price)}</td>
                    <td className="right">{money(i.unit_price * i.quantity)}</td>
                    <td className="right"><button className="btn ghost sm" onClick={() => removeItem(i.product_id)}>✕</button></td>
                  </tr>
                ))}
                {cart.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 20 }}>Cart is empty.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <Row label={`Gross (${category})`} value={money(gross)} />
            {discount > 0 && <Row label="Category discount" value={'– ' + money(discount)} />}
            {subsidy > 0 && <Row label="Subsidy (Complete Free)" value={'– ' + money(subsidy)} />}
            <Row label="Net Payable" value={money(net)} bold />
          </div>
          <div className="field mt"><label>Payment Method</label>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="online">Online</option></Select></div>
          <label className="flex" style={{ gap: 8, margin: '4px 0 0' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} />
            Allow partial dispensing (supply available stock, record the shortfall)
          </label>
          <button className="btn primary mt" style={{ width: '100%' }} onClick={checkout} disabled={!cart.length}>💊 Complete Sale</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex between" style={{ padding: '4px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 16 : 14 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

function Receipt({ bill, onClose }) {
  return (
    <div className="card receipt" style={{ margin: '0 auto' }}>
      <Alert type="ok">Sale completed — stock deducted (FEFO).</Alert>
      {bill.shortfalls && bill.shortfalls.length > 0 && (
        <div className="alert" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
          <b>Partial dispense</b> — recorded shortfall:
          {bill.shortfalls.map((s, i) => <div key={i}>{s.product}: supplied {s.dispensed} of {s.requested} (short {s.shortfall})</div>)}
        </div>
      )}
      <div className="right no-print mb"><button className="btn ghost sm" onClick={() => window.print()}>🖨 Print</button></div>
      <div style={{ textAlign: 'center', borderBottom: '1px dashed #cbd5e1', paddingBottom: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Hope Welfare Trust Pharmacy</h2>
        <div className="muted mono">{bill.bill_no}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Qty</th><th className="right">Total</th></tr></thead>
        <tbody>{bill.items.map((i) => <tr key={i.id}><td>{i.description}</td><td>{i.quantity}</td><td className="right">{money(i.line_total)}</td></tr>)}</tbody>
      </table>
      <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <Row label="Gross" value={money(bill.gross_amount)} />
        {bill.discount > 0 && <Row label="Discount" value={'– ' + money(bill.discount)} />}
        {bill.subsidy > 0 && <Row label="Subsidy" value={'– ' + money(bill.subsidy)} />}
        <Row label="Net" value={money(bill.net_amount)} bold />
      </div>
      <button className="btn primary mt no-print" style={{ width: '100%' }} onClick={onClose}>New Sale</button>
    </div>
  );
}
