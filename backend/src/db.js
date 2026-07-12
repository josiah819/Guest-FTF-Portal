const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { newPublicCode } = require('./util');
const { ROLE_SEEDS, PERMISSION_KEYS } = require('./permissions');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://woodsvoice:woodsvoice@localhost:5432/woodsvoice',
  max: 10,
});

// Single source of truth for every admin-tunable knob. Stored as one JSONB row;
// new keys added here are deep-merged into existing installs on boot.
const DEFAULT_SETTINGS = {
  // Existing installs get the one-time guest-form simplification in
  // migrateAndSeed; fresh installs are born simplified, so the flag ships true.
  migratedSimpleForm: true,
  general: {
    appName: 'WoodsVoice',
    orgName: 'Muskoka Woods',
    timezone: 'America/Toronto',
    welcomeTitle: 'How can we make your stay better?',
    welcomeSubtitle: 'Spotted an issue? Need something? Loved something? Just tell us — it takes about 30 seconds.',
    successTitle: 'Got it — thank you!',
    successMessage: 'Your note is on its way to the right team at the Woods.',
    expectationBanner: 'Our teams review new submissions throughout the day. This is not an instant-response service — for anything urgent or safety-related, please also tell any Muskoka Woods staff member in person.',
    showExpectationBanner: true,
  },
  // Each guest-form field: 'required' | 'optional' | 'off'  (message is always required).
  // Default form = one text box + optional name + optional photo; AI infers the rest.
  fields: {
    location: 'optional',   // auto-locked from the QR code; picker only appears without one
    name: 'optional',
    email: 'off',
    phone: 'off',
    group: 'off',
    urgency: 'off',
    photo: 'optional',
    category: 'off',
  },
  features: {
    aiCategorization: true,   // AI categorizes, types, grades urgency; keyword fallback without a provider
    aiInsights: true,         // "Generate insights" card on the dashboard
    submissionTypes: false,   // issue / request / feedback / compliment selector (AI infers type when off)
    photoUpload: true,
    urgency: true,            // urgency handling + safety flagging (selector visibility is fields.urgency)
    tracking: true,           // public status page via tracking code
    csat: true,               // guest star-rating once resolved
    kioskMode: true,          // ?kiosk=1 large-format, auto-resetting form
    hotspots: true,           // repeat-issue detection per location+category
    sla: true,                // response/resolution targets + overdue flags
    csvExport: true,
    qrGenerator: true,
    ftfForward: false,        // POST each submission to the FTF webhook below
    emailForward: false,      // notify integrations.notifyEmail per submission (needs SMTP env)
  },
  sla: {
    firstResponseHours: 24,
    resolutionHours: 72,
    warnPct: 80,              // scheduler warns a department at this % of the window
    // Per-urgency overrides (null = use the global numbers). Department
    // overrides on the Departments tab beat these.
    urgency: {
      safety: { firstResponseHours: 2, resolutionHours: 12 },
      high: { firstResponseHours: 8, resolutionHours: 24 },
      normal: null,
      low: null,
    },
  },
  // Which engine triages submissions. Secrets stay in env (ANTHROPIC_API_KEY /
  // OPENAI_API_KEY); everything here is safe to show in the admin UI.
  ai: {
    provider: 'anthropic',            // 'anthropic' | 'openai' (any OpenAI-compatible endpoint) | 'keywords'
    anthropicModel: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
    openaiBaseUrl: '',                // e.g. http://10.0.12.50:11434 (Ollama — /v1 appended automatically)
    openaiModel: '',                  // e.g. qwen3:4b
  },
  integrations: { ftfWebhookUrl: '', notifyEmail: '' },
  // Who owns what — shown on the dashboard SLA card and the Runbook page,
  // so "who monitors this?" always has a written answer.
  accountability: {
    systemOwner: 'Guest Services',
    maintainer: 'Josiah (IT)',
    slaMonitor: 'Guest Care lead',
    reviewCadence: 'Inbox checked morning & afternoon · dashboard reviewed Fridays',
  },
  // Every guest-facing string, editable in Settings → Content. deepMerge
  // replaces arrays wholesale, so list editors always PUT complete arrays.
  content: {
    form: {
      messageLabel: 'What’s going on?',
      messagePlaceholder: 'Tell us what happened, what you need, or what made your day…',
      typeLabel: 'What kind of note is this?',
      urgencyLabel: 'How urgent?',
      categoryLabel: 'Category',
      categoryHintAi: 'skip it — we’ll sort it for you',
      categoryHint: 'optional',
      locationLabel: 'Where?',
      locationPlaceholder: 'Choose a location…',
      changeLocationLabel: 'Change',
      photoPrompt: 'Snap or choose a photo (optional, 8 MB max)',
      contactPrompt: 'Add your name so we can follow up',
      contactPromptTag: 'Optional',
      submitLabel: 'Send it to the team →',
      submittingLabel: 'Sending…',
      sendAnotherLabel: 'Send another',
      keepCodePrefix: 'Keep this code to',
      keepCodeLink: 'check on your submission',
      kioskResetNote: 'This screen resets automatically.',
      howLinkLabel: 'How this works',
      trackLinkLabel: 'Check a submission →',
    },
    track: {
      pill: 'Submission tracker',
      kicker: 'Hang tight — we’re on it',
      title: 'Check your submission',
      codePlaceholder: 'MW-XXXXXX',
      lookupLabel: 'Look up',
      beingSorted: 'Being sorted',
      ratingPrompt: 'How did we do?',
      ratingThanks: 'thanks for the feedback!',
      ratingCommentPlaceholder: 'Anything to add? (optional)',
      sendRatingLabel: 'Send rating',
      newSubmissionLabel: '← New submission',
    },
    labels: {
      types: {
        issue: '⚠️ Something’s wrong',
        request: '🙋 I need something',
        feedback: '💡 Idea / feedback',
        compliment: '💚 Shout-out',
      },
      urgencies: { low: 'Whenever', normal: 'Normal', high: 'Today please', safety: '🚨 Safety' },
      statuses: { new: 'Received', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' },
    },
    how: {
      pill: 'How it works',
      kicker: 'WoodsVoice · Guest Care',
      heroTitle: 'From “the shower’s cold” to fixed.',
      heroSubtitle: 'One QR code in every cabin. One 30-second form. AI triage, department routing, response-time tracking — here’s the whole journey, end to end.',
      journey: [
        { emoji: '📱', title: 'Scan the QR in the room',
          body: 'Every cabin and common area gets its own QR card. Scanning opens the form with the location already filled in — the system knows it came from Cabin 3 before the guest types a word.' },
        { emoji: '✍️', title: 'Tell us in one sentence',
          body: 'One required field: the message. Everything else is optional — a name if you’d like a follow-up, a photo if it helps. About 30 seconds, no app to download, no account to create.' },
        { emoji: '✨', title: 'AI triage, instantly',
          body: 'The AI reads the note, works out what kind of note it is, picks the category, grades urgency (safety concerns jump the queue), and writes a one-line summary for staff. The guest never waits on this — it happens after they hit send.' },
        { emoji: '🧭', title: 'Routed to the right team',
          body: 'Each category maps to a department — Facilities, Housekeeping, Food Services, Program, Guest Services. If a department has clocked out, urgent items reroute to whoever is on; the rest wait politely for opening time.' },
        { emoji: '✅', title: 'Worked, resolved, rated',
          body: 'Staff update the status in Guest Care HQ; the guest can follow along with their tracking code. Once resolved, the guest is invited to rate the experience — that becomes our satisfaction score.' },
      ],
      staff: {
        kicker: 'Staff side',
        heading: 'How the team finds out',
        items: [
          { title: 'Safety first.', body: 'Anything flagged as a safety concern pins to the top of the inbox and triggers a red alert on the dashboard until it’s handled.' },
          { title: 'Guest Care HQ inbox.', body: 'Every submission lands in one shared inbox with filters by status, category, location and urgency — checked on a written cadence (see the Runbook).' },
          { title: 'FTF hand-off.', body: 'With one switch, every submission is also POSTed straight into FTF, so Facilities keeps working exactly where they already work.' },
          { title: 'Department email.', body: 'Each department can have a notification address on file — new submissions, SLA warnings and “you have mail from overnight” digests land there.' },
        ],
      },
      measures: {
        kicker: 'Measurement for success',
        heading: 'The numbers we watch',
        items: [
          { title: 'Submissions per week', desc: 'Are guests actually using it? (QR vs web vs kiosk tells us where.)' },
          { title: 'First-response time', desc: 'Hours until a staff member first touches a submission — median and 90th percentile, per department.' },
          { title: 'SLA compliance %', desc: 'Share of submissions answered and resolved inside target — the success number.' },
          { title: 'Misroute rate', desc: 'How often staff re-categorize the AI’s pick — tells us the triage is trustworthy.' },
          { title: 'Guest rating (CSAT)', desc: 'Stars after resolution. The “was it worth it?” score.' },
        ],
        note: 'The dashboard tracks all of these live, with SLA targets (first response & resolution) set per department and per urgency in Settings. Who monitors them, on what cadence, is written down on the Runbook page in Guest Care HQ — accountability by name, not by vibes.',
      },
      demo: {
        show: true,
        kicker: 'The 5-minute demo',
        heading: 'See it live, right now',
        steps: [
          { title: 'Scan the QR on this page', desc: 'Submit a real note — try “The shower in our cabin only runs cold.” Takes ~30 seconds.' },
          { title: 'Open Guest Care HQ', desc: 'The note is already in the inbox: typed, categorized, urgency-graded, with a one-line AI summary.' },
          { title: 'Mark it “In progress”', desc: 'That first touch stops the first-response clock — this is the number the SLA watches.' },
          { title: 'Resolve it', desc: 'The guest’s tracking page updates live, and invites them to rate how we did.' },
          { title: 'Open the Dashboard', desc: 'Volume, categories, hotspots, response times and SLA compliance — the whole story on one screen.' },
        ],
        scanLabel: 'Scan to try it',
        formCta: 'Open the guest form →',
        adminCta: 'Open Guest Care HQ ↗',
      },
      pilot: {
        kicker: 'Start with a test',
        heading: 'The pilot plan',
        phases: [
          { phase: 'Week 0', title: 'Dry run — staff only', who: 'Guest Services + Facilities & Maintenance',
            body: 'Two QR codes in staff areas (staff lounge, front desk). Staff submit real quirks they notice. We tune categories, wording and the expectation banner before a guest ever sees it.' },
          { phase: 'Weeks 1–2', title: 'Small pilot — one guest group', who: 'Add Housekeeping',
            body: 'QR cards in 3–5 cabins plus the dining hall for one school or retreat group. Guest Care checks the inbox morning and afternoon; safety items ping immediately.' },
          { phase: 'Week 3+', title: 'Decide and widen', who: 'Add Food Services + Program',
            body: 'Review the numbers below with Cindy. If they hold up, print QR cards for every cabin and common area and make WoodsVoice the default channel.' },
        ],
        note: 'Start where the volume already is: maintenance and housekeeping requests from cabins. Every guest-facing word, field and feature is editable in Settings, so the pilot can tighten wording week by week without a developer.',
      },
      ownership: {
        kicker: 'Who owns it',
        note: 'System ownership, maintenance duties, security features, what-could-break analysis and the written SOPs all live on one printable page: Guest Care HQ → Runbook. If someone new takes over tomorrow, that page is the handover.',
      },
    },
    branding: {
      logoLight: '',   // shown on dark headers (guest pages); '' = bundled /brand/mw-logo-white.png
      logoDark: '',    // shown on light backgrounds (login); '' = bundled /brand/mw-logo-colour.png
      colors: { teal: '#1E5A64', green: '#A3CD42', orange: '#C26628' },
    },
  },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

async function getSettings() {
  const { rows } = await pool.query('SELECT data FROM app_settings WHERE id = 1');
  if (!rows.length) return DEFAULT_SETTINGS;
  return deepMerge(DEFAULT_SETTINGS, rows[0].data);
}

async function saveSettings(data) {
  const current = await getSettings();
  const merged = deepMerge(current, data);
  await pool.query(
    `INSERT INTO app_settings (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
    [JSON.stringify(merged)]
  );
  return merged;
}

// Weekly hours ({"mon":["08:00","20:00"],…}; null day = closed, null hours = 24/7).
const week = (open, close, overrides = {}) => {
  const out = {};
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    out[d] = overrides[d] !== undefined ? overrides[d] : [open, close];
  }
  return out;
};

const SEED_DEPARTMENTS = [
  { name: 'Facilities & Maintenance', sort: 1, hours: week('07:00', '20:00') },
  { name: 'Housekeeping', sort: 2, hours: week('08:00', '16:00') },
  { name: 'Food Services', sort: 3, hours: week('06:30', '19:00') },
  { name: 'Program', sort: 4, hours: week('08:00', '21:00') },
  // The safety net: longest hours, no fallback of its own (on-call covers the gap).
  { name: 'Guest Services', sort: 5, hours: week('07:00', '23:00') },
];

const SEED_CATEGORIES = [
  { slug: 'maintenance',  name: 'Maintenance',        emoji: '🔧', dept: 'Facilities & Maintenance', sort: 1 },
  { slug: 'housekeeping', name: 'Housekeeping',       emoji: '🧹', dept: 'Housekeeping',             sort: 2 },
  { slug: 'food',         name: 'Food Service',       emoji: '🍽️', dept: 'Food Services',            sort: 3 },
  { slug: 'program',      name: 'Program & Activities', emoji: '🏕️', dept: 'Program',                sort: 4 },
  { slug: 'lost-found',   name: 'Lost & Found',       emoji: '🧢', dept: 'Guest Services',           sort: 5 },
  { slug: 'other',        name: 'Something Else',     emoji: '💬', dept: 'Guest Services',           sort: 6 },
];

const SEED_LOCATIONS = [
  ...Array.from({ length: 10 }, (_, i) => ({
    slug: `cabin-${i + 1}`, name: `Cabin ${i + 1}`, area: 'Cabins', sort: i + 1,
  })),
  { slug: 'dining-hall',    name: 'Dining Hall',        area: 'Common Areas', sort: 20 },
  { slug: 'welcome-centre', name: 'Welcome Centre',     area: 'Common Areas', sort: 21 },
  { slug: 'rec-centre',     name: 'Rec Centre',         area: 'Common Areas', sort: 22 },
  { slug: 'waterfront',     name: 'Waterfront',         area: 'Common Areas', sort: 23 },
  { slug: 'sports-fields',  name: 'Sports Fields',      area: 'Common Areas', sort: 24 },
  { slug: 'chapel',         name: 'Chapel',             area: 'Common Areas', sort: 25 },
];

const DEMO_MESSAGES = [
  { cat: 'maintenance',  type: 'issue',      msg: 'The shower in our cabin only runs cold water no matter how long we wait.', urg: 'high' },
  { cat: 'maintenance',  type: 'issue',      msg: 'Light over the back bunks is flickering and buzzing all night.', urg: 'normal' },
  { cat: 'maintenance',  type: 'issue',      msg: 'Screen door latch is broken so the door bangs in the wind.', urg: 'low' },
  { cat: 'maintenance',  type: 'issue',      msg: 'There is a loose board on the steps up to the cabin — someone could trip.', urg: 'safety' },
  { cat: 'housekeeping', type: 'request',    msg: 'Could we get a couple of extra blankets? It got pretty cold last night.', urg: 'normal' },
  { cat: 'housekeeping', type: 'issue',      msg: 'Washroom is out of paper towel and soap.', urg: 'normal' },
  { cat: 'housekeeping', type: 'request',    msg: 'We spilled juice on the floor — could someone bring a mop or we can do it ourselves?', urg: 'low' },
  { cat: 'food',         type: 'feedback',   msg: 'One of our students has a severe nut allergy — just double checking tomorrow’s menu is safe.', urg: 'high' },
  { cat: 'food',         type: 'compliment', msg: 'The butter chicken at dinner was unreal. Our whole group is still talking about it.', urg: 'low' },
  { cat: 'food',         type: 'request',    msg: 'Could we get a gluten-free option at breakfast for two of our leaders?', urg: 'normal' },
  { cat: 'program',      type: 'compliment', msg: 'Our group leader Mike was incredible on the high ropes today. Kids were buzzing.', urg: 'low' },
  { cat: 'program',      type: 'request',    msg: 'Is there any chance we could swap archery for climbing tomorrow afternoon?', urg: 'normal' },
  { cat: 'program',      type: 'feedback',   msg: 'Evening program ran late and our grade 6s were wiped for devotions.', urg: 'low' },
  { cat: 'lost-found',   type: 'request',    msg: 'A student left a blue hoodie with a school crest at the waterfront around 3pm.', urg: 'normal' },
  { cat: 'lost-found',   type: 'request',    msg: 'Looking for a retainer in a green case, probably near the dining hall.', urg: 'normal' },
  { cat: 'other',        type: 'compliment', msg: 'Check-in was the smoothest we’ve had at any camp. Thank you!', urg: 'low' },
  { cat: 'other',        type: 'issue',      msg: 'Wifi in the leaders’ lounge keeps dropping every few minutes.', urg: 'low' },
  { cat: 'food',         type: 'issue',      msg: 'Juice machine at lunch was empty for most of our seating.', urg: 'low' },
  { cat: 'housekeeping', type: 'issue',      msg: 'Found a wasp nest starting under the eaves outside the side door.', urg: 'safety' },
  { cat: 'program',      type: 'compliment', msg: 'The campfire night was the highlight of our trip. Staff energy was amazing.', urg: 'low' },
];

async function seedDemoSubmissions(client) {
  const cats = (await client.query('SELECT id, slug, department_id FROM categories')).rows;
  const locs = (await client.query('SELECT id, name FROM locations')).rows;
  const bySlug = Object.fromEntries(cats.map(c => [c.slug, c]));
  const guests = ['Sarah M.', 'Coach Daniels', 'Mr. Okafor', '', 'Jess (teacher)', '', 'Pastor Kim', ''];
  const groups = ['Maplewood PS', 'St. Andrew’s College', 'Trinity Youth', 'Lakefield SS', ''];
  const total = 46;

  for (let i = 0; i < total; i++) {
    const tpl = DEMO_MESSAGES[i % DEMO_MESSAGES.length];
    const cat = bySlug[tpl.cat];
    const loc = locs[(i * 7) % locs.length];
    const daysAgo = Math.floor(Math.pow((i / total), 1.4) * 20); // denser recently
    const hour = 8 + ((i * 5) % 12);
    const created = new Date(Date.now() - daysAgo * 86400000);
    created.setHours(hour, (i * 13) % 60, 0, 0);

    // Older items resolved, mid-age in progress, newest still new
    let status = 'new', firstResp = null, resolved = null;
    if (daysAgo >= 2) {
      status = 'resolved';
      firstResp = new Date(created.getTime() + (1 + (i % 9)) * 3600000);
      resolved = new Date(created.getTime() + (4 + (i % 40)) * 3600000);
    } else if (daysAgo >= 1 || i % 3 === 0) {
      status = 'in_progress';
      firstResp = new Date(created.getTime() + (1 + (i % 6)) * 3600000);
    }
    const rating = status === 'resolved' && i % 2 === 0 ? 3 + (i % 3) : null;

    // SLA columns mirror what routing would have computed (urgency defaults).
    const targets = tpl.urg === 'safety' ? [2, 12] : tpl.urg === 'high' ? [8, 24] : [24, 72];
    const respDue = new Date(created.getTime() + targets[0] * 3600000);
    const resoDue = new Date(created.getTime() + targets[1] * 3600000);
    const { rows } = await client.query(
      `INSERT INTO submissions
        (public_code, type, status, category_id, department_id, location_id, location_text,
         message, urgency, guest_name, group_name, source, ai_processed,
         rating, created_at, first_response_at, resolved_at,
         triage_via, sla_start_at, first_response_due_at, resolution_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,$17,$14,$18,$19) RETURNING id`,
      [newPublicCode(), tpl.type, status, cat.id, cat.department_id, loc.id, loc.name,
       tpl.msg, tpl.urg, guests[i % guests.length], groups[i % groups.length],
       i % 5 === 0 ? 'kiosk' : 'qr', rating, created, firstResp, resolved,
       i % 6 === 0 ? 'keywords' : 'ai', respDue, resoDue]
    );
    const sid = rows[0].id;
    await client.query(
      `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at)
       VALUES ($1,'created','Submission received',true,$2)`, [sid, created]);
    if (firstResp) {
      await client.query(
        `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at)
         VALUES ($1,'status','Status changed to In progress',true,$2)`, [sid, firstResp]);
    }
    if (resolved) {
      await client.query(
        `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at)
         VALUES ($1,'status','Status changed to Resolved',true,$2)`, [sid, resolved]);
    }
  }

  // Backfill breach/warn flags where the demo timeline actually missed targets,
  // so the scorecards' breach column and the scheduler's idempotency line up.
  await client.query(
    `UPDATE submissions SET response_warned_at = first_response_due_at, response_breached_at = first_response_due_at
      WHERE first_response_due_at < now()
        AND (first_response_at IS NULL OR first_response_at > first_response_due_at)`);
  await client.query(
    `UPDATE submissions SET resolution_warned_at = resolution_due_at, resolution_breached_at = resolution_due_at
      WHERE resolution_due_at < now()
        AND (resolved_at IS NULL OR resolved_at > resolution_due_at)`);

  // A couple of items assigned to the Facilities lead.
  await client.query(
    `UPDATE submissions SET assigned_user_id = (SELECT id FROM users WHERE username = 'jake')
      WHERE id IN (SELECT id FROM submissions
                    WHERE department_id = (SELECT id FROM departments WHERE name = 'Facilities & Maintenance')
                      AND status = 'in_progress' LIMIT 2)`);

  // Showcase: an overnight note held for Housekeeping's opening…
  const heldOpen = await client.query(
    `SELECT (CASE WHEN now()::time < '08:00' THEN date_trunc('day', now()) + interval '8 hours'
                  ELSE date_trunc('day', now()) + interval '32 hours' END) AS opens`);
  const opens = heldOpen.rows[0].opens;
  const { rows: heldRow } = await client.query(
    `INSERT INTO submissions
      (public_code, type, status, category_id, department_id, location_id, location_text, message,
       urgency, source, ai_processed, triage_via, created_at,
       sla_start_at, first_response_due_at, resolution_due_at, held_until)
     SELECT $1, 'request', 'new', c.id, c.department_id, l.id, l.name,
            'Could we get two more pillows for the bottom bunks whenever housekeeping is around tomorrow?',
            'low', 'qr', true, 'ai', now() - interval '2 hours',
            $2, $2::timestamptz + interval '24 hours', $2::timestamptz + interval '72 hours', $2
       FROM categories c, locations l
      WHERE c.slug = 'housekeeping' AND l.slug = 'cabin-4' RETURNING id`,
    [newPublicCode(), opens]);
  if (heldRow.length) {
    await client.query(
      `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at) VALUES
        ($1,'created','Submission received',true, now() - interval '2 hours'),
        ($1,'ai','Triage (demo): routed to Housekeeping, type request, urgency low', false, now() - interval '2 hours'),
        ($1,'route','Housekeeping is closed — held until opening; the SLA clock starts then', false, now() - interval '2 hours')`,
      [heldRow[0].id]);
  }

  // …and an overnight safety item rerouted to Guest Services.
  const { rows: reroutedRow } = await client.query(
    `INSERT INTO submissions
      (public_code, type, status, category_id, department_id, location_id, location_text, message,
       urgency, source, ai_processed, triage_via, created_at, rerouted_from_department_id,
       sla_start_at, first_response_due_at, resolution_due_at, first_response_at)
     SELECT $1, 'issue', 'in_progress', c.id,
            (SELECT id FROM departments WHERE name = 'Guest Services'),
            l.id, l.name,
            'The railing on the cabin steps came loose tonight — someone could fall in the dark.',
            'safety', 'qr', true, 'ai', now() - interval '90 minutes', c.department_id,
            now() - interval '90 minutes', now() + interval '30 minutes', now() + interval '10.5 hours',
            now() - interval '55 minutes'
       FROM categories c, locations l
      WHERE c.slug = 'maintenance' AND l.slug = 'cabin-7' RETURNING id`,
    [newPublicCode()]);
  if (reroutedRow.length) {
    await client.query(
      `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at) VALUES
        ($1,'created','Submission received',true, now() - interval '90 minutes'),
        ($1,'ai','Triage (demo): routed to Facilities & Maintenance, type issue, urgency safety', false, now() - interval '90 minutes'),
        ($1,'route','Facilities & Maintenance is closed — rerouted to Guest Services', false, now() - interval '90 minutes'),
        ($1,'status','Status changed to In progress',true, now() - interval '55 minutes')`,
      [reroutedRow[0].id]);
  }
}

async function migrateAndSeed() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: settingsRows } = await client.query('SELECT data FROM app_settings WHERE id = 1');
    if (!settingsRows.length) {
      await client.query('INSERT INTO app_settings (id, data) VALUES (1, $1)',
        [JSON.stringify(DEFAULT_SETTINGS)]);
    } else if (!settingsRows[0].data.migratedSimpleForm) {
      // One-time v2 flip for existing installs: the guest form drops to
      // message + name + photo and the AI infers type/urgency/category.
      // Everything stays re-enableable in Settings → Form fields.
      const data = settingsRows[0].data;
      data.fields = { ...(data.fields || {}), location: 'optional', urgency: 'off', email: 'off', phone: 'off', group: 'off', category: 'off' };
      data.features = { ...(data.features || {}), submissionTypes: false };
      data.migratedSimpleForm = true;
      await client.query('UPDATE app_settings SET data = $1, updated_at = now() WHERE id = 1',
        [JSON.stringify(data)]);
      console.log('[migrate] one-time guest-form simplification applied');
    }

    // Roles: seed the starter set once, then keep Administrator topped up with
    // every permission key (so new keys added in code reach existing installs),
    // and adopt any pre-RBAC accounts as Administrators.
    const { rows: roleRows } = await client.query('SELECT count(*)::int AS n FROM roles');
    if (roleRows[0].n === 0) {
      for (const r of ROLE_SEEDS) {
        const { rows } = await client.query(
          'INSERT INTO roles (name, is_system) VALUES ($1,$2) RETURNING id', [r.name, r.isSystem]);
        for (const p of r.perms) {
          await client.query('INSERT INTO role_permissions (role_id, perm) VALUES ($1,$2)', [rows[0].id, p]);
        }
      }
      console.log('[seed] created starter roles');
    }
    await client.query(
      `INSERT INTO role_permissions (role_id, perm)
       SELECT r.id, k FROM roles r, unnest($1::text[]) AS k
        WHERE r.is_system
       ON CONFLICT DO NOTHING`, [PERMISSION_KEYS]);
    await client.query(
      `UPDATE users SET role_id = (SELECT id FROM roles WHERE is_system ORDER BY id LIMIT 1)
        WHERE role_id IS NULL`);

    const { rows: deptRows } = await client.query('SELECT count(*)::int AS n FROM departments');
    if (deptRows[0].n === 0) {
      for (const d of SEED_DEPARTMENTS) {
        await client.query('INSERT INTO departments (name, sort, hours) VALUES ($1,$2,$3)',
          [d.name, d.sort, d.hours ? JSON.stringify(d.hours) : null]);
      }
      // After-hours reroutes all point at Guest Services (longest hours).
      await client.query(
        `UPDATE departments SET fallback_department_id = (SELECT id FROM departments WHERE name = 'Guest Services')
          WHERE name <> 'Guest Services'`);
      for (const c of SEED_CATEGORIES) {
        await client.query(
          `INSERT INTO categories (slug, name, emoji, department_id, sort)
           VALUES ($1,$2,$3,(SELECT id FROM departments WHERE name=$4),$5)`,
          [c.slug, c.name, c.emoji, c.dept, c.sort]);
      }
      for (const l of SEED_LOCATIONS) {
        await client.query('INSERT INTO locations (slug, name, area, sort) VALUES ($1,$2,$3,$4)',
          [l.slug, l.name, l.area, l.sort]);
      }
    }

    const { rows: adminRows } = await client.query('SELECT count(*)::int AS n FROM users');
    if (adminRows[0].n === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'WoodsVoice!demo';
      const hash = bcrypt.hashSync(password, 10);
      await client.query(
        `INSERT INTO users (username, display_name, password_hash, role_id)
         VALUES ($1,$2,$3,(SELECT id FROM roles WHERE is_system ORDER BY id LIMIT 1))`,
        [username, 'Guest Care Admin', hash]);
      console.log(`[seed] created admin account "${username}"`);
    }

    // Demo teammates: one per starter role, so the Team page and dept scoping
    // have something to show. Same demo password as the admin account.
    const { rows: userCount } = await client.query('SELECT count(*)::int AS n FROM users');
    if (userCount[0].n === 1 && (process.env.SEED_DEMO_DATA || 'true') === 'true') {
      const demoHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'WoodsVoice!demo', 10);
      const DEMO_USERS = [
        { username: 'jake', name: 'Jake R (Facilities lead)', role: 'Department Lead', depts: ['Facilities & Maintenance'] },
        { username: 'maria', name: 'Maria S (Housekeeping)', role: 'Staff', depts: ['Housekeeping'] },
        { username: 'cindy', name: 'Cindy B (Director)', role: 'Viewer', depts: [] },
      ];
      for (const u of DEMO_USERS) {
        const { rows } = await client.query(
          `INSERT INTO users (username, display_name, password_hash, role_id)
           VALUES ($1,$2,$3,(SELECT id FROM roles WHERE name = $4)) RETURNING id`,
          [u.username, u.name, demoHash, u.role]);
        for (const dept of u.depts) {
          await client.query(
            `INSERT INTO user_departments (user_id, department_id)
             SELECT $1, id FROM departments WHERE name = $2 ON CONFLICT DO NOTHING`,
            [rows[0].id, dept]);
        }
      }
      await client.query(
        `UPDATE departments SET on_call_user_id = (SELECT min(id) FROM users)
          WHERE name = 'Guest Services' AND on_call_user_id IS NULL`);
      console.log('[seed] created demo teammates (jake / maria / cindy)');
    }

    const { rows: subRows } = await client.query('SELECT count(*)::int AS n FROM submissions');
    if (subRows[0].n === 0 && (process.env.SEED_DEMO_DATA || 'true') === 'true') {
      await seedDemoSubmissions(client);
      console.log('[seed] loaded demo submissions');
    }

    // SLA backfill: rows from before the hours-aware clock (or that slipped
    // through routing) get wall-clock due dates from the global targets.
    const { rows: slaSet } = await client.query('SELECT data FROM app_settings WHERE id = 1');
    const slaCfg = slaSet[0]?.data?.sla || {};
    await client.query(
      `UPDATE submissions SET
         sla_start_at = created_at,
         first_response_due_at = created_at + make_interval(hours => $1),
         resolution_due_at = created_at + make_interval(hours => $2)
       WHERE sla_start_at IS NULL`,
      [slaCfg.firstResponseHours || 24, slaCfg.resolutionHours || 72]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, getSettings, saveSettings, migrateAndSeed, DEFAULT_SETTINGS };
