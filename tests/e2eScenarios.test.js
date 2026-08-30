import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';

// Import modules tested in prior suites
import {
    snapVector3,
    serializeStageLayout,
    deserializeStageLayout,
    compileCustomStageLayout,
    saveLayoutToStorage,
    loadLayoutFromStorage
} from './stageBuilder.test.js';

import {
    getStagePreset,
    generateConcentricCrowd,
    generateCompactDancefloor,
    applyStagePreset
} from './stagePresets.test.js';

import {
    createRainParticleSystem,
    updateRainParticles,
    emitSplashBurst,
    calculateLaserRainReflection,
    calculateRainAudioGain
} from './weatherEffects.test.js';

import {
    getAudienceBasePosition,
    evaluateAudiencePOVCamera,
    calculatePortraitVFOV
} from './audiencePOV.test.js';

import {
    PhotoModeManager,
    getFilterShaderConfig,
    generatePhotoFilename,
    applyNeonFilterTransform
} from './photoMode.test.js';

import {
    createDJRigHierarchy,
    updateDJAvatar
} from './djAvatar.test.js';

import {
    MIDIManager,
    parseMIDIMessage
} from '../src/MIDIController.js';

import {
    validateManifest,
    MockServiceWorkerContext,
    PWA_CONFIG
} from './pwaOffline.test.js';

// ---------------------------------------------------------------------------
// TEST SUITE: Tier 4 Real-World Application Scenarios (Integration & Workflow)
// ---------------------------------------------------------------------------

