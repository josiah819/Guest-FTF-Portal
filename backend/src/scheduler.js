// The minutely heartbeat: releases held queues when departments open, warns
// departments approaching their SLA window, and pages on breaches.
//
// Idempotency: every step is one UPDATE … SET <flag> WHERE <flag> IS NULL …
// RETURNING — the flag write and the work selection are the same statement,
// so restarts, overlapping deploys and repeated ticks can't double-notify.
// (At-most-once: if SMTP fails after the flag is set, the email is lost but
// the timeline event still records the attempt.)

const { pool, getSettings } = require('./db');
const clock = require('./clock');
const { notify } = require('./notify');

const TICK_MS = 60 * 1000;
let running = false;

const summarize = (r) => r.ai_summary || String(r.message || '').slice(0, 120);

function groupByDept(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = r.department_id || 0;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return m;
}

async function slaEvent(submissionId, detail) {
  await pool.query(
    `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'sla',$2)`,
    [submissionId, detail]);
}

// 1) Departments that just opened get their held submissions released, with
//    one digest email per department.
async function releaseHeldQueues(now) {
  const { rows } = await pool.query(
    `UPDATE submissions s SET held_until = NULL
      WHERE s.held_until IS NOT NULL AND s.held_until <= $1
      RETURNING s.id, s.public_code, s.department_id, s.urgency, s.message, s.ai_summary`,
    [now]);
  if (!rows.length) return;

  for (const [deptId, items] of groupByDept(rows)) {
    let dept = null;
    if (deptId) {
      const { rows: d } = await pool.query('SELECT name, email FROM departments WHERE id = $1', [deptId]);
      dept = d[0] || null;
    }
    for (const item of items) {
      await pool.query(
        `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'route',$2)`,
        [item.id, `Held queue released — ${dept?.name || 'the department'} is now open; SLA clock running`]);
    }
    const settings = await getSettings();
    await notify({
      to: [dept?.email, settings.integrations?.notifyEmail],
      subject: `[WoodsVoice] Good morning ${dept?.name || ''} — ${items.length} guest ${items.length === 1 ? 'submission' : 'submissions'} arrived while you were closed`,
      text: items.map(i => `• ${i.public_code} [${i.urgency}] ${summarize(i)}`).join('\n') +
        '\n\nTheir SLA clocks started at your opening time. Open the inbox: /admin/submissions',
    });
  }
  console.log(`[scheduler] released ${rows.length} held submission(s)`);
}

// Shared shape for the four warn/breach passes.
const PASSES = [
  {
    name: 'response warning',
    sql: `UPDATE submissions SET response_warned_at = $1
           WHERE response_warned_at IS NULL AND response_breached_at IS NULL
             AND first_response_at IS NULL AND status IN ('new','in_progress')
             AND held_until IS NULL AND sla_start_at IS NOT NULL AND first_response_due_at IS NOT NULL
             AND $1 >= sla_start_at + (first_response_due_at - sla_start_at) * ($2::float / 100.0)
             AND $1 <  first_response_due_at`,
    usesWarnPct: true,
    event: (r) => `Approaching first-response target (due ${new Date(r.first_response_due_at).toISOString()})`,
    subject: (dept, n) => `[WoodsVoice] ${n} ${n === 1 ? 'submission' : 'submissions'} approaching the first-response target — ${dept}`,
    escalate: false,
  },
  {
    name: 'response breach',
    sql: `UPDATE submissions SET response_breached_at = $1
           WHERE response_breached_at IS NULL
             AND first_response_at IS NULL AND status IN ('new','in_progress')
             AND held_until IS NULL AND first_response_due_at IS NOT NULL
             AND $1 >= first_response_due_at`,
    usesWarnPct: false,
    event: () => 'First-response target missed',
    subject: (dept, n) => `[WoodsVoice] ⏰ SLA BREACH — ${n} ${n === 1 ? 'submission' : 'submissions'} past first response (${dept})`,
    escalate: true,
  },
  {
    name: 'resolution warning',
    sql: `UPDATE submissions SET resolution_warned_at = $1
           WHERE resolution_warned_at IS NULL AND resolution_breached_at IS NULL
             AND resolved_at IS NULL AND status IN ('new','in_progress')
             AND held_until IS NULL AND sla_start_at IS NOT NULL AND resolution_due_at IS NOT NULL
             AND $1 >= sla_start_at + (resolution_due_at - sla_start_at) * ($2::float / 100.0)
             AND $1 <  resolution_due_at`,
    usesWarnPct: true,
    event: (r) => `Approaching resolution target (due ${new Date(r.resolution_due_at).toISOString()})`,
    subject: (dept, n) => `[WoodsVoice] ${n} open ${n === 1 ? 'submission' : 'submissions'} approaching the resolution target — ${dept}`,
    escalate: false,
  },
  {
    name: 'resolution breach',
    sql: `UPDATE submissions SET resolution_breached_at = $1
           WHERE resolution_breached_at IS NULL
             AND resolved_at IS NULL AND status IN ('new','in_progress')
             AND held_until IS NULL AND resolution_due_at IS NOT NULL
             AND $1 >= resolution_due_at`,
    usesWarnPct: false,
    event: () => 'Resolution target missed',
    subject: (dept, n) => `[WoodsVoice] ⏰ SLA BREACH — ${n} ${n === 1 ? 'submission' : 'submissions'} past resolution (${dept})`,
    escalate: true,
  },
];

const RETURNING = ' RETURNING id, public_code, department_id, urgency, message, ai_summary, first_response_due_at, resolution_due_at';

async function runPass(pass, now, settings) {
  const warnPct = Math.min(Math.max(settings.sla?.warnPct ?? 80, 10), 100);
  const params = pass.usesWarnPct ? [now, warnPct] : [now];
  const { rows } = await pool.query(pass.sql + RETURNING, params);
  if (!rows.length) return;

  for (const [deptId, items] of groupByDept(rows)) {
    let dept = null;
    if (deptId) {
      const { rows: d } = await pool.query(
        'SELECT name, email, on_call_user_id FROM departments WHERE id = $1', [deptId]);
      dept = d[0] || null;
    }
    for (const item of items) await slaEvent(item.id, pass.event(item));

    const recipients = [dept?.email];
    if (pass.escalate) {
      recipients.push(settings.integrations?.notifyEmail);
      // Urgent breaches also go to the on-call person, if one is set.
      if (dept?.on_call_user_id && items.some(i => ['high', 'safety'].includes(i.urgency))) {
        const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [dept.on_call_user_id]);
        recipients.push(u[0]?.email);
      }
    }
    await notify({
      to: recipients,
      subject: pass.subject(dept?.name || 'Unassigned', items.length),
      text: items.map(i => `• ${i.public_code} [${i.urgency}] ${summarize(i)}`).join('\n') +
        '\n\nOpen the inbox: /admin/submissions',
    });
  }
  console.log(`[scheduler] ${pass.name}: flagged ${rows.length}`);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = clock.now();
    const settings = await getSettings();

    try {
      await releaseHeldQueues(now);
    } catch (err) {
      console.error('[scheduler] held release failed:', err.message);
    }

    if (settings.features?.sla !== false) {
      for (const pass of PASSES) {
        try {
          await runPass(pass, now, settings);
        } catch (err) {
          console.error(`[scheduler] ${pass.name} failed:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] tick failed:', err.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  tick();
  const timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
  console.log('[scheduler] SLA/held-queue scheduler running (60s tick)');
}

module.exports = { startScheduler, tick };
