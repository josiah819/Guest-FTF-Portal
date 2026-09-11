// Guest email updates: a guest who leaves an email on the thank-you screen
// (or tracking page) gets a branded email as their note moves along on the RAP
// board. Templates live in settings.content.emails (Settings → Content →
// Guest update emails) with {name} {code} {location} {orgName} {status}
// placeholders.
//
// Ticket state lives on RAP; the guest's address and opt-in live on the local
// rap_queue capture row, keyed to the ticket by rap_ticket_id. The RAP sync
// calls notifyGuestStatus whenever a cached ticket's status moves — only
// tickets that originated here have a queue row, so only our guests can ever
// be emailed.
//
// The feature is only offered to guests when the admin toggle is on AND SMTP
// is actually configured — collecting an address we could never send to would
// be a silent lie. Every send goes through notify(), so failures degrade to a
// console line and never propagate to the caller.

const { pool, getSettings } = require('./db');
const { notify, smtpEnabled } = require('./notify');
const { guestUpdateEmailHtml } = require('./emails');
const { publicOrigin } = require('./util');

// Which RAP status transitions email the guest. 'open' (reopen) stays silent
// on purpose.
const STATUS_TEMPLATE = { in_progress: 'inProgress', resolved: 'resolved' };

const EMAIL_KINDS = ['signup', 'inProgress', 'resolved'];

function emailUpdatesEnabled(settings) {
  return settings.features.emailUpdates !== false && smtpEnabled();
}

function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(name|code|location|orgName|status)\}/g, (_, k) => vars[k] ?? '');
}

function guestStatusLabel(settings, status) {
  const labels = settings.content.labels?.statuses || {};
  return labels[status] || status;
}

// sub: { public_code, guest_name, status, location }. Returns { subject, text, html }.
function renderGuestEmail(kind, sub, settings, origin) {
  const t = (settings.content.emails || {})[kind] || {};
  const vars = {
    name: String(sub.guest_name || '').trim() || 'there',
    code: sub.public_code,
    location: sub.location || '',
    orgName: settings.general.orgName,
    status: guestStatusLabel(settings, sub.status),
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

// Render + send one update email for a capture row. Accepts the queue row's
// public code plus the current RAP status (the queue row itself holds no
// ticket state). Works from any call site (route handler, RAP sync tick).
async function sendGuestEmail(kind, code, status = '', req = null) {
  const settings = await getSettings();
  if (!emailUpdatesEnabled(settings)) return false;
  const { rows } = await pool.query(
    `SELECT public_code, guest_name, updates_email, location_name AS location
       FROM rap_queue WHERE public_code = $1`, [code]);
  const sub = rows[0];
  if (!sub || !sub.updates_email) return false;
  const { subject, text, html } = renderGuestEmail(kind, { ...sub, status }, settings, publicOrigin(req));
  return notify({ to: sub.updates_email, subject, text, html });
}

// Called by the RAP sync when a cached ticket's status moves. Fire-and-forget
// safe: never throws.
async function notifyGuestStatus(rapTicketId, status) {
  try {
    const kind = STATUS_TEMPLATE[status];
    if (!kind) return;
    const { rows } = await pool.query(
      `SELECT public_code FROM rap_queue
        WHERE rap_ticket_id = $1 AND updates_email <> '' AND public_code IS NOT NULL`, [rapTicketId]);
    for (const row of rows) {
      await sendGuestEmail(kind, row.public_code, status);
    }
  } catch (err) {
    console.error('[guest-updates] status email failed:', err.message);
  }
}

module.exports = { EMAIL_KINDS, emailUpdatesEnabled, renderGuestEmail, sendGuestEmail, notifyGuestStatus, guestStatusLabel };
