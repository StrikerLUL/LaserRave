import assert from 'node:assert';
import { test, describe } from 'node:test';
import * as THREE from 'three';
import {
    STAGE_BUILDER_CONFIG,
    snapToGrid,
    snapVector3,
    normalizeYaw,
    clampToBounds,
    validateFixture,
    serializeStageLayout,
    deserializeStageLayout,
    saveLayoutToStorage,
    loadLayoutFromStorage,
    compileCustomStageLayout,
    getTemplateLayout
} from '../src/StageBuilder.js';
import {
    STAGE_PRESETS,
    getStagePreset,
    generateConcentricCrowd,
    generateCompactDancefloor,
    applyStagePreset,
    createProceduralStarfield,
    createNeonSign
} from '../src/StagePresets.js';

describe('Adversarial Stress Test: Milestone 1 (R1 Stage Builder & R2 Presets)', () => {

    describe('1. Coordinate Snapping & Geometry Math Under Extreme Values', () => {
        test('snapToGrid handles signed negative zero (-0) returning +0', () => {
            const res = snapToGrid(-0);
            assert.strictEqual(res, 0);
            assert.strictEqual(Object.is(res, -0), false, 'snapToGrid(-0) must not return -0');
        });

        test('snapToGrid handles non-finite coordinate values (NaN, +/-Infinity)', () => {
            assert.strictEqual(snapToGrid(NaN), 0);
            assert.strictEqual(snapToGrid(Infinity), 0);
            assert.strictEqual(snapToGrid(-Infinity), 0);
            assert.strictEqual(snapToGrid(1e-12), 0);
            assert.strictEqual(snapToGrid(-1e-12), 0);
        });

        test('snapToGrid handles non-numeric types gracefully', () => {
            const badInputs = [null, undefined, '', '123', true, false, [], {}, () => {}];
            for (let i = 0; i < badInputs.length; i++) {
                assert.strictEqual(snapToGrid(badInputs[i]), 0);
            }
        });

        test('snapToGrid returns original value when step is invalid, non-finite, zero, or negative', () => {
            assert.strictEqual(snapToGrid(2.5, NaN), 2.5);
            assert.strictEqual(snapToGrid(2.5, Infinity), 2.5);
            assert.strictEqual(snapToGrid(2.5, -Infinity), 2.5);
            assert.strictEqual(snapToGrid(2.5, 0), 2.5);
            assert.strictEqual(snapToGrid(2.5, -0.5), 2.5);
            assert.strictEqual(snapToGrid(2.5, 'bad_step'), 2.5);
            assert.strictEqual(snapToGrid(2.5, null), 2.5);
        });

        test('snapVector3 handles null, empty, or partial objects without throwing', () => {
            assert.deepStrictEqual(snapVector3(null), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(snapVector3(undefined), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(snapVector3({}), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(snapVector3({ x: 1.24 }), { x: 1.0, y: 0, z: 0 });
            assert.deepStrictEqual(snapVector3({ y: 5.76 }), { x: 0, y: 6.0, z: 0 });
            assert.deepStrictEqual(snapVector3({ z: -3.26 }), { x: 0, y: 0, z: -3.5 });
            assert.deepStrictEqual(snapVector3({ x: NaN, y: Infinity, z: 'foo' }), { x: 0, y: 0, z: 0 });
        });

        test('clampToBounds clamps boundary overflow coordinates strictly to box limits and handles null/undefined safely', () => {
            assert.deepStrictEqual(clampToBounds({ x: 99999, y: 99999, z: 99999 }), { x: 50, y: 30, z: 50 });
            assert.deepStrictEqual(clampToBounds({ x: -99999, y: -99999, z: -99999 }), { x: -50, y: 0, z: -50 });
            assert.deepStrictEqual(clampToBounds({}), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds(null), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds(undefined), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds({ x: 25, y: 15, z: -25 }), { x: 25, y: 15, z: -25 });
        });

        test('normalizeYaw normalizes angles across full circle wraps and negative angles, preventing -0', () => {
            const twoPi = Math.PI * 2;
            assert.strictEqual(normalizeYaw(0), 0);
            assert.strictEqual(normalizeYaw(-0), 0);
            assert.strictEqual(Object.is(normalizeYaw(-0), -0), false, 'normalizeYaw(-0) must return +0');
            assert.strictEqual(normalizeYaw(twoPi), 0);
            const wrapped = normalizeYaw(twoPi * 10 + Math.PI / 2);
            assert.ok(Math.abs(wrapped - Math.PI / 2) < 1e-12);
            assert.strictEqual(normalizeYaw(-Math.PI / 2), Math.PI * 1.5);
            assert.strictEqual(normalizeYaw(NaN), 0);
            assert.strictEqual(normalizeYaw(Infinity), 0);
            assert.strictEqual(normalizeYaw(-Infinity), 0);
            assert.strictEqual(normalizeYaw(null), 0);
        });
    });

    describe('2. Serialization / Deserialization Malformed Payloads', () => {
        test('validateFixture rejects malformed, incomplete, and adversarial objects', () => {
            const badFixtures = [
                null,
                undefined,
                123,
                'fixture',
                {},
                { id: '' },
                { id: 'f1', type: 'unknown_type' },
                { id: 'f1', type: 'laser' },
                { id: 'f1', type: 'laser', position: {} },
                { id: 'f1', type: 'laser', position: { x: 1, y: 2 } },
                { id: 'f1', type: 'laser', position: { x: '1', y: 2, z: 3 } },
                { id: 'f1', type: 'laser', position: { x: NaN, y: 0, z: 0 } },
                { id: 'f1', type: 'laser', position: { x: 0, y: Infinity, z: 0 } },
                { id: 'f1', type: 'laser', position: { x: 0, y: 0, z: -Infinity } },
                { id: 12345, type: 'laser', position: { x: 0, y: 0, z: 0 } }
            ];

            for (let i = 0; i < badFixtures.length; i++) {
                const res = validateFixture(badFixtures[i]);
                assert.strictEqual(res.valid, false, 'Expected fixture to be invalid: index ' + i);
            }
        });

        test('deserializeStageLayout returns null on completely corrupted / truncated JSON', () => {
            const malformedStrings = [
                '',
                '   ',
                '{',
                '{ version:',
                '{version: 1.0.0, fixtures: [',
                '{version: 1.0.0, fixtures: [{id: f1',
                '<html><body>Not JSON</body></html>',
                'undefined',
                'null',
                '12345',
                'true',
                '[]',
                '{version: null}',
                '{fixtures: not_an_array}'
            ];

            for (let i = 0; i < malformedStrings.length; i++) {
                const res = deserializeStageLayout(malformedStrings[i]);
                assert.strictEqual(res, null, 'Expected deserialize to fail for index ' + i);
            }
        });

        test('deserializeStageLayout filters out corrupt fixtures and keeps valid ones', () => {
            const payload = JSON.stringify({
                version: '1.0.0',
                name: 'Partial Corrupt Stage',
                fixtures: [
                    { id: 'valid-1', type: 'laser', position: { x: 0, y: 5, z: 0 } },
                    { id: 'bad-1', type: 'invalid_type', position: { x: 0, y: 0, z: 0 } },
                    { id: 'bad-2', type: 'laser', position: { x: NaN, y: 0, z: 0 } },
                    null,
                    { id: 'valid-2', type: 'movinghead', position: { x: 5, y: 10, z: -5 } }
                ]
            });

            const res = deserializeStageLayout(payload);
            assert.ok(res);
            assert.strictEqual(res.name, 'Partial Corrupt Stage');
            assert.strictEqual(res.fixtures.length, 2);
            assert.strictEqual(res.fixtures[0].id, 'valid-1');
            assert.strictEqual(res.fixtures[1].id, 'valid-2');
        });

        test('serializeStageLayout enforces max 500 fixture limit and validates all entries', () => {
            assert.throws(() => serializeStageLayout(null), /Layout must be an object/);
            assert.throws(() => serializeStageLayout('not an object'), /Layout must be an object/);
            assert.throws(() => {
                serializeStageLayout({
                    fixtures: [{ id: 'f1', type: 'invalid_laser', position: { x: 0, y: 0, z: 0 } }]
                });
            }, /Invalid fixture at index 0/);

            const overLimit = {
                fixtures: Array.from({ length: 501 }, (_, i) => ({
                    id: 'f-' + i,
                    type: 'laser',
                    position: { x: 0, y: 0, z: 0 }
                }))
            };
            assert.throws(() => serializeStageLayout(overLimit), /Fixture count exceeds maximum limit/);
        });

        test('Round-trip serialization preserves exact coordinate and rotation properties', () => {
            const original = {
                version: '1.0.0',
                name: 'Precision Test Stage',
                fixtures: [
                    {
                        id: 'fix-1',
                        type: 'laser',
                        position: { x: 12.5, y: 6.0, z: -8.5 },
                        rotation: { x: 0, y: 1.57, z: 0 },
                        scale: { x: 2, y: 2, z: 2 },
                        properties: { color: 0x00ff00, power: 15 }
                    },
                    {
                        id: 'fix-2',
                        type: 'co2',
                        position: { x: -4.0, y: 0.5, z: 1.0 },
                        rotation: { x: -0.2, y: 0, z: 0 },
                        scale: { x: 1, y: 1, z: 1 },
                        properties: { burstDuration: 1.2 }
                    }
                ]
            };

            const serialized = serializeStageLayout(original);
            const deserialized = deserializeStageLayout(serialized);

            assert.deepStrictEqual(deserialized.fixtures, original.fixtures);
        });
    });

    describe('3. LocalStorage Recovery & State Persistence', () => {
        test('loadLayoutFromStorage falls back when localStorage contains invalid JSON', () => {
            const corruptedMockStorage = {
                getItem: () => '{{CORRUPTED_GARBAGE_DATA>>!!',
                setItem: () => {}
            };
            const res = loadLayoutFromStorage(corruptedMockStorage, 'Small Club');
            assert.ok(res);
            assert.strictEqual(res.name, 'Small Club Template');
            assert.strictEqual(res.fixtures.length, 5);
        });

        test('loadLayoutFromStorage handles throwing storage (private browsing / sandboxed iframe)', () => {
            const throwingMockStorage = {
                getItem: () => {
                    const err = new Error('The operation is insecure');
                    err.name = 'SecurityError';
                    throw err;
                },
                setItem: () => {}
            };
            const res = loadLayoutFromStorage(throwingMockStorage, 'Large Festival');
            assert.ok(res);
            assert.strictEqual(res.name, 'Large Festival Template');
            assert.strictEqual(res.fixtures.length, 8);
        });

        test('saveLayoutToStorage handles throwing storage (QuotaExceededError / SecurityError)', () => {
            const throwingMockStorage = {
                getItem: () => null,
                setItem: () => {
                    const err = new Error('Quota exceeded');
                    err.name = 'QuotaExceededError';
                    throw err;
                }
            };
            const layout = getTemplateLayout('Small Club');
            assert.doesNotThrow(() => {
                const jsonStr = saveLayoutToStorage(layout, throwingMockStorage);
                assert.ok(typeof jsonStr === 'string');
            });
        });

        test('saveLayoutToStorage handles null or missing storage gracefully without throwing', () => {
            const layout = getTemplateLayout('Small Club');
            assert.doesNotThrow(() => {
                const jsonStr = saveLayoutToStorage(layout, null);
                assert.ok(typeof jsonStr === 'string');
            });
        });
    });

    describe('4. Rapid Stage Preset Transitions & Stress', () => {
        test('getStagePreset safely handles Object prototype property collisions', () => {
            const protoKeys = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];
            for (let i = 0; i < protoKeys.length; i++) {
                const key = protoKeys[i];
                const preset = getStagePreset(key);
                assert.strictEqual(preset.id, 'openair', 'Expected prototype property key "' + key + '" to resolve to openair preset');
            }
        });

        test('Rapid preset switching cycles through all 4 presets without state degradation', () => {
            const presetIds = ['berghain', 'openair', 'arena', 'basement'];
            let state = {};

            for (let cycle = 0; cycle < 500; cycle++) {
                const presetId = presetIds[cycle % presetIds.length];
                state = applyStagePreset(presetId, state);

                assert.strictEqual(state.currentPreset, presetId);
                const spec = STAGE_PRESETS[presetId];

                assert.strictEqual(state.hazeDensity, spec.hazeDensity);
                assert.strictEqual(state.ambientIntensity, spec.ambientIntensity);
                assert.strictEqual(state.screensEnabled, spec.screensEnabled);

                if (spec.defaultWeather && spec.defaultWeather.rain) {
                    assert.strictEqual(state.rainEnabled, true);
                    assert.strictEqual(state.rainIntensity, spec.defaultWeather.intensity);
                } else {
                    assert.strictEqual(state.rainEnabled, false);
                    assert.strictEqual(state.rainIntensity, 0);
                }
            }
        });

        test('applyStagePreset does not mutate input state object', () => {
            const originalState = Object.freeze({
                currentPreset: 'openair',
                rainEnabled: true,
                rainIntensity: 4000,
                hazeDensity: 0.45,
                screensEnabled: true,
                cameraPosition: Object.freeze({ x: 0, y: 4, z: 32, fov: 65 })
            });

            assert.doesNotThrow(() => {
                const nextState = applyStagePreset('berghain', originalState);
                assert.strictEqual(nextState.currentPreset, 'berghain');
                assert.strictEqual(nextState.rainEnabled, false);
            });
        });

        test('Concentric crowd generator produces exact member count and valid radial distribution for ringCount >= 2', () => {
            const counts = [50, 100, 200, 350];
            for (let c = 0; c < counts.length; c++) {
                const count = counts[c];
                const crowd = generateConcentricCrowd(count, 8.0, 30.0, 5);
                assert.strictEqual(crowd.length, count, 'Expected crowd length ' + count);

                for (let i = 0; i < crowd.length; i++) {
                    const m = crowd[i];
                    assert.ok(Number.isFinite(m.x));
                    assert.ok(Number.isFinite(m.z));
                    assert.strictEqual(m.y, 0);
                    const r = Math.hypot(m.x, m.z);
                    assert.ok(r >= 7.99 && r <= 30.01, 'Radius ' + r + ' out of bounds for member ' + m.id);
                }
            }
        });

        test('Concentric crowd generator handles single ring (ringCount <= 1) without division-by-zero or NaN coordinates', () => {
            const testRingCounts = [1, 0, -1, -5];
            for (let r = 0; r < testRingCounts.length; r++) {
                const ringCount = testRingCounts[r];
                const crowd = generateConcentricCrowd(20, 5.0, 15.0, ringCount);
                assert.strictEqual(crowd.length, 20);

                for (let i = 0; i < crowd.length; i++) {
                    const m = crowd[i];
                    assert.ok(Number.isFinite(m.x), 'Member ' + m.id + ' x coordinate must be finite');
                    assert.ok(Number.isFinite(m.z), 'Member ' + m.id + ' z coordinate must be finite');
                    assert.strictEqual(m.y, 0);
                    assert.strictEqual(Number.isNaN(m.x), false);
                    assert.strictEqual(Number.isNaN(m.z), false);
                    const radius = Math.hypot(m.x, m.z);
                    assert.ok(radius >= 4.99 && radius <= 15.01, 'Radius ' + radius + ' out of bounds');
                }
            }
        });

        test('Compact dancefloor crowd generator strictly respects room boundaries and collision radius', () => {
            const roomW = 8.0;
            const roomD = 8.0;
            const minDist = 0.4;
            const crowd = generateCompactDancefloor(30, roomW, roomD, minDist);

            assert.ok(crowd.length >= 25);
            for (let i = 0; i < crowd.length; i++) {
                const m1 = crowd[i];
                assert.ok(Math.abs(m1.x) < roomW / 2);
                assert.ok(Math.abs(m1.z) < roomD / 2);

                for (let j = i + 1; j < crowd.length; j++) {
                    const m2 = crowd[j];
                    const dist = Math.hypot(m1.x - m2.x, m1.z - m2.z);
                    assert.ok(dist >= minDist - 0.01, 'Collision detected: dist ' + dist + ' < ' + minDist);
                }
            }
        });

        test('compileCustomStageLayout correctly partitions all 6 fixture types and handles unknown types', () => {
            const mixedLayout = {
                fixtures: [
                    { id: '1', type: 'laser' },
                    { id: '2', type: 'movinghead' },
                    { id: '3', type: 'screen' },
                    { id: '4', type: 'co2' },
                    { id: '5', type: 'uplight' },
                    { id: '6', type: 'truss' },
                    { id: '7', type: 'unknown_mystery' }
                ]
            };

            const compiled = compileCustomStageLayout(mixedLayout);
            assert.strictEqual(compiled.lasers.length, 1);
            assert.strictEqual(compiled.movingHeads.length, 1);
            assert.strictEqual(compiled.screens.length, 1);
            assert.strictEqual(compiled.co2Jets.length, 1);
            assert.strictEqual(compiled.uplights.length, 1);
            assert.strictEqual(compiled.trusses.length, 1);
            assert.strictEqual(compiled.totalCount, 7);
        });
    });
});
