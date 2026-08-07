import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getToken } from '../api';
import { useActor } from './AdminApp';

// Ticket changes (status, routing, notes) happen on the central RAP board —
// this inbox is a read-only window over what guests submitted here.

const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const SEG = [
  { id: 'open', label: 'Open' },
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

const STATUS_CHIP = {
  new: { label: 'New', cls: 'st-new' },
  in_progress: { label: 'In progress', cls: 'st-prog' },
  resolved: { label: 'Resolved', cls: 'st-done' },
  closed: { label: 'Closed', cls: 'st-closed' },
};

// Departments Cindy is likely to have keep their signature colour; anything
// else cycles through the same family so every spine stays distinct.
const DEPT_KNOWN = {
  housekeeping: '#2A78D6',
  maintenance: '#EB6834',
  kitchen: '#1BAF7A',
  'food services': '#1BAF7A',
  program: '#EDA100',
  programs: '#EDA100',
};
const DEPT_CYCLE = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#7C5CD6', '#0E9CAD', '#D64F9E'];

// RAP's guest-mood scale runs 1 (delighted) → 5 (extremely upset).
const MOOD = {
  1: ['😊', 'Delighted'],
  2: ['🙂', 'Content'],
  3: ['😐', 'Neutral'],
  4: ['😠', 'Upset'],
  5: ['😡', 'Extremely upset'],
};

function timeAgo(date) {
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function waitAge(r) {
  const h = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
  const label = h < 1 ? `${Math.max(1, Math.floor(h * 60))}m` : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  const isOpen = ['new', 'in_progress'].includes(r.status);
  const cls = isOpen && h >= 12 ? 'age-late' : isOpen && h >= 4 ? 'age-warn' : '';
  return { label, cls };
}

function fmtReceived(ts) {
  return new Date(ts).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtHours(v) {
  if (v == null) return '0h';
  if (v >= 48) return `${Math.round(v / 24)}d`;
  return `${Math.round(v * 10) / 10}h`;
}

function fmtWhen(ts) {
  return new Date(ts).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
}

function Drawer({ id, onClose, boardBase }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.submission(id).then(setData).catch(() => onClose());
  }, [id, onClose]);

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

        {(s.held_until || s.rerouted_from || (s.first_response_due_at && !s.first_response_at && ['new', 'in_progress'].includes(s.status))) && (
          <div className="route-info">
            {s.held_until && <span>⏸ Held for opening — SLA clock starts {fmtWhen(s.held_until)}</span>}
            {s.rerouted_from && <span>🧭 Rerouted from {s.rerouted_from} (after hours)</span>}
            {!s.held_until && s.first_response_due_at && !s.first_response_at && ['new', 'in_progress'].includes(s.status) && (
              <span className={new Date(s.first_response_due_at) < new Date() ? 'overdue' : ''}>
                ⏱ First response due {fmtWhen(s.first_response_due_at)}
              </span>
            )}
          </div>
        )}
        {s.photo_path && (
          <a href={s.photo_path} target="_blank" rel="noreferrer">
            <img src={s.photo_path} alt="Guest photo" style={{ borderRadius: 12, maxHeight: 220 }} />
          </a>
        )}

        <dl className="kv">
          {s.rap_ticket_id && (
            <>
              <dt>RAP ticket</dt>
              <dd>
                #{s.rap_ticket_id}
                {s.rap_mood && MOOD[s.rap_mood] && <> · {MOOD[s.rap_mood][0]} {MOOD[s.rap_mood][1]}</>}
                {s.rap_severity && <> · severity {s.rap_severity}/5</>}
                {boardBase && (
                  <> · <a href={`${boardBase}/tickets/${s.rap_ticket_id}`} target="_blank" rel="noreferrer">open on the RAP board ↗</a></>
                )}
                {s.rap_synced_at && <span className="muted"> · synced {timeAgo(s.rap_synced_at)}</span>}
              </dd>
            </>
          )}
          <dt>Location</dt><dd>{s.location || s.location_text || '—'}</dd>
          <dt>Department</dt><dd>{s.department || 'Untriaged'}</dd>
          <dt>Assigned to</dt><dd>{s.assigned_name || 'Nobody'}</dd>
          <dt>Guest</dt><dd>{s.guest_name || 'Anonymous'}{s.group_name ? ` · ${s.group_name}` : ''}</dd>
          {(s.guest_email || s.guest_phone) && <><dt>Contact</dt><dd>{[s.guest_email, s.guest_phone].filter(Boolean).join(' · ')}</dd></>}
          <dt>Source</dt><dd>{s.source.toUpperCase()}</dd>
          {s.rating && <><dt>Guest rating</dt><dd>{'★'.repeat(s.rating)}{s.rating_comment ? ` — “${s.rating_comment}”` : ''}</dd></>}
        </dl>

        <div className="field-label">Timeline & notes</div>
        <ul className="timeline">
          {data.events.map(ev => (
            <li key={ev.id}>
              <div style={{ fontSize: 13.5, fontWeight: ev.kind === 'note' ? 400 : 600 }}>
                {ev.kind === 'note' ? <>📝 {ev.detail}</> : ev.kind === 'rap' ? <>🔁 {ev.detail}</> : ev.detail}
                {ev.admin_name && <span className="muted"> — {ev.admin_name}</span>}
              </div>
              <div className="when">{new Date(ev.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}

export default function Submissions() {
  const actor = useActor();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [openRowId, setOpenRowId] = useState(null);
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [settings, setSettings] = useState(null);
  const [rap, setRap] = useState(null);

  const filters = {
    status: searchParams.get('status') || 'open',
    category: searchParams.get('category') || '',
    location: searchParams.get('location') || '',
    type: searchParams.get('type') || '',
    urgency: searchParams.get('urgency') || '',
    q: searchParams.get('q') || '',
    sort: searchParams.get('sort') || '',
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
    api.rapStatus().then(setRap).catch(() => {});
  }, []);

  useEffect(() => {
    api.submissionStats().then(setStats).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.submissions({ ...filters, page })
      .then(d => { setRows(d.rows); setTotal(d.total); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, page]);
  useEffect(() => { load(); }, [load]);

  const deptColors = useMemo(() => {
    const map = {};
    departments.forEach((d, idx) => {
      map[d.name] = DEPT_KNOWN[d.name.trim().toLowerCase()] || DEPT_CYCLE[idx % DEPT_CYCLE.length];
    });
    return map;
  }, [departments]);

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
    <div className="rap-inbox">
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Inbox</div>
          <h1 className="display">Submissions</h1>
          <div className="sub">
            {total} matching · safety concerns float to the top · updates happen on the RAP board
            {rap?.mirror?.enabled && rap?.mirror?.keyConfigured ? ' and mirror back here automatically' : ''}
          </div>
        </div>
        {settings?.features?.csvExport && actor.can('export.csv') && (
          <div className="actions">
            <button className="btn btn-ghost btn-small" onClick={exportCsv}>⬇ Export CSV</button>
          </div>
        )}
      </div>

      <div className="rp-stats">
        <div className="rp-tile">
          <div className="l">Open</div>
          <div className={`v${stats?.new_count ? ' hot' : ''}`}>{stats ? stats.new_count : '—'}</div>
        </div>
        <div className="rp-tile">
          <div className="l">In progress</div>
          <div className="v">{stats ? stats.in_progress : '—'}</div>
        </div>
        <div className="rp-tile">
          <div className="l">Oldest waiting</div>
          <div className="v">{stats ? fmtHours(stats.oldest_open_h) : '—'}</div>
        </div>
        <div className="rp-tile">
          <div className="l">Median first action</div>
          <div className="v">{stats ? fmtHours(stats.median_first_action_h) : '—'}</div>
        </div>
        <div className="rp-tile">
          <div className="l">Resolved · 7d</div>
          <div className="v">{stats ? stats.resolved_7d : '—'}</div>
        </div>
      </div>

      <div className="rp-filterbar">
        <nav className="rp-seg" aria-label="Status filter">
          {SEG.map(s => (
            <button key={s.id} className={filters.status === s.id ? 'on' : ''}
              onClick={() => setFilter('status', s.id === 'open' ? '' : s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <select className="rp-fselect" data-active={!!filters.category} value={filters.category}
          onChange={e => setFilter('category', e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c.slug} value={c.slug}>{c.emoji} {c.name}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.location} value={filters.location}
          onChange={e => setFilter('location', e.target.value)}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l.slug} value={l.slug}>{l.name}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.type} value={filters.type}
          onChange={e => setFilter('type', e.target.value)}>
          <option value="">All types</option>
          {['issue', 'request', 'feedback', 'compliment'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.urgency} value={filters.urgency}
          onChange={e => setFilter('urgency', e.target.value)}>
          <option value="">Any urgency</option>
          {['safety', 'high', 'normal', 'low'].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.sort} value={filters.sort}
          onChange={e => setFilter('sort', e.target.value)}>
          <option value="">Sort: newest first</option>
          <option value="oldest">Sort: oldest first</option>
        </select>
        <input className="rp-fsearch" placeholder="Search message, code, name…" value={filters.q}
          onChange={e => setFilter('q', e.target.value)} />
      </div>

      {!rows && <div className="rp-panel"><div className="center-pad"><span className="spinner" /></div></div>}
      {rows && rows.length === 0 && (
        <div className="rp-panel"><div className="center-pad muted">Nothing here — adjust the filters or enjoy the quiet. 🌲</div></div>
      )}

      <ul className="rp-list">
        {rows && rows.map(r => {
          const expanded = openRowId === r.id;
          const age = waitAge(r);
          const chip = STATUS_CHIP[r.status] || STATUS_CHIP.new;
          const deptColor = r.department ? deptColors[r.department] || 'var(--rp-dept-none)' : 'var(--rp-dept-none)';
          return (
            <li key={r.id}>
              <div className="rp-panel rp-card" style={{ '--spine-color': deptColor }}>
                <button type="button" className="rp-rowhead" aria-expanded={expanded}
                  onClick={() => setOpenRowId(expanded ? null : r.id)}>
                  <div className="rp-rowline">
                    <span className="rp-cabin">{r.location || r.location_text || 'No location'}</span>
                    <span className="rp-dept">
                      <span className="rp-dot" style={{ background: deptColor }} />
                      {r.department || 'Untriaged'}
                    </span>
                    {r.category && <span className="rp-chip cat">{r.category_emoji} {r.category}</span>}
                    <span className="rp-rowright">
                      {r.type === 'compliment' && <span className="rp-mood" title="Compliment">💚</span>}
                      {r.photo_path && <span className="rp-mood" title="Photo attached">📷</span>}
                      {r.rap_mood && MOOD[r.rap_mood] && (
                        <span className="rp-mood" title={`Guest mood: ${MOOD[r.rap_mood][1]} (${r.rap_mood}/5)`}>{MOOD[r.rap_mood][0]}</span>
                      )}
                      {(r.urgency === 'safety' || r.urgency === 'high') && (
                        <span className={`rp-chip u-${r.urgency}`}>{r.urgency}</span>
                      )}
                      <span className={`rp-age ${age.cls}`} title="Time since received">{age.label}</span>
                      <span className={`rp-chip ${chip.cls}`}><span className="rp-dot" />{chip.label}</span>
                      <span className="rp-chev" aria-hidden="true">▸</span>
                    </span>
                  </div>
                  {!expanded && <p className="rp-preview">{r.ai_summary || r.message}</p>}
                  <p className="rp-meta">
                    {r.public_code} · received {fmtReceived(r.created_at)}
                    {r.rap_ticket_id ? ` · RAP #${r.rap_ticket_id}` : ''}
                    {r.guest_name ? ` · ${r.guest_name}` : ''}{r.group_name ? ` (${r.group_name})` : ''}
                  </p>
                </button>
                <div className="rp-reveal" data-open={expanded || undefined}>
                  <div className="rp-reveal-clip">
                    <div className="rp-detail">
                      <blockquote>“{r.message}”</blockquote>
                      {r.ai_summary && <p className="rp-ai">✨ <strong>AI summary:</strong> {r.ai_summary}</p>}
                      {(r.rap_mood || r.rap_severity) && (
                        <p className="rp-subline">
                          {r.rap_mood && MOOD[r.rap_mood] && <>{MOOD[r.rap_mood][0]} Guest mood {MOOD[r.rap_mood][1]} ({r.rap_mood}/5)</>}
                          {r.rap_mood && r.rap_severity ? ' · ' : ''}
                          {r.rap_severity && <>Severity {r.rap_severity}/5</>}
                        </p>
                      )}
                      <p className="rp-subline">
                        {r.guest_name || 'Anonymous'}{r.group_name ? ` · ${r.group_name}` : ''} · via {r.source.toUpperCase()}
                        {r.rating ? ` · rated ${'★'.repeat(r.rating)}` : ''}
                      </p>
                      <button className="rp-btn rp-openfull" onClick={() => setOpenId(r.id)}>
                        Full ticket · notes & history →
                      </button>
                      {r.rap_ticket_id && rap?.mirror?.boardBase && (
                        <a className="rp-btn" style={{ marginLeft: 8 }} href={`${rap.mirror.boardBase}/tickets/${r.rap_ticket_id}`}
                          target="_blank" rel="noreferrer">
                          Open on the RAP board ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="rp-pager">
          <button className="rp-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Page {page} / {pages}</span>
          <button className="rp-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      <p className="rp-foot">Reports arrive via the QR signs posted at each location</p>

      {openId && <Drawer id={openId} onClose={() => setOpenId(null)} boardBase={rap?.mirror?.boardBase} />}
    </div>
  );
}
