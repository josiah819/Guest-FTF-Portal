// RAP board sync — the read half of the RAP integration, and the only source
// of ticket data WoodsVoice has. The hand-off (rap.js) delivers guest notes to
// the central Report-A-Problem board; this module pulls RAP's export and keeps
// a verbatim local cache (rap_tickets) of EVERY ticket on the board — statuses,
// categories, departments and severities exactly as RAP spells them, no
// mapping onto any local taxonomy. The admin inbox, dashboard, guest tracking
// page and guest status emails all read from this cache.
//
// Design:
//  - RAP is the system of record. The cache exists so the site keeps working
//    (and RAP isn't hammered by page views) — it's disposable except for the
//    observed_* stamps, which record when the POLLER first saw a transition so
//    response/resolution metrics work even if the export has no timestamps.
//  - Tickets that originated here are linked via rap_queue.rap_ticket_id
//    (returned by RAP's 201 at delivery time). Nothing inside a ticket may
//    choose which queue row it binds to — that would let any RAP-side
//    submitter steer someone else's tracking page and emails.
//  - The export endpoint wasn't part of the published intake brief, so the
//    parser is tolerant about field names, and Settings → Features has a
//    "Test sync" probe that reports exactly what the endpoint returned.
//    A shape we can't read is surfaced there, never silently guessed at.
//  - Failure discipline mirrors the sender: 401/other 4xx halts the sync
//    (wrong or unauthorized key ≠ a retry storm) until a restart or a
//    successful probe; 429 pauses ≥60s; 5xx/network skips the tick.
//  - The key never leaves the server: it lives in RAP_EXPORT_KEY (falling
//    back to RAP_INGEST_KEY), and neither status nor probe responses ever
//    include it.

const { pool, getSettings } = require('./db');
const { notifyGuestStatus } = require('./guestUpdates');

const INGEST_URL = process.env.RAP_INGEST_URL || 'https://rap.mwprogram.com/api/ingest';
const EXPORT_URL = process.env.RAP_EXPORT_URL ||
  INGEST_URL.replace(/\/api\/ingest\/?$/, '/api/export');
const EXPORT_KEY = (process.env.RAP_EXPORT_KEY || process.env.RAP_INGEST_KEY || '').trim();
const BOARD_BASE = (() => {
  try { return new URL(EXPORT_URL).origin; } catch { return ''; }
})();

const TICK_MS = 60 * 1000;
const KICK_DELAY_MS = 2 * 1000;   // debounce for kickSync (post-delivery nudge)
const RATE_LIMIT_PAUSE_MS = 65 * 1000;
const HISTORY_PARSE_MAX = 200;    // history/guest-note entries examined per ticket
const BODY_MAX_BYTES = 10 * 1024 * 1024;  // the export is untrusted — never buffer/parse monsters
const TICKETS_MAX = 5000;         // tickets examined per tick
const RAW_MAX_BYTES = 100 * 1024; // per-ticket raw JSONB kept for debugging
const TEXT_MAX = 8000;

// RAP statuses that mean "someone has acted" / "it's done", for the observed_*
// stamps and guest emails. Everything else is treated as still-open.
const RESPONDED = (s) => s && s !== 'open' && s !== 'new';
const RESOLVED = (s) => s === 'resolved' || s === 'closed';

