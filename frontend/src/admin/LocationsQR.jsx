import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { useActor } from './AdminApp';

// Mirrors DEFAULT_SETTINGS.content.sign in backend/src/db.js — the fallback
// while settings load and the target of "Reset to default".
const SIGN_DEFAULTS = {
  title: 'Report a\nProblem',
  subtitle: 'Anything wrong with your space?\nTell us and we’ll fix it.',
  scanLine: 'Scan to report it.',
  easyLine: 'No app. No sign-in. No name needed.',
  note: 'This code is fixed to this space',
  showUrl: true,
  qrShape: 'dots',
  qrCard: false,
};

// arcTo rather than the newer roundRect — a staff machine with an older
// browser should still get a printable code, not a blank canvas.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The code itself, drawn from the module matrix so the styling is ours:
// round dots or classic squares, in whatever colour the sign calls for.
// Error-correction Q buys back what the styling costs a scanner.
function SignQR({ url, shape, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'Q' });
    const n = modules.size;
    const px = 1240;                 // ~425 dpi at the printed size
    const cell = px / n;
    const ctx = canvas.getContext('2d');
    canvas.width = px;
    canvas.height = px;
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = color;
    const dots = shape !== 'squares';

    const inEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    ctx.beginPath();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!modules.data[r * n + c] || inEye(r, c)) continue;
        if (dots) {
          const cx = (c + 0.5) * cell;
          const cy = (r + 0.5) * cell;
          ctx.moveTo(cx + cell * 0.48, cy);
          ctx.arc(cx, cy, cell * 0.48, 0, Math.PI * 2);
        } else {
          ctx.rect(c * cell, r * cell, cell, cell);
        }
      }
    }
    ctx.fill();

    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const x = c0 * cell;
      const y = r0 * cell;
      const s = 7 * cell;
      ctx.beginPath();
      roundRectPath(ctx, x, y, s, s, dots ? cell * 1.9 : 0);
      roundRectPath(ctx, x + cell, y + cell, s - 2 * cell, s - 2 * cell, dots ? cell * 1.2 : 0);
      ctx.fill('evenodd');
      ctx.beginPath();
      roundRectPath(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, dots ? cell * 0.85 : 0);
      ctx.fill();
    }
  }, [url, shape, color]);
  return <canvas ref={ref} />;
}

