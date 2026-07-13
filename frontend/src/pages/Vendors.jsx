import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, money } from '../components/ui.jsx';

export default function Vendors() {
  const { can } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [modal, setModal] = useState(null); // 'purchase' | 'payment' | 'reclaim'

  function load() {
    api.get('/vendors').then(setVendors).catch((e) => setErr(e.message));
    api.get('/inventory/products').then(setProducts).catch(() => {});
  }
  useEffect(load, []);

  function openVendor(v) {
    api.get(`/vendors/${v.id}`).then(setSelected).catch((e) => setErr(e.message));
  }
  function refreshSelected() { if (selected) openVendor(selected); load(); }

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>
      <div className="grid cols-2" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        <div className="card">
          <div className="flex between mb"><h3 style={{ margin: 0 }}>Vendors</h3>{can('vendor.manage') && <button className="btn primary sm" onClick={() => setShowNew(true)}>➕ New</button>}</div>
          <table>
            <thead><tr><th>Name</th><th>Contact</th><th className="right">Payable</th></tr></thead>
            <tbody>{vendors.map((v) => (
              <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => openVendor(v)}>
                <td><b>{v.name}</b></td><td className="muted">{v.contact || '—'}</td>
                <td className="right"><span className={`badge ${v.balance > 0 ? 'amber' : 'gray'}`}>{money(v.balance)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div className="card">
          {!selected ? <div className="muted">Select a vendor to view purchases, payments and reclaims.</div> : (
            <>
              <div className="flex between">
                <div><h3 style={{ margin: 0 }}>{selected.name}</h3><div className="muted">{selected.address}</div></div>
                <div className="right"><div className="muted">Payable</div><b style={{ fontSize: 18 }}>{money(selected.balance)}</b></div>
              </div>
              {can('vendor.manage') && (
                <div className="flex mt mb">
                  <button className="btn accent sm" onClick={() => setModal('purchase')}>Goods Received</button>
                  <button className="btn sm" onClick={() => setModal('payment')}>Record Payment</button>
                  <button className="btn ghost sm" onClick={() => setModal('reclaim')}>Reclaim</button>
                </div>
              )}
              <h3 className="mt">Purchases</h3>
              <table><thead><tr><th>GRN</th><th>Invoice</th><th className="right">Total</th><th className="right">Paid</th></tr></thead>
                <tbody>{selected.purchases.map((p) => <tr key={p.id}><td className="mono">{p.grn_no}</td><td>{p.invoice_no || '—'}</td><td className="right">{money(p.total_amount)}</td><td className="right">{money(p.paid_amount)}</td></tr>)}
                  {!selected.purchases.length && <tr><td colSpan={4} className="muted">None</td></tr>}</tbody></table>
              <h3 className="mt">Reclaims</h3>
              <table><thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Value</th><th>Settlement</th></tr></thead>
                <tbody>{selected.reclaims.map((r) => <tr key={r.id}><td>{r.product_name}</td><td className="right">{r.quantity}</td><td className="right">{money(r.value)}</td><td>{r.settlement}</td></tr>)}
                  {!selected.reclaims.length && <tr><td colSpan={4} className="muted">None</td></tr>}</tbody></table>
            </>
          )}
        </div>
      </div>

      {showNew && <NewVendor onClose={() => setShowNew(false)} onDone={(m) => { setMsg(m); setShowNew(false); load(); }} onErr={setErr} />}
      {modal === 'purchase' && <PurchaseModal vendor={selected} products={products} onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); refreshSelected(); }} onErr={setErr} />}
      {modal === 'payment' && <PaymentModal vendor={selected} onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); refreshSelected(); }} onErr={setErr} />}
      {modal === 'reclaim' && <ReclaimModal vendor={selected} products={products} onClose={() => setModal(null)} onDone={(m) => { setMsg(m); setModal(null); refreshSelected(); }} onErr={setErr} />}
    </div>
  );
}

