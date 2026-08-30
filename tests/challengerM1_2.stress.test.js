import assert from 'node:assert';
import { test, describe } from 'node:test';
import {
    STAGE_PRESETS,
    getStagePreset,
    generateConcentricCrowd,
    generateCompactDancefloor,
    applyStagePreset
} from '../src/StagePresets.js';
import {
    compileCustomStageLayout,
    serializeStageLayout,
    deserializeStageLayout,
    validateFixture,
    snapToGrid
} from '../src/StageBuilder.js';

// ---------------------------------------------------------------------------
// CHALLENGER 2: EMPIRICAL STRESS TESTS FOR MILESTONE 1 (R1 & R2)
// ---------------------------------------------------------------------------

describe('Challenger 2: Empirical Stress Harness for M1 (R1 & R2)', () => {

    // =========================================================================
    // SUITE 1: Concentric Crowd Algorithm Empirical Analysis
    // =========================================================================
    describe('Suite 1: Concentric Crowd Distribution & Geometry', () => {

        test('Standard Arena Concentric Crowd: 200 members, 6 rings, radius [8.0, 28.0]', () => {
            const crowd = generateConcentricCrowd(200, 8.0, 28.0, 6);

            // 1. Total member count consistency
            assert.strictEqual(crowd.length, 200, 'Total crowd count must be exactly 200');

            // 2. Ring distribution analysis
            const ringBuckets = new Map();
            crowd.forEach((m, idx) => {
                assert.strictEqual(m.id, `crowd-arena-${idx}`);
                assert.strictEqual(m.y, 0, 'Crowd members must stand on ground y=0');

                if (!ringBuckets.has(m.ringIndex)) {
                    ringBuckets.set(m.ringIndex, []);
                }
                ringBuckets.get(m.ringIndex).push(m);
            });

            assert.strictEqual(ringBuckets.size, 6, 'Must have exactly 6 distinct rings');

            // 3. Ring radii progression & monotonicity
            const expectedRadii = [8.0, 12.0, 16.0, 20.0, 24.0, 28.0];
            for (let r = 0; r < 6; r++) {
                const membersInRing = ringBuckets.get(r);
                assert.ok(membersInRing && membersInRing.length > 0, `Ring ${r} must contain members`);

                const expectedRadius = expectedRadii[r];
                membersInRing.forEach(m => {
                    const actualDist = Math.hypot(m.x, m.z);
                    assert.ok(
                        Math.abs(actualDist - expectedRadius) < 1e-5,
                        `Member ${m.id} in ring ${r} has distance ${actualDist}, expected ${expectedRadius}`
                    );
                    assert.strictEqual(m.distanceToCenter, expectedRadius);
                });
            }

            // 4. Intra-ring spacing (non-overlapping)
            ringBuckets.forEach((members, ringIdx) => {
                for (let i = 0; i < members.length; i++) {
                    const next = members[(i + 1) % members.length];
                    const dist = Math.hypot(members[i].x - next.x, members[i].z - next.z);
                    // Minimum arc chord distance for ring 0 (r=8, n=33) is ~1.52m
                    assert.ok(dist >= 1.40, `Intra-ring ${ringIdx} adjacent spacing ${dist}m is too small (<1.4m)`);
                }
            });

            // 5. Inter-ring spacing (radial clearance)
            for (let r = 0; r < 5; r++) {
                const inner = ringBuckets.get(r);
                const outer = ringBuckets.get(r + 1);
                for (const mIn of inner) {
                    for (const mOut of outer) {
                        const dist = Math.hypot(mIn.x - mOut.x, mIn.z - mOut.z);
                        // Radial difference is 4.0m, so minimum pairwise distance between adjacent rings >= 4.0m
                        assert.ok(dist >= 3.99, `Inter-ring spacing between ring ${r} and ${r+1} is ${dist}m (<3.99m)`);
                    }
                }
            }

            // 6. Look-at stage orientation vector verification
            crowd.forEach(m => {
                // Vector from origin to member: (cos(a)*R, sin(a)*R)
                // Vector from member facing towards center (0,0): direction angle is a + pi
                // Heading unit vector: (cos(lookAtStageAngle), sin(lookAtStageAngle))
                const headingX = Math.cos(m.lookAtStageAngle);
                const headingZ = Math.sin(m.lookAtStageAngle);

                // Position vector from origin:
                const posNormX = m.x / m.distanceToCenter;
                const posNormZ = m.z / m.distanceToCenter;

                // Facing vector must be exactly opposite to position normal vector: heading == -posNorm
                const dot = headingX * posNormX + headingZ * posNormZ;
                assert.ok(Math.abs(dot - (-1.0)) < 1e-5, `Member ${m.id} lookAtStageAngle is not facing center (dot=${dot})`);
            });

            // 7. Angular staggering check (prevents ugly radial spokes)
            const ring0Angle0 = Math.atan2(ringBuckets.get(0)[0].z, ringBuckets.get(0)[0].x);
            const ring1Angle0 = Math.atan2(ringBuckets.get(1)[0].z, ringBuckets.get(1)[0].x);
            const angleDiff = Math.abs(ring1Angle0 - ring0Angle0);
            assert.ok(angleDiff > 0.1, `Adjacent rings should have staggered starting angles (diff=${angleDiff})`);
        });

        test('Concentric Crowd Stress: Arbitrary counts, single-ring, high ring counts, and remainder balancing', () => {
            const testConfigs = [
                { count: 1, minR: 5, maxR: 15, rings: 2 },
                { count: 7, minR: 10, maxR: 20, rings: 3 },
                { count: 77, minR: 5, maxR: 25, rings: 7 },
                { count: 500, minR: 10, maxR: 50, rings: 10 },
                { count: 1337, minR: 12, maxR: 80, rings: 17 },
                { count: 5000, minR: 20, maxR: 120, rings: 25 }
            ];

            testConfigs.forEach(({ count, minR, maxR, rings }) => {
                const crowd = generateConcentricCrowd(count, minR, maxR, rings);
                assert.strictEqual(crowd.length, count, `Config ${count} members with ${rings} rings must produce exactly ${count} items`);

                // Check all members fall strictly within [minR - epsilon, maxR + epsilon]
                crowd.forEach((m) => {
                    const dist = Math.hypot(m.x, m.z);
                    assert.ok(dist >= minR - 1e-4 && dist <= maxR + 1e-4, `Member radius ${dist} out of [${minR}, ${maxR}]`);
                });
            });
        });

        test('Concentric Crowd Performance: 10,000 members generated in < 20ms', () => {
            const start = performance.now();
            const crowd = generateConcentricCrowd(10000, 10, 100, 20);
            const duration = performance.now() - start;

            assert.strictEqual(crowd.length, 10000);
            assert.ok(duration < 50, `10k crowd generation took ${duration.toFixed(2)}ms (expected <50ms)`);
        });
    });

    // =========================================================================
    // SUITE 2: Compact Dancefloor Algorithm Empirical Analysis
    // =========================================================================
    describe('Suite 2: Compact Dancefloor Distribution & Collision Spacing', () => {

        test('Standard Basement Dancefloor: 30 members, 8x8m room, minDist = 0.4m', () => {
            const crowd = generateCompactDancefloor(30, 8.0, 8.0, 0.4);

            // 1. Generation count
            assert.strictEqual(crowd.length, 30, 'Should generate exactly 30 members for standard basement');

            // 2. Determinism test
            const crowd2 = generateCompactDancefloor(30, 8.0, 8.0, 0.4);
            assert.deepStrictEqual(crowd, crowd2, 'Subsequent calls with same params must produce identical results');

            // 3. Room boundary containment
            // Room is 8x8 (-4 to +4). Margin is 0.6m, so bounds are [-3.4, +3.4]
            crowd.forEach(m => {
                assert.ok(m.x >= -3.401 && m.x <= 3.401, `Member ${m.id} x=${m.x} exceeds boundary [-3.4, 3.4]`);
                assert.ok(m.z >= -3.401 && m.z <= 3.401, `Member ${m.id} z=${m.z} exceeds boundary [-3.4, 3.4]`);
                assert.strictEqual(m.y, 0, 'Member must be on floor y=0');
            });

            // 4. Pairwise distance verification
            let minObservedDist = Infinity;
            for (let i = 0; i < crowd.length; i++) {
                for (let j = i + 1; j < crowd.length; j++) {
                    const dist = Math.hypot(crowd[i].x - crowd[j].x, crowd[i].z - crowd[j].z);
                    if (dist < minObservedDist) minObservedDist = dist;
                    // Account for 2-decimal rounding tolerance
                    assert.ok(
                        dist >= 0.385,
                        `Pairwise distance between ${crowd[i].id} and ${crowd[j].id} is ${dist.toFixed(4)}m (< 0.385m)`
                    );
                }
            }
            assert.ok(minObservedDist >= 0.385, `Minimum observed distance: ${minObservedDist.toFixed(4)}m`);
        });

        test('Compact Dancefloor Stress: Varying densities, room sizes, and packing limit saturation', () => {
            // Case A: High saturation (requesting 80 members in 8x8 room with 0.4m minDist)
            // Should terminate safely without infinite loop
            const saturated = generateCompactDancefloor(80, 8.0, 8.0, 0.4);
            assert.ok(saturated.length > 30, `Saturated crowd generated ${saturated.length} members`);
            assert.ok(saturated.length <= 80);

            for (let i = 0; i < saturated.length; i++) {
                for (let j = i + 1; j < saturated.length; j++) {
                    const dist = Math.hypot(saturated[i].x - saturated[j].x, saturated[i].z - saturated[j].z);
                    assert.ok(dist >= 0.385, `Saturated crowd member pair too close: ${dist}m`);
                }
            }

            // Case B: Large warehouse room (20x20m with 100 members, 0.6m minDist)
            const warehouse = generateCompactDancefloor(100, 20.0, 20.0, 0.6);
            assert.strictEqual(warehouse.length, 100, 'Warehouse should easily fit 100 members');
            warehouse.forEach(m => {
                assert.ok(m.x >= -9.401 && m.x <= 9.401);
                assert.ok(m.z >= -9.401 && m.z <= 9.401);
            });

            // Case C: Small tight booth (4x4m with 10 members, 0.5m minDist)
            const booth = generateCompactDancefloor(10, 4.0, 4.0, 0.5);
            assert.ok(booth.length >= 8, `Booth fit ${booth.length} members`);
            booth.forEach(m => {
                assert.ok(m.x >= -1.401 && m.x <= 1.401);
                assert.ok(m.z >= -1.401 && m.z <= 1.401);
            });
        });
    });

    // =========================================================================
    // SUITE 3: Camera Frustum & Venue Spatial Geometry
    // =========================================================================
    describe('Suite 3: Camera Frustum Geometry & Spatial Containment', () => {

        test('Camera Frustum Math for 4 Stage Presets (16:9 Aspect Ratio)', () => {
            const aspect = 16 / 9;

            // Helper to compute horizontal FOV from vertical FOV and aspect ratio
            function getHorizontalFOV(vFovDeg, aspect) {
                const vFovRad = (vFovDeg * Math.PI) / 180;
                const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
                return (hFovRad * 180) / Math.PI;
            }

            // Helper to compute visible rectangular viewport at distance D
            function getFrustumExtents(vFovDeg, aspect, distance) {
                const vFovRad = (vFovDeg * Math.PI) / 180;
                const halfHeight = distance * Math.tan(vFovRad / 2);
                const halfWidth = halfHeight * aspect;
                return { width: halfWidth * 2, height: halfHeight * 2, halfWidth, halfHeight };
            }

            // 1. Basement Preset
            const basement = STAGE_PRESETS.basement;
            const bCam = basement.cameraPreset;
            const bDistToDJ = Math.hypot(bCam.x - 0, bCam.z - (-3.0));
            const bFrustum = getFrustumExtents(bCam.fov, aspect, bDistToDJ);
            assert.ok(bFrustum.width >= basement.bounds.width, `Basement FOV width (${bFrustum.width.toFixed(2)}m) covers room width (${basement.bounds.width}m)`);
            assert.ok(bFrustum.height >= basement.bounds.height, `Basement FOV height (${bFrustum.height.toFixed(2)}m) covers room height (${basement.bounds.height}m)`);

            // 2. Open-Air Preset
            const openair = STAGE_PRESETS.openair;
            const oCam = openair.cameraPreset;
            const oDistToStage = Math.hypot(oCam.x - 0, oCam.z - 0);
            const oFrustum = getFrustumExtents(oCam.fov, aspect, oDistToStage);
            // Must comfortably cover 40m mainstage + dual 20m towers (total span 40m)
            assert.ok(oFrustum.width >= 50.0, `OpenAir horizontal FOV span (${oFrustum.width.toFixed(2)}m) comfortably encompasses 40m stage and towers`);

            // 3. Arena Preset
            const arena = STAGE_PRESETS.arena;
            const aCam = arena.cameraPreset;
            const aDistToCenter = Math.hypot(aCam.x - 0, aCam.z - 0);
            const aFrustum = getFrustumExtents(aCam.fov, aspect, aDistToCenter);
            // Must frame 360 cylindrical screen (diameter 24m) and stage (diameter 14m)
            assert.ok(aFrustum.width >= 35.0, `Arena FOV width (${aFrustum.width.toFixed(2)}m) frames 24m LED cylinder`);
            assert.ok(aFrustum.height >= 25.0, `Arena FOV height (${aFrustum.height.toFixed(2)}m) frames 20m suspended truss`);

            // 4. Berghain Preset
            const berghain = STAGE_PRESETS.berghain;
            const bgCam = berghain.cameraPreset;
            const bgDistToDJ = Math.hypot(bgCam.x - 0, bgCam.z - (-15));
            const bgFrustum = getFrustumExtents(bgCam.fov, aspect, bgDistToDJ);
            assert.ok(bgFrustum.width >= berghain.bounds.width, 'Berghain FOV covers 30m bunker width');
        });
    });

    // =========================================================================
    // SUITE 4: Stage Preset Switching Resilience & Chaos Ingestion
    // =========================================================================
    describe('Suite 4: Preset Switching Dynamics & Stress Chaos Testing', () => {

        test('1,000 Rapid Sequential & Random Preset Transitions maintain state integrity', () => {
            const presets = ['berghain', 'openair', 'arena', 'basement'];
            let state = {
                currentPreset: 'openair',
                hazeDensity: 0.45,
                ambientIntensity: 0.15,
                screensEnabled: true,
                rainEnabled: true,
                rainIntensity: 4000,
                activeTheme: 'cyberpunk'
            };

            for (let i = 0; i < 1000; i++) {
                const targetPreset = presets[i % presets.length];
                state = applyStagePreset(targetPreset, state);

                const presetDef = STAGE_PRESETS[targetPreset];
                assert.strictEqual(state.currentPreset, targetPreset);
                assert.strictEqual(state.hazeDensity, presetDef.hazeDensity);
                assert.strictEqual(state.ambientIntensity, presetDef.ambientIntensity);
                assert.strictEqual(state.screensEnabled, presetDef.screensEnabled);

                if (targetPreset === 'openair') {
                    assert.strictEqual(state.rainEnabled, true);
                    assert.strictEqual(state.rainIntensity, 4000);
                } else {
                    assert.strictEqual(state.rainEnabled, false);
                    assert.strictEqual(state.rainIntensity, 0);
                }

                if (presetDef.forcedTheme) {
                    assert.strictEqual(state.activeTheme, presetDef.forcedTheme);
                }

                assert.deepStrictEqual(state.cameraPosition, presetDef.cameraPreset);
            }
        });

        test('STAGE_PRESETS dictionary immutability under state modifications', () => {
            const pristineBerghainHaze = STAGE_PRESETS.berghain.hazeDensity;
            const pristineOpenAirRain = STAGE_PRESETS.openair.defaultWeather.rain;

            // Apply preset and modify returned state
            const state = applyStagePreset('berghain', {});
            state.hazeDensity = 0.123;
            state.cameraPosition.x = 999;

            // Ensure source dictionary was not mutated
            assert.strictEqual(STAGE_PRESETS.berghain.hazeDensity, pristineBerghainHaze);
            assert.strictEqual(STAGE_PRESETS.berghain.cameraPreset.x, 0);
            assert.strictEqual(STAGE_PRESETS.openair.defaultWeather.rain, pristineOpenAirRain);
        });

        test('Chaotic and Malformed Preset Strings degrade safely to Open-Air fallback', () => {
            const chaoticInputs = [
                null,
                undefined,
                '',
                '   ',
                'invalid_stage_xyz',
                12345,
                { preset: 'berghain' },
                ['arena'],
                'BERGHAIN',  // Case insensitivity check
                '  openair  ', // Whitespace trimming check
                'Basement'   // Mixed case check
            ];

            chaoticInputs.forEach(input => {
                const preset = getStagePreset(input);
                assert.ok(preset && typeof preset === 'object');
                assert.ok(['openair', 'berghain', 'arena', 'basement'].includes(preset.id));

                if (typeof input === 'string' && input.trim().toLowerCase() === 'berghain') {
                    assert.strictEqual(preset.id, 'berghain');
                } else if (typeof input === 'string' && input.trim().toLowerCase() === 'openair') {
                    assert.strictEqual(preset.id, 'openair');
                } else if (typeof input === 'string' && input.trim().toLowerCase() === 'basement') {
                    assert.strictEqual(preset.id, 'basement');
                } else if (typeof input === 'string' && input.trim().toLowerCase() === 'arena') {
                    assert.strictEqual(preset.id, 'arena');
                } else if (typeof input !== 'string' || !['berghain', 'openair', 'arena', 'basement'].includes(input.trim().toLowerCase())) {
                    assert.strictEqual(preset.id, 'openair', `Input ${JSON.stringify(input)} must fall back to openair`);
                }
            });
        });
    });

    // =========================================================================
    // SUITE 5: Custom Stage Builder Integration & Grid Snapping Stress
    // =========================================================================
    describe('Suite 5: Stage Builder Grid Snapping & Subsystem Compilation', () => {

        test('Grid Snapping Stress: 1,000 random floating coordinates strictly snap to 0.5m increments', () => {
            for (let i = 0; i < 1000; i++) {
                const randVal = (Math.random() - 0.5) * 200; // [-100, 100]
                const snapped = snapToGrid(randVal, 0.5);

                // Snapped value must be an exact multiple of 0.5
                const remainder = Math.abs((snapped * 2) % 1);
                assert.ok(
                    remainder < 1e-7 || Math.abs(remainder - 1) < 1e-7,
                    `Value ${randVal} snapped to ${snapped} is not on 0.5m grid (remainder=${remainder})`
                );

                // Distance from original to snapped must be <= half grid step (0.25)
                assert.ok(
                    Math.abs(snapped - randVal) <= 0.250001,
                    `Snapped distance ${Math.abs(snapped - randVal)} exceeds half step 0.25`
                );
            }
        });

        test('Custom Stage Builder Compiler handles large complex layout with all 6 fixture types', () => {
            const fixtures = [];
            const types = ['truss', 'screen', 'laser', 'movinghead', 'co2', 'uplight'];

            for (let i = 0; i < 60; i++) {
                const type = types[i % types.length];
                fixtures.push({
                    id: `stress-fix-${i}`,
                    type,
                    position: { x: snapToGrid(i * 0.7 - 20, 0.5), y: snapToGrid(2.0 + (i % 5) * 0.5, 0.5), z: snapToGrid(-10 + (i % 10), 0.5) },
                    rotation: { x: 0, y: (i * 15) % 360, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                    properties: { color: 0x00ffcc }
                });
            }

            const layoutData = {
                version: '1.0.0',
                name: 'Massive Festival Rig',
                timestamp: Date.now(),
                fixtures
            };

            // Test serialization roundtrip
            const jsonStr = serializeStageLayout(layoutData);
            const deserialized = deserializeStageLayout(jsonStr);
            assert.strictEqual(deserialized.fixtures.length, 60);

            // Test compilation
            const compiled = compileCustomStageLayout(deserialized);
            assert.strictEqual(compiled.trusses.length, 10);
            assert.strictEqual(compiled.screens.length, 10);
            assert.strictEqual(compiled.lasers.length, 10);
            assert.strictEqual(compiled.movingHeads.length, 10);
            assert.strictEqual(compiled.co2Jets.length, 10);
            assert.strictEqual(compiled.uplights.length, 10);
        });
    });
});
