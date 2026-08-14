import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { applyTheme } from '../theme';
import { listMySubmissions, rememberSubmission, forgetSubmission } from './mySubmissions';

// Status label text comes from admin-editable content; the colours stay ours.
const STATUS_STYLE = {
  new: { bg: 'var(--forest-mist)', fg: 'var(--forest)' },
  in_progress: { bg: '#F6E8D8', fg: '#8A4A16' },
  resolved: { bg: '#E4F0CD', fg: 'var(--green-dark)' },
  closed: { bg: '#E8E5DC', fg: 'var(--ink-faint)' },
};

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

export default function Track() {
  const { code: codeParam } = useParams();
  const [config, setConfig] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState(null); // null = still loading
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [rateError, setRateError] = useState('');

  useEffect(() => {
    api.publicConfig()
      .then(cfg => { setConfig(cfg); applyTheme(cfg.content?.branding); })
      .catch(() => setConfig({}));
  }, []);

  // Detail view. Opening a link also adopts the submission into this device's
  // list — that's how a kiosk QR scan lands the note on the guest's own phone.
  useEffect(() => {
    if (!codeParam) { setData(null); return; }
    setLoading(true);
    setError('');
    api.track(codeParam)
      .then(d => {
        setData(d);
        setRated(!!d.rating);
        setStars(d.rating || 0);
        rememberSubmission({
          code: d.public_code, message: d.message, location: d.location, createdAt: d.created_at,
        });
      })
      .catch(err => {
        if (err.status === 404) forgetSubmission(codeParam.trim().toUpperCase());
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [codeParam]);

  // List view: everything this browser has sent, freshened from the server.
  // 404 = the submission is gone (deleted / wiped) → drop it from the device;
  // any other failure keeps the saved entry and shows it without live status.
  useEffect(() => {
    if (codeParam) return;
    const mine = listMySubmissions();
    if (!mine.length) { setList([]); return; }
    let on = true;
    Promise.all(mine.map(s =>
      api.track(s.code)
        .then(d => ({ ...s, ...d, live: true }))
        .catch(err => {
          if (err.status === 404) { forgetSubmission(s.code); return null; }
          return { ...s, live: false };
        })
    )).then(rows => { if (on) setList(rows.filter(Boolean)); });
    return () => { on = false; };
  }, [codeParam]);

  async function sendRating() {
    setRateError('');
    try {
      await api.rate(codeParam, stars, comment);
      setRated(true);
    } catch (err) {
      setRateError(err.message);
    }
  }

  const ct = config?.content?.track || {};
  const statusLabels = config?.content?.labels?.statuses || {};
  const branding = config?.content?.branding || {};
  const orgName = config?.general?.orgName || 'Muskoka Woods';

  const st = data ? (STATUS_STYLE[data.status] || STATUS_STYLE.new) : null;
  const stLabel = data ? (statusLabels[data.status] || data.status) : '';
  const canRate = data && data.csat && ['resolved', 'closed'].includes(data.status);

  return (
    <div className="guest-shell">
      <header className="guest-top rise">
        <Link to="/"><img src={branding.logoLight || '/brand/mw-logo-white.png'} alt={orgName} /></Link>
        <span className="pill">{ct.pill || 'Submission tracker'}</span>
      </header>

      <section className="guest-hero rise rise-1">
        <div className="kicker">{ct.kicker || 'Hang tight — we’re on it'}</div>
        <h1 className="display">
          {codeParam ? (ct.title || 'Check your submission') : (ct.listTitle || 'Your submissions')}
        </h1>
      </section>

      {codeParam ? (
        <main className="guest-card rise rise-2">
          {loading && <div className="center-pad"><span className="spinner" /></div>}
          {error && <div className="error-note" role="alert">{error}</div>}

          {data && !loading && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span className="track-status" style={{ background: st.bg, color: st.fg }}>{stLabel}</span>
                <span className="muted">
                  {data.emoji} {data.category || ct.beingSorted || 'Being sorted'} {data.location ? `· ${data.location}` : ''}
                </span>
              </div>

              {data.message && <p className="track-quote">“{data.message}”</p>}

              <ul className="timeline">
                {data.events.map((ev, i) => (
                  <li key={i}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.detail}</div>
                    <div className="when">{fmtWhen(ev.created_at)}</div>
                  </li>
                ))}
              </ul>

              {canRate && (
                <div style={{ borderTop: '1.5px solid var(--line)', marginTop: 8, paddingTop: 18 }}>
                  {rated ? (
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--green-dark)' }}>
                      {'★'.repeat(data.rating || stars)} — {ct.ratingThanks || 'thanks for the feedback!'}
                    </p>
                  ) : (
                    <>
                      <div className="field-label mt0" style={{ marginTop: 0 }}>{ct.ratingPrompt || 'How did we do?'}</div>
                      <div className="stars" role="radiogroup" aria-label="Rate 1 to 5 stars">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button key={n} type="button" className={stars >= n ? 'on' : ''} onClick={() => setStars(n)} aria-label={`${n} stars`}>★</button>
                        ))}
                      </div>
                      {stars > 0 && (
                        <>
                          <textarea
                            className="input"
                            style={{ marginTop: 12, minHeight: 70 }}
                            placeholder={ct.ratingCommentPlaceholder || 'Anything to add? (optional)'}
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                          />
                          {rateError && <div className="error-note">{rateError}</div>}
                          <button className="btn btn-teal btn-small" style={{ marginTop: 10 }} onClick={sendRating}>{ct.sendRatingLabel || 'Send rating'}</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      ) : (
        <main className="guest-card rise rise-2">
          {list === null && <div className="center-pad"><span className="spinner" /></div>}

          {list && list.length === 0 && (
            <div className="track-empty">
              <p className="muted" style={{ margin: '6px 0 18px' }}>
                {ct.emptyNote || 'Nothing here yet — notes you send from this device will show up here.'}
              </p>
              <Link className="btn btn-teal btn-small" to="/">{ct.newSubmissionLabel || '← New submission'}</Link>
            </div>
          )}

          {list && list.length > 0 && (
            <div className="track-list">
              {list.map(s => {
                const style = s.live ? (STATUS_STYLE[s.status] || STATUS_STYLE.new) : { bg: '#E8E5DC', fg: 'var(--ink-faint)' };
                const label = s.live ? (statusLabels[s.status] || s.status) : 'Saved';
                return (
                  <Link key={s.code} to={`/t/${s.code}`} className="track-item">
                    <div className="track-item__top">
                      <span className="track-status" style={{ background: style.bg, color: style.fg }}>{label}</span>
                      <span className="when">{fmtWhen(s.created_at || s.createdAt)}</span>
                    </div>
                    {s.message && <div className="track-item__msg">{s.message}</div>}
                    <div className="track-item__meta">
                      {s.live && s.emoji} {s.live ? (s.category || ct.beingSorted || 'Being sorted') : ''}
                      {s.location ? `${s.live ? ' · ' : ''}${s.location}` : ''}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </main>
      )}

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} {orgName}</span>
        <span className="guest-foot__links">
          {codeParam && <Link to="/track">{ct.backToListLabel || '← My submissions'}</Link>}
          <Link to="/">{ct.newSubmissionLabel || '← New submission'}</Link>
          <Link to="/privacy">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}
