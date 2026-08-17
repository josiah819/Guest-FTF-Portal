import React, { useRef, useState } from 'react';
import { api } from '../api';
import { BRAND_DEFAULTS } from '../theme';
import { DEFAULT_POLICY } from '../policyContent';

// Settings → Content: every guest-facing word, label, page section, logo and
// colour. Edits are local until the save bar PUTs the dirty sections.

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

// The three guest update emails (features.emailUpdates), in the order guests
// meet them.
const EMAIL_KINDS = [
  ['signup', 'Sign-up confirmation', 'Sent the moment a guest leaves their email.'],
  ['inProgress', 'In progress', 'Sent when the team picks the note up (status → In progress).'],
  ['resolved', 'Resolved', 'Sent when the note is marked resolved.'],
];

function EmailTemplateEditor({ kind, label, hint, tpl, onField, onPreview, preview, previewing }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="field-label" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {label}
        <button type="button" className="btn btn-ghost btn-small" onClick={() => onPreview(kind)} disabled={previewing}>
          {preview ? 'Hide preview' : (previewing ? 'Rendering…' : '👁 Preview')}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 2 }}>{hint}</p>
      <div className="form-grid">
        <TextRow label="Subject" value={tpl.subject} onChange={onField(kind, 'subject')} />
        <TextRow label="Heading" value={tpl.heading} onChange={onField(kind, 'heading')} />
      </div>
      <TextRow label="Body" area value={tpl.body} onChange={onField(kind, 'body')} />
      <TextRow label="Button label" value={tpl.cta} onChange={onField(kind, 'cta')} />
      {preview && (
        <div style={{ marginTop: 10 }}>
          <div className="hint" style={{ margin: '0 0 6px' }}><b>Subject:</b> {preview.subject}</div>
          <iframe title={`${label} preview`} srcDoc={preview.html} sandbox=""
            style={{ width: '100%', height: 520, border: '1.5px solid var(--line)', borderRadius: 10, background: '#F7F4EC' }} />
        </div>
      )}
    </div>
  );
}

