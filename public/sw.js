/**
 * LaserRave service worker.
 *
 * Strategy per request class:
 *   navigation      → network-first, fall back to the cached shell (so a deploy is
 *                     picked up immediately instead of one visit late)
 *   /assets/<hash>  → cache-first (content-hashed by Vite, therefore immutable)
 *   other same-origin → stale-while-revalidate
 *   cross-origin / non-GET / range → passed straight through
 */
const VERSION = 'v2';
const SHELL_CACHE   = `laserrave-shell-${VERSION}`;
const RUNTIME_CACHE = `laserrave-runtime-${VERSION}`;
const CACHE_NAMES = [SHELL_CACHE, RUNTIME_CACHE];

// Only paths that exist in BOTH the dev server and the production build.
// The hashed JS/CSS bundles are picked up by the runtime cache on first visit —
// listing them here is impossible because their names change every build.
const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './favicon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// A single 404 makes cache.addAll() reject and discard *everything*, so each entry
// is cached on its own and a missing one only loses that entry.
async function precacheIndividually(cache, urls) {
    await Promise.all(urls.map(async (url) => {
        try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res && res.ok) await cache.put(url, res);
            else console.warn('[SW] Skipped precache (bad status):', url, res && res.status);
        } catch (err) {
            console.warn('[SW] Skipped precache (fetch failed):', url, err);
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await precacheIndividually(cache, SHELL_ASSETS);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => k.startsWith('laserrave-') && !CACHE_NAMES.includes(k))
                .map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

/** Lets the page trigger an immediate update instead of waiting for a reload. */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isImmutableAsset(url) {
    // Vite emits /assets/<name>-<hash>.<ext>; the hash changes when the content does.
    return url.pathname.startsWith('/assets/');
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res && res.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, res.clone());
    }
    return res;
}

async function networkFirstNavigation(request) {
    try {
        const res = await fetch(request);
        if (res && res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('./index.html', res.clone());
        }
        return res;
    } catch (err) {
        return (await caches.match('./index.html'))
            || (await caches.match('./'))
            || new Response('<h1>Offline</h1><p>LaserRave is not cached yet.</p>', {
                status: 503,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
    }
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (res) => {
        if (res && res.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            // res is consumed by the caller when there is no cache hit, so clone first.
            await cache.put(request, res.clone());
        }
        return res;
    }).catch(() => null);

    if (cached) return cached;
    const res = await network;
    if (res) return res;
    return new Response('Offline: content not available in cache.', {
        status: 503, statusText: 'Service Unavailable'
    });
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    // Range requests (audio/video seeking) must not be served from the cache —
    // a cached 200 in response to a Range request breaks media playback.
    if (request.headers.has('range')) return;

    let url;
    try { url = new URL(request.url); } catch { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== self.location.origin) return;          // let PeerJS/CDNs go direct
    if (url.pathname.includes('/peerjs')) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
    } else if (isImmutableAsset(url)) {
        event.respondWith(cacheFirst(request));
    } else {
        event.respondWith(staleWhileRevalidate(request));
    }
});
