// Team management: users and the role/permission matrix. Everything here is
// gated by users.manage. Mounted under /api/admin by routes/admin.js, after
// requireAuth + attachActor.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { aw, clampStr } = require('../util');
const { requirePerm, bustActorCache } = require('../rbac');
const { PERMISSIONS, PERMISSION_KEYS } = require('../permissions');

const router = express.Router();
// This router is mounted at the admin router's root, so a router.use() gate
// here would intercept every /api/admin/* request — gate per route instead.
const gate = requirePerm('users.manage');

// Readable one-time passwords: no ambiguous characters, 12 chars.
function tempPassword() {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Active users who hold users.manage, optionally pretending a user or role
// isn't there — the "would this change lock everyone out?" check.
async function otherKeyHolders({ excludeUserId = null, excludeRoleId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id AND rp.perm = 'users.manage'
      WHERE u.active
        AND ($1::int IS NULL OR u.id <> $1)
        AND ($2::int IS NULL OR u.role_id <> $2)`,
    [excludeUserId, excludeRoleId]);
  return rows[0].n;
}

async function roleHasUsersManage(roleId) {
  if (!roleId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM role_permissions WHERE role_id = $1 AND perm = 'users.manage'`, [roleId]);
  return rows.length > 0;
}

// ---------- permission catalog ----------

router.get('/permissions', gate, (req, res) => {
  res.json({ permissions: PERMISSIONS });
});

// ---------- users ----------

router.get('/users', gate, aw(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.email, u.role_id, r.name AS role_name,
            u.active, u.must_change_password, u.created_at,
            coalesce((SELECT array_agg(department_id ORDER BY department_id)
                        FROM user_departments ud WHERE ud.user_id = u.id), '{}') AS department_ids
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      ORDER BY u.active DESC, lower(u.username)`);
  res.json({ rows });
}));

async function setUserDepartments(userId, departmentIds) {
  await pool.query('DELETE FROM user_departments WHERE user_id = $1', [userId]);
  const ids = [...new Set((departmentIds || []).map(d => parseInt(d, 10)).filter(Number.isInteger))];
  for (const deptId of ids) {
    await pool.query(
      `INSERT INTO user_departments (user_id, department_id)
       SELECT $1, id FROM departments WHERE id = $2
       ON CONFLICT DO NOTHING`, [userId, deptId]);
  }
}

router.post('/users', gate, aw(async (req, res) => {
  const username = clampStr(req.body.username, 100).toLowerCase().replace(/\s+/g, '');
  const displayName = clampStr(req.body.displayName, 120) || username;
  const email = clampStr(req.body.email, 200);
  const roleId = req.body.roleId ? parseInt(req.body.roleId, 10) : null;
  if (username.length < 3) return res.status(400).json({ error: 'Username needs at least 3 characters.' });
  if (!roleId) return res.status(400).json({ error: 'Pick a role for the new user.' });
  const { rows: role } = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId]);
  if (!role.length) return res.status(400).json({ error: 'That role doesn’t exist.' });
  const { rows: clash } = await pool.query('SELECT 1 FROM users WHERE lower(username) = $1', [username]);
  if (clash.length) return res.status(400).json({ error: 'That username is taken.' });

  const password = tempPassword();
  const { rows } = await pool.query(
    `INSERT INTO users (username, display_name, email, password_hash, role_id, must_change_password)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING id, username, display_name, email, role_id, active, must_change_password, created_at`,
    [username, displayName, email, bcrypt.hashSync(password, 10), roleId]);
  await setUserDepartments(rows[0].id, req.body.departmentIds);
  bustActorCache();
  res.status(201).json({ user: rows[0], tempPassword: password });
}));

router.patch('/users/:id', gate, aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows: existing } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing.length) return res.status(404).json({ error: 'Not found' });
  const user = existing[0];

  const nextActive = typeof req.body.active === 'boolean' ? req.body.active : user.active;
  const nextRoleId = req.body.roleId !== undefined
    ? (req.body.roleId ? parseInt(req.body.roleId, 10) : null)
    : user.role_id;

  // Lockout guard: don't let the last users.manage holder demote or disable themselves out.
  const isHolder = user.active && await roleHasUsersManage(user.role_id);
  const staysHolder = nextActive && await roleHasUsersManage(nextRoleId);
  if (isHolder && !staysHolder && (await otherKeyHolders({ excludeUserId: id })) === 0) {
    return res.status(400).json({ error: 'That would leave nobody who can manage the team. Give another user “Manage team & roles” first.' });
  }

  const sets = [];
  const params = [];
  let i = 1;
  if (req.body.displayName !== undefined) { sets.push(`display_name = $${i++}`); params.push(clampStr(req.body.displayName, 120) || user.username); }
  if (req.body.email !== undefined) { sets.push(`email = $${i++}`); params.push(clampStr(req.body.email, 200)); }
  if (req.body.roleId !== undefined) { sets.push(`role_id = $${i++}`); params.push(nextRoleId); }
  if (typeof req.body.active === 'boolean') { sets.push(`active = $${i++}`); params.push(nextActive); }
  if (sets.length) {
    params.push(id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, params);
  }
  if (req.body.departmentIds !== undefined) await setUserDepartments(id, req.body.departmentIds);
  bustActorCache();
  res.json({ ok: true });
}));

router.post('/users/:id/reset-password', gate, aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const password = tempPassword();
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2 RETURNING id`,
    [bcrypt.hashSync(password, 10), id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ tempPassword: password });
}));

