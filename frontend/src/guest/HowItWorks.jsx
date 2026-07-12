import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import { applyTheme } from '../theme';

// The "demo it for Cindy" page: how the whole system works, the 5-minute
// live-demo script, and the start-small pilot plan — shareable, no login.
// Every word here comes from Settings → Content → How-it-works page.

export default function HowItWorks() {
  const [config, setConfig] = useState(null);
  const [origin, setOrigin] = useState('');
  const qrRef = useRef(null);

  useEffect(() => {
    api.publicConfig()
      .then(cfg => { setConfig(cfg); applyTheme(cfg.content?.branding); })
      .catch(() => setConfig({}));
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (config && qrRef.current) {
      QRCode.toCanvas(qrRef.current, window.location.origin + '/', {
        width: 220,
        margin: 1,
        color: { dark: '#1B4849', light: '#FFFFFF' },
      });
    }
  }, [config]);

  if (!config) {
    return <div className="guest-shell how-shell"><div className="center-pad" style={{ minHeight: '60vh' }}><span className="spinner" style={{ borderTopColor: '#A3CD42' }} /></div></div>;
  }

  const how = config.content?.how || {};
  const branding = config.content?.branding || {};
  const orgName = config.general?.orgName || 'Muskoka Woods';
  const journey = how.journey || [];
  const staff = how.staff || {};
  const measures = how.measures || {};
  const demo = how.demo || {};
  const pilot = how.pilot || {};
  const ownership = how.ownership || {};

  return (
    <div className="guest-shell how-shell">
      <header className="guest-top rise">
        <Link to="/"><img src={branding.logoLight || '/brand/mw-logo-white.png'} alt={orgName} /></Link>
        <span className="pill">{how.pill || 'How it works'}</span>
      </header>

      <section className="guest-hero rise rise-1">
        <div className="kicker">{how.kicker || 'Guest Care'}</div>
        <h1 className="display">{how.heroTitle || 'How it works'}</h1>
        <p>{how.heroSubtitle}</p>
      </section>

      {/* The journey */}
      <main className="how-wrap rise rise-2">
        <div className="how-steps">
          {journey.map((s, i) => (
            <article className="how-step" key={i}>
              <div className="how-step__badge"><span className="em">{s.emoji}</span><span className="n">{String(i + 1).padStart(2, '0')}</span></div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </article>
          ))}
        </div>

        {/* Staff notifications */}
        {(staff.items || []).length > 0 && (
          <section className="how-card">
            <div className="kicker how-kicker">{staff.kicker || 'Staff side'}</div>
            <h2 className="display how-h2">{staff.heading || 'How the team finds out'}</h2>
            <ul className="how-list">
              {staff.items.map((it, i) => (
                <li key={i}><strong>{it.title}</strong> {it.body}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Measurement */}
        {(measures.items || []).length > 0 && (
          <section className="how-card">
            <div className="kicker how-kicker">{measures.kicker || 'Measurement for success'}</div>
            <h2 className="display how-h2">{measures.heading || 'The numbers we watch'}</h2>
            <div className="how-measures">
              {measures.items.map((m, i) => (
                <div className="how-measure" key={i}>
                  <div className="t">{m.title}</div>
                  <div className="d">{m.desc}</div>
                </div>
              ))}
            </div>
            {measures.note && <p className="how-note">{measures.note}</p>}
          </section>
        )}

        {/* Demo script */}
        {demo.show !== false && (demo.steps || []).length > 0 && (
          <section className="how-card how-card--demo">
            <div className="kicker how-kicker">{demo.kicker || 'The 5-minute demo'}</div>
            <h2 className="display how-h2">{demo.heading || 'See it live, right now'}</h2>
            <div className="how-demo-grid">
              <ol className="how-demo-steps">
                {demo.steps.map((s, i) => (
                  <li key={i}>
                    <strong>{s.title}</strong>
                    <span>{s.desc}</span>
                  </li>
                ))}
              </ol>
              <div className="how-qr">
                <canvas ref={qrRef} aria-label="QR code that opens the guest form" />
                <div className="nm">{demo.scanLabel || 'Scan to try it'}</div>
                <div className="ar">{origin ? origin.replace(/^https?:\/\//, '') : 'the guest form'}</div>
              </div>
            </div>
            <div className="how-cta-row">
              <Link className="btn btn-primary" to="/">{demo.formCta || 'Open the guest form →'}</Link>
              <a className="btn btn-ghost" href="/admin" target="_blank" rel="noreferrer">{demo.adminCta || 'Open Guest Care HQ ↗'}</a>
            </div>
          </section>
        )}

        {/* Pilot plan */}
        {(pilot.phases || []).length > 0 && (
          <section className="how-card">
            <div className="kicker how-kicker">{pilot.kicker || 'Start with a test'}</div>
            <h2 className="display how-h2">{pilot.heading || 'The pilot plan'}</h2>
            <div className="how-pilot">
              {pilot.phases.map((p, i) => (
                <article className="how-phase" key={i}>
                  <div className="ph">{p.phase}</div>
                  <h3>{p.title}</h3>
                  <div className="who">{p.who}</div>
                  <p>{p.body}</p>
                </article>
              ))}
            </div>
            {pilot.note && <p className="how-note">{pilot.note}</p>}
          </section>
        )}

        {/* Accountability teaser */}
        {ownership.note && (
          <section className="how-card how-card--slim">
            <div className="kicker how-kicker">{ownership.kicker || 'Who owns it'}</div>
            <p className="how-note" style={{ marginTop: 8 }}>{ownership.note}</p>
          </section>
        )}
      </main>

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} {orgName}</span>
        <Link to="/">← {config.general?.appName || 'Guest form'}</Link>
      </footer>
    </div>
  );
}
