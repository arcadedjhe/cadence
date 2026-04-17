const CACHE_NAME = 'cadence-v3';
const BASE = '/cadence/';
const INDEX = BASE + 'index.html';

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([INDEX, BASE + 'manifest.json']))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Laisse passer Google APIs sans interception
  if (url.includes('googleapis.com') || url.includes('accounts.google.com') || url.includes('unpkg.com') || url.includes('fonts.g')) return;

  // Requêtes de NAVIGATION (ouverture de l'app) → toujours réseau d'abord, fallback cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(INDEX)
        .catch(() => caches.match(INDEX))
    );
    return;
  }

  // Autres ressources → cache d'abord, puis réseau
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(INDEX));
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
      icon: BASE + 'icon-192.png',
      tag: 'practice-reminder',
      renotify: true,
      vibrate: [200, 100, 200],
    });
    scheduleNext(hour, minute);
  }, delay);
}

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SCHEDULE_NOTIF') {
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
      return clients.openWindow(INDEX);
    })
  );
});