let running = false;
let haltedReason = '';
let pausedUntil = 0;
let warnedNoKey = false;
let kickTimer = null;
let etag = '';                 // export supports ETag/304 — most ticks are a cheap no-op
const state = {
  lastSyncAt: null,       // last successful fetch+apply
  lastError: '',          // human-readable, shown in Settings
  lastHttpStatus: null,
  lastTicketCount: 0,     // tickets in the last export
  lastChangedCount: 0,    // …of which produced cache updates
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
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function syncConfigured() { return !!EXPORT_KEY; }

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
    const at = asDate(pick(h, 'at', 'time', 'created_at', 'date', 'timestamp'));
    return {
      text: (by && !text.startsWith(String(by)) ? `${by}: ${text}` : text).slice(0, 500),
      at: at ? at.toISOString() : null,
    };
  }).filter(h => h.text) : [];
  // guest_notes: one-way messages RAP staff write TO the guest — unlike history,
  // these are meant for guest eyes and flow through to the tracking page.
  // Oldest first as delivered; there is no reply channel.
  const notesRaw = pick(t, 'guest_notes', 'guestNotes');
  const guestNotes = Array.isArray(notesRaw) ? notesRaw.slice(0, HISTORY_PARSE_MAX).map(n => {
    if (typeof n === 'string') return { at: null, text: n.trim().slice(0, 2000) };
    if (!n || typeof n !== 'object') return { at: null, text: '' };
    const at = asDate(n.at);
    return { at: at ? at.toISOString() : null, text: String(n.text ?? '').trim().slice(0, 2000) };
  }).filter(n => n.text) : [];
  return {
    id,
    status: rawStatus,                                             // RAP's own value, verbatim
    department: String(nameOf(pick(t, 'department', 'dept', 'department_slug', 'department_name')) ?? '').trim().slice(0, 120),
    category: String(nameOf(pick(t, 'category', 'category_slug', 'category_name')) ?? '').trim().slice(0, 120),
    severity: asScale5(pick(t, 'severity', 'sev')),
    mood: asScale5(pick(t, 'mood', 'guest_mood')),
    building: String(nameOf(pick(t, 'building', 'building_name', 'cabin', 'location')) ?? '').trim().slice(0, 120),
    summary: String(pick(t, 'summary', 'ai_summary') ?? '').slice(0, 500),
    text: String(pick(t, 'text', 'message', 'body', 'description', 'original_text', 'note') ?? '').slice(0, TEXT_MAX),
    createdAt: asDate(pick(t, 'created_at', 'submitted_at', 'opened_at')),
    updatedAt: asDate(pick(t, 'updated_at', 'modified_at')),
    resolvedAt: asDate(pick(t, 'resolved_at', 'closed_at')),
    history,
    guestNotes,
  };
}

// ---------- applying the export to the cache ----------

