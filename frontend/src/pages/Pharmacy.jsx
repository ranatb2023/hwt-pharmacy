import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import { CategoryBadge, Alert, money, useConfirm, strengthOf } from '../components/ui.jsx';
import { OFFLINE_MESSAGE } from '../connection.js';
import { Kbd, CTL, BTN, BTN_DARK, LABEL } from '../components/ws/index.jsx';
import { printPaper } from '../print.js';

// Pharmacy counter.
//
// This screen is driven from the keyboard, because that is how a counter is
// actually worked: scan or type into one box, Enter adds the line, F9 takes the
// money. A barcode scanner behaves as a keyboard that types the code and
// presses Enter, so an exact barcode match is added without the operator ever
// touching the result list.
//
// In Phase 1 (deployment_mode 'pharmacy') there are no registered patients, no
// doctor prescriptions and no categories — every sale is a retail sale. Those
// blocks are gated on hospitalMode rather than removed, so Phase 2 restores
// them by flipping one setting.
//
// PHASE 09 — the workstation layout (hwt-client/design/stitch, screens 01–03).
// The layout is the design's; the behaviour is unchanged. Every handler, key
// binding, quote and payload below is what Phases 01, 03 and 04 verified —
// the mockup markup became the skin over them, never a replacement for them.
// Where the mockup shows something the counter cannot know (a batch before
// FEFO has chosen one, a per-line subsidy when the quote is a basket total),
// the screen shows what it does know rather than inventing a figure.

const RX_SCHEDULES = ['Rx', 'G', 'Narcotic'];
const REGISTERED_SCHEDULES = ['G', 'Narcotic'];
const QUICK_CASH = [50, 100, 500, 1000, 5000];

