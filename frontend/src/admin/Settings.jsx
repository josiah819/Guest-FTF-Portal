import React, { useEffect, useState } from 'react';
import { api } from '../api';

const FIELD_DEFS = [
  { key: 'location', label: 'Location', hint: 'Pre-filled automatically when guests arrive via a location QR code.' },
  { key: 'urgency', label: 'Urgency', hint: 'Lets guests flag “today please” or safety concerns themselves.' },
  { key: 'photo', label: 'Photo upload', hint: 'A picture of the leaky tap beats three paragraphs about it.' },
  { key: 'name', label: 'Guest name', hint: 'Keep optional to allow anonymous feedback.' },
  { key: 'group', label: 'School / group', hint: 'Handy during multi-school weeks.' },
  { key: 'email', label: 'Email', hint: 'Only ask if you plan to reply.' },
  { key: 'phone', label: 'Phone', hint: 'Most camps leave this off.' },
];

const FEATURE_DEFS = [
  { key: 'aiCategorization', label: '✨ AI categorization & routing', ai: true,
    desc: 'Claude reads each submission, picks the category, grades urgency, writes a one-line staff summary and routes it to the right department. Without an API key it falls back to keyword matching.' },
  { key: 'aiInsights', label: '✨ AI insights on the dashboard', ai: true,
    desc: 'One click turns the last 30 days of feedback into a short list of trends and suggested actions.' },
  { key: 'submissionTypes', label: 'Submission types', desc: 'Guests label their note as an issue, request, feedback or shout-out. Compliments get their own metric.' },
  { key: 'photoUpload', label: 'Photo uploads', desc: 'Allow guests to attach a photo (8 MB max). Also controlled per-field on the Form tab.' },
  { key: 'urgency', label: 'Urgency selector', desc: 'Safety-flagged items float to the top of the inbox and trigger the dashboard alert.' },
  { key: 'tracking', label: 'Submission tracking', desc: 'Guests get a code like MW-7KQ4F2 and a status page, which cuts down “did you get my note?” follow-ups.' },
  { key: 'csat', label: 'Guest satisfaction ratings', desc: 'Once a submission is resolved, the tracking page invites a 1–5 star rating. Feeds the dashboard CSAT metric.' },
  { key: 'kioskMode', label: 'Kiosk mode', desc: 'Big-button, auto-resetting version of the form at /?kiosk=1 — made for a lobby tablet.' },
  { key: 'hotspots', label: 'Hotspot detection', desc: 'Flags any location + category combo reported 2+ times in 7 days, so a recurring problem is impossible to miss.' },
  { key: 'sla', label: 'Response-time targets (SLA)', desc: 'Track average first-response and resolution times against your targets; overdue items get called out.', extra: 'sla' },
  { key: 'csvExport', label: 'CSV export', desc: 'Download everything for deeper analysis in Excel or Power BI.' },
  { key: 'qrGenerator', label: 'QR code generator', desc: 'Print-ready QR cards per location on the Locations & QR page.' },
  { key: 'ftfForward', label: 'FTF hand-off (webhook)', desc: 'POST every new submission as JSON to your FTF intake endpoint so requests land in the existing workflow.', extra: 'ftf' },
  { key: 'emailForward', label: 'Email notifications', desc: 'Queue an email notification per submission to the address below (logged in the submission timeline; wire to your SMTP relay in production).', extra: 'email' },
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
          ? 'What guests can pick from (and what the AI sorts into). Each category routes to a department.'
          : 'The teams submissions get routed to.'}
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
      <p className="hint">The default demo password should not survive its first real week.</p>
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

const TABS = ['Form fields', 'Features', 'Categories', 'Departments', 'General', 'Account'];

export default function Settings() {
  const [s, setS] = useState(null);
  const [aiKey, setAiKey] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [tab, setTab] = useState('Form fields');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.settings().then(d => { setS(d.settings); setAiKey(d.aiKeyPresent); });
    api.catalog('departments').then(d => setDepartments(d.rows));
  }, []);

  function patch(section, key, value) {
    setS(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api.saveSettings({
        general: s.general, fields: s.fields, features: s.features, sla: s.sla, integrations: s.integrations,
      });
      setS(res.settings);
      setDirty(false);
      setToast('Settings saved — the guest form updates instantly.');
      setTimeout(() => setToast(''), 2600);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(''), 2600);
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
        {TABS.map(t => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Form fields' && (
        <div className="card">
          <h3>Guest form fields</h3>
          <p className="hint">“Off” hides the field entirely. The message box is always required — it’s the whole point.</p>
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
              <Tri value={s.fields[f.key]} onChange={v => patch('fields', f.key, v)} />
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
                <div className="t">{f.label} {f.ai && !aiKey && <span className="badge u-high" style={{ marginLeft: 6 }}>needs API key for full power</span>}</div>
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

      {tab === 'Categories' && <CatalogEditor table="categories" departments={departments} />}
      {tab === 'Departments' && <CatalogEditor table="departments" departments={departments} />}

      {tab === 'General' && (
        <div className="card">
          <h3>Words & branding</h3>
          <p className="hint">Everything guest-facing is editable — keep the tone warm and camp-sized.</p>
          <div className="form-grid">
            <div><label>App name</label>
              <input className="input" value={s.general.appName} onChange={e => patch('general', 'appName', e.target.value)} /></div>
            <div><label>Organization</label>
              <input className="input" value={s.general.orgName} onChange={e => patch('general', 'orgName', e.target.value)} /></div>
            <div><label>Welcome title</label>
              <input className="input" value={s.general.welcomeTitle} onChange={e => patch('general', 'welcomeTitle', e.target.value)} /></div>
            <div><label>Welcome subtitle</label>
              <input className="input" value={s.general.welcomeSubtitle} onChange={e => patch('general', 'welcomeSubtitle', e.target.value)} /></div>
            <div><label>Success title</label>
              <input className="input" value={s.general.successTitle} onChange={e => patch('general', 'successTitle', e.target.value)} /></div>
            <div><label>Success message</label>
              <input className="input" value={s.general.successMessage} onChange={e => patch('general', 'successMessage', e.target.value)} /></div>
          </div>
          <div className="toggle-row" style={{ marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="t">Expectation banner</div>
              <div className="d">Cindy’s favourite feature: sets honest expectations so the QR codes never read as 24/7 room service.</div>
              {s.general.showExpectationBanner && (
                <textarea className="input" style={{ marginTop: 10, minHeight: 80 }}
                  value={s.general.expectationBanner}
                  onChange={e => patch('general', 'expectationBanner', e.target.value)} />
              )}
            </div>
            <button className={`switch${s.general.showExpectationBanner ? ' on' : ''}`}
              onClick={() => patch('general', 'showExpectationBanner', !s.general.showExpectationBanner)}
              aria-label="Toggle expectation banner" />
          </div>
        </div>
      )}

      {tab === 'Account' && <Account />}

      {dirty && ['Form fields', 'Features', 'General'].includes(tab) && (
        <div className="save-bar">
          <span className="grow">Unsaved changes</span>
          <button className="btn btn-ghost btn-small" style={{ color: 'var(--paper)', borderColor: 'rgba(247,244,236,0.4)' }}
            onClick={() => { api.settings().then(d => { setS(d.settings); setDirty(false); }); }}>Discard</button>
          <button className="btn btn-primary btn-small" style={{ width: 'auto' }} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
