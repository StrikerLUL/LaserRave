import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural 3D DJ Avatar Module
// Low-poly character rig behind DJ booth with audio-reactive kinematics
// ---------------------------------------------------------------------------

export const DJ_CONFIG = {
    position: { x: 0, y: 1.0, z: -2.5 }, // Relative/default behind DJ booth
    rotation: { x: 0, y: Math.PI, z: 0 }, // Facing crowd (-Z)
    headNod: {
        maxAngleRad: (5.0 * Math.PI) / 180, // +/- 5 degrees (0.087266 rad)
        springFactor: 0.20
    },
    shoulderBounce: {
        minScaleY: 0.99,
        maxScaleY: 1.01,
        kickThreshold: 0.70
    },
    fistPump: {
        durationSeconds: 1.0, // 1.0s drop fist pump timer
        dropThreshold: 0.90,
        armAngleRad: (90.0 * Math.PI) / 180 // Arm raised up 90 deg
    }
};

/**
 * Creates pure mock or object structure for DJ rig hierarchy (used in tests and runtime tracking).
 */
export function createDJRigHierarchy() {
    const headphones = {
        name: 'headphones',
        bandArc: { type: 'torus' },
        leftCup: { type: 'cylinder' },
        rightCup: { type: 'cylinder' }
    };

    const head = {
        name: 'head',
        type: 'sphere',
        rotation: { x: 0, y: 0, z: 0 },
        children: [headphones]
    };

    const leftArm = {
        name: 'leftArm',
        upperArm: { rotation: { x: 0, y: 0, z: 0 } },
        forearm: { rotation: { x: 0, y: 0, z: 0 } }
    };

    const rightArm = {
        name: 'rightArm',
        upperArm: { rotation: { x: 0, y: 0, z: 0 } },
        forearm: { rotation: { x: 0, y: 0, z: 0 } },
        hand: { position: { x: 0, y: 0, z: 0 } }
    };

    const torso = {
        name: 'torso',
        scale: { x: 1.0, y: 1.0, z: 1.0 },
        children: [head, leftArm, rightArm]
    };

    const leftLeg = { name: 'leftLeg' };
    const rightLeg = { name: 'rightLeg' };

    const djGroup = {
        name: 'djAvatar',
        position: { ...DJ_CONFIG.position },
        rotation: { ...DJ_CONFIG.rotation },
        children: [torso, leftLeg, rightLeg]
    };

    return {
        root: djGroup,
        torso,
        head,
        headphones,
        leftArm,
        rightArm,
        fistPumpTimer: 0.0
    };
}

/**
 * Creates full 3D procedural Three.js Mesh hierarchy for the DJ Avatar.
 */
