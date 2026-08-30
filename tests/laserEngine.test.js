import assert from 'node:assert';
import { test, describe } from 'node:test';
import { aimAtTarget, LaserEngine } from '../src/LaserEngine.js';

describe('LaserEngine aimAtTarget', () => {
    test('aimAtTarget should exist as a function and on LaserEngine export', () => {
        assert.strictEqual(typeof aimAtTarget, 'function');
        assert.strictEqual(typeof LaserEngine.aimAtTarget, 'function');
    });

    test('should handle empty lasers array or null inputs gracefully without crashing', () => {
        assert.doesNotThrow(() => aimAtTarget([], { x: 0, y: 0, z: 0 }));
        assert.doesNotThrow(() => aimAtTarget(null, { x: 0, y: 0, z: 0 }));
        assert.doesNotThrow(() => aimAtTarget(undefined, { x: 0, y: 0, z: 0 }));
        assert.doesNotThrow(() => aimAtTarget([{ pos: { x: 0, y: 0, z: 0 } }], null));
        assert.doesNotThrow(() => aimAtTarget([null], { x: 0, y: 0, z: 0 }));
    });

    test('should correctly compute aim angles towards a target point straight ahead', () => {
        const laser = {
            pos: { x: 0, y: 10, z: 0 },
            baseYaw: 0,
            isManualOverride: false,
            manualPan: 0,
            manualTilt: 0
        };
        const target = { x: 0, y: 0, z: 10 }; // Straight ahead (+Z) and on the floor (y=0)

        aimAtTarget([laser], target);

        assert.strictEqual(laser.isManualOverride, true);
        assert.strictEqual(laser.manualPan, 0); // Yaw should be 0 deg
        assert.ok(Math.abs(laser.manualTilt - 45) < 1e-4, `Expected manualTilt ~45 deg, got ${laser.manualTilt}`);
    });

    test('should compute correct pan angle for target to the right (+X)', () => {
        const laser = {
            pos: { x: 0, y: 0, z: 0 },
            baseYaw: 0,
            isManualOverride: false,
            manualPan: 0,
            manualTilt: 0
        };
        const target = { x: 10, y: 0, z: 0 }; // Right (+X)

        aimAtTarget([laser], target);

        assert.strictEqual(laser.isManualOverride, true);
        assert.ok(Math.abs(laser.manualPan - 90) < 1e-4, `Expected manualPan ~90 deg, got ${laser.manualPan}`);
        assert.strictEqual(laser.manualTilt, 0);
    });

    test('should compute correct pan angle for target to the left (-X)', () => {
        const laser = {
            pos: { x: 0, y: 0, z: 0 },
            baseYaw: 0,
            isManualOverride: false,
            manualPan: 0,
            manualTilt: 0
        };
        const target = { x: -10, y: 0, z: 0 }; // Left (-X)

        aimAtTarget([laser], target);

        assert.strictEqual(laser.isManualOverride, true);
        assert.ok(Math.abs(laser.manualPan - (-90)) < 1e-4, `Expected manualPan ~ -90 deg, got ${laser.manualPan}`);
        assert.strictEqual(laser.manualTilt, 0);
    });

    test('should wrap pan angles cleanly within [-180, 180]', () => {
        const laser = {
            pos: { x: 0, y: 0, z: 0 },
            baseYaw: Math.PI, // Base yaw 180 deg
            isManualOverride: false,
            manualPan: 0,
            manualTilt: 0
        };
        const target = { x: 0.001, y: 0, z: -10 }; // Target behind (-Z)

        aimAtTarget([laser], target);

        assert.strictEqual(laser.isManualOverride, true);
        assert.ok(laser.manualPan >= -180 && laser.manualPan <= 180, `Expected manualPan within [-180, 180], got ${laser.manualPan}`);
    });

    test('should aim multiple lasers simultaneously at the same target', () => {
        const lasers = [
            { pos: { x: -5, y: 10, z: 0 }, baseYaw: 0 },
            { pos: { x: 5, y: 10, z: 0 }, baseYaw: 0 }
        ];
        const target = { x: 0, y: 0, z: 10 };

        aimAtTarget(lasers, target);

        assert.strictEqual(lasers[0].isManualOverride, true);
        assert.strictEqual(lasers[1].isManualOverride, true);
        // Left laser should aim right (+pan), right laser should aim left (-pan)
        assert.ok(lasers[0].manualPan > 0, 'Left laser should pan right');
        assert.ok(lasers[1].manualPan < 0, 'Right laser should pan left');
        assert.ok(Math.abs(lasers[0].manualPan + lasers[1].manualPan) < 1e-4, 'Pans should be symmetric');
    });
});
