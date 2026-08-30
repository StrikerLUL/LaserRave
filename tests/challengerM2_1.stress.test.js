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

describe('Empirical Adversarial Stress Harness: Weather & Rain Simulation (M2/R3)', () => {

    describe('1. Delta Time (dt) Stress Testing', () => {
        test('dt = 0 (exact pause): No particle motion, zero impacts, no age advance', () => {
            const sys = createRainParticleSystem(3000);
            const initialY = sys.positions[1];
            const impacts = updateRainParticles(sys, 0);

            assert.strictEqual(impacts.length, 0, 'Must produce 0 impacts on dt = 0');
            assert.strictEqual(sys.positions[1], initialY, 'Position must not change on dt = 0');

            // Splashes with dt = 0
            emitSplashBurst(sys, { x: 0, z: 0 }, 4);
            const initialSplashAge = sys.activeSplashes[0].age;
            const initialSplashY = sys.activeSplashes[0].particles[0].y;
            updateSplashParticles(sys.activeSplashes, 0);
            assert.strictEqual(sys.activeSplashes[0].age, initialSplashAge);
            assert.strictEqual(sys.activeSplashes[0].particles[0].y, initialSplashY);
        });

        test('dt < 0 (negative time step): Safely ignored, no reverse simulation or corruption', () => {
            const sys = createRainParticleSystem(3000);
            const initialY = sys.positions[1];
            const impacts = updateRainParticles(sys, -0.016);

            assert.strictEqual(impacts.length, 0, 'Negative dt must return 0 impacts');
            assert.strictEqual(sys.positions[1], initialY, 'Negative dt must not move particles');

            emitSplashBurst(sys, { x: 0, z: 0 }, 4);
            const initialAge = sys.activeSplashes[0].age;
            updateSplashParticles(sys.activeSplashes, -1.0);
            assert.strictEqual(sys.activeSplashes[0].age, initialAge, 'Negative dt must not change splash age');
        });

        test('dt = -Infinity and dt = -0: Safely guarded', () => {
            const sys = createRainParticleSystem(2500);
            const impactsInf = updateRainParticles(sys, -Infinity);
            assert.strictEqual(impactsInf.length, 0);

            const impactsNegZero = updateRainParticles(sys, -0);
            assert.strictEqual(impactsNegZero.length, 0);
        });

        test('Massive dt jump (dt = 1000.0s / tab suspension wakeup): Recovers cleanly', () => {
            const sys = createRainParticleSystem(2000);
            emitSplashBurst(sys, { x: 0, z: 0 }, 4);

            // Step with massive dt
            const impacts = updateRainParticles(sys, 1000.0);
            assert.ok(Array.isArray(impacts), 'Must return array of impacts');
            assert.strictEqual(sys.activeSplashes.length, 0, 'All splashes must be pruned after massive dt');

            // All particles must be within valid bounds
            for (let i = 0; i < sys.count; i++) {
                const y = sys.positions[i * 3 + 1];
                assert.ok(!Number.isNaN(y) && Number.isFinite(y), 'Particle Y must remain finite');
                assert.ok(y >= 0 && y <= WEATHER_CONFIG.bounds.maxY + 10, 'Particle Y must wrap correctly');
            }
        });

        test('Microscopic dt (dt = 1e-9s): High precision stability without underflow/NaN', () => {
            const sys = createRainParticleSystem(2000);
            const y0 = sys.positions[1];
            const impacts = updateRainParticles(sys, 1e-9);
            assert.strictEqual(impacts.length, 0);
            assert.ok(!Number.isNaN(sys.positions[1]));
            assert.ok(sys.positions[1] <= y0);
        });
    });

    describe('2. Count Bounds & Non-Standard Intensity Stress Testing', () => {
        test('Extreme low counts (0, -1, -50000, -Infinity) clamp strictly to minParticles (2000)', () => {
            const sysZero = createRainParticleSystem(0);
            assert.strictEqual(sysZero.count, 2000);
            assert.strictEqual(sysZero.positions.length, 6000);

            const sysNeg = createRainParticleSystem(-50000);
            assert.strictEqual(sysNeg.count, 2000);

            const sysNegInf = createRainParticleSystem(-Infinity);
            assert.strictEqual(sysNegInf.count, 2000);
        });

        test('Extreme high counts (10000, 100000, 1e7, +Infinity) clamp strictly to maxParticles (8000)', () => {
            const sys10k = createRainParticleSystem(10000);
            assert.strictEqual(sys10k.count, 8000);
            assert.strictEqual(sys10k.positions.length, 24000);

            const sys100k = createRainParticleSystem(100000);
            assert.strictEqual(sys100k.count, 8000);

            const sysHuge = createRainParticleSystem(1e7);
            assert.strictEqual(sysHuge.count, 8000);

            const sysInf = createRainParticleSystem(Infinity);
            assert.strictEqual(sysInf.count, 8000);
        });

        test('Float/Decimal count values: Round safely to integer particle counts', () => {
            const sysFloat1 = createRainParticleSystem(3500.4);
            assert.strictEqual(sysFloat1.count, 3500);

            const sysFloat2 = createRainParticleSystem(3500.8);
            assert.strictEqual(sysFloat2.count, 3501);
        });

        test('Audio gain with extreme intensity bounds', () => {
            // Disabled
            assert.strictEqual(calculateRainAudioGain(false, 0), 0.0);
            assert.strictEqual(calculateRainAudioGain(false, 100000), 0.0);

            // Enabled with boundary inputs
            assert.strictEqual(calculateRainAudioGain(true, 0), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, -1000), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, -Infinity), 0.02);
            assert.strictEqual(calculateRainAudioGain(true, 100000), 0.08);
            assert.strictEqual(calculateRainAudioGain(true, Infinity), 0.08);
        });
    });

    describe('3. Laser Beam Collision & Segment Distance Geometry Math', () => {
        test('Zero-length laser beam (A == B coincident endpoints): Distance equals point-to-point', () => {
            const A = { x: 5, y: 10, z: -2 };
            const B = { x: 5, y: 10, z: -2 }; // Identical to A
            const P = { x: 5, y: 14, z: 1 };

            const expectedDist = Math.hypot(5 - 5, 14 - 10, 1 - (-2)); // sqrt(0 + 16 + 9) = 5
            const actualDist = distancePointToSegment(P, A, B);

            assert.strictEqual(actualDist, expectedDist);
            assert.strictEqual(actualDist, 5);
        });

        test('Near zero-length beam (length < 1e-4): Stable without division by zero', () => {
            const A = { x: 0, y: 0, z: 0 };
            const B = { x: 1e-7, y: 0, z: 0 };
            const P = { x: 3, y: 4, z: 0 };

            const dist = distancePointToSegment(P, A, B);
            assert.ok(!Number.isNaN(dist) && Number.isFinite(dist));
            assert.strictEqual(Math.round(dist), 5);
        });

        test('Collinear points: strictly on segment, before start, beyond end', () => {
            const A = { x: 0, y: 0, z: 0 };
            const B = { x: 0, y: 10, z: 0 };

            // On segment at y=3
            assert.strictEqual(distancePointToSegment({ x: 0, y: 3, z: 0 }, A, B), 0);
            // On start endpoint A
            assert.strictEqual(distancePointToSegment({ x: 0, y: 0, z: 0 }, A, B), 0);
            // On end endpoint B
            assert.strictEqual(distancePointToSegment({ x: 0, y: 10, z: 0 }, A, B), 0);
            // Collinear before start (y = -4) -> distance to A should be 4
            assert.strictEqual(distancePointToSegment({ x: 0, y: -4, z: 0 }, A, B), 4);
            // Collinear beyond end (y = 17) -> distance to B should be 7
            assert.strictEqual(distancePointToSegment({ x: 0, y: 17, z: 0 }, A, B), 7);
        });

        test('Coincident point P with endpoints: Zero within floating point precision (< 1e-12)', () => {
            const A = { x: -12.5, y: 8.3, z: 24.1 };
            const B = { x: 15.2, y: 1.1, z: -10.4 };

            const distA = distancePointToSegment(A, A, B);
            const distB = distancePointToSegment(B, A, B);
            assert.ok(distA < 1e-12, `Expected distA < 1e-12, got ${distA}`);
            assert.ok(distB < 1e-12, `Expected distB < 1e-12, got ${distB}`);
        });

        test('Oblique 3D angle with known Pythagorean perpendicular distance', () => {
            // Segment along diagonal (0,0,0) to (10, 10, 0)
            const A = { x: 0, y: 0, z: 0 };
            const B = { x: 10, y: 10, z: 0 };
            // Midpoint is (5, 5, 0). Point P offset along perpendicular in XY by ( -1, 1 ) and Z by 3
            // Vector from (5,5,0) to (4,6,3) is (-1, 1, 3), perpendicular to (10,10,0) since (-1)*10 + (1)*10 + 3*0 = 0.
            const P = { x: 4, y: 6, z: 3 };
            const expected = Math.hypot(-1, 1, 3); // sqrt(1 + 1 + 9) = sqrt(11) ≈ 3.31662479

            const dist = distancePointToSegment(P, A, B);
            assert.ok(Math.abs(dist - expected) < 1e-6, `Expected ${expected}, got ${dist}`);
        });

        test('computeLaserRainIntersection with zero-length beam and radius boundary', () => {
            const origin = { x: 0, y: 5, z: 0 };
            const dir = { x: 0, y: 0, z: 0 }; // zero length
            const drop = { x: 0.5, y: 5, z: 0 };

            const res = computeLaserRainIntersection(drop, origin, dir, 0.8, 0);
            assert.strictEqual(res.isIntersecting, true);
            assert.ok(Math.abs(res.distance - 0.5) < 1e-6);

            const dropOutside = { x: 1.5, y: 5, z: 0 };
            const resOutside = computeLaserRainIntersection(dropOutside, origin, dir, 0.8, 0);
            assert.strictEqual(resOutside.isIntersecting, false);
            assert.ok(Math.abs(resOutside.distance - 1.5) < 1e-6);
        });

        test('calculateLaserRainReflection with empty, malformed, inactive, and zero-length beams', () => {
            const rainPos = { x: 2, y: 5, z: 3 };

            // Null beam array
            const resNull = calculateLaserRainReflection(rainPos, null);
            assert.strictEqual(resNull.isReflected, false);
            assert.strictEqual(resNull.color, WEATHER_CONFIG.laserReflection.defaultRainColor);

            // Empty beam array
            const resEmpty = calculateLaserRainReflection(rainPos, []);
            assert.strictEqual(resEmpty.isReflected, false);

            // Array containing null / undefined / malformed objects
            const resCorrupt = calculateLaserRainReflection(rainPos, [null, undefined, {}, { active: false }]);
            assert.strictEqual(resCorrupt.isReflected, false);

            // Zero-length active beam exactly at rain position
            const zeroLenBeam = [{
                active: true,
                start: { x: 2, y: 5, z: 3 },
                end: { x: 2, y: 5, z: 3 },
                color: 0xff0000
            }];
            const resZero = calculateLaserRainReflection(rainPos, zeroLenBeam, 0.8);
            assert.strictEqual(resZero.isReflected, true);
            assert.strictEqual(resZero.color, 0xff0000);
            assert.strictEqual(resZero.distance, 0);
        });

        test('calculateLaserRainReflection with THREE.Color instances and numeric hex colors', () => {
            const rainPos = { x: 0, y: 5, z: 0 };
            const mockThreeColor = {
                getHex: () => 0x33ff66
            };
            const beams = [
                {
                    active: true,
                    start: { x: 0, y: 0, z: 0 },
                    end: { x: 0, y: 10, z: 0 },
                    color: mockThreeColor
                }
            ];

            const res = calculateLaserRainReflection(rainPos, beams, 0.8);
            assert.strictEqual(res.isReflected, true);
            assert.strictEqual(res.color, 0x33ff66);
        });

        test('Multi-beam arbitration: Equidistant beams and closest beam tie-breaking', () => {
            const rainPos = { x: 0, y: 0, z: 0 };
            const beams = [
                {
                    active: true,
                    start: { x: 0, y: 1, z: 0 },
                    end: { x: 0, y: 5, z: 0 },
                    color: 0xff0000 // dist = 1.0 > 0.8 (outside threshold)
                },
                {
                    active: true,
                    start: { x: 0.5, y: -5, z: 0 },
                    end: { x: 0.5, y: 5, z: 0 },
                    color: 0x00ff00 // dist = 0.5 <= 0.8 (reflected!)
                },
                {
                    active: true,
                    start: { x: 0.2, y: -5, z: 0 },
                    end: { x: 0.2, y: 5, z: 0 },
                    color: 0x0000ff // dist = 0.2 <= 0.8 (closer, wins!)
                }
            ];

            const res = calculateLaserRainReflection(rainPos, beams, 0.8);
            assert.strictEqual(res.isReflected, true);
            assert.strictEqual(res.color, 0x0000ff);
            assert.ok(Math.abs(res.distance - 0.2) < 1e-6);
        });
    });

    describe('4. Splash Burst Life Cycle and Pool Boundary Stress Testing', () => {
        test('createSplashBurst clamps particle counts strictly to [3, 5]', () => {
            const burstLow = createSplashBurst({ x: 0, z: 0 }, 1);
            assert.strictEqual(burstLow.particles.length, 3);

            const burstHigh = createSplashBurst({ x: 0, z: 0 }, 100);
            assert.strictEqual(burstHigh.particles.length, 5);
        });

        test('Multiple bursts lifecycle: Old bursts expire while new bursts stay active', () => {
            const splashList = [];
            const burst1 = createSplashBurst({ x: 0, z: 0 }, 4);
            splashList.push(burst1);

            // Step 0.15s (burst1 age = 0.15 / 0.20)
            updateSplashParticles(splashList, 0.15);
            assert.strictEqual(splashList.length, 1);
            assert.strictEqual(splashList[0].particles.length, 4);
            assert.ok(splashList[0].particles[0].alpha < 1.0);

            // Add burst2 at t = 0.15s
            const burst2 = createSplashBurst({ x: 10, z: 10 }, 4);
            splashList.push(burst2);
            assert.strictEqual(splashList.length, 2);

            // Step another 0.10s (total t for burst1 = 0.25s >= 0.20s; for burst2 = 0.10s)
            updateSplashParticles(splashList, 0.10);
            assert.strictEqual(splashList.length, 1, 'Burst 1 must be pruned');
            assert.strictEqual(splashList[0], burst2, 'Burst 2 must remain');
            assert.ok(splashList[0].age < 0.20);

            // Step another 0.15s (burst2 total age = 0.25s >= 0.20s)
            updateSplashParticles(splashList, 0.15);
            assert.strictEqual(splashList.length, 0, 'Burst 2 must be pruned');
        });

        test('Splash particles follow parabolic trajectory with downward gravity (-9.81 m/s²)', () => {
            const burst = createSplashBurst({ x: 0, z: 0 }, 4);
            const p = burst.particles[0];
            const initialVy = p.vy;

            const dt = 0.05;
            updateSplashParticles([burst], dt);

            const expectedVy = initialVy + WEATHER_CONFIG.splash.gravity * dt;
            assert.ok(Math.abs(p.vy - expectedVy) < 1e-6, `Expected vy=${expectedVy}, got ${p.vy}`);
            assert.ok(p.vy < initialVy, 'Vertical velocity must decrease due to gravity');
        });
    });

    describe('5. High Throughput & Stress Load Simulation (1,000 frames)', () => {
        test('Simulate 1,000 continuous update frames (16ms each) under Heavy Rain (8,000 particles)', () => {
            const sys = createRainParticleSystem(8000);
            const laserBeams = [
                {
                    active: true,
                    start: { x: -10, y: 15, z: 0 },
                    end: { x: 10, y: 15, z: 0 },
                    color: 0x00ffff
                },
                {
                    active: true,
                    start: { x: 0, y: 20, z: -10 },
                    end: { x: 0, y: 5, z: 10 },
                    color: 0xff00ff
                }
            ];

            let totalImpacts = 0;
            const startTime = performance.now();

            for (let f = 0; f < 1000; f++) {
                const impacts = updateRainParticles(sys, 0.016, { x: 0.5, z: -0.2 });
                totalImpacts += impacts.length;

                // Emit splash on sample of impacts
                for (let k = 0; k < Math.min(impacts.length, 5); k++) {
                    emitSplashBurst(sys, impacts[k], 4);
                }

                // Periodic check for NaN/corrupt coordinates
                if (f % 200 === 0) {
                    for (let i = 0; i < 50; i++) {
                        const y = sys.positions[i * 3 + 1];
                        assert.ok(!Number.isNaN(y) && Number.isFinite(y), 'Y position must remain finite');
                        assert.ok(y >= 0 && y <= WEATHER_CONFIG.bounds.maxY, 'Y must stay within height bounds');
                    }
                }
            }

            const elapsed = performance.now() - startTime;
            assert.ok(totalImpacts > 0, 'Simulation must generate floor impacts');
            assert.ok(elapsed < 2000, `1000 simulation frames should execute swiftly (took ${elapsed.toFixed(2)}ms)`);
        });
    });
});
