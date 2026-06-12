import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

const STATUS_STYLE = {
  new: { label: 'Received', bg: 'var(--teal-mist)', fg: 'var(--teal-dark)' },
  in_progress: { label: 'In progress', bg: '#F6E8D8', fg: '#8A4A16' },
  resolved: { label: 'Resolved', bg: '#E4F0CD', fg: 'var(--green-dark)' },
  closed: { label: 'Closed', bg: '#E8E5DC', fg: 'var(--ink-faint)' },
};

export default function Track() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(codeParam || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [rateError, setRateError] = useState('');

  useEffect(() => {
    if (!codeParam) { setData(null); return; }
    setLoading(true);
    setError('');
    api.track(codeParam)
      .then(d => { setData(d); setRated(!!d.rating); setStars(d.rating || 0); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [codeParam]);

  function lookup(e) {
    e.preventDefault();
    const code = input.trim().toUpperCase();
    if (code) navigate(`/t/${code}`);
  }

  async function sendRating() {
    setRateError('');
    try {
      await api.rate(codeParam, stars, comment);
      setRated(true);
    } catch (err) {
      setRateError(err.message);
    }
  }

  const st = data ? (STATUS_STYLE[data.status] || STATUS_STYLE.new) : null;
  const canRate = data && data.csat && ['resolved', 'closed'].includes(data.status);

  return (
    <div className="guest-shell">
      <header className="guest-top rise">
        <Link to="/"><img src="/brand/mw-logo-white.png" alt="Muskoka Woods" /></Link>
        <span className="pill">Submission tracker</span>
      </header>

      <section className="guest-hero rise rise-1">
        <div className="kicker">Hang tight — we’re on it</div>
        <h1 className="display">Check your submission</h1>
      </section>

      <main className="guest-card rise rise-2">
        <form onSubmit={lookup} style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}
            placeholder="MW-XXXXXX"
            value={input}
            onChange={e => setInput(e.target.value)}
            aria-label="Tracking code"
          />
          <button className="btn btn-teal btn-small" type="submit" style={{ flexShrink: 0 }}>Look up</button>
        </form>

        {loading && <div className="center-pad"><span className="spinner" /></div>}
        {error && <div className="error-note" role="alert">{error}</div>}

        {data && !loading && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="track-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              <span className="muted">
                {data.emoji} {data.category || 'Being sorted'} {data.location ? `· ${data.location}` : ''}
              </span>
            </div>

            <ul className="timeline">
              {data.events.map((ev, i) => (
                <li key={i}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.detail}</div>
                  <div className="when">{new Date(ev.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                </li>
              ))}
            </ul>

            {canRate && (
              <div style={{ borderTop: '1.5px solid var(--line)', marginTop: 8, paddingTop: 18 }}>
                {rated ? (
                  <p style={{ margin: 0, fontWeight: 600, color: 'var(--green-dark)' }}>
                    {'★'.repeat(data.rating || stars)} — thanks for the feedback!
                  </p>
                ) : (
                  <>
                    <div className="field-label mt0" style={{ marginTop: 0 }}>How did we do?</div>
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
                          placeholder="Anything to add? (optional)"
                          value={comment}
                          onChange={e => setComment(e.target.value)}
                        />
                        {rateError && <div className="error-note">{rateError}</div>}
                        <button className="btn btn-teal btn-small" style={{ marginTop: 10 }} onClick={sendRating}>Send rating</button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} Muskoka Woods</span>
        <Link to="/">← New submission</Link>
      </footer>
    </div>
  );
}
