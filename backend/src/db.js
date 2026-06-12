const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { newPublicCode } = require('./util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://woodsvoice:woodsvoice@localhost:5432/woodsvoice',
  max: 10,
});

// Single source of truth for every admin-tunable knob. Stored as one JSONB row;
// new keys added here are deep-merged into existing installs on boot.
const DEFAULT_SETTINGS = {
  general: {
    appName: 'WoodsVoice',
    orgName: 'Muskoka Woods',
    welcomeTitle: 'How can we make your stay better?',
    welcomeSubtitle: 'Spotted an issue? Need something? Loved something? It takes about 30 seconds.',
    successTitle: 'Got it — thank you!',
    successMessage: 'Your note is on its way to the right team at the Woods.',
    expectationBanner: 'Our teams review new submissions throughout the day. This is not an instant-response service — for anything urgent or safety-related, please also tell any Muskoka Woods staff member in person.',
    showExpectationBanner: true,
  },
  // Each guest-form field: 'required' | 'optional' | 'off'  (message is always required)
  fields: {
    location: 'required',
    name: 'optional',
    email: 'optional',
    phone: 'off',
    group: 'optional',
    urgency: 'optional',
    photo: 'optional',
  },
  features: {
    aiCategorization: true,   // Claude categorizes + sets urgency; keyword fallback without API key
    aiInsights: true,         // "Generate insights" card on the dashboard
    submissionTypes: true,    // issue / request / feedback / compliment selector
    photoUpload: true,
    urgency: true,            // urgency selector + safety flagging
    tracking: true,           // public status page via tracking code
    csat: true,               // guest star-rating once resolved
    kioskMode: true,          // ?kiosk=1 large-format, auto-resetting form
    hotspots: true,           // repeat-issue detection per location+category
    sla: true,                // response/resolution targets + overdue flags
    csvExport: true,
    qrGenerator: true,
    ftfForward: false,        // POST each submission to the FTF webhook below
    emailForward: false,      // hand-off stub: logs intended notification per department
  },
  sla: { firstResponseHours: 24, resolutionHours: 72 },
  integrations: { ftfWebhookUrl: '', notifyEmail: '' },
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

    const { rows } = await client.query(
      `INSERT INTO submissions
        (public_code, type, status, category_id, department_id, location_id, location_text,
         message, urgency, guest_name, group_name, source, ai_processed,
         rating, created_at, first_response_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16) RETURNING id`,
      [newPublicCode(), tpl.type, status, cat.id, cat.department_id, loc.id, loc.name,
       tpl.msg, tpl.urg, guests[i % guests.length], groups[i % groups.length],
       i % 5 === 0 ? 'kiosk' : 'qr', rating, created, firstResp, resolved]
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
}

async function migrateAndSeed() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: settingsRows } = await client.query('SELECT id FROM app_settings WHERE id = 1');
    if (!settingsRows.length) {
      await client.query('INSERT INTO app_settings (id, data) VALUES (1, $1)',
        [JSON.stringify(DEFAULT_SETTINGS)]);
    }

    const { rows: deptRows } = await client.query('SELECT count(*)::int AS n FROM departments');
    if (deptRows[0].n === 0) {
      for (const d of SEED_DEPARTMENTS) {
        await client.query('INSERT INTO departments (name, sort) VALUES ($1,$2)', [d.name, d.sort]);
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

    const { rows: adminRows } = await client.query('SELECT count(*)::int AS n FROM admins');
    if (adminRows[0].n === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'WoodsVoice!demo';
      const hash = bcrypt.hashSync(password, 10);
      await client.query(
        'INSERT INTO admins (username, display_name, password_hash) VALUES ($1,$2,$3)',
        [username, 'Guest Care Admin', hash]);
      console.log(`[seed] created admin account "${username}"`);
    }

    const { rows: subRows } = await client.query('SELECT count(*)::int AS n FROM submissions');
    if (subRows[0].n === 0 && (process.env.SEED_DEMO_DATA || 'true') === 'true') {
      await seedDemoSubmissions(client);
      console.log('[seed] loaded demo submissions');
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, getSettings, saveSettings, migrateAndSeed, DEFAULT_SETTINGS };
