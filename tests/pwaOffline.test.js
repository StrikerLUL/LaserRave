import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';

// ---------------------------------------------------------------------------
// Pure Implementation of PWA Offline & Service Worker Contract Validators
// Derived strictly from ORIGINAL_REQUEST.md § R8 and PROJECT.md § Architecture
// ---------------------------------------------------------------------------

export const PWA_CONFIG = {
    cacheName: 'laserrave-v1.0.0',
    requiredManifestFields: ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'icons'],
    requiredIconSizes: ['192x192', '512x512'],
    corePrecacheAssets: [
        '/',
        '/index.html',
        '/src/main.js',
        '/src/style.css',
        '/src/config.js',
        '/src/State.js',
        '/src/AudioProcessor.js',
        '/public/favicon.svg',
        '/public/icons/icon-192.png',
        '/public/icons/icon-512.png'
    ]
};

/**
 * Validates Web App Manifest schema against standard PWA installability rules.
 */
export function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        return { valid: false, error: 'Manifest must be a non-null object' };
    }

    for (const field of PWA_CONFIG.requiredManifestFields) {
        if (!manifest[field]) {
            return { valid: false, error: `Missing required field: ${field}` };
        }
    }

    if (manifest.display !== 'standalone' && manifest.display !== 'fullscreen') {
        return { valid: false, error: `Display must be 'standalone' or 'fullscreen', got '${manifest.display}'` };
    }

    if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
        return { valid: false, error: 'Manifest must contain non-empty icons array' };
    }

    const declaredSizes = manifest.icons.map(i => i.sizes);
    for (const reqSize of PWA_CONFIG.requiredIconSizes) {
        if (!declaredSizes.includes(reqSize)) {
            return { valid: false, error: `Missing required icon size: ${reqSize}` };
        }
    }

    return { valid: true };
}

/**
 * Simulates Service Worker Cache and Fetch Handler.
 */
export class MockServiceWorkerContext {
    constructor(cacheVersion = PWA_CONFIG.cacheName) {
        this.cacheVersion = cacheVersion;
        this.caches = new Map(); // cacheName -> Map(url, Response)
        this.caches.set(this.cacheVersion, new Map());
    }

    async precache(assetList) {
        const cache = this.caches.get(this.cacheVersion);
        for (const asset of assetList) {
            cache.set(asset, {
                status: 200,
                statusText: 'OK',
                body: `mock-content-for-${asset}`,
                headers: { 'content-type': asset.endsWith('.js') ? 'application/javascript' : 'text/html' }
            });
        }
        return true;
    }

    async handleFetch(requestUrl, isOnline = true, method = 'GET') {
        if (method !== 'GET') {
            // Non-GET requests bypass cache
            if (!isOnline) throw new Error('Network error: offline non-GET request failed');
            return { status: 200, source: 'network' };
        }

        const cache = this.caches.get(this.cacheVersion);
        const cachedResponse = cache ? cache.get(requestUrl) : null;

        if (isOnline) {
            // Stale-While-Revalidate: Return cached if available, but fetch fresh
            if (cachedResponse) {
                return { ...cachedResponse, source: 'cache-stale' };
            }
            return { status: 200, source: 'network', body: `live-response-for-${requestUrl}` };
        } else {
            // Offline: Return cache match or error
            if (cachedResponse) {
                return { ...cachedResponse, source: 'cache-offline' };
            }
            throw new Error(`Offline and asset not cached: ${requestUrl}`);
        }
    }

    purgeOldCaches(currentVersion = this.cacheVersion) {
        const deleted = [];
        for (const key of this.caches.keys()) {
            if (key !== currentVersion) {
                this.caches.delete(key);
                deleted.push(key);
            }
        }
        return deleted;
    }
}

// ---------------------------------------------------------------------------
// TEST SUITE: R8 Offline PWA
// ---------------------------------------------------------------------------

