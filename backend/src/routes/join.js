// Invite acceptance — the only unauthenticated account-creation surface.
// Everything is keyed by the emailed token (stored hashed); an invite can be
// finished either with Google (email must match the invited address) or by
// choosing a username + password. Success returns a signed session token so
// the new user lands in the admin straight away.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, getSettings } = require('../db');
const { aw, clampStr, rateLimit } = require('../util');
const { signToken } = require('../auth');
const { bustActorCache } = require('../rbac');
const { googleEnabled, verifyGoogleCredential, GOOGLE_CLIENT_ID } = require('../google');

const router = express.Router();

const limiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, message: 'Too many attempts — give it a few minutes.' });
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function loadInvite(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await pool.query(
    `SELECT i.*, r.name AS role_name FROM invites i JOIN roles r ON r.id = i.role_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)]);
  return rows[0] || null;
}

// The user row an accepted invite turns into, plus session token.
async function createInvitedUser(invite, { username, displayName, passwordHash = null, googleSub = null }) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (username, display_name, email, password_hash, google_sub, role_id, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,false)
     RETURNING *`,
    [username, displayName, invite.email, passwordHash, googleSub, invite.role_id]);
  for (const deptId of invite.department_ids || []) {
    await pool.query(
      `INSERT INTO user_departments (user_id, department_id)
       SELECT $1, id FROM departments WHERE id = $2 ON CONFLICT DO NOTHING`,
      [user.id, deptId]);
  }
  await pool.query(
    'UPDATE invites SET accepted_at = now(), accepted_user_id = $1 WHERE id = $2',
    [user.id, invite.id]);
  bustActorCache();
  return { token: signToken(user), name: user.display_name, username: user.username, mustChangePassword: false };
}

async function freeUsername(base) {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff').slice(0, 60).padEnd(3, '0');
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? stem : `${stem}${n + 1}`;
    const { rows } = await pool.query('SELECT 1 FROM users WHERE lower(username) = $1', [candidate]);
    if (!rows.length) return candidate;
  }
  return `${stem}${crypto.randomBytes(3).toString('hex')}`;
}

router.get('/:token', limiter, aw(async (req, res) => {
  const invite = await loadInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invite link is no longer valid — ask your admin to send a fresh one.' });
  const settings = await getSettings();
  res.json({
    email: invite.email,
    roleName: invite.role_name,
    appName: settings.general.appName,
    orgName: settings.general.orgName,
    googleClientId: googleEnabled() ? GOOGLE_CLIENT_ID : '',
  });
}));

router.post('/:token/accept', limiter, aw(async (req, res) => {
  const invite = await loadInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invite link is no longer valid — ask your admin to send a fresh one.' });

  const username = clampStr(req.body.username, 100).toLowerCase().replace(/\s+/g, '');
  const displayName = clampStr(req.body.displayName, 120) || username;
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (username.length < 3) return res.status(400).json({ error: 'Username needs at least 3 characters.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const { rows: clash } = await pool.query('SELECT 1 FROM users WHERE lower(username) = $1', [username]);
  if (clash.length) return res.status(400).json({ error: 'That username is taken — pick another.' });

  res.status(201).json(await createInvitedUser(invite, {
    username, displayName, passwordHash: bcrypt.hashSync(password, 10),
  }));
}));

router.post('/:token/google', limiter, aw(async (req, res) => {
  const invite = await loadInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invite link is no longer valid — ask your admin to send a fresh one.' });

  let g;
  try {
    g = await verifyGoogleCredential(req.body.credential);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
  if (g.email !== invite.email.toLowerCase()) {
    return res.status(400).json({
      error: `This invite is for ${invite.email} but you signed in as ${g.email} — use that Google account, or set a password instead.`,
    });
  }

  const username = await freeUsername(g.email.split('@')[0]);
  res.status(201).json(await createInvitedUser(invite, {
    username, displayName: g.name || username, googleSub: g.sub,
  }));
}));

module.exports = router;
