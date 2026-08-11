// RAP hand-off — delivers every guest note to the central Report-A-Problem
// intake API (contract v2: POST { text, submitted_at } + bearer key).
//
// Design, per the RAP intake brief:
//  - Submissions are queued in Postgres at capture time (rap_queue) and drained
//    by a background sender, so reports survive crashes, restarts and RAP
//    downtime, and retries always carry the original capture timestamp.
//  - Retry only when nothing was stored server-side: 429 (per-IP window —
//    pause the whole sender ≥60s), 503 and network errors (the insert is
//    transactional). 400 = our payload is wrong: park it, never retry
//    unchanged. 401/other 4xx = key or endpoint misconfig: halt the sender
//    until a restart so we alert instead of hammering.
//  - The key lives in RAP_INGEST_KEY (env only — never in the database, never
//    logged, never sent to any browser). All posting happens server-side.
//  - Everything the guest gave us travels with the note, contact details
//    included: RAP is where the ticket is actually worked, so its board needs
//    to be able to reach the guest without anyone coming back here.

const { pool, getSettings } = require('./db');

const INGEST_URL = process.env.RAP_INGEST_URL || 'https://rap.mwprogram.com/api/ingest';
const INGEST_KEY = (process.env.RAP_INGEST_KEY || '').trim();

const TICK_MS = 15 * 1000;
const BATCH = 5;                        // ≤5 per 15s tick keeps bursts well under RAP's 30 req/min/IP
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const RATE_LIMIT_PAUSE_MS = 65 * 1000;  // brief says back off ≥60s on 429

let running = false;
let haltedReason = '';                  // non-empty = stop until restart (401 / endpoint misconfig)
let pausedUntil = 0;                    // 429 pause
let warnedNoKey = false;

async function timelineEvent(submissionId, detail) {
  await pool.query(
    `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'forward',$2)`,
    [submissionId, detail]);
}

// Called inline on submission capture. Must never break the guest's submit —
// any failure is logged and the note still exists locally.
async function enqueueRap(settings, { submissionId, text, submittedAt, code, location, channel, ...guest }) {
  try {
    if (settings.features.rapForward === false) return;
    const body = String(text || '').trim().slice(0, 4000);  // RAP 400s past 4000 chars
    if (!body) return;
    const payload = {
      text: body,                                            // the guest's words, verbatim
      submitted_at: new Date(submittedAt).toISOString(),     // capture time, not delivery time
      // Extra fields: RAP preserves unknown keys in its immutable raw record.
      // Useful for cross-referencing, but RAP never *relies* on them.
      source: 'woodsvoice',
      code,                                                  // our MW-XXXXXX tracking code
      location: location || null,
      channel,                                               // qr | kiosk | web
    };
    // The rest of what the guest gave us. The guest_* type/urgency/category are
    // the guest's own declarations, sent only when they actually chose one —
    // our internal defaults would read to RAP's triage as a real answer. Blank
    // fields are dropped rather than sent as "", for the same reason.
    for (const [key, value] of Object.entries({
      guest_name: guest.guestName,
      guest_email: guest.guestEmail,
      guest_phone: guest.guestPhone,
      group_name: guest.groupName,
      location_slug: guest.locationSlug,
      guest_type: guest.guestType,
      guest_urgency: guest.guestUrgency,
      guest_category: guest.guestCategory,
      photo_url: guest.photoUrl,
      tracking_url: guest.trackingUrl,
    })) {
      const v = String(value ?? '').trim();
      if (v) payload[key] = v;
    }
    await pool.query(
      `INSERT INTO rap_queue (submission_id, payload) VALUES ($1, $2)
       ON CONFLICT (submission_id) DO NOTHING`,
      [submissionId, JSON.stringify(payload)]);
  } catch (err) {
    console.error('[rap] enqueue failed:', err.message);
  }
}

const errOf = (body, bodyText) =>
  String(body.error || bodyText || '').slice(0, 300);

async function deferRetry(row, status, msg) {
  const attempts = row.attempts + 1;
  // Exponential backoff with jitter, capped — RAP downtime shouldn't sync every
  // queued item into one thundering retry.
  const backoffMs = Math.round(
    Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts - 1, 10), MAX_BACKOFF_MS)
    * (0.75 + Math.random() * 0.5));
  await pool.query(
    `UPDATE rap_queue SET attempts = $2, next_attempt_at = now() + ($3 || ' milliseconds')::interval,
            last_status = $4, last_error = $5, updated_at = now()
      WHERE id = $1`,
    [row.id, attempts, backoffMs, status, msg]);
  if (attempts === 1) {
    await timelineEvent(row.submission_id, `RAP hand-off delayed (${msg || 'no response'}) — retrying with backoff`);
  }
  console.warn(`[rap] send failed for queue #${row.id} (${status || 'network'}: ${msg}) — retry in ~${Math.round(backoffMs / 1000)}s`);
}

