// Service worker: cache the app shell for offline / home-screen launch.
// Bump CACHE when any cached asset changes so clients pick up the new version.
const CACHE = 'universe-sandbox-v3';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './js/data.js',
  './js/physics.js',
  './vendor/three.module.js',
  './vendor/OrbitControls.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      // Store only successful same-origin responses: caching a 404/500 or an opaque
      // cross-origin reply would pin the failure until the next CACHE bump.
      if (resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return resp;
    }).catch((err) => {
      // The app shell is a meaningful fallback only for page navigations;
      // for scripts/images it would hand back HTML and hide the real failure.
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      throw err;
    })),
  );
});
