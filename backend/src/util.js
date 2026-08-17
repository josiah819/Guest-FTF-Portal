const crypto = require('crypto');

// Unambiguous alphabet (no 0/O/1/I) for guest-facing tracking codes.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function newPublicCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `MW-${out}`;
}

function newFileName(ext) {
  return crypto.randomBytes(16).toString('hex') + ext.toLowerCase();
}

// Express 4 doesn't catch async errors; tiny wrapper instead of a dependency.
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function clampStr(v, max = 2000) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

// Very small fixed-window rate limiter for the public endpoints. Each
// limiter instance gets its own bucket namespace so one endpoint's traffic
// (e.g. visit beacons) can't eat into another's allowance.
const buckets = new Map();
let limiterSeq = 0;
function rateLimit({ windowMs, max, message }) {
  const ns = ++limiterSeq;
  return (req, res, next) => {
    const key = `${ns}:${req.ip || 'unknown'}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
    b.count += 1;
    if (buckets.size > 5000) buckets.clear(); // crude memory guard
    if (b.count > max) {
      return res.status(429).json({ error: message || 'Too many submissions — please wait a few minutes.' });
    }
    next();
  };
}

// Absolute origin for links that leave the app (invite emails, RAP hand-offs).
// PUBLIC_BASE_URL is authoritative; falling back to the request's own origin
// means trusting the Host header, so it only stands in when the host is a
// plain hostname — a crafted Host must never become a link in an email.
const CONFIGURED_BASE = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const PLAIN_HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

// req is optional — background senders (RAP mirror status emails) have no
// request, so without PUBLIC_BASE_URL they simply get no absolute links.
function publicOrigin(req) {
  if (CONFIGURED_BASE) return CONFIGURED_BASE;
  const host = String((req && req.get('host')) || '');
  return PLAIN_HOST.test(host) ? `${req.protocol}://${host}` : '';
}

module.exports = { newPublicCode, newFileName, aw, clampStr, rateLimit, publicOrigin };
