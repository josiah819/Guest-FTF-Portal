// WoodsVoice service worker — push notifications ONLY.
//
// ⚠️ Never add a fetch handler here. This worker exists solely to receive
// pushes and open the inbox on click; intercepting requests would put a cache
// between the SPA, /api and /uploads and break deploys in ways that only clear
// when every browser drops the old worker.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { /* non-JSON push: show the fallback */ }
  e.waitUntil(self.registration.showNotification(d.title || 'WoodsVoice', {
    body: d.body || '',
    tag: d.tag || undefined,          // same ticket = one notification, updated
    data: { url: d.url || '/admin/submissions' },
    icon: '/brand/mw-logo-colour.png',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/admin/submissions';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.includes('/admin'));
    if (open) return open.focus().then((c) => (c && c.navigate ? c.navigate(url) : undefined));
    return self.clients.openWindow(url);
  }));
});
