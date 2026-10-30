/* Flâneur — garde l'appli disponible même avec une connexion faible.
   Fichiers de l'appli : réseau d'abord, copie locale en secours.
   Fonds de carte déjà vus : copie locale d'abord (pratique sans réseau). */
const APP = 'flaneur-app-v1';
const TILES = 'flaneur-tiles-v1';
const SHELL = ['./', 'index.html', 'style.css', 'js/planner.js', 'js/services.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let puts = 0;
async function trim() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - 3000; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tiles.openfreemap.org') {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); if (++puts % 200 === 0) trim(); }
      return res;
    }));
    return;
  }
  const isShell = url.origin === location.origin || url.hostname === 'unpkg.com' || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com';
  if (!isShell) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
