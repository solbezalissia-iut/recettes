// ────────────────────────────────────────────────────────────────────────
// sw.js — rend le site plus rapide et utilisable sans réseau (cuisine, cave…).
// • Pages, scripts et styles : réseau d'abord (toujours la dernière version),
//   copie gardée pour le hors-ligne.
// • Photos, icônes, décors : gardés en mémoire après la première visite.
// • Firebase / Google : jamais mis en cache (connexion, recettes en ligne).
// ────────────────────────────────────────────────────────────────────────
const CACHE = 'recettes-v2';
const PHOTOS = 'recettes-photos-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'index.html'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== PHOTOS).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase, Google, CDN : on ne touche à rien
  const isMedia = /\/(photos|icons|deco|models)\//.test(url.pathname) || /\.(webp|png|jpe?g|svg|onnx)$/i.test(url.pathname);
  if (isMedia) {
    e.respondWith(caches.open(PHOTOS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
