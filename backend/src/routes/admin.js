const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool, getSettings, saveSettings, deepMerge } = require('../db');
const { aw, clampStr, newFileName, publicOrigin } = require('../util');
const { smtpEnabled } = require('../notify');
const { EMAIL_KINDS, renderGuestEmail } = require('../guestUpdates');
const { requireAuth, login, loginGoogle, changePassword } = require('../auth');
const { googleEnabled, GOOGLE_CLIENT_ID } = require('../google');
const { attachActor, requirePerm } = require('../rbac');
const { dashboardMetrics, insightsInput } = require('../metrics');
const { generateInsights, aiEnabled } = require('../classify');
const { rapStatus } = require('../rap');
const { rapSyncStatus, probeSync } = require('../rapSync');

const router = express.Router();

router.post('/login', login);
router.post('/login/google', loginGoogle);
// Public on purpose: the login page needs the client id before anyone signs in.
router.get('/sso', (req, res) => res.json({ googleClientId: googleEnabled() ? GOOGLE_CLIENT_ID : '' }));
router.use(requireAuth);
router.use(attachActor);
router.post('/change-password', changePassword);

// Who am I, and what may I do — the frontend gates its nav and buttons off this.
router.get('/me', (req, res) => {
  const a = req.actor;
  res.json({
    user: { id: a.id, username: a.username, name: a.displayName, email: a.email, role: a.roleName },
    perms: [...a.perms],
    deptIds: a.deptIds,
    mustChangePassword: a.mustChangePassword,
  });
});

// Team & roles (users.manage enforced inside).
router.use(require('./team'));

// ---------- settings ----------

router.get('/settings', aw(async (req, res) => {
  res.json({ settings: await getSettings(), aiKeyPresent: aiEnabled(), smtpConfigured: smtpEnabled() });
}));

router.put('/settings', aw(async (req, res) => {
  const allowed = ['general', 'fields', 'features', 'integrations', 'content', 'ai'];
  const patch = {};
  for (const key of allowed) if (req.body[key] && typeof req.body[key] === 'object') patch[key] = req.body[key];

  // content is its own permission; general holds guest wording so either perm
  // may edit it; everything else is settings.manage.
  const perms = req.actor.perms;
  const sections = Object.keys(patch);
  if (sections.includes('content') && !perms.has('content.manage')) {
    return res.status(403).json({ error: 'You don’t have permission to edit content.' });
  }
  if (sections.includes('general') && !(perms.has('settings.manage') || perms.has('content.manage'))) {
    return res.status(403).json({ error: 'You don’t have permission to change settings.' });
  }
  if (sections.some(k => k !== 'content' && k !== 'general') && !perms.has('settings.manage')) {
    return res.status(403).json({ error: 'You don’t have permission to change settings.' });
  }
  res.json({ settings: await saveSettings(patch) });
}));

// Delivery + board-sync health, for the Settings → Features readout (and the
// inbox's board links). Never exposes the key — just whether one is configured.
router.get('/rap/status', aw(async (req, res) => {
  const settings = await getSettings();
  res.json({
    enabled: settings.features.rapForward !== false,
    ...(await rapStatus()),
    sync: { enabled: settings.features.rapMirror !== false, ...(await rapSyncStatus()) },
  });
}));

// One diagnostic fetch of RAP's export API — reports HTTP status and response
// shape so a key/endpoint problem is debuggable from Settings. On success it
// clears a sync halt and kicks an immediate sync.
router.post('/rap/sync/test', requirePerm('settings.manage'), aw(async (req, res) => {
  res.json(await probeSync());
}));

// Render one guest update email with sample data — the Content tab's preview.
// Draft (unsaved) content comes in the body so edits show before saving.
router.post('/emails/preview', requirePerm('content.manage'), aw(async (req, res) => {
  const kind = EMAIL_KINDS.includes(req.body.kind) ? req.body.kind : 'signup';
  let settings = await getSettings();
  if (req.body.content && typeof req.body.content === 'object' && !Array.isArray(req.body.content)) {
    settings = deepMerge(settings, { content: req.body.content });
  }
  const sample = {
    public_code: 'MW-4KQ7F2',
    guest_name: 'Alex',
    location: 'Cabin 4',
    status: kind === 'resolved' ? 'resolved' : (kind === 'inProgress' ? 'in_progress' : 'open'),
  };
  res.json(renderGuestEmail(kind, sample, settings, publicOrigin(req)));
}));

// ---------- branding ----------

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, newFileName(path.extname(file.originalname) || '.png')),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

