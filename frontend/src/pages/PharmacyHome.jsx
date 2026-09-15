import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Alert, CategoryBadge, money } from '../components/ui.jsx';

// Pharmacy counter dashboard. A pharmacy in Pakistan opens the day needing four
// answers at a glance: who is waiting to collect, what is about to expire (and
// whether the distributor will still take it back), what has run out, and what
// the till has taken. Everything else on this screen exists to make one of
// those four actionable without leaving the page.

const SCHEDULE_LABEL = {
  OTC: 'General sale',
  Rx: 'Prescription only',
  G: 'Schedule G',
  Narcotic: 'Controlled drug',
};

function ScheduleBadge({ schedule }) {
  if (!schedule) return null;
  const tone = schedule === 'Narcotic' ? 'red' : schedule === 'G' ? 'amber' : schedule === 'Rx' ? 'blue' : 'gray';
  return <span className={`badge ${tone}`} title={SCHEDULE_LABEL[schedule] || schedule}>{schedule === 'OTC' ? 'OTC' : SCHEDULE_LABEL[schedule] || schedule}</span>;
}

// Expiry is read in days, not dates, at the counter.
function ExpiryChip({ days }) {
  if (days == null) return <span className="badge gray">no expiry</span>;
  if (days < 0) return <span className="badge red">expired {Math.abs(days)}d ago</span>;
  if (days <= 30) return <span className="badge red">{days}d left</span>;
  if (days <= 90) return <span className="badge amber">{days}d left</span>;
  return <span className="badge gray">{days}d left</span>;
}

