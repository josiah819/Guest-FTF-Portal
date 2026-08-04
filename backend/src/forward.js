// Per-submission email notification. (The old FTF webhook that lived here grew
// into the real RAP hand-off — see rap.js; it runs from a durable queue at
// capture time instead of after triage.)

const { pool, getSettings } = require('./db');
const { notify } = require('./notify');

async function forwardSubmission(submissionId) {
  try {
    const settings = await getSettings();
    const { rows } = await pool.query(
      `SELECT s.*, c.name AS category_name, d.name AS department_name, l.name AS location_name
         FROM submissions s
         LEFT JOIN categories c ON c.id = s.category_id
         LEFT JOIN departments d ON d.id = s.department_id
         LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.id = $1`, [submissionId]);
    if (!rows.length) return;
    const s = rows[0];

    if (settings.features.emailForward && settings.integrations.notifyEmail) {
      // Sends for real when SMTP is configured; logs a timeline event otherwise.
      await notify({
        submissionId,
        to: settings.integrations.notifyEmail,
        subject: `[WoodsVoice] New ${s.urgency} ${s.type} — ${s.public_code} (${s.department_name || 'unassigned'})`,
        text: `${s.ai_summary || s.message}\n\nLocation: ${s.location_name || s.location_text || 'not given'}\nGuest: ${s.guest_name || 'anonymous'}${s.group_name ? ` (${s.group_name})` : ''}\n\nOpen it: /admin/submissions`,
      });
    }
  } catch (err) {
    console.error('[forward] error:', err.message);
  }
}

module.exports = { forwardSubmission };
