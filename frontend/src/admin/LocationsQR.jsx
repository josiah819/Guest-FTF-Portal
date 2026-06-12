import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';

function QRCanvas({ url }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      QRCode.toCanvas(ref.current, url, {
        width: 300,
        margin: 1,
        color: { dark: '#1B4849', light: '#FFFFFF' },
      });
    }
  }, [url]);
  return <canvas ref={ref} />;
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

  if (!rows) return <div className="center-pad"><span className="spinner" /></div>;

  const visible = rows.filter(r => showInactive || r.active);
  const areas = [...new Set(rows.map(r => r.area))];
  const qrEnabled = settings?.features?.qrGenerator !== false;
  const origin = window.location.origin;

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>On-site</div>
          <h1 className="display">Locations & QR codes</h1>
          <div className="sub">Each location gets its own QR code — guests scan it and the form already knows where they are.</div>
        </div>
        {qrEnabled && (
          <div className="actions">
            <button className="btn btn-teal btn-small" onClick={() => window.print()}>🖨 Print QR sheet</button>
          </div>
        )}
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <h3>Manage locations</h3>
        <p className="hint">Deactivated locations disappear from the guest form but keep their history.</p>
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
              Print the sheet, cut out the cards, and post them in cabins and common areas.
              Scanning opens <code>{origin}/?loc=…</code> with the location pre-filled — one less thing for guests to type.
              For a lobby tablet, open <code>{origin}/?kiosk=1</code> (big buttons, resets after each submission).
            </p>
          </div>
          <div className="qr-grid">
            {rows.filter(r => r.active).map(r => (
              <div className="qr-card" key={r.id}>
                <QRCanvas url={`${origin}/?loc=${r.slug}`} />
                <div className="nm">{r.name}</div>
                <div className="ar">{r.area} · Muskoka Woods</div>
                <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>Scan to report an issue or send feedback</div>
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
