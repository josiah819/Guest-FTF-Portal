import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';

function QRCanvas({ url }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      // Big bitmap so the ~2.8in printed code stays crisp (~300 dpi); the
      // white plate around it supplies the quiet zone.
      QRCode.toCanvas(ref.current, url, {
        width: 840,
        margin: 0,
        color: { dark: '#006134', light: '#FFFFFF' },
      });
    }
  }, [url]);
  return <canvas ref={ref} />;
}

// One printed Letter page per location, matching the official
// “Report a Problem” sign design (geometry lifted from the print PDF).
function Sign({ row, origin }) {
  const host = origin.replace(/^https?:\/\//, '');
  return (
    <div className="sign">
      <img className="sign__logo" src="/brand/mw-logo-white.png" alt="Muskoka Woods — est. 1979" />
      <h2 className="sign__title">Report a<br />Problem</h2>
      <p className="sign__sub">Anything wrong with your space?<br />Tell us and we’ll fix it.</p>
      <div className="sign__qr"><QRCanvas url={`${origin}/?loc=${row.slug}`} /></div>
      <p className="sign__scan">Scan to report it.</p>
      <p className="sign__easy">No app. No sign-in. No name needed.</p>
      <div className="sign__loc">{row.name}</div>
      <p className="sign__note">This code is fixed to this space · {host}/?loc={row.slug}</p>
      <span className="sign__tree sign__tree--left" aria-hidden="true" />
      <span className="sign__tree sign__tree--right" aria-hidden="true" />
    </div>
  );
}

export default function LocationsQR() {
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState(null);
  const [newName, setNewName] = useState('');
  const [newArea, setNewArea] = useState('Cabins');
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => api.catalog('locations').then(d => setRows(d.rows));
  useEffect(() => {
    load();
    api.settings().then(d => setSettings(d.settings));
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

  if (!rows) return <div className="center-pad"><span className="spinner" /></div>;

  const visible = rows.filter(r => showInactive || r.active);
  const areas = [...new Set(rows.map(r => r.area))];
  const qrEnabled = settings?.features?.qrGenerator !== false;
  const origin = window.location.origin;

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
                <Sign row={r} origin={origin} />
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
