const CACHE_NAME = 'lemoncoords-v15.22-fullscreen-controls';
const RUNTIME_CACHE = 'lemoncoords-runtime-v2';
const MAP_CACHE = 'lemoncoords-map-v2';
const MAX_MAP_ENTRIES = 2100;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const MAP_HOSTS = new Set([
  'tiles.openfreemap.org',
  'tiles.openstreetmap.us',
  'server.arcgisonline.com',
  'apps.fs.usda.gov',
  'tiles.arcgis.com'
]);
const STATIC_HOSTS = new Set([
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('lemoncoords-v') && k !== CACHE_NAME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheableFetch(request){
  try{
    const response = await fetch(request);
    if(response.ok || response.type === 'opaque') return response;
  }catch{}
  return null;
}

async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary:true });
  if(cached) return cached;
  const response = await cacheableFetch(request);
  if(response){
    await cache.put(request, response.clone());
    return response;
  }
  return Response.error();
}

async function staleWhileRevalidate(request, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary:true });
  const fresh = cacheableFetch(request).then(async response => {
    if(response) await cache.put(request, response.clone());
    return response;
  });
  return cached || (await fresh) || Response.error();
}

async function trimMapCache(){
  const cache = await caches.open(MAP_CACHE);
  const keys = await cache.keys();
  const over = keys.length - MAX_MAP_ENTRIES;
  if(over > 0) await Promise.all(keys.slice(0, over).map(key => cache.delete(key)));
}

function prefetchRequest(url){
  const u = new URL(url);
  const init = { credentials:'omit', cache:'no-store' };
  if(u.hostname === 'server.arcgisonline.com' || u.hostname === 'apps.fs.usda.gov' || u.hostname === 'tiles.arcgis.com' || STATIC_HOSTS.has(u.hostname)) init.mode = 'no-cors';
  return new Request(u.href, init);
}

async function prefetchUrls(urls){
  const unique = [...new Set((urls || []).filter(u => typeof u === 'string'))].slice(0, 860);
  const mapCache = await caches.open(MAP_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  /* Keep concurrency modest so opening a trip never fights the visible map. */
  const workers = Array.from({ length:4 }, async (_, workerIndex) => {
    for(let i = workerIndex; i < unique.length; i += 4){
      const url = unique[i];
      try{
        const req = prefetchRequest(url);
        const target = MAP_HOSTS.has(new URL(url).hostname) ? mapCache : runtimeCache;
        if(await target.match(req, { ignoreVary:true })) continue;
        const response = await cacheableFetch(req);
        if(response) await target.put(req, response.clone());
      }catch{}
    }
  });
  await Promise.all(workers);
  await trimMapCache();
}

self.addEventListener('message', event => {
  if(event.data?.type === 'PREFETCH_URLS'){
    event.waitUntil(prefetchUrls(event.data.urls));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if(request.method !== 'GET') return;

  /* Never cache live geocoder/API answers. */
  if(url.hostname === 'nominatim.openstreetmap.org' ||
     url.hostname === 'photon.komoot.io' ||
     url.hostname === 'geocoding.geo.census.gov' ||
     url.hostname === 'go.lemoncoords.com') return;

  if(MAP_HOSTS.has(url.hostname)){
    event.respondWith(cacheFirst(request, MAP_CACHE));
    return;
  }
  if(STATIC_HOSTS.has(url.hostname)){
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  if(url.origin !== self.location.origin) return;

  /* Navigations stay network-first so deployments land immediately, with the
     cached app shell as the offline fallback. Trip data lives in the URL hash. */
  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }))
  );
});
