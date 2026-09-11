import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useActor } from './AdminApp';
import { pushSupportState, enablePush, disablePush, healPush, getCurrentEndpoint } from './pushClient';

const EVENT_DEFS = [
  { key: 'newTicket', label: 'New ticket on the board',
    desc: 'A guest note (or anything else) landed on the RAP board as a fresh ticket.' },
  { key: 'resolved', label: 'Ticket resolved',
    desc: 'The board marked a ticket resolved or closed.' },
  { key: 'statusChanged', label: 'Other status moves',
    desc: 'Picked up, in progress, reopened — any move that isn’t a resolution.' },
  { key: 'guestNote', label: 'Note posted for a guest',
    desc: 'Someone on the board wrote a note the guest will see on their tracking page.' },
  { key: 'severity', label: 'Severity changes',
    desc: 'A ticket’s 1–5 severity was raised or lowered by the board’s triage.' },
  { key: 'deleted', label: 'Ticket removed from the board',
    desc: 'A ticket was deleted on the board and dropped from the inbox.' },
];

const SEVERITY_CHOICES = [
  { value: 0, label: 'Any severity' },
  { value: 3, label: 'Severity 3+' },
  { value: 4, label: 'Severity 4+' },
  { value: 5, label: 'Severity 5 only' },
];