router.post('/branding/logo', requirePerm('content.manage'), logoUpload.single('logo'), aw(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pick an image file (2 MB max).' });
  const slot = req.body.slot === 'dark' ? 'logoDark' : 'logoLight';
  const settings = await saveSettings({ content: { branding: { [slot]: `/uploads/${req.file.filename}` } } });
  res.json({ settings });
}));

// ---------- tickets (read-only window over the RAP board cache) ----------
//
// Ticket work — status changes, routing, notes — happens on the RAP board
// itself and syncs back here. These endpoints only read the rap_tickets cache
// joined to our capture ledger (rap_queue), which adds the guest-facing extras
// RAP doesn't hold for us: MW code, photo, source channel, CSAT rating.

const VIEW_SUBMISSIONS = ['submissions.view_all', 'submissions.view_dept'];

// RAP department word → word to look for in our department names
// (their "Kitchen" is our "Food Services").
const DEPT_ALIASES = { kitchen: 'food' };

// Department-scoped staff see the tickets whose RAP department label matches
// one of their local departments (whole-word matching — a short label like
// "it" must not claim "Facil-it-ies"). Returns null = unscoped, [] = nothing.
async function rapDeptScope(actor) {
  if (actor.perms.has('submissions.view_all')) return null;
  const deptIds = actor.deptIds || [];
  if (!deptIds.length) return [];
  const { rows: depts } = await pool.query(
    'SELECT name FROM departments WHERE id = ANY($1)', [deptIds]);
  const { rows: labels } = await pool.query(
    `SELECT DISTINCT department FROM rap_tickets WHERE department <> ''`);
  const tokenSets = depts.map(d => d.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return labels.map(r => r.department).filter(label => {
    const wants = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const aliases = wants.map(w => Object.hasOwn(DEPT_ALIASES, w) ? DEPT_ALIASES[w] : null).filter(Boolean);
    return tokenSets.some(tokens =>
      wants.every(w => tokens.includes(w)) || aliases.some(a => tokens.includes(a)));
  });
}

// Shared projection + join for list/detail.
const TICKET_FIELDS = `
         rt.id, rt.status, rt.category, rt.department, rt.severity, rt.mood,
         rt.building, rt.summary, rt.synced_at,
         coalesce(nullif(rt.text, ''), q.payload->>'text', '') AS message,
         coalesce(q.created_at, rt.rap_created_at, rt.first_seen_at) AS created_at,
         coalesce(rt.rap_resolved_at, rt.observed_resolved_at) AS resolved_at,
         rt.observed_response_at,
         q.public_code, q.guest_name, coalesce(q.payload->>'group_name', '') AS group_name,
         q.photo_path, q.source, q.rating, q.location_name,
         (q.id IS NOT NULL) AS from_woodsvoice`;
const TICKET_FROM = `
    FROM rap_tickets rt
    LEFT JOIN rap_queue q ON q.rap_ticket_id = rt.id`;

router.get('/submissions', requirePerm(...VIEW_SUBMISSIONS), aw(async (req, res) => {
  const where = [];
  const params = [];
  let i = 1;
  const { status, category, department, origin, severity, q } = req.query;
  if (status && status !== 'all') {
    if (status === 'active') where.push(`rt.status IN ('open','in_progress')`);
    else { where.push(`rt.status = $${i++}`); params.push(clampStr(status, 80)); }
  }
  if (category)   { where.push(`rt.category = $${i++}`); params.push(clampStr(category, 120)); }
  if (department) { where.push(`rt.department = $${i++}`); params.push(clampStr(department, 120)); }
  if (severity)   { where.push(`rt.severity = $${i++}`); params.push(parseInt(severity, 10) || 0); }
  if (origin === 'woodsvoice') where.push(`q.id IS NOT NULL`);
  if (origin === 'other')      where.push(`q.id IS NULL`);
  if (q) {
    where.push(`(coalesce(nullif(rt.text,''), q.payload->>'text', '') ILIKE $${i}
      OR rt.summary ILIKE $${i} OR rt.building ILIKE $${i}
      OR q.public_code ILIKE $${i} OR q.guest_name ILIKE $${i}
      OR coalesce(q.payload->>'group_name','') ILIKE $${i})`);
    params.push(`%${clampStr(q, 100)}%`); i++;
  }
  const scope = await rapDeptScope(req.actor);
  if (scope !== null) { where.push(`rt.department = ANY($${i++})`); params.push(scope); }

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 25;
  params.push(pageSize, (page - 1) * pageSize);
  const order = req.query.sort === 'oldest' ? 'ASC' : 'DESC';

  const sql = `SELECT ${TICKET_FIELDS},
     count(*) OVER()::int AS total_rows
     ${TICKET_FROM}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (rt.severity = 5 AND rt.status IN ('open','in_progress')) DESC, created_at ${order}
     LIMIT $${i++} OFFSET $${i++}`;
  const { rows } = await pool.query(sql, params);
  res.json({ rows, total: rows[0]?.total_rows || 0, page, pageSize });
}));

// Queue-health numbers for the inbox header tiles, plus the filter facets
// (RAP's own status/category/department vocabulary, learned from the data).
router.get('/submissions/stats', requirePerm(...VIEW_SUBMISSIONS), aw(async (req, res) => {
  const scope = await rapDeptScope(req.actor);
  const where = scope === null ? '' : 'WHERE rt.department = ANY($1)';
  const params = scope === null ? [] : [scope];
  const [stats, facets] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE rt.status = 'open')::int AS new_count,
         count(*) FILTER (WHERE rt.status = 'in_progress')::int AS in_progress,
         round((max(EXTRACT(EPOCH FROM (now() - coalesce(q.created_at, rt.rap_created_at, rt.first_seen_at))) / 3600.0)
           FILTER (WHERE rt.status IN ('open','in_progress')))::numeric, 1) AS oldest_open_h,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY
             EXTRACT(EPOCH FROM (rt.observed_response_at - coalesce(q.created_at, rt.rap_created_at, rt.first_seen_at))) / 3600.0)
           FILTER (WHERE rt.observed_response_at IS NOT NULL
             AND coalesce(q.created_at, rt.rap_created_at, rt.first_seen_at) > now() - interval '7 days'))::numeric, 1) AS median_first_action_h,
         count(*) FILTER (WHERE coalesce(rt.rap_resolved_at, rt.observed_resolved_at) > now() - interval '7 days')::int AS resolved_7d
         FROM rap_tickets rt
         LEFT JOIN rap_queue q ON q.rap_ticket_id = rt.id
        ${where}`, params),
    pool.query(
      `SELECT
         array(SELECT DISTINCT status FROM rap_tickets WHERE status <> '' ORDER BY 1) AS statuses,
         array(SELECT DISTINCT category FROM rap_tickets WHERE category <> '' ORDER BY 1) AS categories,
         array(SELECT DISTINCT department FROM rap_tickets WHERE department <> '' ORDER BY 1) AS departments`),
  ]);
  res.json({ ...stats.rows[0], facets: facets.rows[0] });
}));

router.get('/submissions/:id', requirePerm(...VIEW_SUBMISSIONS), aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query(
    `SELECT ${TICKET_FIELDS},
         rt.history, rt.guest_notes, rt.rap_created_at, rt.first_seen_at, rt.last_seen_at,
         coalesce(q.payload->>'guest_email', '') AS guest_email,
         coalesce(q.payload->>'guest_phone', '') AS guest_phone,
         coalesce(q.payload->>'location_slug', '') AS location_slug,
         (q.updates_email IS NOT NULL AND q.updates_email <> '') AS updates_on,
         q.rating_comment, q.status AS delivery_status, q.sent_at, q.last_error AS delivery_error
      ${TICKET_FROM}
      WHERE rt.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const scope = await rapDeptScope(req.actor);
  if (scope !== null && !scope.includes(rows[0].department)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ submission: rows[0] });
}));

