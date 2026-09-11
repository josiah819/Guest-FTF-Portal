import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getToken } from '../api';
import useSoftReload from '../useSoftReload';
import { useActor } from './AdminApp';

// The RAP board is the system of record — this inbox is a read-only window
// over its synced ticket cache. Statuses, categories and departments appear
// exactly as RAP spells them; ticket work happens on the board and syncs back
// within a minute.

const STATUS_CHIP = {
  open: { label: 'New', cls: 'st-new' },
  in_progress: { label: 'In progress', cls: 'st-prog' },
  resolved: { label: 'Resolved', cls: 'st-done' },
  closed: { label: 'Closed', cls: 'st-closed' },
};

// Labels RAP is likely to use keep their signature colour; anything else
// cycles through the same family so every spine stays distinct.
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

// RAP labels are slugs ("food_services") — prettify for display only, never
// for filtering (filters must send the verbatim value back).
const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

const statusChip = (status) =>
  STATUS_CHIP[status] || { label: pretty(status), cls: 'st-new' };

function timeAgo(date) {
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function waitAge(r) {
  const h = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
  const label = h < 1 ? `${Math.max(1, Math.floor(h * 60))}m` : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  const isOpen = ['open', 'in_progress'].includes(r.status);
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

function Drawer({ id, onClose, onGone, boardBase }) {
  const [data, setData] = useState(null);
  const [gone, setGone] = useState(false);

  // 404 = the ticket was deleted on the RAP board (the sync pruned it): say
  // so, and let the inbox refresh so the row disappears with it. Any other
  // failure just leaves whatever was last shown.
  const markGone = (err) => {
    if (err?.status !== 404) return;
    setGone(true);
    onGone?.();
  };

  useEffect(() => {
    api.submission(id).then(setData).catch(markGone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // An open ticket keeps up with the board; transient failures don't close it.
  useSoftReload(() => {
    api.submission(id).then(setData).catch(markGone);
  });

  if (gone) return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Ticket #${id}`}>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
        <div className="kicker" style={{ color: 'var(--orange)' }}>RAP #{id}</div>
        <h2 className="display">This ticket is no longer on the RAP board</h2>
        <p className="muted">
          It was deleted there, so it has been removed from this inbox too. The guest’s tracking
          link now shows a “no longer available” notice, and no further update emails will go out.
        </p>
        <button className="rp-btn" onClick={onClose}>Back to the inbox</button>
      </aside>
    </>
  );

  if (!data) return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer"><div className="center-pad"><span className="spinner" /></div></div>
    </>
  );

  const s = data.submission;
  const chip = statusChip(s.status);
  const history = Array.isArray(s.history) ? s.history : [];
  const guestNotes = Array.isArray(s.guest_notes) ? s.guest_notes : [];
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Ticket ${s.public_code || `#${s.id}`}`}>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
        <div className="kicker" style={{ color: 'var(--orange)' }}>
          {s.public_code ? `${s.public_code} · ` : ''}RAP #{s.id} · {timeAgo(s.created_at)}
        </div>
        <h2 className="display">🏷 {s.category ? pretty(s.category) : 'Uncategorized'}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className={`badge s-${s.status}`}>{chip.label}</span>
          {s.severity && <span className={`badge ${s.severity >= 5 ? 'u-safety' : s.severity >= 4 ? 'u-high' : 'u-normal'}`}>severity {s.severity}/5</span>}
          {s.mood && MOOD[s.mood] && <span className="badge">{MOOD[s.mood][0]} {MOOD[s.mood][1]}</span>}
          {!s.from_woodsvoice && <span className="badge">from another source</span>}
        </div>

        {s.message && <div className="msg-full">{s.message}</div>}
        {s.summary && <div className="ai-line"><span>✨</span><span><strong>RAP summary:</strong> {s.summary}</span></div>}
        {s.photo_path && (
          <a href={s.photo_path} target="_blank" rel="noreferrer">
            <img src={s.photo_path} alt="Guest photo" style={{ borderRadius: 12, maxHeight: 220 }} />
          </a>
        )}

        <dl className="kv">
          <dt>RAP ticket</dt>
          <dd>
            #{s.id}
            {boardBase && (
              <> · <a href={`${boardBase}/tickets/${s.id}`} target="_blank" rel="noreferrer">open on the RAP board ↗</a></>
            )}
            {s.synced_at && <span className="muted"> · synced {timeAgo(s.synced_at)}</span>}
          </dd>
          <dt>Location</dt><dd>{s.building || s.location_name || '—'}</dd>
          <dt>Department</dt><dd>{s.department ? pretty(s.department) : 'Untriaged'}</dd>
          <dt>Guest</dt><dd>{s.guest_name || 'Anonymous'}{s.group_name ? ` · ${s.group_name}` : ''}</dd>
          {(s.guest_email || s.guest_phone) && <><dt>Contact</dt><dd>{[s.guest_email, s.guest_phone].filter(Boolean).join(' · ')}</dd></>}
          {s.from_woodsvoice && (
            <>
              <dt>Source</dt><dd>WoodsVoice · {String(s.source || 'qr').toUpperCase()}
                {s.updates_on ? ' · guest gets email updates' : ''}</dd>
              <dt>Delivery</dt><dd>{s.delivery_status === 'sent' ? `delivered ${timeAgo(s.sent_at)}` : s.delivery_status}
                {s.delivery_error ? ` — ${s.delivery_error}` : ''}</dd>
            </>
          )}
          {s.rating && <><dt>Guest rating</dt><dd>{'★'.repeat(s.rating)}{s.rating_comment ? ` — “${s.rating_comment}”` : ''}</dd></>}
        </dl>

        {guestNotes.length > 0 && (
          <>
            <div className="field-label">Messages to the guest</div>
            <ul className="timeline">
              {guestNotes.map((n, i) => (
                <li key={i}>
                  <div style={{ fontSize: 13.5 }}>💬 {n.text}</div>
                  {n.at && <div className="when">{new Date(n.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="field-label">Board history</div>
        {history.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>Nothing yet — history syncs from the RAP board.</p>}
        <ul className="timeline">
          {history.map((ev, i) => (
            <li key={i}>
              <div style={{ fontSize: 13.5 }}>🔁 {ev.text}</div>
              {ev.at && <div className="when">{new Date(ev.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
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
  const [settings, setSettings] = useState(null);
  const [rap, setRap] = useState(null);

  const filters = {
    status: searchParams.get('status') || 'active',
    category: searchParams.get('category') || '',
    department: searchParams.get('department') || '',
    severity: searchParams.get('severity') || '',
    origin: searchParams.get('origin') || '',
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
    api.settings().then(d => setSettings(d.settings));
    api.rapStatus().then(setRap).catch(() => {});
    api.submissionStats().then(setStats).catch(() => {});
  }, []);

  // Deep link from a push notification: ?open=<id> opens the ticket drawer,
  // then drops the param so a refresh doesn't re-open it. Runs on every param
  // change — a notification click may navigate an already-open inbox tab.
  useEffect(() => {
    const open = parseInt(searchParams.get('open'), 10);
    if (open) {
      setOpenId(open);
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const load = useCallback(() => {
    api.submissions({ ...filters, page })
      .then(d => { setRows(d.rows); setTotal(d.total); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, page]);
  useEffect(() => { load(); }, [load]);

  // The board syncs in server-side every minute — pull it through to the
  // inbox without touching filters or whichever row is expanded.
  useSoftReload(() => {
    load();
    api.submissionStats().then(setStats).catch(() => {});
    api.rapStatus().then(setRap).catch(() => {});
  });

  const facets = stats?.facets || { statuses: [], categories: [], departments: [] };

  // Status segments: the RAP trio always shows; extra board statuses (e.g.
  // "closed") appear as segments only once they exist in the data.
  const seg = useMemo(() => {
    const known = ['open', 'in_progress', 'resolved'];
    const extra = (facets.statuses || []).filter(s => !known.includes(s));
    return [
      { id: 'active', label: 'Active' },
      { id: 'open', label: 'New' },
      { id: 'in_progress', label: 'In progress' },
      { id: 'resolved', label: 'Resolved' },
      ...extra.map(s => ({ id: s, label: pretty(s) })),
      { id: 'all', label: 'All' },
    ];
  }, [facets.statuses]);

  const deptColors = useMemo(() => {
    const map = {};
    (facets.departments || []).forEach((d, idx) => {
      map[d] = DEPT_KNOWN[pretty(d).trim().toLowerCase()] || DEPT_CYCLE[idx % DEPT_CYCLE.length];
    });
    return map;
  }, [facets.departments]);

  const boardBase = rap?.sync?.boardBase;
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
          <h1 className="display">Tickets</h1>
          <div className="sub">
            {total} matching · severity-5 concerns float to the top · the RAP board is the source of truth
            {rap?.sync?.enabled && rap?.sync?.keyConfigured && !rap?.sync?.halted ? ' — changes there sync here within a minute' : ''}
            {rap?.sync?.halted ? ' — sync paused, see Settings' : ''}
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
          <div className="l">New</div>
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
          {seg.map(s => (
            <button key={s.id} className={filters.status === s.id ? 'on' : ''}
              onClick={() => setFilter('status', s.id === 'active' ? '' : s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <select className="rp-fselect" data-active={!!filters.category} value={filters.category}
          onChange={e => setFilter('category', e.target.value)}>
          <option value="">All categories</option>
          {(facets.categories || []).map(c => <option key={c} value={c}>{pretty(c)}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.department} value={filters.department}
          onChange={e => setFilter('department', e.target.value)}>
          <option value="">All departments</option>
          {(facets.departments || []).map(d => <option key={d} value={d}>{pretty(d)}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.severity} value={filters.severity}
          onChange={e => setFilter('severity', e.target.value)}>
          <option value="">Any severity</option>
          {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>severity {n}</option>)}
        </select>
        <select className="rp-fselect" data-active={!!filters.origin} value={filters.origin}
          onChange={e => setFilter('origin', e.target.value)}>
          <option value="">Any source</option>
          <option value="woodsvoice">Submitted here</option>
          <option value="other">Other sources</option>
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
          const chip = statusChip(r.status);
          const deptColor = r.department ? deptColors[r.department] || 'var(--rp-dept-none)' : 'var(--rp-dept-none)';
          return (
            <li key={r.id}>
              <div className="rp-panel rp-card" style={{ '--spine-color': deptColor }}>
                <button type="button" className="rp-rowhead" aria-expanded={expanded}
                  onClick={() => setOpenRowId(expanded ? null : r.id)}>
                  <div className="rp-rowline">
                    <span className="rp-cabin">{r.building || r.location_name || 'No location'}</span>
                    <span className="rp-dept">
                      <span className="rp-dot" style={{ background: deptColor }} />
                      {r.department ? pretty(r.department) : 'Untriaged'}
                    </span>
                    {r.category && <span className="rp-chip cat">🏷 {pretty(r.category)}</span>}
                    <span className="rp-rowright">
                      {r.photo_path && <span className="rp-mood" title="Photo attached">📷</span>}
                      {r.mood && MOOD[r.mood] && (
                        <span className="rp-mood" title={`Guest mood: ${MOOD[r.mood][1]} (${r.mood}/5)`}>{MOOD[r.mood][0]}</span>
                      )}
                      {r.severity >= 4 && (
                        <span className={`rp-chip ${r.severity >= 5 ? 'u-safety' : 'u-high'}`}>sev {r.severity}</span>
                      )}
                      <span className={`rp-age ${age.cls}`} title="Time since received">{age.label}</span>
                      <span className={`rp-chip ${chip.cls}`}><span className="rp-dot" />{chip.label}</span>
                      <span className="rp-chev" aria-hidden="true">▸</span>
                    </span>
                  </div>
                  {!expanded && <p className="rp-preview">{r.summary || r.message}</p>}
                  <p className="rp-meta">
                    {r.public_code ? `${r.public_code} · ` : ''}RAP #{r.id} · received {fmtReceived(r.created_at)}
                    {r.guest_name ? ` · ${r.guest_name}` : ''}{r.group_name ? ` (${r.group_name})` : ''}
                    {!r.from_woodsvoice ? ' · from another source' : ''}
                  </p>
                </button>
                <div className="rp-reveal" data-open={expanded || undefined}>
                  <div className="rp-reveal-clip">
                    <div className="rp-detail">
                      {r.message && <blockquote>“{r.message}”</blockquote>}
                      {r.summary && <p className="rp-ai">✨ <strong>RAP summary:</strong> {r.summary}</p>}
                      {(r.mood || r.severity) && (
                        <p className="rp-subline">
                          {r.mood && MOOD[r.mood] && <>{MOOD[r.mood][0]} Guest mood {MOOD[r.mood][1]} ({r.mood}/5)</>}
                          {r.mood && r.severity ? ' · ' : ''}
                          {r.severity && <>Severity {r.severity}/5</>}
                        </p>
                      )}
                      <p className="rp-subline">
                        {r.from_woodsvoice
                          ? <>{r.guest_name || 'Anonymous'}{r.group_name ? ` · ${r.group_name}` : ''} · via {String(r.source || 'qr').toUpperCase()}</>
                          : <>Arrived on the RAP board from another source</>}
                        {r.rating ? ` · rated ${'★'.repeat(r.rating)}` : ''}
                      </p>
                      <button className="rp-btn rp-openfull" onClick={() => setOpenId(r.id)}>
                        Full ticket · history →
                      </button>
                      {boardBase && (
                        <a className="rp-btn" style={{ marginLeft: 8 }} href={`${boardBase}/tickets/${r.id}`}
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

      <p className="rp-foot">Tickets live on the RAP board — WoodsVoice adds the guest-facing capture, tracking and email layer</p>

      {openId && <Drawer id={openId} onClose={() => setOpenId(null)} onGone={load} boardBase={boardBase} />}
    </div>
  );
}
