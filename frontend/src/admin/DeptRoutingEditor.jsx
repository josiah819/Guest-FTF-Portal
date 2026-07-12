import React, { useState } from 'react';
import { api } from '../api';

// Per-department: weekly hours, after-hours policy, fallback chain, on-call,
// SLA overrides. Rendered inside the Departments tab for routing.manage users.

const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

const POLICIES = [
  { id: 'urgency_based', label: 'Urgency-based (recommended)', desc: 'Safety/high reroute to the fallback right away; normal/low wait for opening with the SLA clock paused.' },
  { id: 'reroute', label: 'Always reroute', desc: 'Everything that arrives after hours goes straight to the fallback.' },
  { id: 'hold', label: 'Always hold', desc: 'Everything waits for opening; the SLA clock starts then.' },
];

export default function DeptRoutingEditor({ dept, departments, assignees, onSaved, setToast }) {
  const [draft, setDraft] = useState(() => ({
    hours: dept.hours || null,
    afterHours: dept.after_hours || 'urgency_based',
    fallbackDepartmentId: dept.fallback_department_id || '',
    onCallUserId: dept.on_call_user_id || '',
    slaResponseHours: dept.sla_response_hours || '',
    slaResolutionHours: dept.sla_resolution_hours || '',
  }));
  const [saving, setSaving] = useState(false);
  const alwaysOpen = !draft.hours;

  function setDay(day, window) {
    setDraft(d => {
      const hours = { ...(d.hours || {}) };
      hours[day] = window;
      // If every day just went closed, treat it as "no hours set" (24/7).
      const anyOpen = DAYS.some(([k]) => Array.isArray(hours[k]));
      return { ...d, hours: anyOpen ? hours : null };
    });
  }

  function toggleAlwaysOpen() {
    setDraft(d => d.hours
      ? { ...d, hours: null }
      : {
          ...d,
          hours: Object.fromEntries(DAYS.map(([k]) => [k, ['mon', 'tue', 'wed', 'thu', 'fri'].includes(k) ? ['08:00', '17:00'] : null])),
        });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api.updateDepartmentRouting(dept.id, draft);
      onSaved(res.row);
      setToast(`${dept.name}: hours & routing saved.`);
    } catch (err) {
      setToast(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dept-routing">
      <div className="toggle-row" style={{ paddingTop: 0 }}>
        <div>
          <div className="t">Open 24/7</div>
          <div className="d">No hours set — submissions always land here immediately.</div>
        </div>
        <button className={`switch${alwaysOpen ? ' on' : ''}`} onClick={toggleAlwaysOpen} aria-label="Toggle 24/7" />
      </div>

      {!alwaysOpen && (
        <div className="hours-grid">
          {DAYS.map(([key, label]) => {
            const w = Array.isArray(draft.hours?.[key]) ? draft.hours[key] : null;
            return (
              <div className="hours-row" key={key}>
                <label className="hours-row__day">
                  <input type="checkbox" checked={!!w}
                    onChange={e => setDay(key, e.target.checked ? ['08:00', '17:00'] : null)} />
                  {label}
                </label>
                {w ? (
                  <span className="hours-row__times">
                    <input type="time" className="input" value={w[0]} onChange={e => setDay(key, [e.target.value, w[1]])} />
                    –
                    <input type="time" className="input" value={w[1]} onChange={e => setDay(key, [w[0], e.target.value])} />
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>Closed</span>
                )}
              </div>
            );
          })}
          <p className="hint" style={{ margin: '6px 0 0' }}>
            One window per day, no overnight spans (e.g. 20:00–02:00) — split those across the two days.
          </p>
        </div>
      )}

      <div className="field-label">When a submission arrives outside these hours</div>
      {POLICIES.map(p => (
        <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6, cursor: 'pointer' }}>
          <input type="radio" name={`policy-${dept.id}`} checked={draft.afterHours === p.id}
            onChange={() => setDraft(d => ({ ...d, afterHours: p.id }))} />
          <span style={{ fontSize: 13.5 }}><strong>{p.label}</strong> — <span className="muted">{p.desc}</span></span>
        </label>
      ))}

      <div className="form-grid" style={{ marginTop: 10 }}>
        <div>
          <label>Fallback department (for reroutes)</label>
          <select className="input" value={draft.fallbackDepartmentId}
            onChange={e => setDraft(d => ({ ...d, fallbackDepartmentId: e.target.value }))}>
            <option value="">None</option>
            {departments.filter(d => d.active && d.id !== dept.id).map(d =>
              <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label>On-call person (when every route is closed)</label>
          <select className="input" value={draft.onCallUserId}
            onChange={e => setDraft(d => ({ ...d, onCallUserId: e.target.value }))}>
            <option value="">None</option>
            {assignees.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
        </div>
        <div>
          <label>SLA override: first response (h)</label>
          <input className="input" type="number" min="1" max="720" placeholder="inherit"
            value={draft.slaResponseHours}
            onChange={e => setDraft(d => ({ ...d, slaResponseHours: e.target.value }))} />
        </div>
        <div>
          <label>SLA override: resolution (h)</label>
          <input className="input" type="number" min="1" max="720" placeholder="inherit"
            value={draft.slaResolutionHours}
            onChange={e => setDraft(d => ({ ...d, slaResolutionHours: e.target.value }))} />
        </div>
      </div>

      <button className="btn btn-teal btn-small" style={{ marginTop: 12 }} disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save hours & routing'}
      </button>
    </div>
  );
}