// ---------- metrics & insights ----------

router.get('/metrics', requirePerm('metrics.view_all', 'metrics.view_dept'), aw(async (req, res) => {
  res.json(await dashboardMetrics(req.query.days, {
    department: req.query.department ? clampStr(req.query.department, 120) : null,
  }));
}));

router.post('/insights', requirePerm('insights.run'), aw(async (req, res) => {
  const settings = await getSettings();
  if (!settings.features.aiInsights) return res.status(400).json({ error: 'AI insights are disabled in Settings.' });
  const { stats, recent } = await insightsInput();
  res.json(await generateInsights(stats, recent));
}));

router.get('/export.csv', requirePerm('export.csv'), aw(async (req, res) => {
  const settings = await getSettings();
  if (!settings.features.csvExport) return res.status(400).json({ error: 'CSV export is disabled in Settings.' });
  const { rows } = await pool.query(
    `SELECT rt.id AS rap_ticket, q.public_code,
            coalesce(q.created_at, rt.rap_created_at, rt.first_seen_at) AS created_at,
            rt.status, rt.department, rt.category, rt.severity, rt.mood,
            rt.building, q.location_name, rt.summary,
            coalesce(nullif(rt.text,''), q.payload->>'text', '') AS message,
            q.guest_name,
            coalesce(q.payload->>'guest_email', '') AS guest_email,
            coalesce(q.payload->>'guest_phone', '') AS guest_phone,
            q.updates_email,
            coalesce(q.payload->>'group_name', '') AS group_name,
            rt.observed_response_at,
            coalesce(rt.rap_resolved_at, rt.observed_resolved_at) AS resolved_at,
            q.rating, q.source,
            (q.id IS NOT NULL) AS from_woodsvoice
       FROM rap_tickets rt
       LEFT JOIN rap_queue q ON q.rap_ticket_id = rt.id
      ORDER BY created_at DESC`);
  const cols = Object.keys(rows[0] || { empty: '' });
  const esc = (v) => v == null ? '' : `"${String(v instanceof Date ? v.toISOString() : v).replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="woodsvoice-export-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
}));

// ---------- catalog management ----------

async function ensureUniqueSlug(table, base) {
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug]);
    if (!rows.length) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Lists stay readable by any signed-in user (the inbox filters and settings
// pages need them); mutations require catalogs.manage.
// DELETE deactivates unless the table opts into a real `remove`.
function catalogRoutes(table, { mapIn, orderBy, hasSlug, remove }) {
  const canEdit = requirePerm('catalogs.manage');
  router.get(`/${table}`, aw(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    res.json({ rows });
  }));
  router.post(`/${table}`, canEdit, aw(async (req, res) => {
    const data = mapIn(req.body);
    if (hasSlug) data.slug = await ensureUniqueSlug(table, slugify(data.name));
    const cols = Object.keys(data).filter(c => data[c] !== undefined);
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, n) => `$${n + 1}`).join(',')}) RETURNING *`,
      cols.map(c => data[c]));
    res.status(201).json({ row: rows[0] });
  }));
  router.patch(`/${table}/:id`, canEdit, aw(async (req, res) => {
    const data = mapIn(req.body, true);
    const cols = Object.keys(data).filter(c => data[c] !== undefined);
    if (!cols.length) return res.json({ ok: true });
    const sets = cols.map((c, n) => `${c} = $${n + 1}`);
    const params = cols.map(c => data[c]);
    params.push(parseInt(req.params.id, 10));
    const { rows } = await pool.query(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    res.json({ row: rows[0] });
  }));
  router.delete(`/${table}/:id`, canEdit, aw(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (remove) await remove(id);
    else await pool.query(`UPDATE ${table} SET active = false WHERE id = $1`, [id]);
    res.json({ ok: true });
  }));
}

