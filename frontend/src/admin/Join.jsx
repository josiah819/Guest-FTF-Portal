import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, setToken } from '../api';
import GoogleButton from '../components/GoogleButton';

// Invite landing page (/join/:token) — where an emailed invite becomes an
// account, via Google or a username + password. Public route; the token is
// the only credential.
export default function Join() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [dead, setDead] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    api.joinInfo(token)
      .then(d => {
        setInfo(d);
        setUsername(d.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, ''));
      })
      .catch(err => setDead(err.message));
  }, [token]);

  function finish(res) {
    setToken(res.token);
    navigate('/admin', { replace: true });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      finish(await api.joinAccept(token, { displayName, username, password }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function google(credential) {
    setError('');
    try {
      finish(await api.joinGoogle(token, credential));
    } catch (err) {
      setError(err.message);
    }
  }

  if (dead) {
    return (
      <div className="login-shell">
        <div className="login-card rise">
          <img src="/brand/mw-logo-colour.png" alt="Muskoka Woods" />
          <h1 className="display">Invite not found</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{dead}</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return <div className="center-pad" style={{ minHeight: '60vh' }}><span className="spinner" /></div>;
  }

  return (
    <div className="login-shell">
      <div className="login-card rise">
        <img src="/brand/mw-logo-colour.png" alt="Muskoka Woods" />
        <h1 className="display">Join {info.appName}</h1>
        <p className="muted" style={{ margin: '6px 0 18px' }}>
          You’ve been invited to {info.orgName}’s guest care team as{' '}
          <strong>{info.roleName}</strong>, using <strong>{info.email}</strong>.
        </p>
        {info.googleClientId && (
          <>
            <GoogleButton clientId={info.googleClientId} onCredential={google} onError={setError} text="continue_with" />
            <div className="auth-divider">or set a password</div>
          </>
        )}
        <form onSubmit={submit}>
          <div className="form-col">
            <label>Your name</label>
            <input className="input" placeholder="How teammates see you" value={displayName}
              onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="form-col">
            <label>Username</label>
            <input className="input" autoCapitalize="none" autoComplete="username" value={username}
              onChange={e => setUsername(e.target.value)} />
          </div>
          <div className="form-col">
            <label>Password <span className="muted">(8+ characters)</span></label>
            <input className="input" type="password" autoComplete="new-password" value={password}
              onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <div className="error-note" style={{ marginBottom: 14 }}>{error}</div>}
          <button className="btn btn-primary" disabled={busy || username.length < 3 || password.length < 8}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