export function createDJAvatarMesh() {
    const djGroup = new THREE.Group();
    djGroup.name = 'djAvatar';
    djGroup.position.set(DJ_CONFIG.position.x, DJ_CONFIG.position.y, DJ_CONFIG.position.z);
    djGroup.rotation.set(DJ_CONFIG.rotation.x, DJ_CONFIG.rotation.y, DJ_CONFIG.rotation.z);

    // Materials
    const hoodieMat = new THREE.MeshLambertMaterial({ color: 0x18181a });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xdfa17a });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x111115 });
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const phoneMat = new THREE.MeshLambertMaterial({ color: 0x050505 });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

    // Torso (Upper body)
    const torsoGroup = new THREE.Group();
    torsoGroup.name = 'torso';
    torsoGroup.position.set(0, 0.7, 0);

    const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), hoodieMat);
    torsoMesh.position.set(0, 0.4, 0);
    torsoMesh.castShadow = true;
    torsoGroup.add(torsoMesh);

    // Head
    const headGroup = new THREE.Group();
    headGroup.name = 'head';
    headGroup.position.set(0, 0.95, 0);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Cap / Hood peak
    const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 16), hoodieMat);
    capMesh.position.set(0, 0.15, 0);
    headGroup.add(capMesh);

    // Headphones
    const headphonesGroup = new THREE.Group();
    headphonesGroup.name = 'headphones';
    const arcGeo = new THREE.TorusGeometry(0.25, 0.03, 8, 16, Math.PI);
    const bandMesh = new THREE.Mesh(arcGeo, phoneMat);
    bandMesh.rotation.z = -Math.PI;
    bandMesh.position.set(0, 0.05, 0);
    headphonesGroup.add(bandMesh);

    const cupGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12);
    const leftCup = new THREE.Mesh(cupGeo, phoneMat);
    leftCup.rotation.z = Math.PI / 2;
    leftCup.position.set(-0.25, 0.05, 0);
    headphonesGroup.add(leftCup);

    const rightCup = new THREE.Mesh(cupGeo, phoneMat);
    rightCup.rotation.z = Math.PI / 2;
    rightCup.position.set(0.25, 0.05, 0);
    headphonesGroup.add(rightCup);

    const leftGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12), accentMat);
    leftGlow.rotation.z = Math.PI / 2;
    leftGlow.position.set(-0.285, 0.05, 0);
    headphonesGroup.add(leftGlow);

    const rightGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12), accentMat);
    rightGlow.rotation.z = Math.PI / 2;
    rightGlow.position.set(0.285, 0.05, 0);
    headphonesGroup.add(rightGlow);

    headGroup.add(headphonesGroup);
    torsoGroup.add(headGroup);

    // Left Arm (Posed holding headphone / mixer)
    const leftArmGroup = new THREE.Group();
    leftArmGroup.name = 'leftArm';
    leftArmGroup.position.set(-0.45, 0.75, 0);

    const leftUpperArm = new THREE.Group();
    leftUpperArm.name = 'upperArm';
    const lUpperMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 8), hoodieMat);
    lUpperMesh.position.set(0, -0.15, 0);
    leftUpperArm.add(lUpperMesh);

    const leftForearm = new THREE.Group();
    leftForearm.name = 'forearm';
    leftForearm.position.set(0, -0.3, 0);
    const lForeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8), skinMat);
    lForeMesh.position.set(0, -0.15, 0);
    leftForearm.add(lForeMesh);

    // Static pose: Left arm bent up towards ear / mixer
    leftUpperArm.rotation.set(0.6, 0.2, 0.4);
    leftForearm.rotation.set(-1.2, 0.1, -0.3);

    leftUpperArm.add(leftForearm);
    leftArmGroup.add(leftUpperArm);
    torsoGroup.add(leftArmGroup);

    // Right Arm (Dynamic bobbing / fist pump)
    const rightArmGroup = new THREE.Group();
    rightArmGroup.name = 'rightArm';
    rightArmGroup.position.set(0.45, 0.75, 0);

    const rightUpperArm = new THREE.Group();
    rightUpperArm.name = 'upperArm';
    const rUpperMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 8), hoodieMat);
    rUpperMesh.position.set(0, -0.15, 0);
    rightUpperArm.add(rUpperMesh);

    const rightForearm = new THREE.Group();
    rightForearm.name = 'forearm';
    rightForearm.position.set(0, -0.3, 0);
    const rForeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8), skinMat);
    rForeMesh.position.set(0, -0.15, 0);
    rightForearm.add(rForeMesh);

    const rightHand = new THREE.Group();
    rightHand.name = 'hand';
    rightHand.position.set(0, -0.35, 0);
    const rHandMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.08), skinMat);
    rightHand.add(rHandMesh);
    rightForearm.add(rightHand);

    rightUpperArm.add(rightForearm);
    rightArmGroup.add(rightUpperArm);
    torsoGroup.add(rightArmGroup);

    djGroup.add(torsoGroup);

    // Legs
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.75, 0.25), pantsMat);
    leftLeg.name = 'leftLeg';
    leftLeg.position.set(-0.2, 0.375, 0);
    djGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.75, 0.25), pantsMat);
    rightLeg.name = 'rightLeg';
    rightLeg.position.set(0.2, 0.375, 0);
    djGroup.add(rightLeg);

    // Shoes
    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.35), shoeMat);
    leftShoe.position.set(-0.2, 0.06, 0.05);
    djGroup.add(leftShoe);

    const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.35), shoeMat);
    rightShoe.position.set(0.2, 0.06, 0.05);
    djGroup.add(rightShoe);

    return {
        root: djGroup,
        torso: torsoGroup,
        head: headGroup,
        headphones: headphonesGroup,
        leftArm: leftArmGroup,
        rightArm: rightUpperArm, // root pivot of right arm for rotation
        rightUpperArm,
        rightForearm,
        fistPumpTimer: 0.0
    };
}

