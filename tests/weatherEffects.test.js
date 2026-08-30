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

export {
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
};

// ---------------------------------------------------------------------------
// TEST SUITE: R3 Weather Effects
// ---------------------------------------------------------------------------

describe('R3: Weather Effects (Open-Air Stage)', () => {
    describe('Tier 1: Feature Coverage', () => {
        test('createRainParticleSystem initializes buffers with valid counts in [2000, 8000]', () => {
            const light = createRainParticleSystem(2000);
            const heavy = createRainParticleSystem(8000);

            assert.strictEqual(light.count, 2000);
            assert.strictEqual(light.positions.length, 2000 * 3);
            assert.strictEqual(light.velocities.length, 2000 * 3);
            assert.strictEqual(light.colors.length, 2000);

            assert.strictEqual(heavy.count, 8000);
            assert.strictEqual(heavy.positions.length, 8000 * 3);
        });

        test('updateRainParticles moves particles downwards and wraps on floor impact (y <= 0)', () => {
            const system = createRainParticleSystem(100);
            for (let i = 0; i < system.count; i++) {
                system.positions[i * 3 + 1] = 20.0;
            }
            // Place first particle just above ground
            system.positions[1] = 0.1;
            system.velocities[1] = -40.0; // Moving down fast

            const dt = 0.016; // ~60fps step
            const impacts = updateRainParticles(system, dt);

            // Particle should have crossed y <= 0, triggered impact, and wrapped to maxY (30m)
            assert.strictEqual(impacts.length, 1);
            assert.strictEqual(system.positions[1], WEATHER_CONFIG.bounds.maxY);
        });

        test('emitSplashBurst creates 3-5 bright particles with radial velocities', () => {
            const system = createRainParticleSystem(100);
            const impact = { x: 5.0, z: -3.0 };
            const burst = emitSplashBurst(system, impact, 4);

            assert.strictEqual(burst.particles.length, 4);
            assert.strictEqual(system.activeSplashes.length, 1);

            burst.particles.forEach(p => {
                assert.strictEqual(p.x, 5.0);
                assert.strictEqual(p.z, -3.0);
                assert.ok(p.vy > 0, 'Splash initial vertical velocity must be upward');
                const horizontalSpeed = Math.hypot(p.vx, p.vz);
                assert.ok(horizontalSpeed > 1.0, 'Splash must have radial outward velocity');
            });
        });

        test('calculateLaserRainReflection reflects laser beam color within 0.8m proximity', () => {
            const laserBeams = [
                {
                    active: true,
                    start: { x: 0, y: 10, z: 0 },
                    end: { x: 0, y: 0, z: 20 },
                    color: 0x00ff00 // Green laser
                }
            ];

            // Point directly on beam midpoint (0, 5, 10)
            const onBeam = { x: 0, y: 5, z: 10 };
            const resOn = calculateLaserRainReflection(onBeam, laserBeams);
            assert.strictEqual(resOn.isReflected, true);
            assert.strictEqual(resOn.color, 0x00ff00);

            // Point 0.3m away from beam
            const nearBeam = { x: 0.3, y: 5, z: 10 };
            const resNear = calculateLaserRainReflection(nearBeam, laserBeams);
            assert.strictEqual(resNear.isReflected, true);
            assert.strictEqual(resNear.color, 0x00ff00);

            // Point 5.0m away from beam
            const farBeam = { x: 5.0, y: 5, z: 10 };
            const resFar = calculateLaserRainReflection(farBeam, laserBeams);
            assert.strictEqual(resFar.isReflected, false);
            assert.strictEqual(resFar.color, WEATHER_CONFIG.laserReflection.defaultRainColor);
        });

        test('calculateRainAudioGain scales gain linearly from 0.02 to 0.08 and 0 when disabled', () => {
            assert.strictEqual(calculateRainAudioGain(false, 4000), 0.0);
            assert.strictEqual(calculateRainAudioGain(true, 2000), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, 8000), 0.08);

            const midGain = calculateRainAudioGain(true, 5000);
            assert.ok(midGain > 0.02 && midGain < 0.08);
            assert.strictEqual(Math.round(midGain * 1000) / 1000, 0.05);
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('createRainParticleSystem clamps particle counts strictly to [2000, 8000]', () => {
            const underflow = createRainParticleSystem(100);
            const overflow = createRainParticleSystem(50000);

            assert.strictEqual(underflow.count, 2000);
            assert.strictEqual(overflow.count, 8000);
        });

        test('Splash particle burst expires and cleans up after lifespan of 0.20s', () => {
            const system = createRainParticleSystem(100);
            emitSplashBurst(system, { x: 0, z: 0 }, 4);
            assert.strictEqual(system.activeSplashes.length, 1);

            // Step forward by 0.10s (half life)
            updateRainParticles(system, 0.10);
            assert.strictEqual(system.activeSplashes.length, 1);
            assert.ok(system.activeSplashes[0].particles[0].alpha < 1.0);

            // Step forward by remaining 0.15s (total 0.25s > 0.20s)
            updateRainParticles(system, 0.15);
            assert.strictEqual(system.activeSplashes.length, 0, 'Expired splashes must be cleanly pruned');
        });

        test('distancePointToSegment handles points before start, beyond end, and collinear', () => {
            const A = { x: 0, y: 0, z: 0 };
            const B = { x: 10, y: 0, z: 0 };

            // Point before A
            assert.strictEqual(distancePointToSegment({ x: -5, y: 0, z: 0 }, A, B), 5);
            // Point beyond B
            assert.strictEqual(distancePointToSegment({ x: 14, y: 0, z: 0 }, A, B), 4);
            // Point collinear on segment
            assert.strictEqual(distancePointToSegment({ x: 5, y: 0, z: 0 }, A, B), 0);
            // Point perpendicular at midpoint
            assert.strictEqual(distancePointToSegment({ x: 5, y: 3, z: 4 }, A, B), 5);
            // Degenerate zero-length segment
            assert.strictEqual(distancePointToSegment({ x: 3, y: 4, z: 0 }, A, A), 5);
        });

        test('updateRainParticles handles zero delta-time (paused state) without motion or impacts', () => {
            const system = createRainParticleSystem(500);
            const initialY = system.positions[1];
            const impacts = updateRainParticles(system, 0);

            assert.strictEqual(impacts.length, 0);
            assert.strictEqual(system.positions[1], initialY);
        });

        test('Inactive laser beams do not trigger rain color reflections', () => {
            const laserBeams = [
                {
                    active: false, // Beam turned off
                    start: { x: 0, y: 0, z: 0 },
                    end: { x: 0, y: 10, z: 0 },
                    color: 0xff00ff
                }
            ];
            const res = calculateLaserRainReflection({ x: 0, y: 5, z: 0 }, laserBeams);
            assert.strictEqual(res.isReflected, false);
            assert.strictEqual(res.color, WEATHER_CONFIG.laserReflection.defaultRainColor);
        });
    });

    describe('Tier 3: Pairwise & Cross-Feature', () => {
        test('Multi-laser color reflection picks the closest intersecting active beam', () => {
            const laserBeams = [
                {
                    active: true,
                    start: { x: -10, y: 5, z: 0 },
                    end: { x: 10, y: 5, z: 0 },
                    color: 0xff0000 // Red (dist = 0.5)
                },
                {
                    active: true,
                    start: { x: 0, y: -10, z: 0 },
                    end: { x: 0, y: 10, z: 0 },
                    color: 0x0000ff // Blue (dist = 0.1)
                }
            ];

            const rainDrop = { x: 0.1, y: 5.5, z: 0 };
            const res = calculateLaserRainReflection(rainDrop, laserBeams);
            assert.strictEqual(res.isReflected, true);
            assert.strictEqual(res.color, 0x0000ff, 'Should reflect the closer blue beam');
        });

        test('Streak orientation angle matches wind velocity drift vector', () => {
            const wind = { x: 5.0, z: 0.0 };
            const fallSpeed = -40.0;
            const tiltAngleRad = Math.atan2(wind.x, -fallSpeed);

            assert.ok(tiltAngleRad > 0.1 && tiltAngleRad < 0.2);
            assert.strictEqual(WEATHER_CONFIG.streakAspect.widthPx, 1);
            assert.strictEqual(WEATHER_CONFIG.streakAspect.heightPx, 12);
        });
    });
});
