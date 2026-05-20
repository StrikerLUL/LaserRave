import { computeFormationPositions } from '../src/utils/formations.js';
import assert from 'node:assert';
import { test, describe } from 'node:test';

describe('computeFormationPositions', () => {
    const formations = ['front', 'twin', 'sides', 'surround', 'corners', 'aerial', 'dancefloor', 'vshape'];
    const counts = [1, 4, 10, 20];

    formations.forEach(formation => {
        counts.forEach(count => {
            test(`should return correct number of slots for formation: ${formation}, count: ${count}`, () => {
                const slots = computeFormationPositions(count, formation);
                assert.strictEqual(slots.length, count, `Expected ${count} slots, but got ${slots.length}`);
            });

            test(`should return slots with required properties for formation: ${formation}, count: ${count}`, () => {
                const slots = computeFormationPositions(count, formation);
                slots.forEach((slot, index) => {
                    assert.ok(typeof slot.x === 'number', `Slot ${index} missing x`);
                    assert.ok(typeof slot.y === 'number', `Slot ${index} missing y`);
                    assert.ok(typeof slot.z === 'number', `Slot ${index} missing z`);
                    assert.ok(typeof slot.baseYaw === 'number', `Slot ${index} missing baseYaw`);
                    assert.ok(typeof slot.zone === 'string', `Slot ${index} missing zone`);
                    assert.ok(typeof slot.wallNorm === 'number', `Slot ${index} missing wallNorm`);
                    assert.ok(slot.wallNorm >= 0 && slot.wallNorm <= 1, `Slot ${index} wallNorm out of range: ${slot.wallNorm}`);
                });
            });
        });
    });

    test('should handle unknown formation by falling back to default (front)', () => {
        const count = 10;
        const slots = computeFormationPositions(count, 'unknown');
        const defaultSlots = computeFormationPositions(count, 'front');
        assert.strictEqual(slots.length, count);
        assert.deepStrictEqual(slots, defaultSlots);
    });

    test('should handle count of 0', () => {
        const slots = computeFormationPositions(0, 'front');
        assert.strictEqual(slots.length, 0);
    });

    test('twin formation should have two rows at different heights', () => {
        const count = 10;
        const slots = computeFormationPositions(count, 'twin');
        const yHeights = new Set(slots.map(s => s.y));
        assert.ok(yHeights.has(17));
        assert.ok(yHeights.has(11));
        assert.strictEqual(yHeights.size, 2);
    });

    test('sides formation should have left and right zones', () => {
        const count = 10;
        const slots = computeFormationPositions(count, 'sides');
        const zones = new Set(slots.map(s => s.zone));
        assert.ok(zones.has('side-left'));
        assert.ok(zones.has('side-right'));
    });
});
