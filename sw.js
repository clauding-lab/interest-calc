const CACHE_NAME = 'incalc-v8';

// Same-origin app shell — must cache for offline to work at all.
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './appstore-badge-black.svg',
  './appstore-badge-white.svg'
];
// Cross-origin CDN assets — best-effort; a single unreachable CDN must not abort install.
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,400;0,600;1,300&family=DM+Sans:wght@300;400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // {cache:'reload'} dodges the HTTP cache so we precache fresh copies right after a deploy.
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await Promise.allSettled(CDN.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    // NOTE: no skipWaiting() here — a new worker waits until the user taps "Reload" in the
    // update toast (which posts 'skip-waiting'), so we never reload the page without consent.
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // Scope the purge to our own caches — the origin (clauding-lab.github.io) is shared with sibling apps.
    await Promise.all(keys.filter(k => k.startsWith('incalc-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks us to activate a freshly-installed worker immediately (user tapped "Reload").
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Navigations: network-first so a new deploy is seen on the FIRST visit; fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {            // never cache a 404/500 as the offline shell
          const cache = await caches.open(CACHE_NAME);
          cache.put('./', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('./')) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Static assets: cache-first, revalidate in the background, and re-cache any good (or opaque CDN) response
  // so a single cache eviction doesn't break charts/Excel offline permanently.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
