import assert from 'node:assert';
import { test, describe } from 'node:test';
import { _hash } from '../src/utils/math.js';

describe('_hash function', () => {
    test('should return a number', () => {
        const result = _hash(1);
        assert.strictEqual(typeof result, 'number');
    });

    test('should return deterministic results for the same input', () => {
        const val1 = _hash(42);
        const val2 = _hash(42);
        assert.strictEqual(val1, val2);
    });

    test('should return different results for different inputs', () => {
        const val1 = _hash(1);
        const val2 = _hash(2);
        assert.notStrictEqual(val1, val2);
    });

    test('should handle zero correctly', () => {
        const result = _hash(0);
        assert.strictEqual(result, 0); // Math.sin(0) is 0
    });

    test('should handle negative numbers', () => {
        const result1 = _hash(-1);
        const result2 = _hash(1);
        // Math.sin(-x) = -Math.sin(x)
        assert.strictEqual(result1, -result2);
    });

    test('should handle large numbers', () => {
        const result = _hash(1e10);
        assert.strictEqual(typeof result, 'number');
        assert.ok(!isNaN(result));
    });
});
