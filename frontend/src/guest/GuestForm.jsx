import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

const TYPES = [
  { id: 'issue', label: '⚠️ Something’s wrong' },
  { id: 'request', label: '🙋 I need something' },
  { id: 'feedback', label: '💡 Idea / feedback' },
  { id: 'compliment', label: '💚 Shout-out' },
];

const URGENCIES = [
  { id: 'low', label: 'Whenever' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Today please' },
  { id: 'safety', label: '🚨 Safety' },
];

const blankForm = { type: 'issue', category: '', message: '', urgency: 'normal', name: '', email: '', phone: '', group: '' };

// Returning guests shouldn't retype who they are. Saved only on their own
// device, never in kiosk mode (shared screens).
const GUEST_KEY = 'woodsvoice_guest';
const CONTACT_KEYS = ['name', 'group', 'email', 'phone'];

function loadSavedContact() {
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || '{}');
    const out = {};
    for (const k of CONTACT_KEYS) if (typeof saved[k] === 'string' && saved[k]) out[k] = saved[k];
    return out;
  } catch {
    return {};
  }
}

export default function GuestForm() {
  const [params] = useSearchParams();
  const kioskParam = params.get('kiosk') === '1';
  const locParam = (params.get('loc') || '').toLowerCase();

  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ ...blankForm });
  const [locationSlug, setLocationSlug] = useState('');
  const [locLocked, setLocLocked] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const fileRef = useRef(null);
  const resetTimer = useRef(null);

  useEffect(() => {
    api.publicConfig()
      .then(cfg => {
        setConfig(cfg);
        if (locParam && cfg.locations.some(l => l.slug === locParam)) {
          setLocationSlug(locParam);
          setLocLocked(true);
        }
        if (!kioskParam) {
          const saved = loadSavedContact();
          if (Object.keys(saved).length) {
            setForm(f => ({ ...f, ...saved }));
            setHasSaved(true);
          }
        }
      })
      .catch(() => setLoadError('We couldn’t load the form. Please try again in a moment.'));
    return () => clearTimeout(resetTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (value) => setForm(f => ({ ...f, [key]: value }));

  // Kiosk styling only applies if the feature is enabled in admin settings.
  const kiosk = kioskParam && (config ? config.features.kioskMode !== false : true);

  const lockedLocation = useMemo(
    () => config?.locations.find(l => l.slug === locationSlug),
    [config, locationSlug]
  );

  const locationsByArea = useMemo(() => {
    if (!config) return [];
    const map = new Map();
    for (const l of config.locations) {
      if (!map.has(l.area)) map.set(l.area, []);
      map.get(l.area).push(l);
    }
    return [...map.entries()];
  }, [config]);

  function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function saveContact() {
    if (kiosk) return;
    const data = {};
    for (const k of CONTACT_KEYS) if (form[k]) data[k] = form[k];
    try {
      if (Object.keys(data).length) {
        localStorage.setItem(GUEST_KEY, JSON.stringify(data));
        setHasSaved(true);
      }
    } catch { /* private mode etc. — not worth surfacing */ }
  }

  function clearSavedContact() {
    try { localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }
    setForm(f => ({ ...f, name: '', email: '', phone: '', group: '' }));
    setHasSaved(false);
  }

  function resetAll() {
    // Keep who-you-are between notes (a leader often sends several) — kiosks reset fully.
    const saved = kiosk ? {} : loadSavedContact();
    setForm({ ...blankForm, ...saved });
    setPhoto(null);
    setPhotoPreview('');
    setSuccess(null);
    setError('');
    setContactOpen(false);
    if (!locLocked) setLocationSlug('');
    window.scrollTo({ top: 0 });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.message.trim().length < 3) {
      setError('Please add a short message first.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('type', config.features.submissionTypes ? form.type : 'issue');
      fd.append('category', form.category);
      fd.append('message', form.message);
      fd.append('location', locationSlug);
      fd.append('urgency', form.urgency);
      fd.append('name', form.name);
      fd.append('email', form.email);
      fd.append('phone', form.phone);
      fd.append('group', form.group);
      fd.append('source', kiosk ? 'kiosk' : (locParam ? 'qr' : 'web'));
      if (photo && config.features.photoUpload) fd.append('photo', photo);
      const res = await api.submit(fd);
      saveContact();
      setSuccess(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (kiosk) resetTimer.current = setTimeout(resetAll, 15000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const shellClass = `guest-shell${kiosk ? ' kiosk' : ''}`;

  if (loadError) {
    return <div className={shellClass}><div className="guest-card rise" style={{ marginTop: 60 }}>{loadError}</div></div>;
  }
  if (!config) {
    return <div className={shellClass}><div className="center-pad" style={{ minHeight: '60vh' }}><span className="spinner" style={{ borderTopColor: '#A3CD42' }} /></div></div>;
  }

  const g = config.general;
  const f = config.fields;
  const showField = (k) => f[k] && f[k] !== 'off';
  const reqMark = (k) => f[k] === 'required'
    ? <span className="opt">required</span>
    : <span className="opt">optional</span>;

  // Contact fields: required ones always show; optional ones tuck behind one
  // tap so the everyday form stays message + send.
  const contactKeys = CONTACT_KEYS.filter(showField);
  const requiredContact = contactKeys.filter(k => f[k] === 'required');
  const optionalContact = contactKeys.filter(k => f[k] !== 'required');
  const filledContact = contactKeys.filter(k => form[k]);
  const contactSummary = form.name || form.email || (filledContact.length ? `${filledContact.length} detail${filledContact.length > 1 ? 's' : ''}` : '');

  const CONTACT_PROPS = {
    name: { label: 'Your name', props: { autoComplete: 'name', autoCapitalize: 'words' } },
    group: { label: 'School / group', props: { autoComplete: 'organization' } },
    email: { label: 'Email', props: { type: 'email', autoComplete: 'email', inputMode: 'email', autoCapitalize: 'none' } },
    phone: { label: 'Phone', props: { type: 'tel', autoComplete: 'tel', inputMode: 'tel' } },
  };

  const renderContactField = (k) => (
    <div key={k}>
      <div className="field-label">{CONTACT_PROPS[k].label} {reqMark(k)}</div>
      <input className="input" {...CONTACT_PROPS[k].props} value={form[k]} onChange={e => set(k)(e.target.value)} />
    </div>
  );

  return (
    <div className={shellClass}>
      <header className="guest-top rise">
        <img src="/brand/mw-logo-white.png" alt="Muskoka Woods" />
        <span className="pill">{g.appName}</span>
      </header>

      {success ? (
        <main className="guest-card rise" role="status">
          <div className="success-wrap">
            <div className="success-badge">✓</div>
            <h2 className="display">{success.successTitle || g.successTitle}</h2>
            <p style={{ color: 'var(--ink-soft)', maxWidth: '42ch', margin: '10px auto 0' }}>
              {success.successMessage || g.successMessage}
            </p>
            {success.tracking && (
              <>
                <div className="code-box">
                  {success.code}
                  <button
                    onClick={() => navigator.clipboard?.writeText(success.code)}
                    style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15 }}
                    title="Copy code"
                  >⧉</button>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  Keep this code to <Link to={`/t/${success.code}`}>check on your submission</Link>.
                </p>
              </>
            )}
            <div style={{ marginTop: 22 }}>
              <button className="btn btn-ghost btn-small" onClick={resetAll}>Send another</button>
            </div>
            {kiosk && <p className="muted" style={{ marginTop: 14 }}>This screen resets automatically.</p>}
          </div>
        </main>
      ) : (
        <>
          <section className="guest-hero rise rise-1">
            <div className="kicker">{g.orgName} · Guest Care</div>
            <h1 className="display">{g.welcomeTitle}</h1>
            <p>{g.welcomeSubtitle}</p>
          </section>

          <main className="guest-card rise rise-2">
            <form onSubmit={submit} noValidate>
              {config.features.submissionTypes && (
                <>
                  <div className="field-label" style={{ marginTop: 4 }}>What kind of note is this?</div>
                  <div className="type-row" role="radiogroup">
                    {TYPES.map(t => (
                      <button
                        type="button"
                        key={t.id}
                        className={`chip${form.type === t.id ? ' on' : ''}`}
                        onClick={() => set('type')(t.id)}
                        aria-pressed={form.type === t.id}
                      >{t.label}</button>
                    ))}
                  </div>
                </>
              )}

              <div className="field-label">What’s going on? <span className="opt">required</span></div>
              <textarea
                className="input"
                placeholder="Tell us what happened, what you need, or what made your day…"
                value={form.message}
                onChange={e => set('message')(e.target.value)}
                maxLength={4000}
                required
              />

              {config.features.photoUpload && (
                <>
                  <div className="photo-drop" style={{ marginTop: 10 }} onClick={() => fileRef.current?.click()}>
                    {photoPreview
                      ? <><img src={photoPreview} alt="preview" /> <span>{photo?.name}</span></>
                      : <><span style={{ fontSize: 22 }}>📷</span> <span>Snap or choose a photo (optional, 8 MB max)</span></>}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
                </>
              )}

              {showField('location') && (
                <>
                  <div className="field-label">Where? {reqMark('location')}</div>
                  {locLocked && lockedLocation ? (
                    <div className="loc-bar">
                      <span>📍</span>
                      <span className="where">{lockedLocation.name}</span>
                      <button type="button" onClick={() => setLocLocked(false)}>Change</button>
                    </div>
                  ) : (
                    <select className="input" value={locationSlug} onChange={e => setLocationSlug(e.target.value)}>
                      <option value="">Choose a location…</option>
                      {locationsByArea.map(([area, locs]) => (
                        <optgroup key={area} label={area}>
                          {locs.map(l => <option key={l.slug} value={l.slug}>{l.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </>
              )}

              {config.features.urgency && showField('urgency') && (
                <>
                  <div className="field-label">How urgent? {reqMark('urgency')}</div>
                  <div className="urgency-row" role="radiogroup">
                    {URGENCIES.map(u => (
                      <button
                        type="button"
                        key={u.id}
                        className={`chip${form.urgency === u.id ? ` on${u.id === 'safety' ? ' safety' : ''}` : ''}`}
                        onClick={() => set('urgency')(u.id)}
                        aria-pressed={form.urgency === u.id}
                      >{u.label}</button>
                    ))}
                  </div>
                </>
              )}

              <div className="field-label">
                Category
                <span className="opt">{config.features.aiCategorization ? 'skip it — we’ll sort it for you' : 'optional'}</span>
              </div>
              <div className="cat-grid">
                {config.categories.map(c => (
                  <button
                    type="button"
                    key={c.slug}
                    className={`cat-tile${form.category === c.slug ? ' on' : ''}`}
                    onClick={() => set('category')(form.category === c.slug ? '' : c.slug)}
                    aria-pressed={form.category === c.slug}
                  >
                    <span className="em">{c.emoji}</span>
                    <span className="nm">{c.name}</span>
                  </button>
                ))}
              </div>

              {requiredContact.length > 0 && (
                <div className="contact-grid">
                  {requiredContact.map(renderContactField)}
                </div>
              )}

              {optionalContact.length > 0 && (
                contactOpen ? (
                  <div className="contact-block">
                    <div className="contact-grid">
                      {optionalContact.map(renderContactField)}
                    </div>
                    {hasSaved && (
                      <button type="button" className="contact-clear" onClick={clearSavedContact}>
                        Clear saved details
                      </button>
                    )}
                  </div>
                ) : (
                  <button type="button" className="contact-teaser" onClick={() => setContactOpen(true)}>
                    {contactSummary
                      ? <><span className="ic">👤</span><span className="tx">Sending as <strong>{contactSummary}</strong>{form.group && form.name ? ` · ${form.group}` : ''}</span><span className="edit">Edit</span></>
                      : <><span className="ic">👤</span><span className="tx">Add your name so we can follow up</span><span className="edit">Optional</span></>}
                  </button>
                )
              )}

              {error && <div className="error-note" role="alert">{error}</div>}

              <div style={{ marginTop: 22 }}>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send it to the team →'}
                </button>
              </div>

              {g.showExpectationBanner && (
                <div className="expectation">
                  <span className="ic">🕐</span>
                  <span>{g.expectationBanner}</span>
                </div>
              )}
            </form>
          </main>
        </>
      )}

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} {g.orgName}</span>
        <span className="guest-foot__links">
          <Link to="/how">How this works</Link>
          {config.features.tracking && !success && <Link to="/track">Check a submission →</Link>}
        </span>
      </footer>
    </div>
  );
}