// ---------- roles ----------

router.get('/roles', gate, aw(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.is_system,
            coalesce(array_agg(rp.perm) FILTER (WHERE rp.perm IS NOT NULL), '{}') AS perms,
            (SELECT count(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.id`);
  res.json({ rows });
}));

router.post('/roles', gate, aw(async (req, res) => {
  const name = clampStr(req.body.name, 60);
  if (!name) return res.status(400).json({ error: 'Role needs a name.' });
  const { rows: clash } = await pool.query('SELECT 1 FROM roles WHERE lower(name) = lower($1)', [name]);
  if (clash.length) return res.status(400).json({ error: 'A role with that name already exists.' });
  const { rows } = await pool.query(
    'INSERT INTO roles (name) VALUES ($1) RETURNING id, name, is_system', [name]);
  res.status(201).json({ row: { ...rows[0], perms: [], user_count: 0 } });
}));

router.patch('/roles/:id', gate, aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = clampStr(req.body.name, 60);
  if (!name) return res.status(400).json({ error: 'Role needs a name.' });
  const { rows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  if (rows[0].is_system) return res.status(400).json({ error: 'The Administrator role can’t be renamed.' });
  await pool.query('UPDATE roles SET name = $1 WHERE id = $2', [name, id]);
  bustActorCache();
  res.json({ ok: true });
}));

router.put('/roles/:id/permissions', gate, aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  if (rows[0].is_system) return res.status(400).json({ error: 'The Administrator role always has every permission.' });

  const perms = Array.isArray(req.body.perms)
    ? [...new Set(req.body.perms.filter(p => PERMISSION_KEYS.includes(p)))]
    : [];

  // Lockout guard: removing users.manage from this role must leave a holder elsewhere.
  const hadKey = await roleHasUsersManage(id);
  if (hadKey && !perms.includes('users.manage') && (await otherKeyHolders({ excludeRoleId: id })) === 0) {
    return res.status(400).json({ error: 'That would leave nobody who can manage the team. Give another active user “Manage team & roles” first.' });
  }

  await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
  for (const p of perms) {
    await pool.query('INSERT INTO role_permissions (role_id, perm) VALUES ($1,$2)', [id, p]);
  }
  bustActorCache();
  res.json({ ok: true, perms });
}));

router.delete('/roles/:id', gate, aw(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query(
    `SELECT r.is_system, (SELECT count(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r WHERE r.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  if (rows[0].is_system) return res.status(400).json({ error: 'The Administrator role can’t be deleted.' });
  if (rows[0].user_count > 0) return res.status(400).json({ error: 'Reassign that role’s users first.' });
  await pool.query('DELETE FROM roles WHERE id = $1', [id]);
  bustActorCache();
  res.json({ ok: true });
}));

module.exports = router;
