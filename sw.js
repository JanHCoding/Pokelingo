// Offline-Unterstützung: App-Dateien vorab cachen, Bilder beim ersten Laden cachen.
const VERSION = 'pokelingo-v1';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'data/pokemon.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'pokelingo-img').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/img/')) {
    // Bilder ändern sich nie: Cache zuerst
    e.respondWith(caches.open('pokelingo-img').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // App-Dateien: Netzwerk zuerst (Updates), sonst Cache
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
