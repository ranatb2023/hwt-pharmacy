import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(username, password);
      nav('/');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/img/Hope-Charity-Logo.webp" alt="Hope Welfare Trust" style={{ height: 54, width: 'auto' }} />
          <div className="sub" style={{ margin: '12px 0 0' }}>Hospital Management System</div>
        </div>
        {err && <div className="alert err">{err}</div>}
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn primary lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="login-hint">
          Demo accounts: <b>admin</b>, <b>reception</b>, <b>doctor</b>, <b>lab</b>, <b>pharmacy</b>, <b>cashier</b>
          <br />Password: <b>pass123</b> (admin: <b>admin123</b>)
        </div>
      </form>
    </div>
  );
}
