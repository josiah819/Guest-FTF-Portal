// Live "the board changed" signal: one SSE connection per tab to
// GET /api/admin/events, shared by every mounted useSoftReload hook. On a
// ping, all subscribed reload callbacks run (debounced) — pages refetch
// immediately instead of waiting out their 30s poll, which stays as the
// fallback whenever this stream is down.
//
// EventSource can't send an Authorization header and this app keeps secrets
// out of URLs, so the stream is read with fetch + ReadableStream and the
// bearer token, with our own reconnect backoff.
import { getToken } from './api';

const DEBOUNCE_MS = 500;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;

const subscribers = new Set();
let controller = null;      // AbortController while a connection is running
let reconnectTimer = null;
let backoff = BACKOFF_MIN_MS;
let debounceTimer = null;

function fireAll() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (document.visibilityState === 'hidden') return;   // refocus tick catches up
    for (const fn of subscribers) fn();
  }, DEBOUNCE_MS);
}

async function connect() {
  if (controller || !subscribers.size) return;
  const token = getToken();
  if (!token) return;   // guest pages and logged-out tabs never connect
  controller = new AbortController();
  try {
    const res = await fetch('/api/admin/events', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401) { controller = null; return; }   // reconnects on next login
    if (!res.ok || !res.body) throw new Error(`events stream ${res.status}`);
    backoff = BACKOFF_MIN_MS;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = frame.split('\n').find(l => l.startsWith('data: '));
        if (!data) continue;   // heartbeat comments
        try {
          if (JSON.parse(data.slice(6)).type === 'board') fireAll();
        } catch { /* malformed frame — ignore */ }
      }
    }
    throw new Error('events stream ended');
  } catch {
    // Aborted (last subscriber left) or dropped (server restart) — the poll
    // covers the gap; retry with backoff while anyone is still subscribed.
    const aborted = controller?.signal.aborted;
    controller = null;
    if (!aborted && subscribers.size) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  }
}

function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (controller) controller.abort();
  controller = null;
  backoff = BACKOFF_MIN_MS;
}

// Logging back in remounts the admin pages, whose hooks resubscribe — no
// matching login event needed.
window.addEventListener('woodsvoice:logout', disconnect);

export function subscribe(fn) {
  subscribers.add(fn);
  connect();
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size) disconnect();
  };
}
