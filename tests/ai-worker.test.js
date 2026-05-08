import { getRMS } from '../src/ai-worker.js';
import assert from 'node:assert';
import { test, describe } from 'node:test';

describe('getRMS', () => {
    test('should return correct RMS for an array perfectly divisible by hopSize', () => {
        const array = [2, 2, 2, 2];
        const hopSize = 2;
        const result = getRMS(array, hopSize);
        // Frame 1: [2, 2] -> sum = 8, mean = 4, sqrt = 2
        // Frame 2: [2, 2] -> sum = 8, mean = 4, sqrt = 2
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], 2);
        assert.strictEqual(result[1], 2);
    });

    test('should ignore remaining elements if array length is not perfectly divisible by hopSize', () => {
        const array = [3, 4, 3, 4, 10, 20]; // Last two elements should be ignored
        const hopSize = 2;
        // However, Math.floor(6/2) is 3, so there are no remaining elements if hopSize is 2.
        // Let's test with hopSize = 2, length = 5
        const array2 = [3, 4, 3, 4, 10];
        const result = getRMS(array2, hopSize);
        // numFrames = Math.floor(5 / 2) = 2
        // Frame 1: [3, 4] -> sum = 9 + 16 = 25, mean = 12.5, sqrt(12.5)
        // Frame 2: [3, 4] -> sum = 9 + 16 = 25, mean = 12.5, sqrt(12.5)
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], Math.fround(Math.sqrt(12.5)));
        assert.strictEqual(result[1], Math.fround(Math.sqrt(12.5)));
    });

    test('should handle positive, negative numbers and zeros correctly', () => {
        const array = [0, 0, -3, 4];
        const hopSize = 2;
        const result = getRMS(array, hopSize);
        // Frame 1: [0, 0] -> sqrt(0) = 0
        // Frame 2: [-3, 4] -> sum = 9 + 16 = 25, mean = 12.5, sqrt(12.5)
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], 0);
        assert.strictEqual(result[1], Math.fround(Math.sqrt(12.5)));
    });

    test('should return an empty Float32Array if array is smaller than hopSize', () => {
        const array = [1, 2];
        const hopSize = 4;
        const result = getRMS(array, hopSize);
        assert.strictEqual(result.length, 0);
        assert.ok(result instanceof Float32Array);
    });

    test('should return an empty Float32Array if array is empty', () => {
        const array = [];
        const hopSize = 2;
        const result = getRMS(array, hopSize);
        assert.strictEqual(result.length, 0);
        assert.ok(result instanceof Float32Array);
    });

    test('should compute correct RMS values with larger hopSize', () => {
        const array = [1, -1, 1, -1, 2, -2, 2, -2];
        const hopSize = 4;
        const result = getRMS(array, hopSize);
        // Frame 1: [1, -1, 1, -1] -> sum = 4, mean = 1, sqrt = 1
        // Frame 2: [2, -2, 2, -2] -> sum = 16, mean = 4, sqrt = 2
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0], 1);
        assert.strictEqual(result[1], 2);
    });
});
