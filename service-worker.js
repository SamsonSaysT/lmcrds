/* LemonCoords v15.26 — fast-map / no offline tile cache.
   This worker intentionally has no fetch handler: every map, imagery, trail,
   parcel, geocoder and app request goes directly to the network/browser cache.
   Activation only removes the aggressive Cache Storage entries used by older
   offline-map builds. */

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter(k => k.startsWith('lemoncoords-map-') ||
                     k.startsWith('lemoncoords-runtime-') ||
                     k.startsWith('lemoncoords-v'))
        .map(k => caches.delete(k)));
    } catch (_) {}
    await self.clients.claim();
  })());
});
