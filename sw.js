/* Service Worker — 壳子缓存 + 模型懒缓存
 * 策略：
 *   - 静态壳子（html/css/js/manifest/icons）：stale-while-revalidate
 *   - ONNX 模型（来自 jsDelivr）：cache-first（首次后秒开）
 *   - 其他：网络优先
 */

const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const MODEL_CACHE = `model-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const MODEL_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'esm.sh'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== MODEL_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 模型文件：cache-first（大文件，命中即秒开）
  if (MODEL_HOSTS.includes(url.hostname) && /\.(onnx|wasm)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(MODEL_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return new Response('', { status: 504, statusText: 'offline' });
        }
      })
    );
    return;
  }

  // 同源静态：stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
    return;
  }

  // 其他：透传
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});