/**
 * src/PhotoMode.js
 * Photo Mode State Machine & Creative Filter Shaders Engine (R5)
 */

export const PHOTO_MODE_CONFIG = {
    freecam: {
        minFOV: 15.0,
        maxFOV: 120.0,
        defaultFOV: 60.0,
        minRollDeg: -45.0,
        maxRollDeg: 45.0
    },
    supportedFilters: ['raw', 'vhs', 'film', 'analog', 'neon', 'hologram'],
    exportPrefix: 'laserrave_photo_'
};

export const PHOTO_FILTERS = {
    raw: { id: 'raw', name: 'Raw Pristine', icon: '✨' },
    vhs: { id: 'vhs', name: 'VHS Retro', icon: '📼' },
    film: { id: 'film', name: '35mm Film Grain', icon: '🎞️' },
    analog: { id: 'analog', name: 'Analog Light Leak', icon: '📻' },
    neon: { id: 'neon', name: 'Cyber Neon', icon: '⚡' },
    hologram: { id: 'hologram', name: 'Sci-Fi Hologram', icon: '🌐' }
};

/**
 * State machine managing simulation pause and photo mode transitions.
 */
export class PhotoModeManager {
    constructor() {
        this.isActive = false;
        this.previousMode = 'live';
        this.audioSuspended = false;
        this.simulationFrozen = false;
        this.currentFilter = 'raw';
        this.freecam = {
            fov: PHOTO_MODE_CONFIG.freecam.defaultFOV,
            rollDeg: 0,
            focusDistance: 10.0,
            aperture: 0.0
        };
    }

    enter(mockAudioCtx = null) {
        if (this.isActive) return;
        this.isActive = true;
        this.simulationFrozen = true;
        if (mockAudioCtx && typeof mockAudioCtx.suspend === 'function') {
            mockAudioCtx.suspend();
            this.audioSuspended = true;
        }
    }

    exit(mockAudioCtx = null) {
        if (!this.isActive) return;
        this.isActive = false;
        this.simulationFrozen = false;
        if (mockAudioCtx && typeof mockAudioCtx.resume === 'function') {
            mockAudioCtx.resume();
            this.audioSuspended = false;
        }
    }

    setFilter(filterName) {
        const key = (filterName || '').toLowerCase().trim();
        if (PHOTO_MODE_CONFIG.supportedFilters.includes(key)) {
            this.currentFilter = key;
        } else {
            this.currentFilter = 'raw';
        }
    }

    setFreecamParameters({ fov, rollDeg, focusDistance, aperture }) {
        if (typeof fov === 'number') {
            this.freecam.fov = Math.max(PHOTO_MODE_CONFIG.freecam.minFOV, Math.min(PHOTO_MODE_CONFIG.freecam.maxFOV, fov));
        }
        if (typeof rollDeg === 'number') {
            this.freecam.rollDeg = Math.max(PHOTO_MODE_CONFIG.freecam.minRollDeg, Math.min(PHOTO_MODE_CONFIG.freecam.maxRollDeg, rollDeg));
        }
        if (typeof focusDistance === 'number' && focusDistance >= 0) {
            this.freecam.focusDistance = focusDistance;
        }
        if (typeof aperture === 'number' && aperture >= 0) {
            this.freecam.aperture = aperture;
        }
    }
}

/**
 * Clamps freecam parameters to valid ranges.
 */
export function clampFreecamParams(fov = 60, roll = 0) {
    return {
        fov: Math.max(PHOTO_MODE_CONFIG.freecam.minFOV, Math.min(PHOTO_MODE_CONFIG.freecam.maxFOV, fov)),
        rollDeg: Math.max(PHOTO_MODE_CONFIG.freecam.minRollDeg, Math.min(PHOTO_MODE_CONFIG.freecam.maxRollDeg, roll))
    };
}

/**
 * Returns parameter definitions for the 6 creative filters.
 */
