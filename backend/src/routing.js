// Hours-aware routing. After triage picks a department, this decides where the
// submission actually lands and when its SLA clock starts:
//
//   department open  → lands there, clock starts now
//   closed + hold    → stays queued, clock starts at next opening (held_until)
//   closed + reroute → walks the fallback chain (loop-guarded) to an open dept
//   urgency_based    → high/safety reroute, normal/low hold (the default)
//   chain exhausted  → stays put, on-call user assigned + notified, clock now
//
// Due dates are wall-clock after the start: honesty comes from *when the clock
// starts*, not from pausing accrual mid-flight — "24h target" stays 24h.
// Timezone math is delegated to Postgres (AT TIME ZONE, full IANA tz data).
// Never throws upward: a routing failure must not break the guest pipeline.

const { pool, getSettings } = require('./db');
const clock = require('./clock');
const { notify } = require('./notify');

const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

async function localParts(instant, tz) {
  const { rows } = await pool.query(
    `SELECT extract(isodow from ($1::timestamptz AT TIME ZONE $2))::int AS dow,
            to_char($1::timestamptz AT TIME ZONE $2, 'HH24:MI') AS hhmm,
            ($1::timestamptz AT TIME ZONE $2)::date::text AS ldate`,
    [instant.toISOString(), tz]);
  return rows[0];
}

function windowFor(hours, dow) {
  const w = hours?.[DOW[dow - 1]];
  return Array.isArray(w) && w.length === 2 ? w : null;
}

// hours == null → the department never closes.
function isOpenAt(hours, parts) {
  if (!hours) return true;
  const w = windowFor(hours, parts.dow);
  return !!w && parts.hhmm >= w[0] && parts.hhmm < w[1];
}

// Next instant the department opens at/after `from`; null if it never opens.
async function nextOpenInstant(hours, tz, from) {
  if (!hours) return from;
  const p = await localParts(from, tz);
  for (let d = 0; d <= 7; d++) {
    const w = windowFor(hours, ((p.dow - 1 + d) % 7) + 1);
    if (!w) continue;
    if (d === 0 && p.hhmm >= w[0]) continue; // today's opening already passed
    const { rows } = await pool.query(
      `SELECT (($1::date + $2::int) + $3::time) AT TIME ZONE $4 AS t`,
      [p.ldate, d, w[0], tz]);
    return new Date(rows[0].t);
  }
  return null;
}

async function fmtLocal(instant, tz) {
  const { rows } = await pool.query(
    `SELECT to_char($1::timestamptz AT TIME ZONE $2, 'Dy FMHH24:MI') AS s`,
    [instant.toISOString(), tz]);
  return rows[0].s;
}

// Effective SLA target precedence: department override ?? urgency override ?? global.
function effectiveTargets(dept, urgency, settings) {
  const sla = settings.sla || {};
  const u = (sla.urgency || {})[urgency] || null;
  return {
    resp: dept?.sla_response_hours ?? u?.firstResponseHours ?? sla.firstResponseHours ?? 24,
    reso: dept?.sla_resolution_hours ?? u?.resolutionHours ?? sla.resolutionHours ?? 72,
  };
}

const addHours = (date, h) => new Date(date.getTime() + h * 3600 * 1000);

async function routeEvent(submissionId, detail, isPublic = false) {
  await pool.query(
    `INSERT INTO submission_events (submission_id, kind, detail, is_public) VALUES ($1,'route',$2,$3)`,
    [submissionId, detail, isPublic]);
}

