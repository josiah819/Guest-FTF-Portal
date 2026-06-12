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

// Very small fixed-window rate limiter for the public submit endpoint.
const buckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
    b.count += 1;
    if (buckets.size > 5000) buckets.clear(); // crude memory guard
    if (b.count > max) {
      return res.status(429).json({ error: 'Too many submissions — please wait a few minutes.' });
    }
    next();
  };
}

module.exports = { newPublicCode, newFileName, aw, clampStr, rateLimit };