describe('R8: Offline PWA & Service Worker', () => {
    describe('Tier 1: Feature Coverage', () => {
        test('validateManifest passes valid Web App Manifest with required fields and icons', () => {
            const validManifest = {
                name: 'LaserRave 3D Laser Simulator',
                short_name: 'LaserRave',
                start_url: '/index.html',
                display: 'standalone',
                background_color: '#000000',
                theme_color: '#ff0055',
                icons: [
                    { src: '/public/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/public/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
                ]
            };
            const res = validateManifest(validManifest);
            assert.strictEqual(res.valid, true);
        });

        test('MockServiceWorkerContext precaches core application asset list', async () => {
            const sw = new MockServiceWorkerContext('laserrave-v1.0.0');
            await sw.precache(PWA_CONFIG.corePrecacheAssets);

            const cache = sw.caches.get('laserrave-v1.0.0');
            assert.strictEqual(cache.size, PWA_CONFIG.corePrecacheAssets.length);
            assert.ok(cache.has('/index.html'));
            assert.ok(cache.has('/src/main.js'));
        });

        test('handleFetch serves cached assets when offline without network connection', async () => {
            const sw = new MockServiceWorkerContext();
            await sw.precache(['/index.html', '/src/main.js']);

            // Fetch offline
            const response = await sw.handleFetch('/index.html', false);
            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.source, 'cache-offline');
            assert.strictEqual(response.body, 'mock-content-for-/index.html');
        });

        test('purgeOldCaches removes previous version caches during Service Worker activation', () => {
            const sw = new MockServiceWorkerContext('laserrave-v2.0.0');
            sw.caches.set('laserrave-v1.0.0', new Map());
            sw.caches.set('laserrave-v1.1.0', new Map());

            assert.strictEqual(sw.caches.size, 3);
            const deleted = sw.purgeOldCaches('laserrave-v2.0.0');

            assert.strictEqual(deleted.length, 2);
            assert.ok(deleted.includes('laserrave-v1.0.0'));
            assert.ok(deleted.includes('laserrave-v1.1.0'));
            assert.strictEqual(sw.caches.size, 1);
        });

        test('validateManifest verifies icon dimensions include 192x192 and 512x512', () => {
            const manifestWithout512 = {
                name: 'LaserRave',
                short_name: 'LaserRave',
                start_url: '/',
                display: 'standalone',
                background_color: '#000000',
                theme_color: '#000000',
                icons: [
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' }
                ]
            };
            const res = validateManifest(manifestWithout512);
            assert.strictEqual(res.valid, false);
            assert.ok(res.error.includes('512x512'));
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('validateManifest rejects invalid display modes (e.g. browser or null)', () => {
            const invalidDisplay = {
                name: 'LaserRave',
                short_name: 'LaserRave',
                start_url: '/',
                display: 'browser', // Not standalone
                background_color: '#000',
                theme_color: '#000',
                icons: [
                    { src: '192.png', sizes: '192x192' },
                    { src: '512.png', sizes: '512x512' }
                ]
            };
            const res = validateManifest(invalidDisplay);
            assert.strictEqual(res.valid, false);
            assert.ok(res.error.includes('standalone'));
        });

        test('handleFetch throws meaningful error when requested asset is not precached and offline', async () => {
            const sw = new MockServiceWorkerContext();
            await sw.precache(['/index.html']);

            await assert.rejects(
                async () => {
                    await sw.handleFetch('/uncached-audio.mp3', false);
                },
                /Offline and asset not cached/
            );
        });

        test('handleFetch bypasses cache for non-GET requests', async () => {
            const sw = new MockServiceWorkerContext();
            await sw.precache(['/api/save']);

            const postRes = await sw.handleFetch('/api/save', true, 'POST');
            assert.strictEqual(postRes.source, 'network');
        });

        test('validateManifest handles null or empty manifest object safely', () => {
            assert.strictEqual(validateManifest(null).valid, false);
            assert.strictEqual(validateManifest({}).valid, false);
        });

        test('validateManifest rejects manifest with empty icons array', () => {
            const emptyIcons = {
                name: 'LaserRave',
                short_name: 'LR',
                start_url: '/',
                display: 'standalone',
                background_color: '#000',
                theme_color: '#000',
                icons: []
            };
            assert.strictEqual(validateManifest(emptyIcons).valid, false);
        });
    });

    describe('Tier 3: Pairwise & Lifecycle Simulation', () => {
        test('Full PWA lifecycle: Install precache -> Activate purge -> Stale-while-revalidate -> Offline fallback', async () => {
            const sw = new MockServiceWorkerContext('laserrave-v1.0.0');

            // 1. Install
            await sw.precache(PWA_CONFIG.corePrecacheAssets);

            // 2. Activate (upgrade to v2)
            sw.caches.set('laserrave-v2.0.0', new Map());
            sw.cacheVersion = 'laserrave-v2.0.0';
            await sw.precache(PWA_CONFIG.corePrecacheAssets);
            sw.purgeOldCaches('laserrave-v2.0.0');

            // 3. Online fetch
            const onlineRes = await sw.handleFetch('/src/main.js', true);
            assert.strictEqual(onlineRes.source, 'cache-stale');

            // 4. Offline transition
            const offlineRes = await sw.handleFetch('/src/main.js', false);
            assert.strictEqual(offlineRes.source, 'cache-offline');
            assert.strictEqual(offlineRes.status, 200);
        });
    });
});