export default function ContentTab({ s, patch, patchPath, applySettings, setToast }) {
  const c = s.content || {};
  const form = c.form || {};
  const track = c.track || {};
  const labels = c.labels || {};
  const branding = c.branding || {};
  const colors = branding.colors || {};
  const emails = c.emails || {};

  const setForm = (key) => (v) => patchPath('content', ['form', key], v);
  const setTrack = (key) => (v) => patchPath('content', ['track', key], v);
  const setEmailField = (kind, key) => (v) => patchPath('content', ['emails', kind, key], v);

  // Server-rendered previews (the branded shell lives backend-side); rendered
  // from the current draft, so unsaved edits show. Re-preview after editing.
  const [emailPreviews, setEmailPreviews] = useState({});
  const [previewingKind, setPreviewingKind] = useState('');
  async function togglePreview(kind) {
    if (emailPreviews[kind]) {
      setEmailPreviews(p => { const next = { ...p }; delete next[kind]; return next; });
      return;
    }
    setPreviewingKind(kind);
    try {
      const r = await api.emailPreview(kind, c);
      setEmailPreviews(p => ({ ...p, [kind]: r }));
    } catch (err) {
      setToast(err.message);
    } finally {
      setPreviewingKind('');
    }
  }

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
                <button type="button" className="btn btn-danger-ghost btn-tiny" onClick={() => patchPath('content', ['branding', 'colors', k], BRAND_DEFAULTS[k])}>Reset</button>
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
          <TextRow label="Check-status button" value={form.checkStatusLabel} onChange={setForm('checkStatusLabel')} />
          <TextRow label="Saved-on-device note" value={form.savedNote} onChange={setForm('savedNote')} />
          <TextRow label="Kiosk follow-along note" value={form.kioskFollowNote} onChange={setForm('kioskFollowNote')} />
          <TextRow label="'My submissions' button" value={form.mySubmissionsLabel} onChange={setForm('mySubmissionsLabel')} />
          <TextRow label="Footer: tracking link" value={form.trackLinkLabel} onChange={setForm('trackLinkLabel')} />
          <TextRow label="Email-updates prompt" value={form.updatesPrompt} onChange={setForm('updatesPrompt')} />
          <TextRow label="Email-updates fine print" value={form.updatesHint} onChange={setForm('updatesHint')} />
          <TextRow label="Email-updates placeholder" value={form.updatesPlaceholder} onChange={setForm('updatesPlaceholder')} />
          <TextRow label="Email-updates button" value={form.updatesButton} onChange={setForm('updatesButton')} />
          <TextRow label="Email-updates thanks" value={form.updatesThanks} onChange={setForm('updatesThanks')} />
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
          <TextRow label="List title" value={track.listTitle} onChange={setTrack('listTitle')} />
          <TextRow label="Empty-state note" value={track.emptyNote} onChange={setTrack('emptyNote')} />
          <TextRow label="Back-to-list link" value={track.backToListLabel} onChange={setTrack('backToListLabel')} />
          <TextRow label="'Being sorted' label" value={track.beingSorted} onChange={setTrack('beingSorted')} />
          <TextRow label="Rating prompt" value={track.ratingPrompt} onChange={setTrack('ratingPrompt')} />
          <TextRow label="Rating thanks" value={track.ratingThanks} onChange={setTrack('ratingThanks')} />
          <TextRow label="Rating comment placeholder" value={track.ratingCommentPlaceholder} onChange={setTrack('ratingCommentPlaceholder')} />
          <TextRow label="Send-rating button" value={track.sendRatingLabel} onChange={setTrack('sendRatingLabel')} />
          <TextRow label="Footer: new submission" value={track.newSubmissionLabel} onChange={setTrack('newSubmissionLabel')} />
          <TextRow label="Email-updates-on note" value={track.updatesOnNote} onChange={setTrack('updatesOnNote')} />
          <TextRow label="Stop-updates button" value={track.updatesStopLabel} onChange={setTrack('updatesStopLabel')} />
          <TextRow label="Updates-stopped note" value={track.updatesStoppedNote} onChange={setTrack('updatesStoppedNote')} />
        </div>
      </Section>

      <Section title="Guest update emails" hint="The branded emails guests get after leaving their address for updates.">
        <p className="hint" style={{ marginTop: 0 }}>
          Placeholders work in every field: <code>{'{name}'}</code> guest’s name · <code>{'{code}'}</code> tracking
          code · <code>{'{location}'}</code> · <code>{'{orgName}'}</code> · <code>{'{status}'}</code>.
          In the body, a blank line starts a new paragraph. The logo, colours and button all follow your branding
          automatically — preview any email to see it assembled.
        </p>
        {EMAIL_KINDS.map(([kind, label, hint]) => (
          <EmailTemplateEditor key={kind} kind={kind} label={label} hint={hint}
            tpl={emails[kind] || {}} onField={setEmailField}
            onPreview={togglePreview} preview={emailPreviews[kind]} previewing={previewingKind === kind} />
        ))}
        <TextRow label="Footer note (appears on every update email)" area value={emails.footerNote}
          onChange={(v) => patchPath('content', ['emails', 'footerNote'], v)} />
      </Section>

      <Section title="Privacy pages" hint="The guest privacy policy and the staff privacy notice.">
        {[
          ['guest', 'Guest privacy policy', '/privacy'],
          ['staff', 'Staff privacy notice', '/privacy/staff'],
        ].map(([key, label, path]) => {
          const pol = (c.privacy || {})[key] || {};
          const overridden = !!(pol.body || '').trim();
          const setPol = (field) => (v) => patchPath('content', ['privacy', key, field], v);
          return (
            <div key={key} style={{ marginBottom: key === 'guest' ? 26 : 0 }}>
              <div className="field-label" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                {label}
                <a href={path} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View page ↗</a>
              </div>
              <p className="hint" style={{ marginTop: 2 }}>
                Formatting: <code>## heading</code> · <code>- bullet</code> · <code>**bold**</code> · <code>*italic*</code> · <code>[link](https://…)</code>.
                Leave the text empty to use the built-in policy that ships with WoodsVoice.
              </p>
              <TextRow label="Last updated (shown at the top of the page)" value={pol.updated}
                onChange={setPol('updated')} placeholder={DEFAULT_POLICY[key].updated} />
              <div className="form-col">
                <label>Policy text</label>
                <textarea className="input" style={{ minHeight: 240, fontSize: 13.5, lineHeight: 1.5 }}
                  value={pol.body || ''}
                  placeholder="Empty — the built-in policy is shown. Load it below to make edits."
                  onChange={e => setPol('body')(e.target.value)} />
              </div>
              {overridden ? (
                <button type="button" className="btn btn-danger-ghost btn-tiny"
                  onClick={() => { setPol('body')(''); setPol('updated')(''); }}>
                  Reset to built-in policy
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-small"
                  onClick={() => setPol('body')(DEFAULT_POLICY[key].body)}>
                  Load built-in text into the editor
                </button>
              )}
            </div>
          );
        })}
      </Section>
    </>
  );
}
