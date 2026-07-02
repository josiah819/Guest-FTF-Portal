import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';

// The "demo it for Cindy" page: how the whole system works, the 5-minute
// live-demo script, and the start-small pilot plan — shareable, no login.

const JOURNEY = [
  {
    n: '01', emoji: '📱', title: 'Scan the QR in the room',
    body: 'Every cabin and common area gets its own QR card. Scanning opens the form with the location already filled in — the system knows it came from Cabin 3 before the guest types a word.',
  },
  {
    n: '02', emoji: '✍️', title: 'Tell us in one sentence',
    body: 'One required field: the message. Everything else is optional — category, photo, name. About 30 seconds, no app to download, no account to create.',
  },
  {
    n: '03', emoji: '✨', title: 'AI triage, instantly',
    body: 'Claude reads the note, picks the category, grades urgency (safety concerns jump the queue), and writes a one-line summary for staff. The guest never waits on this — it happens after they hit send.',
  },
  {
    n: '04', emoji: '🧭', title: 'Routed to the right team',
    body: 'Each category maps to a department — Facilities, Housekeeping, Food Services, Program, Guest Services. Submissions can also be handed off to FTF automatically, so nothing changes about how the work itself gets done.',
  },
  {
    n: '05', emoji: '✅', title: 'Worked, resolved, rated',
    body: 'Staff update the status in Guest Care HQ; the guest can follow along with their tracking code. Once resolved, the guest is invited to rate the experience — that becomes our satisfaction score.',
  },
];

const DEMO_SCRIPT = [
  ['Scan the QR on this page', 'Submit a real note — try “The shower in our cabin only runs cold.” Takes ~30 seconds.'],
  ['Open Guest Care HQ', 'The note is already in the inbox: categorized, urgency-graded, with a one-line AI summary.'],
  ['Mark it “In progress”', 'That first touch stops the first-response clock — this is the number the SLA watches.'],
  ['Resolve it', 'The guest’s tracking page updates live, and invites them to rate how we did.'],
  ['Open the Dashboard', 'Volume, categories, hotspots, response times and SLA compliance — the whole story on one screen.'],
];

const PILOT = [
  {
    phase: 'Week 0', title: 'Dry run — staff only',
    who: 'Guest Services + Facilities & Maintenance',
    body: 'Two QR codes in staff areas (staff lounge, front desk). Staff submit real quirks they notice. We tune categories, wording and the expectation banner before a guest ever sees it.',
  },
  {
    phase: 'Weeks 1–2', title: 'Small pilot — one guest group',
    who: 'Add Housekeeping',
    body: 'QR cards in 3–5 cabins plus the dining hall for one school or retreat group. Guest Care checks the inbox morning and afternoon; safety items ping immediately.',
  },
  {
    phase: 'Week 3+', title: 'Decide and widen',
    who: 'Add Food Services + Program',
    body: 'Review the numbers below with Cindy. If they hold up, print QR cards for every cabin and common area and make WoodsVoice the default channel.',
  },
];

const MEASURES = [
  ['Submissions per week', 'Are guests actually using it? (QR vs web vs kiosk tells us where.)'],
  ['First-response time', 'Average hours until a staff member first touches a submission — target 24h.'],
  ['SLA compliance %', 'Share of submissions answered and resolved inside target — the success number.'],
  ['Misroute rate', 'How often staff re-categorize the AI’s pick — tells us the triage is trustworthy.'],
  ['Guest rating (CSAT)', 'Stars after resolution. The “was it worth it?” score.'],
];

