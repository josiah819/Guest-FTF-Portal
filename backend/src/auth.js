const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { aw, clampStr } = require('./util');

const JWT_SECRET = process.env.JWT_SECRET || 'woodsvoice-dev-secret-change-me';
if (JWT_SECRET === 'woodsvoice-dev-secret-change-me') {
  console.warn('[auth] JWT_SECRET not set — using insecure dev default');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, name: user.display_name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

const login = aw(async (req, res) => {
  const username = clampStr(req.body.username, 100);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  if (!rows.length || !bcrypt.compareSync(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  if (!rows[0].active) {
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }
  res.json({
    token: signToken(rows[0]),
    name: rows[0].display_name,
    username: rows[0].username,
    mustChangePassword: rows[0].must_change_password,
  });
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please sign in again.' });
  }
}

const changePassword = aw(async (req, res) => {
  const current = typeof req.body.current === 'string' ? req.body.current : '';
  const next = typeof req.body.next === 'string' ? req.body.next : '';
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.admin.sub]);
  if (!rows.length || !bcrypt.compareSync(current, rows[0].password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
    [bcrypt.hashSync(next, 10), req.admin.sub]);
  res.json({ ok: true });
});

module.exports = { login, requireAuth, changePassword };
