import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import useSoftReload from '../useSoftReload';
import { useActor } from './AdminApp';
import ContentTab from './ContentTab';

const FIELD_DEFS = [
  { key: 'location', label: 'Location', hint: 'Pre-filled automatically when guests arrive via a location QR code; the picker only shows without one.' },
  { key: 'category', label: 'Category picker', hint: 'The tile grid. Leave off — the RAP board’s triage sorts every note automatically; a guest’s pick just travels along as a hint.' },
  { key: 'urgency', label: 'Urgency', hint: 'Lets guests flag “today please” or safety themselves. Their pick is passed to the RAP board’s triage.' },
  { key: 'photo', label: 'Photo upload', hint: 'A picture of the leaky tap beats three paragraphs about it.' },
  { key: 'name', label: 'Guest name', hint: 'Keep optional to allow anonymous feedback.' },
  { key: 'group', label: 'School / group', hint: 'Handy during multi-school weeks.' },
  { key: 'email', label: 'Email', hint: 'Only ask if you plan to reply.' },
  { key: 'phone', label: 'Phone', hint: 'Most camps leave this off.' },
];

const FEATURE_DEFS = [
  { key: 'rapForward', label: 'RAP delivery (central intake)', extra: 'rap',
    desc: 'Deliver every captured note to the central Report-A-Problem board, which owns the ticket from there — triage, routing, status, notes. Needs RAP_INGEST_KEY on the server (.env). Switching this off only pauses delivery: notes keep queueing and go out when it’s back on.' },
  { key: 'rapMirror', label: 'RAP board sync (the inbox’s data source)', extra: 'rapSync',
    desc: 'Pull the RAP board back into a local cache once a minute — the inbox, dashboard, guest tracking page and status emails all read from it. Off = the inbox goes stale; leave this on.' },
  { key: 'aiInsights', label: '✨ AI insights on the dashboard', ai: true,
    desc: 'One click turns the last 30 days of board activity into a short list of trends and suggested actions.' },
  { key: 'submissionTypes', label: 'Submission type picker', desc: 'Guests label their note as an issue, request, feedback or shout-out; the label travels to the RAP board’s triage.' },
  { key: 'photoUpload', label: 'Photo uploads', desc: 'Allow guests to attach a photo (8 MB max). Also controlled per-field on the Form tab.' },
  { key: 'urgency', label: 'Guest urgency flag', desc: 'Shows the urgency selector on the form; the guest’s own grading is passed to the RAP board.' },
  { key: 'tracking', label: 'Submission tracking', desc: 'Guests get a code like MW-7KQ4F2 and a status page fed by the board sync, which cuts down “did you get my note?” follow-ups.' },
  { key: 'csat', label: 'Guest satisfaction ratings', desc: 'Once the board resolves a ticket, the tracking page invites a 1–5 star rating. Feeds the dashboard CSAT metric.' },
  { key: 'emailUpdates', label: 'Guest email updates', extra: 'emailUpdates',
    desc: 'After sending a note, guests can leave an email address and get a branded email as the board moves it along — picked up, resolved. The ask, the wording and the email templates are all editable on the Content tab.' },
  { key: 'kioskMode', label: 'Kiosk mode', desc: 'Big-button, auto-resetting version of the form at /?kiosk=1 — made for a lobby tablet.' },
  { key: 'hotspots', label: 'Hotspot detection', desc: 'Flags any location + category combo reported 2+ times in 7 days, so a recurring problem is impossible to miss.' },
  { key: 'csvExport', label: 'CSV export', desc: 'Download everything for deeper analysis in Excel or Power BI.' },
  { key: 'qrGenerator', label: 'QR code generator', desc: 'Print-ready QR cards per location on the Locations & QR page.' },
  { key: 'visitTracking', label: 'Visit tracking', desc: 'Counts guest-form opens by location and source (QR / kiosk / web) so the dashboard shows whether the QR cards are actually being scanned. No cookies, nothing personal stored.' },
];

