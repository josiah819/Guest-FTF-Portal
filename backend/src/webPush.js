// Browser push notifications (Web Push + VAPID via the web-push package).
// Staff subscribe per device from Settings → Notifications; per-user
// preferences decide which board events notify whom, enforced HERE at send
// time — including visibility: a dept-scoped user never gets a push for a
// ticket outside their scope, mirroring the inbox. Events come from
// rapSync.sync()'s board diff; like the guest email path, everything is
// fire-and-forget and a push failure must never break a sync tick.

const webpush = require('web-push');
const { pool, deepMerge } = require('./db');
const { matchDeptLabels } = require('./deptScope');

const DEFAULT_PUSH_PREFS = {
  enabled: true,
  events: {
    newTicket: true,       // a ticket appeared on the board
    statusChanged: false,  // moved to any non-resolved status
    resolved: true,        // resolved / closed
    guestNote: true,       // a note to the guest was posted
    severity: true,        // severity changed
    deleted: false,        // removed from the board
  },
  minSeverity: 0,          // 0 = any; N = only severity >= N (newTicket + severity events)
  onlyMyDepartments: false,
};

let vapidPublicKey = '';
let configured = false;

function pushConfigured() { return configured; }
function getVapidPublicKey() { return vapidPublicKey; }

// web-push requires an https: or mailto: subject; it's handed to the push
// service as an abuse contact, nothing more.
function vapidSubject() {
  const explicit = String(process.env.VAPID_SUBJECT || '').trim();
  if (explicit) return explicit;
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base.startsWith('https:')) return base;
  const from = String(process.env.SMTP_FROM || '').trim();
  const email = (from.match(/[^\s<>]+@[^\s<>]+/) || [])[0];
  return `mailto:${email || 'woodsvoice@localhost'}`;
}

// Env keys win (pinned by the operator); else the stored pair; else generate
// once and store. Never regenerate while a row exists — a new pair would
// silently invalidate every subscription.
async function initWebPush() {
  try {
    let pub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    let priv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    let source = 'env';
    if (!pub || !priv) {
      const { rows } = await pool.query('SELECT public_key, private_key FROM push_vapid WHERE id = 1');
      if (rows.length) {
        ({ public_key: pub, private_key: priv } = rows[0]);
        source = 'database';
      } else {
        ({ publicKey: pub, privateKey: priv } = webpush.generateVAPIDKeys());
        await pool.query('INSERT INTO push_vapid (id, public_key, private_key) VALUES (1, $1, $2)', [pub, priv]);
        source = 'generated and stored';
      }
    }
    webpush.setVapidDetails(vapidSubject(), pub, priv);
    vapidPublicKey = pub;
    configured = true;
    console.log(`[push] VAPID keys ${source === 'env' ? 'loaded from env' : source === 'database' ? 'loaded from database' : source}`);
  } catch (err) {
    console.error('[push] init failed — push notifications disabled:', err.message);
  }
}

// ---------- per-user preferences ----------

// Only known keys survive; anything else in the body is dropped.
function sanitizePrefs(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
  if (typeof patch.onlyMyDepartments === 'boolean') out.onlyMyDepartments = patch.onlyMyDepartments;
  if (patch.minSeverity !== undefined) {
    const n = parseInt(patch.minSeverity, 10);
    out.minSeverity = Number.isFinite(n) ? Math.min(Math.max(n, 0), 5) : 0;
  }
  if (patch.events && typeof patch.events === 'object') {
    out.events = {};
    for (const k of Object.keys(DEFAULT_PUSH_PREFS.events)) {
      if (typeof patch.events[k] === 'boolean') out.events[k] = patch.events[k];
    }
  }
  return out;
}

async function getPushPrefs(userId) {
  const { rows } = await pool.query('SELECT push FROM user_notification_prefs WHERE user_id = $1', [userId]);
  return deepMerge(DEFAULT_PUSH_PREFS, rows[0]?.push || {});
}

async function savePushPrefs(userId, patch) {
  const current = await getPushPrefs(userId);
  const merged = deepMerge(current, sanitizePrefs(patch));
  await pool.query(
    `INSERT INTO user_notification_prefs (user_id, push, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET push = $2, updated_at = now()`,
    [userId, JSON.stringify(merged)]);
  return merged;
}

// ---------- subscriptions ----------

async function addSubscription(userId, sub, uaLabel) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth) {
    const err = new Error('That subscription doesn’t look valid — try turning notifications off and on again.');
    err.status = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua_label)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       ua_label = EXCLUDED.ua_label, last_error = ''`,
    [userId, endpoint, p256dh, auth, String(uaLabel || '').slice(0, 120)]);
}

async function removeSubscription(userId, endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [userId, String(endpoint || '')]);
}

async function listSubscriptions(userId) {
  const { rows } = await pool.query(
    `SELECT id, endpoint, ua_label, created_at, last_used_at
       FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return rows;
}

// ---------- sending ----------

// Returns 'sent' | 'gone' | 'failed'; never throws. 404/410 means the push
// service dropped the subscription (browser unsubscribed, permissions revoked)
// — prune the row so we stop paying for it.
async function sendToSubscription(row, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload), { TTL: 3600 });
    await pool.query(`UPDATE push_subscriptions SET last_used_at = now(), last_error = '' WHERE id = $1`, [row.id]);
    return 'sent';
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(() => {});
      console.log(`[push] pruned a gone subscription (HTTP ${err.statusCode})`);
      return 'gone';
    }
    const msg = String(err.message || err.statusCode || 'send failed').slice(0, 300);
    await pool.query('UPDATE push_subscriptions SET last_error = $2 WHERE id = $1', [row.id, msg]).catch(() => {});
    console.error(`[push] send failed: ${msg}`);
    return 'failed';
  }
}