async function sendOne(row) {
  let resp, bodyText = '';
  try {
    resp = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${INGEST_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(row.payload),
      signal: AbortSignal.timeout(10000),
    });
    bodyText = await resp.text();
  } catch (err) {
    // Network error / timeout: the RAP insert is transactional (201 or
    // nothing), so retrying can't create a duplicate ticket.
    return deferRetry(row, null, err.message);
  }

  let body = {};
  try { body = JSON.parse(bodyText); } catch { /* non-JSON body — keep raw text for errors */ }

  if (resp.ok) {  // contract: 201 {ok, submission_id, ticket_id}
    await pool.query(
      `UPDATE rap_queue SET status = 'sent', sent_at = now(), attempts = attempts + 1,
              last_status = $2, last_error = '', rap_submission_id = $3, rap_ticket_id = $4, updated_at = now()
        WHERE id = $1`,
      [row.id, resp.status, body.submission_id ?? null, body.ticket_id ?? null]);
    await timelineEvent(row.submission_id,
      `Forwarded to RAP${body.ticket_id != null ? ` — ticket #${body.ticket_id}` : ''}`);
    return;
  }

  if (resp.status === 429) {
    // Per-IP fixed window — pausing just this item would let the next one hit
    // the same wall, so the whole sender waits it out. Row stays pending.
    pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
    console.warn(`[rap] rate-limited (429) — pausing sends for ${Math.round(RATE_LIMIT_PAUSE_MS / 1000)}s`);
    return;
  }

  if (resp.status === 400) {
    const msg = errOf(body, bodyText);
    await pool.query(
      `UPDATE rap_queue SET status = 'failed', attempts = attempts + 1,
              last_status = 400, last_error = $2, updated_at = now()
        WHERE id = $1`,
      [row.id, msg]);
    await timelineEvent(row.submission_id, `RAP rejected the payload (400 ${msg}) — kept locally only`);
    console.error(`[rap] payload rejected for queue #${row.id}: ${msg} — not retrying (fix the payload builder)`);
    return;
  }

  if (resp.status >= 400 && resp.status < 500) {
    // 401 = missing/wrong key; anything else 4xx = endpoint misconfig. The
    // brief says do not retry — halt until restart, keep items queued.
    haltedReason = `${resp.status} ${errOf(body, bodyText)}`.trim();
    await pool.query(
      `UPDATE rap_queue SET attempts = attempts + 1, last_status = $2, last_error = $3, updated_at = now()
        WHERE id = $1`,
      [row.id, resp.status, errOf(body, bodyText)]);
    await timelineEvent(row.submission_id,
      `RAP hand-off halted (${haltedReason}) — notes stay queued; check RAP_INGEST_KEY and restart the backend`);
    console.error(`[rap] HALTED (${haltedReason}) — check RAP_INGEST_KEY / RAP_INGEST_URL and restart the backend; queued notes are safe`);
    return;
  }

  // 503 storage_unavailable / other 5xx — the brief says safe to retry with backoff.
  return deferRetry(row, resp.status, errOf(body, bodyText));
}

async function drain() {
  if (running || haltedReason || Date.now() < pausedUntil) return;
  running = true;
  try {
    const settings = await getSettings();
    if (settings.features.rapForward === false) return;
    if (!INGEST_KEY) {
      if (!warnedNoKey) {
        console.warn('[rap] hand-off is enabled but RAP_INGEST_KEY is not set — notes will queue until the key is configured');
        warnedNoKey = true;
      }
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, submission_id, payload, attempts FROM rap_queue
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY id LIMIT $1`, [BATCH]);
    for (const row of rows) {
      await sendOne(row);
      if (haltedReason || Date.now() < pausedUntil) break;
    }
  } catch (err) {
    console.error('[rap] drain failed:', err.message);
  } finally {
    running = false;
  }
}

function startRapSender() {
  drain();  // deliver anything left over from before a restart right away
  const timer = setInterval(drain, TICK_MS);
  if (timer.unref) timer.unref();
  if (INGEST_KEY) {
    console.log(`[rap] hand-off sender running (15s tick → ${INGEST_URL})`);
  } else {
    console.log('[rap] hand-off sender running — no RAP_INGEST_KEY yet, notes will queue');
  }
}

// Admin visibility (Settings → Features). Never includes the key.
async function rapStatus() {
  const { rows } = await pool.query(`SELECT status, count(*)::int AS n FROM rap_queue GROUP BY status`);
  const counts = { pending: 0, sent: 0, failed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  const { rows: sent } = await pool.query(`SELECT max(sent_at) AS last FROM rap_queue WHERE status = 'sent'`);
  const { rows: err } = await pool.query(
    `SELECT last_status, last_error FROM rap_queue
      WHERE last_error <> '' ORDER BY updated_at DESC LIMIT 1`);
  return {
    keyConfigured: !!INGEST_KEY,
    endpoint: INGEST_URL,
    halted: haltedReason || null,
    rateLimited: Date.now() < pausedUntil,
    counts,
    lastSentAt: sent[0]?.last || null,
    lastError: err[0] ? `${err[0].last_status || 'network'}: ${err[0].last_error}` : null,
  };
}

module.exports = { enqueueRap, startRapSender, rapStatus };
