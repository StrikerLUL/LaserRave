import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';

// ---------------------------------------------------------------------------
// These tests exercise the REAL module below. They previously carried a private
// copy of the implementation and asserted against that copy, so they stayed
// green regardless of what the shipped code did.
// ---------------------------------------------------------------------------
import {
    POV_CONFIG,
    AUDIENCE_POV_CONFIG,
    getAudienceBasePosition,
    calculateLookAtYaw,
    calculateHeadBob,
    calculateKickShake,
    smoothstep,
    interpolateCrowdHop,
    calculatePortraitVFOV,
    evaluateAudiencePOVCamera
} from '../src/AudiencePOV.js';

// Re-exported so tests/e2eScenarios.test.js keeps resolving them.
export {
    POV_CONFIG,
    AUDIENCE_POV_CONFIG,
    getAudienceBasePosition,
    calculateLookAtYaw,
    calculateHeadBob,
    calculateKickShake,
    smoothstep,
    interpolateCrowdHop,
    calculatePortraitVFOV,
    evaluateAudiencePOVCamera
};

describe('R4: Audience POV Camera Mode', () => {
    describe('Tier 1: Feature Coverage', () => {
        test('getAudienceBasePosition places camera at eye-level y = 1.75m at crowd location', () => {
            const member = { id: 'c1', x: 8.5, y: 0, z: -14.2 };
            const camPos = getAudienceBasePosition(member);

            assert.strictEqual(camPos.x, 8.5);
            assert.strictEqual(camPos.y, 1.75, 'Camera eye level must be exactly 1.75m');
            assert.strictEqual(camPos.z, -14.2);
        });

        test('calculateLookAtYaw points towards stage center with variance within +/-5 deg', () => {
            const camPos = { x: 0, y: 1.75, z: 20 };
            const stagePos = { x: 0, y: 2.0, z: 0 };

            // Looking directly north (-Z) towards stage center
            const baseYaw = calculateLookAtYaw(camPos, stagePos, 0);
            assert.strictEqual(Math.abs(baseYaw - Math.PI), 0); // Atan2(0, -20) is PI

            // With +4 degrees variance
            const varYaw = calculateLookAtYaw(camPos, stagePos, 4.0);
            const expectedRad = Math.PI + (4.0 * Math.PI / 180);
            assert.ok(Math.abs(varYaw - expectedRad) < 1e-6);
        });

        test('calculateHeadBob oscillates within +/-0.04m at BPM/60 frequency', () => {
            const bpm = 120; // 2.0 Hz
            const maxBob = POV_CONFIG.headBob.amplitude;

            // At t = 0 -> sin(0) = 0
            assert.strictEqual(calculateHeadBob(0, bpm, 1.0), 0);

            // At t = 0.125s (1/4 cycle) -> sin(pi/2) = 1.0 -> bob = +0.04m
            const quarterCycle = calculateHeadBob(0.125, bpm, 1.0);
            assert.ok(Math.abs(quarterCycle - maxBob) < 1e-6);

            // At t = 0.375s (3/4 cycle) -> sin(3pi/2) = -1.0 -> bob = -0.04m
            const threeQuarterCycle = calculateHeadBob(0.375, bpm, 1.0);
            assert.ok(Math.abs(threeQuarterCycle - (-maxBob)) < 1e-6);
        });

        test('calculateKickShake displaces camera up to +/-0.015m and decays to 0 at 0.3s', () => {
            const initVec = { x: 0.015, y: 0.015, z: 0.015 };

            // At t = 0 -> full displacement
            const atStart = calculateKickShake(0.0, initVec);
            assert.strictEqual(atStart.x, 0.015);
            assert.strictEqual(atStart.y, 0.015);

            // At t = 0.15s (halfway) -> half displacement
            const atHalf = calculateKickShake(0.15, initVec);
            assert.strictEqual(atHalf.x, 0.0075);
            assert.strictEqual(atHalf.y, 0.0075);

            // At t = 0.30s (end of decay) -> zero displacement
            const atEnd = calculateKickShake(0.30, initVec);
            assert.strictEqual(atEnd.x, 0);
            assert.strictEqual(atEnd.y, 0);
            assert.strictEqual(atEnd.z, 0);
        });

        test('interpolateCrowdHop smoothsteps between two positions over 0.6s', () => {
            const start = { x: 0, y: 1.75, z: 10 };
            const target = { x: 20, y: 1.75, z: 30 };

            const atStart = interpolateCrowdHop(start, target, 0.0);
            assert.strictEqual(atStart.x, 0);
            assert.strictEqual(atStart.progress, 0);
            assert.strictEqual(atStart.isComplete, false);

            const atMid = interpolateCrowdHop(start, target, 0.3);
            assert.strictEqual(atMid.x, 10); // Smoothstep at 0.5 is exactly 0.5
            assert.strictEqual(atMid.z, 20);

            const atEnd = interpolateCrowdHop(start, target, 0.6);
            assert.strictEqual(atEnd.x, 20);
            assert.strictEqual(atEnd.z, 30);
            assert.strictEqual(atEnd.isComplete, true);
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('calculateHeadBob clamps to 0 when beatEnergy is 0 or BPM is 0', () => {
            assert.strictEqual(calculateHeadBob(1.5, 128, 0.0), 0);
            assert.strictEqual(calculateHeadBob(1.5, 0, 1.0), 0);
            assert.strictEqual(calculateHeadBob(1.5, -120, 1.0), 0);
        });

        test('calculateKickShake returns zero displacement for t > 0.3s and negative t', () => {
            assert.deepStrictEqual(calculateKickShake(0.3001), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(calculateKickShake(5.0), { x: 0, y: 0, z: 0 });
            assert.deepStrictEqual(calculateKickShake(-0.1), { x: 0, y: 0, z: 0 });
        });

        test('interpolateCrowdHop clamps progress cleanly past duration (t > 0.6s)', () => {
            const start = { x: 0, y: 1.75, z: 0 };
            const target = { x: 10, y: 1.75, z: 10 };

            const pastEnd = interpolateCrowdHop(start, target, 1.5);
            assert.strictEqual(pastEnd.x, 10);
            assert.strictEqual(pastEnd.z, 10);
            assert.strictEqual(pastEnd.progress, 1.0);
            assert.strictEqual(pastEnd.isComplete, true);
        });

        test('calculateLookAtYaw clamps yaw variance strictly to +/-5 degrees', () => {
            const camPos = { x: 0, y: 1.75, z: 10 };
            const stagePos = { x: 0, y: 2.0, z: 0 };

            const yaw10 = calculateLookAtYaw(camPos, stagePos, 20.0); // Overshoot +20 deg
            const maxExpected = Math.PI + (5.0 * Math.PI / 180);
            assert.ok(Math.abs(yaw10 - maxExpected) < 1e-6);

            const yawNeg10 = calculateLookAtYaw(camPos, stagePos, -50.0); // Undershoot -50 deg
            const minExpected = Math.PI - (5.0 * Math.PI / 180);
            assert.ok(Math.abs(yawNeg10 - minExpected) < 1e-6);
        });

        test('calculatePortraitVFOV calculates expanded vertical FOV for 9:16 aspect ratio', () => {
            const landscapeFOV = 60; // degrees
            const portraitFOV = calculatePortraitVFOV(landscapeFOV);

            // 60 deg landscape vertical FOV becomes ~122.55 deg in 9:16 portrait to preserve HFOV
            assert.ok(portraitFOV > landscapeFOV, 'Portrait vertical FOV must be larger than landscape FOV');
            assert.ok(portraitFOV >= 120 && portraitFOV <= 125, `Expected ~122.55 deg, got ${portraitFOV}`);
        });
    });

    describe('Tier 3: Pairwise & Integration', () => {
        test('evaluateAudiencePOVCamera aggregates bob, shake, hop, and TikTok portrait mode', () => {
            const memberA = { id: 'a', x: -5, y: 0, z: 15 };
            const memberB = { id: 'b', x: 5, y: 0, z: 15 };

            const frame = evaluateAudiencePOVCamera({
                currentCrowdMember: memberA,
                targetCrowdMember: memberB,
                hopElapsed: 0.3, // halfway through 0.6s hop
                timeSeconds: 0.125, // peak head bob (BPM 120)
                bpm: 120,
                beatEnergy: 1.0,
                kickElapsed: 0.15, // halfway through kick shake
                isPortraitMode: true,
                landscapeVFOV: 60
            });

            // Midpoint x between -5 and 5 is 0
            assert.ok(Math.abs(frame.position.x - 0.0075) < 1e-3); // 0 + shakeX (0.0075)
            // Y is 1.75 + bob (0.04) + shakeY (0.0075) = 1.7975
            assert.ok(Math.abs(frame.position.y - 1.7975) < 1e-3);
            assert.strictEqual(frame.eyeLevel, 1.75);
            assert.ok(frame.fov > 90);
        });
    });
});
