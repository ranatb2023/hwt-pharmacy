import React, { useEffect, useState } from 'react';
import Select from "../components/Select.jsx";
import { api } from '../api.js';
import { Alert, money } from '../components/ui.jsx';

// Column spec: key, label, and optional type ('money' | 'date').
const REPORTS = {
  revenue: {
    title: 'Revenue', endpoint: '/reports/revenue', dated: true, grouped: true,
    cols: [['label', 'Group'], ['bills', 'Bills'], ['gross', 'Gross', 'money'], ['discount', 'Discount', 'money'], ['subsidy', 'Subsidy', 'money'], ['net', 'Net', 'money'], ['collected', 'Collected', 'money']],
  },
  subsidy: {
    title: 'Discount & Subsidy', endpoint: '/reports/subsidy', dated: true,
    cols: [['category', 'Category'], ['bills', 'Bills'], ['gross', 'Gross', 'money'], ['discount', 'Discount', 'money'], ['subsidy', 'Subsidy', 'money'], ['net', 'Net', 'money']],
  },
  'stock-valuation': {
    title: 'Stock Valuation', endpoint: '/reports/stock-valuation',
    cols: [['name', 'Product'], ['on_hand', 'On Hand'], ['cost_value', 'Cost Value', 'money'], ['sale_value', 'Sale Value', 'money']],
  },
  vendors: {
    title: 'Vendor Payables', endpoint: '/reports/vendors',
    cols: [['name', 'Vendor'], ['purchased', 'Purchased', 'money'], ['paid', 'Paid', 'money'], ['reclaimed', 'Reclaimed', 'money'], ['balance', 'Payable', 'money']],
  },
  returns: {
    title: 'Returns', endpoint: '/reports/returns', dated: true,
    cols: [['return_no', 'Return No'], ['created_at', 'Date', 'date'], ['customer', 'Customer'], ['refund_amount', 'Refund', 'money'], ['restocked', 'Restocked'], ['writtenoff', 'Written Off'], ['reason', 'Reason']],
  },
  cashflow: {
    title: 'Cash Flow', endpoint: '/reports/cashflow', dated: true,
    cols: [['counter', 'Counter'], ['user_name', 'User'], ['opened_at', 'Opened', 'date'], ['closed_at', 'Closed', 'date'], ['opening_float', 'Float', 'money'], ['expected_cash', 'Expected', 'money'], ['counted_cash', 'Counted', 'money'], ['variance', 'Variance', 'money'], ['status', 'Status']],
  },
  patients: {
    title: 'Patient Register', endpoint: '/reports/patients', dated: true,
    cols: [['patient_code', 'Patient ID'], ['full_name', 'Name'], ['gender', 'Gender'], ['age', 'Age'], ['category', 'Category'], ['contact', 'Contact'], ['registered', 'Registered']],
  },
  lab: {
    title: 'Lab Productivity', endpoint: '/reports/lab', dated: true,
    cols: [['test_name', 'Test'], ['ordered', 'Ordered'], ['completed', 'Completed'], ['revenue', 'Revenue', 'money']],
  },
  'stock-movements': {
    title: 'Stock Movement Ledger', endpoint: '/reports/stock-movements', dated: true,
    cols: [['created_at', 'Time', 'date'], ['product_name', 'Product'], ['type', 'Type'], ['quantity', 'Qty'], ['reference', 'Reference'], ['reason', 'Reason']],
  },
  'staff-discount': {
    title: 'Staff Discount vs Cap', endpoint: '/reports/staff-discount',
    cols: [['patient_code', 'Staff ID'], ['full_name', 'Name'], ['used', 'Used', 'money'], ['remaining', 'Remaining', 'money'], ['cap', 'Annual Cap', 'money']],
  },
  dialysis: {
    title: 'Dialysis Activity', endpoint: '/reports/dialysis', dated: true,
    cols: [['category', 'Category'], ['sessions', 'Sessions'], ['gross', 'Gross', 'money'], ['subsidy', 'Subsidy', 'money'], ['net', 'Net', 'money']],
  },
};

const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

export default function Reports() {
  const [key, setKey] = useState('revenue');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState('day');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const def = REPORTS[key];

  function load() {
    setErr(''); setLoading(true);
    const params = new URLSearchParams();
    if (def.dated) { params.set('from', from); params.set('to', to); }
    if (def.grouped) params.set('group', group);
    const qs = params.toString();
    api.get(`${def.endpoint}${qs ? '?' + qs : ''}`)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [key, group]);

  function fmt(val, type) {
    if (val == null || val === '') return '—';
    if (type === 'money') return money(val);
    if (type === 'date') return String(val).slice(0, 16).replace('T', ' ');
    return val;
  }

  function exportCSV() {
    const header = def.cols.map((c) => c[1]).join(',');
    const body = rows.map((r) => def.cols.map((c) => csvCell(r[c[0]])).join(',')).join('\n');
    const csv = header + '\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${key}-${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // Totals for numeric/money columns.
  const totals = {};
  def.cols.forEach((c) => {
    if (['money'].includes(c[2]) || ['bills', 'ordered', 'completed', 'sessions', 'on_hand', 'restocked', 'writtenoff'].includes(c[0])) {
      totals[c[0]] = rows.reduce((s, r) => s + (Number(r[c[0]]) || 0), 0);
    }
  });

  return (
    <div>
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <div className="card mb no-print">
        <div className="flex wrap between">
          <div className="flex wrap">
            <div className="field" style={{ margin: 0 }}>
              <label>Report</label>
              <Select value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 200 }}>
                {Object.entries(REPORTS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
              </Select>
            </div>
            {def.dated && <>
              <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>}
            {def.grouped && <div className="field" style={{ margin: 0 }}><label>Group by</label>
              <Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Day</option><option value="category">Category</option><option value="type">Bill type</option></Select></div>}
            <div className="field" style={{ margin: 0, alignSelf: 'flex-end' }}><button className="btn" onClick={load}>Run</button></div>
          </div>
          <div className="flex" style={{ alignSelf: 'flex-end' }}>
            <button className="btn ghost" onClick={exportCSV} disabled={!rows.length}>⬇ Export CSV / Excel</button>
            <button className="btn ghost" onClick={() => window.print()} disabled={!rows.length}>🖨 Print / PDF</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex between mb">
          <h3 style={{ margin: 0 }}>{def.title}{def.dated ? ` · ${from} → ${to}` : ''}</h3>
          <span className="muted">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>{def.cols.map((c) => <th key={c[0]} className={c[2] === 'money' ? 'right' : ''}>{c[1]}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={def.cols.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr> :
                rows.map((r, i) => (
                  <tr key={i}>{def.cols.map((c) => <td key={c[0]} className={c[2] === 'money' ? 'right' : ''}>{fmt(r[c[0]], c[2])}</td>)}</tr>
                ))}
              {!loading && !rows.length && <tr><td colSpan={def.cols.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>No data for this period.</td></tr>}
            </tbody>
            {rows.length > 0 && Object.keys(totals).length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  {def.cols.map((c, idx) => (
                    <td key={c[0]} className={c[2] === 'money' ? 'right' : ''}>
                      {idx === 0 ? 'Total' : (totals[c[0]] != null ? fmt(totals[c[0]], c[2] === 'money' ? 'money' : undefined) : '')}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