// Upserts one parsed ticket. prev is the cached row (or undefined). Returns
// true when the row materially changed.
async function upsertTicket(t, prev) {
  const historyStr = JSON.stringify(t.history);
  const guestNotesStr = JSON.stringify(t.guestNotes);
  const changed = !prev ||
    prev.status !== t.status || prev.department !== t.department ||
    prev.category !== t.category || prev.severity !== t.severity ||
    prev.mood !== t.mood || prev.building !== t.building ||
    prev.summary !== t.summary || (t.text && prev.text !== t.text) ||
    prev.history_count !== t.history.length ||
    prev.guest_notes_count !== t.guestNotes.length;
  if (!changed) return false;

  const rawStr = JSON.stringify(t.raw ?? null);
  await pool.query(
    `INSERT INTO rap_tickets (id, status, department, category, severity, mood, building,
                              summary, text, history, guest_notes, raw, rap_created_at,
                              rap_updated_at, rap_resolved_at, observed_response_at,
                              observed_resolved_at, first_seen_at, last_seen_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             CASE WHEN $16 THEN now() END, CASE WHEN $17 THEN now() END, now(), now(), now())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, department = EXCLUDED.department,
       category = EXCLUDED.category, severity = EXCLUDED.severity,
       mood = EXCLUDED.mood, building = EXCLUDED.building,
       summary = EXCLUDED.summary,
       text = CASE WHEN EXCLUDED.text <> '' THEN EXCLUDED.text ELSE rap_tickets.text END,
       history = EXCLUDED.history, guest_notes = EXCLUDED.guest_notes, raw = EXCLUDED.raw,
       rap_created_at = coalesce(EXCLUDED.rap_created_at, rap_tickets.rap_created_at),
       rap_updated_at = coalesce(EXCLUDED.rap_updated_at, rap_tickets.rap_updated_at),
       rap_resolved_at = coalesce(EXCLUDED.rap_resolved_at, rap_tickets.rap_resolved_at),
       observed_response_at = coalesce(rap_tickets.observed_response_at, CASE WHEN $16 THEN now() END),
       observed_resolved_at = coalesce(rap_tickets.observed_resolved_at, CASE WHEN $17 THEN now() END),
       last_seen_at = now(), synced_at = now()`,
    [t.id, t.status, t.department, t.category, t.severity, t.mood, t.building,
     t.summary, t.text, historyStr, guestNotesStr,
     rawStr.length > RAW_MAX_BYTES ? null : rawStr,
     t.createdAt, t.updatedAt, t.resolvedAt,
     RESPONDED(t.status), RESOLVED(t.status)]);
  return true;
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
  // Only the applying path (sync) may advance the stored ETag. A probe fetch
  // that stored it would make the very next sync 304 on a board state that was
  // never applied — the cache would trail the board until its next change.
  if (useEtag && resp.ok && resp.headers.get('etag')) etag = resp.headers.get('etag');
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
        console.warn('[rap-sync] enabled but no RAP_EXPORT_KEY / RAP_INGEST_KEY is set — nothing to sync with');
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
      console.warn('[rap-sync] rate-limited (429) — pausing');
      return;
    }
    if (!resp.ok) {
      if (resp.status >= 400 && resp.status < 500) {
        haltedReason = `${resp.status} ${String(body?.error || '').slice(0, 200)}`.trim();
        state.lastError = `halted: ${haltedReason} — the key may not be authorized for /api/export; ` +
          'ask the RAP operator for a read key (RAP_EXPORT_KEY), then use "Test sync" in Settings';
        console.error(`[rap-sync] HALTED (${haltedReason}) — check RAP_EXPORT_KEY/RAP_INGEST_KEY authorization`);
      } else {
        state.lastError = `RAP export returned ${resp.status}`;
      }
      return;
    }

    const list = ticketListOf(body);
    if (!list) {
      state.lastError = 'export response had no recognizable ticket list — run "Test sync" in Settings to inspect it';
      return;
    }

    const tickets = [];
    for (const rawTicket of list.slice(0, TICKETS_MAX)) {
      const t = parseTicket(rawTicket);
      if (t) { t.raw = rawTicket; tickets.push(t); }
    }
    state.lastTicketCount = list.length;
    if (list.length && !tickets.length) {
      state.lastError = 'export tickets were in an unexpected shape — run "Test sync" in Settings to inspect them';
      return;
    }

    // Previous cache state, for change detection and status-transition emails.
    const { rows: prevRows } = await pool.query(
      `SELECT id, status, department, category, severity, mood, building, summary, text,
              jsonb_array_length(history)::int AS history_count,
              jsonb_array_length(guest_notes)::int AS guest_notes_count
         FROM rap_tickets`);
    const prevById = new Map(prevRows.map(r => [Number(r.id), r]));

    const seenIds = [];
    const transitions = [];   // {ticketId, status} where status actually moved
    let changedCount = 0, failedCount = 0;
    const appliedIds = new Set();   // duplicate ids in one export: first wins
    for (const t of tickets) {
      if (appliedIds.has(t.id)) continue;
      appliedIds.add(t.id);
      seenIds.push(t.id);
      const prev = prevById.get(t.id);
      try {
        if (await upsertTicket(t, prev)) changedCount++;
        if (prev && prev.status !== t.status) transitions.push({ ticketId: t.id, status: t.status });
      } catch (err) {
        failedCount++;
        console.error(`[rap-sync] failed to cache ticket #${t.id}: ${err.message}`);
      }
    }
    // Unchanged rows still get their last_seen bumped, in one statement.
    if (seenIds.length) {
      await pool.query(`UPDATE rap_tickets SET last_seen_at = now() WHERE id = ANY($1)`, [seenIds]);
    }

    // Deletion pass: RAP is the system of record, so a ticket absent from a
    // complete export was deleted on the board — drop its cache row now, which
    // removes it from the inbox, dashboard and metrics in the same tick (the
    // guest tracking page falls back to "received"). Two guards: a truncated
    // export (over TICKETS_MAX) proves nothing about what it omitted, and an
    // entry whose id we can read but whose shape we can't parse still counts
    // as present — a field rename must never mass-delete the cache.
    if (list.length <= TICKETS_MAX) {
      const presentIds = new Set(seenIds);
      for (const rawTicket of list) {
        const id = asInt(pick(rawTicket, 'id', 'ticket_id', 'ticket', 'number'));
        if (id != null) presentIds.add(id);
      }
      const { rowCount: pruned } = await pool.query(
        `DELETE FROM rap_tickets WHERE id <> ALL($1::bigint[])`, [[...presentIds]]);
      if (pruned) console.log(`[rap-sync] pruned ${pruned} ticket(s) deleted on the RAP board`);
    }

    state.lastSyncAt = new Date();
    state.lastError = failedCount ? `${failedCount} ticket(s) failed to cache — see backend logs` : '';
    state.lastChangedCount = changedCount;
    if (changedCount) console.log(`[rap-sync] cached ${tickets.length} tickets, ${changedCount} updated`);

    // Guest status emails: same promise a local staff change used to make — an
    // opted-in guest hears when THEIR note moves along. Only tickets linked to
    // a queue row (i.e. submitted here) can ever email anyone. Fire-and-forget.
    for (const tr of transitions) {
      notifyGuestStatus(tr.ticketId, tr.status);
    }
  } catch (err) {
    state.lastError = err.message;
    console.error('[rap-sync] sync failed:', err.message);
  } finally {
    running = false;
  }
}

