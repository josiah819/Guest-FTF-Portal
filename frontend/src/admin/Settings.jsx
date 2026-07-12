import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useActor } from './AdminApp';
import ContentTab from './ContentTab';

const FIELD_DEFS = [
  { key: 'location', label: 'Location', hint: 'Pre-filled automatically when guests arrive via a location QR code; the picker only shows without one.' },
  { key: 'category', label: 'Category picker', hint: 'The tile grid. Leave off — the AI sorts every note into a category and department automatically.' },
  { key: 'urgency', label: 'Urgency', hint: 'Lets guests flag “today please” or safety themselves. Off = the AI grades urgency from the message.' },
  { key: 'photo', label: 'Photo upload', hint: 'A picture of the leaky tap beats three paragraphs about it.' },
  { key: 'name', label: 'Guest name', hint: 'Keep optional to allow anonymous feedback.' },
  { key: 'group', label: 'School / group', hint: 'Handy during multi-school weeks.' },
  { key: 'email', label: 'Email', hint: 'Only ask if you plan to reply.' },
  { key: 'phone', label: 'Phone', hint: 'Most camps leave this off.' },
];

const FEATURE_DEFS = [
  { key: 'aiCategorization', label: '✨ AI triage & routing', ai: true,
    desc: 'The AI reads each submission, works out what kind of note it is, picks the category, grades urgency, writes a one-line staff summary and routes it to the right department. Falls back to keyword matching if no AI provider is reachable.' },
  { key: 'aiInsights', label: '✨ AI insights on the dashboard', ai: true,
    desc: 'One click turns the last 30 days of feedback into a short list of trends and suggested actions.' },
  { key: 'submissionTypes', label: 'Submission type picker', desc: 'Guests label their note as an issue, request, feedback or shout-out. Off = the AI infers the type.' },
  { key: 'photoUpload', label: 'Photo uploads', desc: 'Allow guests to attach a photo (8 MB max). Also controlled per-field on the Form tab.' },
  { key: 'urgency', label: 'Urgency handling', desc: 'Safety-flagged items float to the top of the inbox and trigger the dashboard alert.' },
  { key: 'tracking', label: 'Submission tracking', desc: 'Guests get a code like MW-7KQ4F2 and a status page, which cuts down “did you get my note?” follow-ups.' },
  { key: 'csat', label: 'Guest satisfaction ratings', desc: 'Once a submission is resolved, the tracking page invites a 1–5 star rating. Feeds the dashboard CSAT metric.' },
  { key: 'kioskMode', label: 'Kiosk mode', desc: 'Big-button, auto-resetting version of the form at /?kiosk=1 — made for a lobby tablet.' },
  { key: 'hotspots', label: 'Hotspot detection', desc: 'Flags any location + category combo reported 2+ times in 7 days, so a recurring problem is impossible to miss.' },
  { key: 'sla', label: 'Response-time targets (SLA)', desc: 'Track first-response and resolution times against your targets; overdue items get called out.', extra: 'sla' },
  { key: 'csvExport', label: 'CSV export', desc: 'Download everything for deeper analysis in Excel or Power BI.' },
  { key: 'qrGenerator', label: 'QR code generator', desc: 'Print-ready QR cards per location on the Locations & QR page.' },
  { key: 'ftfForward', label: 'FTF hand-off (webhook)', desc: 'POST every new submission as JSON to your FTF intake endpoint so requests land in the existing workflow.', extra: 'ftf' },
  { key: 'emailForward', label: 'Email notifications', desc: 'Email the address below for every new submission. Needs SMTP configured on the server (see .env); without it, notifications are logged on the timeline instead.', extra: 'email' },
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
  const [draft, setDraft] = useState({ name: '', emoji: '📝', email: '', departmentId: '' });
  const load = () => api.catalog(table).then(d => setRows(d.rows));
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [table]);

  async function add(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const body = table === 'categories'
      ? { name: draft.name, emoji: draft.emoji || '📝', departmentId: draft.departmentId || null }
      : { name: draft.name, email: draft.email };
    await api.catalogCreate(table, body);
    setDraft({ name: '', emoji: '📝', email: '', departmentId: '' });
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
          ? 'What the AI sorts submissions into. Each category routes to a department.'
          : 'The teams submissions get routed to. Hours, fallbacks and SLA overrides live here too.'}
      </p>
      <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {table === 'categories' && (
          <input className="input" style={{ width: 64, textAlign: 'center' }} value={draft.emoji} maxLength={4}
            onChange={e => setDraft(d => ({ ...d, emoji: e.target.value }))} aria-label="Emoji" />
        )}
        <input className="input" style={{ flex: 2, minWidth: 150 }} placeholder={`New ${table.slice(0, -1)} name`}
          value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        {table === 'categories' ? (
          <select className="input" style={{ flex: 1, minWidth: 150 }} value={draft.departmentId}
            onChange={e => setDraft(d => ({ ...d, departmentId: e.target.value }))}>
            <option value="">Route to…</option>
            {departments.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        ) : (
          <input className="input" style={{ flex: 1, minWidth: 150 }} placeholder="Notification email (optional)"
            value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
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
          {table === 'categories' ? (
            <select className="input" style={{ width: 190 }} value={r.department_id || ''}
              onChange={e => update(r.id, { departmentId: e.target.value || null })}>
              <option value="">No department</option>
              {departments.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : (
            <input className="input" style={{ width: 190 }} placeholder="email" defaultValue={r.email}
              onBlur={e => e.target.value !== r.email && update(r.id, { email: e.target.value })} />
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
  { id: 'Content', perm: 'content.manage' },
  { id: 'Categories', perm: 'catalogs.manage' },
  { id: 'Departments', perm: 'catalogs.manage' },
  { id: 'General', perm: 'settings.manage' },
  { id: 'Account', perm: null },
];

// Tabs whose edits go through the save bar (vs. instant catalog edits).
const SAVE_TABS = ['Form fields', 'Features', 'Content', 'General'];

export default function Settings() {
  const actor = useActor();
  const tabs = TAB_DEFS.filter(t => !t.perm || actor.can(t.perm));

  const [s, setS] = useState(null);
  const [aiKey, setAiKey] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [tab, setTab] = useState(tabs[0].id);
  const [dirtySections, setDirtySections] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.settings().then(d => { setS(d.settings); setAiKey(d.aiKeyPresent); });
    api.catalog('departments').then(d => setDepartments(d.rows));
  }, []);

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

  // Nested updates (content.form.messageLabel, content.how.journey, …).
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
        <div className="actions">
          <span className="badge" style={{ background: aiKey ? '#E4F0CD' : '#F6E8D8', color: aiKey ? 'var(--green-dark)' : '#8A4A16' }}>
            {aiKey ? '✨ Claude API key detected' : '✨ No API key — keyword fallback'}
          </span>
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
          <p className="hint">“Off” hides the field entirely. The message box is always required — it’s the whole point. The default form is just message + name + photo; the AI infers everything else.</p>
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
          <p className="hint">Start small, switch things on as the team gets comfortable. Changes apply immediately.</p>
          {FEATURE_DEFS.map(f => (
            <div className="toggle-row" key={f.key}>
              <div style={{ flex: 1 }}>
                <div className="t">{f.label} {f.ai && !aiKey && <span className="badge u-high" style={{ marginLeft: 6 }}>needs an AI provider for full power</span>}</div>
                <div className="d">{f.desc}</div>
                {f.extra === 'sla' && s.features.sla && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                    <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      First response within
                      <input className="input" type="number" min="1" style={{ width: 76, padding: '6px 8px' }}
                        value={s.sla.firstResponseHours}
                        onChange={e => patch('sla', 'firstResponseHours', parseInt(e.target.value, 10) || 24)} /> h
                    </label>
                    <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Resolve within
                      <input className="input" type="number" min="1" style={{ width: 76, padding: '6px 8px' }}
                        value={s.sla.resolutionHours}
                        onChange={e => patch('sla', 'resolutionHours', parseInt(e.target.value, 10) || 72)} /> h
                    </label>
                  </div>
                )}
                {f.extra === 'ftf' && s.features.ftfForward && (
                  <input className="input" style={{ marginTop: 10 }} placeholder="https://ftf.muskokawoods.com/api/intake"
                    value={s.integrations.ftfWebhookUrl}
                    onChange={e => patch('integrations', 'ftfWebhookUrl', e.target.value)} />
                )}
                {f.extra === 'email' && s.features.emailForward && (
                  <input className="input" style={{ marginTop: 10 }} placeholder="guestcare@muskokawoods.com"
                    value={s.integrations.notifyEmail}
                    onChange={e => patch('integrations', 'notifyEmail', e.target.value)} />
                )}
              </div>
              <button className={`switch${s.features[f.key] ? ' on' : ''}`}
                onClick={() => patch('features', f.key, !s.features[f.key])} aria-label={`Toggle ${f.label}`} />
            </div>
          ))}
        </div>
      )}

      {tab === 'Content' && (
        <ContentTab s={s} patch={patch} patchPath={patchPath} applySettings={applySettings} setToast={setToast} />
      )}

      {tab === 'Categories' && <CatalogEditor table="categories" departments={departments} />}
      {tab === 'Departments' && <CatalogEditor table="departments" departments={departments} />}

      {tab === 'General' && (
        <div className="card">
          <h3>Operations</h3>
          <div className="form-grid">
            <div><label>Timezone (department hours & SLA clocks)</label>
              <input className="input" value={s.general.timezone || 'America/Toronto'}
                onChange={e => patch('general', 'timezone', e.target.value)} placeholder="America/Toronto" /></div>
          </div>

          <h3 style={{ marginTop: 26 }}>Accountability</h3>
          <p className="hint">
            Shown on the dashboard’s SLA card and the Runbook page — “who monitors this?” should never
            depend on who you ask.
          </p>
          <div className="form-grid">
            <div><label>System owner (dept or person)</label>
              <input className="input" value={s.accountability?.systemOwner || ''}
                onChange={e => patch('accountability', 'systemOwner', e.target.value)} /></div>
            <div><label>App maintainer</label>
              <input className="input" value={s.accountability?.maintainer || ''}
                onChange={e => patch('accountability', 'maintainer', e.target.value)} /></div>
            <div><label>SLA monitor</label>
              <input className="input" value={s.accountability?.slaMonitor || ''}
                onChange={e => patch('accountability', 'slaMonitor', e.target.value)} /></div>
            <div><label>Review cadence</label>
              <input className="input" value={s.accountability?.reviewCadence || ''}
                onChange={e => patch('accountability', 'reviewCadence', e.target.value)} /></div>
          </div>
        </div>
      )}

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
