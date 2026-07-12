// Email dispatch. SMTP comes from env (SMTP_HOST/PORT/SECURE/USER/PASS/FROM);
// without it every notification degrades to a visible timeline event so the
// trail still exists. Failures never propagate — callers fire and forget.

const nodemailer = require('nodemailer');
const { pool } = require('./db');

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;

const FROM = process.env.SMTP_FROM || 'WoodsVoice <woodsvoice@localhost>';

const smtpEnabled = () => !!transport;

async function logEvent(submissionId, detail) {
  if (!submissionId) return console.log(`[notify] ${detail}`);
  try {
    await pool.query(
      `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'notify',$2)`,
      [submissionId, detail]);
  } catch (err) {
    console.error('[notify] event write failed:', err.message);
  }
}

// to: string | string[] — empties dropped, duplicates collapsed.
async function notify({ submissionId = null, to, subject, text }) {
  try {
    const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
    if (!recipients.length) {
      await logEvent(submissionId, `No notification address configured — wanted to send: ${subject}`);
      return false;
    }
    if (!transport) {
      await logEvent(submissionId, `Email (SMTP not configured): “${subject}” → ${recipients.join(', ')}`);
      return false;
    }
    await transport.sendMail({ from: FROM, to: recipients.join(', '), subject, text });
    await logEvent(submissionId, `Emailed ${recipients.join(', ')}: ${subject}`);
    return true;
  } catch (err) {
    await logEvent(submissionId, `Email failed (${err.message}): ${subject}`);
    return false;
  }
}

module.exports = { notify, smtpEnabled };
