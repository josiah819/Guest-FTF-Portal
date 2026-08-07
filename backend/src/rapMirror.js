// RAP mirror — the read half of the RAP integration. The hand-off (rap.js)
// pushes each guest note to the central Report-A-Problem board; this module
// pulls the resulting tickets back so the local record always shows what the
// handling team actually did: status, routing, severity, guest mood, history.
//
// Design:
//  - RAP is the system of record for ticket work. While the mirror is on,
//    local AI triage stands down (routes/public.js) and every mirrored change
//    lands with the same side effects a staff change would have had —
//    first_response_at / resolved_at stamps, timeline events — so the guest
//    tracking page, dashboard and SLA metrics keep working unchanged.
//  - Tickets are matched via rap_queue.rap_ticket_id (returned by RAP's 201 at
//    delivery time), with our MW-XXXXXX code as fallback when RAP echoes it
//    back (the intake preserves unknown payload keys). RAP tickets from other
//    sources are ignored.
//  - The export endpoint wasn't part of the published intake brief, so the
//    parser is tolerant about field names, and Settings → Features has a
//    "Test mirror" probe that reports exactly what the endpoint returned.
//    A shape we can't read is surfaced there, never silently guessed at.
//  - Same failure discipline as the sender: 401/other 4xx halts the mirror
//    (wrong or unauthorized key ≠ a retry storm) until a restart or a
//    successful probe; 429 pauses ≥60s; 5xx/network skips the tick.
//  - The key never leaves the server: it lives in RAP_EXPORT_KEY (falling
//    back to RAP_INGEST_KEY), and neither status nor probe responses ever
//    include it.

const { pool, getSettings } = require('./db');
const { routeSubmission, recomputeDueDates } = require('./routing');

const INGEST_URL = process.env.RAP_INGEST_URL || 'https://rap.mwprogram.com/api/ingest';
const EXPORT_URL = process.env.RAP_EXPORT_URL ||
  INGEST_URL.replace(/\/api\/ingest\/?$/, '/api/export');
const EXPORT_KEY = (process.env.RAP_EXPORT_KEY || process.env.RAP_INGEST_KEY || '').trim();
const BOARD_BASE = (() => {
  try { return new URL(EXPORT_URL).origin; } catch { return ''; }
})();

const TICK_MS = 60 * 1000;
const RATE_LIMIT_PAUSE_MS = 65 * 1000;
const HISTORY_BATCH_MAX = 50;     // event inserts per ticket per tick — a flood can catch up next tick
const HISTORY_PARSE_MAX = 200;    // history entries even examined per ticket
const BODY_MAX_BYTES = 10 * 1024 * 1024;  // the export is untrusted — never buffer/parse monsters
const TICKETS_MAX = 1000;         // tickets examined per tick
const RAW_MAX_BYTES = 100 * 1024; // per-ticket raw JSONB kept for debugging

