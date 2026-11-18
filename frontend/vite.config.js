import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function offlineServiceWorker() {
  return {
    name: 'salesmesh-offline-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((file) => /\.(?:js|css|svg|woff2?|ttf|png|jpe?g|webp|ico)$/i.test(file));
      const precache = ['/', '/index.html', '/favicon.svg', ...assets.map((file) => `/${file}`)];
      const version = createHash('sha256').update(assets.join('|')).digest('hex').slice(0, 12);
      const source = `
const CACHE_NAME = 'salesmesh-shell-${version}';
const CACHE_PREFIX = 'salesmesh-shell-';
const PRECACHE_URLS = ${JSON.stringify([...new Set(precache)])};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            return caches.open(CACHE_NAME)
              .then((cache) => cache.put('/index.html', response.clone()))
              .then(() => response, () => response);
          }
          return response;
        })
        .catch(async () => (await caches.match('/index.html')) || Response.error())
    );
    return;
  }

  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'font' || request.destination === 'image' || PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.match(url.href, { ignoreVary: true }).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()))
            .then(() => response, () => response);
        });
      })
    );
  }
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
