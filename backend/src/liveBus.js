// In-process SSE fan-out: admin pages hold one GET /api/admin/events stream
// each, and the board sync broadcasts a tiny "something changed" ping so open
// pages refetch immediately instead of waiting for their 30s poll. Pings carry
// no ticket data — permissions stay enforced by the endpoints pages refetch.

const clients = new Set();

// 25s beat: under nginx's default 60s proxy_read_timeout and the Cloudflare
// tunnel's ~100s idle window, so proxies never reap a quiet stream.
const HEARTBEAT_MS = 25 * 1000;

function attach(res) {
  clients.add(res);
  const beat = setInterval(() => {
    try { res.write(':hb\n\n'); } catch { /* close handler cleans up */ }
  }, HEARTBEAT_MS);
  if (beat.unref) beat.unref();
  res.on('close', () => {
    clearInterval(beat);
    clients.delete(res);
  });
}

function broadcast(evt) {
  const frame = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

module.exports = { attach, broadcast };
