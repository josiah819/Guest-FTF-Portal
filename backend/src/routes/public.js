const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { pool, getSettings } = require('../db');
const { aw, clampStr, newPublicCode, newFileName, rateLimit, publicOrigin } = require('../util');
const { enqueueRap } = require('../rap');
const { emailUpdatesEnabled, sendGuestEmail, guestStatusLabel } = require('../guestUpdates');

const router = express.Router();

// Tickets live on the central RAP board — capture here writes ONE rap_queue
// row (payload + guest extras) and the sender delivers it to RAP's intake.
// The tracking endpoints join that capture row to the synced board copy
// (rap_tickets), so a guest sees RAP's status without RAP ever being hit by
// guest page views.

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, newFileName(path.extname(file.originalname) || '.jpg')),
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Everything the guest form needs to render itself, shaped by admin settings.
router.get('/config', aw(async (req, res) => {
  const settings = await getSettings();
  const { rows: categories } = await pool.query(
    'SELECT id, slug, name, emoji FROM categories WHERE active ORDER BY sort, name');
  const { rows: locations } = await pool.query(
    'SELECT id, slug, name, area FROM locations WHERE active ORDER BY sort, name');
  res.json({
    general: settings.general,
    fields: settings.fields,
    content: settings.content,
    features: {
      submissionTypes: settings.features.submissionTypes,
      photoUpload: settings.features.photoUpload && settings.fields.photo !== 'off',
      urgency: settings.features.urgency && settings.fields.urgency !== 'off',
      tracking: settings.features.tracking,
      csat: settings.features.csat,
      emailUpdates: emailUpdatesEnabled(settings),
      kioskMode: settings.features.kioskMode,
      // The board's AI triages every note, so the "skip it — we'll sort it for
      // you" hint is always truthful.
      aiCategorization: true,
    },
    categories,
    locations,
  });
}));

// Visit beacon: the guest form fires this once per device per half hour
// (sessionStorage-gated client side) so the dashboard can answer "how many
// people open the form, from which cabin, and are the QR cards being
// scanned?". Always 204 — a guest must never see this fail.
router.post('/visit', rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Slow down a little.' }), aw(async (req, res) => {
  const settings = await getSettings();
  if (settings.features.visitTracking === false) return res.status(204).end();
  const ua = String(req.headers['user-agent'] || '');
  if (/bot|crawl|spider|preview|headless|lighthouse/i.test(ua)) return res.status(204).end();

  const b = req.body || {};
  const locSlug = clampStr(b.loc, 120).toLowerCase();
  const source = b.source === 'kiosk' ? 'kiosk' : (b.source === 'qr' ? 'qr' : 'web');
  let locationId = null;
  if (locSlug) {
    const { rows } = await pool.query('SELECT id FROM locations WHERE slug = $1', [locSlug]);
    locationId = rows[0]?.id || null;
  }
  // Per-day device fingerprint — distinct-counts as "unique visitors" without
  // storing anything identifying, and rotates daily by construction.
  const day = new Date().toISOString().slice(0, 10);
  const visitorKey = crypto.createHash('sha256').update(`${req.ip}|${ua}|${day}`).digest('hex').slice(0, 16);
  await pool.query(
    'INSERT INTO visits (location_id, loc_slug, source, visitor_key) VALUES ($1,$2,$3,$4)',
    [locationId, locSlug, source, visitorKey]);
  res.status(204).end();
}));

