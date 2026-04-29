/**
 * Hermes WebUI Service Worker
 * Minimal PWA service worker — enables "Add to Home Screen".
 * No offline caching of API responses (the UI requires a live backend).
 * Caches static shell assets as an offline fallback while preferring fresh
 * network responses so deploys do not leave users on stale JavaScript.
 */

// Cache version is injected by the server at request time (routes.py /sw.js handler).
// Bumps automatically whenever the git commit changes — no manual edits needed.
const CACHE_NAME = 'hermes-shell-__CACHE_VERSION__';

// Static assets that form the app shell
const SHELL_ASSETS = [
  './',
  './static/style.css',
  './static/boot.js',
  './static/ui.js',
  './static/messages.js',
  './static/sessions.js',
  './static/panels.js',
  './static/commands.js',
  './static/icons.js',
  './static/i18n.js',
  './static/workspace.js',
  './static/terminal.js',
  './static/onboarding.js',
  './static/favicon.svg',
  './static/favicon-32.png',
  './manifest.json',
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        // Non-fatal: if any asset fails, still activate
        console.warn('[sw] Shell pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function cacheFallback(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    const url = new URL(request.url);
    url.search = '';
    return caches.match(url.href);
  });
}

function cacheResponse(request, response) {
  if (
    request.method === 'GET' &&
    response &&
    response.status === 200
  ) {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
  }
  return response;
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => cacheResponse(request, response))
    .catch(() => cacheFallback(request));
}

// Fetch strategy:
// - API calls (/api/*, /stream) → always network (never cache)
// - Navigations and shell assets → network-first, cached fallback
// - Everything else → network-first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin requests
  if (url.origin !== self.location.origin) return;

  // API and streaming endpoints — always go to network
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/stream') ||
    url.pathname.startsWith('/health')
  ) {
    return; // let browser handle normally
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      networkFirst(event.request).then((response) => response || caches.match('./').then((cached) => cached || new Response(
        '<html><body style="font-family:sans-serif;padding:2rem;background:#1a1a1a;color:#ccc">' +
        '<h2>You are offline</h2>' +
        '<p>Hermes requires a server connection. Please check your network and try again.</p>' +
        '</body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      )))
    );
    return;
  }

  const isShellAsset = SHELL_ASSETS.some((asset) => {
    const assetUrl = new URL(asset, self.location.href);
    return assetUrl.pathname === url.pathname;
  });

  if (isShellAsset || url.pathname.startsWith('/static/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    networkFirst(event.request)
  );
});
