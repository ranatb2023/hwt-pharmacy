import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, money } from '../components/ui.jsx';

export default function Inventory() {
  const { can } = useAuth();
  const [tab, setTab] = useState('stock');
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState({ low_stock: [], near_expiry: [] });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [receiveFor, setReceiveFor] = useState(null);
  const [showNew, setShowNew] = useState(false);

  function load() {
    api.get('/inventory/products').then(setProducts).catch((e) => setErr(e.message));
    api.get('/inventory/alerts').then(setAlerts).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="flex between mb">
        <div className="flex">
          {['stock', 'alerts'].map((t) => (
            <button key={t} className={`btn sm ${tab === t ? 'primary' : 'ghost'}`} onClick={() => setTab(t)}>
              {t === 'stock' ? 'Stock' : `Alerts (${alerts.low_stock.length + alerts.near_expiry.length})`}
            </button>
          ))}
        </div>
        {can('inventory.manage') && <button className="btn primary" onClick={() => setShowNew(true)}>➕ New Product</button>}
      </div>

      {tab === 'stock' && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Form</th><th className="right">On Hand</th><th className="right">Sale Price</th><th>Reorder</th><th className="right">Action</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="mono muted">{p.sku || '—'}</td>
                  <td><b>{p.name}</b>{p.is_otc ? ' ' : ''}{p.is_otc ? <span className="badge blue">OTC</span> : ''}<br /><span className="muted">{p.generic_name}</span></td>
                  <td>{p.form || '—'}</td>
                  <td className="right"><b className={p.on_hand <= p.reorder_level ? 'badge red' : ''}>{p.on_hand}</b></td>
                  <td className="right">{money(p.sale_price)}</td>
                  <td>{p.reorder_level}</td>
                  <td className="right">{can('inventory.manage') && <button className="btn sm" onClick={() => setReceiveFor(p)}>Receive Stock</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'alerts' && (
        <div className="grid cols-2">
          <div className="card">
            <h3>Low Stock ({alerts.low_stock.length})</h3>
            {alerts.low_stock.length === 0 ? <div className="muted">All items above reorder level.</div> :
              alerts.low_stock.map((a) => (
                <div key={a.id} className="flex between mb"><span>{a.name}</span><span className="badge red">{a.on_hand} / reorder {a.reorder_level}</span></div>
              ))}
          </div>
          <div className="card">
            <h3>Near / Past Expiry ({alerts.near_expiry.length})</h3>
            {alerts.near_expiry.length === 0 ? <div className="muted">No batches expiring within 90 days.</div> :
              alerts.near_expiry.map((b) => (
                <div key={b.id} className="flex between mb"><span>{b.name} <span className="muted">batch {b.batch_no}</span></span><span className="badge amber">exp {b.expiry_date} · qty {b.quantity}</span></div>
              ))}
          </div>
        </div>
      )}

      {receiveFor && <ReceiveModal product={receiveFor} onClose={() => setReceiveFor(null)} onDone={(m) => { setMsg(m); setReceiveFor(null); load(); }} onErr={setErr} />}
      {showNew && <NewProductModal onClose={() => setShowNew(false)} onDone={(m) => { setMsg(m); setShowNew(false); load(); }} onErr={setErr} />}
    </div>
  );
}

function ReceiveModal({ product, onClose, onDone, onErr }) {
  const [f, setF] = useState({ quantity: '', batch_no: '', expiry_date: '', manufacturer: '', cost_price: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    try {
      await api.post(`/inventory/products/${product.id}/receive`, { ...f, quantity: Number(f.quantity), cost_price: Number(f.cost_price || 0) });
      onDone(`Received ${f.quantity} × ${product.name}.`);
    } catch (e) { onErr(e.message); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Receive Stock — {product.name}</h3>
        <div className="form-row">
          <div className="field"><label>Quantity *</label><input type="number" min="1" value={f.quantity} onChange={set('quantity')} autoFocus /></div>
          <div className="field"><label>Batch No</label><input value={f.batch_no} onChange={set('batch_no')} /></div>
          <div className="field"><label>Expiry Date</label><input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></div>
          <div className="field"><label>Cost Price</label><input type="number" value={f.cost_price} onChange={set('cost_price')} /></div>
        </div>
        <div className="field"><label>Manufacturer</label><input value={f.manufacturer} onChange={set('manufacturer')} /></div>
        <div className="flex"><button className="btn primary" onClick={save} disabled={!f.quantity}>Receive</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

function NewProductModal({ onClose, onDone, onErr }) {
  const [f, setF] = useState({ name: '', sku: '', generic_name: '', form: 'Tablet', unit: 'unit', is_otc: false, sale_price: '', reorder_level: 10 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save() {
    try {
      await api.post('/inventory/products', { ...f, sale_price: Number(f.sale_price || 0), reorder_level: Number(f.reorder_level) });
      onDone(`Product "${f.name}" created.`);
    } catch (e) { onErr(e.message); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New Product</h3>
        <div className="field"><label>Name *</label><input value={f.name} onChange={set('name')} autoFocus /></div>
        <div className="form-row">
          <div className="field"><label>SKU</label><input value={f.sku} onChange={set('sku')} /></div>
          <div className="field"><label>Generic Name</label><input value={f.generic_name} onChange={set('generic_name')} /></div>
          <div className="field"><label>Form</label><input value={f.form} onChange={set('form')} /></div>
          <div className="field"><label>Sale Price</label><input type="number" value={f.sale_price} onChange={set('sale_price')} /></div>
          <div className="field"><label>Reorder Level</label><input type="number" value={f.reorder_level} onChange={set('reorder_level')} /></div>
          <div className="field flex" style={{ gap: 8, alignItems: 'flex-end' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.is_otc} onChange={set('is_otc')} id="otc" /><label htmlFor="otc" style={{ margin: 0 }}>OTC item</label></div>
        </div>
        <div className="flex"><button className="btn primary" onClick={save} disabled={!f.name}>Create</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
