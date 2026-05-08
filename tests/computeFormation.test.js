import { computeFormation } from '../src/utils/computeFormation.js';
import assert from 'node:assert';
import { test, describe } from 'node:test';

describe('computeFormation', () => {
    test('should return correct line formation for 3 items', () => {
        const result = computeFormation(3, 'line');
        assert.strictEqual(result.length, 3);
        assert.deepStrictEqual(result[0], { x: -22, y: 11.85, z: -15, ry: 0 });
        assert.deepStrictEqual(result[1], { x: 0, y: 11.85, z: -15, ry: 0 });
        assert.deepStrictEqual(result[2], { x: 22, y: 11.85, z: -15, ry: 0 });
    });

    test('should handle count of 1 in line formation', () => {
        const result = computeFormation(1, 'line');
        assert.strictEqual(result.length, 1);
        assert.deepStrictEqual(result[0], { x: -22, y: 11.85, z: -15, ry: 0 });
    });

    test('should return empty array for unknown formation', () => {
        const result = computeFormation(3, 'unknown');
        assert.strictEqual(result.length, 0);
    });

    test('should handle count of 0', () => {
        const result = computeFormation(0, 'line');
        assert.strictEqual(result.length, 0);
    });

    test('should return empty array when count is less than 0', () => {
        const result = computeFormation(-1, 'line');
        assert.strictEqual(result.length, 0);
    });
});
