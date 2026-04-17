const CACHE_NAME = 'cadence-v2';
const BASE = '/cadence/';

const ASSETS = [
  BASE + 'index.html',
  BASE + 'manifest.json',
];

// ─── INSTALL — ne plante pas si un asset manque ───────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll individuel pour ne pas tout faire échouer si un fichier manque
      return Promise.allSettled(ASSETS.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (url.includes('googleapis.com') || url.includes('accounts.google.com') || url.includes('unpkg.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(BASE + 'index.html'));
    })
  );
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
let notifTimer = null;

function scheduleNext(hour, minute) {
  if (notifTimer) clearTimeout(notifTimer);
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();

  notifTimer = setTimeout(() => {
    self.registration.showNotification('Cadence 🎵', {
      body: "Ta session de pratique t'attend !",
      icon: BASE + 'icon-192.svg',
      tag: 'practice-reminder',
      renotify: true,
      vibrate: [200, 100, 200],
    });
    scheduleNext(hour, minute);
  }, delay);
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SCHEDULE_NOTIF') {
    if (e.data.enabled) scheduleNext(e.data.hour, e.data.minute);
    else if (notifTimer) { clearTimeout(notifTimer); notifTimer = null; }
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const c = cs.find(c => c.url.includes('/cadence/'));
      if (c) return c.focus();
      return clients.openWindow(BASE + 'index.html');
    })
  );
});
