/**
 * src/WeatherEffects.js
 * Pure Math & Physics Engine for LaserRave Weather & Rain Simulation (R3)
 */
import * as THREE from 'three';

export const WEATHER_CONFIG = {
    minParticles: 2000,
    maxParticles: 8000,
    defaultIntensity: 4000,
    bounds: {
        minX: -30, maxX: 30,
        minY: 0,   maxY: 30,
        minZ: -30, maxZ: 30
    },
    fallSpeed: { min: -35.0, max: -45.0 }, // m/s downwards
    streakAspect: { widthPx: 1, heightPx: 12 },
    splash: {
        minParticles: 3,
        maxParticles: 5,
        lifespan: 0.20, // seconds
        radialSpeed: 2.5,
        upwardSpeed: 3.0,
        gravity: -9.81
    },
    laserReflection: {
        thresholdRadius: 0.8, // meters around beam
        defaultRainColor: 0x88bbff
    },
    audio: {
        maxGain: 0.08,
        filterCenterFreq: 1000, // Hz
        filterQ: 0.7
    }
};

/**
 * Creates raw rain particle buffers with custom count, bounds, and speed.
 */
export function createRainBuffer(count = WEATHER_CONFIG.defaultIntensity, bounds = WEATHER_CONFIG.bounds, fallSpeed = WEATHER_CONFIG.fallSpeed) {
    const clampedCount = Math.max(WEATHER_CONFIG.minParticles, Math.min(WEATHER_CONFIG.maxParticles, Math.round(count)));
    const positions = new Float32Array(clampedCount * 3);
    const velocities = new Float32Array(clampedCount * 3);
    const colors = new Uint32Array(clampedCount);

    for (let i = 0; i < clampedCount; i++) {
        const i3 = i * 3;
        positions[i3]     = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        positions[i3 + 1] = Math.random() * bounds.maxY;
        positions[i3 + 2] = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);

        velocities[i3]     = 0.5; // Slight wind drift X
        velocities[i3 + 1] = fallSpeed.min + Math.random() * (fallSpeed.max - fallSpeed.min);
        velocities[i3 + 2] = -0.2; // Slight wind drift Z

        colors[i] = WEATHER_CONFIG.laserReflection.defaultRainColor;
    }

    return {
        count: clampedCount,
        positions,
        velocities,
        colors
    };
}

/**
 * Initializes rain particle system object with splash list.
 */
export function createRainParticleSystem(requestedCount = WEATHER_CONFIG.defaultIntensity) {
    const buffer = createRainBuffer(requestedCount);
    return {
        ...buffer,
        activeSplashes: []
    };
}

/**
 * Steps rain particle simulation forward by dt seconds.
 * Handles fall velocity, wind drift, floor boundary wrapping, and splash life cycle.
 * Returns array of new floor impact events { x, z }.
 */
export function updateRainParticles(system, dt, wind = { x: 0.5, z: -0.2 }) {
    if (!system || dt <= 0) return [];
    const impacts = [];

    for (let i = 0; i < system.count; i++) {
        const i3 = i * 3;
        system.velocities[i3]     = wind.x;
        system.velocities[i3 + 2] = wind.z;

        system.positions[i3]     += system.velocities[i3] * dt;
        system.positions[i3 + 1] += system.velocities[i3 + 1] * dt;
        system.positions[i3 + 2] += system.velocities[i3 + 2] * dt;

        // Floor impact check (y <= 0)
        if (system.positions[i3 + 1] <= 0) {
            impacts.push({
                x: system.positions[i3],
                z: system.positions[i3 + 2]
            });

            // Wrap back to top
            system.positions[i3 + 1] = WEATHER_CONFIG.bounds.maxY;
            system.positions[i3]     = WEATHER_CONFIG.bounds.minX + Math.random() * (WEATHER_CONFIG.bounds.maxX - WEATHER_CONFIG.bounds.minX);
            system.positions[i3 + 2] = WEATHER_CONFIG.bounds.minZ + Math.random() * (WEATHER_CONFIG.bounds.maxZ - WEATHER_CONFIG.bounds.minZ);
            system.colors[i]         = WEATHER_CONFIG.laserReflection.defaultRainColor;
        }
    }

    // Update active splash bursts
    if (system.activeSplashes) {
        updateSplashParticles(system.activeSplashes, dt);
    }

    return impacts;
}

/**
 * Emits radial splash particles upon floor impact.
 */
export function createSplashBurst(floorPos, count = 4) {
    const splashCount = Math.max(WEATHER_CONFIG.splash.minParticles, Math.min(WEATHER_CONFIG.splash.maxParticles, count));
    const particles = [];

    for (let i = 0; i < splashCount; i++) {
        const angle = (i / splashCount) * Math.PI * 2 + (Math.random() * 0.5);
        const speed = WEATHER_CONFIG.splash.radialSpeed * (0.8 + Math.random() * 0.4);
        particles.push({
            x: floorPos.x,
            y: 0.05,
            z: floorPos.z,
            vx: Math.cos(angle) * speed,
            vy: WEATHER_CONFIG.splash.upwardSpeed * (0.8 + Math.random() * 0.4),
            vz: Math.sin(angle) * speed,
            alpha: 1.0
        });
    }

    return {
        age: 0,
        lifespan: WEATHER_CONFIG.splash.lifespan,
        particles
    };
}

/**
 * Convenience wrapper adding a splash burst directly to system.
 */
