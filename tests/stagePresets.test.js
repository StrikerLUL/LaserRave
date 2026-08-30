import assert from 'node:assert';
import { test, describe } from 'node:test';
import {
    STAGE_PRESETS,
    getStagePreset,
    generateConcentricCrowd,
    generateCompactDancefloor,
    applyStagePreset,
    createProceduralStarfield,
    createProceduralGrassTexture,
    createNeonSign
} from '../src/StagePresets.js';

export {
    STAGE_PRESETS,
    getStagePreset,
    generateConcentricCrowd,
    generateCompactDancefloor,
    applyStagePreset,
    createProceduralStarfield,
    createProceduralGrassTexture,
    createNeonSign
};


// ---------------------------------------------------------------------------
// TEST SUITE: R2 Stage Presets
// ---------------------------------------------------------------------------

describe('R2: Additional Stage Presets', () => {
    describe('Tier 1: Feature Coverage', () => {
        test('getStagePreset returns all 4 required presets with valid IDs', () => {
            const berghain = getStagePreset('berghain');
            const openair = getStagePreset('openair');
            const arena = getStagePreset('arena');
            const basement = getStagePreset('basement');

            assert.strictEqual(berghain.id, 'berghain');
            assert.strictEqual(openair.id, 'openair');
            assert.strictEqual(arena.id, 'arena');
            assert.strictEqual(basement.id, 'basement');
        });

        test('Berghain preset satisfies industrial bunker specifications', () => {
            const p = getStagePreset('berghain');
            assert.strictEqual(p.isIndoor, true);
            assert.strictEqual(p.bounds.height, 5.0, 'Berghain ceiling must be 5m');
            assert.strictEqual(p.screensEnabled, false, 'Berghain must have no LED screens');
            assert.strictEqual(p.screenCount, 0);
            assert.strictEqual(p.fixtures.movingHeads, 6, 'Berghain must have 6 center moving heads');
            assert.ok(p.hazeDensity >= 0.85, 'Berghain must have dense haze (>= 0.85)');
            assert.ok(p.ambientIntensity <= 0.05, 'Berghain must have very dark ambient');
            assert.strictEqual(p.forcedTheme, 'bloodmoon', 'Berghain forces dark/hard techno palette');
        });

        test('Open-Air Festival preset satisfies outdoor wide stage specifications', () => {
            const p = getStagePreset('openair');
            assert.strictEqual(p.isIndoor, false);
            assert.strictEqual(p.bounds.height, null, 'Open-Air must have open sky (no ceiling)');
            assert.strictEqual(p.bounds.width, 40.0, 'Open-Air stage width must be 40m');
            assert.strictEqual(p.ground.type, 'grass');
            assert.ok(p.starfield.enabled && p.starfield.count >= 1000);
            assert.strictEqual(p.towers.length, 2, 'Must have 2 truss towers');
            assert.strictEqual(p.towers[0].x, -20.0, 'Left tower at x = -20m');
            assert.strictEqual(p.towers[1].x, 20.0, 'Right tower at x = +20m');
            assert.strictEqual(p.defaultWeather.rain, true, 'Default weather should have rain enabled');
        });

        test('Arena preset satisfies 360-degree in-the-round specifications', () => {
            const p = getStagePreset('arena');
            assert.strictEqual(p.isIndoor, true);
            assert.strictEqual(p.circularTrussRig.suspendedHeight, 20.0, 'Circular truss at y = 20m');
            assert.ok(p.circularTrussRig.radius >= 15.0);
            assert.strictEqual(p.screenType, 'cylinder-360', 'Giant wrapping 360 LED screen');
            assert.strictEqual(p.crowd.topology, 'concentric-rings');
            assert.strictEqual(p.crowd.memberCount, 200, 'Arena must have 200 crowd members');
        });

        test('Basement Club preset satisfies compact 8x8x3m specifications and neon signs', () => {
            const p = getStagePreset('basement');
            assert.strictEqual(p.bounds.width, 8.0);
            assert.strictEqual(p.bounds.depth, 8.0);
            assert.strictEqual(p.bounds.height, 3.0, 'Basement height must be 3m');
            assert.strictEqual(p.fixtures.lasers, 2, '2 lasers');
            assert.strictEqual(p.fixtures.movingHeads, 4, '4 moving heads');
            assert.strictEqual(p.hazeDensity, 1.0, 'Maximum fog');

            const signTexts = p.neonSigns.map(s => s.text);
            assert.ok(signTexts.includes('NO PHOTOS'), 'Neon sign "NO PHOTOS" must exist');
            assert.ok(signTexts.includes('CLUB'), 'Neon sign "CLUB" must exist');
            assert.ok(signTexts.includes('RAVE'), 'Neon sign "RAVE" must exist');
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('generateConcentricCrowd generates exactly 200 members in rings within bounds', () => {
            const crowd = generateConcentricCrowd(200, 8.0, 28.0, 6);
            assert.strictEqual(crowd.length, 200);

            crowd.forEach((m, idx) => {
                const dist = Math.hypot(m.x, m.z);
                assert.ok(dist >= 7.99 && dist <= 28.01, `Member ${idx} radius ${dist} out of bounds`);
                assert.strictEqual(m.y, 0);
                assert.ok(typeof m.lookAtStageAngle === 'number');
            });
        });

        test('generateCompactDancefloor constrains crowd inside 8x8 room with min spacing', () => {
            const crowd = generateCompactDancefloor(30, 8.0, 8.0, 0.4);
            assert.ok(crowd.length >= 25, 'Should generate at least 25 dense crowd members');

            crowd.forEach((m, idx) => {
                assert.ok(m.x >= -3.5 && m.x <= 3.5, `Member ${idx} x ${m.x} exceeds room width`);
                assert.ok(m.z >= -3.5 && m.z <= 3.5, `Member ${idx} z ${m.z} exceeds room depth`);
            });

            // Pairwise minimum distance check
            for (let i = 0; i < crowd.length; i++) {
                for (let j = i + 1; j < crowd.length; j++) {
                    const dist = Math.hypot(crowd[i].x - crowd[j].x, crowd[i].z - crowd[j].z);
                    assert.ok(dist >= 0.39, `Members ${i} and ${j} too close: ${dist}m < 0.4m`);
                }
            }
        });

        test('getStagePreset falls back safely on invalid/null/empty preset identifiers', () => {
            assert.strictEqual(getStagePreset(null).id, 'openair');
            assert.strictEqual(getStagePreset(undefined).id, 'openair');
            assert.strictEqual(getStagePreset('').id, 'openair');
            assert.strictEqual(getStagePreset('unknown_stadium').id, 'openair');
        });

        test('Camera preset distances scale appropriately with venue dimensions', () => {
            const basementCam = getStagePreset('basement').cameraPreset;
            const arenaCam = getStagePreset('arena').cameraPreset;
            const openAirCam = getStagePreset('openair').cameraPreset;

            const basementDist = Math.hypot(basementCam.x, basementCam.z);
            const arenaDist = Math.hypot(arenaCam.x, arenaCam.z);
            const openAirDist = Math.hypot(openAirCam.x, openAirCam.z);

            assert.ok(basementDist < 6.0, `Basement cam distance ${basementDist}m should be tight (<6m)`);
            assert.ok(arenaDist >= 25.0, `Arena cam distance ${arenaDist}m should be wide (>=25m)`);
            assert.ok(openAirDist >= 30.0, `Open-Air cam distance ${openAirDist}m should be deep (>=30m)`);
        });

        test('Neon sign placements in Basement Club attach to room perimeter walls', () => {
            const basement = getStagePreset('basement');
            basement.neonSigns.forEach(sign => {
                const nearWall = Math.abs(Math.abs(sign.position.x) - 3.9) < 0.2 ||
                                 Math.abs(Math.abs(sign.position.z) - 3.9) < 0.2;
                assert.ok(nearWall, `Sign ${sign.text} at (${sign.position.x}, ${sign.position.z}) should be near 4m wall`);
                assert.ok(sign.position.y >= 1.5 && sign.position.y <= 2.8, `Sign height ${sign.position.y} should be below 3m ceiling`);
            });
        });
    });

    describe('Tier 3: Pairwise & Transitions', () => {
        test('Applying Open-Air preset enables rain; switching to Berghain disables rain and sets haze', () => {
            const initialState = {
                currentPreset: 'default',
                rainEnabled: false,
                rainIntensity: 0,
                hazeDensity: 0.5,
                screensEnabled: true
            };

            const state1 = applyStagePreset('openair', initialState);
            assert.strictEqual(state1.currentPreset, 'openair');
            assert.strictEqual(state1.rainEnabled, true);
            assert.strictEqual(state1.rainIntensity, 4000);
            assert.strictEqual(state1.screensEnabled, true);

            const state2 = applyStagePreset('berghain', state1);
            assert.strictEqual(state2.currentPreset, 'berghain');
            assert.strictEqual(state2.rainEnabled, false, 'Rain must be disabled in indoor bunker');
            assert.strictEqual(state2.hazeDensity, 0.90);
            assert.strictEqual(state2.screensEnabled, false);
            assert.strictEqual(state2.activeTheme, 'bloodmoon');
        });

        test('Applying Basement preset from Arena disables 360 screens and sets max haze', () => {
            const arenaState = applyStagePreset('arena', {});
            assert.strictEqual(arenaState.screensEnabled, true);

            const basementState = applyStagePreset('basement', arenaState);
            assert.strictEqual(basementState.screensEnabled, false);
            assert.strictEqual(basementState.hazeDensity, 1.0);
            assert.strictEqual(basementState.cameraPosition.fov, 80);
        });
    });
});
