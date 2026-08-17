// Guest email updates: a guest who leaves an email on the thank-you screen
// (or tracking page) gets a branded email as their note moves along. Templates
// live in settings.content.emails (Settings → Content → Guest update emails)
// with {name} {code} {location} {orgName} {status} placeholders.
//
// The feature is only offered to guests when the admin toggle is on AND SMTP
// is actually configured — collecting an address we could never send to would
// be a silent lie. Every send goes through notify(), so failures degrade to a
// timeline event and never propagate to the caller.

const { pool, getSettings } = require('./db');
const { notify, smtpEnabled } = require('./notify');
const { guestUpdateEmailHtml } = require('./emails');
const { publicOrigin } = require('./util');

// Which status transitions email the guest. 'new' (reopen) and 'closed'
// (administrative, possibly spam-binning) stay silent on purpose.
const STATUS_TEMPLATE = { in_progress: 'inProgress', resolved: 'resolved' };

const EMAIL_KINDS = ['signup', 'inProgress', 'resolved'];

function emailUpdatesEnabled(settings) {
  return settings.features.emailUpdates !== false && smtpEnabled();
}

function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(name|code|location|orgName|status)\}/g, (_, k) => vars[k] ?? '');
}

// sub: { public_code, guest_name, status, location }. Returns { subject, text, html }.
function renderGuestEmail(kind, sub, settings, origin) {
  const t = (settings.content.emails || {})[kind] || {};
  const statusLabels = settings.content.labels?.statuses || {};
  const vars = {
    name: String(sub.guest_name || '').trim() || 'there',
    code: sub.public_code,
    location: sub.location || '',
    orgName: settings.general.orgName,
    status: statusLabels[sub.status] || sub.status,
  };
  const trackingUrl = origin && settings.features.tracking ? `${origin}/t/${sub.public_code}` : '';
  const subject = fill(t.subject, vars) || `Update on your note ${sub.public_code}`;
  const bodyText = fill(t.body, vars);
  const ctaLabel = fill(t.cta, vars);
  const footNote = fill(settings.content.emails?.footerNote, vars);
  const logoPath = settings.content.branding?.logoLight || '/brand/mw-logo-white.png';
  const html = guestUpdateEmailHtml({
    kicker: `Note ${sub.public_code}`,
    heading: fill(t.heading, vars) || subject,
    bodyText,
    ctaUrl: trackingUrl,
    ctaLabel,
    footNote,
    logoUrl: origin ? `${origin}${logoPath}` : '',
  });
  const text = bodyText +
    (trackingUrl ? `\n\n${ctaLabel || 'Check my note'}: ${trackingUrl}` : '') +
    (footNote ? `\n\n—\n${footNote}` : '');
  return { subject, text, html };
}

// Render + send one update email for a submission. Loads fresh row state so it
// works from any call site (route handler, RAP mirror tick).
async function sendGuestEmail(kind, submissionId, req = null) {
  const settings = await getSettings();
  if (!emailUpdatesEnabled(settings)) return false;
  const { rows } = await pool.query(
    `SELECT s.public_code, s.guest_name, s.updates_email, s.status,
            coalesce(l.name, nullif(s.location_text, '')) AS location
       FROM submissions s LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.id = $1`, [submissionId]);
  const sub = rows[0];
  if (!sub || !sub.updates_email) return false;
  const { subject, text, html } = renderGuestEmail(kind, sub, settings, publicOrigin(req));
  return notify({ submissionId, to: sub.updates_email, subject, text, html });
}

// Called wherever a status lands (staff PATCH, RAP mirror). Fire-and-forget
// safe: never throws.
async function notifyGuestStatus(submissionId, status, req = null) {
  try {
    const kind = STATUS_TEMPLATE[status];
    if (!kind) return;
    await sendGuestEmail(kind, submissionId, req);
  } catch (err) {
    console.error('[guest-updates] status email failed:', err.message);
  }
}

module.exports = { EMAIL_KINDS, emailUpdatesEnabled, renderGuestEmail, sendGuestEmail, notifyGuestStatus };