export function getFilterShaderConfig(filterType) {
    const key = (filterType || '').toLowerCase().trim();
    switch (key) {
        case 'vhs':
            return {
                id: 'vhs',
                name: 'VHS Retro',
                chromaticAberrationPx: 4.5,
                scanlineFrequency: 320,
                scanlineIntensity: 0.25,
                noiseIntensity: 0.15,
                saturation: 1.1,
                contrast: 1.15,
                colorGrading: [1.0, 1.05, 0.95]
            };
        case 'film':
            return {
                id: 'film',
                name: '35mm Film Grain',
                chromaticAberrationPx: 0.0,
                scanlineFrequency: 0,
                noiseIntensity: 0.20,
                vignetteRadius: 0.75,
                vignetteDarkness: 0.40,
                saturation: 1.0,
                contrast: 1.08,
                colorGrading: [1.08, 1.04, 0.95] // Warm yellow shift
            };
        case 'analog':
            return {
                id: 'analog',
                name: 'Analog Light Leak',
                chromaticAberrationPx: 1.0,
                saturation: 0.65, // Desaturated
                contrast: 1.40, // High contrast
                lightLeakColor: [1.0, 0.55, 0.10], // Orange leak
                lightLeakIntensity: 0.35,
                colorGrading: [1.0, 0.95, 0.90]
            };
        case 'neon':
            return {
                id: 'neon',
                name: 'Cyber Neon',
                saturation: 3.0, // +200% saturation boost
                contrast: 1.50,
                crushBlacksThreshold: 0.10,
                colorBleedRadius: 8.0,
                colorGrading: [1.2, 1.1, 1.4]
            };
        case 'hologram':
            return {
                id: 'hologram',
                name: 'Sci-Fi Hologram',
                monochromeTint: [0.2, 1.5, 1.2], // Green/Cyan tint
                scanlineFrequency: 480,
                scanlineIntensity: 0.40,
                curvatureDistortion: 0.08, // Barrel CRT curvature
                noiseIntensity: 0.08,
                saturation: 0.8
            };
        case 'raw':
        default:
            return {
                id: 'raw',
                name: 'Raw Pristine',
                chromaticAberrationPx: 0.0,
                scanlineFrequency: 0,
                scanlineIntensity: 0.0,
                noiseIntensity: 0.0,
                vignetteRadius: 0.0,
                saturation: 1.0,
                contrast: 1.0,
                colorGrading: [1.0, 1.0, 1.0]
            };
    }
}

/**
 * Generates formatted PNG photo export filename.
 */
export function generatePhotoFilename(timestamp = Date.now()) {
    const ts = (typeof timestamp === 'number' && Number.isFinite(timestamp))
        ? timestamp
        : Date.now();
    return `${PHOTO_MODE_CONFIG.exportPrefix}${ts}.png`;
}

/**
 * Evaluates barrel distortion radial coordinates for Hologram filter.
 */
export function calculateHologramBarrelDistortion(normX, normY, k = 0.08) {
    const cx = normX - 0.5;
    const cy = normY - 0.5;
    const rSq = cx * cx + cy * cy;
    const distortedFactor = 1.0 + k * rSq;

    return {
        distortedX: cx * distortedFactor + 0.5,
        distortedY: cy * distortedFactor + 0.5
    };
}

/**
 * Applies Neon filter color transformation (saturation boost & black crush).
 */
export function applyNeonFilterTransform(r, g, b) {
    let red = r < 0.10 ? 0 : r;
    let green = g < 0.10 ? 0 : g;
    let blue = b < 0.10 ? 0 : b;

    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    red = luminance + (red - luminance) * 3.0;
    green = luminance + (green - luminance) * 3.0;
    blue = luminance + (blue - luminance) * 3.0;

    return {
        r: Math.max(0, Math.min(1, red)),
        g: Math.max(0, Math.min(1, green)),
        b: Math.max(0, Math.min(1, blue))
    };
}

/**
 * Applies pixel-level Canvas2D filter processing to an image/canvas source.
 * @param {HTMLCanvasElement|ImageBitmap} sourceCanvas
 * @param {string} filterType
 * @param {Object} options
 * @returns {HTMLCanvasElement}
 */
