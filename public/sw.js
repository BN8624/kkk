// 한 줄 목적: 앱 셸과 정적 자산을 캐시해 설치 후 오프라인 실행과 사용자 승인 업데이트를 제공한다
const CACHE_NAME = 'three-crowns-shell-v2.2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
];
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest']);

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const rootUrl = new URL('./', self.registration.scope);
  const response = await fetch(rootUrl, { cache: 'reload' });
  if (!response.ok) throw new Error(`shell ${response.status}`);
  await cache.put(rootUrl, response.clone());
  const html = await response.text();
  const linked = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const urls = [...new Set([...APP_SHELL, ...linked].map((path) => new URL(path, rootUrl).href))];
  await Promise.all(urls.map(async (url) => {
    const asset = await fetch(url, { cache: 'reload' });
    if (asset.ok && asset.type === 'basic') await cache.put(url, asset);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('three-crowns-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scopeUrl = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok && response.type === 'basic') {
            await (await caches.open(CACHE_NAME)).put(scopeUrl, response.clone());
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ??
          (await caches.match(new URL('./', self.registration.scope))) ??
          Response.error(),
        ),
    );
    return;
  }

  if (url.search || !CACHEABLE_DESTINATIONS.has(request.destination)) return;

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then(async (response) => {
      if (response.ok && response.type === 'basic') {
        await (await caches.open(CACHE_NAME)).put(request, response.clone());
      }
      return response;
    })),
  );
});