// Post-delivery nudge from the sender: sync soon (debounced), not in a minute.
function kickSync() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => { kickTimer = null; sync(); }, KICK_DELAY_MS);
  if (kickTimer.unref) kickTimer.unref();
}

function startRapSync() {
  sync();
  const timer = setInterval(sync, TICK_MS);
  if (timer.unref) timer.unref();
  console.log(syncConfigured()
    ? `[rap-sync] running (60s tick ← ${EXPORT_URL})`
    : '[rap-sync] no key configured — sync idle until RAP_EXPORT_KEY/RAP_INGEST_KEY is set');
}

// Settings → Features readout. Never includes the key.
async function rapSyncStatus() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS cached, max(synced_at) AS last FROM rap_tickets`);
  const { rows: linked } = await pool.query(
    `SELECT count(*)::int AS n FROM rap_queue WHERE rap_ticket_id IS NOT NULL`);
  return {
    keyConfigured: syncConfigured(),
    endpoint: EXPORT_URL,
    boardBase: BOARD_BASE,
    halted: haltedReason || null,
    rateLimited: Date.now() < pausedUntil,
    cached: rows[0]?.cached || 0,
    linked: linked[0]?.n || 0,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError || null,
    lastTicketCount: state.lastTicketCount,
  };
}

// One diagnostic fetch for the Settings "Test sync" button: reports the HTTP
// status and the shape of what came back (top-level keys only — never the key,
// never guest text). A success clears a halt (RAP-side authorization can be
// fixed without touching our env) and kicks a real sync.
async function probeSync() {
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
    console.log('[rap-sync] probe succeeded — halt cleared, resuming sync');
  }
  sync();    // fire-and-forget: reflect the probe immediately
  return {
    ok: true,
    httpStatus: resp.status,
    ticketCount: list.length,
    parsedCount: parsed.length,
    withTextCount: parsed.filter(t => t.text).length,
    linkedCount: links[0]?.n || 0,
    sampleKeys: list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).slice(0, 25) : [],
    statuses: [...new Set(parsed.map(t => t.status))].slice(0, 8),
  };
}

module.exports = { startRapSync, rapSyncStatus, probeSync, kickSync, BOARD_BASE };
// Test-only: the pure parsing pieces, so fixture tests can cover the tolerant
// parser without a database.
module.exports._internals = { ticketListOf, parseTicket };