export function applyPhotoFilter(sourceCanvas, filterType = 'raw', options = {}) {
    if (!sourceCanvas) return null;
    const w = sourceCanvas.width || 1280;
    const h = sourceCanvas.height || 720;

    const outCanvas = options.destinationCanvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!outCanvas) return null;

    outCanvas.width = w;
    outCanvas.height = h;

    const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return outCanvas;

    ctx.drawImage(sourceCanvas, 0, 0, w, h);

    const filterKey = (filterType || 'raw').toLowerCase();
    if (filterKey === 'raw') {
        return outCanvas;
    }

    const cfg = getFilterShaderConfig(filterKey);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const totalPixels = w * h;

    if (filterKey === 'vhs') {
        // RGB Chromatic Aberration Shift + Horizontal Scanlines + Noise
        const shiftPx = Math.round(cfg.chromaticAberrationPx || 4);
        const copy = new Uint8ClampedArray(data);

        for (let y = 0; y < h; y++) {
            const isScanline = (y % 4 < 2);
            const scanDim = isScanline ? (1 - cfg.scanlineIntensity) : 1.0;

            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const redX = Math.min(w - 1, x + shiftPx);
                const blueX = Math.max(0, x - shiftPx);
                const redIdx = (y * w + redX) * 4;
                const blueIdx = (y * w + blueX) * 4;

                const noise = (Math.random() - 0.5) * 255 * (cfg.noiseIntensity || 0.12);

                data[idx]     = Math.max(0, Math.min(255, (copy[redIdx] + noise) * scanDim * cfg.colorGrading[0]));
                data[idx + 1] = Math.max(0, Math.min(255, (copy[idx + 1] + noise) * scanDim * cfg.colorGrading[1]));
                data[idx + 2] = Math.max(0, Math.min(255, (copy[blueIdx + 2] + noise) * scanDim * cfg.colorGrading[2]));
            }
        }
    } else if (filterKey === 'film') {
        // 35mm Warm Color Grade + Film Grain + Vignette
        const maxDistSq = (w * 0.5) * (w * 0.5) + (h * 0.5) * (h * 0.5);

        for (let y = 0; y < h; y++) {
            const dy = y - h * 0.5;
            for (let x = 0; x < w; x++) {
                const dx = x - w * 0.5;
                const distSq = dx * dx + dy * dy;
                const normDist = Math.sqrt(distSq / maxDistSq);
                const vignette = 1.0 - Math.pow(normDist, 2.5) * (cfg.vignetteDarkness || 0.4);

                const idx = (y * w + x) * 4;
                const grain = (Math.random() - 0.5) * 255 * (cfg.noiseIntensity || 0.18);

                let r = (data[idx] * cfg.colorGrading[0] + grain) * vignette;
                let g = (data[idx + 1] * cfg.colorGrading[1] + grain) * vignette;
                let b = (data[idx + 2] * cfg.colorGrading[2] + grain) * vignette;

                data[idx]     = Math.max(0, Math.min(255, r));
                data[idx + 1] = Math.max(0, Math.min(255, g));
                data[idx + 2] = Math.max(0, Math.min(255, b));
            }
        }
    } else if (filterKey === 'analog') {
        // Desaturated High-Contrast + Warm Orange Light Leak Gradient
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                let r = data[idx] / 255;
                let g = data[idx + 1] / 255;
                let b = data[idx + 2] / 255;

                // Desaturation
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                r = lum + (r - lum) * cfg.saturation;
                g = lum + (g - lum) * cfg.saturation;
                b = lum + (b - lum) * cfg.saturation;

                // High Contrast
                r = (r - 0.5) * cfg.contrast + 0.5;
                g = (g - 0.5) * cfg.contrast + 0.5;
                b = (b - 0.5) * cfg.contrast + 0.5;

                // Light leak gradient from top-left
                const leakFactor = Math.max(0, 1.0 - (x / w) * 1.5 - (y / h) * 0.8) * cfg.lightLeakIntensity;
                r += cfg.lightLeakColor[0] * leakFactor;
                g += cfg.lightLeakColor[1] * leakFactor;
                b += cfg.lightLeakColor[2] * leakFactor;

                data[idx]     = Math.max(0, Math.min(255, r * 255));
                data[idx + 1] = Math.max(0, Math.min(255, g * 255));
                data[idx + 2] = Math.max(0, Math.min(255, b * 255));
            }
        }
    } else if (filterKey === 'neon') {
        // Saturation Boost (+200%) + Black Crush
        for (let i = 0; i < totalPixels; i++) {
            const idx = i * 4;
            const rNorm = data[idx] / 255;
            const gNorm = data[idx + 1] / 255;
            const bNorm = data[idx + 2] / 255;

            const res = applyNeonFilterTransform(rNorm, gNorm, bNorm);
            data[idx]     = Math.round(res.r * 255 * cfg.colorGrading[0]);
            data[idx + 1] = Math.round(res.g * 255 * cfg.colorGrading[1]);
            data[idx + 2] = Math.round(res.b * 255 * cfg.colorGrading[2]);
        }
    } else if (filterKey === 'hologram') {
        // Green/Cyan Tint + Horizontal CRT Scanlines + Distortion Vignette
        const copy = new Uint8ClampedArray(data);

        for (let y = 0; y < h; y++) {
            const isScan = (y % 3 === 0);
            const scanDim = isScan ? (1 - cfg.scanlineIntensity) : 1.0;
            const normY = y / h;

            for (let x = 0; x < w; x++) {
                const normX = x / w;
                const dist = calculateHologramBarrelDistortion(normX, normY, cfg.curvatureDistortion || 0.08);

                const srcX = Math.max(0, Math.min(w - 1, Math.round(dist.distortedX * w)));
                const srcY = Math.max(0, Math.min(h - 1, Math.round(dist.distortedY * h)));
                const srcIdx = (srcY * w + srcX) * 4;
                const dstIdx = (y * w + x) * 4;

                const lum = (copy[srcIdx] * 0.299 + copy[srcIdx + 1] * 0.587 + copy[srcIdx + 2] * 0.114);
                const noise = (Math.random() - 0.5) * 30 * cfg.noiseIntensity;

                data[dstIdx]     = Math.max(0, Math.min(255, (lum * cfg.monochromeTint[0] + noise) * scanDim));
                data[dstIdx + 1] = Math.max(0, Math.min(255, (lum * cfg.monochromeTint[1] + noise) * scanDim));
                data[dstIdx + 2] = Math.max(0, Math.min(255, (lum * cfg.monochromeTint[2] + noise) * scanDim));
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return outCanvas;
}
