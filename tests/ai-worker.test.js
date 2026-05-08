import { normalize } from '../src/ai-worker.js';
import assert from 'node:assert';
import { test, describe } from 'node:test';

describe('normalize', () => {
    test('should normalize a standard array with positive numbers', () => {
        const input = [0, 5, 10];
        const result = normalize(input);
        assert.deepStrictEqual(result, [0, 0.5, 1]);
        // Also check that original array is modified
        assert.strictEqual(input, result);
    });

    test('should not normalize an array with only zeros', () => {
        const input = [0, 0, 0];
        const result = normalize(input);
        assert.deepStrictEqual(result, [0, 0, 0]);
    });

    test('should not normalize when max value is <= 1e-9', () => {
        const input = [1e-10, 5e-10, 1e-10];
        const result = normalize(input);
        // Max is 5e-10, which is <= 1e-9, so array should be unchanged
        assert.deepStrictEqual(result, [1e-10, 5e-10, 1e-10]);
    });

    test('should handle empty array', () => {
        const input = [];
        const result = normalize(input);
        assert.deepStrictEqual(result, []);
    });

    test('should handle array with all negative numbers', () => {
        // Max will be evaluated against initial max = 0
        const input = [-1, -5, -10];
        const result = normalize(input);
        // Max remains 0, which is not > 1e-9, so array is unchanged
        assert.deepStrictEqual(result, [-1, -5, -10]);
    });

    test('should handle array with mixed positive and negative numbers', () => {
        const input = [-10, 0, 10];
        const result = normalize(input);
        // Max is 10, should divide all by 10
        assert.deepStrictEqual(result, [-1, 0, 1]);
    });

    test('should correctly normalize Float32Array', () => {
        const input = new Float32Array([0, 2, 4]);
        const result = normalize(input);
        // Should return a Float32Array
        assert.ok(result instanceof Float32Array);
        // Using approximate equality since it's Float32
        assert.strictEqual(result[0], 0);
        assert.strictEqual(result[1], 0.5);
        assert.strictEqual(result[2], 1);
    });
});
