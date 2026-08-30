import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// These tests load and execute the REAL public/sw.js inside a service-worker-
// shaped sandbox. The pre-existing pwaOffline suite asserts against a mock
// written inside the test file, which is why it stayed green while the shipped
// worker precached development-only paths ('/src/main.js', '/public/...') that
// do not exist in a production build - cache.addAll() rejected on the first 404
// and silently discarded the entire shell.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW_PATH = path.join(ROOT, 'public', 'sw.js');

// ── Fake origin server ───────────────────────────────────────────────────────
// Mirrors what `vite build` actually emits: no /src, public/ flattened to root.
let SERVER;
let OFFLINE = false;
let fetchLog = [];

function fetchImpl(input) {
    const url = typeof input === 'string' ? input : input.url;
    fetchLog.push(url);
    if (OFFLINE) return Promise.reject(new TypeError('Failed to fetch'));
    const pathname = new URL(url, 'https://laserrave.test/').pathname;
    const body = SERVER[pathname];
    if (body === undefined) {
        return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }));
    }
    return Promise.resolve(new Response(body, { status: 200 }));
}

/** Minimal CacheStorage/Cache implementation keyed by request URL. */
class FakeCache {
    constructor() { this.store = new Map(); }
    _key(req) {
        const raw = typeof req === 'string' ? req : req.url;
        return new URL(raw, 'https://laserrave.test/').href;
    }
    async put(req, res) { this.store.set(this._key(req), res); }
    async match(req) { return this.store.get(this._key(req)) || undefined; }
    async addAll(urls) {
        // Real semantics: all-or-nothing. One rejection discards everything.
        const responses = await Promise.all(urls.map(u => fetchImpl(new URL(u, 'https://laserrave.test/').href)));
        if (responses.some(r => !r.ok)) throw new TypeError('Request failed');
        urls.forEach((u, i) => this.store.set(this._key(u), responses[i]));
    }
    async keys() { return [...this.store.keys()]; }
}

class FakeCacheStorage {
    constructor() { this.cacheMap = new Map(); }
    async open(name) {
        if (!this.cacheMap.has(name)) this.cacheMap.set(name, new FakeCache());
        return this.cacheMap.get(name);
    }
    async keys() { return [...this.cacheMap.keys()]; }
    async delete(name) { return this.cacheMap.delete(name); }
    async match(req) {
        for (const c of this.cacheMap.values()) {
            const hit = await c.match(req);
            if (hit) return hit;
        }
        return undefined;
    }
}

function loadServiceWorker() {
    const code = readFileSync(SW_PATH, 'utf8');
    const listeners = {};
    const cacheStorage = new FakeCacheStorage();
    // In a real worker, relative URLs resolve against the worker's scope. Undici's
    // Request throws on them, so wrap it to reproduce the browser behaviour.
    const ScopedRequest = new Proxy(Request, {
        construct(target, args) {
            const [input, init] = args;
            if (typeof input === 'string') {
                return new target(new URL(input, 'https://laserrave.test/sw.js').href, init);
            }
            return new target(input, init);
        }
    });
    const sandbox = {
        caches: cacheStorage,
        fetch: fetchImpl,
        Response, Request: ScopedRequest, Headers, URL, TypeError, Promise, Map, Set, JSON, Error,
        console: { warn() {}, log() {}, error() {} },
        setTimeout, clearTimeout
    };
    sandbox.self = {
        addEventListener: (type, fn) => {
            if (!listeners[type]) listeners[type] = [];
            listeners[type].push(fn);
        },
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
        location: new URL('https://laserrave.test/sw.js'),
        caches: cacheStorage,
        registration: {}
    };
    sandbox.location = sandbox.self.location;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'sw.js' });

    /** Fires one event and awaits everything passed to waitUntil()/respondWith(). */
    async function dispatch(type, extra) {
        const pending = [];
        let responsePromise;
        let responded = false;
        const event = Object.assign({
            type,
            waitUntil: (p) => { pending.push(p); },
            respondWith: (p) => { responded = true; responsePromise = p; }
        }, extra || {});
        for (const fn of (listeners[type] || [])) await fn(event);
        await Promise.all(pending);
        return responded ? await responsePromise : undefined;
    }

    return { dispatch, cacheStorage };
}

/**
 * Builds a request stand-in. `mode: 'navigate'` cannot be constructed through
 * undici's Request, so navigations use a plain object carrying the fields the
 * worker actually reads (url / method / mode / headers).
 */
function req(url, init) {
    const opts = init || {};
    const href = new URL(url, 'https://laserrave.test/').href;
    if (opts.mode || opts.headers) {
        return {
            url: href,
            method: opts.method || 'GET',
            mode: opts.mode || 'no-cors',
            headers: new Headers(opts.headers || {})
        };
    }
    return new Request(href, opts);
}

