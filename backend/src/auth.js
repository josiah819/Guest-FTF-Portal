const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { aw, clampStr } = require('./util');
const { verifyGoogleCredential } = require('./google');

const JWT_SECRET = process.env.JWT_SECRET || 'woodsvoice-dev-secret-change-me';
if (JWT_SECRET === 'woodsvoice-dev-secret-change-me') {
  console.warn('[auth] JWT_SECRET not set — using insecure dev default');
}

// Staff stay signed in on a device until they sign out: tokens are long-lived
// and every authenticated request renews one that is more than a day old (see
// requireAuth), so only a device untouched for a full year ever expires.
// Deactivation still bites immediately — rbac reloads the user on each request.
const TOKEN_TTL = '365d';
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const RENEWED_TOKEN_HEADER = 'X-Woodsvoice-Token';

function signClaims(claims) {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function signToken(user) {
  return signClaims({ sub: user.id, username: user.username, name: user.display_name });
}

function loginPayload(user) {
  return {
    token: signToken(user),
    name: user.display_name,
    username: user.username,
    mustChangePassword: user.must_change_password,
  };
}

const login = aw(async (req, res) => {
  const handle = clampStr(req.body.username, 200);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  // Exact username first so someone's username can never be shadowed by
  // someone else's email; email is the fallback for invited accounts.
  let { rows } = await pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [handle]);
  if (!rows.length) {
    ({ rows } = await pool.query(
      `SELECT * FROM users WHERE email <> '' AND lower(email) = lower($1)`, [handle]));
  }
  if (rows.length === 1 && !rows[0].password_hash) {
    // Google-only account; a wrong-password error would send them in circles.
    return res.status(401).json({ error: 'That account signs in with Google — use the Google button below.' });
  }
  if (rows.length !== 1 || !bcrypt.compareSync(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  if (!rows[0].active) {
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }
  res.json(loginPayload(rows[0]));
});

// Google sign-in for existing accounts. Matched by google_sub first (stable),
// then by verified email — which links google_sub for next time.
const loginGoogle = aw(async (req, res) => {
  let g;
  try {
    g = await verifyGoogleCredential(req.body.credential);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
  let { rows } = await pool.query('SELECT * FROM users WHERE google_sub = $1', [g.sub]);
  if (!rows.length) {
    ({ rows } = await pool.query(
      `SELECT * FROM users WHERE email <> '' AND lower(email) = lower($1)`, [g.email]));
    if (rows.length === 1 && !rows[0].google_sub) {
      await pool.query('UPDATE users SET google_sub = $1 WHERE id = $2', [g.sub, rows[0].id]);
    }
  }
  if (rows.length !== 1) {
    return res.status(401).json({ error: 'No WoodsVoice account matches that Google address — ask an admin to invite you.' });
  }
  if (!rows[0].active) {
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }
  res.json(loginPayload(rows[0]));
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    if (Date.now() - req.admin.iat * 1000 > RENEW_AFTER_MS) {
      const { sub, username, name } = req.admin;
      res.set(RENEWED_TOKEN_HEADER, signClaims({ sub, username, name }));
    }
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
  // Google-only accounts have no current password — setting one just adds it.
  const currentOk = rows.length &&
    (!rows[0].password_hash || bcrypt.compareSync(current, rows[0].password_hash));
  if (!currentOk) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
    [bcrypt.hashSync(next, 10), req.admin.sub]);
  res.json({ ok: true });
});

module.exports = { login, loginGoogle, requireAuth, changePassword, signToken, RENEWED_TOKEN_HEADER };