const slugify = (s) => clampStr(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

catalogRoutes('categories', {
  orderBy: 'sort, name',
  hasSlug: true,
  mapIn: (b, partial) => ({
    name: b.name !== undefined ? clampStr(b.name, 80) || 'New category' : (partial ? undefined : 'New category'),
    emoji: b.emoji !== undefined ? clampStr(b.emoji, 8) : (partial ? undefined : '📝'),
    department_id: b.departmentId !== undefined ? (b.departmentId ? parseInt(b.departmentId, 10) : null) : undefined,
    active: typeof b.active === 'boolean' ? b.active : (partial ? undefined : true),
    sort: b.sort !== undefined ? parseInt(b.sort, 10) || 0 : (partial ? undefined : 99),
  }),
});

catalogRoutes('locations', {
  orderBy: 'area, sort, name',
  hasSlug: true,
  mapIn: (b, partial) => ({
    name: b.name !== undefined ? clampStr(b.name, 80) || 'New location' : (partial ? undefined : 'New location'),
    area: b.area !== undefined ? clampStr(b.area, 80) || 'General' : (partial ? undefined : 'General'),
    active: typeof b.active === 'boolean' ? b.active : (partial ? undefined : true),
    sort: b.sort !== undefined ? parseInt(b.sort, 10) || 0 : (partial ? undefined : 99),
  }),
  // Locations really delete (deactivate already covers "hide but keep").
  // History stays readable: rap_queue.location_name (stamped at capture) and
  // visits.loc_slug survive.
  remove: async (id) => {
    await pool.query('DELETE FROM locations WHERE id = $1', [id]);
  },
});

// Departments still exist locally for two jobs: department-scoped viewing
// (user_departments → RAP label matching) and the guest form's category →
// department hints. Their routing/hours/SLA columns are legacy — ticket
// routing happens on the RAP board.
catalogRoutes('departments', {
  orderBy: 'sort, name',
  mapIn: (b, partial) => ({
    name: b.name !== undefined ? clampStr(b.name, 80) : (partial ? undefined : 'New department'),
    email: b.email !== undefined ? clampStr(b.email, 200) : (partial ? undefined : ''),
    active: typeof b.active === 'boolean' ? b.active : (partial ? undefined : true),
    sort: b.sort !== undefined ? parseInt(b.sort, 10) || 0 : (partial ? undefined : 99),
  }),
});

module.exports = router;