export function emitSplashBurst(system, impactPos, count = 4) {
    const burst = createSplashBurst(impactPos, count);
    if (system && system.activeSplashes) {
        system.activeSplashes.push(burst);
    }
    return burst;
}

/**
 * Advances splash particle physics and prunes expired bursts.
 */
export function updateSplashParticles(splashList, dt) {
    if (!splashList || dt <= 0) return;
    for (let s = splashList.length - 1; s >= 0; s--) {
        const splash = splashList[s];
        splash.age += dt;
        if (splash.age >= splash.lifespan) {
            splashList.splice(s, 1);
            continue;
        }
        for (const p of splash.particles) {
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;
            p.z  += p.vz * dt;
            p.vy += WEATHER_CONFIG.splash.gravity * dt;
            p.alpha = Math.max(0, 1 - (splash.age / splash.lifespan));
        }
    }
}

/**
 * Computes shortest Euclidean distance from point P to 3D line segment AB.
 */
export function distancePointToSegment(P, A, B) {
    const abX = B.x - A.x;
    const abY = B.y - A.y;
    const abZ = B.z - A.z;
    const abLenSq = abX * abX + abY * abY + abZ * abZ;

    if (abLenSq <= 1e-9) {
        return Math.hypot(P.x - A.x, P.y - A.y, P.z - A.z);
    }

    const apX = P.x - A.x;
    const apY = P.y - A.y;
    const apZ = P.z - A.z;

    const t = Math.max(0, Math.min(1, (apX * abX + apY * abY + apZ * abZ) / abLenSq));
    const closestX = A.x + t * abX;
    const closestY = A.y + t * abY;
    const closestZ = A.z + t * abZ;

    return Math.hypot(P.x - closestX, P.y - closestY, P.z - closestZ);
}

/**
 * Computes ray-sphere / beam proximity intersection.
 */
export function computeLaserRainIntersection(raindropPos, laserBeamOrigin, laserBeamDir, beamRadius = 0.8, maxDist = 50.0) {
    const beamEnd = {
        x: laserBeamOrigin.x + laserBeamDir.x * maxDist,
        y: laserBeamOrigin.y + laserBeamDir.y * maxDist,
        z: laserBeamOrigin.z + laserBeamDir.z * maxDist
    };
    const dist = distancePointToSegment(raindropPos, laserBeamOrigin, beamEnd);
    return {
        isIntersecting: dist <= beamRadius,
        distance: dist
    };
}

/**
 * Calculates rain particle color reflection from nearby active laser beams.
 */
export function calculateLaserRainReflection(rainPos, laserBeams, threshold = WEATHER_CONFIG.laserReflection.thresholdRadius) {
    let closestDist = Infinity;
    let reflectedColor = WEATHER_CONFIG.laserReflection.defaultRainColor;

    if (!laserBeams || !Array.isArray(laserBeams)) {
        return { color: reflectedColor, distance: closestDist, isReflected: false };
    }

    for (const beam of laserBeams) {
        if (!beam || beam.active === false) continue;
        const start = beam.start || beam.pos;
        if (!start) continue;
        const end = beam.end || (beam.dir ? {
            x: start.x + beam.dir.x * (beam.length || 50.0),
            y: start.y + beam.dir.y * (beam.length || 50.0),
            z: start.z + beam.dir.z * (beam.length || 50.0)
        } : start);

        const dist = distancePointToSegment(rainPos, start, end);
        if (dist <= threshold && dist < closestDist) {
            closestDist = dist;
            reflectedColor = (typeof beam.color === 'object' && beam.color && typeof beam.color.getHex === 'function')
                ? beam.color.getHex()
                : (typeof beam.color === 'number' ? beam.color : WEATHER_CONFIG.laserReflection.defaultRainColor);
        }
    }
    return { color: reflectedColor, distance: closestDist, isReflected: closestDist <= threshold };
}

/**
 * Calculates procedural rain audio gain from particle intensity slider.
 * Supports calculateRainAudioGain(enabled, intensity) and calculateRainAudioGain(intensity, maxGain)
 */
export function calculateRainAudioGain(arg1, arg2) {
    let enabled = true;
    let intensity = WEATHER_CONFIG.defaultIntensity;
    let maxGain = WEATHER_CONFIG.audio.maxGain;

    if (typeof arg1 === 'boolean') {
        enabled = arg1;
        intensity = typeof arg2 === 'number' ? arg2 : WEATHER_CONFIG.defaultIntensity;
    } else if (typeof arg1 === 'number') {
        intensity = arg1;
        if (typeof arg2 === 'number') maxGain = arg2;
    }

    if (!enabled) return 0.0;

    const clamped = Math.max(WEATHER_CONFIG.minParticles, Math.min(WEATHER_CONFIG.maxParticles, intensity));
    const norm = (clamped - WEATHER_CONFIG.minParticles) / (WEATHER_CONFIG.maxParticles - WEATHER_CONFIG.minParticles);
    return 0.02 + norm * (maxGain - 0.02);
}

/**
 * Generates high-resolution vertical streak CanvasTexture with vertical alpha gradient.
 */
export function createRainStreakTexture() {
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, 16, 64);
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0.0, 'rgba(200, 230, 255, 0.0)');
    grad.addColorStop(0.3, 'rgba(200, 230, 255, 0.4)');
    grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 1.0)');

    ctx.fillStyle = grad;
    // Draw vertical streak in center (4px wide x 56px tall for 1:12 proportion)
    ctx.fillRect(6, 4, 4, 56);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}