async function routeSubmission(submissionId) {
  try {
    const settings = await getSettings();
    const tz = settings.general?.timezone || 'America/Toronto';
    const now = clock.now();

    const { rows: subs } = await pool.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
    if (!subs.length) return;
    const sub = subs[0];

    const { rows: depts } = await pool.query('SELECT * FROM departments WHERE active');
    const byId = new Map(depts.map(d => [d.id, d]));
    const origin = sub.department_id ? byId.get(sub.department_id) : null;

    // Nothing to route to: start the clock so it still shows up in SLA math,
    // and flag it for a human.
    if (!origin) {
      const t = effectiveTargets(null, sub.urgency, settings);
      await pool.query(
        `UPDATE submissions SET sla_start_at = $1, first_response_due_at = $2, resolution_due_at = $3 WHERE id = $4`,
        [now, addHours(now, t.resp), addHours(now, t.reso), submissionId]);
      await routeEvent(submissionId, 'No department matched — needs manual triage');
      return;
    }

    const parts = await localParts(now, tz);
    const urgent = ['high', 'safety'].includes(sub.urgency);
    const hops = [];
    const visited = new Set([origin.id]);
    let target = origin;
    let held = false;
    let onCall = false;

    while (!isOpenAt(target.hours, parts)) {
      const policy = target.after_hours || 'urgency_based';
      const escalate = policy === 'reroute' || (policy === 'urgency_based' && urgent);
      if (!escalate) { held = true; break; }
      const next = target.fallback_department_id ? byId.get(target.fallback_department_id) : null;
      if (!next || visited.has(next.id)) { held = true; onCall = true; break; }
      visited.add(next.id);
      hops.push([target, next]);
      target = next;
    }

    let slaStart = now;
    let heldUntil = null;
    if (held) {
      const opens = await nextOpenInstant(target.hours, tz, now);
      if (opens) {
        slaStart = opens;
        heldUntil = opens;
      } else {
        onCall = true; // never opens — clock starts now so the breach path pages someone
      }
    }

    const t = effectiveTargets(target, sub.urgency, settings);
    const onCallUserId = onCall ? (target.on_call_user_id || origin.on_call_user_id || null) : null;
    await pool.query(
      `UPDATE submissions SET
         department_id = $1,
         rerouted_from_department_id = $2,
         assigned_user_id = coalesce($3, assigned_user_id),
         sla_start_at = $4,
         first_response_due_at = $5,
         resolution_due_at = $6,
         held_until = $7
       WHERE id = $8`,
      [target.id,
       target.id !== origin.id ? origin.id : null,
       onCallUserId,
       slaStart, addHours(slaStart, t.resp), addHours(slaStart, t.reso),
       heldUntil, submissionId]);

    for (const [from, to] of hops) {
      await routeEvent(submissionId, `${from.name} is closed — rerouted to ${to.name}`);
    }
    if (held && heldUntil) {
      const opensAt = await fmtLocal(heldUntil, tz);
      await routeEvent(submissionId, `${target.name} is closed — held until ${opensAt}; the SLA clock starts then`);
    } else if (held && !heldUntil) {
      await routeEvent(submissionId, `${target.name} has no opening hours — kept in queue, on-call notified`);
    } else if (hops.length) {
      const dueAt = await fmtLocal(addHours(slaStart, t.resp), tz);
      await routeEvent(submissionId, `Landed at ${target.name} (open) — first response due ${dueAt}`);
    }
    if (onCall) {
      await routeEvent(submissionId, `All fallback routes closed — on-call escalation for ${target.name}`);
    }

    // Notifications: urgent arrivals to an open department ping it right away;
    // exhausted chains ping the on-call person + the global notify address.
    const summary = sub.ai_summary || sub.message.slice(0, 140);
    if (!held && urgent) {
      await notify({
        submissionId,
        to: [target.email, settings.integrations?.notifyEmail],
        subject: `[WoodsVoice] ${sub.urgency.toUpperCase()} — ${sub.public_code} (${target.name})`,
        text: `A ${sub.urgency} submission just landed for ${target.name}.\n\n“${summary}”\n\nLocation: ${sub.location_text || 'not given'}\nFirst response due: ${await fmtLocal(addHours(slaStart, t.resp), tz)}\n\nOpen it: /admin/submissions`,
      });
    }
    if (onCall) {
      let onCallEmail = null;
      if (onCallUserId) {
        const { rows: u } = await pool.query('SELECT email, display_name FROM users WHERE id = $1', [onCallUserId]);
        onCallEmail = u[0]?.email || null;
      }
      await notify({
        submissionId,
        to: [onCallEmail, target.email, settings.integrations?.notifyEmail],
        subject: `[WoodsVoice] ON-CALL — ${sub.urgency} ${sub.public_code}: every route is closed`,
        text: `A ${sub.urgency} submission arrived and no department on its fallback chain is open.\n\n“${summary}”\n\nIt stays with ${target.name}; please make sure someone sees it.\n\nOpen it: /admin/submissions`,
      });
    }
  } catch (err) {
    console.error('[routing] error:', err.message);
  }
}

// After a human changes urgency/department: re-derive due dates from the
// existing clock start and stop treating the item as "waiting for opening".
async function recomputeDueDates(submissionId) {
  try {
    const settings = await getSettings();
    const { rows: subs } = await pool.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
    if (!subs.length) return;
    const sub = subs[0];
    let dept = null;
    if (sub.department_id) {
      const { rows: d } = await pool.query('SELECT * FROM departments WHERE id = $1', [sub.department_id]);
      dept = d[0] || null;
    }
    const start = sub.sla_start_at ? new Date(sub.sla_start_at) : new Date(sub.created_at);
    const t = effectiveTargets(dept, sub.urgency, settings);
    await pool.query(
      `UPDATE submissions SET
         sla_start_at = $1, first_response_due_at = $2, resolution_due_at = $3, held_until = NULL
       WHERE id = $4`,
      [start, addHours(start, t.resp), addHours(start, t.reso), submissionId]);
  } catch (err) {
    console.error('[routing] recompute error:', err.message);
  }
}

module.exports = { routeSubmission, recomputeDueDates, effectiveTargets, isOpenAt, nextOpenInstant, localParts, addHours, fmtLocal };
