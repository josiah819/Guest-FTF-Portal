// Per-request permission loading. The JWT stays slim ({sub, username, name});
// the actor's role, permissions and department memberships are read from the
// DB on every request so matrix edits and deactivations apply immediately —
// no re-login, no stale tokens. A tiny process-local cache absorbs the admin
// UI's request bursts (single backend container, so busting it here is global).

const { pool } = require('./db');
const { aw } = require('./util');

const CACHE_MS = 5000;
const cache = new Map(); // userId -> { at, actor }

function bustActorCache() {
  cache.clear();
}

async function loadActor(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.actor;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.email, u.active, u.must_change_password,
            u.role_id, r.name AS role_name,
            coalesce(array_agg(rp.perm) FILTER (WHERE rp.perm IS NOT NULL), '{}') AS perms,
            coalesce((SELECT array_agg(department_id) FROM user_departments ud
                       WHERE ud.user_id = u.id), '{}') AS dept_ids
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.id = $1
      GROUP BY u.id, r.name`, [userId]);
  if (!rows.length || !rows[0].active) return null;
  const row = rows[0];
  const actor = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    roleId: row.role_id,
    roleName: row.role_name || 'No role',
    mustChangePassword: row.must_change_password,
    perms: new Set(row.perms),
    deptIds: row.dept_ids,
  };
  cache.set(userId, { at: Date.now(), actor });
  return actor;
}

// Mounted once, right after requireAuth. 401 (not 403) when the account is
// gone or deactivated so the client drops its token and shows the login form.
const attachActor = aw(async (req, res, next) => {
  const actor = await loadActor(req.admin.sub);
  if (!actor) return res.status(401).json({ error: 'This account is disabled or has been removed.' });
  req.actor = actor;
  next();
});

const requirePerm = (...keys) => (req, res, next) => {
  if (keys.some(k => req.actor.perms.has(k))) return next();
  res.status(403).json({ error: 'You don’t have permission to do that.' });
};

// Appends a department scope predicate for actors without the *_all variant.
// Rows with department_id NULL are visible only to view_all actors.
function deptFilter(actor, allKey, where, params, i, col = 's.department_id') {
  if (actor.perms.has(allKey)) return i;
  where.push(`${col} = ANY($${i})`);
  params.push(actor.deptIds);
  return i + 1;
}

// True when the actor may see this submission's department.
function inDeptScope(actor, allKey, departmentId) {
  if (actor.perms.has(allKey)) return true;
  return departmentId != null && actor.deptIds.includes(departmentId);
}

module.exports = { attachActor, requirePerm, deptFilter, inDeptScope, bustActorCache, loadActor };
