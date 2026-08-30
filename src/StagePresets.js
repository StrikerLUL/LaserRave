import * as THREE from 'three';

export const STAGE_PRESETS = {
    berghain: {
        id: 'berghain',
        name: 'Berghain Bunker',
        isIndoor: true,
        bounds: { width: 30, depth: 40, height: 5.0 }, // Low 5m concrete ceiling
        ambientIntensity: 0.03, // Very dark ambient
        hazeDensity: 0.90, // Dense haze
        forcedTheme: 'bloodmoon', // Hard techno palette forced
        screensEnabled: false,
        screenCount: 0,
        fixtures: {
            movingHeads: 6, // 6 center moving heads
            lasers: 4,
            strobes: 8
        },
        beams: { count: 8, material: 'steel-i-beam' },
        cameraPreset: { x: 0, y: 2.2, z: 12, fov: 60 }
    },
    openair: {
        id: 'openair',
        name: 'Open-Air Festival',
        isIndoor: false,
        bounds: { width: 40.0, depth: 60, height: null }, // Open sky (no ceiling)
        ambientIntensity: 0.15,
        hazeDensity: 0.45,
        screensEnabled: true,
        screenCount: 3,
        starfield: { enabled: true, count: 2500, spread: 300 },
        ground: { type: 'grass', proceduralTexture: true },
        towers: [
            { id: 'tower-left', x: -20.0, y: 10.0, z: -5.0, height: 20 },
            { id: 'tower-right', x: 20.0, y: 10.0, z: -5.0, height: 20 }
        ],
        defaultWeather: { rain: true, intensity: 4000 },
        cameraPreset: { x: 0, y: 4.0, z: 32, fov: 65 }
    },
    arena: {
        id: 'arena',
        name: 'Arena 360',
        isIndoor: true,
        bounds: { width: 60, depth: 60, height: 25.0 },
        ambientIntensity: 0.08,
        hazeDensity: 0.60,
        screensEnabled: true,
        screenCount: 1, // Giant wrapping 360 LED ring
        screenType: 'cylinder-360',
        circularTrussRig: {
            radius: 18.0,
            suspendedHeight: 20.0,
            fixtureCount: 32
        },
        crowd: {
            topology: 'concentric-rings',
            memberCount: 200,
            minRadius: 8.0,
            maxRadius: 28.0,
            ringCount: 6
        },
        cameraPreset: { x: 0, y: 6.0, z: 28, fov: 70 }
    },
    basement: {
        id: 'basement',
        name: 'Basement Club',
        isIndoor: true,
        bounds: { width: 8.0, depth: 8.0, height: 3.0 }, // 8m x 8m x 3m compact room
        ambientIntensity: 0.04,
        hazeDensity: 1.0, // Maximum fog
        screensEnabled: false,
        screenCount: 0,
        fixtures: {
            lasers: 2, // 2 lasers
            movingHeads: 4 // 4 moving heads
        },
        neonSigns: [
            { text: 'NO PHOTOS', position: { x: -3.9, y: 2.0, z: 0 }, color: 0xff0044 },
            { text: 'CLUB', position: { x: 3.9, y: 2.2, z: 1 }, color: 0x00ffcc },
            { text: 'RAVE', position: { x: 0, y: 2.4, z: -3.9 }, color: 0xffff00 }
        ],
        crowd: {
            topology: 'compact-dancefloor',
            memberCount: 30,
            minDist: 0.4
        },
        cameraPreset: { x: 0, y: 1.6, z: 3.8, fov: 80 }
    }
};

/**
 * Returns preset definition with fallback.
 * @param {string} presetId
 * @returns {typeof STAGE_PRESETS.openair}
 */
export function getStagePreset(presetId) {
    if (!presetId || typeof presetId !== 'string') return STAGE_PRESETS.openair;
    const key = presetId.toLowerCase().trim();
    if (Object.prototype.hasOwnProperty.call(STAGE_PRESETS, key)) {
        return STAGE_PRESETS[key];
    }
    return STAGE_PRESETS.openair;
}

/**
 * Generates concentric ring crowd member coordinates around center (0, 0, 0).
 * @param {number} totalCount
 * @param {number} minR
 * @param {number} maxR
 * @param {number} ringCount
 * @returns {Array<{id: string, x: number, y: number, z: number, ringIndex: number, distanceToCenter: number, lookAtStageAngle: number}>}
 */
