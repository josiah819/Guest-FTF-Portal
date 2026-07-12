import React, { useRef, useState } from 'react';
import { api } from '../api';
import { BRAND_DEFAULTS } from '../theme';

// Settings → Content: every guest-facing word, label, page section, logo and
// colour. Edits are local until the save bar PUTs the dirty sections; list
// editors always produce complete arrays (the server replaces arrays wholesale).

function Section({ title, hint, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <button type="button" className="content-sec__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span>
          <span className="t">{title}</span>
          {hint && <span className="d">{hint}</span>}
        </span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

function TextRow({ label, value, onChange, area, placeholder }) {
  return (
    <div className="form-col">
      <label>{label}</label>
      {area
        ? <textarea className="input" style={{ minHeight: 64 }} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        : <input className="input" value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

// Generic list editor: add / remove / reorder rows of small field sets.
function ListEditor({ items, onChange, fields, addLabel }) {
  const list = items || [];
  const update = (i, key, value) => {
    const next = list.map((it, n) => n === i ? { ...it, [key]: value } : it);
    onChange(next);
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => onChange(list.filter((_, n) => n !== i));
  const add = () => onChange([...list, Object.fromEntries(fields.map(f => [f.key, '']))]);

  return (
    <div>
      {list.map((it, i) => (
        <div className="list-ed__row" key={i}>
          <div className="list-ed__fields">
            {fields.map(f => f.area
              ? <textarea key={f.key} className="input" style={{ minHeight: 56 }} placeholder={f.label}
                  value={it[f.key] || ''} onChange={e => update(i, f.key, e.target.value)} />
              : <input key={f.key} className="input" style={f.narrow ? { maxWidth: 110 } : undefined} placeholder={f.label}
                  value={it[f.key] || ''} onChange={e => update(i, f.key, e.target.value)} />)}
          </div>
          <div className="list-ed__ctl">
            <button type="button" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" title="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}>↓</button>
            <button type="button" title="Remove" className="danger" onClick={() => remove(i)}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-small" onClick={add}>{addLabel || '+ Add item'}</button>
    </div>
  );
}

function LabelTable({ title, hint, map, onChange }) {
  const entries = Object.entries(map || {});
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="field-label" style={{ marginTop: 0 }}>{title}</div>
      {hint && <p className="hint" style={{ marginTop: 2 }}>{hint}</p>}
      {entries.map(([key, label]) => (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <code style={{ width: 110, fontSize: 12, color: 'var(--ink-faint)' }}>{key}</code>
          <input className="input" style={{ flex: 1, padding: '7px 10px', fontSize: 13.5 }}
            value={label} onChange={e => onChange(key, e.target.value)} />
        </div>
      ))}
    </div>
  );
}

function LogoSlot({ label, hint, value, fallback, slot, onUploaded, onError, dark }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.uploadLogo(slot, file);
      onUploaded(res.settings);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }
  return (
    <div className="logo-slot">
      <div className="field-label" style={{ marginTop: 0 }}>{label}</div>
      <p className="hint" style={{ marginTop: 2 }}>{hint}</p>
      <div className={`logo-slot__preview${dark ? ' dark' : ''}`} onClick={() => ref.current?.click()} role="button" tabIndex={0}>
        {busy ? <span className="spinner" /> : <img src={value || fallback} alt={label} />}
      </div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={pick} />
      <button type="button" className="btn btn-ghost btn-small" style={{ marginTop: 8 }} onClick={() => ref.current?.click()}>
        {value ? 'Replace' : 'Upload'} (PNG/SVG, 2 MB max)
      </button>
    </div>
  );
}

export default function ContentTab({ s, patch, patchPath, applySettings, setToast }) {
  const c = s.content || {};
  const form = c.form || {};
  const track = c.track || {};
  const labels = c.labels || {};
  const how = c.how || {};
  const branding = c.branding || {};
  const colors = branding.colors || {};

  const setForm = (key) => (v) => patchPath('content', ['form', key], v);
  const setTrack = (key) => (v) => patchPath('content', ['track', key], v);
  const setHow = (key) => (v) => patchPath('content', ['how', key], v);
  const setHowSub = (sub, key) => (v) => patchPath('content', ['how', sub, key], v);

  return (
    <>
      <Section title="Branding" hint="Logos and brand colours across the guest pages." defaultOpen>
        <div className="grid-2-even" style={{ gap: 14 }}>
          <LogoSlot label="Logo on dark headers" hint="Shown on the green/teal guest page headers. White or light logos work best."
            value={branding.logoLight} fallback="/brand/mw-logo-white.png" slot="light" dark
            onUploaded={applySettings} onError={setToast} />
          <LogoSlot label="Logo on light backgrounds" hint="Shown on the sign-in page and print materials."
            value={branding.logoDark} fallback="/brand/mw-logo-colour.png" slot="dark"
            onUploaded={applySettings} onError={setToast} />
        </div>
        <div className="field-label">Brand colours</div>
        <p className="hint" style={{ marginTop: 2 }}>Darker and lighter shades are derived automatically. Reset to get the original palette back.</p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {['teal', 'green', 'orange'].map(k => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
              <input type="color" value={colors[k] || BRAND_DEFAULTS[k]}
                onChange={e => patchPath('content', ['branding', 'colors', k], e.target.value)} />
              {k}
              {(colors[k] || '').toLowerCase() !== BRAND_DEFAULTS[k].toLowerCase() && colors[k] && (
                <button type="button" className="link-danger" onClick={() => patchPath('content', ['branding', 'colors', k], BRAND_DEFAULTS[k])}>reset</button>
              )}
            </label>
          ))}
        </div>
      </Section>

      <Section title="App name & welcome wording" hint="The big words guests see first." defaultOpen>
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
            <div className="d">Sets honest expectations so the QR codes never read as 24/7 room service.</div>
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
      </Section>

      <Section title="Guest form microcopy" hint="Labels, placeholders and button text on the submission form.">
        <div className="form-grid">
          <TextRow label="Message label" value={form.messageLabel} onChange={setForm('messageLabel')} />
          <TextRow label="Message placeholder" value={form.messagePlaceholder} onChange={setForm('messagePlaceholder')} />
          <TextRow label="Submit button" value={form.submitLabel} onChange={setForm('submitLabel')} />
          <TextRow label="Submit button (busy)" value={form.submittingLabel} onChange={setForm('submittingLabel')} />
          <TextRow label="Photo prompt" value={form.photoPrompt} onChange={setForm('photoPrompt')} />
          <TextRow label="Contact prompt" value={form.contactPrompt} onChange={setForm('contactPrompt')} />
          <TextRow label="Contact prompt tag" value={form.contactPromptTag} onChange={setForm('contactPromptTag')} />
          <TextRow label="Location label" value={form.locationLabel} onChange={setForm('locationLabel')} />
          <TextRow label="Location placeholder" value={form.locationPlaceholder} onChange={setForm('locationPlaceholder')} />
          <TextRow label="Change-location button" value={form.changeLocationLabel} onChange={setForm('changeLocationLabel')} />
          <TextRow label="Type picker label" value={form.typeLabel} onChange={setForm('typeLabel')} />
          <TextRow label="Urgency picker label" value={form.urgencyLabel} onChange={setForm('urgencyLabel')} />
          <TextRow label="Category picker label" value={form.categoryLabel} onChange={setForm('categoryLabel')} />
          <TextRow label="Category hint (AI on)" value={form.categoryHintAi} onChange={setForm('categoryHintAi')} />
          <TextRow label="'Send another' button" value={form.sendAnotherLabel} onChange={setForm('sendAnotherLabel')} />
          <TextRow label="Kiosk reset note" value={form.kioskResetNote} onChange={setForm('kioskResetNote')} />
          <TextRow label="Keep-code text" value={form.keepCodePrefix} onChange={setForm('keepCodePrefix')} />
          <TextRow label="Keep-code link text" value={form.keepCodeLink} onChange={setForm('keepCodeLink')} />
          <TextRow label="Footer: how-it-works link" value={form.howLinkLabel} onChange={setForm('howLinkLabel')} />
          <TextRow label="Footer: tracking link" value={form.trackLinkLabel} onChange={setForm('trackLinkLabel')} />
        </div>
      </Section>

      <Section title="Type, urgency & status labels" hint="What the chips and statuses are called, everywhere guests see them.">
        <LabelTable title="Submission types" map={labels.types}
          onChange={(k, v) => patchPath('content', ['labels', 'types', k], v)} />
        <LabelTable title="Urgency levels" map={labels.urgencies}
          onChange={(k, v) => patchPath('content', ['labels', 'urgencies', k], v)} />
        <LabelTable title="Statuses" hint="Shown on the guest tracking page." map={labels.statuses}
          onChange={(k, v) => patchPath('content', ['labels', 'statuses', k], v)} />
      </Section>

      <Section title="Tracking page" hint="The 'check your submission' page.">
        <div className="form-grid">
          <TextRow label="Header pill" value={track.pill} onChange={setTrack('pill')} />
          <TextRow label="Kicker" value={track.kicker} onChange={setTrack('kicker')} />
          <TextRow label="Title" value={track.title} onChange={setTrack('title')} />
          <TextRow label="Code placeholder" value={track.codePlaceholder} onChange={setTrack('codePlaceholder')} />
          <TextRow label="Look-up button" value={track.lookupLabel} onChange={setTrack('lookupLabel')} />
          <TextRow label="'Being sorted' label" value={track.beingSorted} onChange={setTrack('beingSorted')} />
          <TextRow label="Rating prompt" value={track.ratingPrompt} onChange={setTrack('ratingPrompt')} />
          <TextRow label="Rating thanks" value={track.ratingThanks} onChange={setTrack('ratingThanks')} />
          <TextRow label="Rating comment placeholder" value={track.ratingCommentPlaceholder} onChange={setTrack('ratingCommentPlaceholder')} />
          <TextRow label="Send-rating button" value={track.sendRatingLabel} onChange={setTrack('sendRatingLabel')} />
          <TextRow label="Footer: new submission" value={track.newSubmissionLabel} onChange={setTrack('newSubmissionLabel')} />
        </div>
      </Section>

      <Section title="How-it-works page" hint="The public demo & pilot page at /how.">
        <div className="form-grid">
          <TextRow label="Header pill" value={how.pill} onChange={setHow('pill')} />
          <TextRow label="Kicker" value={how.kicker} onChange={setHow('kicker')} />
          <TextRow label="Hero title" value={how.heroTitle} onChange={setHow('heroTitle')} />
        </div>
        <TextRow label="Hero subtitle" value={how.heroSubtitle} onChange={setHow('heroSubtitle')} area />

        <div className="field-label">The journey steps</div>
        <ListEditor items={how.journey} addLabel="+ Add step"
          fields={[{ key: 'emoji', label: '📱', narrow: true }, { key: 'title', label: 'Title' }, { key: 'body', label: 'Body', area: true }]}
          onChange={v => patchPath('content', ['how', 'journey'], v)} />

        <div className="field-label">Staff side</div>
        <div className="form-grid">
          <TextRow label="Kicker" value={(how.staff || {}).kicker} onChange={setHowSub('staff', 'kicker')} />
          <TextRow label="Heading" value={(how.staff || {}).heading} onChange={setHowSub('staff', 'heading')} />
        </div>
        <ListEditor items={(how.staff || {}).items} addLabel="+ Add point"
          fields={[{ key: 'title', label: 'Bold lead-in' }, { key: 'body', label: 'Body', area: true }]}
          onChange={v => patchPath('content', ['how', 'staff', 'items'], v)} />

        <div className="field-label">Measures</div>
        <div className="form-grid">
          <TextRow label="Kicker" value={(how.measures || {}).kicker} onChange={setHowSub('measures', 'kicker')} />
          <TextRow label="Heading" value={(how.measures || {}).heading} onChange={setHowSub('measures', 'heading')} />
        </div>
        <ListEditor items={(how.measures || {}).items} addLabel="+ Add measure"
          fields={[{ key: 'title', label: 'Measure' }, { key: 'desc', label: 'Why it matters', area: true }]}
          onChange={v => patchPath('content', ['how', 'measures', 'items'], v)} />
        <TextRow label="Measures note" value={(how.measures || {}).note} onChange={setHowSub('measures', 'note')} area />

        <div className="toggle-row">
          <div>
            <div className="t">Demo section</div>
            <div className="d">The 5-minute demo script with the scan-to-try QR code.</div>
          </div>
          <button className={`switch${(how.demo || {}).show !== false ? ' on' : ''}`}
            onClick={() => patchPath('content', ['how', 'demo', 'show'], (how.demo || {}).show === false)}
            aria-label="Toggle demo section" />
        </div>
        {(how.demo || {}).show !== false && (
          <>
            <div className="form-grid">
              <TextRow label="Kicker" value={(how.demo || {}).kicker} onChange={setHowSub('demo', 'kicker')} />
              <TextRow label="Heading" value={(how.demo || {}).heading} onChange={setHowSub('demo', 'heading')} />
              <TextRow label="Scan label" value={(how.demo || {}).scanLabel} onChange={setHowSub('demo', 'scanLabel')} />
              <TextRow label="Guest form CTA" value={(how.demo || {}).formCta} onChange={setHowSub('demo', 'formCta')} />
              <TextRow label="Admin CTA" value={(how.demo || {}).adminCta} onChange={setHowSub('demo', 'adminCta')} />
            </div>
            <ListEditor items={(how.demo || {}).steps} addLabel="+ Add step"
              fields={[{ key: 'title', label: 'Step' }, { key: 'desc', label: 'Detail', area: true }]}
              onChange={v => patchPath('content', ['how', 'demo', 'steps'], v)} />
          </>
        )}

        <div className="field-label">Pilot plan</div>
        <div className="form-grid">
          <TextRow label="Kicker" value={(how.pilot || {}).kicker} onChange={setHowSub('pilot', 'kicker')} />
          <TextRow label="Heading" value={(how.pilot || {}).heading} onChange={setHowSub('pilot', 'heading')} />
        </div>
        <ListEditor items={(how.pilot || {}).phases} addLabel="+ Add phase"
          fields={[{ key: 'phase', label: 'Week 0', narrow: true }, { key: 'title', label: 'Title' }, { key: 'who', label: 'Who' }, { key: 'body', label: 'Body', area: true }]}
          onChange={v => patchPath('content', ['how', 'pilot', 'phases'], v)} />
        <TextRow label="Pilot note" value={(how.pilot || {}).note} onChange={setHowSub('pilot', 'note')} area />

        <div className="field-label">Ownership footer</div>
        <div className="form-grid">
          <TextRow label="Kicker" value={(how.ownership || {}).kicker} onChange={setHowSub('ownership', 'kicker')} />
        </div>
        <TextRow label="Note" value={(how.ownership || {}).note} onChange={setHowSub('ownership', 'note')} area />
      </Section>
    </>
  );
}
