import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
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

export {
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
};


// ---------------------------------------------------------------------------
// TEST SUITE: R1 Custom Stage Builder
// ---------------------------------------------------------------------------

describe('R1: Custom Stage Builder', () => {
    let mockStorage;

    beforeEach(() => {
        const store = {};
        mockStorage = {
            getItem: (k) => store[k] ?? null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
            clear: () => { for (const k in store) delete store[k]; }
        };
    });

    describe('Tier 1: Feature Coverage', () => {
        test('snapToGrid snaps coordinates to 0.5m grid step correctly', () => {
            assert.strictEqual(snapToGrid(0.0), 0.0);
            assert.strictEqual(snapToGrid(0.24), 0.0);
            assert.strictEqual(snapToGrid(0.26), 0.5);
            assert.strictEqual(snapToGrid(0.49), 0.5);
            assert.strictEqual(snapToGrid(0.74), 0.5);
            assert.strictEqual(snapToGrid(0.76), 1.0);
            assert.strictEqual(snapToGrid(1.24), 1.0);
            assert.strictEqual(snapToGrid(1.25), 1.5);
            assert.strictEqual(snapToGrid(-0.24), 0.0);
            assert.strictEqual(snapToGrid(-0.26), -0.5);
            assert.strictEqual(snapToGrid(-0.76), -1.0);
        });

        test('snapVector3 snaps all 3 components of a 3D position vector', () => {
            const raw = { x: 3.12, y: 12.49, z: -7.88 };
            const snapped = snapVector3(raw, 0.5);
            assert.strictEqual(snapped.x, 3.0);
            assert.strictEqual(snapped.y, 12.5);
            assert.strictEqual(snapped.z, -8.0);
        });

        test('validateFixture validates all 6 supported fixture types', () => {
            const types = ['truss', 'screen', 'laser', 'movinghead', 'co2', 'uplight'];
            types.forEach((type, idx) => {
                const fixture = {
                    id: `fix-${idx}`,
                    type,
                    position: { x: idx * 2.0, y: 5.0, z: 0.0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                    properties: {}
                };
                const result = validateFixture(fixture);
                assert.strictEqual(result.valid, true, `Expected ${type} to be valid`);
            });
        });

        test('serializeStageLayout produces schema-compliant JSON payload', () => {
            const layout = {
                version: '1.0.0',
                name: 'Main Stage',
                timestamp: 1724400000000,
                fixtures: [
                    { id: 'f1', type: 'laser', position: { x: 0, y: 5, z: 0 } },
                    { id: 'f2', type: 'movinghead', position: { x: 2, y: 6, z: 0 } }
                ]
            };
            const json = serializeStageLayout(layout);
            const parsed = JSON.parse(json);
            assert.strictEqual(parsed.version, '1.0.0');
            assert.strictEqual(parsed.name, 'Main Stage');
            assert.strictEqual(parsed.timestamp, 1724400000000);
            assert.strictEqual(parsed.fixtures.length, 2);
            assert.strictEqual(parsed.fixtures[0].id, 'f1');
            assert.strictEqual(parsed.fixtures[0].type, 'laser');
        });

        test('deserializeStageLayout correctly restores fixtures from JSON string', () => {
            const rawJson = JSON.stringify({
                version: '1.0.0',
                name: 'Restored Stage',
                fixtures: [
                    { id: 'f-screen', type: 'screen', position: { x: 0, y: 10, z: -5 } }
                ]
            });
            const restored = deserializeStageLayout(rawJson);
            assert.ok(restored);
            assert.strictEqual(restored.name, 'Restored Stage');
            assert.strictEqual(restored.fixtures.length, 1);
            assert.strictEqual(restored.fixtures[0].type, 'screen');
        });

        test('compileCustomStageLayout distributes fixtures into correct engine subsystems', () => {
            const layout = {
                fixtures: [
                    { id: 'l1', type: 'laser', position: { x: 0, y: 0, z: 0 } },
                    { id: 'l2', type: 'laser', position: { x: 1, y: 0, z: 0 } },
                    { id: 'mh1', type: 'movinghead', position: { x: 2, y: 0, z: 0 } },
                    { id: 'scr1', type: 'screen', position: { x: 3, y: 0, z: 0 } },
                    { id: 'co2_1', type: 'co2', position: { x: 4, y: 0, z: 0 } },
                    { id: 'up1', type: 'uplight', position: { x: 5, y: 0, z: 0 } },
                    { id: 'tr1', type: 'truss', position: { x: 6, y: 0, z: 0 } }
                ]
            };
            const compiled = compileCustomStageLayout(layout);
            assert.strictEqual(compiled.lasers.length, 2);
            assert.strictEqual(compiled.movingHeads.length, 1);
            assert.strictEqual(compiled.screens.length, 1);
            assert.strictEqual(compiled.co2Jets.length, 1);
            assert.strictEqual(compiled.uplights.length, 1);
            assert.strictEqual(compiled.trusses.length, 1);
            assert.strictEqual(compiled.totalCount, 7);
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('snapToGrid handles extreme values and non-finite inputs gracefully', () => {
            assert.strictEqual(snapToGrid(0), 0);
            assert.strictEqual(snapToGrid(-0), 0);
            assert.strictEqual(snapToGrid(1e6 + 0.26), 1e6 + 0.5);
            assert.strictEqual(snapToGrid(-1e6 - 0.26), -1e6 - 0.5);
            assert.strictEqual(snapToGrid(NaN), 0);
            assert.strictEqual(snapToGrid(Infinity), 0);
            assert.strictEqual(snapToGrid(-Infinity), 0);
            assert.strictEqual(snapToGrid('not_a_number'), 0);
        });

        test('snapToGrid supports arbitrary positive grid steps', () => {
            assert.strictEqual(snapToGrid(2.3, 1.0), 2.0);
            assert.strictEqual(snapToGrid(2.7, 1.0), 3.0);
            assert.strictEqual(snapToGrid(0.33, 0.1), 0.3);
            assert.strictEqual(snapToGrid(0.37, 0.1), 0.4);
            assert.strictEqual(snapToGrid(7.4, 2.5), 7.5);
            assert.strictEqual(snapToGrid(8.8, 2.5), 10.0);
        });

        test('validateFixture rejects invalid fixture types and malformed schemas', () => {
            assert.strictEqual(validateFixture(null).valid, false);
            assert.strictEqual(validateFixture({}).valid, false);
            assert.strictEqual(validateFixture({ id: 123, type: 'laser' }).valid, false);
            assert.strictEqual(validateFixture({ id: 'fix-1', type: 'fire_cannon' }).valid, false);
            assert.strictEqual(validateFixture({ id: 'fix-1', type: 'laser', position: { x: NaN, y: 0, z: 0 } }).valid, false);
            assert.strictEqual(validateFixture({ id: 'fix-1', type: 'laser', position: { x: 0, y: '5', z: 0 } }).valid, false);
            assert.strictEqual(validateFixture({ id: 'fix-1', type: 'laser', position: null }).valid, false);
        });

        test('serializeStageLayout throws when fixture count exceeds maxFixtures limit', () => {
            const oversized = {
                fixtures: Array.from({ length: 501 }, (_, i) => ({
                    id: `fix-${i}`,
                    type: 'laser',
                    position: { x: 0, y: 0, z: 0 }
                }))
            };
            assert.throws(() => {
                serializeStageLayout(oversized);
            }, /Fixture count exceeds maximum limit/);
        });

        test('loadLayoutFromStorage falls back to default template on corrupt storage', () => {
            mockStorage.setItem(STAGE_BUILDER_CONFIG.storageKey, '{ invalid json string');
            const loaded = loadLayoutFromStorage(mockStorage, 'Large Festival');
            assert.ok(loaded);
            assert.strictEqual(loaded.name, 'Large Festival Template');
            assert.ok(loaded.fixtures.length > 0);
        });

        test('loadLayoutFromStorage falls back when storage key is missing', () => {
            const loaded = loadLayoutFromStorage(mockStorage, 'Small Club');
            assert.ok(loaded);
            assert.strictEqual(loaded.name, 'Small Club Template');
            assert.strictEqual(loaded.fixtures.length, 5);
        });

        test('clampToBounds strictly constrains coordinates within stage envelope', () => {
            const outOfBounds = { x: -999, y: -50, z: 120 };
            const clamped = clampToBounds(outOfBounds);
            assert.strictEqual(clamped.x, -50);
            assert.strictEqual(clamped.y, 0);
            assert.strictEqual(clamped.z, 50);
        });

        test('normalizeYaw normalizes angles across full circle boundaries', () => {
            assert.strictEqual(normalizeYaw(0), 0);
            assert.strictEqual(normalizeYaw(Math.PI * 2), 0);
            assert.strictEqual(normalizeYaw(Math.PI * 3), Math.PI);
            assert.strictEqual(normalizeYaw(-Math.PI / 2), Math.PI * 1.5);
            assert.strictEqual(normalizeYaw(NaN), 0);
        });
    });

    describe('Tier 3: Pairwise & State Transitions', () => {
        test('Save, load, and compile roundtrip preserves fixture placement and integrity', () => {
            const originalLayout = {
                version: '1.0.0',
                name: 'Roundtrip Test Stage',
                fixtures: [
                    { id: 'fix-laser-1', type: 'laser', position: snapVector3({ x: 4.24, y: 6.76, z: -2.31 }) },
                    { id: 'fix-mh-1', type: 'movinghead', position: snapVector3({ x: -8.11, y: 10.0, z: 1.49 }) },
                    { id: 'fix-co2-1', type: 'co2', position: snapVector3({ x: 0.0, y: 0.5, z: 3.0 }) }
                ]
            };

            saveLayoutToStorage(originalLayout, mockStorage);
            const loaded = loadLayoutFromStorage(mockStorage);
            assert.strictEqual(loaded.name, 'Roundtrip Test Stage');
            assert.strictEqual(loaded.fixtures.length, 3);

            const compiled = compileCustomStageLayout(loaded);
            assert.strictEqual(compiled.lasers.length, 1);
            assert.strictEqual(compiled.movingHeads.length, 1);
            assert.strictEqual(compiled.co2Jets.length, 1);
            assert.strictEqual(compiled.lasers[0].position.x, 4.0);
            assert.strictEqual(compiled.lasers[0].position.y, 7.0);
            assert.strictEqual(compiled.lasers[0].position.z, -2.5);
        });

        test('Template generation returns distinct valid fixtures for Large Festival and Small Club', () => {
            const large = getTemplateLayout('Large Festival');
            const small = getTemplateLayout('Small Club');

            assert.strictEqual(large.name, 'Large Festival Template');
            assert.strictEqual(small.name, 'Small Club Template');
            assert.ok(large.fixtures.length > small.fixtures.length);

            const compiledLarge = compileCustomStageLayout(large);
            const compiledSmall = compileCustomStageLayout(small);

            assert.ok(compiledLarge.screens.length >= 1);
            assert.ok(compiledLarge.co2Jets.length >= 2);
            assert.strictEqual(compiledSmall.screens.length, 0);
            assert.strictEqual(compiledSmall.lasers.length, 2);
            assert.strictEqual(compiledSmall.movingHeads.length, 2);
        });
    });
});
