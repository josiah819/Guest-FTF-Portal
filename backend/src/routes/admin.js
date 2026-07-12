const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool, getSettings, saveSettings } = require('../db');
const { aw, clampStr, newFileName } = require('../util');
const { requireAuth, login, changePassword } = require('../auth');
const { attachActor, requirePerm, deptFilter, inDeptScope } = require('../rbac');
const { dashboardMetrics, insightsInput } = require('../metrics');
const { generateInsights, aiEnabled } = require('../classify');

const router = express.Router();

router.post('/login', login);
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
  res.json({ settings: await getSettings(), aiKeyPresent: aiEnabled() });
}));

router.put('/settings', aw(async (req, res) => {
  const allowed = ['general', 'fields', 'features', 'sla', 'integrations', 'accountability', 'content', 'ai'];
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

// ---------- submissions ----------

const VIEW_SUBMISSIONS = ['submissions.view_all', 'submissions.view_dept'];

router.get('/submissions', requirePerm(...VIEW_SUBMISSIONS), aw(async (req, res) => {
  const where = [];
  const params = [];
  let i = 1;
  const { status, category, location, type, urgency, q } = req.query;
  if (status && status !== 'all') {
    if (status === 'open') where.push(`s.status IN ('new','in_progress')`);
    else { where.push(`s.status = $${i++}`); params.push(clampStr(status, 30)); }
  }
  if (category) { where.push(`c.slug = $${i++}`); params.push(clampStr(category, 60)); }
  if (location) { where.push(`l.slug = $${i++}`); params.push(clampStr(location, 60)); }
  if (type)     { where.push(`s.type = $${i++}`); params.push(clampStr(type, 30)); }
  if (urgency)  { where.push(`s.urgency = $${i++}`); params.push(clampStr(urgency, 30)); }
  if (req.query.department) {
    where.push(`s.department_id = $${i++}`); params.push(parseInt(req.query.department, 10) || 0);
  }
  if (q) {
    where.push(`(s.message ILIKE $${i} OR s.public_code ILIKE $${i} OR s.guest_name ILIKE $${i} OR s.group_name ILIKE $${i})`);
    params.push(`%${clampStr(q, 100)}%`); i++;
  }
  i = deptFilter(req.actor, 'submissions.view_all', where, params, i);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 25;
  params.push(pageSize, (page - 1) * pageSize);

  const sql = `
    SELECT s.id, s.public_code, s.type, s.status, s.urgency, s.message, s.ai_summary,
           s.guest_name, s.group_name, s.photo_path, s.rating, s.source,
           s.created_at, s.first_response_at, s.resolved_at,
           c.name AS category, c.emoji AS category_emoji, c.slug AS category_slug,
           d.name AS department, l.name AS location, s.location_text,
           count(*) OVER()::int AS total_rows
      FROM submissions s
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN departments d ON d.id = s.department_id
      LEFT JOIN locations l ON l.id = s.location_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (s.urgency = 'safety' AND s.status IN ('new','in_progress')) DESC, s.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`;
  const { rows } = await pool.query(sql, params);
  res.json({ rows, total: rows[0]?.total_rows || 0, page, pageSize });
}));

router.get('/submissions/:id', requirePerm(...VIEW_SUBMISSIONS), aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS category, c.emoji AS category_emoji, d.name AS department, l.name AS location
       FROM submissions s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN departments d ON d.id = s.department_id
       LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.id = $1`, [id]);
  if (!rows.length || !inDeptScope(req.actor, 'submissions.view_all', rows[0].department_id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const { rows: events } = await pool.query(
    `SELECT e.*, u.display_name AS admin_name FROM submission_events e
      LEFT JOIN users u ON u.id = e.user_id
     WHERE e.submission_id = $1 ORDER BY e.created_at`, [id]);
  res.json({ submission: rows[0], events });
}));

const STATUSES = ['new', 'in_progress', 'resolved', 'closed'];
const STATUS_LABEL = { new: 'New', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

router.patch('/submissions/:id', requirePerm(...VIEW_SUBMISSIONS), aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows: existing } = await pool.query('SELECT * FROM submissions WHERE id = $1', [id]);
  if (!existing.length || !inDeptScope(req.actor, 'submissions.view_all', existing[0].department_id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const sub = existing[0];

  // Which permissions does this particular patch need?
  const wantsStatus = req.body.status && STATUSES.includes(req.body.status) && req.body.status !== sub.status;
  const needed = new Set();
  if (wantsStatus) {
    const touchesClosed = ['resolved', 'closed'].includes(req.body.status) ||
                          ['resolved', 'closed'].includes(sub.status);
    needed.add(touchesClosed ? 'submissions.close' : 'submissions.respond');
  }
  if (req.body.departmentId !== undefined || req.body.categoryId !== undefined ||
      req.body.urgency !== undefined || req.body.assignedUserId !== undefined) {
    needed.add('submissions.assign');
  }
  for (const k of needed) {
    if (!req.actor.perms.has(k)) {
      return res.status(403).json({ error: 'You don’t have permission to do that.' });
    }
  }

  const sets = [];
  const params = [];
  let i = 1;
  const log = [];

  if (wantsStatus) {
    sets.push(`status = $${i++}`); params.push(req.body.status);
    if (!sub.first_response_at && req.body.status !== 'new') {
      sets.push(`first_response_at = now()`);
    }
    if (['resolved', 'closed'].includes(req.body.status) && !sub.resolved_at) {
      sets.push(`resolved_at = now()`);
    }
    if (req.body.status === 'new') { sets.push('resolved_at = NULL'); }
    log.push({ kind: 'status', detail: `Status changed to ${STATUS_LABEL[req.body.status]}`, isPublic: true });
  }
  if (req.body.departmentId !== undefined) {
    const deptId = req.body.departmentId ? parseInt(req.body.departmentId, 10) : null;
    sets.push(`department_id = $${i++}`); params.push(deptId);
    if (deptId) {
      const { rows: d } = await pool.query('SELECT name FROM departments WHERE id = $1', [deptId]);
      log.push({ kind: 'assign', detail: `Assigned to ${d[0]?.name || 'department'}`, isPublic: false });
    } else {
      log.push({ kind: 'assign', detail: 'Unassigned', isPublic: false });
    }
  }
  if (req.body.categoryId !== undefined) {
    const catId = req.body.categoryId ? parseInt(req.body.categoryId, 10) : null;
    sets.push(`category_id = $${i++}`); params.push(catId);
    if (catId) {
      const { rows: c } = await pool.query('SELECT name FROM categories WHERE id = $1', [catId]);
      log.push({ kind: 'assign', detail: `Recategorized as ${c[0]?.name || 'category'}`, isPublic: false });
    }
  }
  if (req.body.urgency && ['low', 'normal', 'high', 'safety'].includes(req.body.urgency)) {
    sets.push(`urgency = $${i++}`); params.push(req.body.urgency);
    log.push({ kind: 'assign', detail: `Urgency set to ${req.body.urgency}`, isPublic: false });
  }

  if (sets.length) {
    params.push(id);
    await pool.query(`UPDATE submissions SET ${sets.join(', ')} WHERE id = $${i}`, params);
    for (const entry of log) {
      await pool.query(
        `INSERT INTO submission_events (submission_id, kind, detail, is_public, user_id)
         VALUES ($1,$2,$3,$4,$5)`, [id, entry.kind, entry.detail, entry.isPublic, req.actor.id]);
    }
    // First staff touch of any kind counts as first response.
    await pool.query(
      `UPDATE submissions SET first_response_at = now() WHERE id = $1 AND first_response_at IS NULL`, [id]);
  }
  res.json({ ok: true });
}));

router.post('/submissions/:id/notes', requirePerm('submissions.respond'), aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT department_id FROM submissions WHERE id = $1', [id]);
  if (!rows.length || !inDeptScope(req.actor, 'submissions.view_all', rows[0].department_id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const note = clampStr(req.body.note, 2000);
  if (!note) return res.status(400).json({ error: 'Note is empty.' });
  await pool.query(
    `INSERT INTO submission_events (submission_id, kind, detail, is_public, user_id)
     VALUES ($1,'note',$2,false,$3)`, [id, note, req.actor.id]);
  await pool.query(
    `UPDATE submissions SET first_response_at = now() WHERE id = $1 AND first_response_at IS NULL`, [id]);
  res.json({ ok: true });
}));

// ---------- metrics & insights ----------

router.get('/metrics', requirePerm('metrics.view_all', 'metrics.view_dept'), aw(async (req, res) => {
  res.json(await dashboardMetrics(req.query.days));
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
    `SELECT s.public_code, s.created_at, s.type, s.status, s.urgency,
            c.name AS category, d.name AS department,
            coalesce(l.name, s.location_text) AS location,
            s.message, s.ai_summary, s.guest_name, s.guest_email, s.guest_phone, s.group_name,
            s.first_response_at, s.resolved_at, s.rating, s.source
       FROM submissions s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN departments d ON d.id = s.department_id
       LEFT JOIN locations l ON l.id = s.location_id
      ORDER BY s.created_at DESC`);
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
function catalogRoutes(table, { mapIn, orderBy, hasSlug }) {
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
    await pool.query(`UPDATE ${table} SET active = false WHERE id = $1`, [parseInt(req.params.id, 10)]);
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
});

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
