import assert from 'node:assert';
import { test, describe } from 'node:test';

import {
    WEATHER_CONFIG,
    createRainBuffer,
    createRainParticleSystem,
    updateRainParticles,
    createSplashBurst,
    emitSplashBurst,
    updateSplashParticles,
    distancePointToSegment,
    computeLaserRainIntersection,
    calculateLaserRainReflection,
    calculateRainAudioGain,
    createRainStreakTexture
} from '../src/WeatherEffects.js';

import {
    STAGE_PRESETS,
    getStagePreset,
    applyStagePreset
} from '../src/StagePresets.js';

describe('Challenger 2 Empirical Stress Harness: Weather Effects & Audio Atmosphere (M2/R3)', () => {

    // ─────────────────────────────────────────────────────────────────────────
    // 1. FLOOR SPLASH PARTICLE POOL & LIFETIME PRUNING STRESS
    // ─────────────────────────────────────────────────────────────────────────
    describe('1. Floor Splash Particle Pool & Lifetime Pruning', () => {

        test('Splash burst particle count strictly clamped in [3, 5] across numeric inputs', () => {
            const inputs = [-1000, -1, 0, 1, 2, 3, 4, 5, 6, 10, 100, 10000, Infinity, -Infinity];
            for (const input of inputs) {
                const burst = createSplashBurst({ x: 0, z: 0 }, input);
                assert.ok(burst.particles.length >= 3, `Count for input ${input} must be >= 3`);
                assert.ok(burst.particles.length <= 5, `Count for input ${input} must be <= 5`);
                assert.strictEqual(burst.age, 0);
                assert.strictEqual(burst.lifespan, 0.20);
                for (const p of burst.particles) {
                    assert.strictEqual(p.x, 0);
                    assert.strictEqual(p.y, 0.05);
                    assert.strictEqual(p.z, 0);
                    assert.strictEqual(p.alpha, 1.0);
                    assert.ok(p.vy > 0, 'Initial vertical velocity must be upward');
                    const horizSpeed = Math.hypot(p.vx, p.vz);
                    assert.ok(horizSpeed > 0, 'Radial velocity must be non-zero');
                }
            }
        });

        test('High-volume burst flooding (500 bursts in 1 frame) and complete lifetime pruning', () => {
            const sys = createRainParticleSystem(2000);
            const BURST_COUNT = 500;

            // Emit 500 bursts in a single frame
            for (let i = 0; i < BURST_COUNT; i++) {
                emitSplashBurst(sys, { x: (i % 20) - 10, z: Math.floor(i / 20) - 12 }, 4);
            }
            assert.strictEqual(sys.activeSplashes.length, BURST_COUNT);

            // Advance by 0.05s (t = 0.05 < 0.20s)
            updateSplashParticles(sys.activeSplashes, 0.05);
            assert.strictEqual(sys.activeSplashes.length, BURST_COUNT, 'No bursts should expire at 0.05s');
            for (const burst of sys.activeSplashes) {
                assert.ok(Math.abs(burst.age - 0.05) < 1e-6);
                for (const p of burst.particles) {
                    assert.ok(p.alpha > 0.7 && p.alpha < 0.8, 'Alpha should be ~0.75');
                }
            }

            // Advance by another 0.10s (t = 0.15 < 0.20s)
            updateSplashParticles(sys.activeSplashes, 0.10);
            assert.strictEqual(sys.activeSplashes.length, BURST_COUNT, 'No bursts should expire at 0.15s');
            for (const burst of sys.activeSplashes) {
                assert.ok(Math.abs(burst.age - 0.15) < 1e-6);
                for (const p of burst.particles) {
                    assert.ok(p.alpha > 0.2 && p.alpha < 0.3, 'Alpha should be ~0.25');
                }
            }

            // Advance by 0.06s (total t = 0.21s >= 0.20s) -> ALL bursts must be cleanly pruned
            updateSplashParticles(sys.activeSplashes, 0.06);
            assert.strictEqual(sys.activeSplashes.length, 0, 'All bursts must be completely pruned after lifespan');
        });

        test('Staggered continuous splash emission over 1,000 steps maintains bounded pool size', () => {
            const sys = createRainParticleSystem(2000);
            const dt = 0.016; // 60 FPS (~12 frames per 0.2s lifespan)
            let maxActiveSplashes = 0;

            for (let step = 0; step < 1000; step++) {
                // Emit 3 bursts per frame
                for (let k = 0; k < 3; k++) {
                    emitSplashBurst(sys, { x: Math.sin(step) * 10, z: Math.cos(step) * 10 }, 4);
                }
                updateSplashParticles(sys.activeSplashes, dt);

                if (sys.activeSplashes.length > maxActiveSplashes) {
                    maxActiveSplashes = sys.activeSplashes.length;
                }

                // In steady state at 60fps with lifespan 0.20s, active bursts should not exceed ~50
                assert.ok(sys.activeSplashes.length <= 50, `Active splashes (${sys.activeSplashes.length}) exceeded ceiling`);
            }

            // After stopping emissions and stepping 0.25s, activeSplashes should drain to exactly 0
            updateSplashParticles(sys.activeSplashes, 0.25);
            assert.strictEqual(sys.activeSplashes.length, 0, 'Splash pool must drain to zero after cessation');
        });

        test('Variable frame rate integration (144Hz, 60Hz, 30Hz, 10Hz) preserves parabolic gravity', () => {
            const frameRates = [144, 60, 30, 10];

            for (const fps of frameRates) {
                const dt = 1.0 / fps;
                const burst = createSplashBurst({ x: 0, z: 0 }, 4);
                const p = burst.particles[0];
                const v0y = p.vy;
                let elapsed = 0;

                while (elapsed + dt < burst.lifespan) {
                    updateSplashParticles([burst], dt);
                    elapsed += dt;

                    // Theoretical expected velocity: v(t) = v0 + g * t
                    const expectedVy = v0y + WEATHER_CONFIG.splash.gravity * elapsed;
                    assert.ok(Math.abs(p.vy - expectedVy) < 1e-4, `At ${fps}Hz step ${elapsed}s: expected vy ${expectedVy}, got ${p.vy}`);
                }
            }
        });

        test('GPU Splash pool rendering buffer safety: fixed 250 particle cap never overflows', () => {
            // Simulate the exact rendering logic in main.js
            const maxSplashCount = 250;
            const splashPositions = new Float32Array(maxSplashCount * 3);
            const splashColors = new Float32Array(maxSplashCount * 3);

            // Create 100 bursts (approx 400 particles > 250 max cap)
            const sys = createRainParticleSystem(2000);
            for (let i = 0; i < 100; i++) {
                emitSplashBurst(sys, { x: i, z: i }, 4);
            }

            let sIdx = 0;
            for (let b = 0; b < sys.activeSplashes.length && sIdx < maxSplashCount; b++) {
                const burst = sys.activeSplashes[b];
                for (let p = 0; p < burst.particles.length && sIdx < maxSplashCount; p++) {
                    const pt = burst.particles[p];
                    const p3 = sIdx * 3;
                    splashPositions[p3]     = pt.x;
                    splashPositions[p3 + 1] = pt.y;
                    splashPositions[p3 + 2] = pt.z;
                    splashColors[p3]     = 0.7 * pt.alpha;
                    splashColors[p3 + 1] = 0.9 * pt.alpha;
                    splashColors[p3 + 2] = 1.0 * pt.alpha;
                    sIdx++;
                }
            }

            assert.strictEqual(sIdx, 250, 'Must fill exactly up to cap 250');
            assert.strictEqual(splashPositions.length, 750);
            assert.strictEqual(splashColors.length, 750);

            // Clear remaining slots (none in this case, but test loop)
            for (let k = sIdx; k < maxSplashCount; k++) {
                splashPositions[k * 3 + 1] = -100;
            }

            // Verify no NaN or undefined values exist
            for (let i = 0; i < splashPositions.length; i++) {
                assert.ok(!Number.isNaN(splashPositions[i]) && Number.isFinite(splashPositions[i]));
                assert.ok(!Number.isNaN(splashColors[i]) && Number.isFinite(splashColors[i]));
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. AUDIO GAIN CALCULATIONS & OVERLOAD SIGNATURES
    // ─────────────────────────────────────────────────────────────────────────
    describe('2. Audio Gain Calculations & Signature Overload Matrix', () => {

        test('Signature 1: calculateRainAudioGain(boolean enabled, number intensity)', () => {
            // Disabled always returns exactly 0.0 regardless of intensity
            assert.strictEqual(calculateRainAudioGain(false, 2000), 0.0);
            assert.strictEqual(calculateRainAudioGain(false, 4000), 0.0);
            assert.strictEqual(calculateRainAudioGain(false, 8000), 0.0);
            assert.strictEqual(calculateRainAudioGain(false, 100000), 0.0);
            assert.strictEqual(calculateRainAudioGain(false, -500), 0.0);

            // Enabled: linear mapping [2000 -> 0.02, 8000 -> 0.08]
            assert.strictEqual(calculateRainAudioGain(true, 2000), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, 8000), 0.08);
            assert.strictEqual(calculateRainAudioGain(true, 5000), 0.05);
            assert.strictEqual(calculateRainAudioGain(true, 3500), 0.035);
            assert.strictEqual(calculateRainAudioGain(true, 6500), 0.065);

            // Clamping for out-of-range intensities
            assert.strictEqual(calculateRainAudioGain(true, 0), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, -1000), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, 9000), 0.08);
            assert.strictEqual(calculateRainAudioGain(true, 1e6), 0.08);

            // Non-numeric intensity fallback to defaultIntensity (4000) -> ~0.04
            assert.ok(Math.abs(calculateRainAudioGain(true, undefined) - 0.04) < 1e-6);
            assert.ok(Math.abs(calculateRainAudioGain(true, null) - 0.04) < 1e-6);
            assert.ok(Math.abs(calculateRainAudioGain(true, 'invalid') - 0.04) < 1e-6);
        });

        test('Signature 2: calculateRainAudioGain(number intensity, number maxGain)', () => {
            // Custom maxGain = 0.14
            assert.strictEqual(calculateRainAudioGain(2000, 0.14), 0.02);
            assert.strictEqual(calculateRainAudioGain(8000, 0.14), 0.14);
            // Midpoint at 5000: 0.02 + 0.5 * (0.14 - 0.02) = 0.02 + 0.06 = 0.08
            assert.strictEqual(calculateRainAudioGain(5000, 0.14), 0.08);

            // Custom maxGain = 0.04
            assert.strictEqual(calculateRainAudioGain(2000, 0.04), 0.02);
            assert.strictEqual(calculateRainAudioGain(8000, 0.04), 0.04);
            assert.strictEqual(calculateRainAudioGain(5000, 0.04), 0.03);

            // Single numeric argument (intensity only, default maxGain = 0.08)
            assert.strictEqual(calculateRainAudioGain(2000), 0.02);
            assert.ok(Math.abs(calculateRainAudioGain(4000) - 0.04) < 1e-6);
            assert.strictEqual(calculateRainAudioGain(8000), 0.08);
        });

        test('Monotonicity and strict linearity of audio gain across full dynamic range', () => {
            let prevGain = -1;
            for (let count = 2000; count <= 8000; count += 100) {
                const gain = calculateRainAudioGain(true, count);
                assert.ok(gain >= prevGain, `Gain must be monotonic: ${gain} >= ${prevGain}`);
                assert.ok(gain >= 0.02 && gain <= 0.08, `Gain ${gain} must be in [0.02, 0.08]`);

                // Verify exact linear formula: gain = 0.02 + ((count - 2000) / 6000) * 0.06
                const expected = 0.02 + ((count - 2000) / 6000) * 0.06;
                assert.ok(Math.abs(gain - expected) < 1e-12, `Gain deviation at count ${count}`);
                prevGain = gain;
            }
        });

        test('Extreme and non-standard argument types handling', () => {
            // Empty args -> defaults to enabled=true, intensity=4000 -> ~0.04
            assert.ok(Math.abs(calculateRainAudioGain() - 0.04) < 1e-6);
            // Null / undefined args
            assert.ok(Math.abs(calculateRainAudioGain(null, null) - 0.04) < 1e-6);
            assert.ok(Math.abs(calculateRainAudioGain(undefined, undefined) - 0.04) < 1e-6);
            // Non-boolean truthy/falsy non-number
            assert.ok(Math.abs(calculateRainAudioGain('true', 4000) - 0.04) < 1e-6);
            assert.ok(Math.abs(calculateRainAudioGain({}, []) - 0.04) < 1e-6);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. RAPID PRESET SWITCHING & CROSS-PRESET RESILIENCE
    // ─────────────────────────────────────────────────────────────────────────
    describe('3. Rapid Stage Preset Switching & Weather Transitions', () => {

        test('1,000 rapid random switches between Open-Air and indoor presets', () => {
            const presets = ['openair', 'berghain', 'arena', 'basement'];
            let state = {
                currentPreset: 'openair',
                rainEnabled: true,
                rainIntensity: 4000,
                hazeDensity: 0.45
            };

            for (let i = 0; i < 1000; i++) {
                const targetPreset = presets[Math.floor(Math.random() * presets.length)];
                state = applyStagePreset(targetPreset, state);

                if (targetPreset === 'openair') {
                    assert.strictEqual(state.currentPreset, 'openair');
                    assert.strictEqual(state.rainEnabled, true, 'Open-Air must have rain enabled');
                    assert.strictEqual(state.rainIntensity, 4000, 'Open-Air default rain intensity must be 4000');
                    assert.strictEqual(state.screensEnabled, true);
                    assert.strictEqual(state.hazeDensity, 0.45);
                    const gain = calculateRainAudioGain(state.rainEnabled, state.rainIntensity);
                    assert.ok(Math.abs(gain - 0.04) < 1e-6);
                } else if (targetPreset === 'berghain') {
                    assert.strictEqual(state.currentPreset, 'berghain');
                    assert.strictEqual(state.rainEnabled, false, 'Berghain must have rain disabled');
                    assert.strictEqual(state.rainIntensity, 0);
                    assert.strictEqual(state.screensEnabled, false);
                    assert.strictEqual(state.hazeDensity, 0.90);
                    assert.strictEqual(state.activeTheme, 'bloodmoon');
                    assert.strictEqual(calculateRainAudioGain(state.rainEnabled, state.rainIntensity), 0.0);
                } else if (targetPreset === 'arena') {
                    assert.strictEqual(state.currentPreset, 'arena');
                    assert.strictEqual(state.rainEnabled, false, 'Arena must have rain disabled');
                    assert.strictEqual(state.rainIntensity, 0);
                    assert.strictEqual(state.screensEnabled, true);
                    assert.strictEqual(state.hazeDensity, 0.60);
                    assert.strictEqual(calculateRainAudioGain(state.rainEnabled, state.rainIntensity), 0.0);
                } else if (targetPreset === 'basement') {
                    assert.strictEqual(state.currentPreset, 'basement');
                    assert.strictEqual(state.rainEnabled, false, 'Basement must have rain disabled');
                    assert.strictEqual(state.rainIntensity, 0);
                    assert.strictEqual(state.screensEnabled, false);
                    assert.strictEqual(state.hazeDensity, 1.0);
                    assert.strictEqual(calculateRainAudioGain(state.rainEnabled, state.rainIntensity), 0.0);
                }

                // Camera position must be valid and non-NaN
                assert.ok(!Number.isNaN(state.cameraPosition.x));
                assert.ok(!Number.isNaN(state.cameraPosition.y));
                assert.ok(!Number.isNaN(state.cameraPosition.z));
                assert.ok(!Number.isNaN(state.cameraPosition.fov));
            }
        });

        test('Oscillation cycle (Open-Air -> Indoor -> Open-Air) preserves fresh rain system state', () => {
            let rainSys = createRainParticleSystem(4000);
            assert.strictEqual(rainSys.count, 4000);

            for (let cycle = 0; cycle < 50; cycle++) {
                // 1. In Open-Air: step rain for 10 frames
                for (let f = 0; f < 10; f++) {
                    const impacts = updateRainParticles(rainSys, 0.016);
                    for (const imp of impacts.slice(0, 3)) {
                        emitSplashBurst(rainSys, imp, 4);
                    }
                }
                assert.ok(rainSys.activeSplashes.length > 0);

                // 2. Switch to Indoor (Berghain/Basement) -> Rain stops, visual update skipped
                let indoorState = applyStagePreset('berghain', { rainEnabled: true });
                assert.strictEqual(indoorState.rainEnabled, false);

                // Splashes age out during indoor state
                updateSplashParticles(rainSys.activeSplashes, 0.25);
                assert.strictEqual(rainSys.activeSplashes.length, 0, 'Splashes must be empty after indoor hiatus');

                // 3. Switch back to Open-Air
                let outdoorState = applyStagePreset('openair', indoorState);
                assert.strictEqual(outdoorState.rainEnabled, true);
                assert.strictEqual(outdoorState.rainIntensity, 4000);
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. LASER RAIN INTERSECTION & BEAM PROXIMITY GEOMETRY
    // ─────────────────────────────────────────────────────────────────────────
    describe('4. Laser Rain Reflection & 3D Geometry Stress', () => {

        test('Exact 0.8000m threshold boundary behavior', () => {
            const beam = [{
                active: true,
                start: { x: 0, y: 0, z: 0 },
                end: { x: 0, y: 10, z: 0 },
                color: 0xff00ff
            }];

            // Exactly at threshold 0.8000m
            const atThreshold = { x: 0.8000, y: 5.0, z: 0 };
            const resAt = calculateLaserRainReflection(atThreshold, beam, 0.8);
            assert.strictEqual(resAt.isReflected, true);
            assert.strictEqual(resAt.color, 0xff00ff);

            // Just inside threshold (0.7999m)
            const inside = { x: 0.7999, y: 5.0, z: 0 };
            const resIn = calculateLaserRainReflection(inside, beam, 0.8);
            assert.strictEqual(resIn.isReflected, true);
            assert.strictEqual(resIn.color, 0xff00ff);

            // Just outside threshold (0.8001m)
            const outside = { x: 0.8001, y: 5.0, z: 0 };
            const resOut = calculateLaserRainReflection(outside, beam, 0.8);
            assert.strictEqual(resOut.isReflected, false);
            assert.strictEqual(resOut.color, WEATHER_CONFIG.laserReflection.defaultRainColor);
        });

        test('Dense 50-laser field: High-throughput color arbitration for 8,000 rain particles', () => {
            const beams = [];
            for (let b = 0; b < 50; b++) {
                const angle = (b / 50) * Math.PI * 2;
                beams.push({
                    active: b % 2 === 0, // Half active, half inactive
                    start: { x: Math.cos(angle) * 15, y: 0, z: Math.sin(angle) * 15 },
                    end: { x: Math.cos(angle + 1) * 20, y: 25, z: Math.sin(angle + 1) * 20 },
                    color: 0x100000 * ((b * 5) % 255) + 0x001000 * ((b * 9) % 255) + 0x0000ff
                });
            }

            const sys = createRainParticleSystem(8000);
            const startTime = performance.now();
            let reflectedCount = 0;

            const tempP = { x: 0, y: 0, z: 0 };
            for (let i = 0; i < sys.count; i++) {
                const i3 = i * 3;
                tempP.x = sys.positions[i3];
                tempP.y = sys.positions[i3 + 1];
                tempP.z = sys.positions[i3 + 2];

                const ref = calculateLaserRainReflection(tempP, beams, 0.8);
                if (ref.isReflected) {
                    reflectedCount++;
                    sys.colors[i] = ref.color;
                }
            }

            const elapsed = performance.now() - startTime;
            assert.ok(elapsed < 150, `Arbitration for 8,000 particles across 50 beams took ${elapsed.toFixed(2)}ms (< 150ms)`);
            assert.ok(reflectedCount >= 0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. HIGH-THROUGHPUT END-TO-END STRESS SIMULATION (5,000 FRAMES)
    // ─────────────────────────────────────────────────────────────────────────
    describe('5. High-Throughput Simulation (5,000 Frames)', () => {

        test('Continuous 5,000 frames under heavy rain, dynamic laser reflections, and floor splashes', () => {
            const sys = createRainParticleSystem(8000);
            const laser = [{
                active: true,
                start: { x: -20, y: 5, z: 0 },
                end: { x: 20, y: 5, z: 0 },
                color: 0x00ffff
            }];

            let totalImpacts = 0;
            let totalSplashesEmitted = 0;
            const startTime = performance.now();

            for (let frame = 0; frame < 5000; frame++) {
                const dt = 0.016;
                const impacts = updateRainParticles(sys, dt, { x: 0.5, z: -0.2 });
                totalImpacts += impacts.length;

                // Emit splashes for up to 5 impacts per frame
                for (let k = 0; k < Math.min(impacts.length, 5); k++) {
                    emitSplashBurst(sys, impacts[k], 4);
                    totalSplashesEmitted++;
                }

                // Periodic validation every 1,000 frames
                if (frame % 1000 === 0) {
                    for (let i = 0; i < 20; i++) {
                        const y = sys.positions[i * 3 + 1];
                        assert.ok(!Number.isNaN(y) && Number.isFinite(y));
                        assert.ok(y >= 0 && y <= WEATHER_CONFIG.bounds.maxY);
                    }
                    assert.ok(sys.activeSplashes.length < 100, `Active splashes must remain bounded (got ${sys.activeSplashes.length})`);
                }
            }

            const elapsed = performance.now() - startTime;
            assert.ok(totalImpacts > 10000, `Generated ${totalImpacts} impacts`);
            assert.ok(totalSplashesEmitted > 5000, `Emitted ${totalSplashesEmitted} splashes`);
            assert.ok(elapsed < 4000, `5,000 frames executed in ${elapsed.toFixed(2)}ms (< 4,000ms)`);
        });
    });
});