async function sendTestNotification(userId) {
  const subs = await listSubscriptions(userId);
  const payload = {
    title: 'WoodsVoice test notification',
    body: 'Push notifications are working on this device.',
    tag: 'wv-test',
    url: '/admin/submissions',
  };
  const result = { sent: 0, gone: 0, failed: 0 };
  for (const row of subs) result[await sendToSubscription(row, payload)]++;
  return result;
}

// ---------- board-event fan-out ----------

const human = (s) => String(s || '').replace(/_/g, ' ');
const snippet = (t) => String(t.summary || t.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);

// Payload text is built from the untrusted RAP export — everything is sliced,
// and no guest contact details ever enter a payload (push services store them).
function buildPayload(evt) {
  const t = evt.t;
  const parts = (...xs) => xs.filter(Boolean).join(' · ');
  switch (evt.type) {
    case 'newTicket':
      return {
        title: `New ticket — ${t.building || t.department || `#${t.id}`}`,
        body: parts(t.severity && `Sev ${t.severity}`, t.department, snippet(t)),
      };
    case 'resolved':
      return { title: `Ticket #${t.id} resolved`, body: parts(t.building, snippet(t)) };
    case 'statusChanged':
      return { title: `Ticket #${t.id} moved to ${human(t.status)}`, body: parts(t.building, snippet(t)) };
    case 'guestNote': {
      const note = t.guestNotes[t.guestNotes.length - 1];
      return { title: `Note to guest on ticket #${t.id}`, body: String(note?.text || '').slice(0, 120) };
    }
    case 'severity':
      return {
        title: `Ticket #${t.id} severity ${evt.prevSeverity ?? '—'} → ${t.severity ?? '—'}`,
        body: parts(t.building, snippet(t)),
      };
    case 'deleted':
      return { title: `Ticket #${t.id} removed from the board`, body: parts(t.building, snippet(t)) };
    default:
      return null;
  }
}

function wantsEvent(prefs, evt) {
  if (!prefs.enabled || !prefs.events[evt.type]) return false;
  if (prefs.minSeverity > 0 && (evt.type === 'newTicket' || evt.type === 'severity')) {
    if ((evt.t.severity || 0) < prefs.minSeverity) return false;
  }
  return true;
}

// One call per sync tick with every event that tick produced. Fire-and-forget:
// callers don't await, and nothing here may throw.
async function notifyTicketPush(events) {
  try {
    if (!configured || !events.length) return;
    const { rows: subs } = await pool.query(
      `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth,
              coalesce(p.push, '{}'::jsonb) AS prefs,
              EXISTS (SELECT 1 FROM role_permissions rp
                       WHERE rp.role_id = u.role_id AND rp.perm = 'submissions.view_all') AS view_all,
              coalesce((SELECT array_agg(d.name) FROM user_departments ud
                          JOIN departments d ON d.id = ud.department_id
                         WHERE ud.user_id = u.id), '{}') AS dept_names
         FROM push_subscriptions s
         JOIN users u ON u.id = s.user_id AND u.active
         LEFT JOIN user_notification_prefs p ON p.user_id = s.user_id`);
    if (!subs.length) return;

    // Label universe for department matching: what's cached now, plus the
    // event tickets' own labels (a label deleted or brand-new this tick must
    // still match).
    const { rows: labelRows } = await pool.query(
      `SELECT DISTINCT department FROM rap_tickets WHERE department <> ''`);
    const labels = new Set(labelRows.map(r => r.department));
    for (const evt of events) if (evt.t.department) labels.add(evt.t.department);
    const allLabels = [...labels];

    // Per-user view: effective prefs + which RAP labels their departments match.
    const users = new Map();
    for (const s of subs) {
      if (!users.has(s.user_id)) {
        users.set(s.user_id, {
          prefs: deepMerge(DEFAULT_PUSH_PREFS, s.prefs || {}),
          viewAll: s.view_all,
          myLabels: new Set(matchDeptLabels(s.dept_names || [], allLabels)),
          subs: [],
        });
      }
      users.get(s.user_id).subs.push(s);
    }

    for (const evt of events) {
      const payload = buildPayload(evt);
      if (!payload) continue;
      payload.tag = `wv-ticket-${evt.t.id}`;
      payload.url = evt.type === 'deleted' ? '/admin/submissions' : `/admin/submissions?open=${evt.t.id}`;
      for (const u of users.values()) {
        if (!wantsEvent(u.prefs, evt)) continue;
        // Visibility mirrors the inbox: dept-scoped users only see matching
        // labels (an unlabeled ticket matches no one); view_all users see
        // everything unless they opted into onlyMyDepartments.
        const needsMatch = !u.viewAll || u.prefs.onlyMyDepartments;
        if (needsMatch && !u.myLabels.has(evt.t.department)) continue;
        for (const row of u.subs) await sendToSubscription(row, payload);
      }
    }
  } catch (err) {
    console.error('[push] fan-out failed:', err.message);
  }
}

module.exports = {
  initWebPush, pushConfigured, getVapidPublicKey,
  getPushPrefs, savePushPrefs, DEFAULT_PUSH_PREFS,
  addSubscription, removeSubscription, listSubscriptions,
  sendTestNotification, notifyTicketPush,
};