function Tri({ value, onChange }) {
  return (
    <span className="tri">
      <button type="button" className={value === 'off' ? 'on off-state' : ''} onClick={() => onChange('off')}>Off</button>
      <button type="button" className={value === 'optional' ? 'on' : ''} onClick={() => onChange('optional')}>Optional</button>
      <button type="button" className={value === 'required' ? 'on req-state' : ''} onClick={() => onChange('required')}>Required</button>
    </span>
  );
}

function CatalogEditor({ table, departments }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({ name: '', emoji: '📝', departmentId: '' });
  const load = () => api.catalog(table).then(d => setRows(d.rows));
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [table]);
  useSoftReload(load);

  async function add(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const body = table === 'categories'
      ? { name: draft.name, emoji: draft.emoji || '📝', departmentId: draft.departmentId || null }
      : { name: draft.name };
    await api.catalogCreate(table, body);
    setDraft({ name: '', emoji: '📝', departmentId: '' });
    load();
  }
  async function update(id, patch) {
    await api.catalogUpdate(table, id, patch);
    load();
  }

  if (!rows) return <div className="center-pad"><span className="spinner" /></div>;
  return (
    <div className="card">
      <h3>{table === 'categories' ? 'Categories' : 'Departments'}</h3>
      <p className="hint">
        {table === 'categories'
          ? 'The guest form’s optional category picker. A guest’s pick travels to the RAP board as a triage hint — the board’s own categories are what the inbox shows.'
          : 'Used for department-scoped staff access: a teammate limited to “Housekeeping” sees the board tickets RAP routed to housekeeping. Routing itself happens on the RAP board.'}
      </p>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {table === 'categories' && (
          <input className="input" style={{ width: 64, textAlign: 'center' }} value={draft.emoji} maxLength={4}
            onChange={e => setDraft(d => ({ ...d, emoji: e.target.value }))} aria-label="Emoji" />
        )}
        <input className="input" style={{ flex: 2, minWidth: 150 }} placeholder={`New ${table.slice(0, -1)} name`}
          value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        {table === 'categories' && (
          <select className="input" style={{ flex: 1, minWidth: 150 }} value={draft.departmentId}
            onChange={e => setDraft(d => ({ ...d, departmentId: e.target.value }))}>
            <option value="">Group under…</option>
            {departments.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <button className="btn btn-teal btn-small" type="submit">+ Add</button>
      </form>
      {rows.map(r => (
        <div className={`cat-row${r.active ? '' : ' inactive'}`} key={r.id}>
          {table === 'categories' && (
            <input className="input" style={{ width: 56, textAlign: 'center' }} defaultValue={r.emoji}
              onBlur={e => e.target.value !== r.emoji && update(r.id, { emoji: e.target.value })} />
          )}
          <input className="input grow" defaultValue={r.name}
            onBlur={e => e.target.value !== r.name && update(r.id, { name: e.target.value })} />
          {table === 'categories' && (
            <select className="input" style={{ width: 190 }} value={r.department_id || ''}
              onChange={e => update(r.id, { departmentId: e.target.value || null })}>
              <option value="">No department</option>
              {departments.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <button className={`switch${r.active ? ' on' : ''}`} title={r.active ? 'Active' : 'Hidden'}
            onClick={() => update(r.id, { active: !r.active })} aria-label="Toggle active" />
        </div>
      ))}
    </div>
  );
}

function Account() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.changePassword(current, next);
      setMsg({ ok: true, text: 'Password updated.' });
      setCurrent(''); setNext('');
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }
  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h3>Change password</h3>
      <p className="hint">Temporary passwords should not survive their first sign-in.</p>
      <form onSubmit={submit}>
        <div className="form-col">
          <label>Current password</label>
          <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div className="form-col">
          <label>New password (8+ characters)</label>
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} />
        </div>
        {msg && <div className={msg.ok ? 'muted' : 'error-note'} style={{ marginBottom: 12, color: msg.ok ? 'var(--green-dark)' : undefined }}>{msg.text}</div>}
        <button className="btn btn-teal btn-small" disabled={!current || next.length < 8}>Update password</button>
      </form>
    </div>
  );
}

// Which tabs exist, and which permission unlocks each.
const TAB_DEFS = [
  { id: 'Form fields', perm: 'settings.manage' },
  { id: 'Features', perm: 'settings.manage' },
  { id: 'AI', perm: 'settings.manage' },
  { id: 'Content', perm: 'content.manage' },
  { id: 'Categories', perm: 'catalogs.manage' },
  { id: 'Departments', perm: 'catalogs.manage' },
  { id: 'Account', perm: null },
];

// Tabs whose edits go through the save bar (vs. instant catalog edits).
const SAVE_TABS = ['Form fields', 'Features', 'AI', 'Content'];

const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic API (Claude)',
    desc: 'Best quality. Needs ANTHROPIC_API_KEY on the server.' },
  { id: 'openai', label: 'Local / self-hosted model',
    desc: 'Any OpenAI-compatible endpoint — Ollama on an LXC, LM Studio, vLLM. Nothing leaves your network.' },
  { id: 'keywords', label: 'None',
    desc: 'Insights stay switched off — the dashboard button explains what’s missing.' },
];

