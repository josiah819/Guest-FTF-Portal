import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// The handover page: who owns the system, what can break, how it's secured,
// and the written SOPs. If someone new takes over tomorrow, they start here.

const RISKS = [
  {
    thing: 'Power cut / server restart', odds: 'Low',
    happens: 'Docker restarts every service automatically; submissions are safe in the database.',
    plan: 'Nothing to do. If the site stays down, the maintainer checks the server (steps below).',
  },
  {
    thing: 'AI outage or missing API key', odds: 'Low',
    happens: 'Triage falls back to keyword matching by itself — guests never notice, staff still get categories.',
    plan: 'Nothing urgent. AI summaries pause until the key/service is back.',
  },
  {
    thing: 'System updates / new version breaks something', odds: 'Low',
    happens: 'The previous version stays in git, one command away.',
    plan: 'Maintainer rolls back (SOP 5) and investigates without time pressure.',
  },
  {
    thing: 'Admin password forgotten', odds: 'Medium — people are people',
    happens: 'Nobody can sign in to Guest Care HQ; the guest form keeps working fine.',
    plan: 'Maintainer resets it from the server (SOP 7).',
  },
  {
    thing: 'Disk slowly fills with guest photos', odds: 'Low',
    happens: 'Photos are capped at 8 MB each; if the disk filled, new uploads would start failing.',
    plan: 'Maintainer glances at free space during the monthly backup check.',
  },
  {
    thing: 'Database loss or corruption', odds: 'Very low',
    happens: 'Data lives on a persistent volume that survives rebuilds and restarts.',
    plan: 'Weekly backups (SOP 6) mean the worst case is losing a few days, not a season.',
  },
];

const SECURITY = [
  ['Admin sign-in', 'Passwords are stored bcrypt-hashed, never in plain text. Sessions are signed tokens that expire after 12 hours; deactivating an account locks it out immediately, even mid-session.'],
  ['Roles & permissions', 'Every staff account has a role from the Team page matrix — who can respond, close, re-route, edit content, see other departments’ items, or manage the team is an explicit checkbox, enforced on the server per request.'],
  ['Guest privacy by default', 'Guests need no account and, out of the box, no personal info — name, email and phone are optional fields you can switch off entirely.'],
  ['Spam & abuse limits', 'The public form is rate-limited (12 submissions per 5 minutes per address), and message/field lengths are capped server-side.'],
  ['Photo uploads', 'Images only, 8 MB cap, stored under random unguessable filenames — links can’t be enumerated.'],
  ['Locked-down plumbing', 'The database and backend sit on an internal Docker network with no public ports; only the web front door is exposed, behind the camp reverse proxy (HTTPS at the edge).'],
  ['Secrets hygiene', 'Passwords, tokens and API keys live in a .env file on the server — never committed to git.'],
];