export default function NotificationsTab({ setToast }) {
  const actor = useActor();
  const [config, setConfig] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [subs, setSubs] = useState([]);
  const [support, setSupport] = useState(pushSupportState());
  const [currentEndpoint, setCurrentEndpoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  async function reload() {
    const d = await api.pushPrefs();
    setPrefs(d.prefs);
    setSubs(d.subscriptions);
    setCurrentEndpoint(await getCurrentEndpoint());
    setSupport(pushSupportState());
  }

  useEffect(() => {
    let cancelled = false;
    api.pushConfig().then(async (c) => {
      if (cancelled) return;
      setConfig(c);
      // Re-align an already-granted browser with the server (key rotation,
      // pruned rows) before showing the device list.
      if (c.configured) await healPush(c.publicKey);
      if (!cancelled) await reload();
    }).catch(err => setToast(err.message));
    return () => { cancelled = true; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistic per-toggle save — no save bar; the server echoes back the
  // sanitized result.
  function save(next) {
    setPrefs(next);
    api.savePushPrefs(next)
      .then(d => { setPrefs(d.prefs); setToast('Saved.'); })
      .catch(err => setToast(err.message));
  }

  async function turnOn() {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await enablePush(config.publicKey);
      if (r === 'granted') {
        setToast('Notifications are on for this device.');
        await reload();
      } else {
        setSupport(pushSupportState());
      }
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setTestResult(null);
    try {
      await disablePush();
      setToast('Notifications are off for this device.');
      await reload();
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try { setTestResult(await api.pushTest()); }
    catch (err) { setTestResult({ error: err.message }); }
    finally { setTesting(false); }
  }

  async function removeDevice(endpoint) {
    try {
      await api.pushUnsubscribe(endpoint);
      await reload();
    } catch (err) {
      setToast(err.message);
    }
  }

  if (!config || !prefs) return <div className="center-pad"><span className="spinner" /></div>;

  const subscribedHere = !!currentEndpoint && subs.some(s => s.endpoint === currentEndpoint);
  const viewAll = actor.perms.includes('submissions.view_all');

  return (
    <>
      <div className="card">
        <h3>Push notifications on this device</h3>
        <p className="hint">
          Get a notification from the board even with this site closed. Notifications ride the board
          sync, so expect them within about 15 seconds of a change. Each device (phone, laptop,
          kiosk browser) turns them on separately.
        </p>

        {!config.configured && (
          <p className="hint"><b style={{ color: 'var(--orange)' }}>
            Push isn’t configured on the server — check the backend logs for [push] errors.
          </b></p>
        )}

        {config.configured && support === 'insecure' && (
          <p className="hint"><b style={{ color: 'var(--orange)' }}>
            Push needs a secure connection. Open https://woodsvoice.com — the plain-http LAN address
            can’t receive notifications.
          </b></p>
        )}

        {config.configured && support === 'unsupported' && (
          <p className="hint">This browser doesn’t support push notifications.</p>
        )}

        {config.configured && support === 'ios-needs-install' && (
          <p className="hint">
            On iPhone and iPad, add WoodsVoice to your Home Screen first (Share → Add to Home
            Screen), then open it from there and turn notifications on.
          </p>
        )}

        {config.configured && support === 'denied' && (
          <div className="toggle-row">
            <div style={{ flex: 1 }}>
              <div className="t">This device <span className="badge u-high" style={{ marginLeft: 6 }}>blocked in browser</span></div>
              <div className="d">
                Notifications are blocked for this site. Re-allow them in the browser’s site
                settings (the icon next to the address bar), then come back here.
              </div>
            </div>
          </div>
        )}

        {config.configured && (support === 'default' || support === 'granted') && (
          <div className="toggle-row">
            <div style={{ flex: 1 }}>
              <div className="t">
                This device
                {subscribedHere && <span className="badge s-resolved" style={{ marginLeft: 6 }}>on</span>}
              </div>
              <div className="d">
                {subscribedHere
                  ? 'This browser is receiving notifications.'
                  : 'Turn on to get board notifications on this browser.'}
              </div>
              {subscribedHere && (
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-ghost btn-small" disabled={testing} onClick={sendTest}>
                    {testing ? 'Sending…' : '🔔 Send test notification'}
                  </button>
                  {testResult && (
                    <span style={{ marginLeft: 8 }}>
                      {testResult.error
                        ? <b style={{ color: 'var(--orange)' }}>✗ {testResult.error}</b>
                        : <>✓ sent to {testResult.sent} device{testResult.sent === 1 ? '' : 's'}
                          {testResult.gone ? ` · ${testResult.gone} stale device removed` : ''}
                          {testResult.failed ? <b style={{ color: 'var(--orange)' }}> · {testResult.failed} failed</b> : ''}</>}
                    </span>
                  )}
                </div>
              )}
            </div>
            {busy
              ? <span className="spinner" />
              : subscribedHere
                ? <button className="btn btn-ghost btn-small" onClick={turnOff}>Turn off</button>
                : <button className="btn btn-teal btn-small" onClick={turnOn}>Turn on notifications</button>}
          </div>
        )}

        {subs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="field-label">Your subscribed devices</div>
            {subs.map(s => (
              <div className="toggle-row" key={s.id}>
                <div style={{ flex: 1 }}>
                  <div className="t">
                    {s.uaLabel || 'Unknown device'}
                    {s.endpoint === currentEndpoint && <span className="badge" style={{ marginLeft: 6 }}>this device</span>}
                  </div>
                  <div className="d">
                    Added {new Date(s.createdAt).toLocaleDateString()}
                    {s.lastUsedAt && <> · last notified {new Date(s.lastUsedAt).toLocaleString()}</>}
                  </div>
                </div>
                {s.endpoint !== currentEndpoint && (
                  <button className="btn btn-ghost btn-small" onClick={() => removeDevice(s.endpoint)}>Remove</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>What to notify me about</h3>
        <p className="hint">
          Applies to every device you’ve turned on above. Changes save instantly.
        </p>

        <div className="toggle-row">
          <div style={{ flex: 1 }}>
            <div className="t">Notifications</div>
            <div className="d">The master switch — off silences everything below without losing your choices.</div>
          </div>
          <button className={`switch${prefs.enabled ? ' on' : ''}`}
            onClick={() => save({ ...prefs, enabled: !prefs.enabled })} aria-label="Toggle notifications" />
        </div>

        {EVENT_DEFS.map(ev => (
          <div className="toggle-row" key={ev.key}>
            <div style={{ flex: 1 }}>
              <div className="t">{ev.label}</div>
              <div className="d">{ev.desc}</div>
            </div>
            <button className={`switch${prefs.events[ev.key] ? ' on' : ''}`} disabled={!prefs.enabled}
              onClick={() => save({ ...prefs, events: { ...prefs.events, [ev.key]: !prefs.events[ev.key] } })}
              aria-label={`Toggle ${ev.label}`} />
          </div>
        ))}

        <div className="toggle-row">
          <div style={{ flex: 1 }}>
            <div className="t">Minimum severity</div>
            <div className="d">Only notify about new tickets and severity changes at or above this level.</div>
          </div>
          <select className="input" style={{ width: 160 }} value={prefs.minSeverity} disabled={!prefs.enabled}
            onChange={e => save({ ...prefs, minSeverity: parseInt(e.target.value, 10) })}>
            {SEVERITY_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="toggle-row">
          <div style={{ flex: 1 }}>
            <div className="t">Only tickets in my departments</div>
            <div className="d">
              {viewAll
                ? 'Limit notifications to tickets the board routed to your departments.'
                : 'Your account already only sees its departments’ tickets — notifications follow the same rule.'}
            </div>
          </div>
          <button className={`switch${prefs.onlyMyDepartments ? ' on' : ''}`} disabled={!prefs.enabled || !viewAll}
            onClick={() => save({ ...prefs, onlyMyDepartments: !prefs.onlyMyDepartments })}
            aria-label="Toggle only my departments" />
        </div>
      </div>
    </>
  );
}
