import * as THREE from 'three';

export const STAGE_BUILDER_CONFIG = {
    gridSize: 0.5, // 0.5m snap floor grid
    maxFixtures: 500,
    storageKey: 'laserrave_custom_layout',
    allowedTypes: ['truss', 'screen', 'laser', 'movinghead', 'co2', 'uplight'],
    bounds: {
        minX: -50, maxX: 50,
        minY: 0, maxY: 30,
        minZ: -50, maxZ: 50
    }
};

/**
 * Snaps a single numerical coordinate to the specified grid step (default 0.5m).
 * @param {number} val
 * @param {number} step
 * @returns {number}
 */
export function snapToGrid(val, step = STAGE_BUILDER_CONFIG.gridSize) {
    if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
    if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) return val;
    const inv = 1 / step;
    const res = Math.round(val * inv) / inv;
    return res === 0 ? 0 : res;
}

/**
 * Snaps a 3D vector object {x, y, z} to the grid.
 * @param {{x?: number, y?: number, z?: number}} vec
 * @param {number} step
 * @returns {{x: number, y: number, z: number}}
 */
export function snapVector3(vec, step = STAGE_BUILDER_CONFIG.gridSize) {
    if (!vec || typeof vec !== 'object') return { x: 0, y: 0, z: 0 };
    return {
        x: snapToGrid(vec.x ?? 0, step),
        y: snapToGrid(vec.y ?? 0, step),
        z: snapToGrid(vec.z ?? 0, step)
    };
}

/**
 * Normalizes rotation yaw (around Y axis) in radians to [0, 2PI).
 * @param {number} rad
 * @returns {number}
 */
export function normalizeYaw(rad) {
    if (typeof rad !== 'number' || !Number.isFinite(rad)) return 0;
    const twoPi = Math.PI * 2;
    let norm = rad % twoPi;
    if (norm < 0) norm += twoPi;
    return norm === 0 ? 0 : norm;
}

/**
 * Clamps position within defined stage bounds.
 * @param {{x?: number, y?: number, z?: number}} pos
 * @param {typeof STAGE_BUILDER_CONFIG.bounds} bounds
 * @returns {{x: number, y: number, z: number}}
 */
export function clampToBounds(pos, bounds = STAGE_BUILDER_CONFIG.bounds) {
    const p = (pos && typeof pos === 'object') ? pos : {};
    const b = (bounds && typeof bounds === 'object') ? bounds : STAGE_BUILDER_CONFIG.bounds;
    const x = Math.max(b.minX, Math.min(b.maxX, (typeof p.x === 'number' && Number.isFinite(p.x)) ? p.x : 0));
    const y = Math.max(b.minY, Math.min(b.maxY, (typeof p.y === 'number' && Number.isFinite(p.y)) ? p.y : 0));
    const z = Math.max(b.minZ, Math.min(b.maxZ, (typeof p.z === 'number' && Number.isFinite(p.z)) ? p.z : 0));
    return { x, y, z };
}

/**
 * Validates a single fixture schema object.
 * @param {object} fixture
 * @returns {{valid: boolean, error?: string}}
 */
export function validateFixture(fixture) {
    if (!fixture || typeof fixture !== 'object') {
        return { valid: false, error: 'Fixture must be an object' };
    }
    if (!fixture.id || typeof fixture.id !== 'string') {
        return { valid: false, error: 'Fixture must have a valid string id' };
    }
    if (!STAGE_BUILDER_CONFIG.allowedTypes.includes(fixture.type)) {
        return { valid: false, error: `Invalid fixture type: ${fixture.type}` };
    }
    if (!fixture.position || typeof fixture.position !== 'object' ||
        typeof fixture.position.x !== 'number' || !Number.isFinite(fixture.position.x) ||
        typeof fixture.position.y !== 'number' || !Number.isFinite(fixture.position.y) ||
        typeof fixture.position.z !== 'number' || !Number.isFinite(fixture.position.z)) {
        return { valid: false, error: 'Fixture position must contain finite numbers {x, y, z}' };
    }
    return { valid: true };
}

/**
 * Serializes stage layout to JSON string according to PROJECT.md schema.
 * @param {object} layout
 * @returns {string}
 */
export function serializeStageLayout(layout) {
    if (!layout || typeof layout !== 'object') {
        throw new Error('Layout must be an object');
    }
    const fixtures = Array.isArray(layout.fixtures) ? layout.fixtures : [];
    if (fixtures.length > STAGE_BUILDER_CONFIG.maxFixtures) {
        throw new Error(`Fixture count exceeds maximum limit of ${STAGE_BUILDER_CONFIG.maxFixtures}`);
    }
    for (let i = 0; i < fixtures.length; i++) {
        const check = validateFixture(fixtures[i]);
        if (!check.valid) {
            throw new Error(`Invalid fixture at index ${i}: ${check.error}`);
        }
    }

    const payload = {
        version: layout.version || '1.0.0',
        name: layout.name || 'Custom Stage',
        timestamp: layout.timestamp || Date.now(),
        fixtures: fixtures.map(f => ({
            id: f.id,
            type: f.type,
            position: { x: f.position.x, y: f.position.y, z: f.position.z },
            rotation: f.rotation ? { x: f.rotation.x ?? 0, y: f.rotation.y ?? 0, z: f.rotation.z ?? 0 } : { x: 0, y: 0, z: 0 },
            scale: f.scale ? { x: f.scale.x ?? 1, y: f.scale.y ?? 1, z: f.scale.z ?? 1 } : { x: 1, y: 1, z: 1 },
            properties: f.properties ? { ...f.properties } : {}
        }))
    };
    return JSON.stringify(payload);
}