router.post('/submissions', rateLimit({ windowMs: 5 * 60 * 1000, max: 12 }), upload.single('photo'), aw(async (req, res) => {
  const settings = await getSettings();
  const b = req.body || {};

  const message = clampStr(b.message, 4000);
  if (message.length < 3) return res.status(400).json({ error: 'Please tell us a little more in the message.' });

  const fields = settings.fields;
  const required = (key, value, label) => {
    if (fields[key] === 'required' && !value) throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  };

  const guestName = fields.name === 'off' ? '' : clampStr(b.name, 120);
  const guestEmail = fields.email === 'off' ? '' : clampStr(b.email, 200);
  const guestPhone = fields.phone === 'off' ? '' : clampStr(b.phone, 50);
  const groupName = fields.group === 'off' ? '' : clampStr(b.group, 160);
  const locationSlug = clampStr(b.location, 120);

  try {
    required('name', guestName, 'Your name');
    required('email', guestEmail, 'Email');
    required('phone', guestPhone, 'Phone');
    required('group', groupName, 'Group / school name');
    required('location', locationSlug, 'Location');
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    throw e;
  }

  const types = ['issue', 'request', 'feedback', 'compliment'];
  const guestChoseType = settings.features.submissionTypes && types.includes(b.type);

  let location = null;
  if (locationSlug) {
    const { rows } = await pool.query('SELECT id, name FROM locations WHERE slug = $1 AND active', [locationSlug]);
    location = rows[0] || null;
  }

  // Guest may pick a category; RAP's triage sorts untagged notes itself.
  const categorySlug = clampStr(b.category, 120);
  let category = null;
  if (categorySlug) {
    const { rows } = await pool.query('SELECT slug FROM categories WHERE slug = $1 AND active', [categorySlug]);
    category = rows[0] || null;
  }

  const urgencies = ['low', 'normal', 'high', 'safety'];
  const guestChoseUrgency = settings.features.urgency && fields.urgency !== 'off' && urgencies.includes(b.urgency);

  const source = b.source === 'kiosk' ? 'kiosk' : (b.source === 'web' ? 'web' : 'qr');
  const photoPath = (settings.features.photoUpload && fields.photo !== 'off' && req.file)
    ? `/uploads/${req.file.filename}` : '';

  // The capture IS the queue row — everything the guest gave us travels to RAP
  // (which owns the ticket from here on); the row keeps only what the guest
  // experience needs back: our code, the photo file, and later the email
  // opt-in and rating.
  const code = newPublicCode();
  const origin = publicOrigin(req);
  await enqueueRap({
    text: message, submittedAt: new Date(),
    code, location: location?.name || '', channel: source, photoPath,
    guestName, guestEmail, guestPhone, groupName, locationSlug,
    guestType: guestChoseType ? b.type : '',
    guestUrgency: guestChoseUrgency ? b.urgency : '',
    guestCategory: category ? categorySlug : '',
    photoUrl: origin && photoPath ? `${origin}${photoPath}` : '',
    trackingUrl: origin && settings.features.tracking ? `${origin}/t/${code}` : '',
  });

  res.status(201).json({
    code,
    tracking: settings.features.tracking,
    successTitle: settings.general.successTitle,
    successMessage: settings.general.successMessage,
  });
}));

// A submission whose ticket was deleted on the RAP board answers 410 on every
// tracking endpoint: the capture row still exists (it's the ledger), but the
// guest must see a clean "no longer available" instead of a frozen "received".
// Old emails and the device list land here too, so the page — not the API
// caller — decides what to show; the device list drops the code on 404/410.
const GONE = { error: 'This submission is no longer available.', gone: true };

router.get('/track/:code', aw(async (req, res) => {
  const settings = await getSettings();
  // 403, not 404 — the device list prunes codes on 404, and a temporarily
  // disabled feature must not erase guests' saved submissions.
  if (!settings.features.tracking) return res.status(403).json({ error: 'Tracking is not enabled.' });
  const code = clampStr(req.params.code, 20).toUpperCase();
  const { rows } = await pool.query(
    `SELECT q.public_code, q.created_at, q.rating, q.location_name AS location,
            q.status AS delivery_status, q.rap_ticket_id, q.rap_deleted_at,
            (q.updates_email <> '') AS updates_on,
            LEFT(q.payload->>'text', 200) AS message,
            coalesce(q.payload->>'guest_type', '') AS type,
            t.status AS rap_status, t.category AS rap_category, t.guest_notes,
            t.observed_response_at, t.observed_resolved_at, t.rap_resolved_at,
            coalesce(t.rap_resolved_at, t.observed_resolved_at) AS resolved_at
       FROM rap_queue q
       LEFT JOIN rap_tickets t ON t.id = q.rap_ticket_id
      WHERE q.public_code = $1`, [code]);
  if (!rows.length) return res.status(404).json({ error: 'We couldn’t find that submission.' });
  const r = rows[0];
  if (r.rap_deleted_at) return res.status(410).json({ ...GONE, public_code: r.public_code });

  // Guest-facing status: RAP's own value; a note not yet on the board reads
  // as open ("Received" by default) too.
  const status = r.rap_status || 'open';

  // The public timeline, synthesized from capture + board state — RAP's
  // internal history (staff notes, routing debates) is never shown to guests.
  const events = [{ kind: 'created', detail: 'Submission received', created_at: r.created_at }];
  if (r.rap_status && (r.observed_response_at || r.rap_status !== 'open')) {
    events.push({
      kind: 'status',
      detail: `Status changed to ${guestStatusLabel(settings, 'in_progress')}`,
      created_at: r.observed_response_at || r.created_at,
    });
  }
  if (r.rap_status === 'resolved') {
    events.push({
      kind: 'status',
      detail: `Status changed to ${guestStatusLabel(settings, r.rap_status)}`,
      created_at: r.rap_resolved_at || r.observed_resolved_at || r.created_at,
    });
  }

  res.json({
    public_code: r.public_code,
    type: r.type,
    status,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    rating: r.rating,
    message: r.message,
    updates_on: r.updates_on,
    category: r.rap_category || '',
    location: r.location,
    events,
    // One-way messages RAP staff wrote for the guest, oldest first. Display
    // only — there is deliberately no reply endpoint.
    notes: r.guest_notes || [],
    csat: settings.features.csat,
    emailUpdates: emailUpdatesEnabled(settings),
  });
}));