describe('Tier 4: Multi-Feature Integration & Real-World Application Scenarios', () => {
    let mockStorage;

    beforeEach(() => {
        const store = {};
        mockStorage = {
            getItem: (k) => store[k] ?? null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
            clear: () => { for (const k in store) delete store[k]; }
        };
    });

    test('Scenario 1: Open-Air Storm Rave (R2 + R3 + R4 + R6)', () => {
        // 1. Initialize Open-Air stage preset
        const stageState = applyStagePreset('openair', {
            currentPreset: 'none',
            rainEnabled: false,
            rainIntensity: 0
        });
        assert.strictEqual(stageState.currentPreset, 'openair');
        assert.strictEqual(stageState.rainEnabled, true);

        // 2. Initialize rain system at heavy intensity (8,000 particles)
        const rainSystem = createRainParticleSystem(8000);
        assert.strictEqual(rainSystem.count, 8000);

        // 3. Verify procedural rain audio gain
        const rainGain = calculateRainAudioGain(true, 8000);
        assert.strictEqual(rainGain, 0.08);

        // 4. Position active green laser beam
        const laserBeams = [
            {
                active: true,
                start: { x: -10, y: 15, z: -5 },
                end: { x: 10, y: 0, z: 20 },
                color: 0x00ff88
            }
        ];

        // 5. Simulate rain step: particles fall, check laser reflection & floor splash
        const rainNearBeam = { x: 0, y: 7.5, z: 7.5 }; // On beam midpoint
        const reflection = calculateLaserRainReflection(rainNearBeam, laserBeams);
        assert.strictEqual(reflection.isReflected, true);
        assert.strictEqual(reflection.color, 0x00ff88);

        // Particle hits floor (y <= 0)
        rainSystem.positions[1] = 0.05;
        rainSystem.velocities[1] = -40.0;
        const impacts = updateRainParticles(rainSystem, 0.016);
        assert.ok(impacts.length >= 1);
        const splash = emitSplashBurst(rainSystem, impacts[0], 4);
        assert.strictEqual(splash.particles.length, 4);

        // 6. Audience POV camera in crowd with DJ avatar on stage
        const crowdMember = { id: 'c1', x: 2.0, y: 0, z: 18.0 };
        const djRig = createDJRigHierarchy();

        // Simulate Drop hit
        const cameraFrame = evaluateAudiencePOVCamera({
            currentCrowdMember: crowdMember,
            timeSeconds: 1.0,
            bpm: 140,
            beatEnergy: 1.0,
            kickElapsed: 0.05,
            isPortraitMode: false,
            landscapeVFOV: 65
        });
        assert.strictEqual(cameraFrame.eyeLevel, 1.75);
        assert.ok(cameraFrame.position.y > 1.70 && cameraFrame.position.y < 1.82);

        const djFrame = updateDJAvatar(djRig, 0.016, {
            time: 1.0,
            bpm: 140,
            beatEnergy: 1.0,
            kickEnergy: 0.95,
            bassEnergy: 0.98,
            isDrop: true
        });
        assert.strictEqual(djFrame.isFistPumping, true);
        assert.ok(djFrame.torsoScaleY > 1.0);
    });

    test('Scenario 2: Berghain Underground Techno Session (R2 + R6 + R7)', () => {
        // 1. Load Berghain preset
        const berghain = getStagePreset('berghain');
        assert.strictEqual(berghain.isIndoor, true);
        assert.strictEqual(berghain.bounds.height, 5.0); // 5m concrete bunker
        assert.strictEqual(berghain.screenCount, 0); // No screens
        assert.strictEqual(berghain.fixtures.movingHeads, 6);

        // 2. Initialize Central CFG and State
        const CFG = {
            intensity: 1.0,
            hazeDensity: berghain.hazeDensity, // 0.90
            theme: berghain.forcedTheme // 'bloodmoon'
        };
        const State = {
            triggers: { dropTrigger: 0 },
            rainEnabled: false
        };

        // 3. Connect MIDI Controller and send CC 7 (Haze to max)
        const midi = new MIDIManager(mockStorage);
        midi.handleIncomingMessage(new Uint8Array([0xB0, 7, 127]), State, CFG);
        assert.strictEqual(CFG.hazeDensity, 1.0);

        // 4. Send MIDI Note 36 (Drop Trigger)
        midi.handleIncomingMessage(new Uint8Array([0x90, 36, 120]), State, CFG);
        assert.strictEqual(State.triggers.dropTrigger, 1);

        // 5. DJ avatar animates fist pump from drop trigger
        const djRig = createDJRigHierarchy();
        const djState = updateDJAvatar(djRig, 0.016, {
            time: 0.5,
            bpm: 145,
            beatEnergy: 1.0,
            kickEnergy: 0.9,
            bassEnergy: 0.95,
            isDrop: true
        });
        assert.strictEqual(djState.isFistPumping, true);
        assert.strictEqual(CFG.theme, 'bloodmoon', 'Hard techno palette remains enforced in Berghain');
    });

    test('Scenario 3: Custom Stage Building to Live Show Transition (R1 + R5)', () => {
        // 1. Stage Builder Mode: Place fixtures on 0.5m grid
        const newLayout = {
            version: '1.0.0',
            name: 'Arena Custom Show',
            timestamp: 1724405000000,
            fixtures: [
                { id: 'l1', type: 'laser', position: snapVector3({ x: -6.12, y: 10.48, z: -8.02 }) },
                { id: 'l2', type: 'laser', position: snapVector3({ x: 6.12, y: 10.48, z: -8.02 }) },
                { id: 'mh1', type: 'movinghead', position: snapVector3({ x: 0.0, y: 12.0, z: -10.0 }) },
                { id: 'scr1', type: 'screen', position: snapVector3({ x: 0.0, y: 6.0, z: -12.0 }) },
                { id: 'co2_1', type: 'co2', position: snapVector3({ x: -4.0, y: 0.5, z: 2.0 }) },
                { id: 'co2_2', type: 'co2', position: snapVector3({ x: 4.0, y: 0.5, z: 2.0 }) },
                { id: 'tr1', type: 'truss', position: snapVector3({ x: 0.0, y: 14.0, z: -8.0 }) }
            ]
        };

        // 2. Persist to localStorage
        saveLayoutToStorage(newLayout, mockStorage);
        const storedLayout = loadLayoutFromStorage(mockStorage);
        assert.strictEqual(storedLayout.name, 'Arena Custom Show');

        // 3. Compile to live simulation graph
        const compiled = compileCustomStageLayout(storedLayout);
        assert.strictEqual(compiled.lasers.length, 2);
        assert.strictEqual(compiled.movingHeads.length, 1);
        assert.strictEqual(compiled.screens.length, 1);
        assert.strictEqual(compiled.co2Jets.length, 2);
        assert.strictEqual(compiled.trusses.length, 1);
        assert.strictEqual(compiled.lasers[0].position.x, -6.0); // Snapped from -6.12
        assert.strictEqual(compiled.lasers[0].position.y, 10.5); // Snapped from 10.48

        // 4. Enter Photo Mode during live show
        const photoMode = new PhotoModeManager();
        const mockAudio = { suspend: () => {}, resume: () => {} };
        photoMode.enter(mockAudio);
        assert.strictEqual(photoMode.simulationFrozen, true);

        // 5. Configure Freecam & Neon Filter
        photoMode.setFreecamParameters({ fov: 40, rollDeg: 8 });
        photoMode.setFilter('neon');
        const filterConfig = getFilterShaderConfig('neon');
        assert.strictEqual(filterConfig.saturation, 3.0);

        // 6. Generate export filename
        const exportName = generatePhotoFilename(1724405555000);
        assert.strictEqual(exportName, 'laserrave_photo_1724405555000.png');

        // 7. Resume simulation
        photoMode.exit(mockAudio);
        assert.strictEqual(photoMode.simulationFrozen, false);
    });

    test('Scenario 4: TikTok Portrait Mode VJ Capture (R4 + R5 + R7)', () => {
        // 1. TikTok 9:16 Portrait Mode FOV recalculation
        const landscapeFOV = 60.0;
        const portraitFOV = calculatePortraitVFOV(landscapeFOV);
        assert.ok(portraitFOV >= 120 && portraitFOV <= 125, 'Expanded vertical FOV for 9:16 aspect ratio');

        // 2. Audience POV camera in TikTok mode
        const crowdMember = { id: 'c-front', x: 0, y: 0, z: 8.0 };
        const camFrame = evaluateAudiencePOVCamera({
            currentCrowdMember: crowdMember,
            timeSeconds: 0.5,
            bpm: 130,
            beatEnergy: 0.9,
            kickElapsed: 0.05,
            isPortraitMode: true,
            landscapeVFOV: 60.0
        });
        assert.ok(camFrame.fov > 120);

        // 3. MIDI controller triggers Drop FX and cycles theme
        const CFG = { theme: 'dynamic', intensity: 1.0 };
        const State = { triggers: { dropTrigger: 0, themeCycle: 0 } };
        const midi = new MIDIManager(mockStorage);

        midi.handleIncomingMessage(new Uint8Array([0x90, 36, 127]), State, CFG); // Note 36 (Drop)
        midi.handleIncomingMessage(new Uint8Array([0x90, 42, 127]), State, CFG); // Note 42 (Theme)
        assert.strictEqual(State.triggers.dropTrigger, 1);
        assert.strictEqual(State.triggers.themeCycle, 1);

        // 4. Capture portrait frame with VHS filter
        const photoMode = new PhotoModeManager();
        photoMode.enter();
        photoMode.setFilter('vhs');
        const vhsConfig = getFilterShaderConfig('vhs');
        assert.ok(vhsConfig.chromaticAberrationPx > 0);
        assert.ok(vhsConfig.scanlineFrequency > 0);

        const filename = generatePhotoFilename();
        assert.ok(filename.startsWith('laserrave_photo_') && filename.endsWith('.png'));
        photoMode.exit();
    });

    test('Scenario 5: Full Offline Club Performance (R2 + R6 + R7 + R8)', async () => {
        // 1. PWA Manifest validation
        const manifest = {
            name: 'LaserRave 3D Club Simulation',
            short_name: 'LaserRave',
            start_url: '/index.html',
            display: 'standalone',
            background_color: '#000000',
            theme_color: '#ff0055',
            icons: [
                { src: '/public/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/public/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
            ]
        };
        const manifestCheck = validateManifest(manifest);
        assert.strictEqual(manifestCheck.valid, true);

        // 2. Precache app shell into Service Worker
        const sw = new MockServiceWorkerContext('laserrave-v1.0.0');
        await sw.precache(PWA_CONFIG.corePrecacheAssets);

        // 3. Disconnect network -> Fetch app assets offline
        const isOnline = false;
        const mainJsRes = await sw.handleFetch('/src/main.js', isOnline);
        const indexHtmlRes = await sw.handleFetch('/index.html', isOnline);
        assert.strictEqual(mainJsRes.source, 'cache-offline');
        assert.strictEqual(indexHtmlRes.source, 'cache-offline');

        // 4. Load Basement Club preset in offline mode
        const basement = getStagePreset('basement');
        assert.strictEqual(basement.bounds.width, 8.0);
        assert.strictEqual(basement.hazeDensity, 1.0);
        assert.strictEqual(basement.neonSigns.length, 3);

        const dancefloorCrowd = generateCompactDancefloor(25, 8.0, 8.0, 0.4);
        assert.ok(dancefloorCrowd.length >= 20);

        // 5. Connect MIDI and control offline show
        const midi = new MIDIManager(mockStorage);
        const CFG = { speed: 1.0, spread: 1.2, intensity: 1.0 };
        midi.handleIncomingMessage(new Uint8Array([0xB0, 11, 127]), {}, CFG); // CC 11 (Speed max)
        assert.strictEqual(CFG.speed, 3.0);

        // 6. Run DJ avatar simulation in offline loop
        const djRig = createDJRigHierarchy();
        const djUpdate = updateDJAvatar(djRig, 0.016, {
            time: 2.5,
            bpm: 135,
            beatEnergy: 0.9,
            kickEnergy: 0.85,
            bassEnergy: 0.75
        });
        assert.ok(djUpdate.torsoScaleY >= 1.0);
    });
});