/**
 * Updates head nod rotation on X-axis based on beat and spring factor.
 */
export function updateDJHeadNod(headNode, timeSeconds, bpm = 128, beatEnergy = 1.0) {
    if (!headNode || !headNode.rotation) return 0;
    const freq = bpm / 60;
    const targetAngle = Math.sin(2 * Math.PI * freq * timeSeconds) * DJ_CONFIG.headNod.maxAngleRad * Math.min(1, Math.max(0, beatEnergy));

    // Spring lerp towards target
    headNode.rotation.x += (targetAngle - headNode.rotation.x) * DJ_CONFIG.headNod.springFactor;
    return headNode.rotation.x;
}

/**
 * Updates torso Y scale bounce on kick drum energy hits.
 */
export function updateDJShoulderBounce(torsoNode, kickEnergy) {
    if (!torsoNode || !torsoNode.scale) return 1.0;
    if (kickEnergy > DJ_CONFIG.shoulderBounce.kickThreshold) {
        const pulse = (kickEnergy - DJ_CONFIG.shoulderBounce.kickThreshold) / (1.0 - DJ_CONFIG.shoulderBounce.kickThreshold);
        torsoNode.scale.y = 1.0 + (pulse * 0.01);
    } else {
        // Recover to 1.00
        torsoNode.scale.y += (1.0 - torsoNode.scale.y) * 0.2;
    }
    return torsoNode.scale.y;
}

/**
 * Updates right arm bobbing / mixing or fist pump on drop events.
 */
export function updateDJRightArm(rightArmNode, dt, bassEnergy, isDrop, rigState) {
    if (!rightArmNode) return;
    const armPivot = rightArmNode.upperArm || rightArmNode;
    if (!armPivot || !armPivot.rotation) return;

    // Check drop trigger
    if (isDrop || bassEnergy > DJ_CONFIG.fistPump.dropThreshold) {
        rigState.fistPumpTimer = DJ_CONFIG.fistPump.durationSeconds;
    }

    if (rigState.fistPumpTimer > 0) {
        const safeDt = Math.max(0, dt);
        rigState.fistPumpTimer = Math.max(0, rigState.fistPumpTimer - safeDt);
    }

    if (rigState.fistPumpTimer > 0) {
        // Fist pump active: arm raised high
        armPivot.rotation.z = DJ_CONFIG.fistPump.armAngleRad;
        armPivot.rotation.x = -0.3;
    } else {
        // Idle / DJ mixing arm bobbing driven by bass energy
        const bobAngle = (bassEnergy * 0.5) - 0.25;
        armPivot.rotation.z = 0.2;
        armPivot.rotation.x = bobAngle;
    }
}

/**
 * Full DJ animation step.
 */
export function updateDJAvatar(rig, dt, audioData) {
    if (!rig) return null;
    const { time = 0, bpm = 128, beatEnergy = 0, kickEnergy = 0, bassEnergy = 0, isDrop = false } = audioData || {};

    updateDJHeadNod(rig.head, time, bpm, beatEnergy);
    updateDJShoulderBounce(rig.torso, kickEnergy);
    updateDJRightArm(rig.rightArm, dt, bassEnergy, isDrop, rig);

    return {
        headNodAngle: rig.head && rig.head.rotation ? rig.head.rotation.x : 0,
        torsoScaleY: rig.torso && rig.torso.scale ? rig.torso.scale.y : 1,
        isFistPumping: rig.fistPumpTimer > 0,
        fistPumpRemaining: rig.fistPumpTimer
    };
}