function NewVendor({ onClose, onDone, onErr }) {
  const [f, setF] = useState({ name: '', contact: '', address: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="New Vendor" onClose={onClose}>
      <div className="field"><label>Name *</label><input value={f.name} onChange={set('name')} autoFocus /></div>
      <div className="form-row"><div className="field"><label>Contact</label><input value={f.contact} onChange={set('contact')} /></div>
        <div className="field"><label>Address</label><input value={f.address} onChange={set('address')} /></div></div>
      <Actions onClose={onClose} disabled={!f.name} label="Create" onSave={() => api.post('/vendors', f).then(() => onDone(`Vendor "${f.name}" created.`)).catch((e) => onErr(e.message))} />
    </Modal>
  );
}

function PurchaseModal({ vendor, products, onClose, onDone, onErr }) {
  const [invoice, setInvoice] = useState('');
  const [paid, setPaid] = useState('');
  const [rows, setRows] = useState([{ product_id: '', quantity: 1, cost_price: '', batch_no: '', expiry_date: '' }]);
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const total = rows.reduce((s, r) => s + Number(r.cost_price || 0) * Number(r.quantity || 0), 0);
  async function save() {
    const items = rows.filter((r) => r.product_id && r.quantity > 0).map((r) => ({ ...r, product_id: Number(r.product_id), quantity: Number(r.quantity), cost_price: Number(r.cost_price || 0) }));
    if (!items.length) return onErr('Add at least one line item.');
    try { const g = await api.post(`/vendors/${vendor.id}/purchase`, { invoice_no: invoice, paid_amount: Number(paid || 0), items }); onDone(`Received ${g.grnNo} (${money(g.total)}).`); }
    catch (e) { onErr(e.message); }
  }
  return (
    <Modal title={`Goods Received — ${vendor.name}`} onClose={onClose} wide>
      <div className="form-row"><div className="field"><label>Invoice No</label><input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></div>
        <div className="field"><label>Paid Now</label><input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} /></div></div>
      {rows.map((r, i) => (
        <div key={i} className="form-row cols-3 mb" style={{ alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}><label>Product</label>
            <Select value={r.product_id} onChange={(e) => setRow(i, 'product_id', e.target.value)}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div className="field" style={{ margin: 0 }}><label>Qty</label><input type="number" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Cost</label><input type="number" value={r.cost_price} onChange={(e) => setRow(i, 'cost_price', e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Batch</label><input value={r.batch_no} onChange={(e) => setRow(i, 'batch_no', e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Expiry</label><input type="date" value={r.expiry_date} onChange={(e) => setRow(i, 'expiry_date', e.target.value)} /></div>
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => setRows((r) => [...r, { product_id: '', quantity: 1, cost_price: '', batch_no: '', expiry_date: '' }])}>+ Add line</button>
      <div className="right mt"><b>Total: {money(total)}</b></div>
      <Actions onClose={onClose} label="Receive Stock" onSave={save} />
    </Modal>
  );
}

function PaymentModal({ vendor, onClose, onDone, onErr }) {
  const [amount, setAmount] = useState('');
  return (
    <Modal title={`Payment — ${vendor.name}`} onClose={onClose}>
      <div className="muted mb">Outstanding payable: {money(vendor.balance)}</div>
      <div className="field"><label>Amount *</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
      <Actions onClose={onClose} disabled={!amount} label="Pay" onSave={() => api.post(`/vendors/${vendor.id}/payment`, { amount: Number(amount) }).then(() => onDone(`Paid ${money(amount)} to ${vendor.name}.`)).catch((e) => onErr(e.message))} />
    </Modal>
  );
}

function ReclaimModal({ vendor, products, onClose, onDone, onErr }) {
  const [f, setF] = useState({ product_id: '', batch_id: '', quantity: 1, value: '', reason: '', settlement: 'credit' });
  const [batches, setBatches] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function pickProduct(pid) {
    setF({ ...f, product_id: pid, batch_id: '' });
    if (pid) api.get(`/inventory/products/${pid}/batches`).then((b) => setBatches(b.filter((x) => x.quantity > 0))).catch(() => setBatches([]));
  }
  return (
    <Modal title={`Reclaim to ${vendor.name}`} onClose={onClose}>
      <div className="field"><label>Product</label><Select value={f.product_id} onChange={(e) => pickProduct(e.target.value)}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
      <div className="field"><label>Batch</label><Select value={f.batch_id} onChange={set('batch_id')}><option value="">—</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no || 'batch'} · exp {b.expiry_date || '—'} · qty {b.quantity}</option>)}</Select></div>
      <div className="form-row"><div className="field"><label>Quantity</label><input type="number" value={f.quantity} onChange={set('quantity')} /></div>
        <div className="field"><label>Value (optional)</label><input type="number" value={f.value} onChange={set('value')} /></div></div>
      <div className="form-row"><div className="field"><label>Settlement</label><Select value={f.settlement} onChange={set('settlement')}><option value="credit">Credit note</option><option value="cash">Cash refund</option></Select></div>
        <div className="field"><label>Reason</label><input value={f.reason} onChange={set('reason')} /></div></div>
      <Actions onClose={onClose} disabled={!f.product_id || !f.batch_id} label="Record Reclaim" onSave={() => api.post(`/vendors/${vendor.id}/reclaim`, { ...f, product_id: Number(f.product_id), batch_id: Number(f.batch_id), quantity: Number(f.quantity), value: f.value ? Number(f.value) : undefined }).then(() => onDone('Reclaim recorded.')).catch((e) => onErr(e.message))} />
    </Modal>
  );
}

// Shared modal primitives
export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 720 } : {}} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>{children}
      </div>
    </div>
  );
}
export function Actions({ onClose, onSave, label, disabled }) {
  return <div className="flex mt"><button className="btn primary" onClick={onSave} disabled={disabled}>{label}</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>;
}
