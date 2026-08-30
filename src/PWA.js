// ---------------------------------------------------------------------------
// PWA Offline & Service Worker Management Module
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
        '/icons/icon-192.png',
        '/icons/icon-512.png'
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
 * Registers Service Worker in browser if supported.
 */
export async function registerServiceWorker(swPath = '/sw.js') {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register(swPath, { scope: '/' });
            console.log('[PWA] Service Worker registered with scope:', registration.scope);
            return registration;
        } catch (err) {
            console.warn('[PWA] Service Worker registration failed:', err);
            return null;
        }
    }
    return null;
}
