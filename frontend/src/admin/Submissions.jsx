import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getToken } from '../api';

const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

function timeAgo(date) {
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Drawer({ id, departments, categories, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.submission(id).then(setData).catch(() => onClose()), [id, onClose]);
  useEffect(() => { load(); }, [load]);

  async function patch(p) {
    setBusy(true);
    try {
      await api.updateSubmission(id, p);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function sendNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.addNote(id, note);
      setNote('');
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer"><div className="center-pad"><span className="spinner" /></div></div>
    </>
  );

  const s = data.submission;
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Submission ${s.public_code}`}>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
        <div className="kicker" style={{ color: 'var(--orange)' }}>{s.public_code} · {timeAgo(s.created_at)}</div>
        <h2 className="display">{s.category_emoji || '📝'} {s.category || 'Uncategorized'}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className={`badge t-${s.type}`}>{s.type}</span>
          <span className={`badge u-${s.urgency}`}>{s.urgency}</span>
          <span className={`badge s-${s.status}`}>{STATUSES.find(x => x.id === s.status)?.label}</span>
        </div>

        <div className="msg-full">{s.message}</div>
        {s.ai_summary && <div className="ai-line"><span>✨</span><span><strong>AI summary:</strong> {s.ai_summary}</span></div>}
        {s.photo_path && (
          <a href={s.photo_path} target="_blank" rel="noreferrer">
            <img src={s.photo_path} alt="Guest photo" style={{ borderRadius: 12, maxHeight: 220 }} />
          </a>
        )}

        <dl className="kv">
          <dt>Location</dt><dd>{s.location || s.location_text || '—'}</dd>
          <dt>Guest</dt><dd>{s.guest_name || 'Anonymous'}{s.group_name ? ` · ${s.group_name}` : ''}</dd>
          {(s.guest_email || s.guest_phone) && <><dt>Contact</dt><dd>{[s.guest_email, s.guest_phone].filter(Boolean).join(' · ')}</dd></>}
          <dt>Source</dt><dd>{s.source.toUpperCase()}</dd>
          {s.rating && <><dt>Guest rating</dt><dd>{'★'.repeat(s.rating)}{s.rating_comment ? ` — “${s.rating_comment}”` : ''}</dd></>}
        </dl>

        <div className="field-label" style={{ marginTop: 10 }}>Status</div>
        <div className="status-row">
          {STATUSES.map(st => (
            <button
              key={st.id}
              className={`btn btn-small ${s.status === st.id ? 'btn-teal' : 'btn-ghost'}`}
              disabled={busy || s.status === st.id}
              onClick={() => patch({ status: st.id })}
            >{st.label}</button>
          ))}
        </div>

        <div className="form-grid" style={{ marginTop: 6 }}>
          <div>
            <div className="field-label">Department</div>
            <select className="input" value={s.department_id || ''} disabled={busy}
              onChange={e => patch({ departmentId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {departments.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <div className="field-label">Category</div>
            <select className="input" value={s.category_id || ''} disabled={busy}
              onChange={e => patch({ categoryId: e.target.value || null })}>
              <option value="">Uncategorized</option>
              {categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="field-label">Urgency</div>
        <div className="status-row" style={{ margin: '0 0 8px' }}>
          {['low', 'normal', 'high', 'safety'].map(u => (
            <button key={u}
              className={`btn btn-small ${s.urgency === u ? 'btn-teal' : 'btn-ghost'}`}
              disabled={busy || s.urgency === u}
              onClick={() => patch({ urgency: u })}
            >{u}</button>
          ))}
        </div>

        <div className="field-label">Timeline & notes</div>
        <ul className="timeline">
          {data.events.map(ev => (
            <li key={ev.id}>
              <div style={{ fontSize: 13.5, fontWeight: ev.kind === 'note' ? 400 : 600 }}>
                {ev.kind === 'note' ? <>📝 {ev.detail}</> : ev.detail}
                {ev.admin_name && <span className="muted"> — {ev.admin_name}</span>}
              </div>
              <div className="when">{new Date(ev.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Add an internal note…" value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendNote()} />
          <button className="btn btn-teal btn-small" style={{ flexShrink: 0 }} disabled={busy || !note.trim()} onClick={sendNote}>Add</button>
        </div>
      </aside>
    </>
  );
}

export default function Submissions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [settings, setSettings] = useState(null);

  const filters = {
    status: searchParams.get('status') || 'open',
    category: searchParams.get('category') || '',
    location: searchParams.get('location') || '',
    type: searchParams.get('type') || '',
    urgency: searchParams.get('urgency') || '',
    q: searchParams.get('q') || '',
  };

  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
    setPage(1);
  }

  useEffect(() => {
    api.catalog('departments').then(d => setDepartments(d.rows));
    api.catalog('categories').then(d => setCategories(d.rows));
    api.catalog('locations').then(d => setLocations(d.rows));
    api.settings().then(d => setSettings(d.settings));
  }, []);

  const load = useCallback(() => {
    api.submissions({ ...filters, page })
      .then(d => { setRows(d.rows); setTotal(d.total); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, page]);
  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / 25));

  async function exportCsv() {
    const res = await fetch('/api/admin/export.csv', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `woodsvoice-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Inbox</div>
          <h1 className="display">Submissions</h1>
          <div className="sub">{total} matching · safety concerns float to the top</div>
        </div>
        {settings?.features?.csvExport && (
          <div className="actions">
            <button className="btn btn-ghost btn-small" onClick={exportCsv}>⬇ Export CSV</button>
          </div>
        )}
      </div>

      <div className="filters">
        <select className="input" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="open">Open (new + in progress)</option>
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="input" value={filters.category} onChange={e => setFilter('category', e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c.slug} value={c.slug}>{c.emoji} {c.name}</option>)}
        </select>
        <select className="input" value={filters.location} onChange={e => setFilter('location', e.target.value)}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l.slug} value={l.slug}>{l.name}</option>)}
        </select>
        <select className="input" value={filters.type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">All types</option>
          {['issue', 'request', 'feedback', 'compliment'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" value={filters.urgency} onChange={e => setFilter('urgency', e.target.value)}>
          <option value="">Any urgency</option>
          {['safety', 'high', 'normal', 'low'].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <input className="input" placeholder="Search message, code, name…" value={filters.q}
          onChange={e => setFilter('q', e.target.value)} />
      </div>

      <div className="card" style={{ padding: '4px 0' }}>
        {!rows && <div className="center-pad"><span className="spinner" /></div>}
        {rows && rows.length === 0 && <div className="center-pad muted">Nothing here — adjust the filters or enjoy the quiet. 🌲</div>}
        {rows && rows.map(r => (
          <div className="sub-row" key={r.id} onClick={() => setOpenId(r.id)} role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setOpenId(r.id)}>
            <div className="em">{r.category_emoji || '📝'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="msg">{r.ai_summary || r.message}</div>
              <div className="meta">
                {r.public_code} · {r.location || r.location_text || 'No location'} · {timeAgo(r.created_at)}
                {r.guest_name ? ` · ${r.guest_name}` : ''}{r.group_name ? ` (${r.group_name})` : ''}
                {r.photo_path ? ' · 📷' : ''}
                {r.rating ? ` · ${'★'.repeat(r.rating)}` : ''}
              </div>
            </div>
            <div className="right">
              <span className={`badge s-${r.status}`}>{STATUSES.find(x => x.id === r.status)?.label || r.status}</span>
              {(r.urgency === 'safety' || r.urgency === 'high') && <span className={`badge u-${r.urgency}`}>{r.urgency}</span>}
              {r.type === 'compliment' && <span className="badge t-compliment">💚</span>}
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Page {page} / {pages}</span>
          <button className="btn btn-ghost btn-small" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {openId && (
        <Drawer id={openId} departments={departments} categories={categories}
          onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </>
  );
}