const SOPS = [
  {
    id: 1, title: 'Daily triage', who: 'slaMonitor',
    steps: [
      'Open HQ → Submissions with the “Open” filter, morning and afternoon (the written cadence lives on this page, top card).',
      'Safety items are pinned to the top — handle those first (SOP 2).',
      'For each new item: sanity-check the AI’s category and department; fix with two clicks if it guessed wrong.',
      'Mark “In progress” as soon as someone owns the work — that first touch is what stops the first-response clock.',
      'Can’t tell where it goes? Assign it to Guest Services rather than leaving it unrouted.',
    ],
  },
  {
    id: 2, title: 'Safety submission', who: 'slaMonitor',
    steps: [
      'A red banner sits on the dashboard while any safety item is open — treat it like a page, not a suggestion.',
      'Read the submission immediately and tell the responsible team lead in person or by radio. WoodsVoice is the record, not the emergency channel.',
      'If a guest is at immediate risk, follow the camp emergency procedure first — update the app after.',
      'Mark “In progress” once someone owns it; “Resolved” only when the hazard is actually gone.',
    ],
  },
  {
    id: 3, title: 'Weekly review (Fridays)', who: 'systemOwner',
    steps: [
      'Dashboard, 7-day view: SLA compliance %, hotspots, category mix, guest rating.',
      'Click “Generate insights” and read the AI’s read of the week.',
      'Pick one concrete fix for next week (a wording tweak, a recurring repair, a category change).',
      'First Friday of the month: Export CSV from Submissions and file it for records.',
    ],
  },
  {
    id: 4, title: 'Add a location & post its QR card', who: 'systemOwner',
    steps: [
      'HQ → Locations & QR → type the name (e.g. “Cabin 11”) and area → Add.',
      'Print the QR sheet, cut out the new card, sleeve or laminate it.',
      'Post at eye level near the main door. Scan-test one card from every printed batch with your own phone.',
      'Retiring a spot? Deactivate it — history stays, guests stop seeing it.',
    ],
  },
  {
    id: 5, title: 'Update the app (and roll back)', who: 'maintainer',
    code: 'ssh into the server, then:\n  cd woodsvoice\n  git pull\n  docker compose up -d --build\n\nverify: curl localhost/api/health  →  {"ok":true}\n\nroll back a bad update:\n  git log --oneline        # find the last good commit\n  git checkout <commit>\n  docker compose up -d --build',
    steps: [
      'Update during a quiet hour; the site is only down for a few seconds during the rebuild.',
      'After updating, open the guest form and HQ once — thirty seconds of clicking beats a morning of surprises.',
    ],
  },
  {
    id: 6, title: 'Weekly backup (and restore)', who: 'maintainer',
    code: 'backup (run weekly, keep the last 8):\n  docker compose exec db pg_dump -U woodsvoice woodsvoice > woodsvoice-$(date +%F).sql\n\nrestore into a fresh install:\n  cat woodsvoice-YYYY-MM-DD.sql | docker compose exec -T db psql -U woodsvoice woodsvoice',
    steps: [
      'Store backups off the server (shared drive or object storage).',
      'While you’re there: check free disk space (`df -h`) for the photo volume.',
    ],
  },
  {
    id: 7, title: 'Reset a lost password', who: 'maintainer',
    steps: [
      'Any teammate: someone with “Manage team & roles” opens HQ → Team and clicks Reset password — a one-time temporary password appears; they set their own on first sign-in.',
      'The last remaining admin (nobody can reach the Team page): use the server commands below, then change the password again in Settings → Account so it was only ever typed on the server once.',
    ],
    code: 'generate a new hash:\n  docker compose exec backend node -e "console.log(require(\'bcryptjs\').hashSync(\'NewPassword123\', 10))"\n\nwrite it to the account:\n  docker compose exec db psql -U woodsvoice woodsvoice -c \\\n    "UPDATE users SET password_hash=\'<paste hash>\' WHERE username=\'admin\';"',
  },
  {
    id: 8, title: 'Season start / season end', who: 'systemOwner',
    steps: [
      'Start: check the location list against this year’s cabin map; reprint any weathered QR cards; review categories, department hours and the expectation banner wording.',
      'End: export the season CSV, resolve or close stragglers, and note the season’s SLA compliance in the year-end report.',
    ],
  },
  {
    id: 9, title: 'Add a teammate (or change what they can do)', who: 'systemOwner',
    steps: [
      'HQ → Team → fill in username, name, email (for notifications), pick a role, tick their departments → Create user.',
      'Send them the one-time temporary password over a trusted channel — they’ll be asked to set their own at first sign-in.',
      'Need a permission tweak? Tick or untick boxes in the role matrix — changes apply within seconds, no re-login.',
      'Someone leaves: flip their Active switch off. They’re locked out immediately; their history stays on the timelines.',
    ],
  },
  {
    id: 10, title: 'Department hours, after-hours routing & on-call', who: 'systemOwner',
    steps: [
      'HQ → Settings → Departments → 🕐 Hours on the department row.',
      'Set the weekly hours (or 24/7), what happens after hours (urgency-based is the default: safety/high reroute, the rest wait for opening), the fallback department, and the on-call person.',
      'Held items release automatically at opening with a digest email; their SLA clock starts at opening, so nobody is penalized for being closed.',
      'If every department on a chain is closed, the item stays put and the on-call person + global notify address are emailed.',
    ],
  },
  {
    id: 11, title: 'Switch the AI triage engine', who: 'maintainer',
    steps: [
      'HQ → Settings → AI. Pick Anthropic (needs ANTHROPIC_API_KEY in .env), a local OpenAI-compatible endpoint (e.g. Ollama on an LXC — base URL + model), or keywords-only.',
      'Hit “Test connection” — it runs a real sample classification and shows latency + the parsed result.',
      'Every AI failure already falls back to keywords automatically; switching engines never loses submissions.',
    ],
  },
];

