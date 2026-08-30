/**
 * src/AudiencePOV.js
 * Pure Math & Camera Dynamics Engine for LaserRave Audience POV Camera Mode (R4)
 */

export const POV_CONFIG = {
    eyeLevel: 1.75, // meters
    headBob: {
        amplitude: 0.04, // meters
        defaultBPM: 128
    },
    kickShake: {
        maxDisplacement: 0.015, // meters
        decayDuration: 0.30, // seconds
        thresholdBassEnergy: 0.75
    },
    hopTransition: {
        duration: 0.60, // seconds
        beatInterval: 4 // every 4th beat
    },
    yawVarianceLimitDeg: 5.0, // +/- 5 degrees
    aspectRatio: {
        landscape: 16 / 9,
        portrait: 9 / 16
    }
};

export const AUDIENCE_POV_CONFIG = POV_CONFIG;

/**
 * Calculates base audience camera position at eye level (y = 1.75m).
 * @param {{x: number, z: number}} crowdMember 
 * @returns {{x: number, y: number, z: number}}
 */
export function getAudienceBasePosition(crowdMember) {
    if (!crowdMember || typeof crowdMember.x !== 'number' || typeof crowdMember.z !== 'number') {
        return { x: 0, y: POV_CONFIG.eyeLevel, z: 10 };
    }
    return {
        x: crowdMember.x,
        y: POV_CONFIG.eyeLevel,
        z: crowdMember.z
    };
}

/**
 * Calculates audience POV position with head bob and kick shake offsets.
 * @param {{x: number, z: number}} crowdMember 
 * @param {number} baseY 
 * @param {number} headBobOffset 
 * @param {{x: number, y: number, z: number}|number} kickShakeOffset 
 * @returns {{x: number, y: number, z: number}}
 */
export function computeAudiencePOVPosition(crowdMember, baseY = POV_CONFIG.eyeLevel, headBobOffset = 0, kickShakeOffset = { x: 0, y: 0, z: 0 }) {
    const base = getAudienceBasePosition(crowdMember);
    const shakeX = typeof kickShakeOffset === 'number' ? 0 : (kickShakeOffset?.x || 0);
    const shakeY = typeof kickShakeOffset === 'number' ? kickShakeOffset : (kickShakeOffset?.y || 0);
    const shakeZ = typeof kickShakeOffset === 'number' ? 0 : (kickShakeOffset?.z || 0);

    return {
        x: base.x + shakeX,
        y: (baseY ?? POV_CONFIG.eyeLevel) + headBobOffset + shakeY,
        z: base.z + shakeZ
    };
}

/**
 * Calculates look-at rotation angle towards stage center with subtle yaw variance.
 * @param {{x: number, y: number, z: number}} camPos
 * @param {{x: number, y: number, z: number}} targetPos
 * @param {number} yawVarianceDeg
 * @returns {number} Yaw angle in radians
 */
export function calculateLookAtYaw(camPos, targetPos = { x: 0, y: 2.0, z: 0 }, yawVarianceDeg = 0) {
    const clampedVarianceDeg = Math.max(-POV_CONFIG.yawVarianceLimitDeg, Math.min(POV_CONFIG.yawVarianceLimitDeg, yawVarianceDeg));
    const varianceRad = (clampedVarianceDeg * Math.PI) / 180;

    const dx = targetPos.x - camPos.x;
    const dz = targetPos.z - camPos.z;
    const baseYaw = Math.atan2(dx, dz);

    return baseYaw + varianceRad;
}

/**
 * Calculates sinusoidal head-bob offset in sync with BPM.
 * @param {number} timeSeconds
 * @param {number} bpm
 * @param {number} beatEnergy
 * @returns {number} Vertical offset in meters
 */
export function calculateHeadBob(timeSeconds, bpm = POV_CONFIG.headBob.defaultBPM, beatEnergy = 1.0) {
    if (bpm <= 0 || beatEnergy <= 0) return 0;
    const freq = bpm / 60; // cycles per second
    const energyClamped = Math.max(0, Math.min(1, beatEnergy));
    return Math.sin(2 * Math.PI * freq * timeSeconds) * POV_CONFIG.headBob.amplitude * energyClamped;
}

/**
 * Calculates head-bob vertical offset based on beat phase and energy.
 * @param {number} beatPhase
 * @param {number} BPM
 * @param {number} energy
 * @returns {number}
 */
export function computeHeadBob(beatPhase, BPM = POV_CONFIG.headBob.defaultBPM, energy = 1.0) {
    if (BPM <= 0 || energy <= 0) return 0;
    const freq = BPM / 60;
    const energyFactor = Math.max(0, Math.min(1, energy));
    return Math.sin(2 * Math.PI * freq * beatPhase) * POV_CONFIG.headBob.amplitude * energyFactor;
}

/**
 * Calculates decaying camera kick shake offset on bass peaks.
 * @param {number} elapsedSinceKick
 * @param {{x: number, y: number, z: number}} initialRandomVector
 * @returns {{x: number, y: number, z: number}}
 */
