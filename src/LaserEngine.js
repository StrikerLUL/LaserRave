import * as THREE from 'three';

/**
 * Aims selected lasers at a specific 3D target point.
 * Computes the required pan and tilt relative to each laser's baseYaw.
 *
 * @param {Array} lasers - List of laser fixture objects
 * @param {THREE.Vector3} target - The target 3D point in world space
 */
export function aimAtTarget(lasers, target) {
    if (!lasers || !Array.isArray(lasers) || !target) return;
    lasers.forEach(l => {
        if (!l || !l.pos) return;
        const dx = target.x - l.pos.x;
        const dy = target.y - l.pos.y;
        const dz = target.z - l.pos.z;
        const dXZ = Math.sqrt(dx * dx + dz * dz);
        
        let desiredYaw = Math.atan2(dx, dz);
        let localPan = desiredYaw - (l.baseYaw || 0);
        let manualPan = THREE.MathUtils.radToDeg(localPan);
        
        // Ensure manualPan stays roughly between -180 and 180 to prevent slider explosion
        while (manualPan > 180) manualPan -= 360;
        while (manualPan < -180) manualPan += 360;
        
        let desiredPitch = -Math.atan2(dy, dXZ);
        let manualTilt = THREE.MathUtils.radToDeg(desiredPitch);
        
        // Normalize -0 to 0
        if (Object.is(manualPan, -0)) manualPan = 0;
        if (Object.is(manualTilt, -0)) manualTilt = 0;
        
        l.isManualOverride = true;
        l.manualPan = manualPan;
        l.manualTilt = manualTilt;
    });
}

export const LaserEngine = {
    aimAtTarget
};
