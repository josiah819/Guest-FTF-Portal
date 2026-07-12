import React, { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken } from '../api';
import Dashboard from './Dashboard';
import Submissions from './Submissions';
import LocationsQR from './LocationsQR';
import Runbook from './Runbook';
import Settings from './Settings';
import Team from './Team';

// Who is signed in and what they may do. Loaded once from /api/admin/me;
// pages gate buttons/tabs with useActor().can(...).
const ActorContext = createContext(null);
export function useActor() {
  return useContext(ActorContext);
}

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

// Nav entries carry the permissions that make them useful; entries with no
// perms listed are visible to everyone signed in.
const NAV = [
  { to: '/admin', end: true, icon: '📊', label: 'Dashboard', perms: ['metrics.view_all', 'metrics.view_dept'] },
  { to: '/admin/submissions', icon: '📬', label: 'Inbox', perms: ['submissions.view_all', 'submissions.view_dept'] },
  { to: '/admin/locations', icon: '📍', label: 'QR codes', perms: ['catalogs.manage'] },
  { to: '/admin/team', icon: '👥', label: 'Team', perms: ['users.manage'] },
  { to: '/admin/runbook', icon: '📖', label: 'Runbook', perms: [] },
  { to: '/admin/settings', icon: '⚙️', label: 'Settings', perms: [] },
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [actor, setActor] = useState(null);
  const [actorError, setActorError] = useState('');

  useEffect(() => {
    const onLogout = () => { setAuthed(false); setActor(null); };
    window.addEventListener('woodsvoice:logout', onLogout);
    return () => window.removeEventListener('woodsvoice:logout', onLogout);
  }, []);

  useEffect(() => {
    if (!authed) return;
    setActorError('');
    api.me()
      .then(setActor)
      .catch(err => setActorError(err.message));
  }, [authed]);

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  function logout() {
    setToken(null);
    setActor(null);
    setAuthed(false);
  }

  if (actorError) {
    return <div className="login-shell"><div className="login-card rise"><div className="error-note">{actorError}</div></div></div>;
  }
  if (!actor) {
    return <div className="center-pad" style={{ minHeight: '60vh' }}><span className="spinner" /></div>;
  }

  const can = (...keys) => keys.some(k => actor.perms.includes(k));
  const ctx = { ...actor, can };
  const nav = NAV.filter(n => n.perms.length === 0 || can(...n.perms));

  // Where "/admin" should land for this user.
  const homePath = can('metrics.view_all', 'metrics.view_dept') ? null
    : can('submissions.view_all', 'submissions.view_dept') ? '/admin/submissions'
    : '/admin/settings';

  return (
    <ActorContext.Provider value={ctx}>
      <div className="admin-shell">
        <aside className="admin-side">
          <div className="admin-logo">
            <img src="/brand/mw-logo-white.png" alt="Muskoka Woods" />
            <div className="app">Woods<span>Voice</span></div>
          </div>
          <nav className="admin-nav">
            {nav.map(n => (
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
            <span>👋 {actor.user.name}<small style={{ display: 'block', opacity: 0.7 }}>{actor.user.role}</small></span>
            <button onClick={logout}>Sign out</button>
          </div>
        </aside>
        <main className="admin-main">
          {actor.mustChangePassword && (
            <div className="error-note" style={{ marginBottom: 16 }}>
              🔑 You’re signed in with a temporary password — set your own under{' '}
              <Link to="/admin/settings">Settings → Account</Link>.
            </div>
          )}
          <Routes>
            <Route index element={homePath ? <Navigate to={homePath} replace /> : <Dashboard />} />
            <Route path="submissions" element={<Submissions />} />
            <Route path="locations" element={<LocationsQR />} />
            <Route path="team" element={<Team />} />
            <Route path="runbook" element={<Runbook />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </ActorContext.Provider>
  );
}
