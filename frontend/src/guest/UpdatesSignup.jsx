import React, { useState } from 'react';
import { api } from '../api';

// Email-updates opt-in box, shared by the thank-you screen (GuestForm) and the
// tracking page (Track — covers kiosk guests who arrive via the follow QR).
// ct = content.form microcopy from admin settings.
export default function UpdatesSignup({ code, ct, onSubscribed }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.subscribeUpdates(code, email.trim());
      setDone(true);
      onSubscribed?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="updates-box" role="status">
        <p className="updates-thanks">✅ {ct.updatesThanks || 'You’re on the list — we’ll email you when this moves along.'}</p>
      </div>
    );
  }
  return (
    <form className="updates-box" onSubmit={submit}>
      <div className="field-label" style={{ marginTop: 0 }}>📬 {ct.updatesPrompt || 'Want email updates on this?'}</div>
      <div className="updates-row">
        <input
          className="input"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          placeholder={ct.updatesPlaceholder || 'you@example.com'}
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <button className="btn btn-teal btn-small" type="submit" disabled={busy || !email.trim()}>
          {busy ? '…' : (ct.updatesButton || 'Email me updates')}
        </button>
      </div>
      <p className="updates-hint">{ct.updatesHint || 'We’ll only email you about this note — nothing else, ever.'}</p>
      {error && <div className="error-note" role="alert">{error}</div>}
    </form>
  );
}