// RAP's board statuses → ours. RAP normalizes to open/in_progress/resolved;
// tolerate dashes/spaces and a future "closed".
const STATUS_MAP = { open: 'new', in_progress: 'in_progress', resolved: 'resolved', closed: 'closed' };
const STATUS_LABEL = { new: 'New', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

// RAP severity (1..5) → our urgency. 5 alone maps to safety so mirrored
// tickets can't page on-call for anything RAP didn't grade as extreme.
const SEVERITY_URGENCY = { 1: 'low', 2: 'normal', 3: 'normal', 4: 'high', 5: 'safety' };

// RAP's category taxonomy → our category slugs (theirs is finer-grained).
// A local category whose slug matches RAP's exactly wins before this table.
const CATEGORY_MAP = {
  temperature: 'maintenance', plumbing: 'maintenance', electrical: 'maintenance',
  furnishings: 'maintenance', wifi: 'maintenance',
  cleanliness: 'housekeeping', pests: 'housekeeping',
  food_services: 'food', activities: 'program',
  noise: 'other', other: 'other',
};

// RAP department word → word to look for in our department names
// (their "Kitchen" is our "Food Services").
const DEPT_ALIASES = { kitchen: 'food' };

let running = false;
let haltedReason = '';
let pausedUntil = 0;
let warnedNoKey = false;
let etag = '';                 // export supports ETag/304 — most ticks are a cheap no-op
const state = {
  lastSyncAt: null,       // last successful fetch+apply
  lastError: '',          // human-readable, shown in Settings
  lastHttpStatus: null,
  lastTicketCount: 0,     // tickets in the last export
  lastMatchedCount: 0,    // …of which belong to us
  lastChangedCount: 0,    // …of which produced local updates
};

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
// Field values may be plain strings or {slug,name} objects.
const nameOf = (v) => (v && typeof v === 'object') ? (v.slug ?? v.name ?? '') : (v ?? '');
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const asInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const asScale5 = (v) => {   // RAP grades on 1..5; anything else is noise, not data
  const n = asInt(v);
  return n >= 1 && n <= 5 ? n : null;
};
// Plain-object lookups over attacker-controlled keys must never walk the
// prototype ('constructor', '__proto__', …).
const mapGet = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function mirrorConfigured() { return !!EXPORT_KEY; }

// Does the mirror own triage? routes/public.js asks this before running the
// local classifier — when the forwarded copy will be triaged by RAP and
// mirrored back, running Haiku here too would just double-spend and disagree.
// A halted mirror hands triage straight back: an external system's outage must
// never leave safety grading switched off locally.
function rapMirrorOwnsTriage(settings) {
  return mirrorConfigured() && !haltedReason &&
    settings.features.rapMirror !== false &&
    settings.features.rapForward !== false;
}

// ---------- tolerant export parsing ----------

function ticketListOf(body) {
  if (Array.isArray(body)) return body;
  for (const k of ['tickets', 'items', 'data', 'rows', 'results']) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return null;
}

function parseTicket(t) {
  if (!t || typeof t !== 'object') return null;
  const id = asInt(pick(t, 'id', 'ticket_id', 'ticket', 'number'));
  const rawStatus = norm(nameOf(pick(t, 'status', 'state'))).slice(0, 80);
  if (id == null || !rawStatus) return null;
  const historyRaw = pick(t, 'history', 'events', 'timeline', 'log');
  const history = Array.isArray(historyRaw) ? historyRaw.slice(0, HISTORY_PARSE_MAX).map(h => {
    if (typeof h === 'string') return { text: h, at: null };
    if (!h || typeof h !== 'object') return { text: '', at: null };
    const text = String(pick(h, 'text', 'detail', 'message', 'note', 'entry') ?? '').trim();
    const by = pick(h, 'by', 'author', 'user', 'name');
    return {
      text: by && !text.startsWith(String(by)) ? `${by}: ${text}` : text,
      at: asDate(pick(h, 'at', 'time', 'created_at', 'date', 'timestamp')),
    };
  }).filter(h => h.text) : [];
  return {
    id,
    status: rawStatus,                                             // RAP's own value
    localStatus: mapGet(STATUS_MAP, rawStatus) || null,            // null = unknown status, don't touch ours
    department: norm(nameOf(pick(t, 'department', 'dept', 'department_slug', 'department_name'))).slice(0, 80),
    category: norm(nameOf(pick(t, 'category', 'category_slug', 'category_name'))).slice(0, 80),
    severity: asScale5(pick(t, 'severity', 'sev')),
    mood: asScale5(pick(t, 'mood', 'guest_mood')),
    building: String(nameOf(pick(t, 'building', 'building_name', 'cabin', 'location')) ?? ''),
    summary: String(pick(t, 'summary', 'ai_summary') ?? ''),
    updatedAt: asDate(pick(t, 'updated_at', 'modified_at')),
    resolvedAt: asDate(pick(t, 'resolved_at', 'closed_at')),
    history,
  };
}

// ---------- mapping RAP's taxonomy onto ours ----------

async function loadLocalTaxonomy() {
  const { rows: departments } = await pool.query('SELECT id, name FROM departments WHERE active');
  const { rows: categories } = await pool.query('SELECT id, slug, department_id FROM categories WHERE active');
  return { departments, categories };
}

// Whole-word matching — substring matching would let a short RAP label like
// "it" claim "Facil-it-ies" and silently re-route the submission.
function matchDepartment(rapDept, departments) {
  if (!rapDept) return null;
  const wants = rapDept.split('_').filter(Boolean);
  const alias = mapGet(DEPT_ALIASES, rapDept);
  return departments.find(d => {
    const tokens = d.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return wants.every(w => tokens.includes(w)) || (alias && tokens.includes(alias));
  }) || null;
}

function matchCategory(rapCat, categories) {
  if (!rapCat) return null;
  return categories.find(c => norm(c.slug) === rapCat) ||
    categories.find(c => c.slug === mapGet(CATEGORY_MAP, rapCat)) || null;
}

// ---------- applying one ticket ----------

async function applyTicket(t, submissionId, taxonomy) {
  const { rows: subs } = await pool.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
  if (!subs.length) return false;
  const sub = subs[0];
  const { rows: mirrors } = await pool.query('SELECT * FROM rap_mirror WHERE submission_id = $1', [submissionId]);
  const prev = mirrors[0] || null;

  // RAP's timestamps are untrusted — outside [capture, now] they're noise.
  const clampTs = (d) => {
    if (!d) return null;
    const x = d.getTime();
    return x >= new Date(sub.created_at).getTime() && x <= Date.now() ? d : null;
  };

  const client = await pool.connect();
  let changed = false;
  let triagedFirstTime = false;   // department landed on a previously unrouted note
  let triageMoved = false;        // dept/urgency changed → due dates need re-deriving
  try {
    await client.query('BEGIN');

    // -- status --
    if (t.localStatus && t.localStatus !== sub.status) {
      const sets = ['status = $2'];
      const params = [submissionId, t.localStatus];
      if (!sub.first_response_at && t.localStatus !== 'new') {
        sets.push('first_response_at = now()');
      }
      if (['resolved', 'closed'].includes(t.localStatus) && !sub.resolved_at) {
        const resolvedAt = clampTs(t.resolvedAt);
        sets.push(`resolved_at = ${resolvedAt ? '$' + (params.push(resolvedAt), params.length) : 'now()'}`);
      }
      // Same reopen semantics as the staff PATCH: only a return to 'new'
      // clears resolved_at (resolved→in_progress keeps it, so a rework never
      // reads as a resolution-SLA breach).
      if (t.localStatus === 'new') sets.push('resolved_at = NULL');
      await client.query(`UPDATE submissions SET ${sets.join(', ')} WHERE id = $1`, params);
      // Same guest-visible wording as a staff status change, so the tracking
      // page reads identically however the ticket moved.
      await client.query(
        `INSERT INTO submission_events (submission_id, kind, detail, is_public)
         VALUES ($1,'status',$2,true)`,
        [submissionId, `Status changed to ${STATUS_LABEL[t.localStatus]}`]);
      changed = true;
    }

    // -- triage: department / category / urgency, mirrored from RAP --
    // Diff against the previous MIRROR row, not the local submission: RAP's
    // decisions apply when RAP changes its mind, but the mirror doesn't fight
    // local after-hours reroutes by re-asserting the same value every tick.
    const dept = matchDepartment(t.department, taxonomy.departments);
    const cat = matchCategory(t.category, taxonomy.categories);
    const urgency = mapGet(SEVERITY_URGENCY, t.severity) || null;
    const triageSets = [];
    const triageParams = [submissionId];
    const triageBits = [];
    if (dept && dept.id !== sub.department_id && (!prev || t.department !== prev.department)) {
      triageSets.push(`department_id = $${triageParams.push(dept.id)}`);
      triageBits.push(`routed to ${dept.name}`);
      triagedFirstTime = !sub.department_id;
      triageMoved = true;
    }
    if (cat && cat.id !== sub.category_id && (!prev || t.category !== prev.category)) {
      triageSets.push(`category_id = $${triageParams.push(cat.id)}`);
      triageBits.push(`category ${t.category.replace(/_/g, ' ')}`);
    }
    if (urgency && urgency !== sub.urgency && (!prev || t.severity !== prev.severity)) {
      triageSets.push(`urgency = $${triageParams.push(urgency)}`);
      triageBits.push(`severity ${t.severity}/5 → urgency ${urgency}`);
      triageMoved = true;
    }
    if (t.summary && !sub.ai_summary) {
      triageSets.push(`ai_summary = $${triageParams.push(t.summary.slice(0, 200))}`);
    }
    if (triageSets.length) {
      triageSets.push(`triage_via = 'rap'`, 'ai_processed = true');
      await client.query(
        `UPDATE submissions SET ${triageSets.join(', ')} WHERE id = $1`, triageParams);
      if (triageBits.length) {
        await client.query(
          `INSERT INTO submission_events (submission_id, kind, detail, is_public)
           VALUES ($1,'rap',$2,false)`,
          [submissionId, `RAP triage: ${triageBits.join(', ')}`]);
      }
      changed = true;
    }

    // -- history: mirror entries we haven't stored yet. Content-keyed, not
    // positional — the export's ordering is unknown, and a positional diff
    // against a newest-first or capped list would duplicate old entries and
    // drop new ones. (Identical repeated texts collapse; acceptable.)
    let freshCount = 0;
    if (t.history.length && (!prev || t.history.length !== prev.history_count || !prev.history_count)) {
      const { rows: seen } = await client.query(
        `SELECT detail FROM submission_events WHERE submission_id = $1 AND kind = 'rap'`, [submissionId]);
      const seenSet = new Set(seen.map(r => r.detail));
      const fresh = t.history
        .map(h => ({ ...h, detail: `RAP: ${h.text.slice(0, 500)}` }))
        .filter(h => !seenSet.has(h.detail))
        .slice(0, HISTORY_BATCH_MAX);
      for (const h of fresh) {
        await client.query(
          `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at)
           VALUES ($1,'rap',$2,false,coalesce($3, now()))`,
          [submissionId, h.detail, clampTs(h.at)]);
      }
      freshCount = fresh.length;
      if (freshCount) changed = true;
    }

    // -- upsert the mirror row (cache + change detector) --
    const rawStr = JSON.stringify(t.raw ?? null);
    await client.query(
      `INSERT INTO rap_mirror (submission_id, rap_ticket_id, status, department, category,
                               severity, mood, building, summary, history_count, raw, rap_updated_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (submission_id) DO UPDATE SET
         rap_ticket_id = EXCLUDED.rap_ticket_id, status = EXCLUDED.status,
         department = EXCLUDED.department, category = EXCLUDED.category,
         severity = EXCLUDED.severity, mood = EXCLUDED.mood,
         building = EXCLUDED.building, summary = EXCLUDED.summary,
         history_count = EXCLUDED.history_count, raw = EXCLUDED.raw,
         rap_updated_at = EXCLUDED.rap_updated_at, synced_at = now()`,
      [submissionId, t.id, t.status, t.department, t.category, t.severity, t.mood,
       t.building.slice(0, 120), t.summary.slice(0, 500), t.history.length,
       rawStr.length > RAW_MAX_BYTES ? null : rawStr, t.updatedAt]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Outside the transaction, mirroring the staff paths exactly:
  //  - RAP's FIRST routing of a previously unrouted note runs the full
  //    hours-aware routing (hold / reroute / on-call / urgent notify) that the
  //    local classifier used to trigger — a 2am safety report must still page.
  //  - a later dept/urgency change re-derives due dates like an admin PATCH.
  //  - status/history-only changes leave routing alone (recomputeDueDates
  //    clears held_until, so calling it gratuitously would wreck holds).
  if (triagedFirstTime) await routeSubmission(submissionId);
  else if (triageMoved) await recomputeDueDates(submissionId).catch(() => {});
  return changed;
}

// ---------- the tick ----------

async function fetchExport({ useEtag = false } = {}) {
  const headers = { 'Authorization': `Bearer ${EXPORT_KEY}`, 'Accept': 'application/json' };
  if (useEtag && etag) headers['If-None-Match'] = etag;
  const resp = await fetch(EXPORT_URL, { headers, signal: AbortSignal.timeout(15000) });
  const len = parseInt(resp.headers.get('content-length'), 10);
  if (len > BODY_MAX_BYTES) throw new Error(`export body too large (${len} bytes)`);
  const bodyText = resp.status === 304 ? '' : await resp.text();
  if (bodyText.length > BODY_MAX_BYTES) throw new Error(`export body too large (${bodyText.length} chars)`);
  let body = null;
  try { body = JSON.parse(bodyText); } catch { /* html/error pages stay null */ }
  if (resp.ok && resp.headers.get('etag')) etag = resp.headers.get('etag');
  return { resp, body, bodyText };
}

async function sync() {
  if (running || haltedReason || Date.now() < pausedUntil) return;
  running = true;
  try {
    const settings = await getSettings();
    if (settings.features.rapMirror === false) return;
    if (!EXPORT_KEY) {
      if (!warnedNoKey) {
        console.warn('[rap-mirror] enabled but no RAP_EXPORT_KEY / RAP_INGEST_KEY is set — nothing to sync with');
        warnedNoKey = true;
      }
      return;
    }

    let resp, body;
    try {
      ({ resp, body } = await fetchExport({ useEtag: true }));
    } catch (err) {
      state.lastError = `network: ${err.message}`;
      state.lastHttpStatus = null;
      return;    // transient — try again next tick
    }
    state.lastHttpStatus = resp.status;

    if (resp.status === 304) {   // nothing changed on the board since last tick
      state.lastSyncAt = new Date();
      state.lastError = '';
      return;
    }
    if (resp.status === 429) {
      pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      console.warn('[rap-mirror] rate-limited (429) — pausing');
      return;
    }
    if (!resp.ok) {
      if (resp.status >= 400 && resp.status < 500) {
        haltedReason = `${resp.status} ${String(body?.error || '').slice(0, 200)}`.trim();
        state.lastError = `halted: ${haltedReason} — the key may not be authorized for /api/export; ` +
          'ask the RAP operator for a read key (RAP_EXPORT_KEY), then use "Test mirror" in Settings';
        console.error(`[rap-mirror] HALTED (${haltedReason}) — check RAP_EXPORT_KEY/RAP_INGEST_KEY authorization`);
      } else {
        state.lastError = `RAP export returned ${resp.status}`;
      }
      return;
    }

    const list = ticketListOf(body);
    if (!list) {
      state.lastError = 'export response had no recognizable ticket list — run "Test mirror" in Settings to inspect it';
      return;
    }

    const tickets = [];
    for (const rawTicket of list.slice(0, TICKETS_MAX)) {
      const t = parseTicket(rawTicket);
      if (t) { t.raw = rawTicket; tickets.push(t); }
    }
    state.lastTicketCount = list.length;
    if (list.length && !tickets.length) {
      state.lastError = 'export tickets were in an unexpected shape — run "Test mirror" in Settings to inspect them';
      return;
    }

    // The only join: the ticket ids RAP returned at delivery time (contract:
    // the 201 always carries ticket_id). Nothing inside a ticket may choose
    // which submission it binds to — that would let any RAP-side submitter
    // steer someone else's local record.
    const { rows: links } = await pool.query(
      `SELECT submission_id, rap_ticket_id FROM rap_queue WHERE rap_ticket_id IS NOT NULL`);
    const byTicketId = new Map(links.map(l => [Number(l.rap_ticket_id), l.submission_id]));

    const taxonomy = await loadLocalTaxonomy();
    const appliedSids = new Set();   // one applied ticket per submission per tick
    let matched = 0, changedCount = 0, failedCount = 0;
    for (const t of tickets) {
      const sid = byTicketId.get(t.id);
      if (sid == null || appliedSids.has(sid)) continue;   // foreign ticket, or a duplicate claim
      appliedSids.add(sid);
      matched++;
      try {
        if (await applyTicket(t, sid, taxonomy)) changedCount++;
      } catch (err) {
        failedCount++;
        console.error(`[rap-mirror] failed to apply ticket #${t.id} → submission ${sid}: ${err.message}`);
      }
    }

    state.lastSyncAt = new Date();
    state.lastError = failedCount ? `${failedCount} ticket(s) failed to apply — see backend logs` : '';
    state.lastMatchedCount = matched;
    state.lastChangedCount = changedCount;
    if (changedCount) console.log(`[rap-mirror] synced ${matched} linked tickets, ${changedCount} updated`);
  } catch (err) {
    state.lastError = err.message;
    console.error('[rap-mirror] sync failed:', err.message);
  } finally {
    running = false;
  }
}

function startRapMirror() {
  sync();
  const timer = setInterval(sync, TICK_MS);
  if (timer.unref) timer.unref();
  console.log(mirrorConfigured()
    ? `[rap-mirror] running (60s tick ← ${EXPORT_URL})`
    : '[rap-mirror] no key configured — mirror idle until RAP_EXPORT_KEY/RAP_INGEST_KEY is set');
}

// Settings → Features readout. Never includes the key.
async function rapMirrorStatus() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n, max(synced_at) AS last FROM rap_mirror`);
  return {
    keyConfigured: mirrorConfigured(),
    endpoint: EXPORT_URL,
    boardBase: BOARD_BASE,
    halted: haltedReason || null,
    rateLimited: Date.now() < pausedUntil,
    linked: rows[0]?.n || 0,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError || null,
    lastTicketCount: state.lastTicketCount,
    lastMatchedCount: state.lastMatchedCount,
  };
}

// One diagnostic fetch for the Settings "Test mirror" button: reports the HTTP
// status and the shape of what came back (top-level keys only — never the key,
// never guest text). A success clears a halt (RAP-side authorization can be
// fixed without touching our env) and kicks a real sync.
async function probeMirror() {
  if (!EXPORT_KEY) {
    return { ok: false, error: 'No RAP_EXPORT_KEY or RAP_INGEST_KEY is set on the server (.env).' };
  }
  let resp, body, bodyText;
  try {
    ({ resp, body, bodyText } = await fetchExport());
  } catch (err) {
    return { ok: false, error: `Could not reach ${EXPORT_URL}: ${err.message}` };
  }
  if (!resp.ok) {
    return {
      ok: false,
      httpStatus: resp.status,
      error: resp.status === 401 || resp.status === 403
        ? 'The key was rejected (the ingest key may not be authorized to read). Ask the RAP operator to enable export for it, or provide a read key as RAP_EXPORT_KEY.'
        : `RAP export returned ${resp.status}: ${String(body?.error || bodyText || '').slice(0, 200)}`,
    };
  }
  const list = ticketListOf(body);
  if (!list) {
    return {
      ok: false, httpStatus: resp.status,
      error: 'Response was not a recognizable ticket list.',
      shape: body && typeof body === 'object' ? Object.keys(body).slice(0, 20) : typeof body,
    };
  }
  const parsed = list.map(parseTicket).filter(Boolean);
  const { rows: links } = await pool.query(
    `SELECT count(*)::int AS n FROM rap_queue WHERE rap_ticket_id IS NOT NULL`);
  // Any 2xx with a recognizable list proves the auth/endpoint problem is gone —
  // an empty board (fresh season) must still clear a halt and resume the loop.
  if (haltedReason) {
    haltedReason = '';
    console.log('[rap-mirror] probe succeeded — halt cleared, resuming sync');
  }
  sync();    // fire-and-forget: reflect the probe immediately
  return {
    ok: true,
    httpStatus: resp.status,
    ticketCount: list.length,
    parsedCount: parsed.length,
    linkedCount: links[0]?.n || 0,
    sampleKeys: list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).slice(0, 25) : [],
    statuses: [...new Set(parsed.map(t => t.status))].slice(0, 8),
  };
}

module.exports = { startRapMirror, rapMirrorStatus, probeMirror, rapMirrorOwnsTriage };
// Test-only: the pure parsing/mapping pieces, so fixture tests can cover the
// tolerant parser without a database.
module.exports._internals = { ticketListOf, parseTicket, matchDepartment, matchCategory, STATUS_MAP, SEVERITY_URGENCY, CATEGORY_MAP };