/**
 * Deserializes and validates a stage layout JSON string.
 * @param {string} jsonStr
 * @returns {object|null}
 */
export function deserializeStageLayout(jsonStr) {
    if (!jsonStr || typeof jsonStr !== 'string') {
        return null;
    }
    try {
        const data = JSON.parse(jsonStr);
        if (!data || typeof data !== 'object') return null;
        if (!data.version || !Array.isArray(data.fixtures)) return null;

        const validFixtures = [];
        for (const f of data.fixtures) {
            const check = validateFixture(f);
            if (check.valid) {
                validFixtures.push(f);
            }
        }
        return {
            version: data.version,
            name: data.name || 'Custom Stage',
            timestamp: data.timestamp || Date.now(),
            fixtures: validFixtures
        };
    } catch {
        return null;
    }
}

/**
 * Storage save helper with mockable storage.
 * @param {object} layout
 * @param {Storage} storage
 * @returns {string}
 */
export function saveLayoutToStorage(layout, storage = globalThis.localStorage) {
    const jsonStr = serializeStageLayout(layout);
    if (storage && typeof storage.setItem === 'function') {
        try {
            storage.setItem(STAGE_BUILDER_CONFIG.storageKey, jsonStr);
        } catch {
            // Silently ignore storage quota or sandbox SecurityErrors
        }
    }
    return jsonStr;
}

/**
 * Storage load helper with fallback to default template.
 * @param {Storage} storage
 * @param {string} fallbackTemplate
 * @returns {object}
 */
export function loadLayoutFromStorage(storage = globalThis.localStorage, fallbackTemplate = 'Large Festival') {
    if (storage && typeof storage.getItem === 'function') {
        try {
            const raw = storage.getItem(STAGE_BUILDER_CONFIG.storageKey);
            if (raw) {
                const parsed = deserializeStageLayout(raw);
                if (parsed && parsed.fixtures.length >= 0) {
                    return parsed;
                }
            }
        } catch {
            // Silently fall through to default template on sandbox / private browsing errors
        }
    }
    return getTemplateLayout(fallbackTemplate);
}

/**
 * Compiles custom stage layout into simulation subsystems.
 * @param {object} layoutData
 * @returns {{lasers: Array, movingHeads: Array, screens: Array, co2Jets: Array, uplights: Array, trusses: Array, totalCount: number}}
 */
export function compileCustomStageLayout(layoutData) {
    if (!layoutData || !Array.isArray(layoutData.fixtures)) {
        return {
            lasers: [],
            movingHeads: [],
            screens: [],
            co2Jets: [],
            uplights: [],
            trusses: [],
            totalCount: 0
        };
    }

    const result = {
        lasers: [],
        movingHeads: [],
        screens: [],
        co2Jets: [],
        uplights: [],
        trusses: [],
        totalCount: 0
    };

    for (const fix of layoutData.fixtures) {
        switch (fix.type) {
            case 'laser':
                result.lasers.push(fix);
                break;
            case 'movinghead':
                result.movingHeads.push(fix);
                break;
            case 'screen':
                result.screens.push(fix);
                break;
            case 'co2':
                result.co2Jets.push(fix);
                break;
            case 'uplight':
                result.uplights.push(fix);
                break;
            case 'truss':
                result.trusses.push(fix);
                break;
        }
        result.totalCount++;
    }

    return result;
}

/**
 * Generates built-in template layouts.
 * @param {string} templateName
 * @returns {object}
 */
export function getTemplateLayout(templateName) {
    if (templateName === 'Small Club') {
        return {
            version: '1.0.0',
            name: 'Small Club Template',
            timestamp: Date.now(),
            fixtures: [
                { id: 'sc-truss-1', type: 'truss', position: { x: 0, y: 3.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
                { id: 'sc-laser-1', type: 'laser', position: { x: -2.5, y: 3.2, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: { color: 0x00ffcc } },
                { id: 'sc-laser-2', type: 'laser', position: { x: 2.5, y: 3.2, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: { color: 0xff00cc } },
                { id: 'sc-mh-1', type: 'movinghead', position: { x: -3.5, y: 3.0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
                { id: 'sc-mh-2', type: 'movinghead', position: { x: 3.5, y: 3.0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} }
            ]
        };
    }

    // Default: Large Festival
    return {
        version: '1.0.0',
        name: 'Large Festival Template',
        timestamp: Date.now(),
        fixtures: [
            { id: 'lf-truss-main', type: 'truss', position: { x: 0, y: 14, z: -10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 1, z: 1 }, properties: {} },
            { id: 'lf-screen-1', type: 'screen', position: { x: 0, y: 8, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 16, y: 9, z: 1 }, properties: { aspect: '16:9' } },
            { id: 'lf-laser-l1', type: 'laser', position: { x: -15, y: 12, z: -8 }, rotation: { x: 0, y: 0.2, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
            { id: 'lf-laser-r1', type: 'laser', position: { x: 15, y: 12, z: -8 }, rotation: { x: 0, y: -0.2, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
            { id: 'lf-co2-1', type: 'co2', position: { x: -6, y: 0.5, z: 2 }, rotation: { x: -0.2, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
            { id: 'lf-co2-2', type: 'co2', position: { x: 6, y: 0.5, z: 2 }, rotation: { x: -0.2, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
            { id: 'lf-mh-1', type: 'movinghead', position: { x: -10, y: 13, z: -9 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
            { id: 'lf-mh-2', type: 'movinghead', position: { x: 10, y: 13, z: -9 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, properties: {} }
        ]
    };
}
