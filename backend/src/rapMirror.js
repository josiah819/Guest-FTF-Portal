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
const { recomputeDueDates } = require('./routing');

const INGEST_URL = process.env.RAP_INGEST_URL || 'https://rap.mwprogram.com/api/ingest';
const EXPORT_URL = process.env.RAP_EXPORT_URL ||
  INGEST_URL.replace(/\/api\/ingest\/?$/, '/api/export');
const EXPORT_KEY = (process.env.RAP_EXPORT_KEY || process.env.RAP_INGEST_KEY || '').trim();
const BOARD_BASE = (() => {
  try { return new URL(EXPORT_URL).origin; } catch { return ''; }
})();

const TICK_MS = 60 * 1000;
const RATE_LIMIT_PAUSE_MS = 65 * 1000;
const HISTORY_BATCH_MAX = 50;   // per ticket per tick — a flood can catch up next tick

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
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function mirrorConfigured() { return !!EXPORT_KEY; }

// Does the mirror own triage? routes/public.js asks this before running the
// local classifier — when the forwarded copy will be triaged by RAP and
// mirrored back, running Haiku here too would just double-spend and disagree.
function rapMirrorOwnsTriage(settings) {
  return mirrorConfigured() &&
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
  const rawStatus = norm(nameOf(pick(t, 'status', 'state')));
  if (id == null || !rawStatus) return null;
  const historyRaw = pick(t, 'history', 'events', 'timeline', 'log');
  const history = Array.isArray(historyRaw) ? historyRaw.map(h => {
    if (typeof h === 'string') return { text: h, at: null };
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
    localStatus: STATUS_MAP[rawStatus] || null,                    // null = unknown status, don't touch ours
    department: norm(nameOf(pick(t, 'department', 'dept', 'department_slug', 'department_name'))),
    category: norm(nameOf(pick(t, 'category', 'category_slug', 'category_name'))),
    severity: asInt(pick(t, 'severity', 'sev')),
    mood: asInt(pick(t, 'mood', 'guest_mood')),
    building: String(nameOf(pick(t, 'building', 'building_name', 'cabin', 'location')) ?? ''),
    summary: String(pick(t, 'summary', 'ai_summary') ?? ''),
    code: String(pick(t, 'code', 'source_code', 'meta.code', 'raw.code') ?? '').toUpperCase(),
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

function matchDepartment(rapDept, departments) {
  if (!rapDept) return null;
  const want = rapDept.replace(/_/g, ' ');
  const alias = DEPT_ALIASES[rapDept];
  return departments.find(d => {
    const have = d.name.toLowerCase();
    return have.includes(want) || (alias && have.includes(alias));
  }) || null;
}

function matchCategory(rapCat, categories) {
  if (!rapCat) return null;
  return categories.find(c => norm(c.slug) === rapCat) ||
    categories.find(c => c.slug === CATEGORY_MAP[rapCat]) || null;
}

// ---------- applying one ticket ----------

async function applyTicket(t, submissionId, taxonomy) {
  const { rows: subs } = await pool.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
  if (!subs.length) return false;
  const sub = subs[0];
  const { rows: mirrors } = await pool.query('SELECT * FROM rap_mirror WHERE submission_id = $1', [submissionId]);
  const prev = mirrors[0] || null;

  const client = await pool.connect();
  let changed = false;
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
        sets.push(`resolved_at = ${t.resolvedAt ? '$' + (params.push(t.resolvedAt), params.length) : 'now()'}`);
      }
      if (['new', 'in_progress'].includes(t.localStatus)) sets.push('resolved_at = NULL');
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
    const dept = matchDepartment(t.department, taxonomy.departments);
    const cat = matchCategory(t.category, taxonomy.categories);
    const urgency = SEVERITY_URGENCY[t.severity] || null;
    const triageSets = [];
    const triageParams = [submissionId];
    const triageBits = [];
    if (dept && dept.id !== sub.department_id) {
      triageSets.push(`department_id = $${triageParams.push(dept.id)}`);
      triageBits.push(`routed to ${dept.name}`);
    }
    if (cat && cat.id !== sub.category_id) {
      triageSets.push(`category_id = $${triageParams.push(cat.id)}`);
      triageBits.push(`category ${t.category.replace(/_/g, ' ')}`);
    }
    if (urgency && urgency !== sub.urgency && (!prev || t.severity !== prev.severity)) {
      triageSets.push(`urgency = $${triageParams.push(urgency)}`);
      triageBits.push(`severity ${t.severity}/5 → urgency ${urgency}`);
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

    // -- history: mirror new entries (RAP history is append-only) --
    const known = prev ? prev.history_count : 0;
    const fresh = t.history.slice(known, known + HISTORY_BATCH_MAX);
    for (const h of fresh) {
      await client.query(
        `INSERT INTO submission_events (submission_id, kind, detail, is_public, created_at)
         VALUES ($1,'rap',$2,false,coalesce($3, now()))`,
        [submissionId, `RAP: ${h.text.slice(0, 500)}`, h.at]);
    }
    if (fresh.length) changed = true;

    // -- upsert the mirror row (cache + change detector) --
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
       t.building.slice(0, 120), t.summary.slice(0, 500), known + fresh.length,
       JSON.stringify(t.raw ?? null), t.updatedAt]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Outside the transaction, same as the staff PATCH path: a routing or
  // urgency change re-derives the SLA due dates.
  if (changed) await recomputeDueDates(submissionId).catch(() => {});
  return changed;
}

// ---------- the tick ----------

async function fetchExport() {
  const resp = await fetch(EXPORT_URL, {
    headers: { 'Authorization': `Bearer ${EXPORT_KEY}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const bodyText = await resp.text();
  let body = null;
  try { body = JSON.parse(bodyText); } catch { /* html/error pages stay null */ }
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
      ({ resp, body } = await fetchExport());
    } catch (err) {
      state.lastError = `network: ${err.message}`;
      state.lastHttpStatus = null;
      return;    // transient — try again next tick
    }
    state.lastHttpStatus = resp.status;

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
    for (const rawTicket of list) {
      const t = parseTicket(rawTicket);
      if (t) { t.raw = rawTicket; tickets.push(t); }
    }
    state.lastTicketCount = list.length;
    if (list.length && !tickets.length) {
      state.lastError = 'export tickets were in an unexpected shape — run "Test mirror" in Settings to inspect them';
      return;
    }

    // Primary join: the ticket ids RAP returned at delivery time.
    const { rows: links } = await pool.query(
      `SELECT submission_id, rap_ticket_id FROM rap_queue WHERE rap_ticket_id IS NOT NULL`);
    const byTicketId = new Map(links.map(l => [Number(l.rap_ticket_id), l.submission_id]));

    // Fallback join: RAP echoing back our MW-XXXXXX code (it preserves the
    // extra payload keys). Backfill rap_queue so next tick is a direct hit.
    const orphans = tickets.filter(t => !byTicketId.has(t.id) && /^MW-[A-Z0-9]+$/.test(t.code));
    if (orphans.length) {
      const { rows: byCode } = await pool.query(
        `SELECT id, public_code FROM submissions WHERE public_code = ANY($1)`,
        [orphans.map(t => t.code)]);
      const codeMap = new Map(byCode.map(r => [r.public_code, r.id]));
      for (const t of orphans) {
        const sid = codeMap.get(t.code);
        if (sid == null) continue;
        byTicketId.set(t.id, sid);
        await pool.query(
          `UPDATE rap_queue SET rap_ticket_id = $2 WHERE submission_id = $1 AND rap_ticket_id IS NULL`,
          [sid, t.id]);
      }
    }

    const taxonomy = await loadLocalTaxonomy();
    let matched = 0, changedCount = 0;
    for (const t of tickets) {
      const sid = byTicketId.get(t.id);
      if (sid == null) continue;    // a RAP ticket from some other source
      matched++;
      try {
        if (await applyTicket(t, sid, taxonomy)) changedCount++;
      } catch (err) {
        console.error(`[rap-mirror] failed to apply ticket #${t.id} → submission ${sid}: ${err.message}`);
      }
    }

    state.lastSyncAt = new Date();
    state.lastError = '';
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
  if (haltedReason && parsed.length) {
    haltedReason = '';
    console.log('[rap-mirror] probe succeeded — halt cleared, resuming sync');
  }
  if (parsed.length) sync();    // fire-and-forget: reflect the probe immediately
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