// Email updates opt-in. The public code is the capability, same trust model as
// rating: whoever holds the code may point updates at their inbox. Only the
// on/off flag is ever readable back — never the address itself.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/track/:code/updates', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), aw(async (req, res) => {
  const settings = await getSettings();
  if (!emailUpdatesEnabled(settings)) return res.status(403).json({ error: 'Email updates aren’t available right now.' });
  const code = clampStr(req.params.code, 20).toUpperCase();
  const email = clampStr(req.body.email, 200);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email doesn’t look right — mind checking it?' });

  const { rows } = await pool.query(
    `UPDATE rap_queue q SET updates_email = $1
      WHERE q.public_code = $2 AND q.rap_deleted_at IS NULL
      RETURNING (SELECT t.status FROM rap_tickets t WHERE t.id = q.rap_ticket_id) AS rap_status`,
    [email, code]);
  if (!rows.length) {
    const { rows: q } = await pool.query('SELECT rap_deleted_at FROM rap_queue WHERE public_code = $1', [code]);
    if (q.length) return res.status(410).json(GONE);
    return res.status(404).json({ error: 'We couldn’t find that submission.' });
  }
  await sendGuestEmail('signup', code, rows[0].rap_status || 'open', req);
  res.json({ ok: true });
}));

// Stopping updates works regardless of the feature toggle — a guest must
// always be able to opt out.
router.delete('/track/:code/updates', aw(async (req, res) => {
  const code = clampStr(req.params.code, 20).toUpperCase();
  await pool.query(
    `UPDATE rap_queue SET updates_email = '' WHERE public_code = $1 AND updates_email <> ''`, [code]);
  res.json({ ok: true });
}));

router.post('/track/:code/rating', aw(async (req, res) => {
  const settings = await getSettings();
  if (!settings.features.csat) return res.status(404).json({ error: 'Ratings are not enabled.' });
  const code = clampStr(req.params.code, 20).toUpperCase();
  const stars = parseInt(req.body.stars, 10);
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Rating must be 1–5 stars.' });
  const comment = clampStr(req.body.comment, 1000);

  // Ratings open once RAP's board has the ticket resolved.
  const { rows } = await pool.query(
    `UPDATE rap_queue q SET rating = $1, rating_comment = $2
       FROM rap_tickets t
      WHERE q.public_code = $3 AND t.id = q.rap_ticket_id AND q.rap_deleted_at IS NULL
        AND t.status = 'resolved'
      RETURNING q.id`,
    [stars, comment, code]);
  if (!rows.length) {
    const { rows: q } = await pool.query('SELECT rap_deleted_at FROM rap_queue WHERE public_code = $1', [code]);
    if (q[0]?.rap_deleted_at) return res.status(410).json(GONE);
    return res.status(400).json({ error: 'Ratings open once your submission is resolved.' });
  }
  res.json({ ok: true });
}));

module.exports = router;
