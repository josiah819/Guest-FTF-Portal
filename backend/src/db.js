const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
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
    aiInsights: true,         // "Generate insights" card on the dashboard
    submissionTypes: false,   // issue / request / feedback / compliment selector (RAP's triage infers when off)
    photoUpload: true,
    urgency: true,            // guest urgency selector (selector visibility is fields.urgency)
    tracking: true,           // public status page via tracking code
    csat: true,               // guest star-rating once resolved
    emailUpdates: true,       // guests may leave an email for status-update emails (hidden from guests until SMTP is configured)
    kioskMode: true,          // ?kiosk=1 large-format, auto-resetting form
    hotspots: true,           // repeat-issue detection per location+category
    csvExport: true,
    qrGenerator: true,
    visitTracking: true,      // count guest-form opens (by location + source) for the dashboard
    rapForward: true,         // deliver queued notes to the central RAP intake API (capture always queues; off = pause delivery)
    rapMirror: true,          // sync the RAP board back into the local ticket cache (the inbox's data source)
  },
  // Which engine powers dashboard insights. Secrets stay in env
  // (ANTHROPIC_API_KEY / OPENAI_API_KEY); everything here is safe to show in
  // the admin UI.
  ai: {
    provider: 'anthropic',            // 'anthropic' | 'openai' (any OpenAI-compatible endpoint) | 'keywords'
    anthropicModel: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
    openaiBaseUrl: '',                // e.g. http://10.0.12.50:11434 (Ollama — /v1 appended automatically)
    openaiModel: '',                  // e.g. qwen3:4b
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
      checkStatusLabel: 'Check on this submission →',
      savedNote: 'Saved on this device — scan the QR sign anytime and tap “My submissions”.',
      kioskFollowNote: 'Want to follow along? Scan this with your phone.',
      mySubmissionsLabel: 'Check my submissions',
      kioskResetNote: 'This screen resets automatically.',
      trackLinkLabel: 'My submissions →',
      updatesPrompt: 'Want email updates on this?',
      updatesHint: 'We only use your email for updates on this submission.',
      updatesPlaceholder: 'you@example.com',
      updatesButton: 'Email me updates',
      updatesThanks: 'Got it. We’ll email you when there’s an update.',
    },
    track: {
      pill: 'Submission tracker',
      kicker: 'Hang tight — we’re on it',
      title: 'Check your submission',
      listTitle: 'Your submissions',
      emptyNote: 'Nothing here yet — notes you send from this device will show up here.',
      backToListLabel: '← My submissions',
      beingSorted: 'Being sorted',
      notesTitle: 'Notes from our team',
      ratingPrompt: 'How did we do?',
      ratingThanks: 'thanks for the feedback!',
      ratingCommentPlaceholder: 'Anything to add? (optional)',
      sendRatingLabel: 'Send rating',
      newSubmissionLabel: '← New submission',
      updatesOnNote: 'Email updates are on for this note.',
      updatesStopLabel: 'Stop email updates',
      updatesStoppedNote: 'Email updates are off. We won’t email you about this submission again.',
      goneKicker: 'Nothing to see here',
      goneTitle: 'This submission is no longer available',
      goneNote: 'Our team has removed it, so this link and any update emails about it no longer apply. If you still need a hand, send us a new note.',
    },
    // The printable QR sheet (Locations & QR codes → Sign editor). Newlines in
    // title/subtitle are real line breaks on the sign.
    sign: {
      title: 'Report a\nProblem',
      subtitle: 'Anything wrong with your space?\nTell us and we’ll fix it.',
      scanLine: 'Scan to report it.',
      easyLine: 'No app. No sign-in. No name needed.',
      note: 'This code is fixed to this space',
      showUrl: true,       // append each location’s /?loc= link to the fine print
      qrShape: 'dots',     // dots | squares
      qrCard: false,       // true = forest-on-white card (safest for older scanner apps)
    },
    // Guest update emails (features.emailUpdates). Placeholders: {name} {code}
    // {location} {orgName} {status}. Bodies are plain text — blank lines start
    // a new paragraph; the branded HTML shell is applied at send time.
    emails: {
      footerNote: 'You’re receiving this because you asked for updates on a note you sent to {orgName}. To stop, open your note with the button above and tap “Stop email updates”.',
      signup: {
        subject: 'You’re on the list — {code}',
        heading: 'We’ll keep you posted',
        body: 'Hi {name},\n\nThanks for your note — it’s with our team now. You’ll get an email from us whenever it moves along, and you can check on it anytime with the button below.',
        cta: 'Check my note',
      },
      inProgress: {
        subject: 'We’re on it — {code}',
        heading: 'Your note is in progress',
        body: 'Hi {name},\n\nOur team has picked up your note and is working on it now. We’ll email you again as soon as it’s resolved.',
        cta: 'See the latest',
      },
      resolved: {
        subject: 'All sorted — {code}',
        heading: 'This one’s resolved',
        body: 'Hi {name},\n\nWe’ve just marked your note as resolved. If something still isn’t right, send us another note and we’ll take a second look.\n\nGot 10 seconds? We’d love to know how we did.',
        cta: 'View & rate it',
      },
    },
    // Privacy pages (/privacy and /privacy/staff). Empty = the built-in policy
    // text bundled with the frontend (policyContent.js); a non-empty body
    // replaces it wholesale. Edited under Settings → Content → Privacy pages.
    privacy: {
      guest: { updated: '', body: '' },
      staff: { updated: '', body: '' },
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

// Departments exist locally for dept-scoped viewing (matched against RAP's
// labels) and the guest form's category grouping — routing and hours live on
// the RAP board.
const SEED_DEPARTMENTS = [
  { name: 'Facilities & Maintenance', sort: 1 },
  { name: 'Housekeeping', sort: 2 },
  { name: 'Food Services', sort: 3 },
  { name: 'Program', sort: 4 },
  { name: 'Guest Services', sort: 5 },
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

// Demo ticket seeding retired with the local ticket store — tickets live on
// the RAP board now; a fresh install inbox fills up on the first sync.

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
    } else {
      const data = settingsRows[0].data;
      let dirty = false;
      if (!data.migratedSimpleForm) {
        // One-time v2 flip for existing installs: the guest form drops to
        // message + name + photo and the AI infers type/urgency/category.
        // Everything stays re-enableable in Settings → Form fields.
        data.fields = { ...(data.fields || {}), location: 'optional', urgency: 'off', email: 'off', phone: 'off', group: 'off', category: 'off' };
        data.features = { ...(data.features || {}), submissionTypes: false };
        data.migratedSimpleForm = true;
        dirty = true;
        console.log('[migrate] one-time guest-form simplification applied');
      }
      // The FTF webhook placeholder became the real RAP hand-off (rap.js, env
      // config) — drop its dead settings keys from installs that predate it.
      if (data.features && 'ftfForward' in data.features) {
        delete data.features.ftfForward;
        dirty = true;
      }
      if (data.integrations && 'ftfWebhookUrl' in data.integrations) {
        delete data.integrations.ftfWebhookUrl;
        dirty = true;
        console.log('[migrate] retired the FTF webhook settings (replaced by the RAP hand-off)');
      }
      // Reword the email-updates microcopy. The seed wrote the old strings
      // into every install's settings row, so only an exact match is replaced
      // — anything an admin edited in Settings → Content is left alone.
      const REWORDED = [
        ['form', 'updatesHint', 'We’ll only email you about this note — nothing else, ever.',
          DEFAULT_SETTINGS.content.form.updatesHint],
        ['form', 'updatesThanks', 'You’re on the list — we’ll email you when this moves along.',
          DEFAULT_SETTINGS.content.form.updatesThanks],
        ['track', 'updatesStoppedNote', 'Email updates stopped — you won’t hear from us about this note again.',
          DEFAULT_SETTINGS.content.track.updatesStoppedNote],
      ];
      for (const [section, key, oldText, newText] of REWORDED) {
        if (data.content?.[section]?.[key] === oldText) {
          data.content[section][key] = newText;
          dirty = true;
        }
      }

      if (dirty) {
        await client.query('UPDATE app_settings SET data = $1, updated_at = now() WHERE id = 1',
          [JSON.stringify(data)]);
      }
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
        await client.query('INSERT INTO departments (name, sort) VALUES ($1,$2)',
          [d.name, d.sort]);
      }
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
    // Fresh installs only — an upgraded database (which has captured notes but
    // a lone admin) must never silently gain extra login-able accounts.
    const { rows: preSubCount } = await client.query('SELECT count(*)::int AS n FROM rap_queue');
    const { rows: userCount } = await client.query('SELECT count(*)::int AS n FROM users');
    if (preSubCount[0].n === 0 && userCount[0].n === 1 && (process.env.SEED_DEMO_DATA || 'true') === 'true') {
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
      console.log('[seed] created demo teammates (jake / maria / cindy)');
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, getSettings, saveSettings, migrateAndSeed, DEFAULT_SETTINGS, deepMerge };