export default function PharmacyHome() {
  const { user, can, hospitalMode, config } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/pharmacy/dashboard').then(setD).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    // The counter screen is left open all shift, so it refreshes itself rather
    // than showing a stale queue and stale takings.
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  async function quarantineExpired() {
    if (!window.confirm('Move all expired batches to quarantine? They will be blocked from sale but kept for the expiry claim.')) return;
    setBusy(true);
    try {
      const r = await api.post('/pharmacy/quarantine-expired', {});
      setMsg(`${r.quarantined} expired batch(es) — ${r.units} units — moved to quarantine.`);
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!d) return <div className="loading">Loading pharmacy dashboard…</div>;

  const { sales, stock, expiry, controlled, compliance, till } = d;
  const dateLabel = new Date(`${d.business_date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="ph-dash">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
      <Alert type="ok" onClose={() => setMsg('')}>{msg}</Alert>

      <div className="ph-head">
        <div>
          <h2>{hospitalMode ? 'Pharmacy Counter' : (config.pharmacy_name || 'Pharmacy')}</h2>
          <div className="muted">{user?.full_name} · {dateLabel}</div>
        </div>
        <div className="fx" style={{ gap: 10 }}>
          <span className={`conn ${till.open ? 'online' : 'offline'}`} title={till.open ? `Counter ${till.counter}` : 'No till session open'}>
            <span className="dot" />
            {till.open ? `Till open · ${money(till.expected)} expected` : 'Till closed'}
          </span>
          <button className="btn ghost sm" onClick={load}><Icon name="returns" size={15} /> Refresh</button>
        </div>
      </div>

      <PharmacyLookup onError={setErr} />

      {/* --- Takings and movement for the day --- */}
      <div className="gx cols-4 mb">
        <Stat label="Sales Today" value={money(sales.net)} cls="accent"
          sub={`${sales.bills} bill${sales.bills === 1 ? '' : 's'} · ${sales.units} units`} />
        <Stat label="Cash in Drawer" value={till.open ? money(till.expected) : '—'}
          sub={till.open
            ? `Card ${money(sales.card)} · Online ${money(sales.online)}`
            : 'Open a till session to track cash'}
          cls={till.open ? '' : 'warn'} />
        <Stat label="Gross Margin" value={money(sales.margin)} cls="accent"
          sub={`${sales.margin_pct}% on cost of ${money(sales.cogs)}`} />
        <Stat label="Stock Value" value={money(stock.value_at_cost)}
          sub={`${stock.skus} items · ${money(stock.value_at_retail)} at retail`} />
      </div>

      {/* --- Things that must be acted on, loudest first --- */}
      {expiry.expired.batches > 0 && (
        <div className="ph-banner danger">
          <span className="ic"><Icon name="warning" size={20} /></span>
          <div className="bd">
            <b>{expiry.expired.batches} expired batch{expiry.expired.batches === 1 ? '' : 'es'} still on the shelf</b>
            <div>{expiry.expired.units} units, {money(expiry.expired.value)} at cost. Expired medicine must not be sold or displayed — dispensing already skips it, but the stock needs to be pulled and quarantined.</div>
          </div>
          {can('inventory.manage') && (
            <button className="btn danger sm" disabled={busy} onClick={quarantineExpired}>Quarantine all</button>
          )}
        </div>
      )}

      {stock.quarantined_batches > 0 && (
        <div className="ph-banner warn">
          <span className="ic"><Icon name="box" size={20} /></span>
          <div className="bd">
            <b>{stock.quarantined_batches} batch{stock.quarantined_batches === 1 ? '' : 'es'} in quarantine</b>
            <div>{stock.quarantined_units} units held out of sale, {money(stock.quarantined_value)} at cost. Raise a vendor reclaim or write them off.</div>
          </div>
          {can('vendor.view') && <button className="btn ghost sm" onClick={() => nav('/vendors')}>Vendor reclaim</button>}
        </div>
      )}

      {compliance.total > 0 && (
        <div className="ph-banner info">
          <span className="ic"><Icon name="shield" size={20} /></span>
          <div className="bd">
            <b>Drug-record gaps ({compliance.total})</b>
            <div className="ph-gaps">
              {compliance.missing_drap_reg > 0 && <span>{compliance.missing_drap_reg} medicine(s) with no DRAP registration number</span>}
              {compliance.missing_batch_info > 0 && <span>{compliance.missing_batch_info} batch(es) missing a batch number or expiry date</span>}
              {compliance.missing_mrp > 0 && <span>{compliance.missing_mrp} product(s) with no MRP recorded</span>}
              {compliance.priced_above_mrp > 0 && <span className="bad">{compliance.priced_above_mrp} product(s) priced above their MRP</span>}
            </div>
          </div>
          {can('inventory.view') && <button className="btn ghost sm" onClick={() => nav('/inventory')}>Fix in inventory</button>}
        </div>
      )}

      {/* The dispensing work-list is fed by doctors' prescriptions and reception
          tokens, so it only exists once the hospital modules are switched on. A
          standalone pharmacy gets the reorder list in that slot instead. */}
      <div className="gx cols-2 mb ph-cols">
        {hospitalMode
          ? <DispensingQueue queue={d.queue} pending={d.pending} nav={nav} />
          : <ReorderPanel rows={d.reorder} nav={nav} canManage={can('inventory.manage')} />}
        <ExpiryPanel expiry={expiry} canManage={can('inventory.manage')} onDone={(m) => { setMsg(m); load(); }} onError={setErr} />
      </div>

      <div className="gx cols-2 mb ph-cols">
        {hospitalMode
          ? <ReorderPanel rows={d.reorder} nav={nav} canManage={can('inventory.manage')} />
          : <TopSellers rows={d.top_sellers} sales={sales} />}
        <ControlledPanel controlled={controlled} />
      </div>

      <div className={`gx ${hospitalMode ? 'cols-2 ph-cols' : ''}`}>
        {hospitalMode && <TopSellers rows={d.top_sellers} sales={sales} />}
        <RecentSales rows={d.recent_sales} nav={nav} canReturn={can('return.manage')} />
      </div>

      <div className="dh-links">
        {can('pharmacy.sell') && <button className="dh-link" onClick={() => nav('/pharmacy')}><Icon name="pharmacy" size={17} /> New Sale</button>}
        {can('pharmacy.sell') && <button className="dh-link" onClick={() => nav('/pharmacy-close')}><Icon name="clock" size={17} /> Day-End Close</button>}
        {can('inventory.view') && <button className="dh-link" onClick={() => nav('/inventory')}><Icon name="inventory" size={17} /> Inventory</button>}
        {can('pharmacy.dispense') && <button className="dh-link" onClick={() => nav('/departments')}><Icon name="patients" size={17} /> Department Slips</button>}
        {/* Front-line roles have no sidebar, so a module reachable only from the
            nav is invisible to the people who use it. */}
        {can('dialysis.view') && <button className="dh-link" onClick={() => nav('/dialysis')}><Icon name="dialysis" size={17} /> Dialysis Unit</button>}
        {can('patient.view') && <button className="dh-link" onClick={() => nav('/customers')}><Icon name="user" size={17} /> Customers &amp; Cards</button>}
        {can('billing.view') && <button className="dh-link" onClick={() => nav('/credit')}><Icon name="billing" size={17} /> Credit Accounts</button>}
        {can('return.manage') && <button className="dh-link" onClick={() => nav('/returns')}><Icon name="returns" size={17} /> Returns</button>}
        {can('vendor.view') && <button className="dh-link" onClick={() => nav('/vendors')}><Icon name="vendors" size={17} /> Vendors</button>}
        {can('cash.manage') && <button className="dh-link" onClick={() => nav('/cashflow')}><Icon name="cashflow" size={17} /> Cash Flow</button>}
        {can('billing.view') && <button className="dh-link" onClick={() => nav('/billing')}><Icon name="billing" size={17} /> Billing</button>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, cls }) {
  return (
    <div className={`stat ${cls || ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="muted sm" style={{ marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// --- Counter lookup (FR-PHA-11) --------------------------------------------
// One box the pharmacist types or scans into to answer "do we have it, what
// does it cost, which batch, when does it expire" without starting a sale.
function PharmacyLookup({ onError }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows(null); return undefined; }
    const t = setTimeout(() => {
      api.get(`/pharmacy/lookup?q=${encodeURIComponent(term)}`)
        .then(setRows)
        .catch((e) => onError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, onError]);

  return (
    <div className="card mb ph-lookup">
      <div className="ph-lookup-bar">
        <div className="input-ico" style={{ flex: 1 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Look up a medicine — brand, generic, DRAP number, or scan a barcode…" />
          <span className="lead"><Icon name="barcode" size={18} /></span>
        </div>
        {q && <button className="btn ghost" onClick={() => { setQ(''); setRows(null); setOpen(null); }}>Clear</button>}
      </div>

      {rows && rows.length === 0 && <div className="muted mt">No medicine matches “{q}”.</div>}

      {rows && rows.length > 0 && (
        <div className="ph-lookup-results">
          {rows.map((p) => (
            <div key={p.id} className="ph-look-row">
              <div className="ph-look-main" role="button" tabIndex={0}
                onClick={() => setOpen(open === p.id ? null : p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(open === p.id ? null : p.id); }}>
                <div className="nm">
                  {p.name} {p.strength && <span className="muted">{p.strength}</span>}
                  <ScheduleBadge schedule={p.drug_schedule} />
                  {p.is_refrigerated ? <span className="badge blue" title="Cold chain — store 2–8 °C"><Icon name="snowflake" size={11} /> 2–8 °C</span> : null}
                </div>
                <div className="muted sm">
                  {[
                    p.generic_name,
                    p.form,
                    p.units_per_strip > 1 ? `${p.units_per_strip}/strip` : null,
                    p.strips_per_box > 1 ? `${p.strips_per_box} strips/box` : null,
                    p.drap_reg_no ? `DRAP ${p.drap_reg_no}` : 'no DRAP number',
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="ph-look-price">
                <div className="p1">{money(p.units_per_strip > 1 ? p.strip_price : p.sale_price)}</div>
                <div className="muted sm">
                  {p.units_per_strip > 1
                    ? `/strip · ${money(p.sale_price)}/${p.unit}`
                    : `MRP ${p.mrp > 0 ? money(p.mrp) : '—'}`}
                </div>
              </div>
              <div className="ph-look-stock">
                <div className={`p1 ${p.sellable <= 0 ? 'bad' : ''}`}>{p.sellable}</div>
                <div className="muted sm">{p.stock_label || 'sellable'}</div>
              </div>

              {open === p.id && (
                <div className="ph-look-batches">
                  {p.batches.length === 0 ? <div className="muted sm">No stock in any batch.</div> : (
                    <table>
                      <thead><tr><th>Batch</th><th>Expiry</th><th className="right">Qty</th><th className="right">Cost</th><th className="right">Pack MRP</th><th></th></tr></thead>
                      <tbody>
                        {p.batches.map((b) => (
                          <tr key={b.id} className={b.quarantined ? 'ph-quar' : ''}>
                            <td className="mono">{b.batch_no || '—'}</td>
                            <td>{b.expiry_date || '—'} <ExpiryChip days={b.expiry_date ? b.days_left : null} /></td>
                            <td className="right">{b.quantity}</td>
                            <td className="right">{money(b.cost_price)}</td>
                            <td className="right">{b.mrp > 0 ? money(b.mrp) : '—'}</td>
                            <td className="right">{b.quarantined ? <span className="badge red">quarantined</span> : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Dispensing work-list ---------------------------------------------------
function DispensingQueue({ queue, pending, nav }) {
  const total = queue.length + pending.length;
  return (
    <div className="card">
      <div className="dh-head">
        <span className="dh-title"><Icon name="queue" size={18} /> To Dispense
          <span className="count">{total} waiting</span></span>
        <button className="btn primary sm" onClick={() => nav('/pharmacy')}>Open counter</button>
      </div>

      {total === 0 ? (
        <div className="dh-empty">
          <Icon name="check" size={30} strokeWidth={2.5} />
          <div>Nothing waiting to be dispensed.</div>
          <div className="muted sm">Prescriptions written by the doctor appear here automatically.</div>
        </div>
      ) : (
        <div className="dh-list">
          {queue.map((t) => (
            <div key={`tok-${t.id}`} className="dh-row" role="button" tabIndex={0}
              onClick={() => nav(`/patients/${t.patient_id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') nav(`/patients/${t.patient_id}`); }}>
              <div className="dh-tok">#{t.token_number}</div>
              <div className="dh-info">
                <div className="dh-name">{t.full_name} <CategoryBadge category={t.category} /></div>
                <div className="muted mono sm">{t.patient_code} · token at the counter</div>
              </div>
              <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); nav('/pharmacy'); }}>
                Dispense <Icon name="arrowright" size={15} />
              </button>
            </div>
          ))}

          {pending.map((p) => (
            <div key={`rx-${p.patient_id}`} className="dh-row" role="button" tabIndex={0}
              onClick={() => nav(`/patients/${p.patient_id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') nav(`/patients/${p.patient_id}`); }}>
              <div className="dh-tok sm"><Icon name="file" size={20} /></div>
              <div className="dh-info">
                <div className="dh-name">{p.full_name} <CategoryBadge category={p.category} /></div>
                <div className="muted sm">
                  <span className="mono">{p.patient_code}</span> · {p.pending_lines} item{p.pending_lines === 1 ? '' : 's'} pending
                  {p.out_of_stock_lines > 0 && <span className="badge red" style={{ marginInlineStart: 8 }}>{p.out_of_stock_lines} out of stock</span>}
                  {p.unlinked_lines > 0 && <span className="badge amber" style={{ marginInlineStart: 8 }}>{p.unlinked_lines} not in stock list</span>}
                </div>
              </div>
              <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); nav('/pharmacy'); }}>
                Dispense <Icon name="arrowright" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Expiry & distributor claims -------------------------------------------
function ExpiryPanel({ expiry, canManage, onDone, onError }) {
  const [busy, setBusy] = useState(0);

  async function quarantine(batch) {
    setBusy(batch.id);
    try {
      await api.post(`/pharmacy/batches/${batch.id}/quarantine`, { reason: 'Pulled from shelf at counter review' });
      onDone(`Batch ${batch.batch_no || batch.id} of ${batch.name} quarantined.`);
    } catch (e) { onError(e.message); } finally { setBusy(0); }
  }

  return (
    <div className="card">
      <div className="dh-head">
        <span className="dh-title"><Icon name="clock" size={18} /> Expiry & Claims</span>
        <span className="muted sm">claim window {expiry.claim_window_days} days</span>
      </div>

      <div className="ph-buckets">
        <Bucket tone="red" label="Expired" b={expiry.expired} note="off the shelf" />
        <Bucket tone="amber" label="Within 30 days" b={expiry.within_30} note="sell first" />
        <Bucket tone="blue" label={`Within ${expiry.near_expiry_days} days`} b={expiry.near} note="watch" />
        <Bucket tone="green" label="Still claimable" b={expiry.claimable} note="return to supplier" />
      </div>

      {expiry.batches.length === 0 ? (
        <div className="muted mt">No batch expires within {expiry.near_expiry_days} days.</div>
      ) : (
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Medicine</th><th>Batch</th><th>Expires</th><th className="right">Qty</th><th className="right">Value</th><th></th></tr></thead>
            <tbody>
              {expiry.batches.map((b) => (
                <tr key={b.id} className={b.quarantined ? 'ph-quar' : ''}>
                  <td>
                    <b>{b.name}</b>{b.strength ? ` ${b.strength}` : ''}
                    {b.vendor_name && <div className="muted sm">{b.vendor_name}</div>}
                  </td>
                  <td className="mono">{b.batch_no || '—'}</td>
                  <td>{b.expiry_date}<br /><ExpiryChip days={b.days_left} /></td>
                  <td className="right">{b.quantity}</td>
                  <td className="right">{money(b.quantity * b.cost_price)}</td>
                  <td className="right">
                    {b.quarantined ? <span className="badge red">quarantined</span>
                      : canManage ? (
                        <button className="btn ghost sm" disabled={busy === b.id} onClick={() => quarantine(b)}>Pull</button>
                      ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Bucket({ tone, label, b, note }) {
  return (
    <div className={`ph-bucket ${tone}`}>
      <div className="k">{label}</div>
      <div className="v">{b.units}</div>
      <div className="s">{b.batches} batch{b.batches === 1 ? '' : 'es'} · {money(b.value)}</div>
      <div className="n">{note}</div>
    </div>
  );
}

// --- Reorder ----------------------------------------------------------------
function ReorderPanel({ rows, nav, canManage }) {
  return (
    <div className="card">
      <div className="dh-head">
        <span className="dh-title"><Icon name="inventory" size={18} /> Reorder List
          <span className="count">{rows.length}</span></span>
        {canManage && <button className="btn ghost sm" onClick={() => nav('/inventory')}>Receive stock</button>}
      </div>
      {rows.length === 0 ? (
        <div className="dh-empty">
          <Icon name="check" size={30} strokeWidth={2.5} />
          <div>Every item is above its reorder level.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Medicine</th><th className="right">On Hand</th><th className="right">Reorder At</th><th className="right">Used (30d)</th><th className="right">Suggest</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                // Order back to a month's cover, or to the reorder level when
                // there is no movement history to size the order from.
                const target = Math.max(r.used_30d, r.reorder_level);
                const suggest = Math.max(0, target - r.on_hand);
                // Order in boxes — that is the unit a distributor supplies in.
                const perBox = (r.units_per_strip || 1) * (r.strips_per_box || 1);
                const boxes = perBox > 1 ? Math.ceil(suggest / perBox) : null;
                return (
                  <tr key={r.id}>
                    <td><b>{r.name}</b>{r.strength ? ` ${r.strength}` : ''}</td>
                    <td className="right"><span className={`badge ${r.on_hand <= 0 ? 'red' : 'amber'}`}>{r.on_hand}</span></td>
                    <td className="right">{r.reorder_level}</td>
                    <td className="right">{r.used_30d}</td>
                    <td className="right">
                      <b>{suggest}</b> <span className="muted sm">{r.unit || ''}</span>
                      {boxes ? <div className="muted sm">order {boxes} box{boxes === 1 ? '' : 'es'}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Controlled drugs -------------------------------------------------------
function ControlledPanel({ controlled }) {
  return (
    <div className="card">
      <div className="dh-head">
        <span className="dh-title"><Icon name="shield" size={18} /> Controlled Drug Register</span>
        <span className="muted sm">{controlled.skus} item(s) · {controlled.units} units held</span>
      </div>

      {controlled.skus === 0 ? (
        <div className="dh-empty">
          <Icon name="shield" size={30} strokeWidth={2.5} />
          <div>No Schedule G or narcotic items are stocked.</div>
          <div className="muted sm">Classify a product as Schedule G or Controlled in Inventory and every sale is written to this register automatically.</div>
        </div>
      ) : (
        <>
          <div className="ph-cdr-summary">
            <div><span className="k">Entries today</span><span className="v">{controlled.today_entries}</span></div>
            <div><span className="k">Units today</span><span className="v">{controlled.today_units}</span></div>
            <div><span className="k">On shelf</span><span className="v">{controlled.units}</span></div>
          </div>
          {controlled.recent.length === 0 ? (
            <div className="muted mt">No entries recorded yet.</div>
          ) : (
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>Entry</th><th>Medicine</th><th className="right">Qty</th><th>Collected by</th><th>Prescriber</th></tr></thead>
                <tbody>
                  {controlled.recent.map((r) => (
                    <tr key={r.entry_no}>
                      <td className="mono sm">{r.entry_no}<div className="muted sm">{(r.created_at || '').slice(0, 10)}</div></td>
                      <td>{r.product_name} <ScheduleBadge schedule={r.drug_schedule} /></td>
                      <td className="right">{r.quantity}</td>
                      <td>{r.buyer_name || r.patient_name || '—'}{r.buyer_cnic && <div className="muted sm mono">{r.buyer_cnic}</div>}</td>
                      <td>{r.prescriber_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Activity ---------------------------------------------------------------
function TopSellers({ rows, sales }) {
  const max = rows.reduce((m, r) => Math.max(m, r.units), 0) || 1;
  return (
    <div className="card">
      <div className="dh-head">
        <span className="dh-title"><Icon name="trend" size={18} /> Moving Today</span>
        <span className="muted sm">{sales.distinct_items} distinct item(s)</span>
      </div>
      {rows.length === 0 ? (
        <div className="dh-empty muted">Nothing dispensed yet today.</div>
      ) : (
        <div className="ph-bars">
          {rows.map((r) => (
            <div key={`${r.product_id}-${r.description}`} className="ph-bar">
              <div className="lbl"><span>{r.description}</span><b>{r.units}</b></div>
              <div className="track"><span style={{ width: `${(r.units / max) * 100}%` }} /></div>
              <div className="muted sm">{money(r.revenue)}</div>
            </div>
          ))}
        </div>
      )}
      {sales.subsidy > 0 && (
        <div className="muted sm mt">Free and discounted patients absorbed <b>{money(sales.subsidy + sales.discount)}</b> today.</div>
      )}
    </div>
  );
}

function RecentSales({ rows, nav, canReturn }) {
  return (
    <div className="card">
      <div className="dh-head">
        <span className="dh-title"><Icon name="billing" size={18} /> Recent Sales</span>
        {canReturn && <button className="btn ghost sm" onClick={() => nav('/returns')}>Process a return</button>}
      </div>
      {rows.length === 0 ? (
        <div className="dh-empty muted">No pharmacy sales recorded yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Bill</th><th>Buyer</th><th className="right">Amount</th><th>Paid</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono sm">{b.bill_no}<div className="muted sm">{(b.created_at || '').slice(5, 16)}</div></td>
                  <td>{b.buyer}{b.patient_code && <div className="muted mono sm">{b.patient_code}</div>}</td>
                  <td className="right">{money(b.net_amount)}<div className="muted sm">{b.lines} line(s)</div></td>
                  <td>
                    <span className={`badge ${b.status === 'paid' ? 'green' : b.status === 'partial' ? 'amber' : 'red'}`}>{b.status}</span>
                    <div className="muted sm">{b.payment_method}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
