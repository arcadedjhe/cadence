const CACHE_NAME = 'cadence-v5';
const BASE = '/cadence/';
const INDEX = BASE + 'index.html';

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([INDEX, BASE + 'manifest.json'])
        // Fichiers du métronome : mis en cache s'ils existent (leur absence ne doit pas bloquer l'installation)
        .then(() => Promise.all([BASE + 'metronome.jsx', BASE + 'metronome.css'].map(u => cache.add(u).catch(() => {})))))
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
  if (url.includes('googleapis.com') || url.includes('accounts.google.com') || url.includes('unpkg.com') || url.includes('fonts.g')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(INDEX).catch(() => caches.match(INDEX)));
    return;
  }
  // Fichiers du métronome : réseau d'abord (une mise à jour sur GitHub est vue tout de suite), cache en secours hors connexion
  if (/\/metronome\.(jsx|css)(\?|$)/.test(url)) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
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

// ─── DAILY REMINDER ───────────────────────────────────────────────────────────
let reminderTimer = null;

function scheduleReminder(hour, minute) {
  if (reminderTimer) clearTimeout(reminderTimer);
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  reminderTimer = setTimeout(() => {
    self.registration.showNotification('Cadence 🎵', {
      body: "Ta session de pratique t'attend !",
      icon: BASE + 'icon-192.png',
      tag: 'practice-reminder',
      renotify: true,
      vibrate: [200, 100, 200],
    });
    scheduleReminder(hour, minute);
  }, delay);
}

// ─── TIMER NOTIFICATION ───────────────────────────────────────────────────────
let timerTimeout = null;

function scheduleTimerNotif(delayMs, label) {
  if (timerTimeout) clearTimeout(timerTimeout);
  timerTimeout = setTimeout(() => {
    self.registration.showNotification('⏱ ' + label, {
      body: 'Temps écoulé — passe au bloc suivant !',
      icon: BASE + 'icon-192.png',
      tag: 'timer-done',
      renotify: true,
      requireInteraction: true,  // stays on screen until dismissed
      vibrate: [500, 200, 500, 200, 500],
      silent: false,
      actions: [
        { action: 'open', title: '▶ Ouvrir Cadence' }
      ],
      data: { url: BASE + 'index.html' }
    });
    timerTimeout = null;
  }, delayMs);
}

self.addEventListener('message', (e) => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_NOTIF') {
    if (e.data.enabled) scheduleReminder(e.data.hour, e.data.minute);
    else if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
  }

  if (e.data.type === 'TIMER_NOTIF') {
    scheduleTimerNotif(e.data.delayMs, e.data.label || 'Bloc terminé');
  }

  if (e.data.type === 'TIMER_CANCEL') {
    if (timerTimeout) { clearTimeout(timerTimeout); timerTimeout = null; }
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
