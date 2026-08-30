import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';

// ---------------------------------------------------------------------------
// These tests exercise the REAL module below. They previously carried a private
// copy of the implementation and asserted against that copy, so they stayed
// green regardless of what the shipped code did.
// ---------------------------------------------------------------------------
import {
    DJ_CONFIG,
    createDJRigHierarchy,
    updateDJHeadNod,
    updateDJShoulderBounce,
    updateDJRightArm,
    updateDJAvatar
} from '../src/DJAvatar.js';

// Re-exported so tests/e2eScenarios.test.js keeps resolving them.
export {
    DJ_CONFIG,
    createDJRigHierarchy,
    updateDJHeadNod,
    updateDJShoulderBounce,
    updateDJRightArm,
    updateDJAvatar
};

describe('R6: Procedural 3D DJ Avatar', () => {
    describe('Tier 1: Feature Coverage', () => {
        test('createDJRigHierarchy builds complete procedural rig with correct parent-child relationships', () => {
            const rig = createDJRigHierarchy();

            assert.strictEqual(rig.root.name, 'djAvatar');
            assert.strictEqual(rig.root.rotation.y, Math.PI, 'DJ faces crowd (-Z)');
            assert.strictEqual(rig.torso.name, 'torso');
            assert.strictEqual(rig.head.name, 'head');
            assert.strictEqual(rig.headphones.name, 'headphones');
            assert.strictEqual(rig.rightArm.name, 'rightArm');
            assert.ok(rig.torso.children.includes(rig.head));
            assert.ok(rig.head.children.includes(rig.headphones));
        });

        test('updateDJHeadNod bounds head rotation to +/-5 degrees (+/-0.087 rad)', () => {
            const rig = createDJRigHierarchy();
            const maxRad = DJ_CONFIG.headNod.maxAngleRad;

            for (let t = 0; t < 2.0; t += 0.05) {
                const angle = updateDJHeadNod(rig.head, t, 120, 1.0);
                assert.ok(angle >= -maxRad - 1e-4 && angle <= maxRad + 1e-4, `Angle ${angle} exceeded max +/-5 deg (${maxRad})`);
            }
        });

        test('updateDJShoulderBounce scales torso Y within [0.99, 1.01] on kick hits', () => {
            const rig = createDJRigHierarchy();

            // Kick hit (energy 0.95 > 0.70 threshold)
            const scaleYHigh = updateDJShoulderBounce(rig.torso, 0.95);
            assert.ok(scaleYHigh > 1.0 && scaleYHigh <= 1.01);

            // Silent kick -> recovers to 1.0
            updateDJShoulderBounce(rig.torso, 0.0);
            updateDJShoulderBounce(rig.torso, 0.0);
            assert.ok(Math.abs(rig.torso.scale.y - 1.0) < 0.01);
        });

        test('updateDJRightArm raises arm for fist pump during drop and stays up for 1.0s', () => {
            const rig = createDJRigHierarchy();

            // Trigger drop
            updateDJRightArm(rig.rightArm, 0.0, 0.95, true, rig);
            assert.strictEqual(rig.fistPumpTimer, 1.0);
            assert.strictEqual(rig.rightArm.upperArm.rotation.z, DJ_CONFIG.fistPump.armAngleRad);

            // Step 0.5s -> still pumping
            updateDJRightArm(rig.rightArm, 0.5, 0.2, false, rig);
            assert.strictEqual(rig.fistPumpTimer, 0.5);
            assert.strictEqual(rig.rightArm.upperArm.rotation.z, DJ_CONFIG.fistPump.armAngleRad);

            // Step another 0.6s -> timer expired -> returns to mixing
            updateDJRightArm(rig.rightArm, 0.6, 0.2, false, rig);
            assert.strictEqual(rig.fistPumpTimer, 0);
            assert.strictEqual(rig.rightArm.upperArm.rotation.z, 0.2);
        });
        test('DJ avatar root transform is located behind booth facing crowd', () => {
            const rig = createDJRigHierarchy();
            assert.strictEqual(rig.root.position.x, 0);
            assert.strictEqual(rig.root.position.y, 1.0);
            assert.strictEqual(rig.root.position.z, -2.5);
            assert.strictEqual(rig.root.rotation.y, Math.PI);
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('updateDJAvatar handles zero or negative delta time gracefully', () => {
            const rig = createDJRigHierarchy();
            rig.fistPumpTimer = 0.5;
            const res = updateDJAvatar(rig, 0.0, { time: 0, bpm: 120 });
            assert.strictEqual(res.fistPumpRemaining, 0.5);

            const resNeg = updateDJAvatar(rig, -0.1, { time: 0, bpm: 120 });
            assert.strictEqual(resNeg.fistPumpRemaining, 0.5);
        });
        test('Fist pump timer strictly expires at 1.0s and recovers cleanly', () => {
            const rig = createDJRigHierarchy();
            updateDJRightArm(rig.rightArm, 0.0, 1.0, true, rig);
            assert.strictEqual(rig.fistPumpTimer, 1.0);

            // At t = 0.99s -> still active
            updateDJRightArm(rig.rightArm, 0.99, 0.0, false, rig);
            assert.ok(rig.fistPumpTimer > 0);

            // At t = 0.02s more (total 1.01s) -> expired
            updateDJRightArm(rig.rightArm, 0.02, 0.0, false, rig);
            assert.strictEqual(rig.fistPumpTimer, 0);
        });

        test('Re-triggering drop during active fist pump resets timer to 1.0s', () => {
            const rig = createDJRigHierarchy();
            updateDJRightArm(rig.rightArm, 0.0, 1.0, true, rig);
            updateDJRightArm(rig.rightArm, 0.7, 0.0, false, rig);
            assert.ok(Math.abs(rig.fistPumpTimer - 0.3) < 1e-4);

            // Re-trigger drop
            updateDJRightArm(rig.rightArm, 0.0, 0.95, true, rig);
            assert.strictEqual(rig.fistPumpTimer, 1.0);
        });

        test('updateDJHeadNod handles zero beat energy and NaN inputs safely', () => {
            const rig = createDJRigHierarchy();
            rig.head.rotation.x = 0.05;

            // Zero energy should bring rotation towards 0
            updateDJHeadNod(rig.head, 1.0, 120, 0.0);
            assert.ok(rig.head.rotation.x < 0.05);

            // Null node should not throw
            assert.strictEqual(updateDJHeadNod(null, 1.0), 0);
        });

        test('Shoulder bounce does not trigger on sub-threshold kick energy (<= 0.7)', () => {
            const rig = createDJRigHierarchy();
            rig.torso.scale.y = 1.0;
            updateDJShoulderBounce(rig.torso, 0.65);
            assert.strictEqual(rig.torso.scale.y, 1.0);
        });
    });

    describe('Tier 3: Pairwise & Live Show Dynamics', () => {
        test('Full DJ animation step executes smoothly over transition from build-up to drop', () => {
            const rig = createDJRigHierarchy();

            // Build-up: high BPM head nod, low bass
            const buildFrame = updateDJAvatar(rig, 0.016, {
                time: 1.0,
                bpm: 140,
                beatEnergy: 0.8,
                kickEnergy: 0.5,
                bassEnergy: 0.4,
                isDrop: false
            });
            assert.strictEqual(buildFrame.isFistPumping, false);
            assert.ok(Math.abs(buildFrame.headNodAngle) <= DJ_CONFIG.headNod.maxAngleRad);

            // Drop event hit
            const dropFrame = updateDJAvatar(rig, 0.016, {
                time: 1.016,
                bpm: 140,
                beatEnergy: 1.0,
                kickEnergy: 0.95,
                bassEnergy: 0.98,
                isDrop: true
            });
            assert.strictEqual(dropFrame.isFistPumping, true);
            assert.ok(dropFrame.fistPumpRemaining > 0 && dropFrame.fistPumpRemaining <= 1.0);
            assert.ok(dropFrame.torsoScaleY > 1.0);
        });
    });
});
