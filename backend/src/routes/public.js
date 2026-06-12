const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool, getSettings } = require('../db');
const { aw, clampStr, newPublicCode, newFileName, rateLimit } = require('../util');
const { classifySubmission } = require('../classify');
const { forwardSubmission } = require('../forward');

const router = express.Router();

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
    features: {
      submissionTypes: settings.features.submissionTypes,
      photoUpload: settings.features.photoUpload && settings.fields.photo !== 'off',
      urgency: settings.features.urgency && settings.fields.urgency !== 'off',
      tracking: settings.features.tracking,
      csat: settings.features.csat,
      kioskMode: settings.features.kioskMode,
      aiCategorization: settings.features.aiCategorization,
    },
    categories,
    locations,
  });
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
  const type = settings.features.submissionTypes && types.includes(b.type) ? b.type : 'issue';

  let location = null;
  if (locationSlug) {
    const { rows } = await pool.query('SELECT id, name FROM locations WHERE slug = $1 AND active', [locationSlug]);
    location = rows[0] || null;
  }

  // Guest may pick a category; otherwise the AI layer fills it in async.
  let category = null;
  const categorySlug = clampStr(b.category, 120);
  if (categorySlug) {
    const { rows } = await pool.query(
      'SELECT id, name, department_id FROM categories WHERE slug = $1 AND active', [categorySlug]);
    category = rows[0] || null;
  }

  const urgencies = ['low', 'normal', 'high', 'safety'];
  const guestChoseUrgency = settings.features.urgency && fields.urgency !== 'off' && urgencies.includes(b.urgency);
  const urgency = guestChoseUrgency ? b.urgency : 'normal';

  const source = b.source === 'kiosk' ? 'kiosk' : (b.source === 'web' ? 'web' : 'qr');
  const photoPath = (settings.features.photoUpload && fields.photo !== 'off' && req.file)
    ? `/uploads/${req.file.filename}` : '';

  const code = newPublicCode();
  const { rows } = await pool.query(
    `INSERT INTO submissions
      (public_code, type, category_id, department_id, location_id, location_text, message,
       urgency, guest_name, guest_email, guest_phone, group_name, photo_path, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [code, type, category?.id || null, category?.department_id || null,
     location?.id || null, location?.name || '', message, urgency,
     guestName, guestEmail, guestPhone, groupName, photoPath, source]);
  const id = rows[0].id;

  await pool.query(
    `INSERT INTO submission_events (submission_id, kind, detail, is_public)
     VALUES ($1,'created','Submission received',true)`, [id]);

  // Async pipeline: AI triage, then forwarding. Guest never waits on either.
  const pipeline = async () => {
    if (settings.features.aiCategorization) {
      await classifySubmission(id, {
        message, type,
        locationName: location?.name,
        guestChoseCategory: !!category,
        guestChoseUrgency,
      });
    }
    await forwardSubmission(id);
  };
  pipeline().catch(err => console.error('[pipeline]', err.message));

  res.status(201).json({
    code,
    tracking: settings.features.tracking,
    successTitle: settings.general.successTitle,
    successMessage: settings.general.successMessage,
  });
}));

router.get('/track/:code', aw(async (req, res) => {
  const settings = await getSettings();
  if (!settings.features.tracking) return res.status(404).json({ error: 'Tracking is not enabled.' });
  const code = clampStr(req.params.code, 20).toUpperCase();
  const { rows } = await pool.query(
    `SELECT s.public_code, s.type, s.status, s.urgency, s.created_at, s.resolved_at, s.rating,
            c.name AS category, c.emoji, l.name AS location
       FROM submissions s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.public_code = $1`, [code]);
  if (!rows.length) return res.status(404).json({ error: 'We couldn’t find that code. Double-check and try again.' });

  const { rows: events } = await pool.query(
    `SELECT kind, detail, created_at FROM submission_events
      WHERE submission_id = (SELECT id FROM submissions WHERE public_code = $1)
        AND is_public ORDER BY created_at`, [code]);
  res.json({ ...rows[0], events, csat: settings.features.csat });
}));

router.post('/track/:code/rating', aw(async (req, res) => {
  const settings = await getSettings();
  if (!settings.features.csat) return res.status(404).json({ error: 'Ratings are not enabled.' });
  const code = clampStr(req.params.code, 20).toUpperCase();
  const stars = parseInt(req.body.stars, 10);
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Rating must be 1–5 stars.' });
  const comment = clampStr(req.body.comment, 1000);

  const { rows } = await pool.query(
    `UPDATE submissions SET rating = $1, rating_comment = $2
      WHERE public_code = $3 AND status IN ('resolved','closed') RETURNING id`,
    [stars, comment, code]);
  if (!rows.length) return res.status(400).json({ error: 'Ratings open once your submission is resolved.' });
  await pool.query(
    `INSERT INTO submission_events (submission_id, kind, detail, is_public)
     VALUES ($1,'rating',$2,true)`, [rows[0].id, `Guest rated ${stars}/5`]);
  res.json({ ok: true });
}));

module.exports = router;
