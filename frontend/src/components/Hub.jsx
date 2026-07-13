import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Icon } from './icons.jsx';
import { Alert } from './ui.jsx';

const COLORS = ['c-blue', 'c-teal', 'c-amber', 'c-green'];

// Generic role home: an optional "open patient record" scan bar plus a grid of
// permission-filtered action cards. Driven entirely by the `options` config so
// every role's home (reception, doctor, lab, pharmacy, cashier) reuses it.
export default function Hub({ options, search = false, searchPlaceholder }) {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');

  const opts = options.filter((o) => !o.perm || can(o.perm));
  const cols = Math.min(Math.max(opts.length, 1), 4);

  async function open(e) {
    e.preventDefault();
    const k = key.trim();
    if (!k) return;
    setErr('');
    try {
      const p = await api.get(`/patients/resolve/${encodeURIComponent(k)}`);
      nav(`/patients/${p.id}`);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="hub-wrap">
      <div className="hub-welcome">
        <h2>Welcome, {user?.full_name || 'there'}</h2>
        <div className="muted">{search ? 'Open a patient record or choose an action.' : 'What would you like to do?'}</div>
      </div>

      {search && (
        <>
          <Alert type="error" onClose={() => setErr('')}>{err}</Alert>
          <form className="hub-search" onSubmit={open}>
            <div className="input-ico" style={{ flex: 1 }}>
              <input value={key} onChange={(e) => setKey(e.target.value)} autoFocus
                placeholder={searchPlaceholder || 'Scan QR card or enter Patient ID to open a record…'} />
              <span className="lead"><Icon name="search" size={18} /></span>
            </div>
            <button className="btn primary">Open record</button>
          </form>
        </>
      )}

      <div className={`hub c${cols}`}>
        {opts.map((o, i) => (
          <div key={o.to} className={`hub-card ${COLORS[i % COLORS.length]}`} onClick={() => nav(o.to)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(o.to); } }}>
            <div className="ic"><Icon name={o.icon} size={26} /></div>
            <h3>{o.title}</h3>
            <p>{o.desc}</p>
            <span className="hub-go">Open <Icon name="arrowright" size={16} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
