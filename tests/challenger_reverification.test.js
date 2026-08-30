import assert from 'node:assert';
import { test, describe } from 'node:test';
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
    applyStagePreset
} from '../src/StagePresets.js';

describe('Challenger 1 Re-verification Suite: 6 Targeted Adversarial Challenges', () => {

    // Challenge 1: Storage exceptions in private mode / sandboxed iframes
    describe('Challenge 1: Storage Exceptions Gracefully Handled', () => {
        test('loadLayoutFromStorage handles throwing storage.getItem (SecurityError / DOMException)', () => {
            const privateBrowsingStorage = {
                getItem: () => {
                    const err = new Error('The operation is insecure.');
                    err.name = 'SecurityError';
                    err.code = 18;
                    throw err;
                },
                setItem: () => {}
            };

            let result;
            assert.doesNotThrow(() => {
                result = loadLayoutFromStorage(privateBrowsingStorage, 'Large Festival');
            });
            assert.ok(result, 'Expected valid fallback layout');
            assert.strictEqual(result.name, 'Large Festival Template');
            assert.strictEqual(result.fixtures.length, 8);
        });

        test('saveLayoutToStorage handles throwing storage.setItem (SecurityError / QuotaExceededError)', () => {
            const quotaExceededStorage = {
                getItem: () => null,
                setItem: () => {
                    const err = new Error('QuotaExceededError: The quota has been exceeded.');
                    err.name = 'QuotaExceededError';
                    err.code = 22;
                    throw err;
                }
            };

            const sampleLayout = getTemplateLayout('Small Club');
            let jsonOutput;
            assert.doesNotThrow(() => {
                jsonOutput = saveLayoutToStorage(sampleLayout, quotaExceededStorage);
            });
            assert.ok(typeof jsonOutput === 'string');
            const parsed = JSON.parse(jsonOutput);
            assert.strictEqual(parsed.name, 'Small Club Template');
        });

        test('Storage methods handle null / undefined storage object without crashing', () => {
            const sampleLayout = getTemplateLayout('Small Club');
            assert.doesNotThrow(() => {
                const out1 = saveLayoutToStorage(sampleLayout, null);
                assert.ok(typeof out1 === 'string');
                const out2 = saveLayoutToStorage(sampleLayout, undefined);
                assert.ok(typeof out2 === 'string');
            });

            assert.doesNotThrow(() => {
                const loaded1 = loadLayoutFromStorage(null, 'Small Club');
                assert.strictEqual(loaded1.name, 'Small Club Template');
                const loaded2 = loadLayoutFromStorage(undefined, 'Large Festival');
                assert.strictEqual(loaded2.name, 'Large Festival Template');
            });
        });
    });

    // Challenge 2: Prototype collision 'constructor' falls back to default preset
    describe('Challenge 2: Prototype Collisions in getStagePreset Fall Back to Openair', () => {
        const collisions = [
            'constructor',
            '__proto__',
            'prototype',
            'toString',
            'valueOf',
            'hasOwnProperty',
            'isPrototypeOf',
            'propertyIsEnumerable'
        ];

        for (const prop of collisions) {
            test(`getStagePreset('${prop}') safely returns STAGE_PRESETS.openair`, () => {
                const preset = getStagePreset(prop);
                assert.ok(preset, `Preset for '${prop}' must be defined`);
                assert.strictEqual(preset.id, 'openair');
                assert.strictEqual(preset.name, 'Open-Air Festival');
                assert.strictEqual(preset.ambientIntensity, 0.15);
            });
        }

        test('applyStagePreset with prototype collision key returns clean state without undefined corruption', () => {
            const initialState = {
                currentPreset: 'basement',
                ambientIntensity: 0.04,
                hazeDensity: 1.0,
                screensEnabled: false
            };

            const newState = applyStagePreset('constructor', initialState);
            assert.strictEqual(newState.currentPreset, 'openair');
            assert.strictEqual(newState.ambientIntensity, 0.15);
            assert.strictEqual(newState.hazeDensity, 0.45);
            assert.strictEqual(newState.screensEnabled, true);
            assert.strictEqual(newState.rainEnabled, true);
            assert.strictEqual(newState.rainIntensity, 4000);
            assert.notStrictEqual(newState.ambientIntensity, undefined);
            assert.notStrictEqual(newState.hazeDensity, undefined);
        });
    });

    // Challenge 3: ringCount <= 1 produces valid non-NaN coordinates
    describe('Challenge 3: generateConcentricCrowd with ringCount <= 1 Produces Valid Non-NaN Coordinates', () => {
        const edgeRingCounts = [1, 0, -1, -50, 0.2, NaN, null, undefined, 'bad'];

        for (const ringCount of edgeRingCounts) {
            test(`generateConcentricCrowd with ringCount=${ringCount} has zero NaN/Infinite coordinates`, () => {
                const totalCount = 40;
                const minR = 6.0;
                const maxR = 24.0;
                const crowd = generateConcentricCrowd(totalCount, minR, maxR, ringCount);

                assert.strictEqual(crowd.length, totalCount);

                for (let i = 0; i < crowd.length; i++) {
                    const member = crowd[i];
                    assert.ok(typeof member.x === 'number' && Number.isFinite(member.x), `Member ${i} x coordinate (${member.x}) must be finite`);
                    assert.ok(typeof member.y === 'number' && Number.isFinite(member.y), `Member ${i} y coordinate (${member.y}) must be finite`);
                    assert.ok(typeof member.z === 'number' && Number.isFinite(member.z), `Member ${i} z coordinate (${member.z}) must be finite`);
                    assert.strictEqual(Number.isNaN(member.x), false, `Member ${i} x cannot be NaN`);
                    assert.strictEqual(Number.isNaN(member.z), false, `Member ${i} z cannot be NaN`);
                    assert.strictEqual(member.y, 0);

                    const radius = Math.hypot(member.x, member.z);
                    assert.ok(radius >= minR - 0.001 && radius <= maxR + 0.001, `Member ${i} radius ${radius} out of bounds [${minR}, ${maxR}]`);
                }
            });
        }
    });

    // Challenge 4: Non-finite step in snapToGrid returns val
    describe('Challenge 4: snapToGrid Returns Original val on Non-Finite / Invalid Step', () => {
        test('snapToGrid returns val for non-finite steps', () => {
            assert.strictEqual(snapToGrid(3.14159, NaN), 3.14159);
            assert.strictEqual(snapToGrid(3.14159, Infinity), 3.14159);
            assert.strictEqual(snapToGrid(3.14159, -Infinity), 3.14159);
            assert.strictEqual(snapToGrid(12.75, 0), 12.75);
            assert.strictEqual(snapToGrid(12.75, -0.5), 12.75);
            assert.strictEqual(snapToGrid(12.75, '0.5'), 12.75);
            assert.strictEqual(snapToGrid(12.75, null), 12.75);
            assert.strictEqual(snapToGrid(12.75, {}), 12.75);
            assert.strictEqual(snapToGrid(12.75, () => {}), 12.75);
        });

        test('snapToGrid with valid step still snaps correctly', () => {
            assert.strictEqual(snapToGrid(0.24, 0.5), 0);
            assert.strictEqual(snapToGrid(0.26, 0.5), 0.5);
            assert.strictEqual(snapToGrid(1.8, 1.0), 2.0);
            assert.strictEqual(snapToGrid(1.2, 0.25), 1.25);
        });
    });

    // Challenge 5: clampToBounds(null) safely returns clamped { x: 0, y: 0, z: 0 }
    describe('Challenge 5: clampToBounds(null) and Undefined / Corrupted Inputs', () => {
        test('clampToBounds(null) returns clamped { x: 0, y: 0, z: 0 }', () => {
            const res = clampToBounds(null);
            assert.deepStrictEqual(res, { x: 0, y: 0, z: 0 });
        });

        test('clampToBounds(undefined) returns clamped { x: 0, y: 0, z: 0 }', () => {
            const res = clampToBounds(undefined);
            assert.deepStrictEqual(res, { x: 0, y: 0, z: 0 });
        });

        test('clampToBounds with partial / corrupt vector properties', () => {
            assert.deepStrictEqual(clampToBounds({}), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds({ x: 'abc', y: null, z: undefined }), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds({ x: NaN, y: Infinity, z: -Infinity }), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds({ x: 10, y: NaN }), { x: 10, y: 0, z: 0 });
            assert.deepStrictEqual(clampToBounds({ x: 100, y: 50, z: -100 }), { x: 50, y: 30, z: -50 });
        });
    });

    // Challenge 6: normalizeYaw(-0) returns +0
    describe('Challenge 6: normalizeYaw(-0) Returns Canonical +0', () => {
        test('normalizeYaw(-0) returns +0 without negative zero sign bit', () => {
            const res = normalizeYaw(-0);
            assert.strictEqual(res, 0);
            assert.strictEqual(Object.is(res, -0), false, 'normalizeYaw(-0) must not be -0');
            assert.strictEqual(Object.is(res, +0), true, 'normalizeYaw(-0) must be +0');
        });

        test('normalizeYaw(0) returns +0', () => {
            const res = normalizeYaw(0);
            assert.strictEqual(res, 0);
            assert.strictEqual(Object.is(res, +0), true);
        });

        test('normalizeYaw(-2 * Math.PI) returns +0', () => {
            const res = normalizeYaw(-2 * Math.PI);
            assert.strictEqual(res, 0);
            assert.strictEqual(Object.is(res, -0), false);
            assert.strictEqual(Object.is(res, +0), true);
        });

        test('normalizeYaw with non-finite inputs returns 0', () => {
            assert.strictEqual(normalizeYaw(NaN), 0);
            assert.strictEqual(normalizeYaw(Infinity), 0);
            assert.strictEqual(normalizeYaw(-Infinity), 0);
            assert.strictEqual(normalizeYaw('angle'), 0);
            assert.strictEqual(normalizeYaw(null), 0);
            assert.strictEqual(normalizeYaw(undefined), 0);
        });
    });
});