export function generateConcentricCrowd(totalCount = 200, minR = 8.0, maxR = 28.0, ringCount = 6) {
    const crowd = [];
    const safeRingCount = Math.max(1, Math.floor(ringCount) || 1);
    const membersPerRing = Math.floor(totalCount / safeRingCount);
    let idCounter = 0;

    for (let rIdx = 0; rIdx < safeRingCount; rIdx++) {
        const radius = safeRingCount <= 1
            ? (minR + maxR) / 2
            : minR + (rIdx / (safeRingCount - 1)) * (maxR - minR);
        const countThisRing = (rIdx === safeRingCount - 1)
            ? (totalCount - crowd.length) // Fill remaining
            : membersPerRing;

        for (let i = 0; i < countThisRing; i++) {
            const angle = (i / countThisRing) * Math.PI * 2 + (rIdx * 0.35); // Stagger angles
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            crowd.push({
                id: `crowd-arena-${idCounter++}`,
                x,
                y: 0, // Ground level
                z,
                ringIndex: rIdx,
                distanceToCenter: radius,
                lookAtStageAngle: angle + Math.PI // Looking towards center (0,0)
            });
        }
    }
    return crowd;
}

/**
 * Generates compact dancefloor crowd within room boundaries.
 * @param {number} count
 * @param {number} roomW
 * @param {number} roomD
 * @param {number} minDist
 * @returns {Array<{id: string, x: number, y: number, z: number}>}
 */
export function generateCompactDancefloor(count = 30, roomW = 8.0, roomD = 8.0, minDist = 0.4) {
    const crowd = [];
    const halfW = (roomW / 2) - 0.6;
    const halfD = (roomD / 2) - 0.6;
    let seed = 42;

    function pseudoRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }

    let attempts = 0;
    let idCounter = 0;
    while (crowd.length < count && attempts < 1000) {
        attempts++;
        const x = -halfW + pseudoRandom() * (halfW * 2);
        const z = -halfD + pseudoRandom() * (halfD * 2);

        // Check min distance to existing members
        let tooClose = false;
        for (const m of crowd) {
            const dx = m.x - x;
            const dz = m.z - z;
            if (Math.hypot(dx, dz) < minDist) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose) {
            crowd.push({
                id: `crowd-basement-${idCounter++}`,
                x: Math.round(x * 100) / 100,
                y: 0,
                z: Math.round(z * 100) / 100
            });
        }
    }
    return crowd;
}

/**
 * Validates stage preset switching behavior and state updates.
 * @param {string} presetId
 * @param {object} currentState
 * @returns {object}
 */
export function applyStagePreset(presetId, currentState = {}) {
    const preset = getStagePreset(presetId);
    const updatedState = { ...currentState };

    updatedState.currentPreset = preset.id;
    updatedState.hazeDensity = preset.hazeDensity;
    updatedState.ambientIntensity = preset.ambientIntensity;
    updatedState.screensEnabled = preset.screensEnabled;

    if (preset.forcedTheme) {
        updatedState.activeTheme = preset.forcedTheme;
    }

    if (preset.defaultWeather && preset.defaultWeather.rain) {
        updatedState.rainEnabled = true;
        updatedState.rainIntensity = preset.defaultWeather.intensity;
    } else {
        updatedState.rainEnabled = false;
        updatedState.rainIntensity = 0;
    }

    updatedState.cameraPosition = { ...preset.cameraPreset };
    return updatedState;
}

/**
 * Creates procedural 3D starfield for outdoor stages.
 * @param {number} count
 * @param {number} spread
 * @returns {THREE.Points}
 */
export function createProceduralStarfield(count = 2500, spread = 300) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random()); // upper hemisphere
        const r = spread * (0.8 + Math.random() * 0.4);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi) + 5.0; // above horizon
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: 0xaaccff,
        size: 1.2,
        transparent: true,
        opacity: 0.8
    });
    return new THREE.Points(geo, mat);
}

/**
 * Creates procedural grass canvas texture for open-air stages.
 * @returns {THREE.CanvasTexture}
 */
export function createProceduralGrassTexture() {
    if (typeof document === 'undefined') {
        // Fallback for non-DOM environments
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#0b160d';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const h = 2 + Math.random() * 5;
        const g = Math.floor(30 + Math.random() * 45);
        ctx.fillStyle = `rgb(10, ${g}, 15)`;
        ctx.fillRect(x, y, 1, h);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 20);
    return tex;
}

/**
 * Creates a glowing procedural 3D neon wall sign with point light illumination.
 * @param {string} text
 * @param {number} colorHex
 * @param {{x: number, y: number, z: number}} pos
 * @param {number} rotY
 * @returns {THREE.Group}
 */
export function createNeonSign(text, colorHex, pos, rotY = 0) {
    const group = new THREE.Group();
    if (typeof document === 'undefined') {
        return group;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 512, 128);
        ctx.font = 'bold 54px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 8;
        ctx.strokeText(text, 256, 64);
        ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
        ctx.fillText(text, 256, 64);
    }

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.y = rotY;
    group.add(mesh);

    const light = new THREE.PointLight(colorHex, 1.5, 8.0, 1.2);
    light.position.set(pos.x, pos.y, pos.z);
    group.add(light);

    return group;
}