// One printed Letter page per location. Exported so a headless harness can
// render the real thing for print/scan checks.
export function Sign({ row, origin, cfg }) {
  const host = origin.replace(/^https?:\/\//, '');
  return (
    <div className="sign">
      <img className="sign__logo" src="/brand/mw-logo-white.png" alt="Muskoka Woods — est. 1979" />
      {cfg.title ? <h2 className="sign__title">{cfg.title}</h2> : null}
      {cfg.subtitle ? <p className="sign__sub">{cfg.subtitle}</p> : null}
      <div className={`sign__qr${cfg.qrCard ? ' sign__qr--card' : ''}`}>
        <SignQR url={`${origin}/?loc=${row.slug}`} shape={cfg.qrShape} color={cfg.qrCard ? '#006134' : '#FFFFFF'} />
      </div>
      {cfg.scanLine ? <p className="sign__scan">{cfg.scanLine}</p> : null}
      {cfg.easyLine ? <p className="sign__easy">{cfg.easyLine}</p> : null}
      <span className="sign__rule" aria-hidden="true" />
      <div className="sign__loc">{row.name}</div>
      <p className="sign__note">{cfg.note}{cfg.showUrl ? `${cfg.note ? ' · ' : ''}${host}/?loc=${row.slug}` : ''}</p>
      <span className="sign__tree sign__tree--left" aria-hidden="true" />
      <span className="sign__tree sign__tree--right" aria-hidden="true" />
    </div>
  );
}

function SignEditor({ sign, setField, dirty, saving, onSave, onReset }) {
  return (
    <div className="card no-print" style={{ marginBottom: 16 }}>
      <h3>Sign editor</h3>
      <p className="hint">
        Edits preview below as you type — Save keeps them for everyone. Printing always uses what you
        see, saved or not. Location names come from the list above.
      </p>
      {/* everything locks while a save is in flight — an edit that slips in
          mid-request would be marked saved without ever being sent */}
      <div className="form-grid">
        <div className="form-col">
          <label>Headline</label>
          <textarea className="input" style={{ minHeight: 64 }} value={sign.title} disabled={saving}
            onChange={e => setField('title', e.target.value)} />
        </div>
        <div className="form-col">
          <label>Subtitle</label>
          <textarea className="input" style={{ minHeight: 64 }} value={sign.subtitle} disabled={saving}
            onChange={e => setField('subtitle', e.target.value)} />
        </div>
        <div className="form-col">
          <label>Scan prompt</label>
          <input className="input" value={sign.scanLine} disabled={saving}
            onChange={e => setField('scanLine', e.target.value)} />
        </div>
        <div className="form-col">
          <label>Reassurance line</label>
          <input className="input" value={sign.easyLine} disabled={saving}
            onChange={e => setField('easyLine', e.target.value)} />
        </div>
        <div className="form-col">
          <label>Fine print</label>
          <input className="input" value={sign.note} disabled={saving}
            onChange={e => setField('note', e.target.value)} />
        </div>
        <div className="form-col">
          <label>Code style</label>
          <select className="input" value={sign.qrShape} disabled={saving}
            onChange={e => setField('qrShape', e.target.value)}>
            <option value="dots">Rounded dots</option>
            <option value="squares">Classic squares</option>
          </select>
        </div>
      </div>
      <div className="toggle-row" style={{ marginTop: 4 }}>
        <div>
          <div className="t">Code on a white card</div>
          <div className="d">Prints the code dark-on-white — the safest bet for older phones and scanner apps.</div>
        </div>
        <button className={`switch${sign.qrCard ? ' on' : ''}`} aria-label="Toggle white card" disabled={saving}
          onClick={() => setField('qrCard', !sign.qrCard)} />
      </div>
      <div className="toggle-row">
        <div>
          <div className="t">Show the web address</div>
          <div className="d">Adds each location’s link to the fine print, for guests whose camera won’t cooperate.</div>
        </div>
        <button className={`switch${sign.showUrl ? ' on' : ''}`} aria-label="Toggle web address" disabled={saving}
          onClick={() => setField('showUrl', !sign.showUrl)} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <button className="btn btn-teal btn-small" onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save sign'}
        </button>
        <button className="btn btn-ghost btn-small" onClick={onReset} disabled={saving}>Reset to default</button>
        {dirty && <span className="muted">Unsaved changes</span>}
      </div>
    </div>
  );
}

export default function LocationsQR() {
  const actor = useActor();
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState(null);
  const [sign, setSignState] = useState(null);
  const [signDirty, setSignDirty] = useState(false);
  const [signSaving, setSignSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newArea, setNewArea] = useState('Cabins');
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => api.catalog('locations').then(d => setRows(d.rows));
  useEffect(() => {
    load();
    api.settings()
      .then(d => {
        setSettings(d.settings);
        setSignState({ ...SIGN_DEFAULTS, ...(d.settings.content?.sign || {}) });
      })
      .catch(() => setSignState({ ...SIGN_DEFAULTS }));
  }, []);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }

  async function add(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    await api.catalogCreate('locations', { name: newName.trim(), area: newArea.trim() || 'General' });
    setNewName('');
    await load();
    flash('Location added');
  }

  async function update(id, patch) {
    await api.catalogUpdate('locations', id, patch);
    await load();
  }

  async function remove(r) {
    if (!window.confirm(`Delete “${r.name}”? Its QR code stops working. Past submissions keep the name.`)) return;
    try {
      await api.catalogDelete('locations', r.id);
      await load();
      flash('Location deleted');
    } catch (err) {
      flash(err.message);
    }
  }

  function setSignField(key, value) {
    setSignState(s => ({ ...s, [key]: value }));
    setSignDirty(true);
  }

  async function saveSign() {
    setSignSaving(true);
    try {
      await api.saveSettings({ content: { sign } });
      setSignDirty(false);
      flash('Sign saved');
    } catch (err) {
      flash(err.message);
    } finally {
      setSignSaving(false);
    }
  }

  if (!rows) return <div className="center-pad"><span className="spinner" /></div>;

  const visible = rows.filter(r => showInactive || r.active);
  const areas = [...new Set(rows.map(r => r.area))];
  const qrEnabled = settings?.features?.qrGenerator !== false;
  const origin = window.location.origin;
  const cfg = sign || SIGN_DEFAULTS;

  return (
    <>
      <div className="admin-head no-print">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>On-site</div>
          <h1 className="display">Locations & QR codes</h1>
          <div className="sub">Each location gets its own QR sign — guests scan it and the form already knows where they are.</div>
        </div>
        {qrEnabled && (
          <div className="actions">
            <button className="btn btn-teal btn-small" onClick={() => window.print()}>🖨 Print signs</button>
          </div>
        )}
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <h3>Manage locations</h3>
        <p className="hint">Deactivated locations disappear from the guest form but keep their history. Deleting removes the location for good — past submissions keep its name.</p>
        <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="New location name (e.g. Cabin 11)"
            value={newName} onChange={e => setNewName(e.target.value)} />
          <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Area" list="areas"
            value={newArea} onChange={e => setNewArea(e.target.value)} />
          <datalist id="areas">{areas.map(a => <option key={a} value={a} />)}</datalist>
          <button className="btn btn-teal btn-small" type="submit">+ Add</button>
        </form>
        {visible.map(r => (
          <div className={`cat-row${r.active ? '' : ' inactive'}`} key={r.id}>
            <input className="input grow" defaultValue={r.name}
              onBlur={e => e.target.value !== r.name && update(r.id, { name: e.target.value })} />
            <input className="input mini" style={{ width: 130 }} defaultValue={r.area}
              onBlur={e => e.target.value !== r.area && update(r.id, { area: e.target.value })} />
            <button className={`switch${r.active ? ' on' : ''}`} title={r.active ? 'Active' : 'Hidden'}
              onClick={() => update(r.id, { active: !r.active })} aria-label="Toggle active" />
            <button className="link-danger" onClick={() => remove(r)}>Delete</button>
          </div>
        ))}
        <label className="muted" style={{ display: 'inline-flex', gap: 7, marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show deactivated
        </label>
      </div>

      {qrEnabled ? (
        <>
          {actor.can('content.manage') && sign && (
            <SignEditor sign={sign} setField={setSignField} dirty={signDirty} saving={signSaving}
              onSave={saveSign} onReset={() => { setSignState({ ...SIGN_DEFAULTS }); setSignDirty(true); }} />
          )}
          <div className="card no-print" style={{ marginBottom: 16, background: 'var(--teal-mist)', borderColor: 'var(--line-teal)' }}>
            <h3>How to use these</h3>
            <p style={{ margin: 0, fontSize: 14 }}>
              Print this page — each active location comes out as its own Letter-size “Report a Problem” sign,
              ready to laminate and post. Scanning opens <code>{origin}/?loc=…</code> with the location
              pre-filled — one less thing for guests to type.
              For a lobby tablet, open <code>{origin}/?kiosk=1</code> (big buttons, resets after each submission).
            </p>
          </div>
          <div className="sign-sheet">
            {rows.filter(r => r.active).map(r => (
              <div className="sign-wrap" key={r.id}>
                <Sign row={r} origin={origin} cfg={cfg} />
                {/* preview=1 keeps staff clicks out of the visit stats */}
                <a className="sign-preview no-print" href={`/?loc=${r.slug}&preview=1`} target="_blank" rel="noreferrer">Preview what guests see ↗</a>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card muted no-print">QR generator is switched off in Settings → Features.</div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
