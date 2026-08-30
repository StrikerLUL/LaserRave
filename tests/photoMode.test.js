import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';

// ---------------------------------------------------------------------------
// These tests exercise the REAL module below. They previously carried a private
// copy of the implementation and asserted against that copy, so they stayed
// green regardless of what the shipped code did.
// ---------------------------------------------------------------------------
import {
    PHOTO_MODE_CONFIG,
    PHOTO_FILTERS,
    PhotoModeManager,
    clampFreecamParams,
    getFilterShaderConfig,
    generatePhotoFilename,
    calculateHologramBarrelDistortion,
    applyNeonFilterTransform
} from '../src/PhotoMode.js';

// Re-exported so tests/e2eScenarios.test.js keeps resolving them.
export {
    PHOTO_MODE_CONFIG,
    PHOTO_FILTERS,
    PhotoModeManager,
    clampFreecamParams,
    getFilterShaderConfig,
    generatePhotoFilename,
    calculateHologramBarrelDistortion,
    applyNeonFilterTransform
};

describe('R5: Photo Mode with Creative Filters', () => {
    describe('Tier 1: Feature Coverage', () => {
        test('enter and exit PhotoMode toggles audio suspend/resume and freezes delta time', () => {
            let suspendCalled = 0;
            let resumeCalled = 0;
            const mockAudioCtx = {
                suspend: () => { suspendCalled++; },
                resume: () => { resumeCalled++; }
            };

            const pm = new PhotoModeManager();
            assert.strictEqual(pm.isActive, false);
            assert.strictEqual(pm.simulationFrozen, false);

            pm.enter(mockAudioCtx);
            assert.strictEqual(pm.isActive, true);
            assert.strictEqual(pm.simulationFrozen, true);
            assert.strictEqual(suspendCalled, 1);

            pm.exit(mockAudioCtx);
            assert.strictEqual(pm.isActive, false);
            assert.strictEqual(pm.simulationFrozen, false);
            assert.strictEqual(resumeCalled, 1);
        });

        test('setFreecamParameters clamps FOV to [15, 120] and Roll to [-45, +45]', () => {
            const pm = new PhotoModeManager();

            pm.setFreecamParameters({ fov: 45, rollDeg: -15 });
            assert.strictEqual(pm.freecam.fov, 45);
            assert.strictEqual(pm.freecam.rollDeg, -15);

            // Underflow & overflow tests
            pm.setFreecamParameters({ fov: 5, rollDeg: -80 });
            assert.strictEqual(pm.freecam.fov, 15);
            assert.strictEqual(pm.freecam.rollDeg, -45);

            pm.setFreecamParameters({ fov: 150, rollDeg: 75 });
            assert.strictEqual(pm.freecam.fov, 120);
            assert.strictEqual(pm.freecam.rollDeg, 45);
        });

        test('getFilterShaderConfig provides profiles for all 6 required creative filters', () => {
            const filters = ['raw', 'vhs', 'film', 'analog', 'neon', 'hologram'];
            filters.forEach(f => {
                const cfg = getFilterShaderConfig(f);
                assert.strictEqual(cfg.id, f);
                assert.ok(typeof cfg.name === 'string');
            });
        });

        test('VHS filter includes chromatic aberration, scanlines, and noise parameters', () => {
            const vhs = getFilterShaderConfig('vhs');
            assert.ok(vhs.chromaticAberrationPx >= 3.0, 'VHS must have chromatic aberration');
            assert.ok(vhs.scanlineFrequency >= 200, 'VHS must have scanlines');
            assert.ok(vhs.noiseIntensity >= 0.10, 'VHS must have noise');
        });

        test('Film filter includes warm yellow grade, grain, and vignette parameters', () => {
            const film = getFilterShaderConfig('film');
            assert.ok(film.colorGrading[0] > film.colorGrading[2], 'Warm color grade (R > B)');
            assert.ok(film.noiseIntensity >= 0.15, 'Film grain');
            assert.ok(film.vignetteRadius > 0, 'Vignette effect');
        });

        test('generatePhotoFilename produces laserrave_photo_<timestamp>.png format', () => {
            const ts = 1724401234567;
            const name = generatePhotoFilename(ts);
            assert.strictEqual(name, 'laserrave_photo_1724401234567.png');
            assert.ok(name.endsWith('.png'));
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('getFilterShaderConfig falls back safely to raw filter on unknown/null input', () => {
            const nullFilter = getFilterShaderConfig(null);
            const unknownFilter = getFilterShaderConfig('super_lens_flare');

            assert.strictEqual(nullFilter.id, 'raw');
            assert.strictEqual(unknownFilter.id, 'raw');
        });

        test('Neon filter applies black crushing and saturation boost', () => {
            // Dark gray pixel below 0.10 threshold -> crushed to 0
            const dark = applyNeonFilterTransform(0.08, 0.05, 0.09);
            assert.strictEqual(dark.r, 0);
            assert.strictEqual(dark.g, 0);
            assert.strictEqual(dark.b, 0);

            // Vibrant saturated color -> amplified
            const vibrant = applyNeonFilterTransform(0.8, 0.2, 0.4);
            assert.ok(vibrant.r >= 0.8);
            assert.ok(vibrant.g < 0.2); // Green reduced relative to dominant red
        });

        test('calculateHologramBarrelDistortion preserves center (0.5, 0.5) and distorts corners', () => {
            const center = calculateHologramBarrelDistortion(0.5, 0.5);
            assert.strictEqual(center.distortedX, 0.5);
            assert.strictEqual(center.distortedY, 0.5);

            const corner = calculateHologramBarrelDistortion(0.0, 0.0);
            assert.ok(corner.distortedX < 0.0); // Pushed outward at corners
            assert.ok(corner.distortedY < 0.0);
        });

        test('generatePhotoFilename handles non-numeric timestamp by using current time', () => {
            const name1 = generatePhotoFilename('invalid');
            const name2 = generatePhotoFilename(null);

            assert.ok(name1.startsWith('laserrave_photo_') && name1.endsWith('.png'));
            assert.ok(name2.startsWith('laserrave_photo_') && name2.endsWith('.png'));
        });

        test('Freecam parameters handle negative focus distance and aperture by ignoring or clamping', () => {
            const pm = new PhotoModeManager();
            pm.setFreecamParameters({ focusDistance: -10, aperture: -0.5 });
            assert.strictEqual(pm.freecam.focusDistance, 10.0, 'Negative focus distance ignored');
            assert.strictEqual(pm.freecam.aperture, 0.0);
        });
    });

    describe('Tier 3: Pairwise & Workflow Integration', () => {
        test('Full Photo Mode snapshot workflow: Enter -> Config Freecam -> Filter -> Filename -> Exit', () => {
            const pm = new PhotoModeManager();
            const mockAudio = { suspend: () => {}, resume: () => {} };

            pm.enter(mockAudio);
            assert.strictEqual(pm.isActive, true);

            pm.setFreecamParameters({ fov: 35, rollDeg: 12, focusDistance: 15 });
            pm.setFilter('neon');
            assert.strictEqual(pm.currentFilter, 'neon');

            const filterConfig = getFilterShaderConfig(pm.currentFilter);
            assert.strictEqual(filterConfig.saturation, 3.0);

            const filename = generatePhotoFilename(1724400999000);
            assert.strictEqual(filename, 'laserrave_photo_1724400999000.png');

            pm.exit(mockAudio);
            assert.strictEqual(pm.isActive, false);
            assert.strictEqual(pm.simulationFrozen, false);
        });
    });
});