// Who the department issue is for, and who is carrying it away. Kept as one
// object so parking a half-finished department issue restores all of it.
const BLANK_DEPT = {
  collected_by_name: '', collected_by_contact: '', collected_by_cnic: '',
  patient_name: '', patient_ref: '', slip_ref: '',
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

// Shelf reading of a base-unit quantity: "3 box + 4 strip + 7 tab".
function shelfLabel(i, base) {
  const perStrip = i.units_per_strip || 1;
  const perBox = i.units_per_box || perStrip;
  let rest = Math.max(0, Math.floor(base));
  const boxes = perBox > perStrip ? Math.floor(rest / perBox) : 0;
  rest -= boxes * perBox;
  const strips = perStrip > 1 ? Math.floor(rest / perStrip) : 0;
  rest -= strips * perStrip;
  if (!boxes && !strips) return `${base} ${i.unit_name}`;
  return [boxes && `${boxes} box`, strips && `${strips} strip`, rest && `${rest} ${i.unit_name}`]
    .filter(Boolean).join(' + ');
}

// Combined patient-detail + all test reports, printed at handover (FR-PHA-05).
// Hospital mode only — a standalone pharmacy has no records to hand over.
async function printHandover(patientId) {
  const p = await api.get(`/patients/${patientId}`);
  const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const rows = (arr, cells) => (arr || []).map((r) => `<tr>${cells(r).map((c) => `<td style="padding:4px 8px;border-bottom:1px solid #eee">${c}</td>`).join('')}</tr>`).join('') || '<tr><td style="padding:4px 8px;color:#888">None</td></tr>';
  const html = `<html><head><title>${esc(p.patient_code)} — Patient Report</title></head>
    <body style="font-family:sans-serif;padding:24px;color:#111" onload="window.print()">
      <h2 style="margin:0">Hope Welfare Trust Hospital</h2>
      <div style="color:#555;margin-bottom:12px">Patient Detail &amp; Reports</div>
      <table style="margin-bottom:14px"><tr><td style="padding:2px 12px 2px 0"><b>Patient ID</b></td><td>${esc(p.patient_code)}</td>
        <td style="padding:2px 12px"><b>Name</b></td><td>${esc(p.full_name)}</td></tr>
        <tr><td><b>Gender/Age</b></td><td>${esc(p.gender)} · ${esc(p.age)}</td><td style="padding:2px 12px"><b>Category</b></td><td>${esc(p.category)}</td></tr></table>
      <h3>Consultations &amp; Diagnoses</h3>
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

// The shared look of a compact control on this screen. The base `input` rule in
// styles.css sizes text fields for forms (44px); the counter is denser than
// that, so every control here overrides the height explicitly.
const NUM = `${CTL} font-mono font-bold text-right px-2`;

export default function Pharmacy() {
  const { hospitalMode, config, user, can } = useAuth();

  const [cart, setCart] = useState([]);
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState(null);
  // The previous receipt, so "Reprint last" is one click. Client-side only:
  // there is no "last bill for this user" route and a restyle is not the place
  // to invent one.
  const [lastReceipt, setLastReceipt] = useState(null);
  const [method, setMethod] = useState('cash');
  const [allowPartial, setAllowPartial] = useState(false);
  const [discount, setDiscount] = useState('');
  const [tendered, setTendered] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [busy, setBusy] = useState(false);

  // Hospital-mode only state.
  const [patient, setPatient] = useState(null);
  const [patientQ, setPatientQ] = useState('');
  const [prescriptions, setPrescriptions] = useState([]);
  const [allowance, setAllowance] = useState(null);

  // Prescription / collector details for Schedule G and narcotic lines.
  const [rx, setRx] = useState({
    prescription_ref: '', prescriber_name: '', prescriber_reg_no: '',
    buyer_name: '', buyer_cnic: '', buyer_contact: '',
  });
  const setRxField = (k) => (e) => setRx((r) => ({ ...r, [k]: e.target.value }));

  const searchRef = useRef(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  const [confirm, confirmDialog] = useConfirm();
  useEffect(() => {
    const back = () => { setErr((e) => (e === OFFLINE_MESSAGE ? '' : e)); loadHeld(); };
    window.addEventListener('hwt:online', back);
    return () => window.removeEventListener('hwt:online', back);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // One key per sale attempt (QA S3-15): a retry after a slow LAN answer
  // carries the same key and gets the bill already made, not a second one.
  const newKey = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const idemKey = useRef(newKey());

  // The line F3 acts on. Scanning an item makes it active, so the common case
  // — scan, then correct the quantity — never needs the mouse. Clicking any
  // row re-targets it.
  const [activeLine, setActiveLine] = useState(null);
  const qtyRefs = useRef({});

  // --- Parked sales -------------------------------------------------------
  // Four or five customers stand at the counter at once. Each parked basket is
  // stored on the SERVER, not here: a shift runs eight hours and on this site a
  // reload is what happens when the lights go out.
  const [held, setHeld] = useState([]);
  const [holdBusy, setHoldBusy] = useState(false);

  // --- Charge to a department ---------------------------------------------
  // The lab's runner arrives at the counter with a slip. The pharmacist is
  // already here, already scanning — making them leave the till for another
  // screen is friction with no purpose. Switching the payer turns the same cart
  // into a department invoice: priced at the department's basis, billed to them
  // on credit, and stamped with their cost centre so it never touches counter
  // margin or the cash drawer.
  // The customer's live welfare card, resolved when they are identified. Shown
  // at the counter so the pharmacist can explain the price to the person in
  // front of them rather than reading a number they cannot account for.
  const [card, setCard] = useState(null);
  const [ignoreCard, setIgnoreCard] = useState(false);

  // The customer's credit account. Shown before credit is agreed, because "how
  // much does he already owe" is the question a pharmacist has to answer before
  // saying yes — and the paper register could never answer it quickly.
  const [creditAccount, setCreditAccount] = useState(null);
  const [acceptOverLimit, setAcceptOverLimit] = useState(false);
  // Opening limit for an account that does not exist yet.
  const [newLimit, setNewLimit] = useState('');

  const [depts, setDepts] = useState([]);
  const [deptId, setDeptId] = useState('');
  const [deptPatient, setDeptPatient] = useState(BLANK_DEPT);
  useEffect(() => { api.get('/departments').then(setDepts).catch(() => {}); }, []);

  // Arriving from "Issue to a department": the department and the runner were
  // captured there, so the pharmacist lands on the till ready to scan.
  const location = useLocation();
  useEffect(() => {
    const c = location.state?.chargeTo;
    if (!c) return;
    // Pull the id OUT rather than blanking it: `department_id: undefined` still
    // creates the key, and spreading that over the payload below silently
    // deleted the department on its way to the server.
    const { department_id: handedDeptId, ...who } = c;
    setDeptId(String(handedDeptId));
    setDeptPatient({ ...BLANK_DEPT, ...who });
    window.history.replaceState({}, '');
  }, [location.state]);
  const dept = depts.find((d) => String(d.id) === String(deptId)) || null;

  const loadHeld = useCallback(async () => {
    try { setHeld(await api.get('/pharmacy/held')); } catch { /* the counter still works */ }
  }, []);
  useEffect(() => { loadHeld(); }, [loadHeld]);

  // Everything that makes up "this customer", so resuming puts the counter back
  // exactly as it was — not just the line items.
  const snapshot = useCallback(() => ({
    cart, discount, method, allowPartial, customerName, customerPhone, rx, deptId, deptPatient,
    patient: patient ? { id: patient.id, patient_code: patient.patient_code, full_name: patient.full_name, category: patient.category } : null,
  }), [cart, discount, method, allowPartial, customerName, customerPhone, rx, patient, deptId, deptPatient]);

  useEffect(() => {
    setIgnoreCard(false);
    if (!patient?.id) { setCard(null); return; }
    api.get(`/cards/customer/${patient.id}`)
      .then((cs) => setCard(cs.find((c) => c.status === 'active') || null))
      .catch(() => setCard(null));
    api.get(`/ledger/accounts?q=${encodeURIComponent(patient.contact || patient.full_name)}`)
      .then((as) => setCreditAccount(as.find((a) => a.customer_id === patient.id) || null))
      .catch(() => setCreditAccount(null));
    setAcceptOverLimit(false);
    setNewLimit('');
  }, [patient?.id]);

  const restore = useCallback((snap) => {
    if (!snap) return;
    setCart(snap.cart || []);
    setDiscount(snap.discount || '');
    setMethod(snap.method || 'cash');
    setAllowPartial(!!snap.allowPartial);
    setCustomerName(snap.customerName || '');
    setCustomerPhone(snap.customerPhone || '');
    setRx(snap.rx || { prescription_ref: '', prescriber_name: '', prescriber_reg_no: '', buyer_name: '', buyer_cnic: '', buyer_contact: '' });
    setPatient(snap.patient || null);
    setDeptId(snap.deptId || '');
    setDeptPatient(snap.deptPatient || BLANK_DEPT);
    setPrescriptions([]); setAllowance(null);
    setActiveLine(null); qtyRefs.current = {};
    setTendered('');
    setErr('');
  }, []);

  // Derived FROM the snapshot, not from state, so the label can never describe a
  // different customer than the basket it is filed under. Reading state here
  // instead would only stay correct while snapshot() happens to depend on the
  // same fields — a coupling nothing enforces.
  const labelFor = (snap) => {
    if (snap.deptId) {
      const d = depts.find((x) => String(x.id) === String(snap.deptId));
      return `${d ? d.name : 'Department'}${snap.deptPatient?.patient_name ? ` · ${snap.deptPatient.patient_name}` : ''}`.slice(0, 24);
    }
    const who = (snap.patient?.full_name || snap.customerName || snap.customerPhone || '').trim();
    const first = snap.cart?.[0]?.name;
    const more = (snap.cart?.length || 0) > 1 ? `+${snap.cart.length - 1}` : null;
    const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    // "Bashir · 12:35" or "Panadol +2 · 12:35" — never "Customer 1" (UI report 4.2).
    return [who || first || 'Walk-in', !who && more ? more : null, at].filter(Boolean).join(' · ').slice(0, 32);
  };

  // Park the counter and start fresh for the next customer.
  const parkSale = useCallback(async () => {
    if (!cart.length || holdBusy) return;
    setHoldBusy(true);
    try {
      const snap = snapshot();
      await api.post('/pharmacy/held', { label: labelFor(snap), cart: snap });
      clearSale();
      await loadHeld();
    } catch (e) { setErr(e.message); } finally { setHoldBusy(false); }
  }, [cart, holdBusy, snapshot, loadHeld]);

  // Bring a parked customer back. If someone is already at the counter they are
  // parked in the SAME request — two calls would trip the cap on the way past
  // and could leave a basket in neither place.
  const resumeHeld = useCallback(async (h) => {
    if (holdBusy) return;
    setHoldBusy(true);
    try {
      if (cart.length) {
        const snap = snapshot();
        await api.post('/pharmacy/held', { label: labelFor(snap), cart: snap, replace_id: h.id });
      } else {
        await api.del(`/pharmacy/held/${h.id}`);
      }
      restore(h.cart);
      await loadHeld();
      focusSearch();
    } catch (e) { setErr(e.message); } finally { setHoldBusy(false); }
  }, [cart, holdBusy, snapshot, restore, loadHeld, focusSearch]);

  const discardHeld = useCallback(async (h) => {
    if (holdBusy) return;
    if (!(await confirm({ title: 'Discard parked sale?', body: `The basket parked for ${h.label || 'this customer'} will be thrown away.`, confirmLabel: 'Discard', tone: 'danger' }))) return;
    setHoldBusy(true);
    try { await api.del(`/pharmacy/held/${h.id}`); await loadHeld(); }
    catch (e) { setErr(e.message); } finally { setHoldBusy(false); }
  }, [holdBusy, loadHeld, confirm]);

  // --- Cart ---------------------------------------------------------------
  const addToCart = useCallback((product, qty = 1) => {
    setErr('');
    if (product.sellable != null && product.sellable <= 0) {
      setErr(`${product.name} has no sellable stock.`);
      return;
    }
    const perStrip = Number(product.units_per_strip) > 0 ? Number(product.units_per_strip) : 1;
    const perBox = Number(product.units_per_box) > 0 ? Number(product.units_per_box) : perStrip;
    setCart((c) => {
      const found = c.find((i) => i.product_id === product.id);
      if (found) {
        return c.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + qty } : i));
      }
      return [...c, {
        product_id: product.id,
        name: product.name,
        strength: product.strength,
        generic_name: product.generic_name,
        unit_price: product.sale_price,   // always per base unit
        quantity: qty,                    // in the line's uom
        // The smallest unit the medicine may be sold in (UI report 1.3): a
        // distracted cashier must not sell ten tablets to someone who asked
        // for one. A strip only when the product may not be broken.
        uom: perStrip > 1 && !product.allow_loose ? 'strip' : 'unit',
        stock: product.sellable != null ? product.sellable : product.on_hand,
        stock_label: product.stock_label,
        // The batch is FEFO's decision at the moment of sale, not the cart's.
        // The soonest expiry on the shelf is what the counter CAN know now, and
        // it is what the pharmacist glances at before handing over.
        next_expiry: product.next_expiry || null,
        mrp: product.mrp,
        drug_schedule: product.drug_schedule || 'OTC',
        unit_name: product.unit || 'unit',
        units_per_strip: perStrip,
        units_per_box: perBox,
        allow_loose: product.allow_loose == null ? 1 : product.allow_loose,
      }];
    });
    setActiveLine(product.id);
  }, []);

  // Base units a line resolves to, and the multiplier for its chosen uom.
  const unitsIn = (i, uom = i.uom) =>
    uom === 'box' ? i.units_per_box : uom === 'strip' ? i.units_per_strip : 1;
  const baseQty = (i) => i.quantity * unitsIn(i);
  const lineTotal = (i) => round2(i.unit_price * baseQty(i));
  const setUom = (pid, uom) => setCart((c) => c.map((i) => (i.product_id === pid ? { ...i, uom } : i)));

  const setQty = (pid, q) => setCart((c) => c.map((i) => (i.product_id === pid ? { ...i, quantity: Math.max(1, q) } : i)));
  // The rate box edits the price of whatever unit the line is set to. Typing a
  // strip price stores the per-unit price behind it, at four decimals so that
  // odd strip sizes (Rs 84 for 14 caps) round-trip exactly.
  const setRate = (pid, v) => setCart((c) => c.map((i) => {
    if (i.product_id !== pid) return i;
    const per = unitsIn(i);
    return { ...i, unit_price: Math.max(0, round4(Number(v || 0) / per)) };
  }));
  const removeItem = (pid) => {
    setCart((c) => c.filter((i) => i.product_id !== pid));
    delete qtyRefs.current[pid];
    // Drop the target with the line, so F3 never focuses a removed row.
    setActiveLine((a) => (a === pid ? null : a));
  };
  const [resetToken, setResetToken] = useState(0);
  const clearSale = () => {
    setResetToken((n) => n + 1); setWantCustomer(false);
    setCart([]); setDiscount(''); setTendered(''); setCustomerName(''); setCustomerPhone('');
    setRx({ prescription_ref: '', prescriber_name: '', prescriber_reg_no: '', buyer_name: '', buyer_cnic: '', buyer_contact: '' });
    setPatient(null); setPatientQ(''); setPrescriptions([]); setAllowance(null); setErr('');
    setDeptId(''); setDeptPatient(BLANK_DEPT);
    setActiveLine(null); qtyRefs.current = {};
    idemKey.current = newKey();
    focusSearch();
  };

  // F3 — jump to the quantity of the active line and select it, so the next
  // keystroke replaces the number rather than appending to it. Falls back to
  // the last line added when nothing is explicitly selected.
  const editQty = useCallback(() => {
    if (!cart.length) return;
    const target = cart.some((i) => i.product_id === activeLine)
      ? activeLine
      : cart[cart.length - 1].product_id;
    const el = qtyRefs.current[target];
    if (!el) return;
    setActiveLine(target);
    el.focus();
    el.select();
  }, [cart, activeLine]);

  // --- Totals -------------------------------------------------------------
  // The subtotal is local because it must move the instant a quantity changes.
  // Everything below it — welfare card, category, subsidy — comes from the
  // SERVER, quoted by the same engine that will charge the sale.
  //
  // The previous version worked the discount out here, with 20% and 50% written
  // into the component. It knew nothing about welfare cards, and it would have
  // drifted from the real price the first time a rate changed in settings.
  const category = patient?.category || 'Paid';
  const gross = round2(cart.reduce((s, i) => s + lineTotal(i), 0));
  const units = cart.reduce((s, i) => s + baseQty(i), 0);

  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  useEffect(() => {
    if (!cart.length || deptId) { setQuote(null); return undefined; }
    const id = setTimeout(() => {
      api.post('/pharmacy/quote', {
        patient_id: patient?.id || null,
        category,
        ignore_card: ignoreCard || undefined,
        items: cart.map((i) => ({
          product_id: i.product_id, quantity: i.quantity, uom: i.uom, unit_price: i.unit_price,
        })),
      })
        .then((q) => { setQuote(q); setQuoteError(''); })
        .catch((e) => {
          setQuote(null);
          // Only worth shouting about when someone is actually entitled to
          // something. A walk-in has nothing to lose by the quote failing.
          setQuoteError(patient
            ? `Could not check ${patient.full_name}'s entitlement — ${e.message}`
            : '');
        });
    }, 150);
    return () => clearTimeout(id);
  }, [cart, patient?.id, category, ignoreCard, deptId, patient]);

  // Relief the customer is ENTITLED to, before any goodwill the pharmacist adds.
  const relief = round2((quote?.discount || 0) + (quote?.subsidy || 0));
  const manual = Math.min(Number(discount || 0), Math.max(0, gross - relief));
  const net = Math.max(0, round2(gross - relief - manual));
  const change = Number(tendered || 0) - net;

  const discountCap = gross * Number(config.counter_discount_pct ?? 0.1);
  const overDiscountCap = manual > discountCap + 0.001;

  // --- Legal gates --------------------------------------------------------
  const rxLines = cart.filter((i) => RX_SCHEDULES.includes(i.drug_schedule));
  const controlledLines = cart.filter((i) => REGISTERED_SCHEDULES.includes(i.drug_schedule));
  const narcoticLines = cart.filter((i) => i.drug_schedule === 'Narcotic');
  const overMrpLines = cart.filter((i) => i.mrp > 0 && i.unit_price > i.mrp);
  const overStockLines = cart.filter((i) => i.stock != null && baseQty(i) > i.stock);

  const needsRxRef = rxLines.length > 0 && !patient && !rx.prescription_ref.trim();
  const needsPrescriber = controlledLines.length > 0 && (!rx.prescriber_name.trim() || !rx.prescription_ref.trim());
  const needsCnic = narcoticLines.length > 0 && !rx.buyer_cnic.trim();
  const shortTendered = method === 'cash' && tendered !== '' && change < 0;
  // The slip prints the tender and the change, so the tender has to be entered
  // (QA S3-21) — the server refuses a cash sale without it.
  const noTender = method === 'cash' && !deptId && cart.length > 0 && tendered === '';
  // A strip that may not be broken can still be sold loose in exact multiples.
  const looseViolations = cart.filter(
    (i) => i.uom === 'unit' && !i.allow_loose && i.units_per_strip > 1 && i.quantity % i.units_per_strip !== 0
  );

  const blockReason = deptId && !deptPatient.collected_by_name.trim()
    ? 'Name the person collecting the medicine before issuing to a department.'
    : needsRxRef ? 'Prescription reference required for prescription-only medicine.'
    : needsPrescriber ? "Prescriber's name and prescription reference are required for the register."
    : needsCnic ? 'CNIC of the person collecting the controlled drug is required.'
    : overMrpLines.length ? 'A line is priced above its maximum retail price.'
    : overDiscountCap ? `Discount above Rs ${Math.floor(discountCap)} needs an authorised override.`
    : shortTendered ? 'Amount received is less than the net payable.'
    : noTender ? 'Enter the cash received (F4) — the slip prints the tender and the change.'
    : looseViolations.length ? `${looseViolations[0].name} is not sold loose — supply full strips of ${looseViolations[0].units_per_strip}.`
    : (overStockLines.length && !allowPartial) ? 'A line exceeds available stock — tick partial dispensing or reduce the quantity.'
    : '';
  const blocked = !!blockReason;

  // --- Checkout -----------------------------------------------------------
  const checkout = useCallback(async () => {
    setErr('');
    if (!cart.length || blocked || busy) return;
    setBusy(true);
    try {
      // Charging a department is a different document, not a payment method:
      // priced at their basis, billed on credit, stamped with their cost centre.
      // It goes through the departments route so there is exactly one
      // implementation of that — the counter does not re-derive it.
      if (deptId) {
        const r = await api.post('/departments/requests', {
          ...deptPatient,
          department_id: Number(deptId),
          auto_dispense: true,
          allow_partial: allowPartial,
          items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, uom: i.uom })),
        });
        const rc = {
          ...r.bill,
          department: dept?.name,
          collected_by: deptPatient.collected_by_name,
          for_patient: deptPatient.patient_name,
          slip_ref: deptPatient.slip_ref,
          shortfalls: r.shortfalls,
        };
        setReceipt(rc); setLastReceipt(rc);
        clearSale();
        loadHeld();
        return;
      }
      const bill = await api.post('/pharmacy/sale', {
        patient_id: patient?.id || null,
        customer_name: patient ? null : (customerName.trim() || 'Walk-in customer'),
        category,
        payment_method: method,
        allow_partial: allowPartial,
        manual_discount: manual > 0 ? manual : undefined,
        ignore_card: ignoreCard || undefined,
        accept_over_limit: acceptOverLimit || undefined,
        // Only meaningful when the account is being opened by this sale.
        credit_limit: method === 'credit' && !creditAccount && newLimit !== ''
          ? Number(newLimit) : undefined,
        ...rx,
        buyer_contact: rx.buyer_contact || customerPhone || undefined,
        tendered: method === 'cash' ? Number(tendered) : undefined,
        idempotency_key: idemKey.current,
        items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, uom: i.uom, unit_price: i.unit_price })),
      });
      // The slip prints what the SERVER recorded: the tender entered and the
      // change it computed, never a figure assumed at the counter.
      const rc = { ...bill, change: bill.change_given };
      setReceipt(rc); setLastReceipt(rc);
      setCart([]); setPrescriptions([]); setDiscount(''); setTendered('');
      setActiveLine(null); qtyRefs.current = {};
      idemKey.current = newKey();
      setRx({ prescription_ref: '', prescriber_name: '', prescriber_reg_no: '', buyer_name: '', buyer_cnic: '', buyer_contact: '' });
      loadHeld();
    } catch (e) {
      // An expired card must not be a dead end — the customer still needs their
      // medicine. Offer the full-price route rather than leaving the pharmacist
      // with an error and no way past it.
      if (e.data?.code === 'OVER_CREDIT_LIMIT') {
        setErr(`${e.message} Tick "allow over the limit" to give the credit anyway.`);
        setAcceptOverLimit(false);
      } else if (e.data?.code === 'CREDIT_ACCOUNT_REQUIRED') {
        setErr('Credit needs a customer. Find them in the box above, or add them.');
      } else if (e.data?.code === 'CARD_EXPIRED') {
        setErr(`${e.message} Tick "ignore the card" to continue at full price.`);
        setIgnoreCard(false);
      } else if (e.data?.code === 'TILL_NOT_OPEN') {
        setErr('No till is open for you. Open one in Cash Flow (Alt+7) before taking cash — or take this payment by card.');
      } else if (e.data?.code === 'TENDER_REQUIRED' || e.data?.code === 'TENDER_SHORT') {
        setErr(e.message); document.getElementById('tendered-input')?.focus();
      } else setErr(e.message);
    } finally { setBusy(false); }
  }, [cart, blocked, busy, patient, customerName, customerPhone, category, method, allowPartial, manual, rx, tendered, change, loadHeld, deptId, deptPatient, dept, ignoreCard, acceptOverLimit, creditAccount, newLimit]);

  // --- Keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); focusSearch(); }
      else if (e.key === 'F3') { e.preventDefault(); editQty(); }
      else if (e.key === 'F9') { e.preventDefault(); checkout(); }
      else if (e.key === 'F4') { e.preventDefault(); document.getElementById('tendered-input')?.focus(); }
      // F6 parks the customer at the counter; F5 brings the next one back.
      // F5 is the browser's reload key, so preventDefault matters more here than
      // anywhere else on the page — a stray reload mid-sale is exactly what the
      // parked-cart feature exists to survive.
      else if (e.key === 'F6') { e.preventDefault(); parkSale(); }
      else if (e.key === 'F5') { e.preventDefault(); if (held.length) resumeHeld(held[0]); }
      else if (e.key === 'Escape' && !receipt) { e.preventDefault(); clearSale(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (!receipt) focusSearch(); }, [receipt, focusSearch]);

  // --- Hospital-mode patient lookup ---------------------------------------
  async function findPatient(e) {
    e.preventDefault();
    setErr('');
    try {
      const rows = await api.get(`/patients?q=${encodeURIComponent(patientQ)}`);
      if (!rows.length) { setErr('No patient found.'); return; }
      const p = rows[0];
      setPatient(p);
      setCustomerName('');
      const list = await api.get(`/pharmacy/prescriptions/${p.id}`).catch(() => []);
      setPrescriptions(list.filter((r) => !r.dispensed));
      setAllowance(p.category === 'Staff' ? await api.get(`/billing/staff-allowance/${p.id}`).catch(() => null) : null);
    } catch (e) { setErr(e.message); }
  }

  function addPrescription(r) {
    if (!r.product_id) { setErr(`${r.medicine_name} is not linked to a stock product; add it manually.`); return; }
    addToCart({
      id: r.product_id, name: r.medicine_name, sale_price: r.sale_price || 0,
      sellable: r.on_hand, mrp: r.mrp, drug_schedule: r.drug_schedule, strength: r.strength,
    }, 1);
  }

  // The billing mode is DERIVED from what is already known, not a fourth piece
  // of state to keep in step: a department chosen is a requisition; a customer
  // identified is a customer; otherwise it is a walk-in. The tabs the design
  // shows are a way of reading that, and a way of switching it.
  // Mode 1 can be CHOSEN before a customer is attached (QA3 M3): the pill
  // lights, the customer box takes focus, and the prompt stays until a card
  // or mobile is entered or another mode is picked.
  const [wantCustomer, setWantCustomer] = useState(false);
  const mode = deptId ? 'dept' : (patient || wantCustomer) ? 'customer' : 'walkin';
  const customerRef = useRef(null);

  if (receipt) {
    return (
      <Receipt bill={receipt} config={config} user={user}
        onClose={() => { setReceipt(null); clearSale(); }} />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <Alert type="error" onClose={() => setErr('')}>{err}</Alert>

      {/* ---------------- Toolbar: one search box, the keys beside it ------ */}
      {confirmDialog}
      <div className="bg-white rounded-md border border-slate-300 p-3 shadow-xs shrink-0 sticky top-0 z-20">
        {/* The scan field is the control the whole product runs on (UI report
            1.1): it takes the width, the key row wraps beneath it when the
            screen is short of room, never the other way round. */}
        <div className="flex flex-wrap items-center gap-3">
          <ProductSearch inputRef={searchRef} onPick={addToCart} onError={setErr} />
          <div className="flex items-center flex-wrap gap-1.5">
            <button type="button" className={BTN} onClick={focusSearch}><Kbd>F2</Kbd> Search</button>
            <button type="button" className={BTN} onClick={editQty} disabled={!cart.length}><Kbd>F3</Kbd> Edit Qty</button>
            <button type="button" className={BTN} disabled={!!dept || method !== 'cash'}
              onClick={() => document.getElementById('tendered-input')?.focus()}><Kbd>F4</Kbd> Tender</button>
            <button type="button" className={BTN} onClick={parkSale} disabled={!cart.length || holdBusy}>
              <Kbd>F6</Kbd> Hold{held.length ? ` (${held.length})` : ''}
            </button>
            <button type="button" className={BTN} disabled={!held.length || holdBusy}
              onClick={() => held.length && resumeHeld(held[0])}><Kbd>F5</Kbd> Resume</button>
            <button type="button" className={BTN_DARK} onClick={checkout} disabled={!cart.length || blocked || busy}>
              <Kbd className="!bg-slate-700 !border-slate-600 !text-white">F9</Kbd> {dept ? 'Issue' : 'Pay'}
            </button>
            <button type="button" className={`${BTN} !bg-white`} onClick={clearSale} disabled={!cart.length && !patient && !deptId}>
              <Kbd>Esc</Kbd> Clear
            </button>
          </div>
        </div>
      </div>

      {/* Customers waiting. The design shows only a count on the Hold key; the
          tab strip is kept because "which one is Bashir's?" is answered by the
          amount, and four people at a counter is the normal case here. */}
      <HeldBar held={held} busy={holdBusy} hasCart={cart.length > 0}
        label={labelFor(snapshot())} onResume={resumeHeld} onDiscard={discardHeld} />

      <div className="flex-1 grid grid-cols-12 gap-3 min-h-0">
        {/* ---------------- Left: who, then what -------------------------- */}
        <section className="col-span-12 xl:col-span-9 flex flex-col gap-3 min-h-0">

          {/* Billing mode + the customer context, in one card as the design has it. */}
          <div className="bg-white rounded-md border border-slate-300 shadow-xs shrink-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-300 bg-slate-100 px-3 py-2 gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mr-1">Billing mode:</span>
                <ModeTab on={mode === 'customer'} n="1" label="Customer / Welfare card"
                  onClick={() => { setDeptId(''); setDeptPatient(BLANK_DEPT); setWantCustomer(true); setTimeout(() => customerRef.current?.focus(), 0); }} />
                <ModeTab on={mode === 'walkin'} n="2" label="Walk-in"
                  onClick={() => { setDeptId(''); setDeptPatient(BLANK_DEPT); setWantCustomer(false); setPatient(null); setPrescriptions([]); setAllowance(null); }} />

                {depts.length > 0 && (
                  <ModeTab on={mode === 'dept'} n="3" label="Department requisition"
                    onClick={() => { if (!deptId) setDeptId(String(depts[0].id)); }} />
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-mono">
                  Slip: <strong className="text-slate-800 font-semibold">
                    {mode === 'dept' ? 'Department issue note'
                      : card && !card.is_expired ? `${card.tier_name} dispense`
                        : mode === 'customer' ? 'Retail — registered customer' : 'Retail — walk-in'}
                  </strong>
                </span>
                {quote?.card && !card?.is_expired && (
                  <span className="text-emerald-800 font-medium bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded text-[10px]">
                    Entitlement quoted
                  </span>
                )}
              </div>
            {wantCustomer && !patient && !deptId && (
              <div className="px-3 py-1.5 bg-sky-50 border-b border-sky-200 text-[11px] text-sky-900">
                Scan the welfare card, or type a mobile number or name in the Customer box below, then Enter. <button type="button" className="underline font-semibold" onClick={() => setWantCustomer(false)}>It is a walk-in after all</button>
              </div>
            )}
            </div>

            <div className="p-3">
              {hospitalMode ? (
                <>
                  <form className="flex gap-2" onSubmit={findPatient}>
                    <input className={`${CTL} flex-1 px-3`} placeholder="Patient ID, name or contact…" aria-label="Find customer by ID, name or contact"
                      value={patientQ} onChange={(e) => setPatientQ(e.target.value)} />
                    <button className={BTN}>Find</button>
                    <button type="button" className={`${BTN} !bg-white`}
                      onClick={() => { setPatient(null); setPrescriptions([]); setAllowance(null); }}>Walk-in</button>
                  </form>
                  {patient ? (
                    <>
                      <div className="mt-2 text-xs">{patient.full_name} · <span className="font-mono">{patient.patient_code}</span> <CategoryBadge category={patient.category} /></div>
                      {allowance && <div className="mt-1 text-xs text-slate-600">Staff allowance: <b>{money(allowance.remaining)}</b> of {money(allowance.cap)} remaining this year.</div>}
                      <button type="button" className={`${BTN} mt-2`} onClick={() => printHandover(patient.id)}>Print patient + reports (handover)</button>
                    </>
                  ) : (
                    <div className="mt-2">
                      <label className={LABEL} htmlFor="walkin-name">Walk-in customer name (optional)</label>
                      <input id="walkin-name" className={`${CTL} w-full px-3`} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                    </div>
                  )}
                  {prescriptions.length > 0 && (
                    <div className="mt-2">
                      <label className={LABEL}>Pending prescriptions — click to add</label>
                      {prescriptions.map((r) => (
                        <div key={r.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 text-xs">
                          <div>{r.medicine_name} <span className="text-slate-500">{[r.dosage, r.frequency].filter(Boolean).join(' · ')}</span>
                            {r.product_id != null && <span className="text-slate-500"> · stock {r.on_hand}</span>}</div>
                          <button type="button" className={BTN} onClick={() => addPrescription(r)}>Add</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                mode !== 'dept' && <CustomerBar
                  resetToken={resetToken}
                  seeking={wantCustomer && !patient}
                  inputRef={customerRef}
                  patient={patient}
                  setPatient={setPatient}
                  card={card}
                  creditAccount={creditAccount}
                  customerName={customerName}
                  setCustomerName={setCustomerName}
                  customerPhone={customerPhone}
                  setCustomerPhone={setCustomerPhone}
                  disabled={!!deptId}
                  onErr={setErr}
                />
              )}

              {card?.is_expired && !deptId && (
                <div className="mt-2 flex items-center justify-between gap-3 bg-rose-50 border border-rose-200 rounded px-3 py-2 text-xs text-rose-900">
                  <div><b className="font-mono">{card.card_no}</b> expired on {card.valid_till}. No discount applies.</div>
                  <label className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                    <input type="checkbox" checked={ignoreCard} onChange={(e) => setIgnoreCard(e.target.checked)} />
                    ignore the card
                  </label>
                </div>
              )}

              {creditAccount && !deptId && method === 'credit' && (
                <div className={`mt-2 flex items-center justify-between gap-3 rounded px-3 py-2 text-xs border ${
                  creditAccount.credit_limit != null && creditAccount.balance > creditAccount.credit_limit
                    ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                  <div>
                    <b>Credit account</b> — owes <span className="font-mono">{money(creditAccount.balance)}</span>
                    {creditAccount.credit_limit != null && <> of a <span className="font-mono">{money(creditAccount.credit_limit)}</span> limit</>}
                  </div>
                  {creditAccount.credit_limit != null && (
                    <label className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                      <input type="checkbox" checked={acceptOverLimit} onChange={(e) => setAcceptOverLimit(e.target.checked)} />
                      allow over the limit
                    </label>
                  )}
                </div>
              )}

              {/* A customer with no account yet used to get NO panel at all: the
                  pharmacist picked "Credit", saw nothing, and found out an account
                  had been opened only when the receipt printed. Extending credit to
                  someone for the first time is the moment that most deserves a
                  confirmation, so it gets one — and the opening limit can be set
                  here, while the person is still standing at the counter. */}
              {patient && !creditAccount && !deptId && method === 'credit' && (
                <div className="mt-2 bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs text-slate-700">
                  <b>First time on credit.</b> An account will be opened for {patient.full_name}
                  {patient.contact ? ` (${patient.contact})` : ' — no mobile on file, so this account will be hard to chase'}.
                  <div className="flex items-end gap-3 mt-2">
                    <div>
                      <label className={LABEL}>Credit limit (optional)</label>
                      <input aria-label="Credit limit (optional)" type="number" min="0" className={`${NUM} w-36`} value={newLimit}
                        placeholder="no limit" onChange={(e) => setNewLimit(e.target.value)} />
                    </div>
                    <div className="text-[11px] text-slate-500 pb-2">Leave blank for no limit. It can be changed later in Credit Accounts.</div>
                  </div>
                </div>
              )}

              {mode === 'dept' && (
                <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <label className={LABEL}>Department</label>
                    <select aria-label="Department" className={`${CTL} w-full px-2`} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                      {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={`${LABEL} ${!deptPatient.collected_by_name.trim() ? 'text-rose-800' : ''}`}>Collected by * {!deptPatient.collected_by_name.trim() && <span className="normal-case font-normal tracking-normal">— required before issuing</span>}</label>
                    <input className={`${CTL} w-full px-2 ${!deptPatient.collected_by_name.trim() ? '!border-rose-400 bg-rose-50/40' : ''}`} value={deptPatient.collected_by_name} required aria-required="true"
                      onChange={(e) => setDeptPatient({ ...deptPatient, collected_by_name: e.target.value })}
                      placeholder="Who is taking it" />
                  </div>
                  <div>
                    <label className={LABEL}>Their mobile</label>
                    <input aria-label="Their mobile" className={`${CTL} w-full px-2 font-mono`} value={deptPatient.collected_by_contact}
                      onChange={(e) => setDeptPatient({ ...deptPatient, collected_by_contact: e.target.value })}
                      placeholder="03xx-xxxxxxx" />
                  </div>
                  <div>
                    <label className={LABEL}>Patient / ward / bed</label>
                    <input aria-label="Patient / ward / bed" className={`${CTL} w-full px-2`} value={deptPatient.patient_name}
                      onChange={(e) => setDeptPatient({ ...deptPatient, patient_name: e.target.value })}
                      placeholder="Optional" />
                  </div>
                  <div>
                    <label className={LABEL}>Slip serial</label>
                    <input aria-label="Slip serial" className={`${CTL} w-full px-2 font-mono`} value={deptPatient.slip_ref}
                      onChange={(e) => setDeptPatient({ ...deptPatient, slip_ref: e.target.value })} />
                  </div>
                  {dept && (
                    <div className="col-span-2 md:col-span-5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                      Billed to <b>{dept.name}</b> on account at{' '}
                      {dept.invoice_basis === 'cost' ? 'cost price'
                        : dept.invoice_basis === 'mrp' ? 'retail price'
                          : `cost plus ${Math.round(dept.markup_pct * 100)}%`}.
                      No money is taken now and the drawer is not touched — the amount goes on the
                      department&apos;s account and appears in hospital expense.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* The cart. Scrolls inside its own card so the toolbar above and the
              rail beside it never move — a fourteen-line basket must not push
              the F9 button off the screen. */}
          <div className="flex-1 bg-white rounded-md border border-slate-300 shadow-xs flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-2 bg-slate-100 border-b border-slate-300 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-tight">Active dispense items</span>
                <span className="text-xs font-mono font-semibold text-slate-600 bg-white border border-slate-300 px-2 py-0.5 rounded">
                  {cart.length} line{cart.length === 1 ? '' : 's'} · {units} unit{units === 1 ? '' : 's'}
                </span>
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={clearSale}
                  className="text-slate-600 hover:text-rose-700 inline-flex items-center gap-1 text-xs font-medium">
                  Clear basket <Kbd>Esc</Kbd>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full table-fixed text-left text-xs border-collapse">
                <colgroup>
                  <col className="w-8" /><col /><col className="w-24" /><col className="w-20" /><col className="w-64" /><col className="w-32" /><col className="w-24" /><col className="w-8" />
                </colgroup>
                <thead className="bg-slate-50 text-slate-700 uppercase tracking-wider font-semibold text-[11px] border-b border-slate-200 sticky top-0 z-10 select-none">
                  <tr>
                    <th className="py-2 pl-3 pr-1 text-center">#</th>
                    <th className="py-2 px-2.5">Medicine &amp; formulation</th>
                    <th className="py-2 px-2.5 whitespace-nowrap">Expiry</th>
                    <th className="py-2 px-2.5 text-center whitespace-nowrap">On shelf</th>
                    <th className="py-2 px-2.5 text-center">Dispense qty</th>
                    <th className="py-2 px-2.5 text-right">Rate</th>
                    <th className="py-2 px-2.5 text-right font-bold">Line total</th>
                    <th className="py-2 pr-3 pl-1 text-center"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {cart.map((i, n) => {
                    const warn = baseQty(i) > i.stock
                      || (i.mrp > 0 && i.unit_price > i.mrp)
                      || (i.uom === 'unit' && !i.allow_loose && i.units_per_strip > 1 && i.quantity % i.units_per_strip !== 0);
                    return (
                      <tr key={i.product_id}
                        className={`transition-colors cursor-default ${i.product_id === activeLine ? 'bg-sky-50 shadow-[inset_3px_0_0_#0369a1]' : 'hover:bg-slate-50'} ${warn ? 'bg-rose-50/40' : ''}`}
                        onClick={() => setActiveLine(i.product_id)}>
                        <td className="py-2 pl-3 pr-1 text-center font-mono text-slate-500 font-semibold text-[11px]">
                          {String(n + 1).padStart(2, '0')}
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5 flex-wrap">
                            <span>{i.name}{strengthOf(i) ? <span className="text-slate-500 font-normal"> {strengthOf(i)}</span> : null}</span>
                            {i.drug_schedule === 'Narcotic' && <Tag tone="red">Controlled</Tag>}
                            {i.drug_schedule === 'G' && <Tag tone="amber">Sch. G</Tag>}
                            {i.drug_schedule === 'Rx' && <Tag tone="blue">Rx</Tag>}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={[i.generic_name, i.units_per_strip > 1 ? `${i.units_per_strip}/strip` : null, i.units_per_box > i.units_per_strip ? `${i.units_per_box}/box` : null].filter(Boolean).join(' · ')}>
                            {[i.generic_name, i.units_per_strip > 1 ? `${i.units_per_strip}/strip` : null].filter(Boolean).join(' · ')}
                          </div>
                          {warn && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {baseQty(i) > i.stock && <Tag tone="red">exceeds stock</Tag>}
                              {i.mrp > 0 && i.unit_price > i.mrp && <Tag tone="red">above MRP</Tag>}
                              {i.uom === 'unit' && !i.allow_loose && i.units_per_strip > 1 && i.quantity % i.units_per_strip !== 0 && (
                                <Tag tone="red">full strips of {i.units_per_strip} only</Tag>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap font-mono text-[11px]">
                          {i.next_expiry
                            ? <span className={expiryTone(i.next_expiry)}>{i.next_expiry}</span>
                            : <span className="text-slate-400">FEFO at issue</span>}
                        </td>
                        <td className="py-2 px-2.5 text-center whitespace-nowrap font-mono text-slate-700" title={shelfLabel(i, i.stock)}>
                          {i.stock} <span className="font-sans text-slate-500">{i.unit_name}</span>
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" className="w-6 h-6 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-slate-700 font-bold flex items-center justify-center"
                              onClick={(e) => { e.stopPropagation(); setQty(i.product_id, i.quantity - 1); }}>−</button>
                            <input type="number" min="1" value={i.quantity} aria-label={`Quantity of ${i.name}`}
                              className="w-12 h-6 min-h-0 text-center font-mono font-bold text-xs bg-white border border-slate-300 rounded p-0 focus:ring-1 focus:ring-slate-800 focus:border-slate-800"
                              ref={(el) => { if (el) qtyRefs.current[i.product_id] = el; else delete qtyRefs.current[i.product_id]; }}
                              onFocus={(e) => { setActiveLine(i.product_id); e.target.select(); }}
                              onChange={(e) => setQty(i.product_id, Number(e.target.value))}
                              onKeyDown={(e) => {
                                // Enter accepts the quantity and hands the counter
                                // straight back to the scanner; Escape does the same
                                // without letting the global handler clear the sale.
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  e.preventDefault(); e.stopPropagation(); focusSearch();
                                }
                              }} />
                            <button type="button" className="w-6 h-6 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-slate-700 font-bold flex items-center justify-center"
                              onClick={(e) => { e.stopPropagation(); setQty(i.product_id, i.quantity + 1); }}>+</button>
                            {/* Sell the same shelf by tablet, strip or box. Segmented
                                buttons rather than a dropdown: one click instead of
                                two, and no popup to clip inside the scrolling table. */}
                            {(i.units_per_strip > 1 || i.units_per_box > 1) ? (
                              <div className="inline-flex border border-slate-300 rounded overflow-hidden ml-1" role="group" aria-label="Unit of sale">
                                {[
                                  ['unit', i.unit_name, i.allow_loose || i.units_per_strip === 1],
                                  ['strip', 'strip', i.units_per_strip > 1],
                                  ['box', 'box', i.units_per_box > i.units_per_strip],
                                ].filter(([, , show]) => show).map(([key, label]) => (
                                  <button key={key} type="button" title={`Sell by ${label}`}
                                    className={`px-1.5 h-6 text-[10px] font-semibold ${i.uom === key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                                    onClick={(e) => { e.stopPropagation(); setUom(i.product_id, key); }}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-500 ml-1">{i.unit_name}</span>
                            )}
                          </div>
                          {i.uom !== 'unit' && (
                            <div className="text-center text-[10px] text-slate-500 mt-0.5 font-mono">= {baseQty(i)} {i.unit_name}</div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {/* One box, editing the rate for the unit this line is
                              set to — showing a computed rate and an input side by
                              side just printed the same number twice. */}
                          <input type="number" min="0" step="0.5" className={`${NUM} w-24 h-6 disabled:bg-slate-50 disabled:text-slate-600`}
                            value={round2(i.unit_price * unitsIn(i))}
                            disabled={!can('pharmacy.override_price')}
                            title={can('pharmacy.override_price') ? 'Charging other than the catalogue price is recorded in the audit log' : 'The catalogue price. Changing it needs the price-override permission.'}
                            aria-label={`Rate per ${i.uom === 'unit' ? i.unit_name : i.uom}`}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setRate(i.product_id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Escape') {
                                e.preventDefault(); e.stopPropagation(); focusSearch();
                              }
                            }} />
                          {/* All three rates the customer might ask for, from the one
                              stored per-unit price. "Kitne ka patta?" is answered here. */}
                          <div className="text-[10px] text-slate-500 mt-0.5 font-mono leading-tight whitespace-nowrap" title={[`box ${money(i.unit_price * i.units_per_box)}`, `strip ${money(i.unit_price * i.units_per_strip)}`, `${i.unit_name} ${money(i.unit_price)}`, i.mrp > 0 ? `MRP ${money(i.mrp)}/${i.unit_name}` : null].filter(Boolean).join(' · ')}>
                            / {i.uom === 'unit' ? i.unit_name : i.uom}{i.units_per_strip > 1 && i.uom !== 'strip' ? ` · strip ${money(i.unit_price * i.units_per_strip)}` : i.uom !== 'unit' ? ` · ${i.unit_name} ${money(i.unit_price)}` : ''}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900 text-xs whitespace-nowrap">
                          {money(lineTotal(i))}
                        </td>
                        <td className="py-2 pr-3 pl-1 text-center">
                          <button type="button" className="text-slate-400 hover:text-rose-600 p-0.5" title="Remove line" aria-label="Remove line"
                            onClick={(e) => { e.stopPropagation(); removeItem(i.product_id); }}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50/60 font-mono text-xs text-slate-500">
                    <td className="py-2 text-center text-slate-400 font-bold">»</td>
                    <td className="py-2 px-2.5 italic" colSpan={7}>
                      {cart.length
                        ? 'Scan the next item, or type its name in the search bar above…'
                        : 'Scan a barcode or start typing a medicine name.'}
                      {!cart.length && (
                        <span className="not-italic ml-3 text-slate-400">
                          <Kbd>F2</Kbd> search <Kbd>F3</Kbd> qty <Kbd>F4</Kbd> tender <Kbd>F6</Kbd> hold <Kbd>F5</Kbd> resume <Kbd>F9</Kbd> pay
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {rxLines.length > 0 && (
            <div className="bg-white rounded-md border border-slate-300 shadow-xs shrink-0 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-2">Prescription details</div>
              {needsRxRef && (
                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 mb-2">
                  This sale contains prescription-only medicine. Enter the reference from the
                  prescription being presented{hospitalMode ? ', or open the patient record' : ''}.
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div>
                  <label className={LABEL}>Prescription ref {(controlledLines.length > 0 || !patient) ? '*' : ''}</label>
                  <input className={`${CTL} w-full px-2 font-mono`} value={rx.prescription_ref} onChange={setRxField('prescription_ref')} placeholder="Serial / slip number" />
                </div>
                {controlledLines.length > 0 && (
                  <>
                    <div>
                      <label className={LABEL}>Prescriber *</label>
                      <input aria-label="Prescriber" className={`${CTL} w-full px-2`} value={rx.prescriber_name} onChange={setRxField('prescriber_name')} placeholder="Dr. …" />
                    </div>
                    <div>
                      <label className={LABEL}>PMDC reg. no</label>
                      <input aria-label="PMDC reg. no" className={`${CTL} w-full px-2 font-mono`} value={rx.prescriber_reg_no} onChange={setRxField('prescriber_reg_no')} />
                    </div>
                    <div>
                      <label className={LABEL}>Collected by</label>
                      <input aria-label="Collected by" className={`${CTL} w-full px-2`} value={rx.buyer_name} onChange={setRxField('buyer_name')} placeholder="Name of person collecting" />
                    </div>
                    <div>
                      <label className={LABEL}>CNIC {narcoticLines.length ? '*' : ''}</label>
                      <input className={`${CTL} w-full px-2 font-mono`} value={rx.buyer_cnic} onChange={setRxField('buyer_cnic')} placeholder="35202-1234567-1" />
                    </div>
                    <div className="col-span-2 md:col-span-5 text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                      <b>Register entry</b> — {controlledLines.map((i) => i.name).join(', ')}. These details are written
                      to the controlled-drug register and cannot be edited afterwards.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ---------------- Right: the money ------------------------------- */}
        <section className="col-span-12 xl:col-span-3 flex flex-col gap-3 min-h-0">
          <div className="bg-white rounded-md border border-slate-300 p-3 shadow-xs flex flex-col justify-between flex-1 overflow-y-auto min-h-0">
            <div className="space-y-3">
              {/* The one dark block on the page: the figure the customer reads
                  from the other side of the counter. */}
              <div className="bg-navy-900 text-white rounded p-3 border border-navy-800 shadow-inner">
                <div className="flex justify-between items-center text-[11px] text-slate-200 uppercase tracking-wider font-semibold">
                  <span>{dept ? 'Issue value' : 'Net payable'}</span>
                  <span className="font-mono text-slate-100 bg-slate-800 px-1.5 rounded border border-slate-700">PKR</span>
                </div>
                <div className="font-mono font-black tracking-tight mt-1 flex items-baseline justify-between">
                  <span className="text-lg text-slate-200 font-sans font-normal">Rs</span>
                  <span className="text-3xl">{money(dept ? gross : net).replace(/^Rs\s*/, '')}</span>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-800 text-xs space-y-1 font-mono text-slate-100">
                  <div className="flex justify-between">
                    <span className="text-slate-200 font-sans">Subtotal · {cart.length} item{cart.length === 1 ? '' : 's'}</span>
                    <span>{money(gross)}</span>
                  </div>
                  {quote?.card && (quote.discount > 0 || quote.subsidy > 0) && (
                    <div className="flex justify-between text-emerald-400">
                      <span className="font-sans">Welfare card {Math.round(quote.card.pct * 100)}% · {quote.card.card_no}</span>
                      <span>− {money(quote.discount + quote.subsidy)}</span>
                    </div>
                  )}
                  {/* A staff bill is drawn from an allowance, not given a rate off, so
                      it is named that way and the balance follows it. */}
                  {!quote?.card && quote?.staff_allowance && quote.discount > 0 && (
                    <div className="flex justify-between text-emerald-400"><span className="font-sans">Staff allowance</span><span>− {money(quote.discount)}</span></div>
                  )}
                  {!quote?.card && !quote?.staff_allowance && quote?.discount > 0 && (
                    <div className="flex justify-between text-emerald-400"><span className="font-sans">{category} discount</span><span>− {money(quote.discount)}</span></div>
                  )}
                  {!quote?.card && quote?.subsidy > 0 && (
                    <div className="flex justify-between text-emerald-400"><span className="font-sans">Subsidy (Complete Free)</span><span>− {money(quote.subsidy)}</span></div>
                  )}
                  <div className="flex justify-between text-slate-200">
                    <span className="font-sans">Counter discount</span>
                    <span>{manual > 0 ? `− ${money(manual)}` : money(0)}</span>
                  </div>
                </div>
              </div>

              {/* Running out mid-basket is the case that surprises people: part of
                  the bill is covered and the rest is not, and the employee needs
                  telling before they hand over money, not after. */}
              {quote?.staff_allowance && (
                <Note tone={quote.cap_excess > 0 ? 'danger' : 'info'}>
                  {quote.cap_excess > 0 ? (
                    <><b>Allowance exhausted.</b> {money(quote.staff_allowance.cap)} for {quote.staff_allowance.year} is used up, so {money(quote.cap_excess)} of this sale is payable.</>
                  ) : (
                    <>Covered by the staff allowance · {money(quote.staff_allowance.left_after)} left of {money(quote.staff_allowance.cap)} for {quote.staff_allowance.year}</>
                  )}
                </Note>
              )}
              {quoteError && (
                <Note tone="danger">
                  <b>Entitlement not applied.</b> {quoteError}
                  <div className="mt-0.5">This total may be too high. Do not complete the sale until it is resolved.</div>
                </Note>
              )}
              {patient && !quote && !quoteError && cart.length > 0 && !deptId && (
                <div className="text-[11px] text-slate-500">Checking entitlement…</div>
              )}
              {quote?.uncovered_amount > 0 && (
                <div className="text-[11px] text-slate-500">
                  {money(quote.uncovered_amount)} of this sale is not covered by the card (cosmetics and general items are excluded) and is charged in full.
                </div>
              )}
              {quote?.ceiling_hit && (
                <div className="text-[11px] text-amber-700">This card has reached its monthly limit — the balance above it is payable.</div>
              )}

              <div>
                <label className={LABEL}>Extra discount (Rs)</label>
                <input aria-label="Extra discount (Rs)" type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0" className={`${NUM} w-full ${overDiscountCap ? '!border-rose-500' : ''}`} />
                {overDiscountCap && <div className="text-[11px] text-rose-700 mt-1">Max without override: {money(Math.floor(discountCap))}</div>}
              </div>

              {/* A department pays nothing now, so the tender controls would be
                  lying if they were shown. The amount goes on their account. */}
              {dept ? (
                <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex items-center justify-between text-xs">
                  <span className="text-slate-600">On account · {dept.name}</span>
                  <b className="font-mono">no cash</b>
                </div>
              ) : (
                <div>
                  <label className={LABEL}>Payment mode</label>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {[
                      ['cash', 'Cash', null],
                      ['card', 'Card', null],
                      ['online', 'Online / transfer', null],
                      ['credit', 'On account', 'no cash'],
                    ].map(([k, label, tag]) => (
                      <button key={k} type="button" onClick={() => setMethod(k)}
                        className={`py-1.5 px-2 rounded font-semibold text-center border flex items-center justify-center gap-1 ${
                          method === k ? 'bg-slate-800 text-white border-slate-900 shadow-xs' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300'}`}>
                        <span>{label}</span>
                        {tag && <span className={`text-[9px] font-mono font-bold px-1 rounded ${method === k ? 'bg-slate-700 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>{tag}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!dept && method === 'credit' && (
                <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex items-center justify-between text-xs">
                  <span className="text-slate-600">On account{creditAccount ? ` · owes ${money(creditAccount.balance)}` : ''}</span>
                  <b className="font-mono">no cash</b>
                </div>
              )}

              {!dept && method === 'cash' && (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className={`${LABEL} mb-0`} htmlFor="tendered-input">Cash tendered</label>
                    <span className="text-[10px] text-slate-500 font-mono">amount received <Kbd>F4</Kbd></span>
                  </div>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-500 font-mono text-sm font-semibold">Rs</span>
                    <input id="tendered-input" type="number" min="0" value={tendered}
                      onChange={(e) => setTendered(e.target.value)} placeholder={String(Math.ceil(net))}
                      className="block w-full h-9 min-h-0 pl-9 pr-3 py-0 text-base font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-slate-800 focus:border-slate-800" />
                  </div>
                  <div className="grid grid-cols-3 gap-1 pt-1">
                    <button type="button" onClick={() => setTendered(String(Math.ceil(net)))}
                      className="py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-mono font-semibold text-slate-800">
                      Exact ({Math.ceil(net)})
                    </button>
                    {QUICK_CASH.filter((n) => n >= net).slice(0, 5).map((n) => (
                      <button key={n} type="button" onClick={() => setTendered(String(n))}
                        className={`py-1 border rounded text-xs font-mono font-semibold ${String(n) === tendered ? 'bg-slate-200 border-slate-400 text-slate-900 ring-1 ring-slate-400' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'}`}>
                        {n.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <div className={`rounded p-2.5 border ${change < 0 ? 'bg-rose-50 border-rose-300' : 'bg-emerald-50 border-emerald-300'}`}>
                    <div className={`flex justify-between items-center text-[10px] font-bold uppercase ${change < 0 ? 'text-rose-900' : 'text-emerald-900'}`}>
                      <span>{change < 0 ? 'Still due' : 'Change return'}</span>
                      {tendered !== '' && (
                        <span className={`font-mono px-1 rounded text-[10px] border ${change < 0 ? 'bg-rose-100 border-rose-300' : 'bg-emerald-100 border-emerald-300'}`}>
                          {change < 0 ? 'short' : 'tender valid'}
                        </span>
                      )}
                    </div>
                    <div className={`text-xl font-black font-mono mt-0.5 ${change < 0 ? 'text-rose-950' : 'text-emerald-950'}`}>
                      {money(Math.abs(change))}
                    </div>
                  </div>
                </div>
              )}

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} />
                Allow partial dispensing
              </label>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-2">
              <button type="button" onClick={checkout} disabled={!cart.length || blocked || busy}
                className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded font-bold text-sm flex items-center justify-between transition shadow-xs">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="printer" size={15} />
                  {busy ? 'Processing…' : dept ? `Issue to ${dept.name}` : 'Complete & print slip'}
                </span>
                <kbd className="bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">F9</kbd>
              </button>
              {blockReason && cart.length > 0 && (
                <div className="text-[11px] text-rose-900 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{blockReason}</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={parkSale} disabled={!cart.length || holdBusy}
                  className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 border border-slate-300 rounded text-xs font-semibold text-slate-700 flex items-center justify-center gap-1">
                  Hold bill <Kbd>F6</Kbd>
                </button>
                <button type="button" onClick={() => lastReceipt && setReceipt(lastReceipt)} disabled={!lastReceipt}
                  className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 border border-slate-300 rounded text-xs font-semibold text-slate-700 flex items-center justify-center gap-1">
                  Reprint last
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces of the design's vocabulary
// ---------------------------------------------------------------------------

function ModeTab({ on, n, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 h-7 text-xs font-semibold rounded inline-flex items-center gap-1.5 border transition ${
        on ? 'bg-slate-800 text-white border-slate-900 shadow-xs' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'}`}>
      <span className={`w-2 h-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-400'}`} />
      <span>{n}. {label}</span>
    </button>
  );
}

function Tag({ tone, children }) {
  const t = {
    red: 'text-rose-900 bg-rose-100 border-rose-300',
    amber: 'text-amber-900 bg-amber-100 border-amber-300',
    blue: 'text-sky-900 bg-sky-100 border-sky-300',
    gray: 'text-slate-700 bg-slate-100 border-slate-300',
    green: 'text-emerald-900 bg-emerald-100 border-emerald-300',
  }[tone] || 'text-slate-700 bg-slate-100 border-slate-300';
  return <span className={`text-[9px] font-semibold px-1 py-px rounded border whitespace-nowrap ${t}`}>{children}</span>;
}

function Note({ tone, children }) {
  const t = tone === 'danger'
    ? 'bg-rose-50 border-rose-200 text-rose-900'
    : 'bg-slate-50 border-slate-200 text-slate-700';
  return <div className={`text-[11px] rounded border px-2.5 py-2 ${t}`}>{children}</div>;
}

// Expiry inside 90 days is amber, inside 30 is red — the same thresholds the
// inventory screen and the near-expiry setting use.
function expiryTone(iso) {
  const days = Math.round((new Date(iso) - Date.now()) / 86400000);
  if (days <= 30) return 'text-rose-700 font-semibold';
  if (days <= 90) return 'text-amber-700 font-semibold';
  return 'text-slate-600';
}

// Who is buying, and what they are entitled to.
//
// This is NOT hospital-only. Customer Management is in scope for the standalone
// pharmacy (SCOPE.md), and a welfare card holder walking up to the counter is
// the whole point of Phase 03 — gating this behind hospital mode left the
// counter with no way to apply a card at all.
//
// Three ways in, because a counter has three situations:
//   scan/type a card number   — the holder has their card
//   search by mobile          — they have forgotten it
//   just a name and phone     — an ordinary walk-in, nothing to store
function CustomerBar({
  inputRef, patient, setPatient, card, creditAccount, customerName, setCustomerName,
  customerPhone, setCustomerPhone, disabled, onErr, resetToken, seeking,
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState([]);
  // A new sale starts clean (UI report 2.3): the mobile typed for the last
  // customer must not sit in the box for the next one.
  useEffect(() => { setKey(''); setHits([]); setCreating(false); }, [resetToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const [creating, setCreating] = useState(false);
  const [nw, setNw] = useState({ full_name: '', contact: '' });

  // One box, two behaviours. A card number or QR token resolves straight to the
  // holder; anything else is treated as a customer search. The pharmacist does
  // not have to decide which kind of thing they are holding.
  async function lookup(e) {
    e?.preventDefault();
    const q = key.trim();
    if (!q || busy) return;
    setBusy(true);
    setHits([]);
    try {
      const c = await api.get(`/cards/resolve/${encodeURIComponent(q)}`);
      const people = await api.get(`/patients?q=${encodeURIComponent(c.contact || c.full_name)}`);
      setPatient(people.find((x) => x.id === c.customer_id) || {
        id: c.customer_id, full_name: c.full_name, patient_code: c.patient_code,
        contact: c.contact, category: 'Paid',
      });
      setKey('');
    } catch (err) {
      // A card that exists but cannot be used says so; anything else is simply
      // not a card, so fall back to searching for a person.
      if (err.status === 409) { onErr(err.message); setKey(''); }
      else {
        try {
          const people = await api.get(`/patients?q=${encodeURIComponent(q)}`);
          if (people.length === 1) { setPatient(people[0]); setKey(''); }
          else if (people.length) setHits(people);
          else { setHits([]); setNw({ full_name: '', contact: /^0\d{9,}$/.test(q) ? q : '' }); setCreating(true); }
        } catch (e2) { onErr(e2.message); }
      }
    } finally { setBusy(false); }
  }

  async function create() {
    try {
      const r = await api.post('/patients', { ...nw, force: true });
      setPatient(r.patient || r);
      setCreating(false);
      setNw({ full_name: '', contact: '' });
      setKey('');
    } catch (e) { onErr(e.message); }
  }

  const initials = (n) => (n || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
      {/* Lookup */}
      <div className="md:col-span-5">
        <div className="flex items-center justify-between mb-1">
          <label className={`${LABEL} mb-0`}>
            Customer <span className="text-[9px] font-normal text-slate-500 font-mono normal-case">[card · mobile · name]</span>
          </label>
        </div>
        <form className="flex" onSubmit={lookup}>
          <input ref={inputRef} value={key} onChange={(e) => setKey(e.target.value)} disabled={disabled || !!patient}
            className={`${CTL} flex-1 min-w-0 px-3 font-mono rounded-r-none`}
            aria-label="Customer card number, mobile or name" placeholder={patient ? '' : 'Scan the card, or type card no / mobile / name'} />
          <button className={`${BTN} rounded-l-none border-l-0`} disabled={disabled || busy || !key.trim() || !!patient}>
            {busy ? '…' : 'Lookup'}
          </button>
        </form>
        {hits.length > 0 && (
          <div className="pos-cust-hits mt-2">
            {hits.slice(0, 6).map((h) => (
              <button type="button" key={h.id} className="pos-cust-hit"
                onClick={() => { setPatient(h); setHits([]); setKey(''); }}>
                <b>{h.full_name}</b>
                <span className="muted sm">{h.contact || h.patient_code}</span>
              </button>
            ))}
            <button type="button" className={BTN}
              onClick={() => { setNw({ full_name: key, contact: '' }); setCreating(true); setHits([]); }}>
              None of these — add new
            </button>
          </div>
        )}
        {creating && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div><label className={LABEL}>Name *</label>
              <input aria-label="Name" className={`${CTL} w-full px-2`} value={nw.full_name} onChange={(e) => setNw({ ...nw, full_name: e.target.value })} autoFocus /></div>
            <div><label className={LABEL}>Mobile</label>
              <input aria-label="Mobile" className={`${CTL} w-full px-2 font-mono`} value={nw.contact} onChange={(e) => setNw({ ...nw, contact: e.target.value })} placeholder="03xx-xxxxxxx" /></div>
            <div className="col-span-2 flex gap-1.5">
              <button type="button" className={BTN_DARK} onClick={create} disabled={!nw.full_name.trim()}>Save customer</button>
              <button type="button" className={`${BTN} !bg-white`} onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Who they are — the design's profile card. Hidden while a new
          customer is being typed in (UI report 2.2): "this is a walk-in
          sale" next to a create form contradicts it. */}
      {!creating && !seeking && <div className="md:col-span-4 bg-slate-50 border border-slate-200 rounded p-2 flex items-center gap-3 min-h-[52px]">
        {patient ? (
          <>
            <div className="h-9 w-9 rounded bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0">
              {initials(patient.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 truncate">{patient.full_name}</span>
                {card && !card.is_expired && (
                  <span className="text-[10px] font-semibold font-mono text-emerald-800 bg-emerald-50 border border-emerald-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                    {Math.round(card.discount_pct * 100)}% · {card.card_no}
                  </span>
                )}
                {card?.is_expired && <Tag tone="red">card expired</Tag>}
                {!card && <Tag tone="gray">no card</Tag>}
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                {patient.patient_code}{patient.contact ? ` • ${patient.contact}` : ''}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5 font-mono">
                {creditAccount
                  ? <>On account: <span className="text-slate-700 font-medium">{money(creditAccount.balance)} owed</span></>
                  : card && !card.is_expired && card.ceiling_left != null
                    ? <>Card this month: <span className="text-slate-700 font-medium">{money(card.ceiling_left)} left</span></>
                    : 'No credit account'}
              </div>
            </div>
            <button type="button" className={`${BTN} !bg-white shrink-0`} disabled={disabled}
              onClick={() => { setPatient(null); setKey(''); }}>Change</button>
          </>
        ) : (
          <div className="text-[11px] text-slate-500">
            No customer identified — this is a walk-in sale. Scan a card or type a mobile to attach one.
          </div>
        )}
      </div>}

      {/* An ordinary walk-in needs no record at all. Kept beside the lookup so
          the common case stays one line, not a form. */}
      {!creating && !patient && !seeking && <div className="md:col-span-3 grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL} htmlFor="cust-name">Name (optional)</label>
          <input id="cust-name" className={`${CTL} w-full px-2`} value={customerName} onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Walk-in" disabled={disabled || !!patient} />
        </div>
        <div>
          <label className={LABEL} htmlFor="cust-phone">Phone (optional)</label>
          <input id="cust-phone" className={`${CTL} w-full px-2 font-mono`} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="03xx…" disabled={disabled || !!patient} />
        </div>
      </div>}
    </div>
  );
}

// The row of customers waiting at the counter. Shows the item count and total
// deliberately — "which one is Bashir's?" is answered by the amount far more
// often than by the name.
function HeldBar({ held, busy, hasCart, label, onResume, onDiscard }) {
  if (!held.length) return null;

  const sum = (h) => {
    const lines = h.cart?.cart || [];
    const units = (i) => (i.uom === 'box' ? i.units_per_box : i.uom === 'strip' ? i.units_per_strip : 1);
    return lines.reduce((t, i) => t + i.unit_price * i.quantity * units(i), 0);
  };

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto shrink-0 text-xs">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap mr-1">Waiting:</span>
      <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded border border-slate-800 bg-slate-800 text-white font-semibold whitespace-nowrap"
        title="The customer at the counter now">
        <Icon name="user" size={12} /> {hasCart ? label : 'New sale'}
      </span>
      {held.map((h) => (
        <span key={h.id}
          className={`inline-flex items-stretch rounded border overflow-hidden whitespace-nowrap ${h.stale ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-white'}`}>
          <button type="button" disabled={busy} onClick={() => onResume(h)}
            className="px-2.5 h-7 hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-2"
            title={h.stale ? 'Parked on an earlier day — resume or discard it' : 'Bring this customer back to the counter'}>
            <b className="text-slate-800">{h.label || 'Customer'}</b>
            <span className="font-mono text-slate-500 text-[11px]">
              {(h.cart?.cart || []).length} · {money(sum(h))}
            </span>
          </button>
          <button type="button" disabled={busy} onClick={() => onDiscard(h)}
            className="px-2 border-l border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            title="Discard this parked sale" aria-label="Discard this parked sale">✕</button>
        </span>
      ))}
    </div>
  );
}

// --- Scan / type-ahead product search ---------------------------------------
function ProductSearch({ inputRef, onPick, onError }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setSearching(false); return undefined; }
    setSearching(true);
    const seq = ++latest.current;
    const t = setTimeout(() => {
      api.get(`/pharmacy/lookup?q=${encodeURIComponent(term)}`)
        .then((r) => {
          // Ignore a slow response that a newer keystroke has superseded.
          if (seq !== latest.current) return;
          setRows(r); setActive(0); setSearching(false);
          // A barcode scanner types the full code then Enter. An exact,
          // unambiguous barcode hit is added straight away so the operator
          // never has to look at the list.
          if (r.length === 1 && r[0].barcode && r[0].barcode === term) {
            onPick(r[0]);
            setQ(''); setRows([]);
          }
        })
        .catch((e) => { if (seq === latest.current) { setSearching(false); onError(e.message); } });
    }, 180);
    return () => clearTimeout(t);
  }, [q, onPick, onError]);

  function pick(p) {
    onPick(p);
    setQ(''); setRows([]); setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (!rows.length) {
      // Enter with nothing to pick must not be silent (UI report 1.2).
      if (e.key === 'Enter' && q.trim().length >= 2) {
        e.preventDefault();
        onError(searching ? `Still searching for “${q.trim()}” — press Enter again in a moment.` : `No medicine matches “${q.trim()}”.`);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[active]); }
  }

  const open = q.trim().length >= 2;

  return (
    <div className="relative flex-1 min-w-[24rem] basis-[28rem]">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
        <Icon name="barcode" size={18} />
      </div>
      <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
        autoFocus autoComplete="off" aria-label="Scan a barcode or search for a medicine" role="combobox" aria-expanded={open}
        className="block w-full h-9 min-h-0 pl-10 pr-32 py-0 text-sm bg-slate-50 border border-slate-300 rounded focus:border-slate-800 focus:bg-white focus:ring-1 focus:ring-slate-800 font-medium text-slate-900 placeholder-slate-400"
        placeholder="Scan barcode or type medicine name, generic or DRAP number…" />
      <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
        <span className="text-[11px] font-mono font-semibold text-slate-700 bg-slate-200/70 border border-slate-300 px-2 py-0.5 rounded">
          {searching ? 'SEARCHING' : q ? `${rows.length} MATCH${rows.length === 1 ? '' : 'ES'}` : 'SCANNER READY'}
        </span>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-slate-300 rounded shadow-lg max-h-80 overflow-y-auto overflow-x-hidden" role="listbox">
          {searching && rows.length === 0 && <div className="px-3 py-2.5 text-xs text-slate-500">Searching…</div>}
          {!searching && rows.length === 0 && <div className="px-3 py-2.5 text-xs text-slate-500">No medicine matches “{q}”.</div>}
          {rows.map((p, idx) => (
            <div key={p.id} role="button" tabIndex={-1}
              className={`grid grid-cols-[minmax(0,1fr)_110px_90px] gap-3 items-center px-3 py-2 text-xs border-b border-slate-100 last:border-b-0 ${
                idx === active ? 'bg-sky-50' : ''} ${p.sellable <= 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              onMouseEnter={() => setActive(idx)} onClick={() => p.sellable > 0 && pick(p)}>
              <div className="min-w-0">
                <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                  <span>{p.name}{strengthOf(p) ? <span className="text-slate-500 font-normal"> {strengthOf(p)}</span> : null}</span>
                  {p.requires_prescription && <Tag tone={p.drug_schedule === 'Narcotic' ? 'red' : p.drug_schedule === 'G' ? 'amber' : 'blue'}>{p.drug_schedule}</Tag>}
                  {p.is_refrigerated ? <Tag tone="blue">2–8 °C</Tag> : null}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{[
                  p.generic_name,
                  p.units_per_strip > 1 ? `${p.units_per_strip}/strip` : null,
                  p.units_per_box > p.units_per_strip ? `${p.strips_per_box} strips/box` : null,
                  p.units_per_strip > 1 && !p.allow_loose ? 'full strips only' : null,
                  p.next_expiry ? `exp ${p.next_expiry}` : null,
                ].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-right font-mono">
                {/* Lead with the strip price when it comes in strips — that is
                    the number a customer is quoted. */}
                {p.units_per_strip > 1
                  ? <><b>{money(p.strip_price)}</b><div className="text-[10px] text-slate-500">/strip · {money(p.sale_price)}/{p.unit}</div></>
                  : <><b>{money(p.sale_price)}</b><div className="text-[10px] text-slate-500">MRP {p.mrp > 0 ? money(p.mrp) : '—'}</div></>}
              </div>
              <div className={`text-right font-mono font-bold ${p.sellable <= 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                {p.sellable}
                <div className="text-[10px] font-normal text-slate-500">{p.sellable <= 0 ? 'out of stock' : (p.stock_label || 'in stock')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Receipt ----------------------------------------------------------------
//
// Laid out as the 80mm slip it will be printed on, and printed on an 80mm roll
// by default — that is the printer at the counter. A4 is a click away for the
// department issue note, which gets filed rather than handed over.
function Receipt({ bill, config, user, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' || e.key === 'F9') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const line = (label, value, strong) => (
    <div className={`flex justify-between gap-3 py-0.5 ${strong ? 'font-bold text-sm' : 'text-xs'}`}>
      <span className={strong ? '' : 'text-slate-600'}>{label}</span><span className="font-mono">{value}</span>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 grid grid-cols-12 gap-3">
      <div className="col-span-12 xl:col-span-4 xl:col-start-3 space-y-3 no-print">
        <div className={`rounded border px-3 py-2 text-xs ${bill.department ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-emerald-50 border-emerald-300 text-emerald-900'}`}>
          <b>{bill.department ? `Issued to ${bill.department}` : 'Sale completed'}</b> — stock deducted (FEFO)
          {bill.department ? ', charged to their account.' : '.'}
        </div>
        {bill.shortfalls && bill.shortfalls.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
            <b>Partial dispense</b> — recorded shortfall:
            {bill.shortfalls.map((s, i) => <div key={i}>{s.product}: supplied {s.dispensed} of {s.requested} (short {s.shortfall})</div>)}
          </div>
        )}
        {bill.controlled_entries && bill.controlled_entries.length > 0 && (
          <div className="rounded border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 text-xs">
            Controlled-drug register updated — {bill.controlled_entries.join(', ')}.
          </div>
        )}
        {!config.pharmacy_license_no && (
          <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
            <b>Licence not recorded.</b> The slip header carries no drug sale licence number or address — an administrator enters them in Settings.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`${BTN_DARK} justify-center h-10`} onClick={() => printPaper('thermal', { modal: false })}>
            <Icon name="printer" size={14} /> Print slip (80mm)
          </button>
          <button type="button" className={`${BTN} justify-center h-10`} onClick={() => printPaper('a4', { modal: false })}>
            Print A4
          </button>
        </div>
        <button type="button" onClick={onClose}
          className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-bold text-sm flex items-center justify-between">
          <span>{bill.department ? 'Done' : 'New sale'}</span>
          <kbd className="bg-emerald-800 text-white font-mono px-1.5 py-0.5 rounded text-xs border border-emerald-600">Enter</kbd>
        </button>
      </div>

      {/* The slip itself — the only thing that prints. */}
      <div className="col-span-12 xl:col-span-4">
        <div className="receipt bg-white border border-slate-300 rounded-md shadow-xs p-4 mx-auto font-mono text-slate-900">
          <div className="text-center border-b border-dashed border-slate-400 pb-2.5 mb-2.5">
            <div className="font-sans font-bold text-sm">{config.pharmacy_name || 'Pharmacy'}</div>
            {config.pharmacy_address && <div className="text-[10px] text-slate-600">{config.pharmacy_address}</div>}
            {config.pharmacy_contact && <div className="text-[10px] text-slate-600">{config.pharmacy_contact}</div>}
            {config.pharmacy_license_no && <div className="text-[10px] text-slate-600">Drug Sale Licence: {config.pharmacy_license_no}</div>}
            <div className="text-xs font-bold mt-1.5">{bill.bill_no}</div>
            <div className="text-[10px] text-slate-600">
              {new Date(bill.created_at ? `${bill.created_at.replace(' ', 'T')}Z` : Date.now()).toLocaleString('en-GB')}
            </div>
          </div>

          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-600 border-b border-slate-300">
              <tr><th className="text-left py-1">Item</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Rate</th><th className="text-right py-1">Total</th></tr>
            </thead>
            <tbody>{(bill.items || []).map((i) => (
              <tr key={i.id} className="align-top">
                <td className="py-1 pr-2 font-sans">{i.description}</td>
                <td className="py-1 text-right">{i.quantity}</td>
                <td className="py-1 text-right">{money(i.unit_price)}</td>
                <td className="py-1 text-right">{money(i.line_total)}</td>
              </tr>
            ))}</tbody>
          </table>

          <div className="mt-2 pt-2 border-t border-slate-300 font-sans">
            {line('Gross', money(bill.gross_amount))}
            {bill.discount > 0 && line('Discount', '− ' + money(bill.discount))}
            {bill.subsidy > 0 && line('Subsidy', '− ' + money(bill.subsidy))}
            {line('Net payable', money(bill.net_amount), true)}
            {bill.payment_method === 'cash' && bill.tendered != null && (
              <>
                {line('Cash received', money(bill.tendered))}
                {line('Change returned', money(bill.change_given ?? bill.change ?? 0))}
              </>
            )}
            {line('Paid by', bill.department ? 'On account — no cash' : bill.payment_method)}
            {user && !bill.department && line('Dispensed by', user.full_name)}
          </div>

          {bill.department && (
            <div className="border-t border-dashed border-slate-400 mt-3 pt-2.5 font-sans">
              {line('Department', bill.department)}
              {bill.for_patient && line('For', bill.for_patient)}
              {bill.slip_ref && line('Their slip', bill.slip_ref)}
              {line('Collected by', bill.collected_by || '—')}
              <div className="flex justify-between gap-6 mt-6 text-[10px]">
                <div>Issued by ______________</div>
                <div>Received by ______________</div>
              </div>
            </div>
          )}

          <div className="text-center text-[10px] text-slate-600 mt-3 font-sans">
            {bill.department
              ? 'Departmental issue note — file with the department’s copy of the slip.'
              : 'Medicines are not returnable without this receipt. Please check expiry before use.'}
          </div>
        </div>
      </div>
    </div>
  );
}