function AiTab({ s, patch, aiKey }) {
  const ai = s.ai || {};
  return (
    <div className="card">
      <h3>Insights engine</h3>
      <p className="hint">
        Powers the dashboard’s “Generate insights” card. Ticket triage happens on the RAP board —
        this engine only reads the synced data to spot trends.
      </p>
      {AI_PROVIDERS.map(p => (
        <div className="toggle-row" key={p.id}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'baseline', cursor: 'pointer' }}>
              <input type="radio" name="ai-provider" checked={(ai.provider || 'anthropic') === p.id}
                onChange={() => patch('ai', 'provider', p.id)} />
              <span>
                <span className="t" style={{ display: 'block' }}>{p.label}
                  {p.id === 'anthropic' && (
                    <span className={`badge ${aiKey ? 's-resolved' : 'u-high'}`} style={{ marginLeft: 8 }}>
                      {aiKey ? 'key detected' : 'no API key on server'}
                    </span>
                  )}
                </span>
                <span className="d" style={{ display: 'block' }}>{p.desc}</span>
              </span>
            </label>
            {p.id === 'anthropic' && (ai.provider || 'anthropic') === 'anthropic' && (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <div><label>Model</label>
                  <input className="input" value={ai.anthropicModel || ''} placeholder="claude-haiku-4-5-20251001"
                    onChange={e => patch('ai', 'anthropicModel', e.target.value)} /></div>
              </div>
            )}
            {p.id === 'openai' && ai.provider === 'openai' && (
              <div className="form-grid" style={{ marginTop: 10 }}>
                <div><label>Base URL</label>
                  <input className="input" value={ai.openaiBaseUrl || ''} placeholder="http://10.0.12.50:11434"
                    onChange={e => patch('ai', 'openaiBaseUrl', e.target.value)} /></div>
                <div><label>Model</label>
                  <input className="input" value={ai.openaiModel || ''} placeholder="qwen3:4b"
                    onChange={e => patch('ai', 'openaiModel', e.target.value)} /></div>
                <div style={{ gridColumn: '1 / -1' }} className="hint">
                  Point it at Ollama’s port and the /v1 path is added automatically. If your endpoint needs a key,
                  set OPENAI_API_KEY in the server environment.
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Settings() {
  const actor = useActor();
  const tabs = TAB_DEFS.filter(t => !t.perm || actor.can(t.perm));

  const [s, setS] = useState(null);
  const [aiKey, setAiKey] = useState(false);
  const [smtpOk, setSmtpOk] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [tab, setTab] = useState(tabs[0].id);
  const [dirtySections, setDirtySections] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const [rap, setRap] = useState(null);
  const [syncTest, setSyncTest] = useState(null);
  const [syncTesting, setSyncTesting] = useState(false);

  useEffect(() => {
    api.settings().then(d => { setS(d.settings); setAiKey(d.aiKeyPresent); setSmtpOk(!!d.smtpConfigured); });
    api.catalog('departments').then(d => setDepartments(d.rows));
    api.rapStatus().then(setRap).catch(() => {});
  }, []);

  // `s` doubles as the form state, so it only refreshes while nothing is
  // dirty — checked again when the response lands, in case an edit started
  // while the request was in flight. The RAP readout is display-only and
  // always refreshes.
  const editGuard = useRef(false);
  editGuard.current = dirtySections.size > 0 || saving;
  useSoftReload(() => {
    api.rapStatus().then(setRap).catch(() => {});
    if (editGuard.current) return;
    api.settings().then(d => {
      if (editGuard.current) return;
      setS(d.settings);
      setAiKey(d.aiKeyPresent);
      setSmtpOk(!!d.smtpConfigured);
    }).catch(() => {});
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const markDirty = (section) => setDirtySections(prev => new Set(prev).add(section));

  function patch(section, key, value) {
    setS(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
    markDirty(section);
  }

  // Nested updates (content.form.messageLabel, content.track.title, …).
  function patchPath(section, path, value) {
    setS(prev => {
      const next = { ...prev, [section]: { ...prev[section] } };
      let obj = next[section];
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        obj[k] = Array.isArray(obj[k]) ? [...obj[k]] : { ...(obj[k] || {}) };
        obj = obj[k];
      }
      obj[path[path.length - 1]] = value;
      return next;
    });
    markDirty(section);
  }

  // A server response already saved (e.g. logo upload) replaces local state
  // without marking anything dirty.
  function applySettings(settings) {
    setS(settings);
    setToast('Saved.');
  }

  async function save() {
    setSaving(true);
    try {
      const body = {};
      for (const sec of dirtySections) body[sec] = s[sec];
      const res = await api.saveSettings(body);
      setS(res.settings);
      setDirtySections(new Set());
      setToast('Settings saved — the guest pages update instantly.');
    } catch (err) {
      setToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!s) return <div className="center-pad"><span className="spinner" /></div>;

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Control room</div>
          <h1 className="display">Settings</h1>
          <div className="sub">Decide what guests see, what’s required, and which features are switched on.</div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.id}</button>
        ))}
      </div>

      {tab === 'Form fields' && (
        <div className="card">
          <h3>Guest form fields</h3>
          <p className="hint">“Off” hides the field entirely. The message box is always required — it’s the whole point. The default form is just message + name + photo; the RAP board’s triage infers everything else.</p>
          <div className="toggle-row">
            <div>
              <div className="t">Message</div>
              <div className="d">What the guest wants to tell you.</div>
            </div>
            <span className="badge s-resolved">Always required</span>
          </div>
          {FIELD_DEFS.map(f => (
            <div className="toggle-row" key={f.key}>
              <div>
                <div className="t">{f.label}</div>
                <div className="d">{f.hint}</div>
              </div>
              <Tri value={s.fields[f.key] || 'off'} onChange={v => patch('fields', f.key, v)} />
            </div>
          ))}
        </div>
      )}

      {tab === 'Features' && (
        <div className="card">
          <h3>Optional features</h3>
          <p className="hint">The two RAP switches are the heart of the site — everything else layers on top. Changes apply immediately.</p>
          {FEATURE_DEFS.map(f => (
            <div className="toggle-row" key={f.key}>
              <div style={{ flex: 1 }}>
                <div className="t">{f.label} {f.ai && !aiKey && <span className="badge u-high" style={{ marginLeft: 6 }}>needs an AI provider</span>}</div>
                <div className="d">{f.desc}</div>
                {f.extra === 'rap' && s.features.rapForward !== false && (
                  <div className="hint" style={{ marginTop: 10 }}>
                    {!rap ? 'Checking delivery status…' : <>
                      {rap.keyConfigured
                        ? <>Key configured ✓ · delivers to {rap.endpoint}</>
                        : <>RAP_INGEST_KEY isn’t set on the server — notes are queueing and will deliver once it’s configured (see .env).</>}
                      <br />
                      Queue: {rap.counts.pending} waiting · {rap.counts.sent} delivered · {rap.counts.failed} rejected
                      {rap.lastSentAt && <> · last delivered {new Date(rap.lastSentAt).toLocaleString()}</>}
                      {rap.halted && <><br /><b style={{ color: 'var(--orange)' }}>Delivery halted ({rap.halted}) — fix RAP_INGEST_KEY and restart the backend; queued notes are safe.</b></>}
                      {!rap.halted && rap.lastError && <><br />Last error: {rap.lastError}</>}
                    </>}
                  </div>
                )}
                {f.extra === 'rapSync' && s.features.rapMirror !== false && (
                  <div className="hint" style={{ marginTop: 10 }}>
                    {!rap?.sync ? 'Checking sync status…' : <>
                      {rap.sync.keyConfigured
                        ? <>Key configured ✓ · reads {rap.sync.endpoint}</>
                        : <>No key on the server — set RAP_EXPORT_KEY (or reuse RAP_INGEST_KEY) in .env to start syncing.</>}
                      <br />
                      {rap.sync.cached} board tickets cached · {rap.sync.linked} submitted from here
                      {rap.sync.lastSyncAt && <> · last sync {new Date(rap.sync.lastSyncAt).toLocaleString()}</>}
                      {rap.sync.halted && <><br /><b style={{ color: 'var(--orange)' }}>Sync halted ({rap.sync.halted}) — the key likely isn’t authorized to read; ask the RAP operator, then hit Test sync.</b></>}
                      {!rap.sync.halted && rap.sync.lastError && <><br />Last error: {rap.sync.lastError}</>}
                      {actor.can('settings.manage') && (
                        <div style={{ marginTop: 8 }}>
                          <button className="btn btn-ghost btn-small" disabled={syncTesting}
                            onClick={async () => {
                              setSyncTesting(true);
                              setSyncTest(null);
                              try { setSyncTest(await api.rapSyncTest()); }
                              catch (err) { setSyncTest({ ok: false, error: err.message }); }
                              finally {
                                setSyncTesting(false);
                                // The probe can clear a halt and kick a sync server-side —
                                // refresh the readout so the banner tells the truth.
                                api.rapStatus().then(setRap).catch(() => {});
                              }
                            }}>
                            {syncTesting ? 'Testing…' : '⟳ Test sync'}
                          </button>
                          {syncTest && (
                            <span style={{ marginLeft: 8 }}>
                              {syncTest.ok
                                ? <>✓ {syncTest.ticketCount} tickets on the board · {syncTest.parsedCount} readable · {syncTest.withTextCount} carry the guest text · {syncTest.linkedCount} linked to ours{syncTest.statuses?.length ? <> · statuses: {syncTest.statuses.join(', ')}</> : null}</>
                                : <b style={{ color: 'var(--orange)' }}>✗ {syncTest.error}{syncTest.shape ? ` (response keys: ${[].concat(syncTest.shape).join(', ')})` : ''}</b>}
                            </span>
                          )}
                        </div>
                      )}
                    </>}
                  </div>
                )}
                {f.extra === 'emailUpdates' && s.features.emailUpdates !== false && (
                  <div className="hint" style={{ marginTop: 10 }}>
                    {smtpOk
                      ? <>SMTP configured ✓ — guests see the email option on the thank-you screen and their tracking page.</>
                      : <b style={{ color: 'var(--orange)' }}>SMTP isn’t configured on the server (SMTP_HOST… in .env) — the option stays hidden from guests until it is.</b>}
                  </div>
                )}
              </div>
              <button className={`switch${s.features[f.key] ? ' on' : ''}`}
                onClick={() => patch('features', f.key, !s.features[f.key])} aria-label={`Toggle ${f.label}`} />
            </div>
          ))}
        </div>
      )}

      {tab === 'AI' && <AiTab s={s} patch={patch} aiKey={aiKey} />}

      {tab === 'Content' && (
        <ContentTab s={s} patch={patch} patchPath={patchPath} applySettings={applySettings} setToast={setToast} />
      )}

      {tab === 'Categories' && <CatalogEditor table="categories" departments={departments} />}
      {tab === 'Departments' && <CatalogEditor table="departments" departments={departments} />}

      {tab === 'Account' && <Account />}

      {dirtySections.size > 0 && SAVE_TABS.includes(tab) && (
        <div className="save-bar">
          <span className="grow">Unsaved changes</span>
          <button className="btn btn-ghost btn-small" style={{ color: 'var(--paper)', borderColor: 'rgba(247,244,236,0.4)' }}
            onClick={() => { api.settings().then(d => { setS(d.settings); setDirtySections(new Set()); }); }}>Discard</button>
          <button className="btn btn-primary btn-small" style={{ width: 'auto' }} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