export function calculateKickShake(elapsedSinceKick, initialRandomVector = { x: 0.015, y: 0.015, z: 0.015 }) {
    if (elapsedSinceKick < 0 || elapsedSinceKick >= POV_CONFIG.kickShake.decayDuration) {
        return { x: 0, y: 0, z: 0 };
    }
    // Linear decay from 1.0 to 0.0 over 0.3s
    const decay = 1.0 - (elapsedSinceKick / POV_CONFIG.kickShake.decayDuration);
    return {
        x: initialRandomVector.x * decay,
        y: initialRandomVector.y * decay,
        z: initialRandomVector.z * decay
    };
}

/**
 * Calculates continuous kick shake exponential decay.
 * @param {number} kick
 * @param {number} decay
 * @param {number} dt
 * @param {number} currentShake
 * @returns {number}
 */
export function computeKickShake(kick, decay = 10, dt = 0.016, currentShake = 0) {
    const newShake = (currentShake + kick * POV_CONFIG.kickShake.maxDisplacement) * Math.exp(-decay * dt);
    return Math.max(0, newShake);
}

/**
 * Smoothstep interpolation factor.
 * @param {number} u
 * @returns {number}
 */
export function smoothstep(u) {
    const t = Math.max(0, Math.min(1, u));
    return t * t * (3 - 2 * t);
}

/**
 * Interpolates camera position between two crowd members over 0.6s with optional parabolic arc.
 * @param {{x: number, y: number, z: number}} startPos
 * @param {{x: number, y: number, z: number}} targetPos
 * @param {number} elapsedSeconds
 * @param {number} duration
 * @param {number} arcHeight
 * @returns {{x: number, y: number, z: number, progress: number, isComplete: boolean}}
 */
export function interpolateCrowdHop(startPos, targetPos, elapsedSeconds, duration = POV_CONFIG.hopTransition.duration, arcHeight = 0) {
    if (duration <= 0) {
        return {
            x: targetPos.x,
            y: targetPos.y,
            z: targetPos.z,
            progress: 1.0,
            isComplete: true
        };
    }
    const progress = Math.max(0, Math.min(1, elapsedSeconds / duration));
    const factor = smoothstep(progress);
    const parabolicArc = Math.sin(progress * Math.PI) * arcHeight;

    return {
        x: startPos.x + (targetPos.x - startPos.x) * factor,
        y: startPos.y + (targetPos.y - startPos.y) * factor + parabolicArc,
        z: startPos.z + (targetPos.z - startPos.z) * factor,
        progress,
        isComplete: progress >= 1.0
    };
}

/**
 * Calculates portrait vertical FOV from landscape FOV preserving horizontal framing.
 * @param {number} landscapeVFOVDeg
 * @param {number} landscapeAspect
 * @param {number} portraitAspect
 * @returns {number}
 */
export function calculatePortraitVFOV(landscapeVFOVDeg, landscapeAspect = POV_CONFIG.aspectRatio.landscape, portraitAspect = POV_CONFIG.aspectRatio.portrait) {
    const vFovRad = (landscapeVFOVDeg * Math.PI) / 180;
    const tanHalfVFov = Math.tan(vFovRad / 2);
    const tanHalfHFov = tanHalfVFov * landscapeAspect;

    const portraitTanHalfVFov = tanHalfHFov / portraitAspect;
    const portraitVFOVRad = 2 * Math.atan(portraitTanHalfVFov);
    const portraitVFOVDeg = (portraitVFOVRad * 180) / Math.PI;

    return Math.min(130, Math.max(20, portraitVFOVDeg)); // Clamp to sensible lens range
}

/**
 * Calculates TikTok 9:16 portrait FOV from base landscape FOV.
 * @param {number} baseFOV
 * @param {number} aspect
 * @returns {number}
 */
export function computeTikTokPortraitFOV(baseFOV = 60, aspect = POV_CONFIG.aspectRatio.portrait) {
    return calculatePortraitVFOV(baseFOV, POV_CONFIG.aspectRatio.landscape, aspect);
}

/**
 * Superimposes all audience POV camera components into final camera transform.
 */
export function evaluateAudiencePOVCamera({
    currentCrowdMember,
    targetCrowdMember,
    hopElapsed,
    timeSeconds,
    bpm,
    beatEnergy,
    kickElapsed,
    isPortraitMode = false,
    landscapeVFOV = 60
}) {
    let basePos;
    if (targetCrowdMember && typeof hopElapsed === 'number' && hopElapsed < POV_CONFIG.hopTransition.duration) {
        const start = getAudienceBasePosition(currentCrowdMember);
        const end = getAudienceBasePosition(targetCrowdMember);
        basePos = interpolateCrowdHop(start, end, hopElapsed);
    } else {
        basePos = getAudienceBasePosition(currentCrowdMember);
    }

    const bobOffset = calculateHeadBob(timeSeconds, bpm, beatEnergy);
    const shakeOffset = calculateKickShake(kickElapsed);

    const finalPos = {
        x: basePos.x + shakeOffset.x,
        y: basePos.y + bobOffset + shakeOffset.y,
        z: basePos.z + shakeOffset.z
    };

    const finalFOV = isPortraitMode
        ? calculatePortraitVFOV(landscapeVFOV)
        : landscapeVFOV;

    return {
        position: finalPos,
        eyeLevel: POV_CONFIG.eyeLevel,
        fov: finalFOV
    };
}