describe('Service Worker (real public/sw.js)', () => {
    beforeEach(() => {
        OFFLINE = false;
        fetchLog = [];
        SERVER = {
            '/': '<!doctype html><title>LaserRave</title>',
            '/index.html': '<!doctype html><title>LaserRave</title>',
            '/manifest.json': '{"name":"LaserRave"}',
            '/favicon.svg': '<svg/>',
            '/icons/icon-192.png': 'PNG192',
            '/icons/icon-512.png': 'PNG512',
            '/assets/index-abc123.js': 'console.log(1)',
            '/assets/index-abc123.css': 'body{}'
        };
    });

    test('sw.js exists and references no development-only paths', () => {
        assert.ok(existsSync(SW_PATH), 'public/sw.js must exist');
        const code = readFileSync(SW_PATH, 'utf8');
        assert.ok(!/["'`]\.?\/src\//.test(code),
            'must not precache /src/* - those paths do not exist in a production build');
        assert.ok(!/["'`]\.?\/public\//.test(code),
            'must not precache /public/* - Vite flattens public/ to the site root');
    });

    test('install precaches the app shell against production paths', async () => {
        const { dispatch, cacheStorage } = loadServiceWorker();
        await dispatch('install');

        assert.ok(await cacheStorage.match(req('/index.html')), 'index.html must be precached');
        assert.ok(await cacheStorage.match(req('/icons/icon-192.png')), 'the PWA icons must be precached');
    });

    test('one missing shell asset does not discard the rest of the precache', async () => {
        delete SERVER['/favicon.svg'];             // simulate a renamed/absent asset
        const { dispatch, cacheStorage } = loadServiceWorker();
        await dispatch('install');

        assert.ok(await cacheStorage.match(req('/index.html')),
            'a single 404 must not wipe the whole shell (cache.addAll is all-or-nothing)');
        assert.ok(await cacheStorage.match(req('/icons/icon-512.png')));
    });

    test('navigation is network-first so a new deploy is picked up immediately', async () => {
        const { dispatch } = loadServiceWorker();
        await dispatch('install');

        SERVER['/index.html'] = '<!doctype html><title>LaserRave v2</title>';
        const res = await dispatch('fetch', { request: req('/index.html', { mode: 'navigate' }) });
        assert.equal(await res.text(), '<!doctype html><title>LaserRave v2</title>',
            'a navigation must serve the fresh network response, not the cached one');
    });

    test('navigation falls back to the cached shell when offline', async () => {
        const { dispatch } = loadServiceWorker();
        await dispatch('install');

        OFFLINE = true;
        const res = await dispatch('fetch', { request: req('/index.html', { mode: 'navigate' }) });
        assert.ok(res, 'offline navigation must still resolve');
        assert.equal(res.status, 200, 'must serve the precached shell, not a 503');
        assert.match(await res.text(), /LaserRave/);
    });

    test('hashed build assets are served cache-first and survive going offline', async () => {
        const { dispatch } = loadServiceWorker();
        await dispatch('install');

        const first = await dispatch('fetch', { request: req('/assets/index-abc123.js') });
        assert.equal(await first.text(), 'console.log(1)');

        OFFLINE = true;
        const second = await dispatch('fetch', { request: req('/assets/index-abc123.js') });
        assert.equal(await second.text(), 'console.log(1)',
            'content-hashed assets must be replayable from cache while offline');
    });

    test('non-GET and range requests are passed straight through', async () => {
        const { dispatch } = loadServiceWorker();
        await dispatch('install');

        assert.equal(await dispatch('fetch', { request: req('/index.html', { method: 'POST' }) }),
            undefined, 'POST must not be intercepted');
        assert.equal(
            await dispatch('fetch', { request: req('/song.mp3', { headers: { range: 'bytes=0-99' } }) }),
            undefined, 'range requests must bypass the cache or media seeking breaks');
    });

    test('cross-origin requests are not intercepted', async () => {
        const { dispatch } = loadServiceWorker();
        await dispatch('install');
        const res = await dispatch('fetch', { request: new Request('https://cdn.example.com/lib.js') });
        assert.equal(res, undefined, 'third-party requests must go direct');
    });

    test('activate purges caches from previous versions only', async () => {
        const { dispatch, cacheStorage } = loadServiceWorker();
        const stale = await cacheStorage.open('laserrave-pwa-v1.0.0');
        await stale.put('/old', new Response('old'));
        const foreign = await cacheStorage.open('some-other-app-cache');
        await foreign.put('/keep', new Response('keep'));

        await dispatch('install');
        await dispatch('activate');

        const names = await cacheStorage.keys();
        assert.ok(!names.includes('laserrave-pwa-v1.0.0'), 'stale LaserRave caches must be deleted');
        assert.ok(names.includes('some-other-app-cache'), 'caches owned by other apps must be left alone');
    });
});

describe('Web App Manifest (real public/manifest.json)', () => {
    test('manifest is installable and its icons exist on disk', () => {
        const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8'));
        for (const field of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'icons']) {
            assert.ok(manifest[field] !== undefined, `manifest.${field} is required for installability`);
        }
        assert.equal(manifest.display, 'standalone');

        const sizes = manifest.icons.map(i => i.sizes);
        assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));

        for (const icon of manifest.icons) {
            const onDisk = path.join(ROOT, 'public', icon.src.replace(/^\//, ''));
            assert.ok(existsSync(onDisk), `declared icon is missing on disk: ${icon.src}`);
        }
    });
});