export default function HowItWorks() {
  const [origin, setOrigin] = useState('');
  const qrRef = useRef(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    if (qrRef.current) {
      QRCode.toCanvas(qrRef.current, window.location.origin + '/', {
        width: 220,
        margin: 1,
        color: { dark: '#1B4849', light: '#FFFFFF' },
      });
    }
  }, []);

  return (
    <div className="guest-shell how-shell">
      <header className="guest-top rise">
        <Link to="/"><img src="/brand/mw-logo-white.png" alt="Muskoka Woods" /></Link>
        <span className="pill">How it works</span>
      </header>

      <section className="guest-hero rise rise-1">
        <div className="kicker">WoodsVoice · Guest Care</div>
        <h1 className="display">From “the shower’s cold” to fixed.</h1>
        <p>
          One QR code in every cabin. One 30-second form. AI triage, department routing,
          response-time tracking — here’s the whole journey, end to end.
        </p>
      </section>

      {/* The journey */}
      <main className="how-wrap rise rise-2">
        <div className="how-steps">
          {JOURNEY.map(s => (
            <article className="how-step" key={s.n}>
              <div className="how-step__badge"><span className="em">{s.emoji}</span><span className="n">{s.n}</span></div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </article>
          ))}
        </div>

        {/* Staff notifications */}
        <section className="how-card">
          <div className="kicker how-kicker">Staff side</div>
          <h2 className="display how-h2">How the team finds out</h2>
          <ul className="how-list">
            <li><strong>Safety first.</strong> Anything flagged as a safety concern pins to the top of the inbox and triggers a red alert on the dashboard until it’s handled.</li>
            <li><strong>Guest Care HQ inbox.</strong> Every submission lands in one shared inbox with filters by status, category, location and urgency — checked on a written cadence (see the Runbook).</li>
            <li><strong>FTF hand-off.</strong> With one switch, every submission is also POSTed straight into FTF, so Facilities keeps working exactly where they already work.</li>
            <li><strong>Department email.</strong> Each department can have a notification address on file; notifications are logged on the submission’s timeline.</li>
          </ul>
        </section>

        {/* Measurement */}
        <section className="how-card">
          <div className="kicker how-kicker">Measurement for success</div>
          <h2 className="display how-h2">The numbers we watch</h2>
          <div className="how-measures">
            {MEASURES.map(([t, d]) => (
              <div className="how-measure" key={t}>
                <div className="t">{t}</div>
                <div className="d">{d}</div>
              </div>
            ))}
          </div>
          <p className="how-note">
            The dashboard tracks all five live, with SLA targets (first response &amp; resolution) set in
            Settings. Who monitors them, on what cadence, is written down on the
            <strong> Runbook</strong> page in Guest Care HQ — accountability by name, not by vibes.
          </p>
        </section>

        {/* Demo script */}
        <section className="how-card how-card--demo">
          <div className="kicker how-kicker">The 5-minute demo</div>
          <h2 className="display how-h2">See it live, right now</h2>
          <div className="how-demo-grid">
            <ol className="how-demo-steps">
              {DEMO_SCRIPT.map(([t, d], i) => (
                <li key={i}>
                  <strong>{t}</strong>
                  <span>{d}</span>
                </li>
              ))}
            </ol>
            <div className="how-qr">
              <canvas ref={qrRef} aria-label="QR code that opens the guest form" />
              <div className="nm">Scan to try it</div>
              <div className="ar">{origin ? origin.replace(/^https?:\/\//, '') : 'the guest form'}</div>
            </div>
          </div>
          <div className="how-cta-row">
            <Link className="btn btn-primary" to="/">Open the guest form →</Link>
            <a className="btn btn-ghost" href="/admin" target="_blank" rel="noreferrer">Open Guest Care HQ ↗</a>
          </div>
        </section>

        {/* Pilot plan */}
        <section className="how-card">
          <div className="kicker how-kicker">Start with a test</div>
          <h2 className="display how-h2">The pilot plan</h2>
          <div className="how-pilot">
            {PILOT.map(p => (
              <article className="how-phase" key={p.phase}>
                <div className="ph">{p.phase}</div>
                <h3>{p.title}</h3>
                <div className="who">{p.who}</div>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
          <p className="how-note">
            Start where the volume already is: maintenance and housekeeping requests from cabins.
            Every guest-facing word, field and feature is toggleable in Settings, so the pilot can
            tighten wording week by week without a developer.
          </p>
        </section>

        {/* Accountability teaser */}
        <section className="how-card how-card--slim">
          <div className="kicker how-kicker">Who owns it</div>
          <p className="how-note" style={{ marginTop: 8 }}>
            System ownership, maintenance duties, security features, what-could-break analysis and
            the written SOPs all live on one printable page: <strong>Guest Care HQ → Runbook</strong>.
            If someone new takes over tomorrow, that page is the handover.
          </p>
        </section>
      </main>

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} Muskoka Woods</span>
        <Link to="/">← Guest form</Link>
      </footer>
    </div>
  );
}