export default function Runbook() {
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(() => new Set([1]));

  useEffect(() => {
    api.settings().then(d => setS(d.settings));
  }, []);

  if (!s) return <div className="center-pad"><span className="spinner" /></div>;

  const acc = s.accountability || {};
  const WHO_LABEL = {
    systemOwner: acc.systemOwner || 'System owner',
    slaMonitor: acc.slaMonitor || 'SLA monitor',
    maintainer: acc.maintainer || 'App maintainer',
  };

  function toggle(id) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Accountability</div>
          <h1 className="display">Runbook & SOPs</h1>
          <div className="sub">Who owns it, what can break, how it’s secured — and the written procedures. This page is the handover.</div>
        </div>
        <div className="actions">
          <button className="btn btn-teal btn-small" onClick={() => window.print()}>🖨 Print runbook</button>
        </div>
      </div>

      {/* Ownership */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Who owns what</h3>
        <p className="hint no-print">Names live in Settings → General → Accountability, so this page never goes stale.</p>
        <div className="own-grid">
          <div className="own">
            <div className="r">System owner</div>
            <div className="n">{acc.systemOwner || '—'}</div>
            <div className="d">Owns the guest experience: wording, categories, locations, which features are on. Runs the weekly review.</div>
          </div>
          <div className="own">
            <div className="r">SLA monitor</div>
            <div className="n">{acc.slaMonitor || '—'}</div>
            <div className="d">Watches the inbox on the cadence below, chases overdue items, answers “are we meeting our targets?”</div>
          </div>
          <div className="own">
            <div className="r">App maintainer</div>
            <div className="n">{acc.maintainer || '—'}</div>
            <div className="d">Updates, backups, restores, password resets — everything that needs the server (SOPs 5–7).</div>
          </div>
          <div className="own own--cad">
            <div className="r">Review cadence</div>
            <div className="n">{acc.reviewCadence || '—'}</div>
            <div className="d">Current SLA targets: first response within <strong>{s.sla.firstResponseHours}h</strong>, resolution within <strong>{s.sla.resolutionHours}h</strong>. Compliance shows on the dashboard.</div>
          </div>
        </div>
        <p className="hint no-print" style={{ margin: '12px 0 0' }}>
          <Link to="/admin/settings">Edit names & targets in Settings →</Link>
        </p>
      </div>

      {/* Risk table */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>What could break — honestly</h3>
        <p className="hint">Likelihoods and what actually happens. Shorter list than most feared; the app is three containers and a database.</p>
        <div className="risk-table">
          {RISKS.map(r => (
            <div className="risk-row" key={r.thing}>
              <div className="risk-head">
                <strong>{r.thing}</strong>
                <span className="badge u-normal">{r.odds}</span>
              </div>
              <div className="risk-body">
                <p><span className="lab">What happens:</span> {r.happens}</p>
                <p><span className="lab">The plan:</span> {r.plan}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Security features</h3>
        <p className="hint">What’s protecting guest data and the admin side, as built.</p>
        <div className="sec-grid">
          {SECURITY.map(([t, d]) => (
            <div className="sec" key={t}>
              <div className="t">🔒 {t}</div>
              <div className="d">{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SOPs */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Standard operating procedures</h3>
        <p className="hint">Eleven short SOPs cover the whole life of the system. Print them; tape SOP 1 and 2 near the Guest Care desk.</p>
        {SOPS.map(sop => {
          const isOpen = open.has(sop.id);
          return (
            <div className={`sop${isOpen ? ' open' : ''}`} key={sop.id}>
              <button className="sop-head" onClick={() => toggle(sop.id)} aria-expanded={isOpen}>
                <span className="num">SOP {sop.id}</span>
                <span className="ttl">{sop.title}</span>
                <span className="who">{WHO_LABEL[sop.who]}</span>
                <span className="chev">{isOpen ? '−' : '+'}</span>
              </button>
              <div className="sop-body">
                <ol>
                  {sop.steps.map((st, i) => <li key={i}>{st}</li>)}
                </ol>
                {sop.code && <pre className="sop-code">{sop.code}</pre>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pilot pointer */}
      <div className="card">
        <h3>Starting small</h3>
        <p className="hint" style={{ marginBottom: 0 }}>
          The phased pilot plan (which areas, which departments, what we measure, and when to widen)
          lives on the shareable <a href="/how" target="_blank" rel="noreferrer">How it works</a> page —
          built to be sent to anyone who asks “so how would we actually roll this out?”
        </p>
      </div>
    </>
  );
}
