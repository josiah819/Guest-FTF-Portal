// Hand-off integrations. FTF (Muskoka Woods' internal routing system) is an
// external system we can't call for real here, so it's modelled as a webhook:
// point integrations.ftfWebhookUrl at the FTF intake endpoint (or any
// test endpoint) and every new submission is POSTed there as JSON.

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

    if (settings.features.ftfForward && settings.integrations.ftfWebhookUrl) {
      const payload = {
        source: 'woodsvoice',
        code: s.public_code,
        type: s.type,
        category: s.category_name,
        department: s.department_name,
        location: s.location_name || s.location_text,
        urgency: s.urgency,
        message: s.message,
        guest: { name: s.guest_name, email: s.guest_email, phone: s.guest_phone, group: s.group_name },
        createdAt: s.created_at,
      };
      try {
        const resp = await fetch(settings.integrations.ftfWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        await pool.query(
          `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'forward',$2)`,
          [submissionId, `Forwarded to FTF (${resp.status})`]);
      } catch (err) {
        await pool.query(
          `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'forward',$2)`,
          [submissionId, `FTF forward failed: ${err.message}`]);
      }
    }

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
