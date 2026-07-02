import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken } from '../api';
import Dashboard from './Dashboard';
import Submissions from './Submissions';
import LocationsQR from './LocationsQR';
import Runbook from './Runbook';
import Settings from './Settings';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(username, password);
      setToken(res.token);
      onLogin(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card rise">
        <img src="/brand/mw-logo-colour.png" alt="Muskoka Woods" />
        <h1 className="display">Guest Care HQ</h1>
        <p className="muted" style={{ margin: '6px 0 18px' }}>Sign in to manage WoodsVoice submissions.</p>
        <form onSubmit={submit}>
          <div className="form-col">
            <label>Username</label>
            <input className="input" autoFocus autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className="form-col">
            <label>Password</label>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <div className="error-note" style={{ marginBottom: 14 }}>{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/admin', end: true, icon: '📊', label: 'Dashboard' },
  { to: '/admin/submissions', icon: '📬', label: 'Inbox' },
  { to: '/admin/locations', icon: '📍', label: 'QR codes' },
  { to: '/admin/runbook', icon: '📖', label: 'Runbook' },
  { to: '/admin/settings', icon: '⚙️', label: 'Settings' },
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [who, setWho] = useState(localStorage.getItem('woodsvoice_who') || 'Admin');

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('woodsvoice:logout', onLogout);
    return () => window.removeEventListener('woodsvoice:logout', onLogout);
  }, []);

  if (!authed) {
    return <Login onLogin={(res) => { localStorage.setItem('woodsvoice_who', res.name); setWho(res.name); setAuthed(true); }} />;
  }

  function logout() {
    setToken(null);
    setAuthed(false);
  }

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="admin-logo">
          <img src="/brand/mw-logo-white.png" alt="Muskoka Woods" />
          <div className="app">Woods<span>Voice</span></div>
        </div>
        <nav className="admin-nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => isActive ? 'on' : ''}>
              <span className="ic">{n.icon}</span><span className="lb">{n.label}</span>
            </NavLink>
          ))}
          <div className="admin-nav__aux">
            <a href="/" target="_blank" rel="noreferrer"><span className="ic">↗</span><span className="lb">Guest form</span></a>
            <a href="/how" target="_blank" rel="noreferrer"><span className="ic">✨</span><span className="lb">How it works</span></a>
          </div>
        </nav>
        <div className="who">
          <span>👋 {who}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="admin-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="submissions" element={<Submissions />} />
          <Route path="locations" element={<LocationsQR />} />
          <Route path="runbook" element={<Runbook />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
