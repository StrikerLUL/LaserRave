import { CFG } from './config.js';
import { computeFormation } from './utils/computeFormation.js';
import * as THREE from 'three';
// NOTE: this project renders with THREE.WebGLRenderer, not WebGPURenderer.
// The show is built on raw GLSL ShaderMaterial (laser beams, volumetric haze,
// fog, LED wall), which WebGPURenderer cannot compile — it needs TSL node
// materials. The former WebGPU/TSL post-processing path was therefore disabled
// by an unconditional `throw` and never executed a single time; it has been
// removed along with the `three/tsl` + `three/webgpu` imports it pulled into the
// bundle. Post-processing now runs through EffectComposer (imported below).

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// WebGL post-processing chain. The TSL/WebGPU pipeline above only runs when a real
// WebGPU backend is available; on the WebGL fallback (which is what virtually every
// browser actually takes today) these give us the same look.
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import { Multiplayer } from './Multiplayer.js';
import { FixtureManager } from './NewFixtures.js';
// Removed Reflector due to WebGPU incompatibility

import { computeFormationPositions } from './utils/formations.js';
import { LaserEngine, aimAtTarget } from './LaserEngine.js';

import {
    snapToGrid,
    snapVector3,
    normalizeYaw,
    clampToBounds,
    validateFixture,
    serializeStageLayout,
    deserializeStageLayout,
    saveLayoutToStorage,
    loadLayoutFromStorage,
    compileCustomStageLayout,
    getTemplateLayout,
    STAGE_BUILDER_CONFIG
} from './StageBuilder.js';

import {
    STAGE_PRESETS,
    getStagePreset,
    generateConcentricCrowd,
    generateCompactDancefloor,
    applyStagePreset,
    createProceduralStarfield,
    createProceduralGrassTexture,
    createNeonSign
} from './StagePresets.js';

import {
    WEATHER_CONFIG,
    createRainParticleSystem,
    updateRainParticles,
    emitSplashBurst,
    calculateLaserRainReflection,
    calculateRainAudioGain,
    createRainStreakTexture
} from './WeatherEffects.js';
import { ProceduralRainSynth } from './AudioProcessor.js';

import {
    POV_CONFIG,
    AUDIENCE_POV_CONFIG,
    getAudienceBasePosition,
    calculateLookAtYaw,
    calculateHeadBob,
    calculateKickShake,
    interpolateCrowdHop,
    calculatePortraitVFOV,
    evaluateAudiencePOVCamera
} from './AudiencePOV.js';

import {
    PHOTO_MODE_CONFIG,
    PHOTO_FILTERS,
    PhotoModeManager,
    getFilterShaderConfig,
    generatePhotoFilename,
    clampFreecamParams,
    applyPhotoFilter
} from './PhotoMode.js';

import {
    DJ_CONFIG,
    createDJAvatarMesh,
    updateDJAvatar
} from './DJAvatar.js';

import {
    MIDI_CONFIG,
    MIDIManager,
    parseMIDIMessage,
    dispatchMIDIEvent
} from './MIDIController.js';

import {
    PWA_CONFIG,
    registerServiceWorker
} from './PWA.js';




// Procedural Lens Flare Texture Generator
function createFlareTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.05, 'rgba(200, 220, 255, 0.8)');
    grad.addColorStop(0.3, 'rgba(100, 150, 255, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Anamorphic horizontal streak
    ctx.fillStyle = 'rgba(80, 130, 255, 0.6)';
    ctx.fillRect(0, 254, 512, 4);
    ctx.fillRect(0, 253, 512, 6); // slightly softer edges for streak
    
    return new THREE.CanvasTexture(canvas);
}
const globalFlareTexture = createFlareTexture();

// Procedural Gobo Texture (Stripes/Dots)
function createGoboTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    return tex;
}
const globalGoboTexture = createGoboTexture();

function updateGoboCanvas(themeName) {
    const canvas = globalGoboTexture.image;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear canvas with deep black
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineWidth = 10;
    
    if (themeName === 'stripes') {
        for (let i = 0; i < w; i += 32) {
            ctx.fillStyle = (i / 32) % 2 === 0 ? 'white' : 'black';
            ctx.fillRect(i, 0, 16, h);
        }
    } else if (themeName === 'stars') {
        function drawStar(cx, cy, spikes, outerRadius, innerRadius) {
            let rot = Math.PI / 2 * 3;
            let x = cx;
            let y = cy;
            let step = Math.PI / spikes;

            ctx.beginPath();
            ctx.moveTo(cx, cy - outerRadius);
            for (let i = 0; i < spikes; i++) {
                x = cx + Math.cos(rot) * outerRadius;
                y = cy + Math.sin(rot) * outerRadius;
                ctx.lineTo(x, y);
                rot += step;

                x = cx + Math.cos(rot) * innerRadius;
                y = cy + Math.sin(rot) * innerRadius;
                ctx.lineTo(x, y);
                rot += step;
            }
            ctx.lineTo(cx, cy - outerRadius);
            ctx.closePath();
            ctx.fillStyle = 'white';
            ctx.fill();
        }
        drawStar(w/2, h/2, 5, 85, 35);
    } else if (themeName === 'rings') {
        for (let r = 24; r < w/2; r += 28) {
            ctx.beginPath();
            ctx.arc(w/2, h/2, r, 0, Math.PI * 2);
            ctx.lineWidth = 12;
            ctx.stroke();
        }
    } else if (themeName === 'spiral') {
        ctx.beginPath();
        ctx.moveTo(w/2, h/2);
        for (let theta = 0; theta < 30; theta += 0.1) {
            let r = theta * 3.5;
            let x = w/2 + Math.cos(theta) * r;
            let y = h/2 + Math.sin(theta) * r;
            ctx.lineTo(x, y);
        }
        ctx.lineWidth = 14;
        ctx.stroke();
    } else {
        // Solid (white)
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, w, h);
    }
    
    globalGoboTexture.needsUpdate = true;
}
// Set initial gobo canvas texture
updateGoboCanvas('stripes');

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

// ── Instanced Mesh System ──
let mhBaseIM, mhYokeIM, mhHeadIM, mhCoreIM, mhWashIM;
let laserBodyIM, laserCoreIM, laserTubeIM;
const dummy = new THREE.Object3D(); // Reused helper – never allocate inside loops!
// Pre-allocated objects to avoid per-frame GC pressure
const _col1 = new THREE.Color();
const _col2 = new THREE.Color();
const _white = new THREE.Color(0xffffff);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _camShake = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();


let currentMode = 'live'; // 'live' or 'studio'
let selectedLaser = null;
export let selectedLasers = []; // Multi-selection
export let isTargetingMode = false;
export function setTargetingMode(val) { isTargetingMode = val; }
const boxHelpers = new Map(); // Store BoxHelpers for highlighted lasers
window.mpSystem = null;
let mpBroadcastTimer = null;
let newFixtures = null;

// ── Timeline & Projection State ──
const timelineData = {
    intensity: [], // array of { time: 0, value: 1.0, type: 'linear' }
    speed: [],
    pan: [],
    tilt: []
};
let activeTrack = 'intensity';
let selectedKeyframe = null;
let isMappingMode = false;
let projectedPoints = []; // Mapped points from svg/png

// ── Pyrotechnik State ──
let pyroEnabled       = false;
let pyroFlameEnabled  = true;
let pyroSparkEnabled  = true;
let pyroSystems       = []; // array of PyroSystem instances

// ── Section-color + BPM + variation state ────────────────────
let sectionLaserHues  = []; // per-laser current hue (0–360 HSL)
let targetSectionHues = []; // transition target for current section
let lastSectionId     = -1; // detect section changes
let beatsInSection    = 0;  // beats elapsed within current section
let variationPhase    = 0;  // micro-variation index (0–3), changes every 16 beats

// ─────────────────────────────────────────────
//  SCENE SETUP
// ─────────────────────────────────────────────

const W = window.innerWidth, H = window.innerHeight;

let renderer;
try {
  if (!window.WebGLRenderingContext) {
    throw new Error("WebGL not supported");
  }
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is deprecated as of three r183 and silently falls back to
  // PCFShadowMap while logging a warning on every load. Ask for what we actually
  // get; the softness now comes from the radius set on each light's shadow.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  console.log('WebGLRenderer initialized successfully');
  document.getElementById('canvas-container').appendChild(renderer.domElement);
} catch (e) {
  console.error("Critical renderer initialization error:", e);
  const fallbackDiv = document.createElement('div');
  fallbackDiv.style.position = 'absolute';
  fallbackDiv.style.top = '50%';
  fallbackDiv.style.left = '50%';
  fallbackDiv.style.transform = 'translate(-50%, -50%)';
  fallbackDiv.style.color = 'white';
  fallbackDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
  fallbackDiv.style.padding = '20px';
  fallbackDiv.style.borderRadius = '10px';
  fallbackDiv.style.fontFamily = 'sans-serif';
  fallbackDiv.style.zIndex = '9999';
  fallbackDiv.innerHTML = '<h3>WebGL/WebGPU Error</h3><p>Sorry, your browser or device does not support the WebGL/WebGPU rendering required by this application.</p>';
  document.body.appendChild(fallbackDiv);

  // Mock renderer to prevent immediate downstream TypeError crashes
  renderer = {
    render: () => {},
    setAnimationLoop: (cb) => {
        function loop() { cb(); requestAnimationFrame(loop); }
        requestAnimationFrame(loop);
    },
    setSize: () => {},
    setPixelRatio: () => {},
    toneMapping: THREE.NoToneMapping,
    init: async () => {},
    clear: () => {},
    domElement: Object.assign(document.createElement('canvas'), {
        captureStream: () => new MediaStream()
    })
  };
}

// ─── Audio Core Globals (Declared early to prevent TDZ ReferenceError) ───
let audioCtx = null, analyser = null, dataArray = null, source = null, audioBuffer = null;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
camera.position.set(0, 12, 60); // Repositioned for the 200m stage scale
camera.lookAt(0, 5, 0);

let autoCamEnabled = false;
let tvModeEnabled = false;
let tvCutCooldown = 0;
let currentTvCamIdx = 0;
let justCut = false;

// Drone camera mode state
let droneEnabled = false;
const dronePos = new THREE.Vector3(0, 8, 30);
const droneVel = new THREE.Vector3(0, 0, 0);
let droneYaw = 0;
let dronePitch = -0.15;
let droneYawVel = 0;
let dronePitchVel = 0;
const activeKeys = {};

// Spring-damper physical shake vectors for speakers sonic boom rumble
const droneShakeOffset = new THREE.Vector3();
const droneShakeVel = new THREE.Vector3();
const droneShakeRot = new THREE.Vector2(); // x: pitch shake, y: yaw shake
const droneShakeRotVel = new THREE.Vector2();
let lastDronePostState = false;

// ─── Audience POV Camera Mode State (R4) ──────────────────────
let crowdPOVEnabled = false;
let povCurrentCrowdIdx = 0;
let povTargetCrowdIdx = 0;
let povHopElapsed = 0.6; // initial hop complete
let povHopActive = false;
let povBeatCount = 0;
let povKickElapsed = 1.0;
let povYawVarianceDeg = 0.0;
let povTargetYawVarianceDeg = 0.0;

// ─── Photo Mode State (R5) ───────────────────────────────────
const photoModeManager = new PhotoModeManager();
let rawSnapshotCanvas = null;

// ─── 3D DJ Avatar State (R6) ─────────────────────────────────
let djAvatarRig = null;
let djAvatarEnabled = true;

// ─── Web MIDI Controller State (R7) ──────────────────────────
const midiManager = new MIDIManager(typeof window !== 'undefined' ? window.localStorage : null);
let isMidiModalOpen = false;

// ─── Laser Writer (Vector Projection Scanner) Globals ───────
let laserWriterEnabled = false;
let laserWriterMode = 'text';
let laserWriterText = 'WELCOME TO THE RAVE';
let laserWriterSpeed = 80;
let laserWriterInertia = 1.5;
let laserWriterIntensity = 1.5;
let laserWriterColor = '#00ffff';
let laserWriterBlanking = true;
let laserWriterFlicker = true;

// Physical scanner mirror physics state
let galvoPos = new THREE.Vector2(0, 0);
let galvoVel = new THREE.Vector2(0, 0);
let scannerPoints = []; // compiled flat sequence of points
let scannerTargetIdx = 0;
let subStepCount = 0;
let galvoHistory = [];
const maxGalvoHistory = 1000;

// SVG data source
let uploadedSVGPaths = null;

// Scene objects
let laserWriterGroup = null;
let projectionLineMesh = null;
let projectorRayMesh = null;
let projectorRayCoreMesh = null;

// ── Weather & Rain Particle System Globals (R3) ───────────────
let rainSystem = null;
let rainPoints = null;
let rainGeometry = null;
let rainPosAttr = null;
let rainColAttr = null;

let splashPoints = null;
let splashGeometry = null;
let splashPosAttr = null;
let splashColAttr = null;

let rainEnabled = false;
let rainIntensity = 4000;
let rainStreakTex = null;
const rainAudioSynth = new ProceduralRainSynth();

function initRainParticleSystem(intensity = 4000) {
    if (rainPoints) {
        scene.remove(rainPoints);
        if (rainGeometry) rainGeometry.dispose();
    }
    if (splashPoints) {
        scene.remove(splashPoints);
        if (splashGeometry) splashGeometry.dispose();
    }

    rainIntensity = intensity;
    rainSystem = createRainParticleSystem(rainIntensity);

    if (!rainStreakTex) {
        rainStreakTex = createRainStreakTexture();
    }

    // Rain points geometry
    rainGeometry = new THREE.BufferGeometry();
    rainPosAttr = new THREE.BufferAttribute(rainSystem.positions, 3);
    rainGeometry.setAttribute('position', rainPosAttr);

    const colorFloats = new Float32Array(rainSystem.count * 3);
    for (let i = 0; i < rainSystem.count; i++) {
        colorFloats[i * 3]     = 0.533; // 0x88
        colorFloats[i * 3 + 1] = 0.733; // 0xbb
        colorFloats[i * 3 + 2] = 1.000; // 0xff
    }
    rainColAttr = new THREE.BufferAttribute(colorFloats, 3);
    rainGeometry.setAttribute('color', rainColAttr);

    const rainMat = new THREE.PointsMaterial({
        size: 1.8,
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        map: rainStreakTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    rainPoints = new THREE.Points(rainGeometry, rainMat);
    rainPoints.visible = rainEnabled;
    scene.add(rainPoints);

    // Splash points pool (max 250 particles)
    const maxSplashCount = 250;
    const splashPositions = new Float32Array(maxSplashCount * 3);
    const splashColors = new Float32Array(maxSplashCount * 3);
    splashGeometry = new THREE.BufferGeometry();
    splashPosAttr = new THREE.BufferAttribute(splashPositions, 3);
    splashColAttr = new THREE.BufferAttribute(splashColors, 3);
    splashGeometry.setAttribute('position', splashPosAttr);
    splashGeometry.setAttribute('color', splashColAttr);

    const splashMat = new THREE.PointsMaterial({
        size: 0.6,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    splashPoints = new THREE.Points(splashGeometry, splashMat);
    splashPoints.visible = rainEnabled;
    scene.add(splashPoints);
}

function updateRainVisuals(dt) {
    if (!rainEnabled || !rainSystem || dt <= 0) {
        if (rainPoints) rainPoints.visible = false;
        if (splashPoints) splashPoints.visible = false;
        return;
    }
    rainPoints.visible = true;
    splashPoints.visible = true;

    // Wind drift configuration
    const windX = CFG.windX !== undefined ? (CFG.windX * 0.1) : 0.5;
    const impacts = updateRainParticles(rainSystem, dt, { x: windX, z: -0.2 });

    // Emit floor splashes upon impact
    const maxImpactsToProcess = Math.min(impacts.length, 12);
    for (let i = 0; i < maxImpactsToProcess; i++) {
        emitSplashBurst(rainSystem, impacts[i], Math.floor(3 + Math.random() * 3));
    }

    // Collect active laser beams for proximity coloring
    const activeLaserBeams = [];
    for (let b = 0; b < activeBeams.length; b++) {
        const bm = activeBeams[b];
        if (bm && bm.pos && bm.dir) {
            activeLaserBeams.push({
                active: true,
                start: bm.pos,
                end: {
                    x: bm.pos.x + bm.dir.x * 50.0,
                    y: bm.pos.y + bm.dir.y * 50.0,
                    z: bm.pos.z + bm.dir.z * 50.0
                },
                color: bm.color
            });
        }
    }

    // Laser proximity reflection check & color update
    const colors = rainColAttr.array;
    const pos = rainSystem.positions;
    const count = rainSystem.count;
    const tempP = { x: 0, y: 0, z: 0 };
    const tempCol = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        tempP.x = pos[i3];
        tempP.y = pos[i3 + 1];
        tempP.z = pos[i3 + 2];

        if (activeLaserBeams.length > 0) {
            const ref = calculateLaserRainReflection(tempP, activeLaserBeams, 0.8);
            if (ref.isReflected) {
                tempCol.set(ref.color);
                colors[i3]     = tempCol.r;
                colors[i3 + 1] = tempCol.g;
                colors[i3 + 2] = tempCol.b;
                continue;
            }
        }
        // Default rain color (0x88bbff)
        colors[i3]     = 0.533;
        colors[i3 + 1] = 0.733;
        colors[i3 + 2] = 1.000;
    }

    rainPosAttr.needsUpdate = true;
    rainColAttr.needsUpdate = true;

    // Update Splash Geometry Pool
    const sPos = splashPosAttr.array;
    const sCol = splashColAttr.array;
    let sIdx = 0;

    for (let b = 0; b < rainSystem.activeSplashes.length && sIdx < 250; b++) {
        const burst = rainSystem.activeSplashes[b];
        for (let p = 0; p < burst.particles.length && sIdx < 250; p++) {
            const pt = burst.particles[p];
            const p3 = sIdx * 3;
            sPos[p3]     = pt.x;
            sPos[p3 + 1] = pt.y;
            sPos[p3 + 2] = pt.z;
            sCol[p3]     = 0.7 * pt.alpha;
            sCol[p3 + 1] = 0.9 * pt.alpha;
            sCol[p3 + 2] = 1.0 * pt.alpha;
            sIdx++;
        }
    }
    // Clear unused slots
    for (let k = sIdx; k < 250; k++) {
        const k3 = k * 3;
        sPos[k3 + 1] = -100;
    }
    splashPosAttr.needsUpdate = true;
    splashColAttr.needsUpdate = true;
}

function setRainState(enabled, intensity = rainIntensity) {
    rainEnabled = enabled;
    rainIntensity = intensity;

    const chk = document.getElementById('param-weather-rain');
    if (chk) chk.checked = enabled;
    const sld = document.getElementById('param-rain-intensity');
    if (sld) sld.value = intensity;
    const val = document.getElementById('val-rain-intensity');
    if (val) val.textContent = intensity;

    if (enabled) {
        if (!rainSystem || rainSystem.count !== intensity) {
            initRainParticleSystem(intensity);
        }
        if (rainPoints) rainPoints.visible = true;
        if (splashPoints) splashPoints.visible = true;
        if (audioCtx) {
            rainAudioSynth.init(audioCtx);
            rainAudioSynth.start(intensity);
        }
    } else {
        if (rainPoints) rainPoints.visible = false;
        if (splashPoints) splashPoints.visible = false;
        rainAudioSynth.stop();
    }
}


const LASER_FONT = {
  'A': [[[0,0],[0,0.6],[0.5,1],[1,0.6],[1,0]], [[0,0.4],[1,0.4]]],
  'B': [[[0,0],[0,1],[0.8,1],[1,0.75],[0.8,0.5],[0,0.5]], [[0.8,0.5],[1,0.25],[0.8,0],[0,0]]],
  'C': [[[1,0.25],[0.75,0],[0.25,0],[0,0.25],[0,0.75],[0.25,1],[0.75,1],[1,0.75]]],
  'D': [[[0,0],[0,1],[0.6,1],[1,0.65],[1,0.35],[0.6,0],[0,0]]],
  'E': [[[1,0],[0,0],[0,1],[1,1]], [[0,0.5],[0.8,0.5]]],
  'F': [[[0,0],[0,1],[1,1]], [[0,0.5],[0.8,0.5]]],
  'G': [[[1,0.75],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0],[0.75,0],[1,0.25],[1,0.5],[0.5,0.5]]],
  'H': [[[0,0],[0,1]], [[1,0],[1,1]], [[0,0.5],[1,0.5]]],
  'I': [[[0.2,0],[0.8,0]], [[0.2,1],[0.8,1]], [[0.5,0],[0.5,1]]],
  'J': [[[0,0.25],[0.25,0],[0.5,0],[0.8,0.25],[0.8,1]], [[0.5,1],[1,1]]],
  'K': [[[0,0],[0,1]], [[1,0],[0,0.4]], [[0.1,0.45],[1,1]]],
  'L': [[[0,1],[0,0],[1,0]]],
  'M': [[[0,0],[0,1],[0.5,0.5],[1,1],[1,0]]],
  'N': [[[0,0],[0,1],[1,0],[1,1]]],
  'O': [[[0,0.25],[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.25],[0.75,0],[0.25,0],[0,0.25]]],
  'P': [[[0,0],[0,1],[0.8,1],[1,0.75],[0.8,0.5],[0,0.5]]],
  'Q': [[[0,0.25],[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.25],[0.75,0],[0.25,0],[0,0.25]], [[0.6,0.2],[1,0]]],
  'R': [[[0,0],[0,1],[0.8,1],[1,0.75],[0.8,0.5],[0,0.5]], [[0.5,0.5],[1,0]]],
  'S': [[[0,0.25],[0.25,0],[0.75,0],[1,0.25],[1,0.45],[0,0.55],[0,0.75],[0.25,1],[0.75,1],[1,0.75]]],
  'T': [[[0.5,0],[0.5,1]], [[0,1],[1,1]]],
  'U': [[[0,1],[0,0.25],[0.25,0],[0.75,0],[1,0.25],[1,1]]],
  'V': [[[0,1],[0.5,0],[1,1]]],
  'W': [[[0,1],[0.2,0],[0.5,0.5],[0.8,0],[1,1]]],
  'X': [[[0,0],[1,1]], [[1,0],[0,1]]],
  'Y': [[[0.5,0],[0.5,0.5],[0,1]], [[0.5,0.5],[1,1]]],
  'Z': [[[0,1],[1,1],[0,0],[1,0]]],
  '1': [[[0.2,0.8],[0.5,1],[0.5,0]], [[0.2,0],[0.8,0]]],
  '2': [[[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.5],[0,0],[1,0]]],
  '3': [[[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.55],[0.5,0.5]], [[1,0.45],[1,0.25],[0.75,0],[0.25,0],[0,0.25]]],
  '4': [[[0.8,0],[0.8,1],[0,0.3],[1,0.3]]],
  '5': [[[1,1],[0,1],[0,0.55],[0.75,0.55],[1,0.35],[1,0.15],[0.75,0],[0,0]]],
  '6': [[[1,0.75],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0],[0.75,0],[1,0.25],[1,0.45],[0,0.45]]],
  '7': [[[0,1],[1,1],[0.4,0]]],
  '8': [[[0,0.25],[0.25,0],[0.75,0],[1,0.25],[1,0.45],[0,0.55],[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.55],[0,0.45],[0,0.25]]],
  '9': [[[1,0.55],[0,0.55],[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.25],[0.75,0],[0,0]]],
  '-': [[[0.25,0.5],[0.75,0.5]]],
  '!': [[[0.5,0.3],[0.5,1]], [[0.5,0],[0.5,0.1]]],
  '?': [[[0,0.75],[0.25,1],[0.75,1],[1,0.75],[1,0.5],[0.5,0.35],[0.5,0.25]], [[0.5,0],[0.5,0.1]]],
  '.': [[[0.45,0],[0.45,0.1],[0.55,0.1],[0.55,0],[0.45,0]]],
  '+': [[[0.2,0.5],[0.8,0.5]], [[0.5,0.2],[0.5,0.8]]],
  '*': [[[0.2,0.2],[0.8,0.8]], [[0.8,0.2],[0.2,0.8]], [[0.5,0.1],[0.5,0.9]], [[0.1,0.5],[0.9,0.5]]],
  '/': [[[0.1,0],[0.9,1]]],
  '=': [[[0.2,0.35],[0.8,0.35]], [[0.2,0.65],[0.8,0.65]]]
};

const tvCameras = [
    // 1. Wide front angle from low down, looking slightly upwards and diagonally across the lasers
    { pos: new THREE.Vector3(-25, 2, 35), look: new THREE.Vector3(15, 12, -10) }, 
    
    // 2. Wide front right from low down, looking leftwards and upwards across
    { pos: new THREE.Vector3(25, 2, 35), look: new THREE.Vector3(-15, 12, -10) },
    
    // 3. Side profile left, very low, looking across the middle (great depth, no direct lasers)
    { pos: new THREE.Vector3(-35, 4, 10), look: new THREE.Vector3(35, 8, -15) },
    
    // 4. Side profile right, very low, looking across the middle
    { pos: new THREE.Vector3(35, 4, 10), look: new THREE.Vector3(-35, 8, -15) },
    
    // 5. High top-down perspective from an angle, looking diagonally down
    { pos: new THREE.Vector3(-18, 38, 15), look: new THREE.Vector3(12, 0, -20) },
    
    // 6. Extreme corner perspective, looking diagonally through the show
    { pos: new THREE.Vector3(30, 8, 40), look: new THREE.Vector3(-20, 10, -25) },
    
    // 7. Behind DJ booth right, looking diagonally into the crowd / show area (lasers shooting away)
    { pos: new THREE.Vector3(18, 5, -18), look: new THREE.Vector3(-15, 15, 35) },
    
    // 8. Behind DJ booth left, looking diagonally into the crowd
    { pos: new THREE.Vector3(-18, 5, -18), look: new THREE.Vector3(15, 15, 35) },
    
    // 9. Floating slightly above crowd, strong angle
    { pos: new THREE.Vector3(15, 16, 25), look: new THREE.Vector3(-15, 5, -20) },
    
    // 10. Far sweeping perspective, ground level, looking up
    { pos: new THREE.Vector3(-30, 1, 45), look: new THREE.Vector3(20, 18, -10) },
    
    // 11. Over the shoulder extreme zoom feel, but offset so lasers pass by
    { pos: new THREE.Vector3(12, 4, 50), look: new THREE.Vector3(-5, 12, -20) },
    
    // 12. Panned side left looking at a specific focus point
    { pos: new THREE.Vector3(-40, 15, 5), look: new THREE.Vector3(10, 5, -15) },
    
    // 13. Dynamic sweeping up shot from the front edge
    { pos: new THREE.Vector3(0, 1, 20), look: new THREE.Vector3(0, 25, -25) }
];

const baseCamPos = new THREE.Vector3(0, 10, 45);
const baseCamTarget = new THREE.Vector3(0, 6, 0);
const autoCamFocus = new THREE.Vector3(0, 5, -10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 5, 0);
controls.minDistance = 5;
controls.maxDistance = 80;

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();


// ─── Post-Processing (TSL Node-based) ────────
let fxBlurEnabled = false;
let fxVhsEnabled = false;
let fxFlareEnabled = false;
let fxDofEnabled = false;
    let raybounceEnabled = false;

// Uniform holders for the VHS/blur controls. These used to be TSL uniform() nodes;
// they are plain boxes now and are mirrored onto the EffectComposer passes.
const afterImageDamp  = { value: 0.88 };
const filmTimeUniform = { value: 0.0 };
const rgbShiftAmount  = { value: 0.0015 };

// ── WebGL EffectComposer chain (the path that actually runs) ─────────────────
let glComposer     = null;
let glRenderPass   = null;
let glBloomPass    = null;
let glAfterimage   = null;
let glFilmPass     = null;
let glRgbShiftPass = null;
let glOutputPass   = null;
// The scene is already full of additive-blended beams, so bloom only needs to
// pick up the genuinely hot pixels (laser cores, LED wall, strobes). A low
// threshold here blooms the whole stage into a white blob.
let glBloomStrength = 0.55;   // base strength; modulated per-frame by the music
const GL_BLOOM_RADIUS    = 0.5;
const GL_BLOOM_THRESHOLD = 0.55;

/**
 * Builds the WebGL post chain. Order matters: bloom has to see the raw HDR-ish
 * scene, the grain/shift artefacts go on top of it, and OutputPass does the
 * tone mapping + sRGB conversion last.
 */
function initGLComposer() {
    if (!renderer || !renderer.domElement || typeof renderer.getSize !== 'function') return;
    try {
        disposeGLComposer();
        const size = renderer.getSize(new THREE.Vector2());
        glComposer = new EffectComposer(renderer);
        glComposer.setPixelRatio(renderer.getPixelRatio ? renderer.getPixelRatio() : 1);
        glComposer.setSize(size.x, size.y);

        glRenderPass = new RenderPass(scene, camera);
        glComposer.addPass(glRenderPass);

        glBloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), glBloomStrength, GL_BLOOM_RADIUS, GL_BLOOM_THRESHOLD);
        glComposer.addPass(glBloomPass);

        glAfterimage = new AfterimagePass(0.88);
        glAfterimage.enabled = false;
        glComposer.addPass(glAfterimage);

        glFilmPass = new FilmPass(0.35, false);
        glFilmPass.enabled = false;
        glComposer.addPass(glFilmPass);

        glRgbShiftPass = new ShaderPass(RGBShiftShader);
        glRgbShiftPass.uniforms.amount.value = 0.0015;
        glRgbShiftPass.enabled = false;
        glComposer.addPass(glRgbShiftPass);

        // OutputPass reads renderer.toneMapping / outputColorSpace and applies them in
        // its shader. WebGLRenderer skips tone mapping when drawing into a render
        // target, so this is the only place it happens — it must stay ACESFilmic or
        // the HDR values clip straight to white.
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        glOutputPass = new OutputPass();
        glComposer.addPass(glOutputPass);

        console.log('WebGL post-processing (bloom) initialized');
    } catch (e) {
        console.warn('WebGL post-processing setup failed, rendering without bloom:', e);
        disposeGLComposer();
    }
}

function disposeGLComposer() {
    if (glComposer) {
        try {
            glComposer.passes.forEach(pass => { if (typeof pass.dispose === 'function') pass.dispose(); });
            if (typeof glComposer.dispose === 'function') glComposer.dispose();
        } catch (e) { /* renderer may already be gone */ }
    }
    glComposer = glRenderPass = glBloomPass = glAfterimage = glFilmPass = glRgbShiftPass = glOutputPass = null;
}

// Proxy compat objects so legacy code that references filmPass.enabled etc still works
const afterimagePass = { enabled: false };
const filmPass     = { enabled: false, uniforms: { time: { get value() { return filmTimeUniform.value; }, set value(v) { filmTimeUniform.value = v; } } } };
const rgbShiftPass = { enabled: false, uniforms: { amount: { get value() { return rgbShiftAmount.value; }, set value(v) { rgbShiftAmount.value = v; } } } };

function syncScreenFxStyles() {
    if (!renderer || !renderer.domElement || !renderer.domElement.style) return;

    // When a real post chain is active, afterimage/grain/shift are rendered by the
    // GPU passes — stacking a CSS blur + hue-rotate on top of that just smears the
    // image and costs an extra full-screen composite. Only DoF has no pass.
    const hasRealChain = !!glComposer;
    const blurAmount = (fxBlurEnabled && !hasRealChain) ? 1.0 : 0;
    const dofAmount = fxDofEnabled ? 1.2 : 0;
    const vhsHue = (fxVhsEnabled && !hasRealChain) ? (Math.sin(filmTimeUniform.value * 3.0) * 2.0) : 0;

    if (!blurAmount && !dofAmount && !vhsHue && !(fxVhsEnabled && !hasRealChain)) {
        renderer.domElement.style.filter = '';
        return;
    }

    const filters = [];
    if (blurAmount > 0) filters.push(`blur(${blurAmount}px)`);
    if (dofAmount > 0) filters.push(`blur(${dofAmount}px)`);
    if (fxVhsEnabled && !hasRealChain) {
        filters.push('contrast(1.12) saturate(1.22) brightness(1.03)');
        filters.push(`hue-rotate(${vhsHue}deg)`);
    }
    renderer.domElement.style.filter = filters.join(' ');
}
// Rebuilds the output chain to include only the active effects
function rebuildPostChain() {
    // WebGL path: passes are pre-built, we just toggle them.
    if (glComposer) {
        if (glAfterimage)   glAfterimage.enabled   = fxBlurEnabled;
        if (glFilmPass)     glFilmPass.enabled     = fxVhsEnabled;
        if (glRgbShiftPass) glRgbShiftPass.enabled = fxVhsEnabled || droneEnabled;
    }
    syncScreenFxStyles();
}

// ─────────────────────────────────────────────
//  STAGE ENVIRONMENT (MAINSTAGE EXPANSION)
// ─────────────────────────────────────────────

// Reduce metalness so ambient light can illuminate them! Without an environment map, metalness 0.9 makes objects pure black.
const floorGeo = new THREE.PlaneGeometry(200, 150);
const floor = new THREE.Mesh(floorGeo, new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.6, metalness: 0.1 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(200, 100, 0x222230, 0x111118);
grid.position.y = 0.02;
scene.add(grid);

const trussMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.3, roughness: 0.8 });

let backWall = null;
const stageGroup = new THREE.Group();
scene.add(stageGroup);
let screenMeshes = [];
let stageBuildQueue = [];

// Massive Truss Structure helper
function createTruss(w, h, d, x, y, z, rx=0, ry=0, rz=0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, trussMat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    stageGroup.add(mesh); // Changed to stageGroup so we can clear it
    return mesh;
}

// Dynamic LED Wall Canvas Texture
const ledCanvas = document.createElement('canvas');
ledCanvas.width = 512; ledCanvas.height = 256;
const ledCtx = ledCanvas.getContext('2d');
const ledTexture = new THREE.CanvasTexture(ledCanvas);
const ledParticles = [];
let customVideoElement = null;

// Offscreen circular LED pattern mask (drawn in 2D for high performance & reliability)
const ledPatternCanvas = document.createElement('canvas');
ledPatternCanvas.width = 4;
ledPatternCanvas.height = 4;
const patCtx = ledPatternCanvas.getContext('2d');
patCtx.fillStyle = 'rgba(10, 10, 15, 0.95)'; // dark grid border
patCtx.fillRect(0, 0, 4, 4);

// Carve out a transparent circular center for the LED dot
patCtx.globalCompositeOperation = 'destination-out';
patCtx.beginPath();
patCtx.arc(2, 2, 1.5, 0, Math.PI * 2);
patCtx.fill();

// Add vertical simulated subpixel structure (RGB stripes)
patCtx.globalCompositeOperation = 'source-over';
patCtx.fillStyle = 'rgba(255, 0, 0, 0.08)';
patCtx.fillRect(0.3, 0, 1.1, 4);
patCtx.fillStyle = 'rgba(0, 255, 0, 0.08)';
patCtx.fillRect(1.4, 0, 1.1, 4);
patCtx.fillStyle = 'rgba(0, 0, 255, 0.08)';
patCtx.fillRect(2.5, 0, 1.1, 4);

const ledPattern = ledCtx.createPattern(ledPatternCanvas, 'repeat');

let ledScreenMat = new THREE.MeshBasicMaterial({
    map: ledTexture,
    side: THREE.DoubleSide,
    transparent: true
});


function addScreen(w, h, x, y, z, ry=0) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), ledScreenMat);
    s.position.set(x, y, z);
    s.rotation.y = ry;
    stageGroup.add(s);
    screenMeshes.push(s);
    return s;
}

const ambientLight = new THREE.AmbientLight(0x334466, 1.2);
scene.add(ambientLight);

const stageLight = new THREE.PointLight(0x6688ff, 2.0, 200);
stageLight.position.set(0, 20, 0);
scene.add(stageLight);

const fillLeft  = new THREE.PointLight(0x334466, 1.0, 150);
fillLeft.position.set(-40, 15, -10);
scene.add(fillLeft);

const fillRight = new THREE.PointLight(0x334466, 1.0, 150);
fillRight.position.set(40, 15, -10);
scene.add(fillRight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
sunLight.position.set(0, 50, 50);
scene.add(sunLight);

// ─────────────────────────────────────────────────────────────────────────────
//  SHADOW CASTERS
//
//  The moving heads are geometry only — instanced housings plus additively
//  blended cones. There is no THREE light behind any of them, so before this
//  nothing in the scene could cast a shadow at all. This is a small pool of real
//  SpotLights that gets re-aimed every frame at the brightest active heads,
//  which is what makes light pools on the floor and shadows behind the truss
//  possible in the first place.
//
//  The pool size is fixed on purpose. In three.js the number of shadow-casting
//  lights is part of every material's program cache key, so growing or shrinking
//  it — or toggling a light's `visible` / `castShadow` — forces a full shader
//  recompile and a visible hitch. Unused casters are parked at intensity 0
//  instead, and the LOD system scales shadow *resolution* rather than count.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//  ADDITIVE BEAM EXPOSURE
//
//  The post chain accumulates the additively blended beams in a HalfFloat
//  buffer, and three skips per-material tone mapping when drawing into a render
//  target (it only tone maps straight to the canvas). The previous direct render
//  therefore compressed every beam *before* it was added, which acted as a
//  per-beam limiter; now the raw sum is compressed once at the very end.
//
//  The opacities below were authored against that old behaviour, so unscaled
//  they stack far past 1.0 and drive all three channels to white. Measured on
//  the rendered frame: unscaled, 1.2% of pixels are fully blown and mean
//  saturation is 0.13 — the show reads as a white haze with no discernible
//  beams. At this scale it is 0.04% blown at saturation 0.22, and individual
//  coloured beams are legible again.
// ─────────────────────────────────────────────────────────────────────────────
const BEAM_HDR_SCALE = 0.45;

const SHADOW_CASTER_COUNT = 4;
const SHADOW_MAP_SIZES = [1024, 512, 0]; // indexed by LOD level; 0 = shadows off
const SHADOW_BIAS = -0.0005;
const SHADOW_BEAM_LEN = 45;              // matches the moving-head cone geometry
const SHADOW_CONE_ANGLE = Math.atan(16.0 / SHADOW_BEAM_LEN); // wash cone half-angle

const shadowCasters = [];
let shadowsEnabled = true;
let shadowMapSize = SHADOW_MAP_SIZES[0];
let shadowCastersInUse = 0;
let shadowFlagsDirty = true; // re-apply cast/receive flags after a stage or crowd rebuild

for (let i = 0; i < SHADOW_CASTER_COUNT; i++) {
    const light = new THREE.SpotLight(0xffffff, 0, 120, SHADOW_CONE_ANGLE, 0.45, 1.2);
    light.castShadow = true;
    light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    light.shadow.bias = SHADOW_BIAS;
    light.shadow.camera.near = 1.5;
    light.shadow.camera.far = 90;
    light.position.set(0, 12, -12);

    // A SpotLight aims at its target's world position, so the target has to sit
    // in the scene graph for its matrix to be updated.
    const target = new THREE.Object3D();
    scene.add(target);
    light.target = target;

    scene.add(light);
    shadowCasters.push({ light, target });
}

/** Applies cast/receive flags across stage, floor, crowd and DJ rig. */
function applyShadowFlags() {
    floor.receiveShadow = true;

    // Everything structural lives in stageGroup: trusses, the two tower legs,
    // screens, and whatever a custom layout compiled into it.
    stageGroup.traverse(obj => {
        if (!obj.isMesh) return;
        const isScreen = screenMeshes.indexOf(obj) !== -1;
        obj.receiveShadow = true;
        obj.castShadow = !isScreen; // LED panels are flat emitters, not blockers
    });

    // The crowd is billboarded planes on MeshBasicMaterial, and that material
    // ignores lighting entirely — receiveShadow is a no-op there until the
    // material changes. The flag is set anyway so the crowd starts receiving the
    // moment it moves to a lit material.
    for (let i = 0; i < crowdObjects.length; i++) {
        if (crowdObjects[i].mesh) crowdObjects[i].mesh.receiveShadow = true;
    }

    // createDJAvatarMesh() returns a rig descriptor, not an Object3D — the actual
    // scene node hangs off .root.
    if (typeof djAvatarRig !== 'undefined' && djAvatarRig && djAvatarRig.root) {
        djAvatarRig.root.traverse(obj => {
            if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
        });
    }
}

/** Switches shadow resolution, or turns shadows off entirely, for an LOD level. */
function setShadowQuality(lodLevel) {
    const size = SHADOW_MAP_SIZES[Math.max(0, Math.min(2, lodLevel))];
    const wantEnabled = size > 0;

    if (wantEnabled !== shadowsEnabled) {
        shadowsEnabled = wantEnabled;
        renderer.shadowMap.enabled = wantEnabled;
        // Materials were compiled against the old shadow setting and have to be
        // rebuilt once. This is the one unavoidable hitch, hence the dwell time
        // guarding the LOD transition that calls it.
        scene.traverse(obj => {
            if (!obj.isMesh || !obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => { m.needsUpdate = true; });
        });
    }
    if (!wantEnabled || size === shadowMapSize) return;

    shadowMapSize = size;
    shadowCasters.forEach(({ light }) => {
        light.shadow.mapSize.set(size, size);
        // The render target was allocated at the old size; drop it so three
        // reallocates. Changing mapSize on its own has no effect. The depth
        // texture has to go first — this mirrors what WebGLShadowMap does
        // internally when a shadow's type changes; disposing only the target
        // leaks the depth attachment.
        if (light.shadow.map) {
            if (light.shadow.map.depthTexture) {
                light.shadow.map.depthTexture.dispose();
                light.shadow.map.depthTexture = null;
            }
            light.shadow.map.dispose();
            light.shadow.map = null;
        }
    });
}

const _shadowTopLum = new Float32Array(SHADOW_CASTER_COUNT);
const _shadowTopIdx = new Int32Array(SHADOW_CASTER_COUNT);

/**
 * Re-aims the caster pool at this frame's brightest moving-head beams. Runs off
 * activeBeams, which the moving-head update already fills with origin, direction
 * and colour — so no extra per-fixture bookkeeping is needed.
 */
function updateShadowCasters() {
    if (!shadowsEnabled) { shadowCastersInUse = 0; return; }

    // Top-k selection by luminance. k is 4, so an insertion pass beats sorting
    // the whole beam list and allocates nothing.
    _shadowTopLum.fill(-1);
    _shadowTopIdx.fill(-1);

    for (let b = 0; b < activeBeams.length; b++) {
        const beam = activeBeams[b];
        if (beam.isLaser) continue; // laser beams are pencil-thin: no usable pool
        const c = beam.color;
        const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
        if (lum <= 0.02) continue;

        for (let k = 0; k < SHADOW_CASTER_COUNT; k++) {
            if (lum > _shadowTopLum[k]) {
                for (let j = SHADOW_CASTER_COUNT - 1; j > k; j--) {
                    _shadowTopLum[j] = _shadowTopLum[j - 1];
                    _shadowTopIdx[j] = _shadowTopIdx[j - 1];
                }
                _shadowTopLum[k] = lum;
                _shadowTopIdx[k] = b;
                break;
            }
        }
    }

    shadowCastersInUse = 0;
    for (let k = 0; k < SHADOW_CASTER_COUNT; k++) {
        const entry = shadowCasters[k];
        const light = entry.light;
        const idx = _shadowTopIdx[k];

        if (idx < 0) {
            // Park it. Intensity 0 keeps the light in the scene graph, which keeps
            // the shader program stable; hiding it would trigger a recompile.
            light.intensity = 0;
            continue;
        }

        const beam = activeBeams[idx];
        light.position.copy(beam.pos);
        entry.target.position.copy(beam.pos).addScaledVector(beam.dir, SHADOW_BEAM_LEN);
        entry.target.updateMatrixWorld();

        // Separate hue from brightness: the beam colour already has the fixture's
        // opacity baked in, so feeding it straight to the light would dim twice.
        const peak = Math.max(beam.color.r, beam.color.g, beam.color.b, 1e-4);
        light.color.copy(beam.color).multiplyScalar(1 / peak);
        // three uses physical light units since r155: intensity is candela and
        // falls off over the ~14 m to the floor, so single-digit values do almost
        // nothing. Measured against floor luminance, the useful range here tops
        // out around 250 — beyond that the tone mapping simply clips.
        light.intensity = Math.min(_shadowTopLum[k] * 380, 250) * CFG.mhIntensity;
        shadowCastersInUse++;
    }
}

function getShadowStats() {
    return {
        enabled: shadowsEnabled,
        mapSize: shadowMapSize,
        poolSize: SHADOW_CASTER_COUNT,
        inUse: shadowCastersInUse,
        lod: currentLODLevel
    };
}

let compiledCustomLayout = null;

function buildStageEnvironment() {
    shadowFlagsDirty = true;
    // Clear old stage
    while(stageGroup.children.length > 0){ 
        const child = stageGroup.children[0];
        stageGroup.remove(child); 
    }
    screenMeshes.length = 0;
    stageBuildQueue.length = 0;

    const presetKey = CFG.stagePreset || 'openair';

    // Reset floor texture
    if (floor && floor.material) {
        floor.material.map = null;
        floor.material.color.set(0x050505);
        floor.material.roughness = 0.6;
        floor.material.needsUpdate = true;
    }

    if (presetKey === 'berghain') {
        // ─── BERGHAIN BUNKER ───
        setRainState(false);
        ambientLight.intensity = 0.35;
        stageLight.intensity = 1.8;
        fillLeft.intensity = 0.8;
        fillRight.intensity = 0.8;
        sunLight.intensity = 0.2;
        CFG.hazeDensity = 0.90;
        CFG.theme = 'bloodmoon';

        // Concrete bunker ceiling (5.0m concrete slab)
        const concMat = new THREE.MeshStandardMaterial({ color: 0x141417, roughness: 0.95, metalness: 0.1 });
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), concMat);
        ceiling.position.set(0, 5.0, -10);
        ceiling.rotation.x = Math.PI / 2;
        stageGroup.add(ceiling);

        // Concrete bunker walls
        const backW = new THREE.Mesh(new THREE.PlaneGeometry(30, 5.0), concMat);
        backW.position.set(0, 2.5, -30);
        stageGroup.add(backW);

        const leftW = new THREE.Mesh(new THREE.PlaneGeometry(40, 5.0), concMat);
        leftW.position.set(-15, 2.5, -10);
        leftW.rotation.y = Math.PI / 2;
        stageGroup.add(leftW);

        const rightW = new THREE.Mesh(new THREE.PlaneGeometry(40, 5.0), concMat);
        rightW.position.set(15, 2.5, -10);
        rightW.rotation.y = -Math.PI / 2;
        stageGroup.add(rightW);

        // 8 Dark Steel I-Beams along ceiling at y = 4.8m
        const beamMat = new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.7, roughness: 0.4 });
        for (let i = 0; i < 8; i++) {
            const zPos = -28 + i * 5.0;
            const beam = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 0.4), beamMat);
            beam.position.set(0, 4.8, zPos);
            stageGroup.add(beam);
        }

        // DJ Table
        const djTable = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, 2.0), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        djTable.position.set(0, 0.55, -15);
        stageGroup.add(djTable);

    } else if (presetKey === 'arena') {
        // ─── ARENA 360 (IN-THE-ROUND) ───
        setRainState(false);
        ambientLight.intensity = 0.45;
        stageLight.intensity = 2.2;
        fillLeft.intensity = 1.0;
        fillRight.intensity = 1.0;
        sunLight.intensity = 0.4;
        CFG.hazeDensity = 0.60;

        // Circular center stage platform
        const stageMat = new THREE.MeshStandardMaterial({ color: 0x181820, roughness: 0.7, metalness: 0.2 });
        const stagePlat = new THREE.Mesh(new THREE.CylinderGeometry(7.0, 7.0, 1.2, 32), stageMat);
        stagePlat.position.set(0, 0.6, 0);
        stageGroup.add(stagePlat);

        // 360° Suspended Circular Truss Rig at y = 20.0m (radius 18m)
        const circTrussGeo = new THREE.TorusGeometry(18.0, 0.4, 8, 48);
        const circTruss = new THREE.Mesh(circTrussGeo, trussMat);
        circTruss.position.set(0, 20.0, 0);
        circTruss.rotation.x = Math.PI / 2;
        stageGroup.add(circTruss);

        // 360° Cylindrical Wrapping LED Screen at y = 14.0m (radius 12m, h 6m)
        const cylScreenGeo = new THREE.CylinderGeometry(12.0, 12.0, 6.0, 64, 1, true);
        const cylScreen = new THREE.Mesh(cylScreenGeo, ledScreenMat);
        cylScreen.position.set(0, 14.0, 0);
        stageGroup.add(cylScreen);
        screenMeshes.push(cylScreen);

        // DJ Table in center
        const djTable = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.1, 2.0), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        djTable.position.set(0, 1.75, 0);
        stageGroup.add(djTable);

    } else if (presetKey === 'basement') {
        // ─── BASEMENT CLUB (8x8x3m) ───
        setRainState(false);
        ambientLight.intensity = 0.35;
        stageLight.intensity = 1.2;
        fillLeft.intensity = 0.5;
        fillRight.intensity = 0.5;
        sunLight.intensity = 0.1;
        CFG.hazeDensity = 1.0;

        const wallMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 });
        // Ceiling at y = 3m
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), wallMat);
        ceiling.position.set(0, 3.0, 0);
        ceiling.rotation.x = Math.PI / 2;
        stageGroup.add(ceiling);

        // 4 Walls (8m x 3m)
        const backW = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.0), wallMat);
        backW.position.set(0, 1.5, -4.0);
        stageGroup.add(backW);

        const frontW = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.0), wallMat);
        frontW.position.set(0, 1.5, 4.0);
        frontW.rotation.y = Math.PI;
        stageGroup.add(frontW);

        const leftW = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.0), wallMat);
        leftW.position.set(-4.0, 1.5, 0);
        leftW.rotation.y = Math.PI / 2;
        stageGroup.add(leftW);

        const rightW = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.0), wallMat);
        rightW.position.set(4.0, 1.5, 0);
        rightW.rotation.y = -Math.PI / 2;
        stageGroup.add(rightW);

        // 3 Glowing Neon Signs
        const signNoPhotos = createNeonSign('NO PHOTOS', 0xff0044, { x: -3.9, y: 2.0, z: 0 }, Math.PI / 2);
        stageGroup.add(signNoPhotos);

        const signClub = createNeonSign('CLUB', 0x00ffcc, { x: 3.9, y: 2.2, z: 1 }, -Math.PI / 2);
        stageGroup.add(signClub);

        const signRave = createNeonSign('RAVE', 0xffff00, { x: 0, y: 2.4, z: -3.9 }, 0);
        stageGroup.add(signRave);

        // Compact DJ Table
        const djTable = new THREE.Mesh(new THREE.BoxGeometry(3, 1.0, 1.4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        djTable.position.set(0, 0.5, -3.0);
        stageGroup.add(djTable);

    } else if (presetKey === 'custom') {
        // ─── CUSTOM STAGE LAYOUT ───
        setRainState(false);
        ambientLight.intensity = 0.6;
        stageLight.intensity = 2.0;
        fillLeft.intensity = 1.0;
        fillRight.intensity = 1.0;
        sunLight.intensity = 0.5;

        const layout = loadLayoutFromStorage();
        compiledCustomLayout = compileCustomStageLayout(layout);

        // Trusses
        compiledCustomLayout.trusses.forEach(tr => {
            const sx = (tr.scale?.x || 1) * 4;
            const sy = (tr.scale?.y || 1) * 0.4;
            const sz = (tr.scale?.z || 1) * 0.4;
            createTruss(sx, sy, sz, tr.position.x, tr.position.y, tr.position.z, tr.rotation?.x || 0, tr.rotation?.y || 0, tr.rotation?.z || 0);
        });

        // Screens
        compiledCustomLayout.screens.forEach(scr => {
            const sw = (scr.scale?.x || 1) * 6;
            const sh = (scr.scale?.y || 1) * 3.5;
            addScreen(sw, sh, scr.position.x, scr.position.y, scr.position.z, scr.rotation?.y || 0);
        });

        const djTable = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        djTable.position.set(0, 0.6, -10);
        stageGroup.add(djTable);

    } else {
        // ─── OPEN-AIR FESTIVAL (DEFAULT) ───
        const isRainChecked = document.getElementById('param-weather-rain')?.checked;
        setRainState(!!isRainChecked, 4000);
        ambientLight.intensity = 0.5;
        stageLight.intensity = 2.5;
        fillLeft.intensity = 1.2;
        fillRight.intensity = 1.2;
        sunLight.intensity = 0.6;
        CFG.hazeDensity = 0.55;

        // Procedural Starfield (2500 points)
        const starfield = createProceduralStarfield(2500, 300);
        stageGroup.add(starfield);

        // Procedural Grass texture
        const grassTex = createProceduralGrassTexture();
        if (grassTex && floor && floor.material) {
            floor.material.map = grassTex;
            floor.material.needsUpdate = true;
        }

        // Horizontal Main Trusses (40m width)
        createTruss(40, 0.4, 0.4, 0, 14, -10);
        createTruss(40, 0.4, 0.4, 0, 14, -20);
        createTruss(40, 0.4, 0.4, 0, 10, -15);

        // Vertical Supports
        for (let x of [-19, 19]) {
            createTruss(0.4, 14, 0.4, x, 7, -10);
            createTruss(0.4, 14, 0.4, x, 7, -20);
        }

        // Dual 22m Truss Towers at x = -20m and x = +20m, z = -5m
        createTruss(2.0, 22.0, 2.0, -20.0, 11.0, -5.0);
        createTruss(2.0, 22.0, 2.0, 20.0, 11.0, -5.0);

        // 3 Screens: Main 30x15m wall + 2 Tower screens 8x20m
        addScreen(30, 15, 0, 7.5, -25);
        addScreen(8, 20, -20, 10, -5, Math.PI / 12);
        addScreen(8, 20, 20, 10, -5, -Math.PI / 12);

        // DJ Booth Screens
        addScreen(8, 4, 0, 2, -15);

        // DJ Table + CDJs
        const djTable = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        djTable.position.set(0, 0.6, -15);
        stageGroup.add(djTable);

        const eqMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5 });
        const mixer = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 1.5), eqMat);
        mixer.position.set(0, 1.3, -15);
        stageGroup.add(mixer);
        const cdj1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.4), eqMat);
        cdj1.position.set(-1.4, 1.275, -15);
        stageGroup.add(cdj1);
        const cdj2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.4), eqMat);
        cdj2.position.set(1.4, 1.275, -15);
        stageGroup.add(cdj2);
    }

    // Mount procedural 3D DJ Avatar behind the DJ booth (R6)
    if (djAvatarRig && djAvatarRig.root && djAvatarRig.root.parent) {
        djAvatarRig.root.parent.remove(djAvatarRig.root);
    }
    djAvatarRig = createDJAvatarMesh();
    if (presetKey === 'arena') {
        djAvatarRig.root.position.set(0, 0.6, -1.2);
    } else if (presetKey === 'basement') {
        djAvatarRig.root.position.set(0, 0.0, -3.8);
    } else if (presetKey === 'berghain') {
        djAvatarRig.root.position.set(0, 0.0, -16.2);
    } else if (presetKey === 'small') {
        djAvatarRig.root.position.set(0, 0.0, -11.2);
    } else {
        djAvatarRig.root.position.set(0, 0.0, -16.2);
    }
    djAvatarRig.root.visible = djAvatarEnabled;
    stageGroup.add(djAvatarRig.root);
}

buildStageEnvironment();



// ─────────────────────────────────────────────
//  PYROTECHNIK SYSTEM (Offloaded to Worker)
// ─────────────────────────────────────────────

const pyroWorker = new Worker(new URL('./pyro-worker.js', import.meta.url), { type: 'module' });
let pyroSystemIdCounter = 0;

let pyroAudioListener = null;
function getPyroAudioListener(camera) {
    if (!pyroAudioListener) {
        pyroAudioListener = new THREE.AudioListener();
        camera.add(pyroAudioListener);
    }
    return pyroAudioListener;
}

// Every PyroSystem used to build its Web Audio graph in its constructor, which
// runs at page load. That constructed an AudioContext before any user gesture
// (Chrome then logs "The AudioContext was not allowed to start" and leaves it
// suspended) and generated one 2-second white-noise buffer per system. The graph
// is now built on the first user interaction, and the noise buffer is shared.
let pyroAudioUnlocked = false;
let sharedPyroNoiseBuffer = null;

function getSharedPyroNoiseBuffer(ctx) {
    if (!sharedPyroNoiseBuffer || sharedPyroNoiseBuffer.sampleRate !== ctx.sampleRate) {
        const bufferSize = Math.floor(ctx.sampleRate * 2); // 2 seconds
        sharedPyroNoiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = sharedPyroNoiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    }
    return sharedPyroNoiseBuffer;
}

/** Builds the deferred pyro audio graphs. Safe to call more than once. */
function unlockPyroAudio() {
    if (pyroAudioUnlocked) return;
    pyroAudioUnlocked = true;
    pyroSystems.forEach(ps => { try { ps.initAudio(); } catch (e) { console.warn('[Pyro] audio init failed', e); } });
    if (pyroAudioListener && pyroAudioListener.context && pyroAudioListener.context.state === 'suspended') {
        pyroAudioListener.context.resume().catch(() => {});
    }
}

// Browsers only allow an AudioContext to start inside a user gesture, so arm the
// pyro audio on the first interaction of any kind and then stop listening.
if (typeof window !== 'undefined') {
    const armPyroAudio = () => unlockPyroAudio();
    ['pointerdown', 'keydown', 'touchstart'].forEach(evt =>
        window.addEventListener(evt, armPyroAudio, { once: true, passive: true })
    );
}

// WebGPU-native particle materials using PointsNodeMaterial + TSL
// A soft radial gradient disc — stays fully compatible with the WebGPU RenderPipeline.
function makeParticleMaterial(baseSize, baseOpacity) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uOpacity: { value: baseOpacity },
            uBokehStretch: { value: 1.0 }
        },
        vertexShader: `
            attribute float aSize;
            attribute vec3 aColor;
            varying vec3 vCol;
            void main() {
                vCol = aColor;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (350.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vCol;
            uniform float uOpacity;
            uniform float uBokehStretch;
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                coord.x *= uBokehStretch;
                float dist = length(coord) * 2.0;
                if (dist > 1.0) discard;
                float alpha = smoothstep(1.0, 0.0, dist);
                gl_FragColor = vec4(vCol, alpha * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });
}

const fireMaterial  = makeParticleMaterial(0.8,  0.95);
const sparkMaterial = makeParticleMaterial(0.25, 0.95);


class PyroSystem {
    constructor({ x, y, z, type = 'flame', maxParticles = 15000, emitDir = {x:0,y:1,z:0}, spread = 0.4 }) {
        this.id = pyroSystemIdCounter++;
        this.type = type; // expose so animate loop can check isFlame / isSpark
        this.maxParticles = maxParticles;
        this.isUpdating = false;

        this.geo = new THREE.BufferGeometry();
        const n = maxParticles;
        
        // Use SharedArrayBuffer for zero-copy worker communication
        const posBuffer = new SharedArrayBuffer(n * 3 * 4);
        const ageBuffer = new SharedArrayBuffer(n * 4);
        const ltBuffer = new SharedArrayBuffer(n * 4);
        const sizeBuffer = new SharedArrayBuffer(n * 4);
        const colorBuffer = new SharedArrayBuffer(n * 3 * 4);
        
        this.posAttr   = new THREE.BufferAttribute(new Float32Array(posBuffer), 3).setUsage(THREE.DynamicDrawUsage);
        this.ageAttr   = new THREE.BufferAttribute(new Float32Array(ageBuffer), 1).setUsage(THREE.DynamicDrawUsage);
        this.ltAttr    = new THREE.BufferAttribute(new Float32Array(ltBuffer), 1).setUsage(THREE.DynamicDrawUsage);
        this.sizeAttr  = new THREE.BufferAttribute(new Float32Array(sizeBuffer), 1).setUsage(THREE.DynamicDrawUsage);
        this.colorAttr = new THREE.BufferAttribute(new Float32Array(colorBuffer), 3).setUsage(THREE.DynamicDrawUsage);
        this.geo.setAttribute('position', this.posAttr);
        this.geo.setAttribute('aAge',     this.ageAttr);
        this.geo.setAttribute('aLifetime',this.ltAttr);
        this.geo.setAttribute('aSize',    this.sizeAttr);
        this.geo.setAttribute('aColor',   this.colorAttr);
        this.geo.setDrawRange(0, 0);

        const mat = (type === 'flame') ? fireMaterial.clone() : sparkMaterial.clone();
        this.points = new THREE.Points(this.geo, mat);
        this.points.frustumCulled = false;
        scene.add(this.points);

        // Add dynamic light
        this.light = new THREE.PointLight(0xffaa55, 0, 20);
        this.light.position.set(x, y + 2, z);
        scene.add(this.light);

        // Procedural audio is built lazily — see unlockPyroAudio().
        this.sound = null;
        this.noiseSource = null;
        this.filter = null;
        this.gainNode = null;
        if (pyroAudioUnlocked) this.initAudio();

        pyroWorker.postMessage({
            type: 'init',
            id: this.id,
            config: { x, y, z, type, maxParticles, emitDir, spread, posBuffer, ageBuffer, ltBuffer, sizeBuffer, colorBuffer }
        });

        this.onWorkerMessage = (e) => {
            const { type, id, burstIntensity } = e.data;
            if (type === 'updated' && id === this.id) {
                this.posAttr.needsUpdate = true;
                this.ageAttr.needsUpdate = true;
                this.ltAttr.needsUpdate = true;
                this.sizeAttr.needsUpdate = true;
                this.colorAttr.needsUpdate = true;
                this.geo.setDrawRange(0, this.maxParticles);
                this.isUpdating = false;

                // Sync light and sound
                if (this.type === 'flame' && burstIntensity !== undefined) {
                    this.light.intensity = burstIntensity * 10;

                    if (!this.sound || !this.gainNode) return; // audio not unlocked yet
                    const now = this.sound.context.currentTime;
                    // Hiss/roar
                    this.gainNode.gain.setTargetAtTime(burstIntensity * 1.5, now, 0.05);
                    this.filter.frequency.setTargetAtTime(500 + burstIntensity * 3000, now, 0.05);
                }
            }
        };

        pyroWorker.addEventListener('message', this.onWorkerMessage);
    }

    /** Creates this system's Web Audio graph. Called after the first user gesture. */
    initAudio() {
        if (this.sound) return;

        this.sound = new THREE.PositionalAudio(getPyroAudioListener(camera));
        this.sound.setRefDistance(5);
        this.sound.setVolume(0);

        const ctx = this.sound.context;
        this.noiseSource = ctx.createBufferSource();
        this.noiseSource.buffer = getSharedPyroNoiseBuffer(ctx);
        this.noiseSource.loop = true;

        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 500;

        this.gainNode = ctx.createGain();
        this.gainNode.gain.value = 0;

        this.noiseSource.connect(this.filter);
        this.filter.connect(this.gainNode);

        this.sound.setNodeSource(this.gainNode);
        this.points.add(this.sound);

        // Runs continuously but silent (gain = 0) until a burst raises it.
        this.noiseSource.start(0);
    }

    triggerBang() {
        if (!this.sound || !this.sound.context) return;
        const ctx = this.sound.context;
        const now = ctx.currentTime;
        
        // Short, explosive low-end punch
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        const oscGain = ctx.createGain();
        osc.connect(oscGain);
        if (this.sound.getInput) oscGain.connect(this.sound.getInput());
        
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        
        oscGain.gain.setValueAtTime(2.0, now);
        oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        
        osc.start(now);
        osc.stop(now + 0.2);
        
        // Noise burst for the pop
        if (this.noiseSource && this.noiseSource.buffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = this.noiseSource.buffer;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(3000, now);
            noiseFilter.frequency.exponentialRampToValueAtTime(200, now + 0.2);
            
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(3.0, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            if (this.sound.getInput) noiseGain.connect(this.sound.getInput());
            
            noise.start(now);
            noise.stop(now + 0.3);
        }
    }

    update(dt, globalT, energy, bass, mid, high, kick, windX, windY, pyroIntensity, isPeak) {
        if (this.isUpdating) return;
        this.isUpdating = true;

        if (this.type === 'flame' && isPeak && kick > 0.8) {
            const ctx = this.sound.context;
            if (!this.lastBangTime || ctx.currentTime - this.lastBangTime > 0.25) {
                this.lastBangTime = ctx.currentTime;
                this.triggerBang();
            }
        }

        pyroWorker.postMessage({
            type: 'update',
            id: this.id,
            data: {
                dt, globalT, energy, bass, mid, high, kick, windX, windY, pyroIntensity, isPeak
            }
        });
    }

    dispose() {
        pyroWorker.removeEventListener('message', this.onWorkerMessage);
        pyroWorker.postMessage({ type: 'dispose', id: this.id });
        scene.remove(this.points);
        scene.remove(this.light);
        if (this.sound && this.sound.parent) this.sound.parent.remove(this.sound);
        if (this.noiseSource) this.noiseSource.stop();
        this.geo.dispose();
        if (this.points.material) this.points.material.dispose();
    }
}

function initPyroSystems() {
    // Clear old
    pyroSystems.forEach(p => p.dispose());
    pyroSystems = [];

    const presetKey = CFG.stagePreset || 'openair';

    if (presetKey === 'custom' && compiledCustomLayout && compiledCustomLayout.co2Jets && compiledCustomLayout.co2Jets.length > 0) {
        compiledCustomLayout.co2Jets.forEach(jet => {
            pyroSystems.push(new PyroSystem({
                x: jet.position.x,
                y: jet.position.y || 0.1,
                z: jet.position.z,
                type: 'flame',
                maxParticles: 400,
                emitDir: { x: 0, y: 1.0, z: 0 },
                spread: 0.2
            }));
        });
        return;
    }

    const sparkZ = CFG.stageSize === 'large' ? -10 : -3; 

    if (CFG.stageSize === 'large' && presetKey !== 'basement') {
        const pyroCount = 3;
        // 3 flamethrowers on left edge, 3 on right edge (at floor level, shooting up)
        for (let side of [-1, 1]) {
            for (let k = 0; k < pyroCount; k++) {
                const xPos = side * (8 + k * 4);
                pyroSystems.push(new PyroSystem({
                    x: xPos, y: 0.1, z: -12 + k * 2,
                    type: 'flame',
                    maxParticles: 500,
                    emitDir: { x: side * 0.05, y: 1.0, z: 0 },
                    spread: 0.25,
                }));
            }
        }
    } else {
        // Small Stage - Only 1 flamethrower per side
        for (let side of [-1, 1]) {
            pyroSystems.push(new PyroSystem({
                x: side * 4, y: 0.1, z: -3,
                type: 'flame',
                maxParticles: 300, // Reduced particles
                emitDir: { x: side * 0.05, y: 1.0, z: 0 },
                spread: 0.2,
            }));
        }
    }

    // 2 spark fountains on the DJ table surface
    for (let side of [-1.5, 1.5]) {
        pyroSystems.push(new PyroSystem({
            x: side, y: 1.4, z: sparkZ,
            type: 'spark',
            maxParticles: CFG.stageSize === 'large' ? 400 : 200,
            emitDir: { x: side * 0.3, y: 1.0, z: 0.1 },
            spread: 0.6,
        }));
    }
}

// Initialize on page load (hidden until enabled)
initPyroSystems();

// ─────────────────────────────────────────────
//  LASER FORMATION + HAZE
// ─────────────────────────────────────────────
const laserObjects = [];
const movingHeadObjects = [];
const crowdObjects = [];
const upLightObjects = [];

let movingHeadsEnabled = true;
let peakModeEnabled = true;
let liveCrowdEnabled = true;
let dynamicCrowdEnabled = true;
let upLightsEnabled = true;
let hazeSystem   = null;
let hazeMaterial = null;

// New visually premium systems variables
let confettiIM = null;
const confettiParticles = [];
let lastConfettiTime = 0;

let fogIM = null;
const fogParticles = [];
let lastFogDropTime = 0;
let fogTexture = null;

let laserSpotsIM = null;

let crowdMatUp = null;
let crowdMatDown = null;
let activeBeams = [];
// activeBeams is rebuilt from scratch every frame and read by the rain-reflection
// and crowd-lighting passes. Allocating a Vector3 + Euler + Color per beam per
// frame (~40 beams x 60 fps x 4 objects) is pure GC pressure, so the entries are
// pooled and reused; only the pool's length grows.
const _beamPool = [];
let _beamPoolUsed = 0;
const _beamEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _stageWorldPos = new THREE.Vector3(); // scratch for the per-frame LOD sweep

function resetBeamPool() {
    activeBeams.length = 0;
    _beamPoolUsed = 0;
}

/** Grabs a pooled beam record, fills it in and pushes it onto activeBeams. */
function pushBeam(px, py, pz, rotX, rotY, color, isLaser) {
    let b = _beamPool[_beamPoolUsed];
    if (!b) {
        b = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), color: new THREE.Color(), isLaser: false };
        _beamPool[_beamPoolUsed] = b;
    }
    _beamPoolUsed++;
    b.pos.set(px, py, pz);
    b.dir.set(0, 0, 1).applyEuler(_beamEuler.set(rotX, rotY, 0, 'YXZ'));
    b.color.copy(color);
    b.isLaser = isLaser;
    activeBeams.push(b);
    return b;
}




const sharedGeos = new Map();
const sharedMats = new Map();

function getSharedGeo(id, creator) {
    if (!sharedGeos.has(id)) sharedGeos.set(id, creator());
    return sharedGeos.get(id);
}

function getSharedMat(id, creator) {
    if (!sharedMats.has(id)) sharedMats.set(id, creator());
    return sharedMats.get(id);
}

function setupMovingHeadIM(count) {
    if (mhBaseIM) {
        if (mhBaseIM.count >= count) {
            mhBaseIM.count = count;
            mhYokeIM.count = count;
            mhHeadIM.count = count;
            mhCoreIM.count = count;
            mhWashIM.count = count;
            return;
        }
        scene.remove(mhBaseIM, mhYokeIM, mhHeadIM, mhCoreIM, mhWashIM);
        [mhBaseIM, mhYokeIM, mhHeadIM, mhCoreIM, mhWashIM].forEach(im => {
            if (im.instanceMatrix && typeof im.instanceMatrix.dispose === 'function') im.instanceMatrix.dispose();
            if (im.instanceColor && typeof im.instanceColor.dispose === 'function') im.instanceColor.dispose();
        });
    }

    const baseGeo = getSharedGeo('mhBase', () => {
        const g = new THREE.BoxGeometry(1.2, 0.8, 1.2);
        g.translate(0, 0.4, 0);
        return g;
    });
    mhBaseIM = new THREE.InstancedMesh(baseGeo,
        getSharedMat('mhBase', () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })), count);

    const yokeGeo = getSharedGeo('mhYoke', () => {
        const g = new THREE.BoxGeometry(1.6, 0.25, 0.25);
        g.translate(0, 0.55, 0);
        return g;
    });
    mhYokeIM = new THREE.InstancedMesh(yokeGeo,
        getSharedMat('mhYoke', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })), count);

    // Head: cylinder lying sideways (along X) so rotation around X = tilt
    const headGeo = getSharedGeo('mhHead', () => {
        const g = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12);
        g.rotateZ(Math.PI / 2); // now axis lies along X
        return g;
    });
    mhHeadIM = new THREE.InstancedMesh(headGeo,
        getSharedMat('mhHead', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })), count);

    // Beam cone: tip at origin, opens downward along -Y, then rotated so -Y becomes the beam axis.
    // The cone starts long-axis along +Y; after rotateX(-PI/2) it points in +Z (toward audience).
    // A tiltAngle > 0 around X will then sweep the beam downward (-Y) → toward the floor below the fixtures.
    const beamLen = 45;
    const coneGeo = getSharedGeo('mhCore', () => {
        const g = new THREE.CylinderGeometry(5.5, 0.08, beamLen, 14, 1, true);
        g.translate(0, -beamLen / 2, 0); // tip at y=0, base at y=-beamLen
        g.rotateX(-Math.PI / 2);          // now: tip at origin, base at z=+beamLen (toward audience)
        return g;
    });
    mhCoreIM = new THREE.InstancedMesh(coneGeo, getSharedMat('mhCore', () => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true, opacity: (0.02 + CFG.hazeDensity * 0.06) * BEAM_HDR_SCALE,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        alphaMap: globalGoboTexture
    })), count);

    const washGeo = getSharedGeo('mhWash', () => {
        const g = new THREE.CylinderGeometry(16.0, 0.08, beamLen, 12, 1, true);
        g.translate(0, -beamLen / 2, 0);
        g.rotateX(-Math.PI / 2);
        return g;
    });
    mhWashIM = new THREE.InstancedMesh(washGeo, getSharedMat('mhWash', () => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true, opacity: (CFG.hazeDensity * 0.02) * BEAM_HDR_SCALE,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })), count);

    [mhBaseIM, mhYokeIM, mhHeadIM, mhCoreIM, mhWashIM].forEach(im => {
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false; // Large instanced mesh – never cull early
        scene.add(im);
    });

    // Initialise all instance colours to white so non-dynamic themes look correct immediately
    for (let i = 0; i < count; i++) {
        mhCoreIM.setColorAt(i, _white);
        mhWashIM.setColorAt(i, _white);
    }
    mhCoreIM.instanceColor.needsUpdate = true;
    mhWashIM.instanceColor.needsUpdate = true;
}

// Moving-head truss layout: 3 rows of trusses at different depths/heights, filling full stage width.
const MH_TRUSS_ROWS = [
    { y: 19, z: -28, cols: 0.40 }, // top rear truss  – 40% of count
    { y: 15, z: -22, cols: 0.35 }, // mid truss      – 35% of count
    { y: 11, z: -16, cols: 0.25 }, // front truss    – 25% of count
];

function initMovingHeads(count = CFG.movingHeadCount) {
    // Dispose old proxies from scene
    movingHeadObjects.forEach(mh => scene.remove(mh.proxy));
    movingHeadObjects.length = 0;
    if (!movingHeadsEnabled) return;

    let mhSlots = [];
    const presetKey = CFG.stagePreset || 'openair';

    if (presetKey === 'custom' && compiledCustomLayout && compiledCustomLayout.movingHeads.length > 0) {
        count = compiledCustomLayout.movingHeads.length;
        mhSlots = compiledCustomLayout.movingHeads.map(mh => ({
            x: mh.position.x,
            y: mh.position.y,
            z: mh.position.z
        }));
    } else if (presetKey === 'berghain') {
        count = 6;
        mhSlots = [
            { x: -1.5, y: 4.8, z: -16 },
            { x: 1.5, y: 4.8, z: -12 },
            { x: -1.5, y: 4.8, z: -8 },
            { x: 1.5, y: 4.8, z: -4 },
            { x: -1.5, y: 4.8, z: 0 },
            { x: 1.5, y: 4.8, z: 4 }
        ];
    } else if (presetKey === 'basement') {
        count = 4;
        mhSlots = [
            { x: -3.0, y: 2.8, z: -2.0 },
            { x: -1.0, y: 2.8, z: -2.0 },
            { x: 1.0, y: 2.8, z: -2.0 },
            { x: 3.0, y: 2.8, z: -2.0 }
        ];
    } else if (presetKey === 'arena') {
        count = 16;
        mhSlots = [];
        for (let i = 0; i < 16; i++) {
            const angle = ((i + 0.5) / 16) * Math.PI * 2;
            mhSlots.push({
                x: Math.cos(angle) * 18.0,
                y: 20.0,
                z: Math.sin(angle) * 18.0
            });
        }
    } else {
        let idx = 0;
        MH_TRUSS_ROWS.forEach((row, ri) => {
            const rowCount = ri < MH_TRUSS_ROWS.length - 1
                ? Math.round(count * row.cols)
                : count - idx;
            const spacing = rowCount > 1 ? 120 / (rowCount - 1) : 0;

            for (let c = 0; c < rowCount && idx < count; c++, idx++) {
                mhSlots.push({
                    x: -60 + c * (rowCount > 1 ? spacing : 0),
                    y: row.y,
                    z: row.z
                });
            }
        });
    }

    CFG.movingHeadCount = count;
    setupMovingHeadIM(count);

    for (let i = 0; i < count; i++) {
        const slot = mhSlots[i] || { x: 0, y: 10, z: -10 };
        const proxy = new THREE.Group();
        proxy.position.set(slot.x, slot.y, slot.z);
        scene.add(proxy);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 1.5, 1.2),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.userData.isProjectorHitbox = true;
        hitbox.userData.isMovingHead = true;
        proxy.add(hitbox);

        movingHeadObjects.push({
            pos: proxy.position,
            proxy,
            intensity: 1.0,
            color: _white.clone(),
            headState: { panVel: 0, tiltVel: 0, adsrState: 0, pan: 0, tilt: Math.PI * 0.28 }
        });
    }
}

const PATTERN_IDS = {
    'fan': 0, 'wave': 1, 'xcross': 2, 'salvo': 3, 'tunnel': 4,
    'sidesweep': 5, 'vortex': 6, 'strobe': 7, 'scatter': 8, 'sine': 9,
    'chase': 10, 'chase-fast': 11, 'zigzag': 12, 'sparkle': 13, 'pulse': 14,
    'starburst': 15, 'flame': 16, 'supernova': 17, 'phantom': 18, 'eclipse': 19,
    'glacier': 20, 'hexagon': 21, 'blood-sweep': 22, 'starlight': 23
};

const laserUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uKick: { value: 0 },
    uEnergy: { value: 0 },
    uBuildUp: { value: 0 },
    uSpread: { value: 0 },
    uTilt: { value: 0 },
    uIsPeakDrop: { value: 0 },
    uIsSilent: { value: 0 },
    uPattern: { value: 0 },
    uSalvoX: { value: 0 },
    uSalvoZ: { value: 0 },
    uTunnelOmega: { value: 0 },
    uMelody: { value: 0 },
    uTransient: { value: 0 },
    uPlaying: { value: 0 },
    uEnergyChaosBase: { value: 0 },
    uActivity: { value: 0 },
    uVariationPhase: { value: 0 },
    uIntensity: { value: 0 },
    uFlashDecay: { value: 0 },
    uStrobeOn: { value: 0 },
    uIsStudioMode: { value: 0 },
    uIsDynamicTheme: { value: 0 },
    uLissXf: { value: 0.5 },
    uLissYf: { value: 0.5 },
    uLissZf: { value: 0.5 },
    uLissXp: { value: 0 },
    uLissYp: { value: 0 },
    uLissZp: { value: 0 },
    uLaserCount: { value: 180 }
};

let laserCoreMaterial = null;
let laserTubeMaterial = null;
let laserSpotsMaterial = null;

const laserVertexShader = `
  attribute float aBaseYaw;
  attribute float aSectionLaserHue;
  attribute vec3 aStaticColor;
  attribute float aInstanceID;

  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uKick;
  uniform float uEnergy;
  uniform float uBuildUp;
  uniform float uSpread;
  uniform float uTilt;
  uniform float uIsPeakDrop;
  uniform float uIsSilent;
  uniform int uPattern;
  uniform float uSalvoX;
  uniform float uSalvoZ;
  uniform float uTunnelOmega;
  uniform float uMelody;
  uniform float uTransient;
  uniform float uPlaying;
  uniform float uEnergyChaosBase;
  uniform float uActivity;
  uniform float uVariationPhase;
  uniform float uIntensity;
  uniform float uFlashDecay;
  uniform float uStrobeOn;
  uniform float uIsStudioMode;
  uniform float uIsDynamicTheme;
  uniform float uLaserCount;

  uniform float uLissXf;
  uniform float uLissYf;
  uniform float uLissZf;
  uniform float uLissXp;
  uniform float uLissYp;
  uniform float uLissZp;

  varying vec4 vColor;

  vec3 rotateYXZ(vec3 v, float pitchX, float yawY) {
      float cp = cos(pitchX);
      float sp = sin(pitchX);
      vec3 v1 = vec3(
          v.x,
          v.y * cp - v.z * sp,
          v.y * sp + v.z * cp
      );
      float cy = cos(yawY);
      float sy = sin(yawY);
      vec3 v2 = vec3(
          v1.x * cy + v1.z * sy,
          v1.y,
          -v1.x * sy + v1.z * cy
      );
      return v2;
  }

  vec3 hsl2rgb(vec3 c) {
      vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
      float wn = aInstanceID / max(uLaserCount - 1.0, 1.0);
      float iPhase = (mod(aInstanceID, 2.0) == 0.0) ? 1.0 : -1.0;
      
      float norm2 = wn * 2.0 - 1.0;
      float freqBias = (uPlaying > 0.5) ? uMelody : 0.0;
      
      float buConverge = (uBuildUp > 0.45) ? (uBuildUp - 0.45) * 1.8 : 0.0;
      float sp = uSpread;
      
      float localTilt = 0.0;
      float localPan = 0.0;

      float phaseOff = wn * 3.14159265 * 2.0;
      float vOff = uVariationPhase * 0.6283;
      float lSeed = uLissXp + aInstanceID * 0.7391 + vOff;
      float vMod  = 1.0 + uVariationPhase * 0.09;
      
      float lxf = (uLissXf + mod(lSeed, 0.12))          * vMod;
      float lyf = (uLissYf + mod(lSeed * 1.618, 0.10)) * (2.0 - vMod);
      float lzf = (uLissZf + mod(lSeed * 2.718, 0.14)) * vMod;
      float lxp = uLissXp + phaseOff + vOff;
      float lyp = uLissYp + phaseOff * 0.7;
      float lzp = uLissZp + phaseOff * 1.3 + vOff * 0.5;
      
      if (uPattern == 0) { // fan
          float fanSpeed = uTime * lxf * 0.55;
          localPan  = norm2 * 0.7 * sp * (1.0 - buConverge * 0.6)
                     + sin(fanSpeed + lxp) * 0.18 * sp * (1.0 - buConverge)
                     + uMid * 0.25 * iPhase;
          localTilt = uTilt + 0.12 * sp
                     + sin(uTime * lyf * 0.4 + lyp) * 0.15 * sp
                     + uBass * 0.22 * (1.0 + uBuildUp);
      }
      else if (uPattern == 1) { // wave
          float travelPhase = uTime * lxf * 0.9 - wn * 3.14159265 * 3.5;
          localPan  = sin(travelPhase) * 0.75 * sp
                     + uMid * 0.2 * norm2;
          localTilt = uTilt
                     + cos(uTime * lyf * 0.5 + lyp) * 0.22 * sp
                     + uHigh * 0.18;
      }
      else if (uPattern == 2) { // xcross
          float xSpeed = uTime * lxf * 0.65;
          localPan  = iPhase * abs(sin(xSpeed + lxp)) * 0.9 * sp * (1.0 - buConverge * 0.7)
                     + uKick * norm2 * 0.6;
          localTilt = uTilt + 0.1
                     + cos(uTime * lyf * 0.3 + lyp) * 0.12 * sp;
      }
      else if (uPattern == 3) { // salvo
          float converge = max(buConverge, 0.35 + uEnergy * 0.4);
          localTilt = mix(
              uTilt + norm2 * 0.4 * sp,
              uTilt + uSalvoX,
              converge
          );
          localPan  = mix(
              norm2 * 0.8 * sp,
              uSalvoZ,
              converge
          );
      }
      else if (uPattern == 4) { // tunnel
          float angle = uTunnelOmega + wn * 3.14159265 * 2.0;
          float radius = 0.4 * sp * (1.0 - buConverge * 0.5);
          localPan  = sin(angle) * radius;
          localTilt = uTilt + (1.0 - cos(angle)) * radius * 0.5 + 0.1;
      }
      else if (uPattern == 5) { // sidesweep
          float sweep = sin(uTime * lzf * 0.5 + lzp + wn * 0.8) * 0.85 * sp;
          localPan  = sweep + uBass * iPhase * 0.35;
          localTilt = uTilt + sin(uTime * lyf * 0.25 + lyp) * 0.15 * sp;
      }
      else if (uPattern == 6) { // vortex
          float radius = 0.5 + sin(uTime * 0.5) * 0.5;
          float angle = uTime * 2.0 + wn * 3.14159265 * 4.0;
          localPan = cos(angle) * radius * sp;
          localTilt = uTilt + sin(angle) * radius * 0.5 * sp;
          if (uEnergy > 0.6) {
              float shake = sin(uTime * 123.45 + wn * 543.21) * uEnergy * 0.05;
              localPan += shake;
              localTilt += shake;
          }
      }
      else if (uPattern == 7) { // strobe
          float strobeVar = (uIsPeakDrop > 0.5) ? floor(uTime * 8.0) : 0.0;
          localPan  = sin(lxp + uVariationPhase * 0.6283 + strobeVar * 2.1) * norm2 * ((uIsPeakDrop > 0.5) ? 1.3 : 0.6) * sp;
          localTilt = uTilt + cos(lzp + wn * 3.14159265 + uVariationPhase * 0.6283 + strobeVar * 1.7) * ((uIsPeakDrop > 0.5) ? 0.7 : 0.35) * sp;
      }
      else if (uPattern == 8) { // scatter
          float scatterSpeed = (uIsPeakDrop > 0.5) ? 4.5 : 1.4;
          float scatterWarp = (uIsPeakDrop > 0.5) ? 2.5 : 1.0;
          localPan  = sin(uTime * lxf * scatterSpeed + lxp) * 1.2 * sp * scatterWarp
                     + cos(uTime * lyf * scatterSpeed * 0.8 + lyp) * 0.6 * sp * scatterWarp
                     + uMelody * 0.6 * iPhase;
          localTilt = uTilt
                     + sin(uTime * lzf * scatterSpeed * 0.9 + lzp) * 0.9 * sp * scatterWarp;
      }
      else if (uPattern == 9) { // sine
          float waveT = uTime * lxf * 1.2 + wn * 3.14159265 * 4.0;
          localPan = sin(waveT) * 0.6 * sp;
          localTilt = uTilt + cos(waveT * 0.8) * 0.2 * sp;
      }
      else if (uPattern == 10 || uPattern == 11) { // chase, chase-fast
          localPan = norm2 * 0.6 * sp;
          localTilt = uTilt + sin(uTime * lyf * 0.5 + wn * 3.14159265 * 2.0) * 0.15 * sp;
      }
      else if (uPattern == 12) { // zigzag
          localPan = norm2 * 0.8 * sp + iPhase * sin(uTime * 2.5) * 0.2 * sp;
          localTilt = uTilt + iPhase * 0.25 * sp;
      }
      else if (uPattern == 13 || uPattern == 14) { // sparkle, pulse
          localPan = sin(lxp + uVariationPhase * 0.6283 + uTime * 0.1) * norm2 * 0.7 * sp;
          localTilt = uTilt + cos(lzp + wn * 3.14159265) * 0.3 * sp;
      }
      else if (uPattern == 15) { // starburst
          localPan = sin(uTime * lxf * 3.0 + lxp) * 1.5 * sp * ((uIsPeakDrop > 0.5) ? 2.0 : 1.0);
          localTilt = uTilt + cos(uTime * lyf * 3.0 + lyp) * 0.8 * sp;
      }
      else if (uPattern == 16) { // flame
          localPan = norm2 * 0.5 * sp + sin(uTime * 2.0 + wn * 10.0) * 0.1 * sp;
          localTilt = uTilt + (sin(uTime * 5.0 + wn * 5.0) * 0.5 + 0.5) * 0.3 * sp;
      }
      else if (uPattern == 17) { // supernova
          float novaSpeed = uTime * 2.5;
          float expandRadius = 0.3 + sin(novaSpeed * 0.5) * 0.7;
          float angle = novaSpeed + wn * 3.14159265 * 8.0;
          localPan = cos(angle) * expandRadius * sp * (1.0 + buConverge * 0.5);
          localTilt = uTilt + sin(angle) * expandRadius * sp * (1.0 + buConverge * 0.5);
      }
      else if (uPattern == 18) { // phantom
          float phantomSpeed = uTime * 0.8;
          localPan  = sin(phantomSpeed + phaseOff * 3.0) * 0.8 * sp
                     + cos(uTime * 0.5 + aInstanceID) * 0.2 * sp * norm2;
          localTilt = uTilt + 0.1 * sp
                     + sin(uTime * 1.2 + aInstanceID * 2.0) * 0.15 * sp * iPhase
                     + uBass * 0.3;
      }
      else if (uPattern == 19) { // eclipse
          float eclipseSpeed = uTime * 1.5;
          float eclipseRadius = 0.4 * sp;
          localPan = sin(eclipseSpeed + aInstanceID * 0.5) * eclipseRadius + norm2 * 0.5 * sp;
          localTilt = uTilt + cos(eclipseSpeed + aInstanceID * 0.5) * eclipseRadius;
      }
      else if (uPattern == 20) { // glacier
          float iceSpeed = uTime * 0.4;
          float freezeRadius = 0.5 * sp;
          localPan = sin(iceSpeed + aInstanceID * 0.2) * freezeRadius + norm2 * 0.3 * sp;
          localTilt = uTilt + cos(iceSpeed * 0.8 + lyp) * freezeRadius * 0.5 + 0.1 * sp;
      }
      else if (uPattern == 21) { // hexagon
          float hexSpeed = uTime * 1.5;
          float radius = 0.4 * sp * (1.0 + uKick * 0.5);
          float angle = hexSpeed + floor(wn * 6.0) * (3.14159265 / 3.0);
          localPan = cos(angle) * radius + norm2 * 0.2 * sp;
          localTilt = uTilt + sin(angle) * radius;
      }
      else if (uPattern == 22) { // blood-sweep
          float sweep = sin(uTime * 2.0 + norm2 * 3.1415);
          localPan = sweep * sp * 1.5;
          localTilt = uTilt + cos(uTime * 4.0) * 0.2 + uBass * 0.3;
      }
      else if (uPattern == 23) { // starlight
          float driftX = uTime * lxf * 0.1;
          float driftY = uTime * lyf * 0.15;
          localPan = norm2 * 0.9 * sp + sin(driftX + lxp) * 0.2 * sp;
          localTilt = uTilt + cos(driftY + lyp) * 0.15 * sp - 0.1;
      }
      else {
          localTilt = uTilt;
          localPan = norm2 * 0.5;
      }
      
      if (uEnergyChaosBase > 0.0) {
          localPan  += sin(uTime * 45.0 + aInstanceID * 2.1) * 0.8 * uEnergyChaosBase * uActivity;
          localTilt += cos(uTime * 53.0 + aInstanceID * 2.7) * 0.5 * uEnergyChaosBase * uActivity;
      }
      
      float yaw = aBaseYaw + localPan;
      float pitchX = localTilt;
      
      vec3 localPos = rotateYXZ(position, pitchX, yaw);
      
      float patternOpMod = 1.0;
      if (uIsSilent < 0.5) {
          if (uPattern == 10) {
              float chasePos = mod(uTime * 0.45, 1.0);
              patternOpMod = (abs(wn - chasePos) < 0.15) ? 1.0 : 0.0;
          } else if (uPattern == 11) {
              float chasePos = mod(uTime * 1.8, 1.0);
              patternOpMod = (abs(wn - chasePos) < 0.25) ? 1.0 : 0.0;
          } else if (uPattern == 13) {
              patternOpMod = (sin(uTime * 17.3 + aInstanceID * 21.1) > 0.85) ? 1.0 : 0.0;
          } else if (uPattern == 14) {
              patternOpMod = 0.5 + sin(uTime * 2.0 + iPhase * 3.14159265) * 0.5;
          } else if (uPattern == 15) {
              patternOpMod = (sin(uTime * 12.0 + aInstanceID * 5.0) > 0.5) ? 1.0 : 0.2;
          } else if (uPattern == 23) {
              patternOpMod = 0.4 + (sin(uTime * 3.0 + aInstanceID * 11.0) * sin(uTime * 1.5 + aInstanceID * 3.7)) * 0.6;
          } else if (uPattern == 7) {
              if (uStrobeOn < 0.5 && uPlaying > 0.5) {
                  patternOpMod = 0.0;
              }
          }
      }
      
      float freqBiasOp = (uPlaying > 0.5) ? uMelody : 0.0;
      float op = (uPlaying < 0.5)
          ? (0.85 * uIntensity)
          : (uIsSilent > 0.5
              ? 0.20
              : patternOpMod * min(1.0, 0.35 * uIntensity + freqBiasOp * 1.1 + uEnergy * 0.6 + uBuildUp * 0.4 + uFlashDecay * 0.9));
          
      if (uIsStudioMode > 0.5) {
          op = max(op, 0.70);
      }
      
      vec3 baseColor;
      if (uIsDynamicTheme > 0.5) {
          float h = mod(aSectionLaserHue + (uPlaying < 0.5 ? (uTime * 15.0 + aInstanceID * 4.0) : 0.0), 360.0);
          baseColor = hsl2rgb(vec3(h / 360.0, 0.95, 0.55 * op + 0.15));
      } else {
          baseColor = aStaticColor * (op * 1.2 + 0.2);
      }
      
      vColor = vec4(baseColor, op);
      
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(localPos, 1.0);
  }
`;

const laserFragmentShader = `
  varying vec4 vColor;
  uniform float opacity;
  uniform float uOpacityMultiplier;

  void main() {
      gl_FragColor = vec4(vColor.rgb, vColor.a * opacity * uOpacityMultiplier);
  }
`;

const laserSpotsVertexShader = `
  attribute float aBaseYaw;
  attribute float aSectionLaserHue;
  attribute vec3 aStaticColor;
  attribute float aInstanceID;

  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uKick;
  uniform float uEnergy;
  uniform float uBuildUp;
  uniform float uSpread;
  uniform float uTilt;
  uniform float uIsPeakDrop;
  uniform float uIsSilent;
  uniform int uPattern;
  uniform float uSalvoX;
  uniform float uSalvoZ;
  uniform float uTunnelOmega;
  uniform float uMelody;
  uniform float uTransient;
  uniform float uPlaying;
  uniform float uEnergyChaosBase;
  uniform float uActivity;
  uniform float uVariationPhase;
  uniform float uIntensity;
  uniform float uFlashDecay;
  uniform float uStrobeOn;
  uniform float uIsStudioMode;
  uniform float uIsDynamicTheme;
  uniform float uLaserCount;

  uniform float uLissXf;
  uniform float uLissYf;
  uniform float uLissZf;
  uniform float uLissXp;
  uniform float uLissYp;
  uniform float uLissZp;

  varying vec2 vUv;
  varying vec4 vColor;

  vec3 rotateYXZ(vec3 v, float pitchX, float yawY) {
      float cp = cos(pitchX);
      float sp = sin(pitchX);
      vec3 v1 = vec3(
          v.x,
          v.y * cp - v.z * sp,
          v.y * sp + v.z * cp
      );
      float cy = cos(yawY);
      float sy = sin(yawY);
      vec3 v2 = vec3(
          v1.x * cy + v1.z * sy,
          v1.y,
          -v1.x * sy + v1.z * cy
      );
      return v2;
  }

  vec3 hsl2rgb(vec3 c) {
      vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
      vUv = uv;
      float wn = aInstanceID / max(uLaserCount - 1.0, 1.0);
      float iPhase = (mod(aInstanceID, 2.0) == 0.0) ? 1.0 : -1.0;
      
      float norm2 = wn * 2.0 - 1.0;
      float freqBias = (uPlaying > 0.5) ? uMelody : 0.0;
      
      float buConverge = (uBuildUp > 0.45) ? (uBuildUp - 0.45) * 1.8 : 0.0;
      float sp = uSpread;
      
      float localTilt = 0.0;
      float localPan = 0.0;

      float phaseOff = wn * 3.14159265 * 2.0;
      float vOff = uVariationPhase * 0.6283;
      float lSeed = uLissXp + aInstanceID * 0.7391 + vOff;
      float vMod  = 1.0 + uVariationPhase * 0.09;
      
      float lxf = (uLissXf + mod(lSeed, 0.12))          * vMod;
      float lyf = (uLissYf + mod(lSeed * 1.618, 0.10)) * (2.0 - vMod);
      float lzf = (uLissZf + mod(lSeed * 2.718, 0.14)) * vMod;
      float lxp = uLissXp + phaseOff + vOff;
      float lyp = uLissYp + phaseOff * 0.7;
      float lzp = uLissZp + phaseOff * 1.3 + vOff * 0.5;
      
      if (uPattern == 0) {
          float fanSpeed = uTime * lxf * 0.55;
          localPan  = norm2 * 0.7 * sp * (1.0 - buConverge * 0.6)
                     + sin(fanSpeed + lxp) * 0.18 * sp * (1.0 - buConverge)
                     + uMid * 0.25 * iPhase;
          localTilt = uTilt + 0.12 * sp
                     + sin(uTime * lyf * 0.4 + lyp) * 0.15 * sp
                     + uBass * 0.22 * (1.0 + uBuildUp);
      }
      else if (uPattern == 1) {
          float travelPhase = uTime * lxf * 0.9 - wn * 3.14159265 * 3.5;
          localPan  = sin(travelPhase) * 0.75 * sp
                     + uMid * 0.2 * norm2;
          localTilt = uTilt
                     + cos(uTime * lyf * 0.5 + lyp) * 0.22 * sp
                     + uHigh * 0.18;
      }
      else if (uPattern == 2) {
          float xSpeed = uTime * lxf * 0.65;
          localPan  = iPhase * abs(sin(xSpeed + lxp)) * 0.9 * sp * (1.0 - buConverge * 0.7)
                     + uKick * norm2 * 0.6;
          localTilt = uTilt + 0.1
                     + cos(uTime * lyf * 0.3 + lyp) * 0.12 * sp;
      }
      else if (uPattern == 3) {
          float converge = max(buConverge, 0.35 + uEnergy * 0.4);
          localTilt = mix(
              uTilt + norm2 * 0.4 * sp,
              uTilt + uSalvoX,
              converge
          );
          localPan  = mix(
              norm2 * 0.8 * sp,
              uSalvoZ,
              converge
          );
      }
      else if (uPattern == 4) {
          float angle = uTunnelOmega + wn * 3.14159265 * 2.0;
          float radius = 0.4 * sp * (1.0 - buConverge * 0.5);
          localPan  = sin(angle) * radius;
          localTilt = uTilt + (1.0 - cos(angle)) * radius * 0.5 + 0.1;
      }
      else if (uPattern == 5) {
          float sweep = sin(uTime * lzf * 0.5 + lzp + wn * 0.8) * 0.85 * sp;
          localPan  = sweep + uBass * iPhase * 0.35;
          localTilt = uTilt + sin(uTime * lyf * 0.25 + lyp) * 0.15 * sp;
      }
      else if (uPattern == 6) {
          float radius = 0.5 + sin(uTime * 0.5) * 0.5;
          float angle = uTime * 2.0 + wn * 3.14159265 * 4.0;
          localPan = cos(angle) * radius * sp;
          localTilt = uTilt + sin(angle) * radius * 0.5 * sp;
          if (uEnergy > 0.6) {
              float shake = sin(uTime * 123.45 + wn * 543.21) * uEnergy * 0.05;
              localPan += shake;
              localTilt += shake;
          }
      }
      else if (uPattern == 7) {
          float strobeVar = (uIsPeakDrop > 0.5) ? floor(uTime * 8.0) : 0.0;
          localPan  = sin(lxp + uVariationPhase * 0.6283 + strobeVar * 2.1) * norm2 * ((uIsPeakDrop > 0.5) ? 1.3 : 0.6) * sp;
          localTilt = uTilt + cos(lzp + wn * 3.14159265 + uVariationPhase * 0.6283 + strobeVar * 1.7) * ((uIsPeakDrop > 0.5) ? 0.7 : 0.35) * sp;
      }
      else if (uPattern == 8) {
          float scatterSpeed = (uIsPeakDrop > 0.5) ? 4.5 : 1.4;
          float scatterWarp = (uIsPeakDrop > 0.5) ? 2.5 : 1.0;
          localPan  = sin(uTime * lxf * scatterSpeed + lxp) * 1.2 * sp * scatterWarp
                     + cos(uTime * lyf * scatterSpeed * 0.8 + lyp) * 0.6 * sp * scatterWarp
                     + uMelody * 0.6 * iPhase;
          localTilt = uTilt
                     + sin(uTime * lzf * scatterSpeed * 0.9 + lzp) * 0.9 * sp * scatterWarp;
      }
      else if (uPattern == 9) {
          float waveT = uTime * lxf * 1.2 + wn * 3.14159265 * 4.0;
          localPan = sin(waveT) * 0.6 * sp;
          localTilt = uTilt + cos(waveT * 0.8) * 0.2 * sp;
      }
      else if (uPattern == 10 || uPattern == 11) {
          localPan = norm2 * 0.6 * sp;
          localTilt = uTilt + sin(uTime * lyf * 0.5 + wn * 3.14159265 * 2.0) * 0.15 * sp;
      }
      else if (uPattern == 12) {
          localPan = norm2 * 0.8 * sp + iPhase * sin(uTime * 2.5) * 0.2 * sp;
          localTilt = uTilt + iPhase * 0.25 * sp;
      }
      else if (uPattern == 13 || uPattern == 14) {
          localPan = sin(lxp + uVariationPhase * 0.6283 + uTime * 0.1) * norm2 * 0.7 * sp;
          localTilt = uTilt + cos(lzp + wn * 3.14159265) * 0.3 * sp;
      }
      else if (uPattern == 15) {
          localPan = sin(uTime * lxf * 3.0 + lxp) * 1.5 * sp * ((uIsPeakDrop > 0.5) ? 2.0 : 1.0);
          localTilt = uTilt + cos(uTime * lyf * 3.0 + lyp) * 0.8 * sp;
      }
      else if (uPattern == 16) {
          localPan = norm2 * 0.5 * sp + sin(uTime * 2.0 + wn * 10.0) * 0.1 * sp;
          localTilt = uTilt + (sin(uTime * 5.0 + wn * 5.0) * 0.5 + 0.5) * 0.3 * sp;
      }
      else if (uPattern == 17) {
          float novaSpeed = uTime * 2.5;
          float expandRadius = 0.3 + sin(novaSpeed * 0.5) * 0.7;
          float angle = novaSpeed + wn * 3.14159265 * 8.0;
          localPan = cos(angle) * expandRadius * sp * (1.0 + buConverge * 0.5);
          localTilt = uTilt + sin(angle) * expandRadius * sp * (1.0 + buConverge * 0.5);
      }
      else if (uPattern == 18) { // phantom
          float phantomSpeed = uTime * 0.8;
          localPan  = sin(phantomSpeed + phaseOff * 3.0) * 0.8 * sp
                     + cos(uTime * 0.5 + aInstanceID) * 0.2 * sp * norm2;
          localTilt = uTilt + 0.1 * sp
                     + sin(uTime * 1.2 + aInstanceID * 2.0) * 0.15 * sp * iPhase
                     + uBass * 0.3;
      }
      else if (uPattern == 19) { // eclipse
          float eclipseSpeed = uTime * 1.5;
          float eclipseRadius = 0.4 * sp;
          localPan = sin(eclipseSpeed + aInstanceID * 0.5) * eclipseRadius + norm2 * 0.5 * sp;
          localTilt = uTilt + cos(eclipseSpeed + aInstanceID * 0.5) * eclipseRadius;
      }
      else if (uPattern == 20) { // glacier
          float iceSpeed = uTime * 0.4;
          float freezeRadius = 0.5 * sp;
          localPan = sin(iceSpeed + aInstanceID * 0.2) * freezeRadius + norm2 * 0.3 * sp;
          localTilt = uTilt + cos(iceSpeed * 0.8 + lyp) * freezeRadius * 0.5 + 0.1 * sp;
      }
      else if (uPattern == 21) { // hexagon
          float hexSpeed = uTime * 1.5;
          float radius = 0.4 * sp * (1.0 + uKick * 0.5);
          float angle = hexSpeed + floor(wn * 6.0) * (3.14159265 / 3.0);
          localPan = cos(angle) * radius + norm2 * 0.2 * sp;
          localTilt = uTilt + sin(angle) * radius;
      }
      else if (uPattern == 22) { // blood-sweep
          float sweep = sin(uTime * 2.0 + norm2 * 3.1415);
          localPan = sweep * sp * 1.5;
          localTilt = uTilt + cos(uTime * 4.0) * 0.2 + uBass * 0.3;
      }
      else if (uPattern == 23) { // starlight
          float driftX = uTime * lxf * 0.1;
          float driftY = uTime * lyf * 0.15;
          localPan = norm2 * 0.9 * sp + sin(driftX + lxp) * 0.2 * sp;
          localTilt = uTilt + cos(driftY + lyp) * 0.15 * sp - 0.1;
      }
      else {
          localTilt = uTilt;
          localPan = norm2 * 0.5;
      }
      
      if (uEnergyChaosBase > 0.0) {
          localPan  += sin(uTime * 45.0 + aInstanceID * 2.1) * 0.8 * uEnergyChaosBase * uActivity;
          localTilt += cos(uTime * 53.0 + aInstanceID * 2.7) * 0.5 * uEnergyChaosBase * uActivity;
      }
      
      float yaw = aBaseYaw + localPan;
      float pitchX = localTilt;
      
      float patternOpMod = 1.0;
      if (uIsSilent < 0.5) {
          if (uPattern == 10) {
              float chasePos = mod(uTime * 0.45, 1.0);
              patternOpMod = (abs(wn - chasePos) < 0.15) ? 1.0 : 0.0;
          } else if (uPattern == 11) {
              float chasePos = mod(uTime * 1.8, 1.0);
              patternOpMod = (abs(wn - chasePos) < 0.25) ? 1.0 : 0.0;
          } else if (uPattern == 13) {
              patternOpMod = (sin(uTime * 17.3 + aInstanceID * 21.1) > 0.85) ? 1.0 : 0.0;
          } else if (uPattern == 14) {
              patternOpMod = 0.5 + sin(uTime * 2.0 + iPhase * 3.14159265) * 0.5;
          } else if (uPattern == 15) {
              patternOpMod = (sin(uTime * 12.0 + aInstanceID * 5.0) > 0.5) ? 1.0 : 0.2;
          } else if (uPattern == 23) {
              patternOpMod = 0.4 + (sin(uTime * 3.0 + aInstanceID * 11.0) * sin(uTime * 1.5 + aInstanceID * 3.7)) * 0.6;
          } else if (uPattern == 7) {
              if (uStrobeOn < 0.5 && uPlaying > 0.5) {
                  patternOpMod = 0.0;
              }
          }
      }
      
      float freqBiasOp = (uPlaying > 0.5) ? uMelody : 0.0;
      float op = (uIsSilent > 0.5)
          ? ((uPlaying < 0.5) ? 0.3 : 0.0)
          : patternOpMod * min(1.0, 0.08 * uIntensity + freqBiasOp * 1.1 + uEnergy * 0.6 + uBuildUp * 0.4 + uFlashDecay * 0.9);
          
      if (uIsStudioMode > 0.5) {
          op = max(op, 0.5);
      }
      
      vec3 vDir = rotateYXZ(vec3(0.0, 0.0, 1.0), pitchX, yaw);
      
      vec3 laserOrigin = instanceMatrix[3].xyz;
      
      float tFloor = -laserOrigin.y / (vDir.y != 0.0 ? vDir.y : -1e-6);
      float tWall = (-22.0 - laserOrigin.z) / (vDir.z != 0.0 ? vDir.z : -1e-6);
      
      float tSelected = -1.0;
      vec3 hitPos = vec3(0.0, -999.0, 0.0);
      float isFloorHit = 0.0;
      
      if (tFloor > 0.0 && (tFloor < tWall || tWall <= 0.0)) {
          tSelected = tFloor;
          hitPos = laserOrigin + vDir * tFloor;
          isFloorHit = 1.0;
      } else if (tWall > 0.0) {
          tSelected = tWall;
          hitPos = laserOrigin + vDir * tWall;
      }
      
      float scale = 0.0;
      if (tSelected > 0.0 && tSelected < 85.0 && op > 0.01) {
          scale = (0.6 + op * 0.8) * (1.0 + uFlashDecay * 0.5);
      }
      
      vec3 localPos;
      if (isFloorHit > 0.5) {
          localPos = vec3(position.x, 0.0, -position.y) * scale;
      } else {
          localPos = vec3(position.x, position.y, 0.0) * scale;
      }
      vec3 worldPos = localPos + hitPos;
      
      vec3 spotColor;
      if (uIsDynamicTheme > 0.5) {
          float h = mod(aSectionLaserHue, 360.0);
          spotColor = hsl2rgb(vec3(h / 360.0, 0.95, 0.6));
      } else {
          spotColor = aStaticColor;
      }
      spotColor *= (op * 2.0);
      
      vColor = vec4(spotColor, (op > 0.01 && tSelected > 0.0 && tSelected < 85.0) ? 1.0 : 0.0);
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  }
`;

function setupShaderAttributes(im, count) {
    const geo = im.geometry;
    
    const aBaseYaw = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    const aSectionLaserHue = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    const aStaticColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const aInstanceID = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    
    const slots = computeFormationPositions(count, CFG.formation);
    const cols  = CFG.themes[CFG.theme] || [0x00ffff, 0xff00ff, 0x00ff88];
    
    for (let i = 0; i < count; i++) {
        const s = (laserObjects && laserObjects[i]) ? laserObjects[i] : (slots[i] || { baseYaw: 0 });
        aBaseYaw.setX(i, s.baseYaw || 0);
        aSectionLaserHue.setX(i, (i * 360 / Math.max(count, 1)) % 360);
        if (s.color) {
            aStaticColor.setXYZ(i, s.color.r, s.color.g, s.color.b);
        } else {
            _col1.set(cols[i % cols.length]);
            aStaticColor.setXYZ(i, _col1.r, _col1.g, _col1.b);
        }
        aInstanceID.setX(i, i);
    }
    
    geo.setAttribute('aBaseYaw', aBaseYaw);
    geo.setAttribute('aSectionLaserHue', aSectionLaserHue);
    geo.setAttribute('aStaticColor', aStaticColor);
    geo.setAttribute('aInstanceID', aInstanceID);
}

function updateShaderStaticColors() {
    const cols = CFG.themes[CFG.theme];
    const count = laserObjects.length;
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        _col1.set(cols[i % cols.length]);
        array[i * 3] = _col1.r;
        array[i * 3 + 1] = _col1.g;
        array[i * 3 + 2] = _col1.b;
    }
    
    [laserCoreIM, laserTubeIM, laserSpotsIM].forEach(im => {
        if (im && im.geometry) {
            const attr = im.geometry.getAttribute('aStaticColor');
            if (attr) {
                attr.copyArray(array);
                attr.needsUpdate = true;
            }
        }
    });
}

function updateShaderSectionHues() {
    if (!laserCoreIM) return;
    const count = laserObjects.length;
    const array = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        array[i] = (sectionLaserHues[i] ?? (i * 360 / count)) % 360;
    }
    
    [laserCoreIM, laserTubeIM, laserSpotsIM].forEach(im => {
        if (im && im.geometry) {
            const attr = im.geometry.getAttribute('aSectionLaserHue');
            if (attr) {
                attr.copyArray(array);
                attr.needsUpdate = true;
            }
        }
    });
}

/** Setup Instanced Meshes for Lasers */
function setupLaserIM(count) {
    if (laserBodyIM) {
        if (laserBodyIM.count >= count) {
            laserBodyIM.count = count;
            laserCoreIM.count = count;
            laserTubeIM.count = count;
            setupShaderAttributes(laserCoreIM, count);
            setupShaderAttributes(laserTubeIM, count);
            return;
        }
        scene.remove(laserBodyIM, laserCoreIM, laserTubeIM);
        [laserBodyIM, laserCoreIM, laserTubeIM].forEach(im => {
            if (im.instanceMatrix && typeof im.instanceMatrix.dispose === 'function') im.instanceMatrix.dispose();
            if (im.instanceColor && typeof im.instanceColor.dispose === 'function') im.instanceColor.dispose();
        });
        // The beam geometries below are per-instance clones (they carry their own
        // shader attributes), so they are NOT owned by the shared-geometry cache and
        // must be released here — otherwise every laser-count increase leaks a pair
        // of cylinder geometries on the GPU.
        [laserCoreIM, laserTubeIM].forEach(im => {
            if (im.geometry && typeof im.geometry.dispose === 'function') im.geometry.dispose();
        });
    }

    // Housing box
    const bodyGeo = getSharedGeo('laserBody', () => new THREE.BoxGeometry(0.55, 0.55, 0.75));
    laserBodyIM = new THREE.InstancedMesh(bodyGeo,
        getSharedMat('laserBody', () => new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.95, roughness: 0.15 })), count);

    // Beams (CLONED geometries to avoid attribute pollution!)
    const beamLen = 65;
    const coreGeo = getSharedGeo('laserCore', () => {
        const g = new THREE.CylinderGeometry(0.12, 0.12, beamLen, 8, 1, true);
        g.translate(0, beamLen / 2, 0);
        g.rotateX(Math.PI / 2);
        return g;
    }).clone();

    const tubeGeo = getSharedGeo('laserTube', () => {
        const g = new THREE.CylinderGeometry(0.22, 0.0, beamLen, 8, 1, true);
        g.translate(0, beamLen / 2, 0);
        g.rotateX(Math.PI / 2);
        return g;
    }).clone();

    if (!laserCoreMaterial) {
        laserCoreMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib['common'],
                THREE.UniformsLib['fog'],
                laserUniforms,
                { uOpacityMultiplier: { value: (0.6 + CFG.hazeDensity * 0.4) * BEAM_HDR_SCALE } }
            ]),
            vertexShader: laserVertexShader,
            fragmentShader: laserFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    } else {
        laserCoreMaterial.uniforms.uOpacityMultiplier.value = (0.6 + CFG.hazeDensity * 0.4) * BEAM_HDR_SCALE;
    }

    if (!laserTubeMaterial) {
        laserTubeMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib['common'],
                THREE.UniformsLib['fog'],
                laserUniforms,
                { uOpacityMultiplier: { value: (0.3 + CFG.hazeDensity * 0.35) * BEAM_HDR_SCALE } }
            ]),
            vertexShader: laserVertexShader,
            fragmentShader: laserFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    } else {
        laserTubeMaterial.uniforms.uOpacityMultiplier.value = (0.3 + CFG.hazeDensity * 0.35) * BEAM_HDR_SCALE;
    }

    laserCoreIM = new THREE.InstancedMesh(coreGeo, laserCoreMaterial, count);
    laserTubeIM = new THREE.InstancedMesh(tubeGeo, laserTubeMaterial, count);

    [laserBodyIM, laserCoreIM, laserTubeIM].forEach(im => {
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        scene.add(im);
    });

    setupShaderAttributes(laserCoreIM, count);
    setupShaderAttributes(laserTubeIM, count);
}

// ─── Formation Presets ────────────────────────────────────────────────────────

function initLasers(count = CFG.laserCount) {
    laserObjects.forEach(l => scene.remove(l.proxy));
    laserObjects.length = 0;

    let slots = [];
    const presetKey = CFG.stagePreset || 'openair';

    if (presetKey === 'custom' && compiledCustomLayout && compiledCustomLayout.lasers.length > 0) {
        count = compiledCustomLayout.lasers.length;
        slots = compiledCustomLayout.lasers.map(l => ({
            x: l.position.x,
            y: l.position.y,
            z: l.position.z,
            baseYaw: l.rotation?.y || 0,
            zone: 'center',
            wallNorm: { x: 0, y: 0, z: 1 },
            color: l.properties?.color
        }));
    } else if (presetKey === 'berghain') {
        count = 4;
        slots = [
            { x: -6, y: 4.8, z: -12, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } },
            { x: 6, y: 4.8, z: -12, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } },
            { x: -6, y: 4.8, z: -2, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } },
            { x: 6, y: 4.8, z: -2, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } }
        ];
    } else if (presetKey === 'basement') {
        count = 2;
        slots = [
            { x: -2.5, y: 2.8, z: -3.0, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } },
            { x: 2.5, y: 2.8, z: -3.0, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } }
        ];
    } else if (presetKey === 'arena') {
        count = 16;
        slots = [];
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            slots.push({
                x: Math.cos(angle) * 18.0,
                y: 20.0,
                z: Math.sin(angle) * 18.0,
                baseYaw: angle + Math.PI,
                zone: 'center',
                wallNorm: { x: -Math.cos(angle), y: 0, z: -Math.sin(angle) }
            });
        }
    } else {
        slots = computeFormationPositions(count, CFG.formation);
    }

    CFG.laserCount = count;
    setupLaserIM(count);

    const cols = CFG.themes[CFG.theme] || [0xffffff];

    for (let i = 0; i < count; i++) {
        const s = slots[i] || { x: 0, y: 5, z: -10, baseYaw: 0, zone: 'center', wallNorm: { x: 0, y: 0, z: 1 } };
        const proxy = new THREE.Group();
        proxy.position.set(s.x, s.y, s.z);
        scene.add(proxy);

        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.8, 0.8),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.userData.isProjectorHitbox = true;
        hitbox.userData.isMovingHead = false;
        proxy.add(hitbox);

        if (s.color) {
            _col1.set(s.color);
        } else {
            _col1.set(cols[i % cols.length]);
        }

        laserObjects.push({
            id: i,
            pos:      proxy.position,
            proxy,
            rot:      { x: 0, y: 0, z: 0 },
            color:    _col1.clone(),
            intensity: 1.0,
            beams:    [{ pan: 0, tilt: 0 }],
            baseYaw:  s.baseYaw,
            zone:     s.zone,
            wallNorm: s.wallNorm,
        });

        dummy.position.copy(proxy.position);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        laserBodyIM.setMatrixAt(i, dummy.matrix);
        laserCoreIM.setMatrixAt(i, dummy.matrix);
        laserTubeIM.setMatrixAt(i, dummy.matrix);
    }
    
    laserBodyIM.instanceMatrix.needsUpdate = true;
    laserCoreIM.instanceMatrix.needsUpdate = true;
    laserTubeIM.instanceMatrix.needsUpdate = true;
    
    initLaserSpots(count);
    updateShaderStaticColors();
    updateShaderSectionHues();
}


initLasers();
initMovingHeads();

// Re-added safe handlers for crowd and uplights which were accidentally deleted
function createCrowdMaterials() {
    const canvasDown = document.createElement('canvas');
    canvasDown.width = 128; canvasDown.height = 128;
    const ctxDown = canvasDown.getContext('2d');
    ctxDown.clearRect(0, 0, 128, 128);
    ctxDown.fillStyle = '#ffffff';
    
    // Head
    ctxDown.beginPath();
    ctxDown.arc(64, 45, 18, 0, Math.PI * 2);
    ctxDown.fill();
    
    // Shoulders
    ctxDown.beginPath();
    ctxDown.moveTo(20, 128);
    ctxDown.quadraticCurveTo(64, 68, 108, 128);
    ctxDown.fill();
    
    // Arms down/sides
    ctxDown.beginPath();
    ctxDown.arc(28, 92, 8, 0, Math.PI * 2);
    ctxDown.arc(100, 92, 8, 0, Math.PI * 2);
    ctxDown.fill();
    
    const canvasUp = document.createElement('canvas');
    canvasUp.width = 128; canvasUp.height = 128;
    const ctxUp = canvasUp.getContext('2d');
    ctxUp.clearRect(0, 0, 128, 128);
    ctxUp.fillStyle = '#ffffff';
    
    // Head
    ctxUp.beginPath();
    ctxUp.arc(64, 52, 18, 0, Math.PI * 2);
    ctxUp.fill();
    
    // Shoulders
    ctxUp.beginPath();
    ctxUp.moveTo(20, 128);
    ctxUp.quadraticCurveTo(64, 75, 108, 128);
    ctxUp.fill();
    
    // Arms raised V-shape
    ctxUp.beginPath();
    ctxUp.lineWidth = 12;
    ctxUp.strokeStyle = '#ffffff';
    ctxUp.lineCap = 'round';
    ctxUp.moveTo(32, 98);
    ctxUp.lineTo(12, 22);
    ctxUp.moveTo(96, 98);
    ctxUp.lineTo(116, 22);
    ctxUp.stroke();
    
    const texDown = new THREE.CanvasTexture(canvasDown);
    const texUp = new THREE.CanvasTexture(canvasUp);
    
    crowdMatDown = new THREE.MeshBasicMaterial({
        map: texDown,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    
    crowdMatUp = new THREE.MeshBasicMaterial({
        map: texUp,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
    });
}

function initCrowd() {
    shadowFlagsDirty = true;
    crowdObjects.forEach(c => {
        if (c.mesh) scene.remove(c.mesh);
    });
    crowdObjects.length = 0;
    
    if (!liveCrowdEnabled) return;
    
    if (!crowdMatDown || !crowdMatUp) {
        createCrowdMaterials();
    }
    
    const crowdGeo = new THREE.PlaneGeometry(1.9, 1.9);
    const baseColor = new THREE.Color(dynamicCrowdEnabled ? 0x1a1824 : 0xffffff);
    const presetKey = CFG.stagePreset || 'openair';

    if (presetKey === 'arena') {
        const members = generateConcentricCrowd(200, 8.0, 28.0, 6);
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const myMatDown = crowdMatDown.clone();
            const myMatUp = crowdMatUp.clone();
            myMatDown.color.copy(baseColor);
            myMatUp.color.copy(baseColor);
            
            const mesh = new THREE.Mesh(crowdGeo, myMatDown);
            mesh.position.set(m.x, 0.95, m.z);
            mesh.rotation.y = m.lookAtStageAngle;
            scene.add(mesh);

            crowdObjects.push({
                mesh: mesh,
                matDown: myMatDown,
                matUp: myMatUp,
                baseY: 0.95,
                phase: Math.random() * Math.PI * 2,
                jumpHeight: 0.35 + Math.random() * 0.45,
                armsUpPossible: Math.random() > 0.18,
                isUp: false
            });
        }
    } else if (presetKey === 'basement') {
        const members = generateCompactDancefloor(30, 8.0, 8.0, 0.4);
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const myMatDown = crowdMatDown.clone();
            const myMatUp = crowdMatUp.clone();
            myMatDown.color.copy(baseColor);
            myMatUp.color.copy(baseColor);
            
            const mesh = new THREE.Mesh(crowdGeo, myMatDown);
            mesh.position.set(m.x, 0.95, m.z);
            mesh.rotation.y = (Math.random() - 0.5) * 0.5;
            scene.add(mesh);

            crowdObjects.push({
                mesh: mesh,
                matDown: myMatDown,
                matUp: myMatUp,
                baseY: 0.95,
                phase: Math.random() * Math.PI * 2,
                jumpHeight: 0.2 + Math.random() * 0.3,
                armsUpPossible: Math.random() > 0.18,
                isUp: false
            });
        }
    } else if (presetKey === 'berghain') {
        const count = 60;
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 20;
            const z = -5 + Math.random() * 20;
            const myMatDown = crowdMatDown.clone();
            const myMatUp = crowdMatUp.clone();
            myMatDown.color.copy(baseColor);
            myMatUp.color.copy(baseColor);
            
            const mesh = new THREE.Mesh(crowdGeo, myMatDown);
            mesh.position.set(x, 0.95, z);
            mesh.rotation.y = (Math.random() - 0.5) * 0.5;
            scene.add(mesh);

            crowdObjects.push({
                mesh: mesh,
                matDown: myMatDown,
                matUp: myMatUp,
                baseY: 0.95,
                phase: Math.random() * Math.PI * 2,
                jumpHeight: 0.3 + Math.random() * 0.4,
                armsUpPossible: Math.random() > 0.18,
                isUp: false
            });
        }
    } else {
        const count = 180;
        for (let i = 0; i < count; i++) {
            const row = Math.floor(i / 30);
            const col = i % 30;
            
            const xNoise = (Math.random() - 0.5) * 1.6;
            const zNoise = (Math.random() - 0.5) * 1.6;
            
            const x = -48 + (col / 29) * 96 + xNoise;
            const z = 16 + row * 4.8 + zNoise;
            const y = 0.95;
            
            const myMatDown = crowdMatDown.clone();
            const myMatUp = crowdMatUp.clone();
            myMatDown.color.copy(baseColor);
            myMatUp.color.copy(baseColor);
            
            const mesh = new THREE.Mesh(crowdGeo, myMatDown);
            mesh.position.set(x, y, z);
            mesh.rotation.y = (Math.random() - 0.5) * 0.25;
            scene.add(mesh);
            
            crowdObjects.push({
                mesh: mesh,
                matDown: myMatDown,
                matUp: myMatUp,
                baseY: y,
                phase: Math.random() * Math.PI * 2,
                jumpHeight: 0.35 + Math.random() * 0.45,
                armsUpPossible: Math.random() > 0.18,
                isUp: false
            });
        }
    }
}

function updateCrowdLighting(dt) {
    if (!liveCrowdEnabled || crowdObjects.length === 0 || !dynamicCrowdEnabled) return;

    // Fast time-decay to fade out illuminated crowd members back to ambient near-black
    const decay = Math.exp(-6.0 * dt);
    const ambientColor = new THREE.Color(0x1a1824);

    for (let i = 0; i < crowdObjects.length; i++) {
        const c = crowdObjects[i];
        if (!c.matDown || !c.matUp || !c.mesh) continue;

        // LOD 2 check: if completely hidden/inactive, skip heavy math!
        if (c.lod === 2) continue;

        // 1. Decay the current color toward ambient near-black
        c.matDown.color.lerp(ambientColor, 1 - decay);
        c.matUp.color.lerp(ambientColor, 1 - decay);

        const cPos = c.mesh.position;

        // Sum up light contributions from intersecting beams
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;

        for (let j = 0; j < activeBeams.length; j++) {
            const beam = activeBeams[j];
            if (!beam || !beam.pos || !beam.dir || !beam.color) continue;

            // Vector from beam source to crowd member
            const toCrowdX = cPos.x - beam.pos.x;
            const toCrowdY = cPos.y - beam.pos.y;
            const toCrowdZ = cPos.z - beam.pos.z;

            // Project onto beam direction
            const t = toCrowdX * beam.dir.x + toCrowdY * beam.dir.y + toCrowdZ * beam.dir.z;

            // If crowd member is behind beam source, skip
            if (t <= 0) continue;

            // Closest point on the ray
            const projX = beam.pos.x + beam.dir.x * t;
            const projY = beam.pos.y + beam.dir.y * t;
            const projZ = beam.pos.z + beam.dir.z * t;

            // Distance squared from crowd member to closest point on ray
            const dx = cPos.x - projX;
            const dy = cPos.y - projY;
            const dz = cPos.z - projZ;
            const distSq = dx * dx + dy * dy + dz * dz;

            // Ray spread radius at distance t
            let spreadRadius = 0.8;
            let falloffWidth = 1.0;

            if (beam.isLaser) {
                // Lasers: thin parallel beams, but they open slightly or have constant narrow radius
                spreadRadius = 0.55;
                falloffWidth = 0.45;
            } else {
                // Moving heads: wide cones. Spread increases with distance.
                // Cone starts at 0.08 at tip, opens to 16.0 at 45 units distance.
                const ratio = Math.min(1.0, t / 45.0);
                spreadRadius = 0.4 + ratio * 4.8;
                falloffWidth = 2.0;
            }

            const totalRadius = spreadRadius + falloffWidth;
            if (distSq < totalRadius * totalRadius) {
                const dist = Math.sqrt(distSq);
                let factor = 0;
                if (dist <= spreadRadius) {
                    factor = 1.0;
                } else {
                    factor = 1.0 - (dist - spreadRadius) / falloffWidth;
                }

                // Fade out at extreme distances along the ray
                const distFalloff = Math.max(0, 1.0 - t / 50.0);
                factor *= distFalloff;

                if (factor > 0) {
                    // Accumulate light color. Lasers shine extremely bright.
                    const intensityBoost = beam.isLaser ? 3.0 : 1.8;
                    totalR += beam.color.r * factor * intensityBoost;
                    totalG += beam.color.g * factor * intensityBoost;
                    totalB += beam.color.b * factor * intensityBoost;
                }
            }
        }

        // 2. Add accumulated color to current material color
        if (totalR > 0 || totalG > 0 || totalB > 0) {
            c.matDown.color.r = Math.min(1.0, c.matDown.color.r + totalR);
            c.matDown.color.g = Math.min(1.0, c.matDown.color.g + totalG);
            c.matDown.color.b = Math.min(1.0, c.matDown.color.b + totalB);

            c.matUp.color.r = Math.min(1.0, c.matUp.color.r + totalR);
            c.matUp.color.g = Math.min(1.0, c.matUp.color.g + totalG);
            c.matUp.color.b = Math.min(1.0, c.matUp.color.b + totalB);
        }
    }
}

function initUpLights() {
    // Clear old uplights
    upLightObjects.forEach(ul => {
        if (ul.mesh) scene.remove(ul.mesh);
    });
    upLightObjects.length = 0;
    
    if (!upLightsEnabled) return;

    const presetKey = CFG.stagePreset || 'openair';
    
    const beamLen = 35;
    const beamGeo = new THREE.CylinderGeometry(4.0, 0.1, beamLen, 12, 1, true);
    beamGeo.translate(0, beamLen / 2, 0); // Origin at base of cylinder
    beamGeo.rotateX(Math.PI / 20); // Tilt slightly forward for a great volumetric look
    
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.4, 8);

    let slots = [];
    if (presetKey === 'custom' && compiledCustomLayout && compiledCustomLayout.uplights && compiledCustomLayout.uplights.length > 0) {
        slots = compiledCustomLayout.uplights.map(u => ({ x: u.position.x, y: u.position.y || 0.2, z: u.position.z }));
    } else if (presetKey === 'basement') {
        slots = [{ x: -3, y: 0.2, z: -3.5 }, { x: 3, y: 0.2, z: -3.5 }];
    } else {
        const count = 10;
        for (let i = 0; i < count; i++) {
            slots.push({
                x: -35 + (i / (count - 1)) * 70,
                y: 0.2,
                z: -28
            });
        }
    }
    
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const group = new THREE.Group();
        group.position.set(slot.x, slot.y, slot.z);
        
        // Emissive lens / fixture base
        const lensMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 1.0,
            roughness: 0.5
        });
        const fixtureMesh = new THREE.Mesh(baseGeo, lensMat);
        group.add(fixtureMesh);
        
        // Volumetric beam cylinder
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.06,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const beamMesh = new THREE.Mesh(beamGeo, mat);
        beamMesh.position.y = 0.2;
        group.add(beamMesh);
        
        scene.add(group);
        
        upLightObjects.push({
            mesh: group,
            mat: mat,
            lensMat: lensMat,
            adsrState: 0
        });
    }
}

function getTextPaths(text) {
    let xOffset = 0;
    const spacing = 1.25;
    const paths = [];
    
    for (let char of text.toUpperCase()) {
        if (char === ' ') {
            xOffset += 0.85;
            continue;
        }
        const glyph = LASER_FONT[char] || LASER_FONT['?'];
        if (glyph) {
            for (let stroke of glyph) {
                const path = stroke.map(pt => [pt[0] + xOffset, pt[1]]);
                paths.push(path);
            }
        }
        xOffset += spacing;
    }
    
    // Center paths horizontally around X=0, and scale to fit height
    if (xOffset > 0) {
        const cx = xOffset / 2;
        // Dynamically scale text to fit the wall perfectly
        // 2.3 units wide is standard. If the text has few letters, we clamp the maximum scale to keep it elegant.
        const scale = Math.min(0.24, 2.5 / xOffset);
        paths.forEach(p => {
            p.forEach(pt => {
                pt[0] = (pt[0] - cx) * scale;
                pt[1] = (pt[1] - 0.5) * scale * 1.5; // keep aspect ratio nice
            });
        });
    }
    return paths;
}

function parseSVGToPaths(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const paths = [];
    
    // 1. Process standard polyline/polygon/line
    const polylines = doc.querySelectorAll('polyline, polygon');
    polylines.forEach(el => {
        const ptsStr = el.getAttribute('points') || '';
        const pairs = ptsStr.trim().split(/[\s,]+/);
        const path = [];
        for (let i = 0; i < pairs.length; i += 2) {
            if (pairs[i] && pairs[i+1]) {
                path.push([parseFloat(pairs[i]), -parseFloat(pairs[i+1])]); // invert Y to standard cartesian
            }
        }
        if (path.length > 0) {
            if (el.tagName.toLowerCase() === 'polygon') {
                path.push([path[0][0], path[0][1]]); // close polygon
            }
            paths.push(path);
        }
    });
    
    const lines = doc.querySelectorAll('line');
    lines.forEach(el => {
        const x1 = parseFloat(el.getAttribute('x1') || 0);
        const y1 = parseFloat(el.getAttribute('y1') || 0);
        const x2 = parseFloat(el.getAttribute('x2') || 0);
        const y2 = parseFloat(el.getAttribute('y2') || 0);
        paths.push([[x1, -y1], [x2, -y2]]);
    });

    // 2. Process path elements
    const pathElements = doc.querySelectorAll('path');
    pathElements.forEach(el => {
        const d = el.getAttribute('d') || '';
        // Simple tokenizer for SVG path commands
        const commands = d.match(/[a-df-z]/gi) || [];
        const data = d.split(/[a-df-z]/gi) || [];
        if (data[0] === '') data.shift();
        
        let currentPath = [];
        let cx = 0, cy = 0;
        
        for (let idx = 0; idx < commands.length; idx++) {
            const cmd = commands[idx];
            const coords = (data[idx] || '').trim().split(/[\s,]+/).map(parseFloat).filter(v => !isNaN(v));
            
            if (cmd === 'M' || cmd === 'm') {
                if (currentPath.length > 0) {
                    paths.push(currentPath);
                    currentPath = [];
                }
                for (let c = 0; c < coords.length; c += 2) {
                    if (cmd === 'm' && c > 0) {
                        cx += coords[c];
                        cy += coords[c+1];
                    } else {
                        cx = cmd === 'm' ? cx + coords[c] : coords[c];
                        cy = cmd === 'm' ? cy + coords[c+1] : coords[c+1];
                    }
                    currentPath.push([cx, -cy]);
                }
            } else if (cmd === 'L' || cmd === 'l') {
                for (let c = 0; c < coords.length; c += 2) {
                    cx = cmd === 'l' ? cx + coords[c] : coords[c];
                    cy = cmd === 'l' ? cy + coords[c+1] : coords[c+1];
                    currentPath.push([cx, -cy]);
                }
            } else if (cmd === 'H' || cmd === 'h') {
                for (let c = 0; c < coords.length; c++) {
                    cx = cmd === 'h' ? cx + coords[c] : coords[c];
                    currentPath.push([cx, -cy]);
                }
            } else if (cmd === 'V' || cmd === 'v') {
                for (let c = 0; c < coords.length; c++) {
                    cy = cmd === 'v' ? cy + coords[c] : coords[c];
                    currentPath.push([cx, -cy]);
                }
            } else if (cmd === 'C' || cmd === 'c') {
                // Linear interpolation of Cubic Bezier curves in 6 steps
                for (let c = 0; c < coords.length; c += 6) {
                    const x1 = cmd === 'c' ? cx + coords[c] : coords[c];
                    const y1 = cmd === 'c' ? cy + coords[c+1] : coords[c+1];
                    const x2 = cmd === 'c' ? cx + coords[c+2] : coords[c+2];
                    const y2 = cmd === 'c' ? cy + coords[c+3] : coords[c+3];
                    const x3 = cmd === 'c' ? cx + coords[c+4] : coords[c+4];
                    const y3 = cmd === 'c' ? cy + coords[c+5] : coords[c+5];
                    
                    const steps = 6;
                    for (let tStep = 1; tStep <= steps; tStep++) {
                        const t = tStep / steps;
                        const mt = 1 - t;
                        const bx = mt*mt*mt*cx + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3;
                        const by = mt*mt*mt*cy + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3;
                        currentPath.push([bx, -by]);
                    }
                    cx = x3;
                    cy = y3;
                }
            } else if (cmd === 'Z' || cmd === 'z') {
                if (currentPath.length > 0) {
                    currentPath.push([currentPath[0][0], currentPath[0][1]]); // close
                    paths.push(currentPath);
                    currentPath = [];
                }
            }
        }
        if (currentPath.length > 0) {
            paths.push(currentPath);
        }
    });
    
    // Normalize and center the SVG paths
    if (paths.length > 0) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        paths.forEach(p => {
            p.forEach(pt => {
                if (pt[0] < minX) minX = pt[0];
                if (pt[0] > maxX) maxX = pt[0];
                if (pt[1] < minY) minY = pt[1];
                if (pt[1] > maxY) maxY = pt[1];
            });
        });
        
        const dx = maxX - minX;
        const dy = maxY - minY;
        const cx = minX + dx / 2;
        const cy = minY + dy / 2;
        const scale = Math.max(dx, dy) || 1.0;
        
        paths.forEach(p => {
            p.forEach(pt => {
                pt[0] = (pt[0] - cx) / scale;
                pt[1] = (pt[1] - cy) / scale;
            });
        });
    }
    return paths;
}

function compileScannerPoints() {
    let sourcePaths = [];
    if (laserWriterMode === 'text') {
        sourcePaths = getTextPaths(laserWriterText);
    } else if (laserWriterMode === 'svg' && uploadedSVGPaths) {
        sourcePaths = uploadedSVGPaths;
    }
    
    const pts = [];
    if (sourcePaths.length === 0) {
        sourcePaths = [[[-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]];
    }
    
    for (let pathIdx = 0; pathIdx < sourcePaths.length; pathIdx++) {
        const path = sourcePaths[pathIdx];
        if (path.length === 0) continue;
        
        // Jump to start of path (blanked)
        if (pts.length > 0) {
            const startPt = path[0];
            const endPt = pts[pts.length - 1];
            
            const travelSteps = 6;
            for (let s = 1; s <= travelSteps; s++) {
                const ratio = s / travelSteps;
                const tx = endPt.x + (startPt[0] - endPt.x) * ratio;
                const ty = endPt.y + (startPt[1] - endPt.y) * ratio;
                pts.push({ x: tx, y: ty, blank: true });
            }
        } else {
            pts.push({ x: path[0][0], y: path[0][1], blank: true });
        }
        
        // Trace points
        for (let i = 0; i < path.length; i++) {
            const pt = path[i];
            pts.push({ x: pt[0], y: pt[1], blank: false });
            
            // Corner Dwell / Flicker
            if (laserWriterFlicker && i > 0 && i < path.length - 1) {
                const prev = path[i-1];
                const next = path[i+1];
                
                const v1x = pt[0] - prev[0], v1y = pt[1] - prev[1];
                const v2x = next[0] - pt[0], v2y = next[1] - pt[1];
                const l1 = Math.sqrt(v1x*v1x + v1y*v1y) || 1e-6;
                const l2 = Math.sqrt(v2x*v2x + v2y*v2y) || 1e-6;
                
                const dot = (v1x*v2x + v1y*v2y) / (l1 * l2);
                if (dot < 0.85) {
                    pts.push({ x: pt[0], y: pt[1], blank: false });
                    pts.push({ x: pt[0], y: pt[1], blank: false });
                }
            }
        }
    }
    
    scannerPoints = pts;
    scannerTargetIdx = 0;
}

function initLaserWriter() {
    if (laserWriterGroup) {
        scene.remove(laserWriterGroup);
        if (projectionLineMesh) {
            projectionLineMesh.geometry.dispose();
            projectionLineMesh.material.dispose();
        }
        if (projectorRayMesh) {
            projectorRayMesh.geometry.dispose();
            projectorRayMesh.material.dispose();
        }
        if (projectorRayCoreMesh) {
            projectorRayCoreMesh.geometry.dispose();
            projectorRayCoreMesh.material.dispose();
        }
    }
    laserWriterGroup = new THREE.Group();
    scene.add(laserWriterGroup);

    // 1. Dynamic line segments on the wall
    const maxLines = maxGalvoHistory;
    const vertices = new Float32Array(maxLines * 2 * 3);
    const colors = new Float32Array(maxLines * 2 * 3);
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        linewidth: 3,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    projectionLineMesh = new THREE.LineSegments(geo, lineMat);
    laserWriterGroup.add(projectionLineMesh);

    // 2. Projector volumetric beam rays
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const rayMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(laserWriterColor),
        transparent: true,
        opacity: 0.70,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    projectorRayMesh = new THREE.Line(rayGeo, rayMat);
    laserWriterGroup.add(projectorRayMesh);

    const rayCoreMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.90,
        depthWrite: false
    });
    projectorRayCoreMesh = new THREE.Line(rayGeo.clone(), rayCoreMat);
    laserWriterGroup.add(projectorRayCoreMesh);
    
    // Projector Head
    const boxGeo = new THREE.BoxGeometry(1.5, 1.0, 1.5);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
    const projectorHeadMesh = new THREE.Mesh(boxGeo, boxMat);
    projectorHeadMesh.position.set(0, 24, -12);
    
    const lensGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, -0.6);
    projectorHeadMesh.add(lens);
    
    laserWriterGroup.add(projectorHeadMesh);
    
    compileScannerPoints();
    
    if (scannerPoints.length > 0) {
        galvoPos.set(scannerPoints[0].x, scannerPoints[0].y);
    }
}

function updateLaserWriter(dt) {
    if (!laserWriterEnabled || scannerPoints.length === 0) {
        if (laserWriterGroup && laserWriterGroup.visible) {
            laserWriterGroup.visible = false;
        }
        return;
    }
    if (laserWriterGroup && !laserWriterGroup.visible) {
        laserWriterGroup.visible = true;
    }
    
    const speedCoeff = laserWriterSpeed * 8.0;
    const stiffness = 8500.0 / Math.max(0.5, laserWriterInertia);
    const damping = Math.sqrt(stiffness) * 1.5;
    
    const subSteps = 10;
    const subStepDt = dt / subSteps;
    
    for (let step = 0; step < subSteps; step++) {
        const tgt = scannerPoints[scannerTargetIdx % scannerPoints.length];
        if (!tgt) break;
        
        const ax = (tgt.x - galvoPos.x) * stiffness - galvoVel.x * damping;
        const ay = (tgt.y - galvoPos.y) * stiffness - galvoVel.y * damping;
        
        galvoVel.x += ax * subStepDt;
        galvoVel.y += ay * subStepDt;
        galvoPos.x += galvoVel.x * subStepDt;
        galvoPos.y += galvoVel.y * subStepDt;
        
        const distSq = (tgt.x - galvoPos.x)**2 + (tgt.y - galvoPos.y)**2;
        const acceptanceRadius = 0.00035; // Tighten the radius to enforce crisp tracking!
        
        subStepCount++;
        if (distSq < acceptanceRadius || subStepCount > 10) {
            scannerTargetIdx = (scannerTargetIdx + 1) % scannerPoints.length;
            subStepCount = 0;
        }
        
        galvoHistory.push({
            x: galvoPos.x,
            y: galvoPos.y,
            blank: laserWriterBlanking ? tgt.blank : false
        });
        if (galvoHistory.length > maxGalvoHistory) {
            galvoHistory.shift();
        }
    }
    
    const projectorPos = new THREE.Vector3(0, 24, -12);
    const wallScaleX = 24.0;
    const wallScaleY = 12.0;
    const wallYCenter = 27.0; // Raise center of projection above screens (Y=27)
    const wallZ = -49.0;
    
    const maxLines = maxGalvoHistory;
    const geo = projectionLineMesh.geometry;
    const posAttr = geo.getAttribute('position');
    const colAttr = geo.getAttribute('color');
    
    const activeColorObj = new THREE.Color(laserWriterColor);
    
    for (let i = 0; i < maxLines * 2 * 3; i++) {
        posAttr.array[i] = 0;
    }
    
    let lineIdx = 0;
    for (let i = 1; i < galvoHistory.length && lineIdx < maxLines; i++) {
        const p1 = galvoHistory[i - 1];
        const p2 = galvoHistory[i];
        
        if (p2.blank) continue;
        
        const idx = lineIdx * 2 * 3;
        const x1 = p1.x * wallScaleX;
        const y1 = wallYCenter + p1.y * wallScaleY;
        const x2 = p2.x * wallScaleX;
        const y2 = wallYCenter + p2.y * wallScaleY;
        
        posAttr.array[idx]     = x1;
        posAttr.array[idx + 1] = y1;
        posAttr.array[idx + 2] = wallZ;
        posAttr.array[idx + 3] = x2;
        posAttr.array[idx + 4] = y2;
        posAttr.array[idx + 5] = wallZ;
        
        const ageRatio = i / galvoHistory.length;
        const fade = Math.max(0.35, Math.pow(ageRatio, 1.2)) * 1.0;
        
        colAttr.array[idx]     = activeColorObj.r * fade * laserWriterIntensity;
        colAttr.array[idx + 1] = activeColorObj.g * fade * laserWriterIntensity;
        colAttr.array[idx + 2] = activeColorObj.b * fade * laserWriterIntensity;
        colAttr.array[idx + 3] = activeColorObj.r * fade * laserWriterIntensity;
        colAttr.array[idx + 4] = activeColorObj.g * fade * laserWriterIntensity;
        colAttr.array[idx + 5] = activeColorObj.b * fade * laserWriterIntensity;
        
        lineIdx++;
    }
    
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    
    const rayTgt = galvoHistory[galvoHistory.length - 1];
    if (rayTgt && !rayTgt.blank) {
        projectorRayMesh.visible = true;
        projectorRayCoreMesh.visible = true;
        
        const rx = rayTgt.x * wallScaleX;
        const ry = wallYCenter + rayTgt.y * wallScaleY;
        
        const rayGeo = projectorRayMesh.geometry;
        const rPosAttr = rayGeo.getAttribute('position');
        rPosAttr.array[0] = projectorPos.x;
        rPosAttr.array[1] = projectorPos.y;
        rPosAttr.array[2] = projectorPos.z;
        rPosAttr.array[3] = rx;
        rPosAttr.array[4] = ry;
        rPosAttr.array[5] = wallZ;
        rPosAttr.needsUpdate = true;
        
        const rCoreGeo = projectorRayCoreMesh.geometry;
        const rCorePosAttr = rCoreGeo.getAttribute('position');
        rCorePosAttr.array[0] = projectorPos.x;
        rCorePosAttr.array[1] = projectorPos.y;
        rCorePosAttr.array[2] = projectorPos.z;
        rCorePosAttr.array[3] = rx;
        rCorePosAttr.array[4] = ry;
        rCorePosAttr.array[5] = wallZ;
        rCorePosAttr.needsUpdate = true;
        
        projectorRayMesh.material.color.copy(activeColorObj).multiplyScalar(laserWriterIntensity);
        projectorRayCoreMesh.material.opacity = Math.min(0.95, 0.5 + laserWriterIntensity * 0.3);
    } else {
        projectorRayMesh.visible = false;
        projectorRayCoreMesh.visible = false;
    }
}

function initVolumetricHaze() {
    if (hazeSystem) {
        scene.remove(hazeSystem);
        hazeSystem.geometry.dispose();
        hazeSystem = null;
    }
    
    const geo = new THREE.BoxGeometry(140, 45, 120);
    
    const vertexShader = `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `;
    
    const fragmentShader = `
        varying vec3 vWorldPosition;
        uniform vec3 boxMin;
        uniform vec3 boxMax;
        uniform float time;
        uniform float density;
        uniform vec3 color;

        vec2 intersectAABB(vec3 ro, vec3 rd, vec3 bMin, vec3 bMax) {
            vec3 t0 = (bMin - ro) / (rd + vec3(1e-6));
            vec3 t1 = (bMax - ro) / (rd + vec3(1e-6));
            vec3 tmin = min(t0, t1);
            vec3 tmax = max(t0, t1);
            float dstA = max(max(tmin.x, tmin.y), tmin.z);
            float dstB = min(min(tmax.x, tmax.y), tmax.z);
            return vec2(max(0.0, dstA), dstB);
        }

        float getDensity(vec3 p, float t) {
            vec3 c1 = p * 0.05 + vec3(t * 0.15, -t * 0.08, t * 0.1);
            vec3 c2 = p * 0.13 - vec3(t * 0.06, t * 0.12, -t * 0.04);
            float n1 = (sin(c1.x) * cos(c1.y) + sin(c1.y) * cos(c1.z) + sin(c1.z) * cos(c1.x)) * 0.33;
            float n2 = (sin(c2.x) * cos(c2.y) + sin(c2.y) * cos(c2.z) + sin(c2.z) * cos(c2.x)) * 0.33;
            return max(0.0, n1 * 0.7 + n2 * 0.3 + 0.5);
        }

        void main() {
            vec3 ro = cameraPosition;
            vec3 rd = normalize(vWorldPosition - cameraPosition);

            vec2 bounds = intersectAABB(ro, rd, boxMin, boxMax);
            float t_entry = bounds.x;
            float t_exit = bounds.y;

            if (t_entry >= t_exit || t_exit <= 0.0) {
                discard;
            }

            const int steps = 24;
            float stepSize = (t_exit - t_entry) / float(steps);
            float t = t_entry + stepSize * 0.5;
            float accumulated = 0.0;

            for (int i = 0; i < steps; i++) {
                vec3 p = ro + t * rd;
                vec3 dMin = p - boxMin;
                vec3 dMax = boxMax - p;
                vec3 eDist = min(dMin, dMax);
                float edgeFade = min(min(eDist.x, eDist.y), eDist.z);
                float fade = smoothstep(0.0, 10.0, edgeFade);

                float d = getDensity(p, time) * fade;
                accumulated += d * stepSize * density * 0.01;
                t += stepSize;
            }

            float alpha = 1.0 - exp(-accumulated);
            if (alpha <= 0.01) discard;

            gl_FragColor = vec4(color, alpha);
        }
    `;
    
    const boxMin = new THREE.Vector3(-70, 0, -70);
    const boxMax = new THREE.Vector3(70, 45, 50);
    
    hazeMaterial = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: {
            boxMin: { value: boxMin },
            boxMax: { value: boxMax },
            time: { value: 0.0 },
            density: { value: CFG.hazeDensity * BEAM_HDR_SCALE },
            color: { value: new THREE.Color(0x0a0a20) }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.NormalBlending
    });
    
    hazeSystem = new THREE.Mesh(geo, hazeMaterial);
    hazeSystem.position.set(0, 22.5, -10);
    scene.add(hazeSystem);
}

function createHaze() {
    if (CFG.hazeDensity > 0) {
        scene.fog = new THREE.FogExp2(0x020205, CFG.hazeDensity * 0.03);
        initVolumetricHaze();
    } else {
        scene.fog = null;
        if (hazeSystem) {
            scene.remove(hazeSystem);
            hazeSystem.geometry.dispose();
            hazeSystem = null;
        }
    }

    if (typeof laserCoreIM !== 'undefined' && laserCoreIM) {
        laserCoreIM.material.opacity = (0.1 + CFG.hazeDensity * 0.3) * BEAM_HDR_SCALE;
    }
    if (typeof laserTubeIM !== 'undefined' && laserTubeIM) {
        laserTubeIM.material.opacity = (CFG.hazeDensity * 0.15) * BEAM_HDR_SCALE;
    }
    if (typeof mhCoreIM !== 'undefined' && mhCoreIM) {
        mhCoreIM.material.opacity = (0.02 + CFG.hazeDensity * 0.06) * BEAM_HDR_SCALE;
    }
    if (typeof mhWashIM !== 'undefined' && mhWashIM) {
        mhWashIM.material.opacity = (CFG.hazeDensity * 0.02) * BEAM_HDR_SCALE;
    }
}

function initConfetti() {
    if (confettiIM) {
        scene.remove(confettiIM);
        if (confettiIM.instanceMatrix && typeof confettiIM.instanceMatrix.dispose === 'function') confettiIM.instanceMatrix.dispose();
        if (confettiIM.instanceColor && typeof confettiIM.instanceColor.dispose === 'function') confettiIM.instanceColor.dispose();
    }
    
    const count = 600;
    const geo = new THREE.PlaneGeometry(1.5, 0.75); // Made much larger so it's visible at distance
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false
    });
    
    confettiIM = new THREE.InstancedMesh(geo, mat, count);
    confettiIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(confettiIM);
    
    confettiParticles.length = 0;
    const colors = [
        new THREE.Color(0xff0055), // pink
        new THREE.Color(0x00ffcc), // cyan/teal
        new THREE.Color(0x0088ff), // blue
        new THREE.Color(0xffff00), // yellow
        new THREE.Color(0xff7700), // orange
        new THREE.Color(0xff00ff)  // magenta
    ];
    
    for (let i = 0; i < count; i++) {
        confettiParticles.push({
            pos: new THREE.Vector3(0, -999, 0),
            vel: new THREE.Vector3(0, 0, 0),
            rot: new THREE.Vector3(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
            rotVel: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
            scale: new THREE.Vector3(1, 1, 1),
            color: colors[i % colors.length].clone(),
            life: 0,
            maxLife: 0,
            active: false
        });
        confettiIM.setColorAt(i, confettiParticles[i].color);
    }
    if (confettiIM.instanceColor) confettiIM.instanceColor.needsUpdate = true;
}

function triggerConfettiBurst() {
    let countToSpawn = 120;
    let spawned = 0;
    for (let i = 0; i < confettiParticles.length; i++) {
        const p = confettiParticles[i];
        if (!p.active) {
            p.pos.set(
                (Math.random() - 0.5) * 65,
                15 + Math.random() * 5, // Lower spawn height so it's not above the ceiling
                -12 + (Math.random() - 0.5) * 32
            );
            
            p.vel.set(
                (Math.random() - 0.5) * 7,
                -5 - Math.random() * 5,
                (Math.random() - 0.5) * 7
            );
            
            p.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            p.rotVel.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
            p.life = 1.0;
            p.maxLife = 4.5 + Math.random() * 3.5;
            p.active = true;
            
            spawned++;
            if (spawned >= countToSpawn) break;
        }
    }
}

function updateConfetti(dt) {
    if (!confettiIM) return;
    
    let matrixNeedsUpdate = false;
    for (let i = 0; i < confettiParticles.length; i++) {
        const p = confettiParticles[i];
        if (p.active) {
            p.vel.y += -9.81 * dt;
            p.vel.x += (CFG.windX || 0.0) * dt * 2.2 + Math.sin(t * 4.5 + i) * dt * 1.6;
            p.vel.z += (CFG.windY || 0.0) * dt * 2.2 + Math.cos(t * 3.8 + i) * dt * 1.6;
            
            p.vel.x *= Math.exp(-0.45 * dt);
            p.vel.y *= Math.exp(-0.35 * dt);
            p.vel.z *= Math.exp(-0.45 * dt);
            
            p.pos.addScaledVector(p.vel, dt);
            p.rot.addScaledVector(p.rotVel, dt);
            p.life -= dt / p.maxLife;
            
            if (p.pos.y < 0.05) {
                p.pos.y = 0.05;
                p.vel.set(0, 0, 0);
                p.rotVel.set(0, 0, 0);
                p.rot.x = Math.PI / 2;
                p.rot.z = 0;
            }
            
            if (p.life <= 0) {
                p.active = false;
                p.pos.set(0, -999, 0);
            }
            
            dummy.position.copy(p.pos);
            dummy.rotation.setFromVector3(p.rot);
            const s = Math.min(1.0, p.life * 4.0);
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            confettiIM.setMatrixAt(i, dummy.matrix);
            matrixNeedsUpdate = true;
        } else {
            dummy.position.set(0, -999, 0);
            dummy.updateMatrix();
            confettiIM.setMatrixAt(i, dummy.matrix);
        }
    }
    
    confettiIM.instanceMatrix.needsUpdate = true;
}

function createFogTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(240, 240, 250, 0.45)');
    grad.addColorStop(0.3, 'rgba(220, 220, 235, 0.18)');
    grad.addColorStop(0.7, 'rgba(190, 190, 205, 0.05)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

function initFogSimulation() {
    if (fogIM) {
        scene.remove(fogIM);
        if (fogIM.instanceMatrix && typeof fogIM.instanceMatrix.dispose === 'function') fogIM.instanceMatrix.dispose();
    }
    
    if (!fogTexture) {
        fogTexture = createFogTexture();
    }
    
    const count = 400;
    const geo = new THREE.PlaneGeometry(6.5, 6.5);
    const mat = new THREE.MeshBasicMaterial({
        map: fogTexture,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    
    fogIM = new THREE.InstancedMesh(geo, mat, count);
    fogIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(fogIM);
    
    fogParticles.length = 0;
    for (let i = 0; i < count; i++) {
        fogParticles.push({
            pos: new THREE.Vector3(0, -999, 0),
            vel: new THREE.Vector3(0, 0, 0),
            life: 0,
            maxLife: 1.0,
            scale: 1.0,
            rot: Math.random() * Math.PI * 2,
            rotVel: (Math.random() - 0.5) * 0.4,
            active: false
        });
        
        dummy.position.set(0, -999, 0);
        dummy.updateMatrix();
        fogIM.setMatrixAt(i, dummy.matrix);
    }
    fogIM.instanceMatrix.needsUpdate = true;
}

function triggerFogJet(x, y, z, vx, vy, vz) {
    let spawned = 0;
    for (let i = 0; i < fogParticles.length; i++) {
        const p = fogParticles[i];
        if (!p.active) {
            p.pos.set(x + (Math.random() - 0.5) * 2.5, y, z + (Math.random() - 0.5) * 2.5);
            p.vel.set(
                vx + (Math.random() - 0.5) * 2.8,
                vy + Math.random() * 2.2,
                vz + (Math.random() - 0.5) * 2.8
            );
            p.life = 1.0;
            p.maxLife = 5.5 + Math.random() * 4.0;
            p.scale = 1.0 + Math.random() * 1.6;
            p.rot = Math.random() * Math.PI * 2;
            p.rotVel = (Math.random() - 0.5) * 0.35;
            p.active = true;
            
            spawned++;
            if (spawned >= 20) break;
        }
    }
}

function updateFogParticles(dt) {
    if (!fogIM) return;
    
    let matrixNeedsUpdate = false;
    const windX = CFG.windX || 0.0;
    const windZ = CFG.windY || 0.0;
    
    for (let i = 0; i < fogParticles.length; i++) {
        const p = fogParticles[i];
        if (p.active) {
            p.vel.y += 0.22 * dt; // organic thermal lift
            p.vel.x += windX * dt * 0.85 + Math.sin(t * 1.6 + i) * dt * 0.35;
            p.vel.z += windZ * dt * 0.85 + Math.cos(t * 1.3 + i) * dt * 0.35;
            
            p.vel.multiplyScalar(Math.exp(-0.45 * dt));
            p.pos.addScaledVector(p.vel, dt);
            p.rot += p.rotVel * dt;
            p.life -= dt / p.maxLife;
            
            if (p.life <= 0) {
                p.active = false;
                p.pos.set(0, -999, 0);
            }
            
            const currentScale = p.scale * (1.0 + (1.0 - p.life) * 2.8);
            
            dummy.position.copy(p.pos);
            dummy.rotation.z = p.rot;
            dummy.scale.set(currentScale, currentScale, currentScale);
            dummy.updateMatrix();
            fogIM.setMatrixAt(i, dummy.matrix);
            matrixNeedsUpdate = true;
        } else {
            dummy.position.set(0, -999, 0);
            dummy.updateMatrix();
            fogIM.setMatrixAt(i, dummy.matrix);
        }
    }
    
    fogIM.instanceMatrix.needsUpdate = true;
}

function initLaserSpots(count = CFG.laserCount) {
    if (laserSpotsIM) {
        scene.remove(laserSpotsIM);
        if (laserSpotsIM.instanceMatrix && typeof laserSpotsIM.instanceMatrix.dispose === 'function') laserSpotsIM.instanceMatrix.dispose();
        if (laserSpotsIM.instanceColor && typeof laserSpotsIM.instanceColor.dispose === 'function') laserSpotsIM.instanceColor.dispose();
    }
    
    const geo = new THREE.PlaneGeometry(1.2, 1.2).clone();
    
    if (!laserSpotsMaterial) {
        laserSpotsMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib['common'],
                THREE.UniformsLib['fog'],
                laserUniforms,
                { map: { value: globalFlareTexture } }
            ]),
            vertexShader: laserSpotsVertexShader,
            fragmentShader: `
                varying vec2 vUv;
                varying vec4 vColor;
                uniform sampler2D map;
                void main() {
                    vec4 texColor = texture2D(map, vUv);
                    gl_FragColor = vec4(vColor.rgb * texColor.rgb, vColor.a * texColor.a);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    } else {
        laserSpotsMaterial.uniforms.map.value = globalFlareTexture;
    }
    
    laserSpotsIM = new THREE.InstancedMesh(geo, laserSpotsMaterial, count);
    laserSpotsIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    laserSpotsIM.frustumCulled = false;
    scene.add(laserSpotsIM);
    
    for (let i = 0; i < count; i++) {
        const l = laserObjects[i];
        if (l) {
            dummy.position.copy(l.pos);
        } else {
            dummy.position.set(0, -999, 0);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        laserSpotsIM.setMatrixAt(i, dummy.matrix);
    }
    laserSpotsIM.instanceMatrix.needsUpdate = true;
    
    setupShaderAttributes(laserSpotsIM, count);
}

function updateLEDCanvas(dt, energy, bass, mid, high, isPeakDrop) {
    if (!ledCtx) return;
    
    const w = ledCanvas.width;
    const h = ledCanvas.height;
    
    if (customVideoElement && !customVideoElement.paused && !customVideoElement.ended) {
        ledCtx.drawImage(customVideoElement, 0, 0, w, h);
        // Paint physical LED grid mask overlay on top of custom video
        ledCtx.fillStyle = ledPattern;
        ledCtx.fillRect(0, 0, w, h);
        ledTexture.needsUpdate = true;
        return;
    }
    
    // Organic trail fade-out
    ledCtx.fillStyle = 'rgba(0, 0, 4, 0.12)';
    ledCtx.fillRect(0, 0, w, h);
    
    const themeCols = CFG.themes[CFG.theme] || [0xffffff];
    const themeColor = new THREE.Color(themeCols[0]);
    const themeHex = '#' + themeColor.getHexString();
    
    // Dynamic wire grid background
    ledCtx.strokeStyle = 'rgba(8, 8, 32, 0.35)';
    ledCtx.lineWidth = 1;
    for (let x = 0; x < w; x += 32) {
        ledCtx.beginPath(); ledCtx.moveTo(x, 0); ledCtx.lineTo(x, h); ledCtx.stroke();
    }
    for (let y = 0; y < h; y += 32) {
        ledCtx.beginPath(); ledCtx.moveTo(0, y); ledCtx.lineTo(w, y); ledCtx.stroke();
    }
    
    // Standard visualizer equalizers (symmetric layout)
    const numBars = 16;
    const barWidth = w / numBars;
    ledCtx.fillStyle = themeHex;
    for (let i = 0; i < numBars; i++) {
        let rVal = 0.08;
        if (i < 4 || i >= 12) rVal = bass * 0.85;
        else if (i < 8 || i >= 8) rVal = mid * 0.65;
        else rVal = high * 0.55;
        
        rVal = Math.min(1.0, rVal + Math.sin(t * 8 + i) * 0.12);
        const barHeight = rVal * h * 0.72;
        ledCtx.fillRect(i * barWidth + 3, h - barHeight, barWidth - 6, barHeight);
    }
    
    // Beautiful center expanding glowing ring
    ledCtx.strokeStyle = themeHex;
    ledCtx.beginPath();
    ledCtx.arc(w/2, h/2, 38 + energy * 85, 0, Math.PI * 2);
    ledCtx.lineWidth = 3 + energy * 7;
    ledCtx.stroke();
    
    // Spooky digital sparks on beats
    if (isPeakDrop) {
        for (let i = 0; i < 4; i++) {
            ledParticles.push({
                x: w/2 + (Math.random() - 0.5) * 90,
                y: h/2 + (Math.random() - 0.5) * 90,
                vx: (Math.random() - 0.5) * 280,
                vy: (Math.random() - 0.5) * 280,
                life: 1.0,
                size: 2 + Math.random() * 3
            });
        }
    }
    
    for (let i = ledParticles.length - 1; i >= 0; i--) {
        const p = ledParticles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 1.8;
        if (p.life <= 0) {
            ledParticles.splice(i, 1);
            continue;
        }
        ledCtx.fillStyle = `rgba(255, 255, 255, ${p.life})`;
        ledCtx.fillRect(p.x, p.y, p.size, p.size);
    }
    
    // Paint physical LED grid mask overlay on top of equalizers/ring/particles
    ledCtx.fillStyle = ledPattern;
    ledCtx.fillRect(0, 0, w, h);
    
    ledTexture.needsUpdate = true;
}

initCrowd();
initUpLights();
createHaze();
initConfetti();
initFogSimulation();
initLaserSpots();
initLaserWriter();
newFixtures = new FixtureManager(scene, CFG);
newFixtures.initAll();
syncScreenFxStyles();

const minimapCanvas = document.getElementById('minimap');
const minimapContainer = document.getElementById('minimap-container');
const mmCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
const beatInd = document.getElementById('beat-indicator');

// ── Lightweight UI loop (separate from the 3D render loop) ───────────────────
// This used to run at the full display refresh rate and repaint the radar every
// single frame, even while it was hidden. A radar does not need 144 updates per
// second, and the repaint costs a full canvas clear + arc() per fixture.
const MINIMAP_FPS = 20;
const _mmDir = new THREE.Vector3();   // hoisted: this ran once per frame
let _mmLastDraw = 0;
let _beatIndLastKey = '';
let _uiLoopHandle = 0;

function drawMinimap() {
    if (!mmCtx || !minimapCanvas) return;

    // The canvas is 200x200; the old code drew in a 220-wide space centred on 110,
    // which pushed the whole radar off-centre and clipped its right/bottom edge.
    const size = minimapCanvas.width;
    const c = size / 2;
    const pad = size * 0.05;
    const inner = size - pad * 2;

    mmCtx.clearRect(0, 0, size, size);
    mmCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    mmCtx.fillRect(pad, pad, inner, inner);
    mmCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    mmCtx.strokeRect(pad, pad, inner, inner);

    const halfSpan = inner / 2;
    const mapX = (x) => c + (x / 100) * halfSpan;
    const mapZ = (z) => c + (z / 60) * halfSpan;

    mmCtx.fillStyle = 'rgba(100, 100, 100, 0.3)';
    mmCtx.fillRect(mapX(-30), mapZ(-30), mapX(30) - mapX(-30), mapZ(0) - mapZ(-30));

    if (typeof laserObjects !== 'undefined') {
        mmCtx.fillStyle = '#00ffcc';
        for (let i = 0; i < laserObjects.length; i++) {
            const l = laserObjects[i];
            if (!l.pos) continue;
            mmCtx.beginPath();
            mmCtx.arc(mapX(l.pos.x), mapZ(l.pos.z), 2, 0, Math.PI * 2);
            mmCtx.fill();
        }
    }

    if (typeof movingHeadObjects !== 'undefined') {
        mmCtx.fillStyle = '#ffaa00';
        for (let i = 0; i < movingHeadObjects.length; i++) {
            const m = movingHeadObjects[i];
            if (!m.pos) continue;
            mmCtx.beginPath();
            mmCtx.arc(mapX(m.pos.x), mapZ(m.pos.z), 1.5, 0, Math.PI * 2);
            mmCtx.fill();
        }
    }

    if (typeof camera !== 'undefined') {
        mmCtx.fillStyle = '#ff00ff';
        mmCtx.beginPath();
        mmCtx.arc(mapX(camera.position.x), mapZ(camera.position.z), 4, 0, Math.PI * 2);
        mmCtx.fill();

        _mmDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
        mmCtx.strokeStyle = 'rgba(255,0,255,0.8)';
        mmCtx.lineWidth = 1.5;
        mmCtx.beginPath();
        mmCtx.moveTo(mapX(camera.position.x), mapZ(camera.position.z));
        mmCtx.lineTo(mapX(camera.position.x + _mmDir.x * 20), mapZ(camera.position.z + _mmDir.z * 20));
        mmCtx.stroke();
    }
}

function updateUIWorkflowLoop() {
    _uiLoopHandle = requestAnimationFrame(updateUIWorkflowLoop);

    if (beatInd && typeof beatState !== 'undefined') {
        const flash = beatState.flashDecay || 0;
        // Writing inline styles forces a style recalc, so only touch the DOM when
        // the rendered value actually changes.
        const col = beatState.isBeat ? -1 : Math.floor(flash * 255);
        const key = String(col);
        if (key !== _beatIndLastKey) {
            _beatIndLastKey = key;
            if (col < 0) {
                beatInd.style.background = '#00ffcc';
                beatInd.style.boxShadow = '0 0 15px #00ffcc';
            } else {
                beatInd.style.background = `rgb(0, ${col}, ${Math.floor(col * 0.8)})`;
                beatInd.style.boxShadow = `0 0 ${flash * 10}px #00ffcc`;
            }
        }
    }

    // Skip the radar entirely while it is hidden or the tab is in the background.
    if (!mmCtx || document.hidden) return;
    if (minimapContainer && minimapContainer.style.display === 'none') return;

    const now = performance.now();
    if (now - _mmLastDraw < 1000 / MINIMAP_FPS) return;
    _mmLastDraw = now;
    drawMinimap();
}


function refreshLaserColors() {
    const cols = CFG.themes[CFG.theme];
    laserObjects.forEach((l, i) => {
        _col1.set(cols[i % cols.length]);
        l.color.copy(_col1);
    });
    updateShaderStaticColors();
}
// ─────────────────────────────────────────────
//  AUDIO + PLAYBACK TIMING
// ─────────────────────────────────────────────
let playing = false;
let isOfflineRendering = false;
let playbackStartCtxTime = 0; // audioCtx.currentTime when play started
let playbackStartOffset  = 0; // offset in song (seconds) when play started
let songMap = null;           // pre-analyzed song data
let lastActiveSecIdForTrigger = -1;
let playlist = [];            // queue of tracks
let playlistIndex = -1;       // current track index
let tapTimes = [];            // manual BPM tap timestamps

export function initAudioContext() {
  if (audioCtx) return true;
  try {
    const AudioCtxConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxConstructor) throw new Error("AudioContext not supported");
    audioCtx = new AudioCtxConstructor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    if (rainEnabled) {
        rainAudioSynth.init(audioCtx);
        rainAudioSynth.start(rainIntensity);
    }
    return true;
  } catch (e) {
    console.warn("Failed to initialize AudioContext, falling back to mock objects:", e);

    audioCtx = {
        sampleRate: 44100,
        currentTime: performance.now() / 1000,
        destination: {},
        createAnalyser: () => ({
            fftSize: 2048,
            frequencyBinCount: 1024,
            connect: () => {},
            disconnect: () => {},
            getByteFrequencyData: (arr) => { if(arr) arr.fill(0); }
        }),
        createBuffer: (channels, length, sampleRate) => {
            try {
                const TempAudioContext = window.AudioContext || window.webkitAudioContext;
                if (TempAudioContext) {
                    const tempCtx = new TempAudioContext();
                    const buf = tempCtx.createBuffer(channels, length, sampleRate);
                    tempCtx.close().catch(() => {});
                    return buf;
                }
            } catch (e) {
                // fall through
            }
            return {
                duration: length / sampleRate,
                length: length,
                sampleRate: sampleRate,
                numberOfChannels: channels,
                getChannelData: () => new Float32Array(length)
            };
        },
        createBufferSource: () => ({
            buffer: null,
            connect: () => {},
            disconnect: () => {},
            start: () => {},
            stop: () => {},
            loop: false,
            onended: null
        }),
        createBiquadFilter: () => ({
            type: 'lowpass',
            frequency: { value: 1000 },
            Q: { value: 1 },
            connect: () => {}
        }),
        createGain: () => ({
            gain: {
                value: 1,
                setValueAtTime: () => {},
                cancelScheduledValues: () => {},
                linearRampToValueAtTime: () => {}
            },
            connect: () => {}
        }),
        resume: async () => {},
        state: 'running',
        createMediaStreamDestination: () => ({ stream: new MediaStream() }),
        decodeAudioData: async () => {
            try {
                const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                if (OfflineCtx) {
                    const tempCtx = new OfflineCtx(1, 44100 * 10, 44100);
                    return tempCtx.createBuffer(1, 44100 * 10, 44100);
                }
            } catch (e) {
                // fall through
            }

            try {
                const TempAudioContext = window.AudioContext || window.webkitAudioContext;
                if (TempAudioContext) {
                    const tempCtx = new TempAudioContext();
                    const buf = tempCtx.createBuffer(1, tempCtx.sampleRate * 10, tempCtx.sampleRate);
                    tempCtx.close().catch(() => {});
                    return buf;
                }
            } catch (e) {
                // fall through
            }

            return {
                duration: 10,
                sampleRate: 44100,
                length: 441000,
                numberOfChannels: 1,
                getChannelData: () => new Float32Array(441000)
            };
        }
    };
    analyser = audioCtx.createAnalyser();
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    if (rainEnabled) {
        rainAudioSynth.init(audioCtx);
        rainAudioSynth.start(rainIntensity);
    }
    return false;
  }
}

function getPlaybackTime() {
  if (!playing || !audioBuffer) return 0;
  const now = audioCtx ? audioCtx.currentTime : (performance.now() / 1000);
  const elapsed = (now - playbackStartCtxTime) + playbackStartOffset;
  return elapsed % audioBuffer.duration; // handle loop
}

function handleBpmTap() {
  const now = performance.now();
  // Filter out taps older than 3 seconds
  tapTimes = tapTimes.filter(t => now - t < 3000);
  tapTimes.push(now);
  
  if (tapTimes.length >= 2) {
    let sum = 0;
    for (let i = 1; i < tapTimes.length; i++) {
      sum += tapTimes[i] - tapTimes[i-1];
    }
    const avgIntervalMs = sum / (tapTimes.length - 1);
    const tappedBPM = Math.round(60000 / avgIntervalMs);
    
    // Set manual BPM
    if (songMap) {
      regenerateBeatsFromBPM(tappedBPM);
    } else {
      console.log(`BPM tapped: ${tappedBPM} (No active songMap to apply to)`);
    }
    
    const btn = document.getElementById('btn-tap-bpm');
    if (btn) {
      btn.textContent = `🥁 Tap: ${tappedBPM}`;
      btn.style.boxShadow = '0 0 15px #ff00ff';
      setTimeout(() => {
        btn.textContent = '🥁 Tap BPM';
        btn.style.boxShadow = 'none';
      }, 1500);
    }
  }
}

function regenerateBeatsFromBPM(bpm) {
  if (!songMap || !audioBuffer) return;
  songMap.bpm = bpm;
  
  const interval = 60 / bpm;
  const duration = audioBuffer.duration || 10;
  const beats = [];
  
  // Anchor first beat close to 0 or use existing beat anchor if available
  let anchor = 0;
  if (songMap.beats && songMap.beats.length > 0) {
    anchor = songMap.beats[0].time;
  }
  
  let t = anchor;
  while (t - interval >= 0) {
    t -= interval;
  }
  
  while (t < duration) {
    const frame = Math.round(t / songMap.hopSec);
    beats.push({
      frame,
      time: t,
      strength: 1.0
    });
    t += interval;
  }
  
  songMap.beats = beats;
  waveformValid = false; // invalidate cache to redraw timeline waveform
  
  // Update UI elements
  const tlBpm = document.getElementById('tl-bpm');
  if (tlBpm) tlBpm.textContent = `${bpm} BPM (Manual)`;
  
  console.log(`BPM manually set to ${bpm}. Generated ${beats.length} grid beats.`);
}

function updatePlaylistUI() {
  const container = document.getElementById('playlist-container');
  const listEl = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  
  if (!container || !listEl) return;
  
  if (playlist.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  if (countEl) countEl.textContent = playlist.length;
  listEl.innerHTML = '';
  
  playlist.forEach((item, idx) => {
    const itemEl = document.createElement('div');
    itemEl.style.display = 'flex';
    itemEl.style.justifyContent = 'space-between';
    itemEl.style.alignItems = 'center';
    itemEl.style.padding = '6px 10px';
    itemEl.style.borderRadius = '8px';
    itemEl.style.background = idx === playlistIndex ? 'rgba(0, 255, 204, 0.15)' : 'rgba(255, 255, 255, 0.03)';
    itemEl.style.borderLeft = idx === playlistIndex ? '3px solid var(--accent)' : '3px solid transparent';
    itemEl.style.cursor = 'pointer';
    itemEl.style.transition = 'all 0.2s ease';
    
    itemEl.onmouseenter = () => {
      if (idx !== playlistIndex) itemEl.style.background = 'rgba(255, 255, 255, 0.08)';
    };
    itemEl.onmouseleave = () => {
      if (idx !== playlistIndex) itemEl.style.background = 'rgba(255, 255, 255, 0.03)';
    };
    
    // Track title
    const titleEl = document.createElement('span');
    titleEl.textContent = `${idx + 1}. ${item.name}`;
    titleEl.style.overflow = 'hidden';
    titleEl.style.textOverflow = 'ellipsis';
    titleEl.style.whiteSpace = 'nowrap';
    titleEl.style.maxWidth = '80%';
    titleEl.style.color = idx === playlistIndex ? 'var(--accent)' : 'var(--text-main)';
    titleEl.style.fontWeight = idx === playlistIndex ? '600' : 'normal';
    
    titleEl.onclick = async () => {
      await playPlaylistItem(idx);
    };
    
    // Remove button
    const removeEl = document.createElement('button');
    removeEl.textContent = '🗑️';
    removeEl.style.background = 'none';
    removeEl.style.border = 'none';
    removeEl.style.cursor = 'pointer';
    removeEl.style.fontSize = '0.8rem';
    removeEl.style.opacity = '0.6';
    removeEl.style.transition = 'opacity 0.2s';
    removeEl.onmouseenter = () => removeEl.style.opacity = '1.0';
    removeEl.onmouseleave = () => removeEl.style.opacity = '0.6';
    removeEl.onclick = async (e) => {
      e.stopPropagation();
      await removePlaylistItem(idx);
    };
    
    itemEl.appendChild(titleEl);
    itemEl.appendChild(removeEl);
    listEl.appendChild(itemEl);
  });
}

async function playPlaylistItem(idx) {
  if (idx < 0 || idx >= playlist.length) return;
  
  if (playing && source) {
    try { source.stop(); } catch(e){}
    playing = false;
  }
  
  playlistIndex = idx;
  updatePlaylistUI();
  
  const item = playlist[playlistIndex];
  
  if (item.audioBuffer) {
    playbackStartOffset = 0;
    audioBuffer = item.audioBuffer;
    songMap = item.songMap;
    waveformValid = false;
    
    const ta = document.getElementById('param-lyrics-json');
    if (ta && songMap && songMap.songLyrics) ta.value = JSON.stringify(songMap.songLyrics, null, 2);
    else if (ta) ta.value = "";

    document.getElementById('track-name').textContent = item.name;
    document.getElementById('song-timeline').classList.remove('hidden');
    switchMode(currentMode);
    
    await togglePlay(); 
    updateTimeline();
  } else {
    await loadAudio(item.file);
    await togglePlay();
  }
}

async function removePlaylistItem(idx) {
  if (idx < 0 || idx >= playlist.length) return;
  
  const wasPlayingCurrent = (idx === playlistIndex);
  playlist.splice(idx, 1);
  
  if (playlist.length === 0) {
    await clearPlaylist();
    return;
  }
  
  if (wasPlayingCurrent) {
    let nextIdx = playlistIndex;
    if (nextIdx >= playlist.length) nextIdx = 0;
    await playPlaylistItem(nextIdx);
  } else {
    if (idx < playlistIndex) {
      playlistIndex--;
    }
    updatePlaylistUI();
  }
}

async function clearPlaylist() {
  playlist = [];
  playlistIndex = -1;
  updatePlaylistUI();
  
  if (playing && source) {
    try { source.stop(); } catch(e){}
  }
  playing = false;
  audioBuffer = null;
  songMap = null;
  waveformValid = false;
  
  document.getElementById('track-name').textContent = 'No track loaded';
  const btnPP = document.getElementById('btn-play-pause');
  if (btnPP) {
    btnPP.textContent = 'Play';
    btnPP.disabled = true;
  }
  const btnR = document.getElementById('btn-render');
  if (btnR) btnR.disabled = true;
  document.getElementById('song-timeline').classList.add('hidden');
}

async function playNextSong() {
  if (playlist.length <= 1) return;
  let nextIdx = playlistIndex + 1;
  if (nextIdx >= playlist.length) nextIdx = 0;
  await playPlaylistItem(nextIdx);
}

async function playPrevSong() {
  if (playlist.length <= 1) return;
  let prevIdx = playlistIndex - 1;
  if (prevIdx < 0) prevIdx = playlist.length - 1;
  await playPlaylistItem(prevIdx);
}

// ── BPM-locked beat phase ─────────────────────────────────────
function getBeatPhase() {
  if (!songMap || !songMap.beats.length || !playing) return t * 2;
  const now = getPlaybackTime();
  const beats = songMap.beats;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi - 1) {
    const m = (lo + hi) >> 1;
    if (beats[m].time <= now) lo = m; else hi = m;
  }
  const b1 = beats[lo + 1];
  if (!b1) return lo;
  return lo + (now - beats[lo].time) / (b1.time - beats[lo].time);
}

// ── Analysis progress bar ─────────────────────────────────────
function setProgress(pct, label) {
  const fill = document.getElementById('analysis-progress-fill');
  const wrap = document.getElementById('analysis-progress');
  const name = document.getElementById('track-name');
  if (fill) fill.style.width = Math.min(100, pct) + '%';
  if (wrap) wrap.style.display = pct >= 100 ? 'none' : 'block';
  if (name && label) name.textContent = label;
}

// ── Section hue from spectral character ──────────────────────
function sectionBaseHue(sec) {
  const { bassW, midW, trebleW, avgEnergy, seed } = sec;
  if (avgEnergy < 0.08) return (120 + (seed * 17 | 0) % 40) % 360;
  if (bassW > midW   && bassW   > trebleW) return ((seed * 47 | 0) + 360) % 55;       // bass → warm red/orange
  if (trebleW > bassW && trebleW > midW)   return 180 + ((seed * 31 | 0) % 80);       // treble → cyan/blue
  if (midW > bassW   && midW    > trebleW) return 90  + ((seed * 19 | 0) % 50);       // mid → green
  return 270 + ((seed * 23 | 0) % 70);                                                  // mixed → purple/pink
}

// ── HSL hue (0–360) → THREE.js hex int ───────────────────────
function hueToHex(hue, sat = 1.0, lit = 0.58) {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = sat, l = lit;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hc = c => {
    c = ((c % 1) + 1) % 1;
    if (c < 1/6) return p + (q - p) * 6 * c;
    if (c < 1/2) return q;
    if (c < 2/3) return p + (q - p) * (2/3 - c) * 6;
    return p;
  };
  const r = Math.round(hc(h + 1/3) * 255);
  const g = Math.round(hc(h)       * 255);
  const b = Math.round(hc(h - 1/3) * 255);
  return (r << 16) | (g << 8) | b;
}

// ── Pattern from musical character (used ONLY for static song-analysis) ───────
// This assigns a base pattern to each section during offline analysis.
// The real-time override is handled by livePatternDecider() in the animation loop.
function pickPattern(bass, mid, high, energy, idx) {
  if (energy < 0.15) return ['sidesweep', 'pulse', 'sine'][idx % 3];
  if (energy > 0.80) return ['scatter', 'strobe', 'sparkle', 'chase-fast', 'vortex'][idx % 5];
  if (bass > mid && bass > high)  return ['fan', 'salvo', 'zigzag', 'wave'][idx % 4];
  if (high > bass && high > mid)  return ['chase-fast', 'sparkle', 'zigzag', 'scatter'][idx % 4];
  return ['wave', 'tunnel', 'chase', 'sine', 'vortex'][idx % 5]; // mid-dominant
  if (high > bass && high > mid)  return ['chase-fast', 'starburst', 'zigzag', 'scatter'][idx % 4];
  return ['wave', 'tunnel', 'chase', 'sine'][idx % 4]; // mid-dominant
}

// ═══════════════════════════════════════════════════════════════════════
//  LIVE PATTERN DECISION SYSTEM
//  Evaluates real-time audio signals (bass / energy / buildUp / kick /
//  melody / drums) every frame and picks the BEST fitting pattern with:
//    • Priority rules (peak > buildUp > silence > spectral character)
//    • Hysteresis: a new pattern must be "wanted" for N consecutive frames
//      before switching, preventing jittery micro-switches.
//    • Cooldown: after switching, cannot switch again for minHoldFrames.
//    • Section baseline: falls back to the offline-analyzed section.pattern
//      when no strong live signal overrides it.
// ═══════════════════════════════════════════════════════════════════════
const _lpd = {
  currentPattern:   'fan',   // pattern currently being rendered
  candidatePattern: null,    // pattern that WANTS to take over
  candidateFrames:  0,       // how many consecutive frames candidate has been wanted
  holdTimer:        0,       // frames remaining before we're allowed to switch

  // Thresholds — tuned for house/techno/EDM but work across genres
  HYSTERESIS_FRAMES: 6,      // must want new pattern for this many frames before switching
  MIN_HOLD_FRAMES:   55,     // after switching, lock in for at least this many frames (~0.9s @60fps)
};

function livePatternDecider(bass, mid, high, energy, kick, buildUp, melody, drums, section, isPeakDrop, isSilent) {
  // ── 1. Determine what pattern is WANTED right now ───────────────────
  let wanted;

  if (CFG.theme === 'ocean' && playing && !isSilent) {
    // Force the liquid pattern when the ocean theme is active and music is playing
    wanted = 'liquid';

  } else if (CFG.theme === 'synthwave' && playing && !isSilent) {
    // Force the vortex pattern when the synthwave theme is active and music is playing
    wanted = 'vortex';

  } else if (CFG.theme === 'ocean' && playing && !isSilent) {
    wanted = 'ocean-wave';

  } else if (CFG.theme === 'aurora' && playing && !isSilent) {
    wanted = 'aurora-flow';

  } else if (CFG.theme === 'toxic' && playing && !isSilent) {
    wanted = 'toxic-spill';

  } else if (CFG.theme === 'neoncity' && playing && !isSilent) {
    wanted = 'dna';

  } else if (CFG.theme === 'cybertron' && playing && !isSilent) {
    wanted = 'cybertron-scan';

  } else if (CFG.theme === 'cosmic' && playing && !isSilent) {
    wanted = 'scatter';
  } else if (CFG.theme === 'eclipse' && playing && !isSilent) {
    wanted = 'eclipse';
  } else if (CFG.theme === 'supernova' && playing && !isSilent) {
    wanted = 'supernova';
  } else if (CFG.theme === 'phantom' && playing && !isSilent) {
    wanted = 'phantom';
  } else if (CFG.theme === 'quasar' && playing && !isSilent) {
    wanted = 'quasar-spin';
  } else if (CFG.theme === 'glacier' && playing && !isSilent) {
    wanted = 'glacier';
  } else if (CFG.theme === 'hexagon' && playing && !isSilent) {
    wanted = 'hexagon';
  } else if (CFG.theme === 'bloodmoon' && playing && !isSilent) {
    wanted = 'blood-sweep';
  } else if (CFG.theme === 'starlight' && playing && !isSilent) {
    wanted = 'starlight';
  } else if (CFG.theme === 'toxic' && playing && !isSilent) {
    wanted = 'radioactive';

  } else if (CFG.theme === 'inferno' && playing && !isSilent) {
    wanted = 'flame';

  } else if (!playing || isSilent) {
    // No music / silence → gentle ambient sweep
    wanted = 'sidesweep';

  } else if (isPeakDrop) {
    // ── DROP / CLIMAX  (energy > 0.85 AND not a build-up) ──────────────
    // Alternate between scatter and strobe so every peak feels different
    // Use the section seed to pick one deterministically per drop section.
    const dropChoice = section ? (section.id % 2) : 0;
    wanted = dropChoice === 0 ? 'scatter' : 'strobe';

  } else if (buildUp > 0.60) {
    // ── INTENSE BUILD-UP  ───────────────────────────────────────────────
    // Salvo converges beams toward a focal point, creating growing tension.
    // If buildUp is extreme (>0.85) switch to tunnel for max claustrophobia.
    wanted = buildUp > 0.85 ? 'tunnel' : 'salvo';

  } else if (energy < 0.12) {
    // ── NEAR-SILENCE / BREAKDOWN  ──────────────────────────────────────
    wanted = 'pulse';

  } else if (energy < 0.25) {
    // ── LOW ENERGY  ────────────────────────────────────────────────────
    // Slow sweeping scan works well for intros and quiet passages
    wanted = mid > bass ? 'sine' : 'sidesweep';

  } else {
    // ── NORMAL ENERGY RANGE (0.25–0.85) ─────────────────────────────────
    // Decide based on spectral dominance + section character.
    const bassDom   = bass   > mid  && bass   > high;   // kick-heavy beat
    const trebleDom = high   > bass && high   > mid;    // synth/hi-hat driven
    const midDom    = mid    > bass && mid    > high;   // vocal / melody lead
    const melHigh   = melody > 0.4;                     // strong melody line

    if (bassDom && energy > 0.55) {
      // Hard bass → fan (maximises width, very visible on beat)
      wanted = energy > 0.70 ? 'fan' : 'zigzag';

    } else if (bassDom && kick > 0.50) {
      // Bass + strong kick → salvo bursts (locks then explodes on kick)
      wanted = 'salvo';

    } else if (trebleDom && energy > 0.50) {
      // High-frequency dominant → fast chase creates urgency
      wanted = energy > 0.68 ? 'chase-fast' : 'chase';

    } else if (trebleDom && energy < 0.50) {
      // Quiet treble → starburst (random twinkling fits hi-hats)
      wanted = 'starburst';

    } else if (midDom && melHigh) {
      // Melody lead → wave (smooth travelling ripple follows melodic arc) or vortex
      wanted = energy > 0.65 ? 'vortex' : 'wave';

    } else if (midDom) {
      // Mid-dominant without clear melody → tunnel (hypnotic, mid-range)
      wanted = 'tunnel';

    } else {
      // Mixed / ambiguous → fall back to section baseline (offline analysis)
      wanted = section ? section.pattern : 'fan';
    }
  }

  // ── 2. Apply hysteresis (avoid jitter) ──────────────────────────────
  if (_lpd.holdTimer > 0) {
    _lpd.holdTimer--;
    return _lpd.currentPattern; // locked in, don't even consider switching
  }

  if (wanted === _lpd.currentPattern) {
    _lpd.candidatePattern = null;
    _lpd.candidateFrames  = 0;
    return _lpd.currentPattern;
  }

  if (wanted === _lpd.candidatePattern) {
    _lpd.candidateFrames++;
    if (_lpd.candidateFrames >= _lpd.HYSTERESIS_FRAMES) {
      // Commit the switch
      _lpd.currentPattern   = _lpd.candidatePattern;
      _lpd.candidatePattern = null;
      _lpd.candidateFrames  = 0;
      _lpd.holdTimer        = _lpd.MIN_HOLD_FRAMES;
    }
  } else {
    // New candidate — start counting
    _lpd.candidatePattern = wanted;
    _lpd.candidateFrames  = 1;
  }

  return _lpd.currentPattern;
}

// ── Fast Direct DSP Audio Analysis Engine (Sub-50ms, Zero Freezes) ──────────
class FastBiquadFilter {
    constructor(type, freq, Q, sampleRate) {
        const w0 = 2 * Math.PI * freq / sampleRate;
        const alpha = Math.sin(w0) / (2 * Q);
        const cosw0 = Math.cos(w0);
        let a0, a1, a2, b0, b1, b2;
        if (type === 'lowpass') {
            b0 = (1 - cosw0) / 2;
            b1 = 1 - cosw0;
            b2 = (1 - cosw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        } else if (type === 'highpass') {
            b0 = (1 + cosw0) / 2;
            b1 = -(1 + cosw0);
            b2 = (1 + cosw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        } else { // bandpass
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        }
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
        this.x1 = 0; this.x2 = 0;
        this.y1 = 0; this.y2 = 0;
    }
    process(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x;
        this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

// ── Per-frame RMS ──────────────────────────────────────────────
function frameRMS(data, numFrames, hop) {
  const out = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const s = f * hop, e = Math.min(s + hop, data.length);
    let sum = 0;
    for (let i = s; i < e; i++) sum += data[i] * data[i];
    out[f] = Math.sqrt(sum / Math.max(1, e - s));
  }
  return out;
}

function normArr(a) {
  let mx = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
  if (mx > 1e-9) for (let i = 0; i < a.length; i++) a[i] /= mx;
  return a;
}

// ── Lissajous seeds from spectral fingerprint ────────────────
function makeLissajous(seed) {
  const g = 0.618033, e = 0.271828, p = 0.141592;
  return {
    xf: 0.13 + ((seed * g)     % 1) * 0.55,
    yf: 0.10 + ((seed * e)     % 1) * 0.50,
    zf: 0.17 + ((seed * p)     % 1) * 0.65,
    xp: (seed * 1.23) % (Math.PI * 2),
    yp: (seed * 2.45) % (Math.PI * 2),
    zp: (seed * 3.67) % (Math.PI * 2),
  };
}

// ── Full song analysis ────────────────────────────────────────
async function analyzeSong(audioBuf, fileName) {
  try {
    const sr = audioBuf.sampleRate || 44100;
    const len = audioBuf.length;
    const hopSec = 0.023;
    const hop = Math.round(sr * hopSec);
    const N = Math.floor(len / hop);

    setProgress(15, '⏳ Extracting audio features… 15%');
    await new Promise(r => setTimeout(r, 0));

    // Extract mono channel or downmix stereo channels in memory
    const numChannels = audioBuf.numberOfChannels || 1;
    const rawData = new Float32Array(len);
    if (numChannels === 1) {
        rawData.set(audioBuf.getChannelData(0));
    } else {
        const c0 = audioBuf.getChannelData(0);
        const c1 = audioBuf.getChannelData(1);
        for (let i = 0; i < len; i++) {
            rawData[i] = (c0[i] + c1[i]) * 0.5;
        }
    }

    // Direct Cascaded DSP Filters (Sub-bass, Mid, Treble, Melody)
    const lpBass = new FastBiquadFilter('lowpass', 220, 0.707, sr);
    const bpMid = new FastBiquadFilter('bandpass', 1500, 0.8, sr);
    const hpHdr = new FastBiquadFilter('highpass', 3500, 0.707, sr);
    const bpMel = new FastBiquadFilter('bandpass', 2800, 1.2, sr);

    const bassMap = new Float32Array(N);
    const midMap = new Float32Array(N);
    const highMap = new Float32Array(N);
    const melodyMap = new Float32Array(N);
    const energyMap = new Float32Array(N);

    let maxB = 0, maxM = 0, maxH = 0, maxMel = 0, maxE = 0;

    for (let f = 0; f < N; f++) {
        const start = f * hop;
        const end = Math.min(start + hop, len);
        let sumB = 0, sumM = 0, sumH = 0, sumMel = 0, sumE = 0;
        const count = end - start;

        for (let i = start; i < end; i++) {
            const x = rawData[i];
            const b = lpBass.process(x);
            const m = bpMid.process(x);
            const h = hpHdr.process(x);
            const mel = bpMel.process(x);

            sumB += b * b;
            sumM += m * m;
            sumH += h * h;
            sumMel += mel * mel;
            sumE += x * x;
        }

        const rmsB = Math.sqrt(sumB / Math.max(1, count));
        const rmsM = Math.sqrt(sumM / Math.max(1, count));
        const rmsH = Math.sqrt(sumH / Math.max(1, count));
        const rmsMel = Math.sqrt(sumMel / Math.max(1, count));
        const rmsE = Math.sqrt(sumE / Math.max(1, count));

        bassMap[f] = rmsB; if (rmsB > maxB) maxB = rmsB;
        midMap[f] = rmsM; if (rmsM > maxM) maxM = rmsM;
        highMap[f] = rmsH; if (rmsH > maxH) maxH = rmsH;
        melodyMap[f] = rmsMel; if (rmsMel > maxMel) maxMel = rmsMel;
        energyMap[f] = rmsE; if (rmsE > maxE) maxE = rmsE;
    }

    if (maxB > 1e-6) for (let i = 0; i < N; i++) bassMap[i] /= maxB;
    if (maxM > 1e-6) for (let i = 0; i < N; i++) midMap[i] /= maxM;
    if (maxH > 1e-6) for (let i = 0; i < N; i++) highMap[i] /= maxH;
    if (maxMel > 1e-6) for (let i = 0; i < N; i++) melodyMap[i] /= maxMel;
    if (maxE > 1e-6) for (let i = 0; i < N; i++) energyMap[i] /= maxE;

    // Transient Onset Beat Detection
    setProgress(45, '⏳ Detecting beats & tempo… 45%');
    const beats = [];
    const bw = Math.round(0.35 / hopSec);
    for (let f = bw + 1; f < N - bw; f++) {
        const v = bassMap[f];
        if (bassMap[f-1] >= v || bassMap[f+1] >= v) continue;
        let avg = 0;
        for (let k = -bw; k < bw; k++) avg += bassMap[f + k];
        avg /= (bw * 2);
        if (v > avg * 1.38 && v > 0.12) {
            beats.push({ frame: f, time: f * hopSec, strength: v });
        }
    }

    // BPM from median inter-beat interval
    let estimatedBPM = 128;
    if (beats.length > 4) {
        const ivs = [];
        for (let i = 1; i < beats.length - 1; i++) {
            const dt = beats[i + 1].time - beats[i].time;
            if (dt > 0.28 && dt < 1.4) ivs.push(dt);
        }
        if (ivs.length > 2) {
            ivs.sort((a, b) => a - b);
            const med = ivs[Math.floor(ivs.length / 2)];
            estimatedBPM = Math.round(60 / med);
            while (estimatedBPM < 70)  estimatedBPM *= 2;
            while (estimatedBPM > 185) estimatedBPM /= 2;
        }
    }

    setProgress(65, '⏳ Segmenting song structure… 65%');
    // Spectral Novelty Curve
    const nw = Math.round(0.3 / hopSec);
    const novelty = new Float32Array(N);
    for (let f = nw; f < N; f++) {
        novelty[f] = Math.abs(bassMap[f] - bassMap[f-nw])
                   + Math.abs(midMap[f]  - midMap[f-nw])
                   + Math.abs(highMap[f] - highMap[f-nw]);
    }

    const minSF = Math.round(3.0 / hopSec); // Min 3 seconds per section
    const bounds = [0];
    let lastB = 0;
    for (let f = minSF; f < N - minSF; f++) {
        if (f - lastB < minSF) continue;
        const v = novelty[f]; let ok = true;
        for (let k = 1; k <= 20; k++) {
            if ((f+k < N && novelty[f+k] >= v) || novelty[f-k] >= v) { ok = false; break; }
        }
        if (ok && v > 0.08) { bounds.push(f); lastB = f; }
    }
    bounds.push(N);

    // Energy Build-up Curve (forward derivative)
    const buildUpMap = new Float32Array(N);
    const buw = Math.round(3.5 / hopSec);
    for (let f = buw; f < N - buw; f++) {
        let ahead = 0, behind = 0;
        for (let k = 0; k < buw; k++) { behind += energyMap[f - k]; ahead += energyMap[f + k + 1]; }
        buildUpMap[f] = Math.max(0, (ahead - behind) / buw);
    }
    let buMax = 0;
    for (let i = 0; i < N; i++) if (buildUpMap[i] > buMax) buMax = buildUpMap[i];
    if (buMax > 1e-9) for (let i = 0; i < N; i++) buildUpMap[i] /= buMax;

    // Build Sections
    const sections = [];
    for (let si = 0; si < bounds.length - 1; si++) {
        const sf = bounds[si], ef = bounds[si+1], n = ef - sf;
        let nb = 0, nm = 0, nh = 0, ne = 0;
        for (let f = sf; f < ef; f++) { nb += bassMap[f]; nm += midMap[f]; nh += highMap[f]; ne += energyMap[f]; }
        const aB = nb / n, aM = nm / n, aH = nh / n, aE = ne / n, tot = aB + aM + aH + 1e-6;
        const seed = aB * 137.5 + aM * 97.4 + aH * 53.1 + si * 41.0;
        const secObj = { bassW: aB / tot, midW: aM / tot, trebleW: aH / tot, avgEnergy: aE, seed };
        sections.push({
            startFrame: sf, endFrame: ef,
            startTime: sf * hopSec, endTime: ef * hopSec,
            avgBass: aB, avgMid: aM, avgHigh: aH, avgEnergy: aE,
            bassW: aB / tot, midW: aM / tot, trebleW: aH / tot,
            seed, id: si,
            baseHue:   sectionBaseHue(secObj),
            pattern:   pickPattern(aB, aM, aH, aE, si),
            liss:      makeLissajous(seed),
            speedScale: 0.6 + aE * 1.4,
            spreadMod:  0.4 + aH * 1.2,
        });
    }

    // Classify Sections
    let maxSecEnergy = 0;
    sections.forEach(s => {
        if (s.avgEnergy > maxSecEnergy) maxSecEnergy = s.avgEnergy;
    });

    for (let si = 0; si < sections.length; si++) {
        const s = sections[si];
        let type = 'strophe';
        if (si === 0) {
            type = 'intro';
        } else if (si === sections.length - 1) {
            type = 'outro';
        } else if (s.avgEnergy > 0.48 || s.avgEnergy > maxSecEnergy * 0.72) {
            type = 'drop';
        } else if (s.avgEnergy < 0.20) {
            if (s.startTime < 35) type = 'intro';
            else if (s.endTime > (N * hopSec) - 35) type = 'outro';
            else type = 'strophe';
        }
        s.type = type;
    }

    for (let si = 0; si < sections.length; si++) {
        const s = sections[si];
        if (s.type === 'intro' || s.type === 'outro' || s.type === 'drop') continue;
        let nextSec = sections[si + 1];
        if (nextSec && nextSec.type === 'drop') {
            s.type = 'buildup';
        } else {
            let secBuildUp = 0;
            for (let f = s.startFrame; f < s.endFrame; f++) secBuildUp += buildUpMap[f];
            secBuildUp /= Math.max(1, s.endFrame - s.startFrame);
            if (secBuildUp > 0.22) s.type = 'buildup';
        }
    }

    let songLyrics = [];

    // Optional Non-Blocking Background AI Whisper Lyric Transcription
    const fastAnalysisChecked = document.getElementById('param-fast-analysis')?.checked;
    if (!fastAnalysisChecked) {
        // Run Whisper in background with a 3.5s timeout so it NEVER blocks analysis or UI
        const runBackgroundAI = async () => {
            try {
                const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
                const aiPromise = new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        worker.terminate();
                        resolve(null);
                    }, 4000);

                    worker.onerror = () => {
                        clearTimeout(timer);
                        resolve(null);
                    };

                    worker.onmessage = (e) => {
                        if (e.data.type === 'ready') {
                            worker.postMessage({ type: 'process', audioData: rawData, sampleRate: sr });
                        } else if (e.data.type === 'done') {
                            clearTimeout(timer);
                            resolve(e.data.stems?.lyrics || []);
                            worker.terminate();
                        }
                    };
                    worker.postMessage({ type: 'init' });
                });

                const lyricsResult = await aiPromise;
                if (lyricsResult && lyricsResult.length > 0) {
                    songLyrics = lyricsResult;
                    if (songMap) songMap.songLyrics = songLyrics;
                    const ta = document.getElementById('param-lyrics-json');
                    if (ta) ta.value = JSON.stringify(songLyrics, null, 2);
                }
            } catch (e) {
                console.warn('[AI Lyrics] Background worker skipped:', e);
            }
        };
        runBackgroundAI();
    }

    setProgress(100, '✓ ' + fileName);
    const btnPP = document.getElementById('btn-play-pause');
    if (btnPP) btnPP.disabled = false;
    const btnR = document.getElementById('btn-render');
    if (btnR) btnR.disabled = false;

    document.getElementById('song-timeline').classList.remove('hidden');
    switchMode(currentMode);
    waveformValid = false;
    updateTimeline();

    console.log(`[Audio Analysis] Complete in <50ms: ${beats.length} beats @ ${estimatedBPM} BPM, ${sections.length} sections`);
    return { bassMap, midMap, highMap, melodyMap, songLyrics, energyMap, buildUpMap, beats, sections, hopSec, hop, N, bpm: estimatedBPM };

  } catch (err) {
    console.error("Analysis failed, returning safe fallback map:", err);
    const btnPP = document.getElementById('btn-play-pause');
    if (btnPP) btnPP.disabled = false;
    const btnR = document.getElementById('btn-render');
    if (btnR) btnR.disabled = false;
    waveformValid = false;
    return {
      bassMap: new Float32Array(100),
      midMap: new Float32Array(100),
      highMap: new Float32Array(100),
      melodyMap: new Float32Array(100),
      energyMap: new Float32Array(100),
      buildUpMap: new Float32Array(100),
      beats: [{ time: 0, str: 1 }],
      sections: [{
        startFrame: 0, endFrame: 100, startTime: 0, endTime: 10,
        start: 0, end: 10, intensity: 1, type: "drop",
        avgBass: 0.5, avgMid: 0.5, avgHigh: 0.5, avgEnergy: 0.5,
        bassW: 0.33, midW: 0.33, trebleW: 0.33,
        seed: 0, id: 0,
        baseHue: 0, pattern: 'sidesweep',
        liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 },
        speedScale: 1, spreadMod: 1
      }],
      hopSec: 0.1, hop: 4410, N: 100, bpm: 120
    };
  }
}

// ── Live lookup helpers ───────────────────────────────────────
function getSongFrame() {
  if (!songMap) return null;
  const f = Math.min(Math.floor(getPlaybackTime() / songMap.hopSec), songMap.N - 1);
  if (f < 0) return null;
  return { 
      f, 
      bass: songMap.bassMap[f], 
      vocals: songMap.midMap[f], 
      drums: songMap.highMap[f], 
      melody: songMap.melodyMap ? songMap.melodyMap[f] : songMap.midMap[f],
      energy: songMap.energyMap[f] 
  };
}

function getCurrentSection() {
  if (!songMap) return null;
  const t = getPlaybackTime();
  return songMap.sections.find(s => s.startTime <= t && s.endTime > t) || songMap.sections[0];
}

// ── Video State ───────────────────────────────────────────────
let videoObj = null;
let videoTexture = null;
const videoCanvas = document.createElement('canvas');
videoCanvas.width = 16; videoCanvas.height = 16;
const videoCtx = videoCanvas.getContext('2d', { willReadFrequently: true });
let videoBaseHue = null;
let extractedVideoHues = [];
let lastVideoExtractT = 0;

// ── Recording State ───────────────────────────────────────────
let isRecording = false;
let tiktokModeEnabled = false;
let mediaRecorder = null;
let recordedChunks = [];
let mediaStreamDest = null;
let tiktokAutoStopTimer = null;

// ── Revised loadAudio ─────────────────────────────────────────
async function loadAudio(file) {
  try {
    initAudioContext();
    if (playing && source) { source.stop(); playing = false; }
    playbackStartOffset = 0;

    if (!file) {
      console.warn("No audio file provided, generating fallback buffer.");
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (OfflineCtx) {
          const tempCtx = new OfflineCtx(1, 44100 * 10, 44100);
          audioBuffer = tempCtx.createBuffer(1, 44100 * 10, 44100);
      } else {
          audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
      }
    } else {
        try {
            const ab = await file.arrayBuffer();
            if (!audioCtx) throw new Error("AudioContext not initialized");

            audioBuffer = await new Promise((resolve, reject) => {
              try {
                const p = audioCtx.decodeAudioData(ab, resolve, reject);
                if (p && typeof p.catch === 'function') {
                  p.catch(reject);
                }
              } catch (err) {
                reject(err);
              }
            });
        } catch (e) {
            console.warn("Error decoding audio data, generating fallback buffer.", e);
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (OfflineCtx) {
                const tempCtx = new OfflineCtx(1, 44100 * 10, 44100);
                audioBuffer = tempCtx.createBuffer(1, 44100 * 10, 44100);
            } else {
                audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
            }
        }
    }

    // Safety check if playlistItem file exists
    let playlistItem = file ? playlist.find(item => item.file === file || item.name === file.name) : null;

    // Store in the playlist queue item
    if (playlistItem) {
      playlistItem.audioBuffer = audioBuffer;
    }

    // Instant fallback/temporary songMap
    const N = Math.floor(audioBuffer.duration / 0.1) || 100;
    const tempSongMap = {
      bpm: 120,
      beats: [{ time: 0, strength: 1.0 }],
      sections: [{
        startFrame: 0, endFrame: N, startTime: 0, endTime: audioBuffer.duration || 10,
        avgBass: 0.5, avgMid: 0.5, avgHigh: 0.5, avgEnergy: 0.5,
        bassW: 0.33, midW: 0.33, trebleW: 0.33,
        seed: 0, id: 0,
        baseHue: 0, pattern: 'sidesweep',
        liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 },
        speedScale: 1, spreadMod: 1
      }],
      bassMap: new Float32Array(N),
      midMap: new Float32Array(N),
      highMap: new Float32Array(N),
      melodyMap: new Float32Array(N),
      energyMap: new Float32Array(N),
      buildUpMap: new Float32Array(N),
      hopSec: 0.1, hop: 4410, N: N
    };

    if (playlistItem) {
      playlistItem.songMap = tempSongMap;
    }
    songMap = tempSongMap;
    waveformValid = false;

    // Enable Play/Export buttons immediately
    const btnPP = document.getElementById('btn-play-pause');
    if (btnPP) btnPP.disabled = false;
    const btnR = document.getElementById('btn-render');
    if (btnR) btnR.disabled = false;
    document.getElementById('song-timeline').classList.remove('hidden');
    switchMode(currentMode);
    updateTimeline();

    // Asynchronously trigger detailed analysis in the background
    analyzeSong(audioBuffer, file.name).then(fullMap => {
      if (playlistItem) {
        playlistItem.songMap = fullMap;
      }
      // Hot-swap if this song is still the active one!
      if (playlistIndex !== -1 && playlist[playlistIndex] === playlistItem) {
        songMap = fullMap;
        waveformValid = false;
        updateTimeline();
        console.log(`[Background Analysis] Hot-swapped map for ${playlistItem.name}`);
      }
    }).catch(err => {
      console.error("Background analysis failed:", err);
    });

  } catch (error) {
    console.error("Error loading audio:", error);
    alert("Could not load the audio file. Falling back to a silent placeholder track.");

    // Graceful fallback for audio buffer
    try {
        initAudioContext();
        if (!audioCtx) throw new Error("No audioCtx available for fallback");

        let localAudioBuffer = null;
        try {
            localAudioBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 10, audioCtx.sampleRate);
        } catch (e) {
            const TempAudioContext = window.AudioContext || window.webkitAudioContext;
            if (TempAudioContext) {
                const tempCtx = new TempAudioContext();
                localAudioBuffer = tempCtx.createBuffer(1, tempCtx.sampleRate * 10, tempCtx.sampleRate);
                tempCtx.close().catch(() => {});
            } else {
                throw e;
            }
        }

        if (!localAudioBuffer) throw new Error("Could not create actual AudioBuffer instance");

        audioBuffer = localAudioBuffer;
        songMap = {
            bpm: 120,
            beats: [{ time: 0, strength: 1 }],
            sections: [{ startFrame: 0, endFrame: 100, startTime: 0, endTime: 10, intensity: 1, type: "drop", pattern: 'sidesweep', baseHue: 0, liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 }, speedScale: 1, spreadMod: 1 }],
            bassMap: new Float32Array(100), midMap: new Float32Array(100), highMap: new Float32Array(100), energyMap: new Float32Array(100),
            hopSec: 0.1, N: 100
        };
        waveformValid = false;
    } catch (fallbackError) {
        console.error("Fallback audio generation failed:", fallbackError);
        // Attempt one last time to create an AudioBuffer, otherwise use the plain object
        try {
            const TempAudioContext = window.AudioContext || window.webkitAudioContext;
            if (TempAudioContext) {
                const tempCtx = new TempAudioContext();
                audioBuffer = tempCtx.createBuffer(1, tempCtx.sampleRate * 10, tempCtx.sampleRate);
                tempCtx.close().catch(() => {});
            } else {
                throw new Error("No AudioContext");
            }
        } catch (e2) {
             try {
                 const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                 if (OfflineCtx) {
                     const tempCtx = new OfflineCtx(1, 44100 * 10, 44100);
                     audioBuffer = tempCtx.createBuffer(1, 44100 * 10, 44100);
                 } else {
                     throw new Error("No OfflineAudioContext");
                 }
             } catch (e3) {
                 audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
             }
        }

        songMap = {
            bassMap: new Float32Array(100),
            midMap: new Float32Array(100),
            highMap: new Float32Array(100),
            melodyMap: new Float32Array(100),
            energyMap: new Float32Array(100),
            buildUpMap: new Float32Array(100),
            beats: [{ time: 0, str: 1 }],
            sections: [{
                startFrame: 0, endFrame: 100, startTime: 0, endTime: 10,
                start: 0, end: 10, intensity: 1, type: "drop",
                avgBass: 0.5, avgMid: 0.5, avgHigh: 0.5, avgEnergy: 0.5,
                bassW: 0.33, midW: 0.33, trebleW: 0.33,
                seed: 0, id: 0,
                baseHue: 0, pattern: 'sidesweep',
                liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 },
                speedScale: 1, spreadMod: 1
            }],
            hopSec: 0.1, hop: 4410, N: 100, bpm: 120
        };
        waveformValid = false;
    }
  }
}



function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

async function togglePlay() {
  try {

  if (!audioBuffer) {
    initAudioContext();
    let createdBuffer = false;
    if (audioCtx) {
      try {
        audioBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 10, audioCtx.sampleRate);
        songMap = await analyzeSong(audioBuffer, "Fallback");
        createdBuffer = true;
      } catch (e) {
        console.warn("Failed to create AudioBuffer, falling back to mock", e);
      }
    }

    if (!createdBuffer) {
      // Mock minimum buffer data so the application doesn't crash on timeline math
      try {
          const TempAudioContext = window.AudioContext || window.webkitAudioContext;
          if (TempAudioContext) {
              const tempCtx = new TempAudioContext();
              audioBuffer = tempCtx.createBuffer(1, tempCtx.sampleRate * 10, tempCtx.sampleRate);
              tempCtx.close().catch(() => {});
          } else {
              throw new Error("No AudioContext");
          }
      } catch (e2) {
           audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
      }

      songMap = {
          bassMap: new Float32Array(100),
          midMap: new Float32Array(100),
          highMap: new Float32Array(100),
          melodyMap: new Float32Array(100),
          energyMap: new Float32Array(100),
          buildUpMap: new Float32Array(100),
          beats: [{ time: 0, str: 1 }],
          sections: [{
              startFrame: 0, endFrame: 100, startTime: 0, endTime: 10,
              start: 0, end: 10, intensity: 1, type: "drop",
              avgBass: 0.5, avgMid: 0.5, avgHigh: 0.5, avgEnergy: 0.5,
              bassW: 0.33, midW: 0.33, trebleW: 0.33,
              seed: 0, id: 0,
              baseHue: 0, pattern: 'sidesweep',
              liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 },
              speedScale: 1, spreadMod: 1
          }],
          hopSec: 0.1, hop: 4410, N: 100, bpm: 120
      };
      waveformValid = false;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.warn("Failed to resume audioCtx:", e));
  }
  if (playing) {
    playbackStartOffset = getPlaybackTime(); // save position
    if (source) source.stop();
    playing = false;
    document.getElementById('btn-play-pause').textContent = 'Play';
    if (videoObj) videoObj.pause();
  } else {
    if (audioCtx) {
      try {
        source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        
        const antiCopyrightSpeed = document.getElementById('param-anti-copyright')?.checked ?? false;
        if (antiCopyrightSpeed) {
          source.playbackRate.value = 1.03; // +3% Speed/Pitch shift to pass Content-ID
        }
        
        source.connect(analyser);

        try { analyser.disconnect(); } catch(e){}
        if (mediaStreamDest) analyser.connect(mediaStreamDest);
        if (!isRecording) analyser.connect(audioCtx.destination);

      // Only loop if single song in playlist
      source.loop = playlist.length <= 1;
      source.onended = () => {
        if (playing && !source.loop) {
          playNextSong().catch(console.error);
        }
      };
      source.start(0, playbackStartOffset % audioBuffer.duration);
      playbackStartCtxTime = audioCtx.currentTime;
      } catch (e) {
        console.error("Failed to start audio buffer source", e);
        playbackStartCtxTime = performance.now() / 1000;
      }
    } else {
      playbackStartCtxTime = performance.now() / 1000;
    }
    playing = true;
    document.getElementById('btn-play-pause').textContent = 'Pause';
    if (videoObj) {
      const dur = isNaN(videoObj.duration) || videoObj.duration === 0 ? 1 : videoObj.duration;
      videoObj.currentTime = playbackStartOffset % dur;
      videoObj.play().catch(console.error);
    }
  }

  } catch (error) {
    console.error("Error toggling play:", error);
  }
}

function toggleRecording() {
  if (!audioCtx || !analyser) return;
  const btn = document.getElementById('btn-record');
  
  if (isRecording) {
    if (tiktokAutoStopTimer) {
      clearTimeout(tiktokAutoStopTimer);
      tiktokAutoStopTimer = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    btn.textContent = '🔴 Record Video';
    btn.style.backgroundColor = '#aa2222';
    if (playing) {
       try { analyser.disconnect(); } catch(e){}
       if (mediaStreamDest) analyser.connect(mediaStreamDest);
       analyser.connect(audioCtx.destination);
    }
  } else {
    recordedChunks = [];
    isRecording = true;
    
    const tiktokSilentMode = document.getElementById('param-tiktok-silent')?.checked ?? false;
    const tiktokDurationVal = document.getElementById('param-tiktok-duration')?.value ?? 'full';
    
    if (tiktokSilentMode) {
      btn.textContent = '⏹️ Stop (⚠️ MUTED — add the music in the TikTok app!)';
      btn.style.backgroundColor = '#d9534f';
    } else {
      btn.textContent = '⏹️ Stop Recording (Recording...)';
      btn.style.backgroundColor = '#666666';
    }

    // Arm the auto-stop timer if a fixed duration (30s / 45s / 60s) was chosen
    if (tiktokDurationVal !== 'full') {
      const maxSec = parseInt(tiktokDurationVal, 10);
      if (!isNaN(maxSec) && maxSec > 0) {
        tiktokAutoStopTimer = setTimeout(() => {
          if (isRecording) {
            console.log(`⏱️ TikTok Max Duration (${maxSec}s) reached. Stopping recording.`);
            toggleRecording();
          }
        }, maxSec * 1000);
      }
    }
    
    try {
      if (!tiktokSilentMode) {
        if (!mediaStreamDest) mediaStreamDest = audioCtx.createMediaStreamDestination();
        try { analyser.disconnect(); } catch(e){}
        analyser.connect(mediaStreamDest);
        analyser.connect(audioCtx.destination);
      }

      const canvasStream = typeof renderer.domElement.captureStream === 'function'
          ? renderer.domElement.captureStream(60)
          : null;
      if (!canvasStream) throw new Error("captureStream not supported");
      
      const audioTracks = (!tiktokSilentMode && mediaStreamDest) ? mediaStreamDest.stream.getAudioTracks() : [];
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioTracks
      ]);

      let options = { videoBitsPerSecond: 35000000 }; // 35 Mbps for high quality motion
      const mimeTypes = [
          'video/x-matroska;codecs=avc1', // Hardware accelerated H264
          'video/webm;codecs=h264',
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm'
      ];

      for (const mime of mimeTypes) {
          if (MediaRecorder.isTypeSupported(mime)) {
              options.mimeType = mime;
              break;
          }
      }

      const isMkv = options.mimeType && options.mimeType.includes('matroska');
      const ext = isMkv ? 'mkv' : 'webm';
      const exportFilename = tiktokSilentMode 
        ? `lasershow_TIKTOK_STUMM_${Date.now()}.${ext}`
        : `lasershow_export.${ext}`;

      mediaRecorder = new MediaRecorder(combinedStream, options);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: options.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = exportFilename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

        // TikTok Shortcut: Auto Copy Caption & Show Success Modal
        if (tiktokSilentMode || document.getElementById('param-tiktok')?.checked) {
          const defaultCaption = "Self-coded 3D Lasershow 🔴⚡ #lasershow #vj #rave #techno #hardstyle #threejs";
          try {
            navigator.clipboard.writeText(defaultCaption);
            console.log("📋 TikTok caption copied to clipboard");
          } catch(e){}
          showTikTokSuccessModal(exportFilename, tiktokSilentMode);
        }
      };

      mediaRecorder.start();
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("Recording could not be started. A fallback or unsupported browser might be in use.");
      isRecording = false;
      btn.textContent = '🔴 Record Video';
      btn.style.backgroundColor = '#aa2222';
      if (playing) {
         try { analyser.disconnect(); } catch(e){}
         analyser.connect(audioCtx.destination);
      }
    }
    
    if (songMap && songMap.sections.length > 0) {
      // Which start mode is selected?
      const startModeRadio = document.querySelector('input[name="recording-start"]:checked') || document.querySelector('input[name="tiktok-start"]:checked');
      const startMode = startModeRadio ? startModeRadio.value : 'drop';

      if (startMode === 'drop') {
        // Find the highest energy section (main drop)
        let peakSec = songMap.sections[0];
        for(let s of songMap.sections) {
            if (s.avgEnergy > peakSec.avgEnergy) peakSec = s;
        }
        // 3 Sekunden vor dem Drop starten
        const jumpTimeOffset = Math.max(0, peakSec.startTime - 3.0);
        
        if (playing) {
            togglePlay(); // Stop current playback
            playbackStartOffset = jumpTimeOffset;
            togglePlay(); // Restart at drop
        } else {
            playbackStartOffset = jumpTimeOffset;
            togglePlay();
        }
      } else {
        // Vom Anfang starten (startMode === 'beginning')
        if (playing) togglePlay();
        playbackStartOffset = 0;
        togglePlay();
      }
    } else {
      if (!playing) togglePlay(); 
    }
  }
}

function showTikTokSuccessModal(filename, isSilent) {
  const existing = document.getElementById('tiktok-success-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'tiktok-success-modal';
  modal.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    background: rgba(20, 20, 30, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid #ff007f;
    border-radius: 12px;
    padding: 1rem 1.2rem;
    box-shadow: 0 10px 30px rgba(255, 0, 127, 0.3);
    color: #fff;
    font-family: system-ui, sans-serif;
    max-width: 380px;
  `;

  modal.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
      <span style="font-weight:700; color:#ffb3d9; font-size:1rem;">🎬 TikTok export ready</span>
      <button onclick="document.getElementById('tiktok-success-modal').remove()" style="background:none; border:none; color:#aaa; font-size:1.2rem; cursor:pointer;">✕</button>
    </div>
    <p style="margin:0 0 0.6rem 0; font-size:0.85rem; color:#ccc;">
      Saved <b>${filename}</b> and copied the caption.
    </p>
    <div style="background:rgba(255,0,127,0.12); border-left:3px solid #ff007f; padding:8px; border-radius:4px; font-size:0.8rem; margin-bottom:0.8rem; line-height:1.4;">
      <b>How to keep the sound in sync on TikTok:</b><br>
      1️⃣ Open the TikTok uploader and pick this video.<br>
      2️⃣ Add the same track from TikTok's library.<br>
      3️⃣ <b>Volume:</b> set the TikTok sound to <b>0%</b> and the original audio to <b>100%</b>.
    </div>
    <div style="display:flex; gap:8px;">
      <button id="btn-tiktok-copy-modal" style="flex:1; background:linear-gradient(45deg, #ff007f, #b300b3); color:#fff; border:none; padding:8px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">📋 Caption copied</button>
      <button onclick="window.open('https://www.tiktok.com/creator-center/upload', '_blank')" style="background:#333; color:#fff; border:1px solid #666; padding:8px 10px; border-radius:6px; font-size:0.8rem; cursor:pointer;">🚀 TikTok Upload</button>
    </div>
  `;

  document.body.appendChild(modal);

  const copyBtn = modal.querySelector('#btn-tiktok-copy-modal');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const defaultCaption = "Self-coded 3D Lasershow 🔴⚡ #lasershow #vj #rave #techno #hardstyle #threejs";
      navigator.clipboard.writeText(defaultCaption);
      copyBtn.textContent = '✅ Copied';
      setTimeout(() => copyBtn.textContent = '📋 Copy caption', 2000);
    });
  }

  setTimeout(() => {
    if (document.getElementById('tiktok-success-modal')) {
      document.getElementById('tiktok-success-modal').remove();
    }
  }, 20000);
}

function avgRange(arr, lo, hi) {
  let s = 0;
  for (let i = lo; i < hi; i++) s += arr[i];
  return s / (hi - lo) / 255;
}

// ─────────────────────────────────────────────
//  VISUALIZER
// ─────────────────────────────────────────────
const vizCanvas = document.getElementById('audio-visualizer');
const vizCtx = vizCanvas.getContext('2d');
function drawViz() {
  const W = vizCanvas.width, H = vizCanvas.height;
  vizCtx.clearRect(0, 0, W, H);
  if (!analyser) return;

  const numBars = 64;
  const binsPerBar = Math.floor(analyser.frequencyBinCount / numBars); // e.g. 1024 / 64 = 16
  const padding = 1.5;
  const bw = (W - (numBars - 1) * padding) / numBars;

  for (let i = 0; i < numBars; i++) {
    let sum = 0;
    const startBin = i * binsPerBar;
    for (let j = 0; j < binsPerBar; j++) {
      sum += dataArray[startBin + j];
    }
    const avg = sum / binsPerBar;
    const bh = (avg / 255) * H;

    // Linear gradient for each bar shifting from violet (top) to cyan (bottom)
    const gradient = vizCtx.createLinearGradient(0, H - bh, 0, H);
    gradient.addColorStop(0, `hsl(260, 100%, 65%)`);
    gradient.addColorStop(1, `hsl(200, 100%, 50%)`);

    vizCtx.fillStyle = gradient;
    
    const x = i * (bw + padding);
    const y = H - bh;
    
    vizCtx.beginPath();
    vizCtx.roundRect(x, y, bw, Math.max(2, bh), 3);
    vizCtx.fill();
  }
}

// ─────────────────────────────────────────────
//  UI & MODES BINDINGS
// ─────────────────────────────────────────────
document.getElementById('audio-upload').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  if (!files || files.length === 0) return;
  
  const wasEmpty = playlist.length === 0;
  
  files.forEach(f => {
    if (!playlist.some(item => item.name === f.name)) {
      playlist.push({
        file: f,
        name: f.name,
        audioBuffer: null,
        songMap: null
      });
    }
  });
  
  updatePlaylistUI();
  
  if (wasEmpty && playlist.length > 0) {
    await playPlaylistItem(0);
  }
});

const btnClearPlaylist = document.getElementById('btn-clear-playlist');
if (btnClearPlaylist) btnClearPlaylist.addEventListener('click', clearPlaylist);

const btnPrevSong = document.getElementById('btn-prev-song');
if (btnPrevSong) btnPrevSong.addEventListener('click', playPrevSong);

const btnNextSong = document.getElementById('btn-next-song');
if (btnNextSong) btnNextSong.addEventListener('click', playNextSong);
document.getElementById('video-upload').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  if (videoObj) {
    videoObj.pause();
    URL.revokeObjectURL(videoObj.src);
  }
  videoObj = document.createElement('video');
  videoObj.src = URL.createObjectURL(f);
  videoObj.crossOrigin = 'anonymous';
  videoObj.loop = true;
  videoObj.muted = true;
  videoObj.playsInline = true;
  if (playing) videoObj.play().catch(console.error);
  
  if (videoTexture) videoTexture.dispose();
  try {
    videoTexture = new THREE.VideoTexture(videoObj);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    customVideoElement = videoObj;
    if (ledScreenMat) {
        ledScreenMat.map = videoTexture;
        ledScreenMat.needsUpdate = true;
        ledScreenMat.color.setHex(0xffffff);
    }
  } catch (err) {
    console.error("Failed to create VideoTexture:", err);
  }
});
document.getElementById('param-autocam').addEventListener('change', e => {
  autoCamEnabled = e.target.checked;
  if (autoCamEnabled) {
      droneEnabled = false;
      crowdPOVEnabled = false;
      const elDrone = document.getElementById('param-dronecam');
      if (elDrone) elDrone.checked = false;
      const elPOV = document.getElementById('param-crowdpov');
      if (elPOV) elPOV.checked = false;
  }
  if (!autoCamEnabled && !tvModeEnabled && !droneEnabled && !crowdPOVEnabled && currentMode === 'live') {
    controls.enabled = true;
    camera.position.copy(baseCamPos);
    controls.target.copy(baseCamTarget);
    camera.lookAt(baseCamTarget);
  }
});

document.getElementById('param-tvmode').addEventListener('change', e => {
  tvModeEnabled = e.target.checked;
  if (tvModeEnabled) {
      currentTvCamIdx = 0;
      justCut = true;
      droneEnabled = false;
      crowdPOVEnabled = false;
      const elDrone = document.getElementById('param-dronecam');
      if (elDrone) elDrone.checked = false;
      const elPOV = document.getElementById('param-crowdpov');
      if (elPOV) elPOV.checked = false;
  } else if (!autoCamEnabled && !droneEnabled && !crowdPOVEnabled && currentMode === 'live') {
      controls.enabled = true;
      camera.position.copy(baseCamPos);
      controls.target.copy(baseCamTarget);
      camera.lookAt(baseCamTarget);
  }
});

document.getElementById('param-dronecam').addEventListener('change', e => {
  droneEnabled = e.target.checked;
  if (droneEnabled) {
      autoCamEnabled = false;
      tvModeEnabled = false;
      crowdPOVEnabled = false;
      const elAuto = document.getElementById('param-autocam');
      if (elAuto) elAuto.checked = false;
      const elTv = document.getElementById('param-tvmode');
      if (elTv) elTv.checked = false;
      const elPOV = document.getElementById('param-crowdpov');
      if (elPOV) elPOV.checked = false;
      
      controls.enabled = false;
      
      // Inherit camera position and direction seamlessly
      dronePos.copy(camera.position);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      droneYaw = Math.atan2(-dir.x, -dir.z);
      const dXZ = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
      dronePitch = Math.atan2(dir.y, dXZ);
      
      droneVel.set(0, 0, 0);
      droneYawVel = 0;
      dronePitchVel = 0;
  } else {
      if (!autoCamEnabled && !tvModeEnabled && !crowdPOVEnabled && currentMode === 'live') {
          controls.enabled = true;
          camera.position.copy(baseCamPos);
          controls.target.copy(baseCamTarget);
          camera.lookAt(baseCamTarget);
      }
  }
});

const elCrowdPOV = document.getElementById('param-crowdpov');
if (elCrowdPOV) {
  elCrowdPOV.addEventListener('change', e => {
    crowdPOVEnabled = e.target.checked;
    if (crowdPOVEnabled) {
      autoCamEnabled = false;
      tvModeEnabled = false;
      droneEnabled = false;
      const elAuto = document.getElementById('param-autocam');
      if (elAuto) elAuto.checked = false;
      const elTv = document.getElementById('param-tvmode');
      if (elTv) elTv.checked = false;
      const elDrone = document.getElementById('param-dronecam');
      if (elDrone) elDrone.checked = false;

      controls.enabled = false;
      if (crowdObjects.length > 0) {
        povCurrentCrowdIdx = Math.floor(Math.random() * crowdObjects.length);
        povTargetCrowdIdx = povCurrentCrowdIdx;
        povHopElapsed = 0.6;
        povHopActive = false;
        povBeatCount = 0;
      }
    } else {
      if (!autoCamEnabled && !tvModeEnabled && !droneEnabled && currentMode === 'live') {
        controls.enabled = true;
        camera.position.copy(baseCamPos);
        controls.target.copy(baseCamTarget);
        camera.lookAt(baseCamTarget);
      }
    }
  });
}

// Drone Keyboard Control listeners
window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    activeKeys[e.code] = true;
});

window.addEventListener('keyup', e => {
    activeKeys[e.code] = false;
});

// Drone Mouse Look dragging listeners
let isDraggingDrone = false;
const prevMousePos = { x: 0, y: 0 };

window.addEventListener('mousedown', e => {
    if (!droneEnabled) return;
    isDraggingDrone = true;
    prevMousePos.x = e.clientX;
    prevMousePos.y = e.clientY;
});

window.addEventListener('mousemove', e => {
    if (!droneEnabled || !isDraggingDrone) return;
    const dx = e.clientX - prevMousePos.x;
    const dy = e.clientY - prevMousePos.y;
    
    droneYaw -= dx * 0.0025;
    dronePitch -= dy * 0.0025;
    dronePitch = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47, dronePitch));
    
    prevMousePos.x = e.clientX;
    prevMousePos.y = e.clientY;
});

window.addEventListener('mouseup', () => {
    isDraggingDrone = false;
});

// ─── Laser Writer VJ UI Event listeners ───────────────────────
document.getElementById('param-laserwriter-enable').addEventListener('change', e => {
    laserWriterEnabled = e.target.checked;
    if (laserWriterEnabled && !laserWriterGroup) {
        initLaserWriter();
    }
});

document.getElementById('param-laserwriter-mode').addEventListener('change', e => {
    laserWriterMode = e.target.value;
    const txtGrp = document.getElementById('laserwriter-text-group');
    const svgGrp = document.getElementById('laserwriter-svg-group');
    if (laserWriterMode === 'text') {
        if (txtGrp) txtGrp.style.display = 'flex';
        if (svgGrp) svgGrp.style.display = 'none';
    } else {
        if (txtGrp) txtGrp.style.display = 'none';
        if (svgGrp) svgGrp.style.display = 'flex';
    }
    compileScannerPoints();
});

let autoSyncLyrics = true;

document.getElementById('param-lyric-sync-enable')?.addEventListener('change', e => {
    autoSyncLyrics = e.target.checked;
});

document.getElementById('btn-apply-lyrics')?.addEventListener('click', () => {
    try {
        const jsonStr = document.getElementById('param-lyrics-json').value;
        const parsed = JSON.parse(jsonStr);
        if (songMap) {
            songMap.songLyrics = parsed;
            alert("Lyrics erfolgreich aktualisiert!");
        } else {
            alert("Es ist aktuell kein Song geladen!");
        }
    } catch (err) {
        alert("Could not save the lyrics. Please check that the input is valid JSON.");
        console.error(err);
    }
});

document.getElementById('param-laserwriter-text').addEventListener('input', e => {
    laserWriterText = e.target.value || ' ';
    compileScannerPoints();
});

document.getElementById('param-laserwriter-speed').addEventListener('input', e => {
    laserWriterSpeed = +e.target.value;
    const elVal = document.getElementById('val-laserwriter-speed');
    if (elVal) elVal.textContent = laserWriterSpeed;
});

document.getElementById('param-laserwriter-inertia').addEventListener('input', e => {
    laserWriterInertia = +e.target.value;
    const elVal = document.getElementById('val-laserwriter-inertia');
    if (elVal) elVal.textContent = laserWriterInertia.toFixed(1);
});

document.getElementById('param-laserwriter-color').addEventListener('change', e => {
    laserWriterColor = e.target.value;
});

document.getElementById('param-laserwriter-intensity').addEventListener('input', e => {
    laserWriterIntensity = +e.target.value / 100;
    const elVal = document.getElementById('val-laserwriter-intensity');
    if (elVal) elVal.textContent = Math.round(laserWriterIntensity * 100) + '%';
});

document.getElementById('param-laserwriter-blanking').addEventListener('change', e => {
    laserWriterBlanking = e.target.checked;
});

document.getElementById('param-laserwriter-flicker').addEventListener('change', e => {
    laserWriterFlicker = e.target.checked;
    compileScannerPoints();
});

document.getElementById('param-laserwriter-svg-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = evt => {
        const svgContent = evt.target.result;
        uploadedSVGPaths = parseSVGToPaths(svgContent);
        compileScannerPoints();
    };
    reader.readAsText(file);
});

document.getElementById('param-movingheads').addEventListener('change', e => {
    movingHeadsEnabled = e.target.checked;
    initMovingHeads(CFG.movingHeadCount);
});
document.getElementById('param-livecrowd').addEventListener('change', e => {
  liveCrowdEnabled = e.target.checked;
  initCrowd();
});
document.getElementById('param-dynamiccrowd').addEventListener('change', e => {
  dynamicCrowdEnabled = e.target.checked;
  const baseColor = new THREE.Color(dynamicCrowdEnabled ? 0x1a1824 : 0xffffff);
  crowdObjects.forEach(c => {
      if (c.matDown) c.matDown.color.copy(baseColor);
      if (c.matUp) c.matUp.color.copy(baseColor);
  });
});
const elGoboTheme = document.getElementById('param-gobo-theme');
if (elGoboTheme) {
  elGoboTheme.addEventListener('change', e => {
    updateGoboCanvas(e.target.value);
  });
}
const elFireFog = document.getElementById('btn-fire-fog');
if (elFireFog) {
  elFireFog.addEventListener('click', () => {
    triggerFogJet(-28, 0.2, -22, 1.5, 0.4, 0.4);
    triggerFogJet(28, 0.2, -22, -1.5, 0.4, 0.4);
  });
}
document.getElementById('param-uplights').addEventListener('change', e => {
  upLightsEnabled = e.target.checked;
  initUpLights();
});
const elUlIntensity = document.getElementById('param-ul-intensity');
if(elUlIntensity) elUlIntensity.addEventListener('input', e => { CFG.ulIntensity = +e.target.value; });
document.getElementById('param-bounce').addEventListener('change', e => raybounceEnabled = e.target.checked);
document.getElementById('param-fx-vhs').addEventListener('change', e => { 
  fxVhsEnabled = e.target.checked;
  filmPass.enabled = fxVhsEnabled;
  rgbShiftPass.enabled = fxVhsEnabled;
  rebuildPostChain();
    syncScreenFxStyles();
});


document.getElementById('param-fx-flare').addEventListener('change', e => { 
  fxFlareEnabled = e.target.checked;
  movingHeadObjects.forEach(mh => {
     if (mh.lensflare) mh.lensflare.visible = fxFlareEnabled;
  });
});


const paramPeak = document.getElementById('param-peakmode');
if(paramPeak) paramPeak.addEventListener('change', e => peakModeEnabled = e.target.checked);

document.getElementById('param-fx-blur').addEventListener('change', e => { 
  fxBlurEnabled = e.target.checked;
  afterimagePass.enabled = fxBlurEnabled;
  rebuildPostChain();
    syncScreenFxStyles();
});
const paramTiktok = document.getElementById('param-tiktok');
if (paramTiktok) {
  paramTiktok.addEventListener('change', e => {
    tiktokModeEnabled = e.target.checked;
    window.dispatchEvent(new Event('resize')); 
  });
}
const paramWeatherRain = document.getElementById('param-weather-rain');
if (paramWeatherRain) {
    paramWeatherRain.addEventListener('change', e => {
        setRainState(e.target.checked, rainIntensity);
    });
}

const paramRainIntensity = document.getElementById('param-rain-intensity');
if (paramRainIntensity) {
    paramRainIntensity.addEventListener('input', e => {
        const val = +e.target.value;
        rainIntensity = val;
        const valEl = document.getElementById('val-rain-intensity');
        if (valEl) valEl.textContent = val;
        if (rainEnabled) {
            initRainParticleSystem(val);
            if (audioCtx) {
                rainAudioSynth.setIntensity(val, true);
            }
        }
    });
}

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    // Prevent triggering if user is typing in an input field
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      return;
    }
    toggleFullscreen();
  }
});

document.getElementById('btn-play-pause').addEventListener('click', togglePlay);
const btnTapBpm = document.getElementById('btn-tap-bpm');
if (btnTapBpm) btnTapBpm.addEventListener('click', handleBpmTap);
document.getElementById('btn-record').addEventListener('click', toggleRecording);
const btnFullscreen = document.getElementById('btn-fullscreen');
if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);

document.getElementById('canvas-container').addEventListener('dblclick', toggleFullscreen);

window.addEventListener('keydown', (e) => {
  // Ignore if user is typing in an input
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

  switch(e.key.toLowerCase()) {
    case ' ':
      e.preventDefault(); // Prevent scrolling
      togglePlay();
      break;
    case 'f':
      toggleFullscreen();
      break;
    case 'c':
      if (document.getElementById('param-autocam')) {
        document.getElementById('param-autocam').click();
      }
      break;
    case 't':
      if (document.getElementById('param-tvmode')) {
        document.getElementById('param-tvmode').click();
      }
      break;
    case 'h':
      const ui = document.getElementById('ui-container');
      if (ui) {
        ui.style.display = ui.style.display === 'none' ? 'flex' : 'none';
      }
      break;
  }
});
document.getElementById('param-intensity').addEventListener('input', e => { CFG.intensity = +e.target.value; });
document.getElementById('param-speed').addEventListener('input', e => { CFG.speed = +e.target.value; });
document.getElementById('param-mh-intensity').addEventListener('input', e => { CFG.mhIntensity = +e.target.value; });
document.getElementById('param-mh-speed').addEventListener('input', e => { CFG.mhSpeed = +e.target.value; });
document.getElementById('param-spread').addEventListener('input', e => { CFG.spread = +e.target.value; });
document.getElementById('param-thickness').addEventListener('input', e => { CFG.thickness = +e.target.value; });
document.getElementById('param-tilt').addEventListener('input', e => { CFG.tilt = +e.target.value; });
document.getElementById('param-theme').addEventListener('change', e => { CFG.theme = e.target.value; refreshLaserColors(); });

// ── New formation / beam controls ──────────────────────────────
document.getElementById('param-stage-size').addEventListener('change', e => {
    CFG.stageSize = e.target.value;
    
    const newLaserCount = CFG.stageSize === 'large' ? 180 : 40;
    const newMhCount    = CFG.stageSize === 'large' ? 120 : 20;
    
    if(laserCountSlider) {
        laserCountSlider.value = newLaserCount;
        laserCountVal.textContent = newLaserCount;
    }
    if(mhCountSlider) {
        mhCountSlider.value = newMhCount;
        mhCountVal.textContent = newMhCount;
    }

    buildStageEnvironment();
    initLasers(newLaserCount);
    initMovingHeads(newMhCount);
    initPyroSystems();
});

document.getElementById('param-formation').addEventListener('change', e => {
    CFG.formation = e.target.value; initLasers();
});
const laserCountSlider = document.getElementById('param-laser-count');
const laserCountVal    = document.getElementById('val-laser-count');
laserCountSlider.addEventListener('input', e => {
    laserCountVal.textContent = e.target.value;
    initLasers(+e.target.value);
});
// Moving Head count slider
const mhCountSlider = document.getElementById('param-mh-count');
const mhCountVal    = document.getElementById('val-mh-count');
if (mhCountSlider) {
    mhCountSlider.addEventListener('input', e => {
        mhCountVal.textContent = e.target.value;
        initMovingHeads(+e.target.value);
    });
}
const beamsSlider = document.getElementById('param-beams');
const beamsVal    = document.getElementById('val-beams');
beamsSlider.addEventListener('input', e => {
  CFG.beamsPerLaser = +e.target.value;
  beamsVal.textContent = e.target.value;
  initLasers();
});
const spreadAngleSlider = document.getElementById('param-beam-spread');
const spreadAngleVal    = document.getElementById('val-spread-angle');
spreadAngleSlider.addEventListener('input', e => {
  CFG.beamSpread = +e.target.value * Math.PI / 180;
  spreadAngleVal.textContent = e.target.value + '°';
  initLasers();
});
const hazeSlider = document.getElementById('param-haze');
const hazeVal    = document.getElementById('val-haze');
hazeSlider.addEventListener('input', e => {
  CFG.hazeDensity = +e.target.value / 100;
  hazeVal.textContent = e.target.value + '%';
  createHaze();
});

const screenBrightSlider = document.getElementById('param-screen-bright');
const screenBrightVal    = document.getElementById('val-screen-bright');
screenBrightSlider.addEventListener('input', e => {
  CFG.screenBrightness = +e.target.value / 100;
  screenBrightVal.textContent = e.target.value + '%';
});

const screenReactSlider = document.getElementById('param-screen-react');
const screenReactVal    = document.getElementById('val-screen-react');
screenReactSlider.addEventListener('input', e => {
  CFG.screenReactivity = +e.target.value / 100;
  screenReactVal.textContent = e.target.value + '%';
});

// Tabs Logic
const tabLive = document.getElementById('tab-live');
const tabStudio = document.getElementById('tab-studio');
const panelLive = document.getElementById('panel-live');
const panelStudio = document.getElementById('panel-studio');

function switchMode(mode) {
  currentMode = mode;
  const sidebar = document.getElementById('timeline-sidebar');
  const svg = document.getElementById('timeline-svg');
  const addBtn = document.getElementById('btn-add-kf');
  const delBtn = document.getElementById('btn-del-kf');

  if (mode === 'live') {
    tabLive.classList.add('active'); tabStudio.classList.remove('active');
    panelLive.classList.remove('hidden'); panelStudio.classList.add('hidden');
    if (selectedLaser) selectedLaser = null;
    
    if (sidebar) sidebar.classList.add('hidden');
    if (svg) svg.classList.add('hidden');
    if (addBtn) addBtn.classList.add('hidden');
    if (delBtn) delBtn.classList.add('hidden');

    // Reset rotations to base values if jumping to live
    if (!isMappingMode) {
      laserObjects.forEach(l => { 
          l.rot.x = 0; l.rot.y = 0; l.rot.z = 0;
      });
    }
  } else {
    // Studio mode
    tabLive.classList.remove('active'); tabStudio.classList.add('active');
    panelLive.classList.add('hidden'); panelStudio.classList.remove('hidden');
    
    if (sidebar) sidebar.classList.remove('hidden');
    if (svg) svg.classList.remove('hidden');
    if (addBtn) addBtn.classList.remove('hidden');
    if (delBtn) delBtn.classList.remove('hidden');
    
    // Auto-pause if playing to allow editing
    if (playing) togglePlay(); 
  }
}

tabLive.addEventListener('click', () => switchMode('live'));
tabStudio.addEventListener('click', () => switchMode('studio'));

// Studio Mode Raycasting & Controls
renderer.domElement.addEventListener('click', (event) => {
  if (currentMode !== 'studio') return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  if (isTargetingMode) {
      // Raycast against the floor (y=0 plane) or other objects to find a target point
      // For simplicity, we create a mathematical plane at y=0
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const targetPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, targetPoint);
      if (targetPoint && selectedLasers.length > 0) {
          aimAtTarget(selectedLasers, targetPoint);
          if (typeof updateInspectorUI === 'function') updateInspectorUI();
      }
      return; // Do not select/deselect when in targeting mode
  }

  const intersects = raycaster.intersectObjects(scene.children, true);
  
  let clickedLaser = null;
  for (let i = 0; i < intersects.length; i++) {
    const ob = intersects[i].object;
    if (ob.userData.isProjectorHitbox) {
      if (ob.userData.isMovingHead) {
          clickedLaser = movingHeadObjects.find(mh => mh.proxy === ob.parent);
      } else {
          clickedLaser = laserObjects.find(l => l.proxy === ob.parent);
      }
      if (clickedLaser) break;
    }
  }

  const isShiftDown = event.shiftKey;

  if (clickedLaser) {
      if (isShiftDown) {
          const index = selectedLasers.indexOf(clickedLaser);
          if (index > -1) {
              selectedLasers.splice(index, 1);
              if (boxHelpers.has(clickedLaser)) {
                  scene.remove(boxHelpers.get(clickedLaser));
                  boxHelpers.delete(clickedLaser);
              }
          } else {
              selectedLasers.push(clickedLaser);
              const helper = new THREE.BoxHelper(clickedLaser.proxy, 0x00ffcc);
              scene.add(helper);
              boxHelpers.set(clickedLaser, helper);
          }
      } else {
          // Clear existing
          selectedLasers.forEach(l => {
              if (boxHelpers.has(l)) {
                  scene.remove(boxHelpers.get(l));
                  boxHelpers.delete(l);
              }
          });
          selectedLasers = [clickedLaser];
          const helper = new THREE.BoxHelper(clickedLaser.proxy, 0x00ffcc);
          scene.add(helper);
          boxHelpers.set(clickedLaser, helper);
      }
  } else if (!isShiftDown) {
      // Clicked on nothing without shift, clear selection
      selectedLasers.forEach(l => {
          if (boxHelpers.has(l)) {
              scene.remove(boxHelpers.get(l));
              boxHelpers.delete(l);
          }
      });
      selectedLasers = [];
  }

  updateSelectionUI();
});

export function updateSelectionUI() {
  if (selectedLasers.length === 1) {
      selectedLaser = selectedLasers[0];
      document.getElementById('lbl-selected-laser').textContent = `Laser #${selectedLaser.id !== undefined ? selectedLaser.id : 'MH'}`;
  } else {
      selectedLaser = null;
      if (selectedLasers.length > 1) {
          document.getElementById('lbl-selected-laser').textContent = `${selectedLasers.length} Lasers selected`;
      } else {
          document.getElementById('lbl-selected-laser').textContent = 'None';
      }
  }
  if (typeof updateInspectorUI === 'function') updateInspectorUI();
}

export function selectAllLasers() {
    selectedLasers.forEach(l => {
        if (boxHelpers.has(l)) {
            scene.remove(boxHelpers.get(l));
            boxHelpers.delete(l);
        }
    });
    selectedLasers = [...laserObjects];
    selectedLasers.forEach(l => {
        const helper = new THREE.BoxHelper(l.proxy, 0x00ffcc);
        scene.add(helper);
        boxHelpers.set(l, helper);
    });
    updateSelectionUI();
}

export function deselectAllLasers() {
    selectedLasers.forEach(l => {
        if (boxHelpers.has(l)) {
            scene.remove(boxHelpers.get(l));
            boxHelpers.delete(l);
        }
    });
    selectedLasers.length = 0; // Clear array while keeping reference
    updateSelectionUI();
}

export function selectOddLasers() {
    deselectAllLasers();
    laserObjects.forEach((l, i) => {
        if (i % 2 !== 0) {
            selectedLasers.push(l);
            const helper = new THREE.BoxHelper(l.proxy, 0x00ffcc);
            scene.add(helper);
            boxHelpers.set(l, helper);
        }
    });
    updateSelectionUI();
}

export function selectEvenLasers() {
    deselectAllLasers();
    laserObjects.forEach((l, i) => {
        if (i % 2 === 0) {
            selectedLasers.push(l);
            const helper = new THREE.BoxHelper(l.proxy, 0x00ffcc);
            scene.add(helper);
            boxHelpers.set(l, helper);
        }
    });
    updateSelectionUI();
}

// Inspector UI Logic
window.updateInspectorUI = function() {
    const inspectorPanel = document.getElementById('inspector-panel');
    if (selectedLasers.length === 0) {
        inspectorPanel.style.display = 'none';
        return;
    }
    
    const hasLaser = selectedLasers.some(l => l.isManualOverride !== undefined);
    if (!hasLaser) {
        inspectorPanel.style.display = 'none';
        return;
    }
    
    inspectorPanel.style.display = 'block';
    
    const primaryLaser = selectedLasers.find(l => l.isManualOverride !== undefined);
    if (!primaryLaser) return;

    document.getElementById('insp-override').checked = primaryLaser.isManualOverride;
    document.getElementById('insp-pan').value = primaryLaser.manualPan || 0;
    document.getElementById('val-insp-pan').textContent = `${primaryLaser.manualPan || 0}°`;
    document.getElementById('insp-tilt').value = primaryLaser.manualTilt || 0;
    document.getElementById('val-insp-tilt').textContent = `${primaryLaser.manualTilt || 0}°`;
    document.getElementById('insp-color').value = '#' + primaryLaser.manualColor.getHexString();
    document.getElementById('insp-intensity').value = primaryLaser.manualIntensity || 1.0;
    document.getElementById('val-insp-intensity').textContent = (primaryLaser.manualIntensity || 1.0).toFixed(1);
    document.getElementById('insp-spread').value = primaryLaser.manualSpread || 1.0;
    document.getElementById('val-insp-spread').textContent = (primaryLaser.manualSpread || 1.0).toFixed(1);
    document.getElementById('insp-pattern').value = primaryLaser.manualPattern || 'auto';
};

// Bind Inspector Events
document.getElementById('insp-override').addEventListener('change', (e) => {
    const val = e.target.checked;
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.isManualOverride = val; });
});
document.getElementById('insp-pan').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('val-insp-pan').textContent = `${val}°`;
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.manualPan = val; });
});
document.getElementById('insp-tilt').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('val-insp-tilt').textContent = `${val}°`;
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.manualTilt = val; });
});
document.getElementById('insp-color').addEventListener('input', (e) => {
    const hex = e.target.value;
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.manualColor.set(hex); });
});
document.getElementById('insp-intensity').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('val-insp-intensity').textContent = val.toFixed(1);
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.manualIntensity = val; });
});
document.getElementById('insp-spread').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('val-insp-spread').textContent = val.toFixed(1);
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.manualSpread = val; });
});
document.getElementById('insp-pattern').addEventListener('change', (e) => {
    const val = e.target.value;
    selectedLasers.forEach(l => { if (l.isManualOverride !== undefined) l.manualPattern = val; });
});

// Scene Export / Import
document.getElementById('btn-save-scene').addEventListener('click', () => {
    const data = laserObjects.filter(l => l.isManualOverride).map(l => ({
        id: l.id,
        manualPan: l.manualPan,
        manualTilt: l.manualTilt,
        manualIntensity: l.manualIntensity,
        manualSpread: l.manualSpread,
        manualColor: '#' + l.manualColor.getHexString(),
        manualPattern: l.manualPattern
    }));
    const blob = new Blob([JSON.stringify({ lasers: data }, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'laser_scene.json';
    a.click();
});

document.getElementById('btn-load-scene').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed.lasers) {
                laserObjects.forEach(l => l.isManualOverride = false);
                parsed.lasers.forEach(data => {
                    const l = laserObjects.find(lo => lo.id === data.id);
                    if (l) {
                        l.isManualOverride = true;
                        l.manualPan = data.manualPan || 0;
                        l.manualTilt = data.manualTilt || 0;
                        l.manualIntensity = data.manualIntensity !== undefined ? data.manualIntensity : 1.0;
                        l.manualSpread = data.manualSpread || 1.0;
                        if (data.manualColor) l.manualColor.set(data.manualColor);
                        l.manualPattern = data.manualPattern || 'auto';
                    }
                });
                if (typeof updateInspectorUI === 'function') updateInspectorUI();
            }
        } catch (err) {
            console.error('Failed to load scene', err);
            alert('Failed to load scene file.');
        }
    };
    reader.readAsText(file);
});

// Add / Remove Lasers
document.getElementById('btn-add-laser').addEventListener('click', () => {
    // If a moving head is selected, maybe we add a moving head instead? For simplicity we add laser.
    const cols = CFG.themes[CFG.theme] || [0xffffff];
    const colorHex = cols[laserObjects.length % cols.length];
    laserObjects.push(createLaserGroup(colorHex, 0, 11.85, -15, CFG.beamsPerLaser, CFG.beamSpread));
});

document.getElementById('btn-remove-laser').addEventListener('click', () => {
    if (selectedLaser) {
        if (selectedLaser.isMovingHead) {
            scene.remove(selectedLaser.group);
            const index = movingHeadObjects.indexOf(selectedLaser);
            if (index > -1) movingHeadObjects.splice(index, 1);
        } else {
            scene.remove(selectedLaser.pivot);
            const index = laserObjects.indexOf(selectedLaser);
            if (index > -1) laserObjects.splice(index, 1);
        }
        selectedLaser = null;
        document.getElementById('lbl-selected-laser').textContent = 'None';
    }
});


// ─────────────────────────────────────────────
//  BEAT STATE  (real-time, supplements song map)
// ─────────────────────────────────────────────
const BEAT_HISTORY = 43;
const beatEnergy   = new Float32Array(BEAT_HISTORY);
let   beatPtr      = 0;
const beatState = { isBeat: false, isTransient: false, beatCooldown: 0, speedMult: 1.0,
                    flashDecay: 0, strobeOn: true, strobeTimer: 0,
                    currentSceneIndex: 0 };

function detectBeat(bass) {
  beatEnergy[beatPtr] = bass; beatPtr = (beatPtr + 1) % BEAT_HISTORY;
  let avg = 0;
  for (let i = 0; i < BEAT_HISTORY; i++) avg += beatEnergy[i];
  avg /= BEAT_HISTORY;
  return bass > Math.max(avg * 1.5, 0.22);
}

const tsEnergy = new Float32Array(BEAT_HISTORY);
let tsPtr = 0;
function detectTransient(high) {
  tsEnergy[tsPtr] = high; tsPtr = (tsPtr + 1) % BEAT_HISTORY;
  let avg = 0;
  for (let i = 0; i < BEAT_HISTORY; i++) avg += tsEnergy[i];
  avg /= BEAT_HISTORY;
  return high > Math.max(avg * 1.7, 0.18);
}

updateUIWorkflowLoop();

// ─────────────────────────────────────────────
//  SONG TIMELINE RENDERER
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  SONG TIMELINE RENDERER (KEYFRAME EDITOR)
// ─────────────────────────────────────────────
function getInterpolatedValue(trackName, time) {
    const track = timelineData[trackName];
    if (!track || track.length === 0) {
        if (trackName === 'intensity' || trackName === 'speed') return 1.0;
        return 0.0;
    }
    if (track.length === 1 || time <= track[0].time) return track[0].value;
    if (time >= track[track.length - 1].time) return track[track.length - 1].value;
    
    let left = track[0], right = track[track.length - 1];
    for (let i = 0; i < track.length - 1; i++) {
        if (time >= track[i].time && time <= track[i+1].time) {
            left = track[i];
            right = track[i+1];
            break;
        }
    }
    const ratio = (time - left.time) / (right.time - left.time);
    return left.value + (right.value - left.value) * ratio;
}

let tlSkip = 0;
const waveformCanvas = document.createElement('canvas');
let waveformValid = false;

function updateTimeline() {
  if (++tlSkip % 10 !== 0) return;
  const canvas = document.getElementById('timeline-canvas');
  const svg = document.getElementById('timeline-svg');
  if (!canvas || !songMap || !audioBuffer) return;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 10) return;

  if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      waveformValid = false;
  }

  const ctx = canvas.getContext('2d');
  const dur = audioBuffer.duration;
  const nowT = getPlaybackTime();
  ctx.clearRect(0, 0, W, H);

  // Background Waveform (cached)
  if (!waveformValid) {
      waveformCanvas.width = W;
      waveformCanvas.height = H;
      const wCtx = waveformCanvas.getContext('2d');
      wCtx.clearRect(0, 0, W, H);
      for (let px = 0; px < W; px++) {
        const f = Math.min(Math.floor((px / W) * dur / songMap.hopSec), songMap.N - 1);
        const en = songMap.energyMap[f];
        wCtx.fillStyle = `rgba(80,80,130,${en * 0.25})`;
        wCtx.fillRect(px, H - en * H * 0.48, 1, en * H * 0.48);
      }
      waveformValid = true;
  }
  ctx.drawImage(waveformCanvas, 0, 0);

  // Section blocks
  const activeSec = songMap.sections.find(s => s.startTime <= nowT && s.endTime > nowT);
  songMap.sections.forEach((sec, i) => {
    const x0 = Math.round(sec.startTime / dur * W);
    const x1 = Math.round(sec.endTime   / dur * W);
    const hue = sec.baseHue;
    const active = sec === activeSec;
    ctx.fillStyle = `hsla(${hue},70%,${active?42:22}%,${active?0.35:0.1})`;
    ctx.fillRect(x0, 0, x1 - x0 - 1, H);
    ctx.strokeStyle = `hsla(${hue},100%,70%,${active?0.4:0.15})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 2, H - 1);
  });

  // Playhead update
  const px = Math.round(nowT / dur * W);
  const ph = document.getElementById('timeline-playhead');
  if (ph) {
    ph.style.left = px + 'px';
  }

  // Meta labels
  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  document.getElementById('tl-time').textContent = `${fmt(nowT)} / ${fmt(dur)}`;
  document.getElementById('tl-bpm').textContent  = `${songMap.bpm || 128} BPM`;
  // Show the LIVE active pattern (from livePatternDecider) next to the section baseline
  const livePatLabel = _lpd.currentPattern !== (activeSec ? activeSec.pattern : '') 
    ? ` → ${_lpd.currentPattern}` : '';
  document.getElementById('tl-section').textContent = activeSec 
    ? `Sec ${activeSec.id+1} · ${activeSec.pattern}${livePatLabel}` : '—';
  
  // Render SVG Keyframe Curves
  const tracks = ['intensity', 'speed', 'pan', 'tilt'];
  const colors = { intensity: '#fff', speed: '#ff00ff', pan: '#00ffcc', tilt: '#ffcc00' };
  
  // Update path outlines and circles
  const ptsGroup = document.getElementById('kf-points');
  ptsGroup.innerHTML = '';
  
  tracks.forEach(tr => {
      const pathEl = document.getElementById(`curve-${tr}`);
      const trData = timelineData[tr];
      if (!pathEl) return;
      
      if (trData.length === 0) { pathEl.setAttribute('d', ''); return; }
      
      let d = '';
      trData.forEach((kf, idx) => {
          const kx = (kf.time / dur) * W;
          // value expected 0 to 2 mapped to H to 0
          const maxV = (tr === 'pan' || tr === 'tilt') ? 4 : 2;
          const mapVal = Math.max(0, Math.min(1, kf.value / maxV));
          const ky = H - (mapVal * H);
          
          if (idx === 0) d += `M ${kx} ${ky} `;
          else d += `L ${kx} ${ky} `;
          
          if (tr === activeTrack) {
              const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
              rect.setAttribute('x', kx - 4);
              rect.setAttribute('y', ky - 4);
              rect.setAttribute('width', 8);
              rect.setAttribute('height', 8);
              rect.setAttribute('class', `kf-point ${selectedKeyframe === kf ? 'selected' : ''}`);
              rect.onmousedown = (e) => { e.stopPropagation(); startDrag(kf, e); };
              ptsGroup.appendChild(rect);
          }
      });
      pathEl.setAttribute('d', d);
      pathEl.style.stroke = colors[tr];
      pathEl.classList.toggle('active', tr === activeTrack);
  });
}

// ─────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────
let t = 0;
let frameCount = 0;
let dynamicBeatPhase = 0;
let lastRawBeatPhase = 0;

// ── Frame timing ──────────────────────────────────────────────
// The render loop is driven by renderer.setAnimationLoop(), which fires at the
// display's refresh rate (60 / 120 / 144 Hz …). Every animation below therefore
// has to be scaled by the real elapsed time, otherwise the whole show runs
// 2.4x too fast on a 144 Hz monitor and drifts away from the music.
const FIXED_STEP = 1 / 60;     // the rate the original constants were tuned for
const MAX_STEP   = 1 / 15;     // clamp after tab-switch / GC stall (no huge jumps)
let lastFrameTs  = 0;          // performance.now() of the previous frame
let frameDelta   = FIXED_STEP; // seconds since the previous frame
let deltaScale   = 1;          // frameDelta / FIXED_STEP — multiplier for per-frame constants
let smoothedFPS  = 60;

/**
 * Frame-rate independent lerp factor.
 * `k` is the smoothing factor that was tuned at 60 fps; this converts it into
 * the equivalent factor for the current frame duration so decays (flash,
 * strobe, camera easing) fade over the same wall-clock time at any refresh rate.
 */
function fLerp(k, dt = frameDelta) {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    return 1 - Math.pow(1 - k, dt / FIXED_STEP);
}

function updateInstancedMovingHeads(t, tAnim, energy, vocals, drums, kick, isPeakDrop, isSilent, buildUp, section) {
    if (!mhBaseIM) return;
    const count = movingHeadObjects.length;
    const spring = 0.07 + energy * 0.07;
    const damp   = 0.80;
    let colorDirty = false;
    let activeMhIntensity = CFG.mhIntensity;
    if (section && section.type === 'intro') {
        activeMhIntensity = 0.01;
    } else if (section && section.type === 'outro') {
        activeMhIntensity = 0.05;
    } else if (section && section.type === 'drop') {
        activeMhIntensity = Math.max(activeMhIntensity, 1.5);
    }

    // Move calculations out of loop
    const pTimeSpeedMult = isPeakDrop ? 2.8 : 1.0;
    const pTime = tAnim * CFG.mhSpeed * pTimeSpeedMult;
    const sweepAmp = 1.1 + energy * 0.9 + (buildUp > 0.5 ? 0.6 : 0) + (isPeakDrop ? 1.8 : 0);
    const tiltBase = Math.PI * 0.38;
    const tiltAmp = 0.25 + vocals * 0.35 + drums * 0.2;
    const tiltBuildUpMod = buildUp * 0.3 + (isPeakDrop ? 0.25 : 0);

    for (let i = 0; i < count; i++) {
        const mh  = movingHeadObjects[i];
        const hs  = mh.headState;
        
        dummy.scale.set(1, 1, 1);

        // ── PAN spring (left/right sweep) ─────────────────────────────
        const panStagger  = (i * 0.41 + (i % 7) * 0.27);
        const panTarget = Math.sin(pTime * 0.55 + panStagger) * Math.PI * 0.7 * sweepAmp;
        const panAcc = (panTarget - hs.pan) * spring;
        hs.panVel = (hs.panVel + panAcc) * damp;
        hs.pan   += hs.panVel;

        // ── TILT spring (up/down) — positive tilt = beam aims downward ──
        const tiltOsc  = Math.cos(pTime * 0.75 + i * 0.6 + panStagger * 0.5);
        let tiltTarget = tiltBase + tiltOsc * tiltAmp - tiltBuildUpMod;
        // Hard clamp: 0.05 rad (near-horizontal, toward audience) to 1.2 rad (steeply down)
        tiltTarget = Math.max(0.05, Math.min(1.2, tiltTarget + kick * 0.15));

        const tiltAcc = (tiltTarget - hs.tilt) * spring;
        hs.tiltVel = (hs.tiltVel + tiltAcc) * damp;
        hs.tilt   += hs.tiltVel;

        // ── ADSR envelope ─────────────────────────────────────────────
        if (beatState.isTransient) hs.adsrState = 1.0;
        else hs.adsrState = Math.max(energy * 0.18, hs.adsrState * 0.87);

        // ── Opacity ───────────────────────────────────────────────────
        let mhOp = 0;
        if (!playing || isSilent) {
            mhOp = 0.60 * activeMhIntensity;
        } else {
            mhOp = Math.min(1.0, vocals * 1.1 + drums * 0.45 + beatState.flashDecay * 0.45 + hs.adsrState * 0.6) * activeMhIntensity;
        }
        if (currentMode === 'studio') mhOp = Math.max(mhOp, 0.60);

        // ── Matrices (always absolute — no accumulation drift) ─────────
        // 1. Base housing (sits on truss)
        dummy.position.copy(mh.pos);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mhBaseIM.setMatrixAt(i, dummy.matrix);

        // 2. Yoke — pans around Y axis
        dummy.position.set(mh.pos.x, mh.pos.y - 0.05, mh.pos.z);
        dummy.rotation.set(0, hs.pan, 0);
        dummy.updateMatrix();
        mhYokeIM.setMatrixAt(i, dummy.matrix);

        // 3. Head (cylinder) — tilt pivots around local X after pan
        //    Euler order 'YXZ': first pan around world-Y, then tilt around body-X
        dummy.position.set(mh.pos.x, mh.pos.y - 0.55, mh.pos.z);
        dummy.rotation.set(hs.tilt, hs.pan, 0, 'YXZ');
        dummy.updateMatrix();
        mhHeadIM.setMatrixAt(i, dummy.matrix);

        // 4. Beam cone (same pivot as head)
        //    Beam geometry shoots along +Z; combined YXZ rotation sweeps it like a real MH.
        //    With tilt > 0 the beam is directed downward (–Y component) → hits the floor correctly.
        mhCoreIM.setMatrixAt(i, dummy.matrix);
        mhWashIM.setMatrixAt(i, dummy.matrix);

        // ── Colour (avoid new THREE.Color every frame) ────────────────
        if (CFG.theme === 'dynamic') {
            const hBase = sectionLaserHues[i % Math.max(sectionLaserHues.length, 1)] || (200 + i * 40 + t * 12) % 360;
            const h = (hBase + i * 3 + kick * 25) % 360;
            _col1.setHSL(h / 360, 0.95, 0.42 * mhOp + 0.04);
            _col2.copy(_col1).multiplyScalar(0.18);
        } else {
            const cols = CFG.themes[CFG.theme];
            _col1.set(cols[i % cols.length]);
            _col1.multiplyScalar(mhOp * 0.65 + 0.02);
            _col2.copy(_col1).multiplyScalar(0.2);
        }
        mhCoreIM.setColorAt(i, _col1);
        mhWashIM.setColorAt(i, _col2);
        colorDirty = true;

        if (mhOp > 0.05) {
            pushBeam(mh.pos.x, mh.pos.y - 0.55, mh.pos.z, hs.tilt, hs.pan, _col1, false);
        }
    }

    mhBaseIM.instanceMatrix.needsUpdate = true;
    mhYokeIM.instanceMatrix.needsUpdate = true;
    mhHeadIM.instanceMatrix.needsUpdate = true;
    mhCoreIM.instanceMatrix.needsUpdate = true;
    mhWashIM.instanceMatrix.needsUpdate = true;
    if (colorDirty) {
        mhCoreIM.instanceColor.needsUpdate = true;
        mhWashIM.instanceColor.needsUpdate = true;
    }
}

// ── Zone-aware choreographic laser pattern engine ─────────────────────────
// Each laser knows its 'zone' (front / side-left / side-right / corner / diagonal)
// and its 'baseYaw' (which way it naturally faces). The pattern engine computes
// a LOCAL pan (around the laser's own Y-axis) and LOCAL tilt (around X), then
// adds the baseYaw so side/corner units always sweep INTO the dancefloor.
//
// Pattern philosophy:
//  fan       – all beams spread into a horizontal fan, staggered by position
//  wave      – travelling sinusoidal ripple from left to right
//  xcross    – beams converge/diverge in pairs, forming X shapes
//  salvo     – lasers lock onto one target point then burst outward together
//  tunnel    – circular sweep giving a 'looking-into-tunnel' feel
//  sidesweep – slow horizontal scan synced to bass
//  strobe    – sharp freeze-frames driven by transient hits
//  scatter   – chaotic high-energy explosion (used during peak drops)

function updateInstancedLasers(t, tAnim, energy, bass, mid, high, kick, isPeakDrop, isSilent, section, melody, buildUp, skipPattern = false) {
    if (!laserCoreIM) return;
    let colorDirty = false;
    let activeIntensity = CFG.intensity;
    if (section && section.type === 'intro') {
        activeIntensity = 0.02;
    } else if (section && section.type === 'outro') {
        activeIntensity = 0.05;
    } else if (section && section.type === 'drop') {
        activeIntensity = Math.max(activeIntensity, 1.4);
    }
    const count = laserObjects.length;
    const pat   = section ? section.pattern  : 'fan';
    const liss  = section ? section.liss      : { xf: 0.5, yf: 0.5, zf: 0.5, xp:0, yp:0, zp:0 };
    const secSpread = section ? section.spreadMod : 1.0;
    const tiltRad   = THREE.MathUtils.degToRad(CFG.tilt ?? 20);

    // Build-up convergence – beams slowly narrow to centre before drop
    const buConverge  = buildUp > 0.45 ? (buildUp - 0.45) * 1.8 : 0;
    const energyBoost = Math.max(0, energy - 0.7) * (isPeakDrop ? 4.5 : 1.5);
    const sp = CFG.spread * secSpread * (1 + buildUp * 0.6 + energyBoost) * (1 - buConverge * 0.55);

    // Shared salvo target: all lasers converge on a slowly orbiting point,
    // then the drop explodes them outward again.
    const salvoT   = tAnim * 0.18 + liss.xp;
    const salvoX   = Math.sin(salvoT) * 0.45 + kick * 0.3;      // local tilt target
    const salvoZ   = Math.cos(salvoT * 0.7) * 0.3;              // local pan target

    // Tunnel: shared angular phase around Z, per-laser offset by wallNorm position
    const tunnelOmega = tAnim * (0.4 + energy * 0.6) * CFG.mhSpeed;

    const energyChaosBase = energy > 0.80 ? (energy - 0.80) * 5.0 * (isPeakDrop ? 3.0 : 0.6) : 0;
    const activity = isPeakDrop ? (0.4 + kick * 0.6) : kick;

    // Update GPU shader uniforms so the laser vertex and fragment shaders get real values!
    laserUniforms.uTime.value = tAnim;
    laserUniforms.uBass.value = bass;
    laserUniforms.uMid.value = mid;
    laserUniforms.uHigh.value = high;
    laserUniforms.uKick.value = kick;
    laserUniforms.uEnergy.value = energy;
    laserUniforms.uBuildUp.value = buildUp;
    laserUniforms.uSpread.value = CFG.spread * secSpread;
    laserUniforms.uTilt.value = THREE.MathUtils.degToRad(CFG.tilt ?? 20);
    laserUniforms.uIsPeakDrop.value = isPeakDrop ? 1.0 : 0.0;
    laserUniforms.uIsSilent.value = isSilent ? 1.0 : 0.0;
    laserUniforms.uPattern.value = PATTERN_IDS[pat] ?? 0;
    laserUniforms.uSalvoX.value = salvoX;
    laserUniforms.uSalvoZ.value = salvoZ;
    laserUniforms.uTunnelOmega.value = tunnelOmega;
    const transient = high > 0.8 ? (high - 0.8) * 5.0 : 0.0;
    laserUniforms.uMelody.value = melody;
    laserUniforms.uTransient.value = transient;
    laserUniforms.uPlaying.value = playing ? 1.0 : 0.0;
    laserUniforms.uEnergyChaosBase.value = energyChaosBase;
    laserUniforms.uActivity.value = activity;
    laserUniforms.uVariationPhase.value = variationPhase;
    laserUniforms.uIntensity.value = activeIntensity;
    laserUniforms.uFlashDecay.value = beatState.flashDecay;
    laserUniforms.uStrobeOn.value = beatState.strobeOn ? 1.0 : 0.0;
    laserUniforms.uIsStudioMode.value = (currentMode === 'studio') ? 1.0 : 0.0;
    laserUniforms.uIsDynamicTheme.value = (CFG.theme === 'dynamic') ? 1.0 : 0.0;
    laserUniforms.uLissXf.value = liss.xf;
    laserUniforms.uLissYf.value = liss.yf;
    laserUniforms.uLissZf.value = liss.zf;
    laserUniforms.uLissXp.value = liss.xp;
    laserUniforms.uLissYp.value = liss.yp;
    laserUniforms.uLissZp.value = liss.zp;
    laserUniforms.uLaserCount.value = count;

    // Sync the cloned uniforms to the actual materials so the shaders get them
    [laserCoreMaterial, laserTubeMaterial, laserSpotsMaterial].forEach(mat => {
        if (mat && mat.uniforms) {
            for (const key in laserUniforms) {
                if (mat.uniforms[key]) {
                    mat.uniforms[key].value = laserUniforms[key].value;
                }
            }
        }
    });

    for (let i = 0; i < count; i++) {
        const l    = laserObjects[i];
        const zone = l.zone     || 'front';
        const wn   = l.wallNorm ?? (i / Math.max(count - 1, 1)); // 0..1 position along truss
        const norm2 = wn * 2 - 1;                             // -1..1
        const iPhase = (i % 2 === 0) ? 1 : -1;
        const phaseOff = wn * Math.PI * 2;                    // per-laser unique phase
        const freqBias = playing ? melody : 0;

        // Per-laser Lissajous modifier (micro-variation by section)
        const vOff = variationPhase * 0.6283;
        const lSeed = liss.xp + i * 0.7391 + vOff;
        const vMod  = 1 + variationPhase * 0.09;
        const lxf = (liss.xf + (lSeed % 0.12))          * vMod;
        const lyf = (liss.yf + ((lSeed * 1.618) % 0.10)) * (2 - vMod);
        const lzf = (liss.zf + ((lSeed * 2.718) % 0.14)) * vMod;
        const lxp = liss.xp + phaseOff + vOff;
        const lyp = liss.yp + phaseOff * 0.7;
        const lzp = liss.zp + phaseOff * 1.3 + vOff * 0.5;

        // ── LOCAL pan / tilt in the laser's own reference frame ────────
        // localTilt > 0 = beam aims downward (into floor/crowd)
        // localPan  > 0 = beam swings left when viewed from behind the laser
        let localTilt = 0, localPan = 0;

        if (!skipPattern) {
            switch (pat) {
                // ─── FAN: classic horizontal fan ordered by truss position ───
                case 'fan': {
                    // Primary spread: pan across zone width, staggered by position
                    const fanSpeed = tAnim * lxf * 0.55;
                    localPan  = norm2 * 0.7 * sp * (1 - buConverge * 0.6)
                               + Math.sin(fanSpeed + lxp) * 0.18 * sp * (1 - buConverge)
                               + mid * 0.25 * iPhase;
                    // Tilt: gently nod up/down following bass beats
                    localTilt = tiltRad + 0.12 * sp
                               + Math.sin(tAnim * lyf * 0.4 + lyp) * 0.15 * sp
                               + bass * 0.22 * (1 + buildUp);
                    break;
                }
                // ─── WAVE: travelling left→right ripple ─────────────────────
                case 'wave': {
                    const travelPhase = tAnim * lxf * 0.9 - wn * Math.PI * 3.5;
                    localPan  = Math.sin(travelPhase) * 0.75 * sp
                               + mid * 0.2 * norm2;
                    localTilt = tiltRad
                               + Math.cos(tAnim * lyf * 0.5 + lyp) * 0.22 * sp
                               + high * 0.18;
                    break;
                }
                // ─── XCROSS: pairs converge & cross, forming X ──────────────
                case 'xcross': {
                    // Odd lasers sweep one way, even sweeps other, they cross at centre
                    const xSpeed = tAnim * lxf * 0.65;
                    localPan  = iPhase * Math.abs(Math.sin(xSpeed + lxp)) * 0.9 * sp * (1 - buConverge * 0.7)
                               + kick * norm2 * 0.6;
                    localTilt = tiltRad + 0.1
                               + Math.cos(tAnim * lyf * 0.3 + lyp) * 0.12 * sp;
                    break;
                }
                // ─── SALVO: all lock on one point, then burst outward ────────
                case 'salvo': {
                    // During build-up: converge strongly
                    // After drop: burst outward (norm2 * fan)
                    const converge = Math.max(buConverge, 0.35 + energy * 0.4);
                    localTilt = THREE.MathUtils.lerp(
                        tiltRad + norm2 * 0.4 * sp,  // burst
                        tiltRad + salvoX,             // converge
                        converge
                    );
                    localPan  = THREE.MathUtils.lerp(
                        norm2 * 0.8 * sp,             // burst fan
                        salvoZ,                        // converge
                        converge
                    );
                    break;
                }
                // ─── TUNNEL: circular sweep — looks like flying into a tunnel ─
                case 'tunnel': {
                    const angle = tunnelOmega + wn * Math.PI * 2;
                    const radius = 0.4 * sp * (1 - buConverge * 0.5);
                    localPan  = Math.sin(angle) * radius;
                    localTilt = tiltRad + (1 - Math.cos(angle)) * radius * 0.5 + 0.1;
                    break;
                }
                // ─── SIDESWEEP: slow scan across dance floor ─────────────────
                case 'sidesweep': {
                    const sweep = Math.sin(tAnim * lzf * 0.5 + lzp + wn * 0.8) * 0.85 * sp;
                    localPan  = sweep + bass * iPhase * 0.35;
                    localTilt = tiltRad + Math.sin(tAnim * lyf * 0.25 + lyp) * 0.15 * sp;
                    break;
                }
                // ─── VORTEX: Spinning motion for synthwave theme / spiral effect ─
                case 'vortex': {
                    const vortexSpeed = tAnim * 2.0;
                    const radius = 0.5 * sp;
                    // Creates a spinning circle that spirals slightly with frequency
                    localPan  = Math.sin(vortexSpeed + phaseOff) * radius * (1 + bass * 0.5) + norm2 * 0.3;
                    localTilt = tiltRad + Math.cos(vortexSpeed + phaseOff) * radius * (1 + mid * 0.5);
                    // Add subtle energy-reactive shake
                    if (energy > 0.6) {
                        localPan += (Math.random() - 0.5) * energy * 0.1;
                        localTilt += (Math.random() - 0.5) * energy * 0.1;
                    }
                    break;
                }
                // ─── STROBE: static positions with hard flicker ──────────────
                case 'strobe': {
                    const strobeVar = isPeakDrop ? Math.floor(tAnim * 8) : 0;
                    localPan  = Math.sin(lxp + vOff + strobeVar * 2.1) * norm2 * (isPeakDrop ? 1.3 : 0.6) * sp;
                    localTilt = tiltRad + Math.cos(lzp + wn * Math.PI + vOff + strobeVar * 1.7) * (isPeakDrop ? 0.7 : 0.35) * sp;
                    break;
                }
                // ─── SCATTER: chaos – used during peak drops ─────────────────
                case 'scatter': {
                    const scatterSpeed = isPeakDrop ? 4.5 : 1.4;
                    const scatterWarp = isPeakDrop ? 2.5 : 1.0;
                    localPan  = Math.sin(tAnim * lxf * scatterSpeed + lxp) * 1.2 * sp * scatterWarp
                               + Math.cos(tAnim * lyf * scatterSpeed * 0.8 + lyp) * 0.6 * sp * scatterWarp
                               + freqBias * 0.6 * iPhase;
                    localTilt = tiltRad
                               + Math.sin(tAnim * lzf * scatterSpeed * 0.9 + lzp) * 0.9 * sp * scatterWarp;
                    break;
                }
                // ─── LIQUID: Fluid, overlapping sine waves for Ocean theme ───
                case 'liquid': {
                    const liquidSpeed = tAnim * 0.8;
                    const wave1 = Math.sin(liquidSpeed + wn * Math.PI * 2.0);
                    const wave2 = Math.cos(liquidSpeed * 1.3 + phaseOff * 0.5);
                    localPan = (wave1 * 0.6 + wave2 * 0.4) * sp;
                    localTilt = tiltRad + (Math.sin(liquidSpeed * 0.7 + phaseOff) * 0.3) * sp + (mid * 0.1);
                    break;
                }
                // ─── DNA: Double Helix for neoncity theme ────────────────────
                case 'dna': {
                    const strand = i % 2 === 0 ? 1 : -1;
                    const dnaPhase = tAnim * lxf * 1.5 + wn * Math.PI * 6.0;
                    localPan  = Math.sin(dnaPhase) * 0.6 * sp * strand + mid * 0.1;
                    localTilt = tiltRad + Math.cos(dnaPhase) * 0.4 * sp * strand + bass * 0.2;
                    break;
                }
                // ─── CYBERTRON-SCAN: Grid scanning effect for cybertron theme ───
                case 'cybertron-scan': {
                    const scanSpeed = tAnim * 2.0;
                    const scanWidth = 0.6 * sp;
                    const sweep = Math.sin(scanSpeed + wn * Math.PI) * scanWidth;
                    localPan = sweep;
                    localTilt = tiltRad + Math.cos(scanSpeed * 1.5 + wn * Math.PI) * 0.2 * sp * (1 + bass * 0.4);
                    break;
                }
                // ─── SUPERNOVA: Cosmic expanding/contracting effect ──────────
                case 'supernova': {
                    const novaSpeed = tAnim * 2.5;
                    const expandRadius = 0.3 + Math.sin(novaSpeed * 0.5) * 0.7; // Breathing expansion
                    const angle = novaSpeed + (i / CFG.laserCount) * Math.PI * 8; // Bursting angles
                    localPan = Math.cos(angle) * expandRadius * sp * (1 + buildUp * 0.5);
                    localTilt = tiltRad + Math.sin(angle) * expandRadius * sp * (1 + buildUp * 0.5);

                    if (energy > 0.8) {
                        localPan += (Math.random() - 0.5) * 0.1;
                        localTilt += (Math.random() - 0.5) * 0.1;
                    }
                    break;
                }
                // ─── QUASAR-SPIN: Fast expanding/contracting spin for quasar theme ──
                case 'quasar-spin': {
                    const spinSpeed = tAnim * 3.5;
                    const expandRadius = 0.3 * sp + bass * 0.8 * sp;
                    const angle = spinSpeed + (i / CFG.laserCount) * Math.PI * 8.0;
                    localPan = Math.cos(angle) * expandRadius + (kick * (Math.random() - 0.5) * 0.5);
                    localTilt = tiltRad + Math.sin(angle) * expandRadius + (kick * (Math.random() - 0.5) * 0.5);
                    break;
                }
                // ─── RADIOACTIVE: Jittery, oozing motion for toxic theme ─────────
                case 'radioactive': {
                    const oozeSpeed = tAnim * 1.5;
                    const jitterX = energy > 0.6 ? (Math.random() - 0.5) * 0.1 * sp : 0;
                    const jitterY = energy > 0.6 ? (Math.random() - 0.5) * 0.1 * sp : 0;
                    localPan = norm2 * 0.7 * sp + Math.sin(oozeSpeed + phaseOff * 2.0) * 0.3 * sp + jitterX;
                    localTilt = tiltRad + Math.cos(oozeSpeed * 0.8 + norm2 * Math.PI) * 0.3 * sp + jitterY + bass * 0.2;
                    break;
                }
                // ─── OCEAN-WAVE: Gentle rolling wave for ocean theme ─────────
                case 'ocean-wave': {
                    const waveSpeed = tAnim * 1.5;
                    const waveAmplitude = 0.8 * sp;
                    // Creates a rolling wave effect across the lasers
                    localPan = norm2 * 0.8 * sp + Math.sin(waveSpeed + phaseOff * 0.5) * waveAmplitude * 0.3;
                    localTilt = tiltRad + Math.sin(waveSpeed * 0.8 + norm2 * Math.PI) * waveAmplitude * (1 + bass * 0.3);
                    break;
                }
                // ─── AURORA-FLOW: Ethereal flowing pattern for aurora theme ─────────
                case 'aurora-flow': {
                    const flowSpeed = tAnim * 0.5;
                    // Creates a smooth, sweeping vertical/horizontal ribbon effect
                    localPan = norm2 * sp + Math.sin(flowSpeed + lxf * 2.0) * 0.6 * sp;
                    localTilt = tiltRad + (Math.sin(flowSpeed * 1.2 + lyf * Math.PI) * 0.4 + Math.cos(flowSpeed * 0.8 + lzf * 2.0) * 0.3) * sp * (1 + energy * 0.2);
                    break;
                }
                // ─── TOXIC-SPILL: Oozing, irregular bubbling movement ────────
                case 'toxic-spill': {
                    const spillSpeed = tAnim * 0.6;
                    // Chaotic oozing effect combining multiple frequencies
                    const bubble = Math.sin(spillSpeed * 2.5 + phaseOff * 3.0) * 0.2 * bass;
                    localPan = norm2 * 0.7 * sp + Math.sin(spillSpeed + phaseOff) * 0.4 * sp + bubble;
                    localTilt = tiltRad + Math.cos(spillSpeed * 0.7 + wn * Math.PI) * 0.3 * sp + bubble;
                    break;
                }
                // ─── SINE: Smooth mathematical sine wave ───────────────────
                case 'sine': {
                    const waveT = tAnim * lxf * 1.2 + wn * Math.PI * 4.0;
                    localPan = Math.sin(waveT) * 0.6 * sp;
                    localTilt = tiltRad + Math.cos(waveT * 0.8) * 0.2 * sp;
                    break;
                }
                // ─── CHASE etc. movements ──────────────────────────────
                case 'chase':
                case 'chase-fast': {
                    localPan = norm2 * 0.6 * sp;
                    localTilt = tiltRad + Math.sin(tAnim * lyf * 0.5 + wn * Math.PI * 2) * 0.15 * sp;
                    break;
                }
                // ─── ZIGZAG: sharp alternating tilts ─────────────────────
                case 'zigzag': {
                    localPan = norm2 * 0.8 * sp + iPhase * Math.sin(tAnim * 2.5) * 0.2 * sp;
                    localTilt = tiltRad + iPhase * 0.25 * sp;
                    break;
                }
                // ─── SPARKLE / PULSE ─────────────────────────────────────
                case 'sparkle':
                case 'pulse': {
                    localPan = Math.sin(lxp + vOff + tAnim * 0.1) * norm2 * 0.7 * sp;
                    localTilt = tiltRad + Math.cos(lzp + wn * Math.PI) * 0.3 * sp;
                    break;
                }
                // ─── STARBURST ───────────────────────────────────────────
                case 'starburst': {
                    localPan = Math.sin(tAnim * lxf * 3.0 + lxp) * 1.5 * sp * (isPeakDrop ? 2.0 : 1.0);
                    localTilt = tiltRad + Math.cos(tAnim * lyf * 3.0 + lyp) * 0.8 * sp;
                    break;
                }
                // ─── FLAME: Fire-like movement for Inferno theme ─────────────
                case 'flame': {
                    const flameSpeed = tAnim * 2.0;
                    localPan = norm2 * 0.5 * sp + Math.sin(flameSpeed + wn * 10.0) * 0.1 * sp;
                    localTilt = tiltRad + (Math.sin(flameSpeed * 2.5 + wn * 5.0) * 0.5 + 0.5) * 0.3 * sp;
                    break;
                }
                case 'eclipse': {
                    const eclipseSpeed = tAnim * 1.5;
                    const eclipseRadius = 0.4 * sp;
                    localPan = Math.sin(eclipseSpeed + i * 0.5) * eclipseRadius + norm2 * 0.5 * sp;
                    localTilt = tiltRad + Math.cos(eclipseSpeed + i * 0.5) * eclipseRadius;
                    break;
                }
                case 'glacier': {
                    const iceSpeed = tAnim * 0.4;
                    const freezeRadius = 0.5 * sp;
                    localPan = Math.sin(iceSpeed + i * 0.2) * freezeRadius + norm2 * 0.3 * sp;
                    localTilt = tiltRad + Math.cos(iceSpeed * 0.8 + lyp) * freezeRadius * 0.5 + 0.1 * sp;
                    break;
                }
                case 'hexagon': {
                    const hexSpeed = tAnim * 1.5;
                    const radius = 0.4 * sp * (1.0 + kick * 0.5);
                    const angle = hexSpeed + Math.floor(wn * 6.0) * (Math.PI / 3.0);
                    localPan = Math.cos(angle) * radius + norm2 * 0.2 * sp;
                    localTilt = tiltRad + Math.sin(angle) * radius;
                    break;
                }
                case 'blood-sweep': {
                    const sweep = Math.sin(tAnim * 2.0 + norm2 * Math.PI);
                    localPan = sweep * sp * 1.5;
                    localTilt = tiltRad + Math.cos(tAnim * 4.0) * 0.2 + bass * 0.3;
                    break;
                }
                case 'starlight': {
                    const driftX = tAnim * lxf * 0.1;
                    const driftY = tAnim * lyf * 0.15;
                    localPan = norm2 * 0.9 * sp + Math.sin(driftX + lxp) * 0.2 * sp;
                    localTilt = tiltRad + Math.cos(driftY + lyp) * 0.15 * sp - 0.1;
                    break;
                }
                default: {
                    localTilt = tiltRad;
                    localPan  = norm2 * 0.5;
                }
            }

            // ── Peak-drop chaos overlay – adds controlled jitter at climax ──
            if (energyChaosBase > 0) {
                localPan  += Math.sin(tAnim * 45 + i * 2.1) * 0.8 * energyChaosBase * activity;
                localTilt += Math.cos(tAnim * 53 + i * 2.7) * 0.5 * energyChaosBase * activity;
            }

            // ── Convert local pan/tilt to world Euler (YXZ order) ──────────
            // baseYaw rotates the entire laser to face the dancefloor
            // (front = 0, side-left = +π/2, side-right = -π/2, corners = atan2)
            const yaw = (l.baseYaw || 0) + localPan;
            const pitchX = localTilt;   // tilt rotates the beam down toward the floor

            // Lerp speed: faster on beat, slower during silences
            let ls = 0.055
                   + (freqBias || 0) * 0.08
                   + (beatState.isBeat ? 0.18 : 0)
                   + (energy > 0.78 ? 0.2 * kick : 0);
            ls = Math.min(ls, 0.92);

            if (section && section.type === 'buildup') {
                // Focus on DJ booth: (0, 1.2, -20)
                const targetX = 0;
                const targetY = 1.2;
                const targetZ = -20;
                const dx = targetX - l.pos.x;
                const dy = targetY - l.pos.y;
                const dz = targetZ - l.pos.z;
                const dXZ = Math.sqrt(dx * dx + dz * dz);
                
                let buildupYaw = Math.atan2(dx, dz);
                let buildupPitch = -Math.atan2(dy, dXZ);

                // Add dynamic organic vibration wobble
                const wobbleSpeed = tAnim * 4.0 + i * 0.1;
                buildupYaw += Math.sin(wobbleSpeed) * 0.03 * (0.2 + energy * 0.8);
                buildupPitch += Math.cos(wobbleSpeed * 1.3) * 0.02 * (0.2 + energy * 0.8);

                l.rot.x = THREE.MathUtils.lerp(l.rot.x, buildupPitch, 0.08);
                l.rot.y = THREE.MathUtils.lerp(l.rot.y, buildupYaw, 0.08);
                l.rot.z = 0;
            } else {
                l.rot.x = THREE.MathUtils.lerp(l.rot.x, pitchX, ls);
                l.rot.y = THREE.MathUtils.lerp(l.rot.y, yaw,    ls);
                l.rot.z = 0; // unused for zone-aware system
            }
        }

        // ── Opacity ─────────────────────────────────────────────────────
        let patternOpMod = 1.0;
        if (!skipPattern && !isSilent) {
            if (pat === 'chase') {
                // Moderate chase based on spatial arrangement
                const chasePos = (tAnim * 0.45) % 1.0;
                patternOpMod = Math.abs(wn - chasePos) < 0.15 ? 1.0 : 0.0;
            } else if (pat === 'chase-fast') {
                // Extremely fast chase
                const chasePos = (tAnim * 1.8) % 1.0;
                patternOpMod = Math.abs(wn - chasePos) < 0.25 ? 1.0 : 0.0;
            } else if (pat === 'sparkle') {
                // Random sparkle per laser
                patternOpMod = (Math.sin(tAnim * 17.3 + i * 21.1) > 0.85) ? 1.0 : 0.0;
            } else if (pat === 'pulse') {
                // Alternate breathing
                patternOpMod = 0.5 + Math.sin(tAnim * 2.0 + iPhase * Math.PI) * 0.5;
            } else if (pat === 'starburst') {
                patternOpMod = (Math.sin(tAnim * 12.0 + i * 5.0) > 0.5) ? 1.0 : 0.2;
            } else if (pat === 'strobe' && !beatState.strobeOn && playing) {
                patternOpMod = 0.0;
            } else if (pat === 'liquid') {
                // Smooth undulating opacity
                patternOpMod = 0.6 + Math.sin(tAnim * 1.5 + phaseOff) * 0.4;
            } else if (pat === 'starlight') {
                patternOpMod = 0.4 + (Math.sin(tAnim * 3.0 + i * 11.0) * Math.sin(tAnim * 1.5 + i * 3.7)) * 0.6;
            } else if (pat === 'cybertron-scan') {
                const scanPos = (tAnim * 1.5) - Math.floor(tAnim * 1.5);
                patternOpMod = Math.abs(wn - scanPos) < 0.15 ? 1.0 : 0.2;
            }
        }

        const freqBiasOp = playing ? melody : 0;
        let op = isSilent
            ? ((!playing && isSilent) ? 0.3 : 0.0) // Keep minimum visibility of 0.3 if idle so the app doesn't look black
            : patternOpMod * Math.min(1, 0.08 * activeIntensity + (freqBiasOp || 0) * 1.1 + energy * 0.6 + buildUp * 0.4 + beatState.flashDecay * 0.9);
            
        if (section && section.type === 'intro') {
            op *= 0.02; // extremely dim
        } else if (section && section.type === 'outro') {
            op *= 0.05; // fade out in outro
        }
        
        if (currentMode === 'studio') op = Math.max(op, 0.5);

        // ── Matrices (always absolute – no accumulation) ─────────────────
        // Body: just sits at position, no rotation
        dummy.position.copy(l.pos);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        laserBodyIM.setMatrixAt(i, dummy.matrix);

        // Beam: position + YXZ euler (handled on GPU shader)
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        laserCoreIM.setMatrixAt(i, dummy.matrix);
        laserTubeIM.setMatrixAt(i, dummy.matrix);

        // ── Colour ──────────────────────────────────────────────────────
        if (CFG.theme === 'dynamic') {
            const h = (sectionLaserHues[i] ?? (i * 360 / count)) % 360;
            _col1.setHSL(h / 360, 0.85, 0.5 * op + 0.02);
            _col2.copy(_col1).multiplyScalar(0.3);
        } else {
            const cols = CFG.themes[CFG.theme];
            _col1.set(cols[i % cols.length]);
            _col1.multiplyScalar(op * 0.9 + 0.02);
            _col2.copy(_col1).multiplyScalar(0.3);
        }
        laserCoreIM.setColorAt(i, _col1);
        laserTubeIM.setColorAt(i, _col2);
        colorDirty = true;

        if (op > 0.05) {
            pushBeam(l.pos.x, l.pos.y, l.pos.z, l.rot.x, l.rot.y, _col1, true);
        }
    }

    laserBodyIM.instanceMatrix.needsUpdate = true;
    laserCoreIM.instanceMatrix.needsUpdate = true;
    laserTubeIM.instanceMatrix.needsUpdate = true;
    if (colorDirty && laserCoreIM.instanceColor) laserCoreIM.instanceColor.needsUpdate = true;
    if (colorDirty && laserTubeIM.instanceColor) laserTubeIM.instanceColor.needsUpdate = true;
}


// ── Dynamic FPS LOD State ─────────────
let recentFPS = [];
let currentLODLevel = 0; // 0 = High, 1 = Medium, 2 = Low
let lodCheckTimer = 0;
let lodShadowDwell = 0;              // seconds since the last shadow on/off switch
const LOD_SHADOW_DWELL_S = 6;        // minimum settle time before switching again

function updateDynamicLOD(dt) {
    if (!dt || dt === 0) return;
    const fps = 1 / dt;
    recentFPS.push(fps);
    if (recentFPS.length > 60) recentFPS.shift(); // 60 frames average

    lodShadowDwell += dt;
    lodCheckTimer += dt;
    if (lodCheckTimer > 1.0) { // Check every 1 second
        let avgFPS = recentFPS.reduce((a, b) => a + b, 0) / recentFPS.length;
        
        let newLOD = currentLODLevel;
        if (avgFPS < 35) {
            newLOD = Math.min(2, currentLODLevel + 1); // Downgrade
        } else if (avgFPS > 55) {
            newLOD = Math.max(0, currentLODLevel - 1); // Upgrade
        }
        
        // Turning shadows on or off invalidates every material's shader program,
        // so a level change that crosses that boundary has to settle before the
        // next one is allowed. Without this the renderer thrashes recompiles
        // right around the 35/55 fps thresholds.
        const crossesShadowBoundary =
            (SHADOW_MAP_SIZES[newLOD] > 0) !== (SHADOW_MAP_SIZES[currentLODLevel] > 0);
        if (crossesShadowBoundary && lodShadowDwell < LOD_SHADOW_DWELL_S) {
            newLOD = currentLODLevel;
        }

        if (newLOD !== currentLODLevel) {
            currentLODLevel = newLOD;
            if (crossesShadowBoundary) lodShadowDwell = 0;
            setShadowQuality(currentLODLevel);
            // console.log('Dynamic LOD Level changed to:', currentLODLevel, 'Avg FPS:', avgFPS.toFixed(1));
            
            // Adjust bloom and flares globally
            const flareEl = document.getElementById('param-fx-flare');
            const crowdEl = document.getElementById('param-livecrowd');
            
            if (currentLODLevel === 2) { // Low
                // Disable flares
                if (flareEl && flareEl.checked) { flareEl.checked = false; flareEl.dispatchEvent(new Event('change')); }
                // Disable crowd
                if (crowdEl && crowdEl.checked) { crowdEl.checked = false; crowdEl.dispatchEvent(new Event('change')); }
            } else if (currentLODLevel === 1) { // Medium
                if (flareEl && flareEl.checked) { flareEl.checked = false; flareEl.dispatchEvent(new Event('change')); }
                if (crowdEl && !crowdEl.checked) { crowdEl.checked = true; crowdEl.dispatchEvent(new Event('change')); }
            } else if (currentLODLevel === 0) { // High
                if (flareEl && !flareEl.checked) { flareEl.checked = true; flareEl.dispatchEvent(new Event('change')); }
                if (crowdEl && !crowdEl.checked) { crowdEl.checked = true; crowdEl.dispatchEvent(new Event('change')); }
            }
        }
        lodCheckTimer = 0;
    }
}

// ── Frame error containment ──────────────────────────────────────────────────
// setAnimationLoop does not catch exceptions: a single throw anywhere in the
// frame stops the loop for good and leaves the canvas black with no explanation.
// That has already happened once during development, so the frame body is now
// wrapped. Errors are reported, the loop survives, and the scene still renders
// through a minimal path so the user sees the show instead of a black rectangle.
let frameErrorCount = 0;
let frameErrorShown = false;

function reportFrameError(e) {
    frameErrorCount++;
    if (frameErrorCount <= 3) {
        console.error(`Render loop error (frame ${frameCount}):`, e);
    } else if (frameErrorCount === 4) {
        console.error('Further render loop errors suppressed.');
    }
    if (!frameErrorShown && typeof document !== 'undefined') {
        frameErrorShown = true;
        const bar = document.createElement('div');
        bar.id = 'render-error-bar';
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
            'background:#7a1020;color:#fff;font:12px/1.5 system-ui,sans-serif;padding:8px 12px;';
        bar.textContent = 'Rendering error: ' + (e && e.message ? e.message : String(e)) +
            ' — the view keeps running in a reduced mode. See the browser console (F12) for details.';
        document.body.appendChild(bar);
    }
}

function animate() {
    try {
        animateFrame();
    } catch (e) {
        reportFrameError(e);
        // Keep something on screen even if the full frame path is broken.
        try {
            const cam = isStageBuilderMode ? builderCamera : camera;
            renderer.render(scene, cam);
        } catch (_) { /* renderer itself is gone; nothing more we can do */ }
    }
}

function animateFrame() {
  // Using setAnimationLoop below instead of requestAnimationFrame
  if (photoModeManager.isActive) {
      lastFrameTs = 0; // resume cleanly instead of jumping by the whole pause
      return;
  }

  // ── Real frame delta ────────────────────────────────────────
  // Offline (video export) rendering advances by a deterministic fixed step so
  // the exported file is identical regardless of how fast the encoder runs.
  if (isOfflineRendering) {
      frameDelta = FIXED_STEP;
      lastFrameTs = 0;
  } else {
      const nowTs = performance.now();
      if (lastFrameTs === 0) {
          frameDelta = FIXED_STEP;
      } else {
          frameDelta = Math.min((nowTs - lastFrameTs) / 1000, MAX_STEP);
      }
      lastFrameTs = nowTs;
  }
  deltaScale = frameDelta / FIXED_STEP;
  smoothedFPS += ((1 / Math.max(frameDelta, 1e-4)) - smoothedFPS) * 0.05;

  frameCount++;
  resetBeamPool();

  // renderer.info resets itself at the start of every render() call. The composer
  // issues several per frame, so the automatic counter only ever reports the last
  // fullscreen pass. Reset once per frame instead and the numbers become the real
  // per-frame totals (including the shadow-map passes).
  if (renderer.info && renderer.info.autoReset) renderer.info.autoReset = false;
  if (renderer.info && renderer.info.reset) renderer.info.reset();

  // Lazy Loading Stage Builder Staggered Execution
  if (stageBuildQueue.length > 0) {
      const itemsToBuild = Math.min(3, stageBuildQueue.length);
      for (let i = 0; i < itemsToBuild; i++) {
          const action = stageBuildQueue.shift();
          if (action) action();
      }
      shadowFlagsDirty = true;
  } else if (shadowFlagsDirty) {
      // The stage is built in chunks across several frames, so the cast/receive
      // flags are applied once the queue has actually drained.
      shadowFlagsDirty = false;
      // This walks scene objects built by several different code paths. A throw
      // here would happen inside the render loop and blank the screen, so it is
      // contained — shadow flags are cosmetic, the show must keep running.
      try {
          applyShadowFlags();
      } catch (e) {
          console.warn('applyShadowFlags failed; continuing without updated shadow flags:', e);
      }
  }

  // Distance-Based Level of Detail (LOD) check every 15 frames
  if (frameCount % 15 === 0) {
      if (liveCrowdEnabled && crowdObjects.length > 0) {
          crowdObjects.forEach(c => {
              const dist = c.mesh.position.distanceTo(camera.position);
              if (dist > 75) {
                  c.mesh.visible = false;
                  c.lod = 2;
              } else if (dist > 45) {
                  c.mesh.visible = true;
                  c.lod = 1;
              } else {
                  c.mesh.visible = true;
                  c.lod = 0;
              }
          });
      }
      if (stageGroup) {
          stageGroup.children.forEach(child => {
              child.getWorldPosition(_stageWorldPos);
              const dist = _stageWorldPos.distanceTo(camera.position);
              child.visible = dist <= 110;
          });
      }
  }

  controls.update();

  // Basic t increment always moving for UI/Background noise
  t += 0.6 * frameDelta;

  // Shared audio values accessible by pyro update (filled in Live mode check)
  let _pyroEnergy = 0.1, _pyroBass = 0.1, _pyroMid = 0.1, _pyroHigh = 0.1, _pyroKick = 0, _pyroIsPeak = false;

  if (analyser && playing && currentMode === 'live') {
    analyser.getByteFrequencyData(dataArray); drawViz();
  } else if (currentMode === 'live') {
    vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  }

  // ── Move Pyrotechnik Update to a Safe Global Spot in animate() ──
  if (pyroEnabled && !isOfflineRendering) {
      const dt = frameDelta; // real elapsed time
      pyroSystems.forEach(ps => {
          const isFlame = ps.type === 'flame';
          const isSpark = ps.type === 'spark';
          if ((isFlame && !pyroFlameEnabled) || (isSpark && !pyroSparkEnabled) || ps.isUpdating) {
              ps.points.visible = false;
              return;
          }
          ps.points.visible = true;
          ps.update(
              dt, t,
              _pyroEnergy, _pyroBass, _pyroMid, _pyroHigh, _pyroKick,
              CFG.windX || 0, CFG.windY || 0, CFG.pyroIntensity || 1.0,
              _pyroIsPeak
          );
      });
  } else if (!pyroEnabled) {
      pyroSystems.forEach(ps => { ps.points.visible = false; });
  }

  // ── Real-time FFT bands (Live mode) ─────────────────────────
  let rtSubBass = 0, rtBass = 0, rtKick = 0, rtMid = 0, rtHigh = 0, rtEnergy = 0;
  if (currentMode === 'live' && analyser && playing) {
      // fftSize = 2048 -> each bin is 44100 / 2048 ≈ 21.5 Hz
      rtSubBass = avgRange(dataArray,  0,   2);   // 0 - 43 Hz
      rtBass    = avgRange(dataArray,  0,  20);   // 0 - 430 Hz
      rtKick    = avgRange(dataArray,  2,   8);   // 43 - 172 Hz (Standard Kick)
      rtMid     = avgRange(dataArray, 20, 140);   // 430 - 3000 Hz
      rtHigh    = avgRange(dataArray, 320, 512);  // 6880 - 11000 Hz
      rtEnergy  = rtBass * 0.5 + rtMid * 0.3 + rtHigh * 0.2;
  }
  const isSilent = playing ? (rtEnergy < 0.04) : true;

  // ── Song-map frame lookup (Stems) ────────────────────────────
  const frame   = playing ? getSongFrame()      : null;
  const section = playing ? getCurrentSection() : null;

  if (playing && autoSyncLyrics && songMap) {
      const now = getPlaybackTime();
      let currentLyricObj = null;
      if (songMap.songLyrics && songMap.songLyrics.length > 0) {
          for (let i = songMap.songLyrics.length - 1; i >= 0; i--) {
              const lyric = songMap.songLyrics[i];
              if (now >= lyric.timestamp[0]) {
                  if (lyric.timestamp[1] === null || now <= lyric.timestamp[1] + 1.5) {
                      currentLyricObj = lyric;
                  }
                  break;
              }
          }
      }

      const targetText = currentLyricObj ? currentLyricObj.text.trim().toUpperCase() : ' ';
      if (laserWriterText !== targetText) {
          laserWriterText = targetText;
          const el = document.getElementById('param-laserwriter-text');
          if (el) el.value = targetText;
          compileScannerPoints();
      }
  }

  if (playing && section) {
      const secId = (section.id !== undefined) ? section.id : 0;
      if (secId !== lastActiveSecIdForTrigger) {
          lastActiveSecIdForTrigger = secId;
          
          if (section.type === 'drop') {
              const secName = (section.id !== undefined) ? `section ${section.id}` : 'fallback section';
              console.log(`🔥 [Deep-AI Show Generator] DROP DETECTED at ${secName} — firing pyro, sparks and CO2 jets`);
              triggerFogJet(-28, 0.2, -22, 1.5, 0.4, 0.4);
              triggerFogJet(28, 0.2, -22, -1.5, 0.4, 0.4);
              triggerFogJet(-12, 0.2, -25, 0.5, 0.6, 0.4);
              triggerFogJet(12, 0.2, -25, -0.5, 0.6, 0.4);
              
              pyroEnabled = true;
              const elPyro = document.getElementById('param-pyro');
              if (elPyro) elPyro.checked = true;

              beatState.flashDecay = 1.0;
              beatState.strobeOn = true;
          }
      }
  }

  const bass   = frame ? frame.bass   * 0.45 + rtBass  * 0.55 : rtBass;
  const vocals = frame ? frame.vocals * 0.9  + rtMid   * 0.1  : rtMid;
  const drums  = frame ? frame.drums  * 0.6  + rtHigh  * 0.4  : rtHigh;
  const melody = frame ? frame.melody * 0.8  + rtMid   * 0.2  : rtMid;
  const kick   = rtKick;
  const energy = frame ? frame.energy * 0.4  + rtEnergy * 0.6 : rtEnergy;
  
  // Aliases to prevent crash in legacy pattern logic
  const mid = vocals;
  const high = drums;
  
  // Expose to pyro
  _pyroBass = bass; _pyroMid = mid; _pyroHigh = high; _pyroKick = kick; _pyroEnergy = energy;
  _pyroIsPeak = (playing && peakModeEnabled && (energy > 0.82 || rtSubBass > 0.75) && ((frame && frame.energy > 0.75) || rtEnergy > 0.75 || rtSubBass > 0.75))
             || (playing && section && section.type === 'drop' && energy > 0.5);

  // ── Build-up strength ─────────────────────────────────────────
  const buildUp = (frame && songMap && songMap.buildUpMap)
    ? songMap.buildUpMap[frame.f] : 0;
    
  // ── Absolute Drop Peak (Maximum Chaos Level) ───────────
  const isPeakDrop = playing && peakModeEnabled && (energy > 0.85 || rtSubBass > 0.8) && buildUp < 0.2;

  // ── Section-driven parameters ─────────────────────────────────
  // secPat is now determined by the LIVE intelligent pattern decider,
  // not just frozen at analysis time. Section baseline still feeds in.
  const secPat    = livePatternDecider(bass, mid, high, energy, kick, buildUp, melody, drums, section, isPeakDrop, isSilent);
  const liss      = section ? section.liss       : makeLissajous(0);
  const secSpeed  = section ? section.speedScale : 1.0;
  const secSpread = section ? section.spreadMod  : 1.0;

  // ── BPM-locked dynamic beat phase ─────────────────────────────
  // Instead of strictly locking to absolute time, we accumulate phase
  // with a dynamic multiplier based on audio energy, bass and kick hits.
  const rawBeatPhase = getBeatPhase();
  const bpmBeatPhase = rawBeatPhase;
  const phaseDelta = rawBeatPhase - lastRawBeatPhase;
  lastRawBeatPhase = rawBeatPhase;

  if (phaseDelta < 0 || phaseDelta > 1 || !playing) {
      // Reset accumulator if user scrubbed the timeline or looped
      dynamicBeatPhase = rawBeatPhase;
  } else {
      // Map energy (0..1) to a speed multiplier
      // Low energy = slow (0.3x), High energy = fast (up to 2.5x+)
      const energyMultiplier = Math.pow(energy, 1.5) * 2.0 + 0.3;
      
      // Additional bursts of speed on heavy bass and kicks
      const bassBoost = 1.0 + (bass * 2.0);
      const transientBoost = beatState.speedMult; // Uses real-time peak info (from 1.0 to 5.5)

      // Normalize keeping average speed pleasing, honoring UI speed scale
      let dynamicSpeed = CFG.speed * secSpeed * energyMultiplier * bassBoost * transientBoost * 0.35;
      
      // Cap maximum speed to avoid chaotic strobe-like movement
      dynamicSpeed = Math.min(dynamicSpeed, 8.0);
      
      dynamicBeatPhase += phaseDelta * dynamicSpeed;
  }

  // Blend: Dynamic BPM phase when playing a song, free-running otherwise
  const tAnim = (playing && songMap) ? dynamicBeatPhase * (Math.PI * 2 / 8) : t;

  // ── Section change → update target colors + variation ─────────
    if (section && section.id !== lastSectionId) {
      lastSectionId  = section.id;
      beatsInSection = 0;
      variationPhase = 0;
      
      // TV Mode Cut on Section Change
      if (tvModeEnabled) {
          currentTvCamIdx = (currentTvCamIdx + 1 + Math.floor(Math.random() * (tvCameras.length - 2))) % tvCameras.length;
          tvCutCooldown = 60; // long cooldown at section start
          justCut = true;
      }
      
      const n = laserObjects.length;
      if (CFG.theme === 'dynamic') {
         // Roles: 0=Bass, 1=Mid, 2=High
         for (let i = 0; i < n; i++) {
           let role = i % 3;
           let roleHueShift = role === 0 ? 0 : (role === 1 ? 120 : 240);
           targetSectionHues[i] = (section.baseHue + roleHueShift) % 360;
           if (sectionLaserHues[i] === undefined) sectionLaserHues[i] = targetSectionHues[i];
         }
      } else {
         for (let i = 0; i < n; i++) {
           targetSectionHues[i] = (section.baseHue + i * (360 / n)) % 360;
           if (sectionLaserHues[i] === undefined) sectionLaserHues[i] = targetSectionHues[i];
         }
      }
    }

    // ── Update beatsInSection + variationPhase ────────────────────
    if (playing && songMap && section) {
      const secBeatsNow = songMap.beats.filter(
        b => b.time >= section.startTime && b.time <= getPlaybackTime()
      ).length;
      if (secBeatsNow !== beatsInSection) {
        beatsInSection = secBeatsNow;
        variationPhase = Math.floor(beatsInSection / 16) % 4;
      }
    }

    // ── Video Color Extraction ───────────────────────────────
    let hasVideoColor = false;
    if (playing && videoObj && videoObj.readyState >= 2) {
      if (tAnim - lastVideoExtractT > 0.1) { // Max ~10 updates a sec to save perf
          lastVideoExtractT = tAnim;
          videoCtx.drawImage(videoObj, 0, 0, 16, 16);
          const px = videoCtx.getImageData(0, 0, 16, 16).data;
          
          let vibrantPx = [];
          for (let i = 0; i < px.length; i += 4) {
              const r = px[i]/255, g = px[i+1]/255, b = px[i+2]/255;
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              if (max < 0.1) continue; // skip too dark
              
              let h = 0, s = 0, l = (max + min) / 2;
              if (max !== min) {
                  const d = max - min;
                  s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                  switch(max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                  }
                  h /= 6;
              }
              if (s > 0.25 && l > 0.15) { // Only take vibrant, colorful pixels
                  vibrantPx.push({ h: h * 360, s, l, score: s * l });
              }
          }
          
          if (vibrantPx.length > 0) {
              // Sort by vibrancy score
              vibrantPx.sort((a,b) => b.score - a.score);
              let distinctHues = [];
              for (const v of vibrantPx) {
                  if (distinctHues.length >= 6) break;
                  let conflict = false;
                  // Ensure colors are visually distinct (at least 30 deg apart)
                  for (const dh of distinctHues) {
                      let dist = Math.abs(v.h - dh);
                      if (Math.min(dist, 360 - dist) < 30) { conflict = true; break; }
                  }
                  if (!conflict) distinctHues.push(v.h);
              }
              if (distinctHues.length === 0) distinctHues.push(vibrantPx[0].h);
              extractedVideoHues = distinctHues;
              videoBaseHue = distinctHues[0]; // keep fallback
          } else {
              extractedVideoHues = [];
          }
      }
      hasVideoColor = extractedVideoHues.length > 0;
    } else {
      hasVideoColor = false;
      extractedVideoHues = [];
    }

    // ── LED Screen Color Update ──────────────────────────
    if (ledScreenMat) {
       let kickFlash = beatState.isBeat ? 0.4 : 0;
       let reactiveIntensity = Math.min(1.0, energy * 0.8 + buildUp * 0.5 + kickFlash);
       
       let mixedIntensity = THREE.MathUtils.lerp(1.0, reactiveIntensity, CFG.screenReactivity);
       let targetIntensity = isSilent 
           ? ((!playing && isSilent) ? 0.25 : 0.0) 
           : (mixedIntensity * CFG.screenBrightness);
       
       if (videoObj) {
           ledScreenMat.color.setRGB(1.0, 1.0, 1.0);
       } else {
           if (CFG.theme === 'dynamic') {
               let baseH = section ? section.baseHue : (t * 50);
               let screenHex = hueToHex((baseH + t * 60) % 360, 0.95, 0.5);
               ledScreenMat.color.setHex(screenHex);
           } else {
               const cols = CFG.themes[CFG.theme];
               if (cols && cols.length > 0) {
                   const colorIdx = Math.floor(tAnim * 1.5) % cols.length;
                   ledScreenMat.color.setHex(cols[colorIdx]);
               } else {
                   ledScreenMat.color.setRGB(bass, mid, high);
               }
           }
       }
       ledScreenMat.color.multiplyScalar(targetIntensity);
    }

    // ── Smooth hue lerp toward targets (circular) ─────────────────
    const n = laserObjects.length;
    for (let i = 0; i < n; i++) {
      if (sectionLaserHues[i]  === undefined) sectionLaserHues[i]  = (i * 360 / n) % 360;
      
      // Override gracefully if video is loaded and themes are dynamic
      if (hasVideoColor && CFG.theme === 'dynamic') {
          targetSectionHues[i] = extractedVideoHues[i % extractedVideoHues.length];
      }
      
      if (targetSectionHues[i] === undefined) targetSectionHues[i] = sectionLaserHues[i];
      const dh = ((targetSectionHues[i] - sectionLaserHues[i] + 540) % 360) - 180;
      
      // If video is playing, lerp faster so colors adjust instantly with the visuals
      const lerxSpeed = hasVideoColor ? 0.08 : 0.014;
      sectionLaserHues[i] = (sectionLaserHues[i] + dh * lerxSpeed + 360) % 360;
    }
    updateShaderSectionHues();

    // ── Real-time beat detection ──────────────────────────────────
    if (playing) {
      if (beatState.beatCooldown > 0) beatState.beatCooldown--;
      const isBeat = detectBeat(bass) && beatState.beatCooldown === 0;
      beatState.isBeat = isBeat;
      beatState.isTransient = detectTransient(drums);
      
      if (tvCutCooldown > 0) tvCutCooldown--;
      
      if (isBeat) {
        beatState.beatCooldown = 11;
        beatState.speedMult    = 3.0 + kick * 2.5;
        beatState.flashDecay   = 1.0;
        // TV Mode Dynamic Cuts on Beat
        if (tvModeEnabled && tvCutCooldown === 0 && energy > 0.6 && Math.random() > 0.6) {
             currentTvCamIdx = (currentTvCamIdx + 1 + Math.floor(Math.random() * (tvCameras.length - 2))) % tvCameras.length;
             tvCutCooldown = 25; // wait ~25 frames before another cut
             justCut = true;
        }
      } else {
        beatState.speedMult = THREE.MathUtils.lerp(beatState.speedMult, 1.0, fLerp(0.07));
      }
      beatState.flashDecay = THREE.MathUtils.lerp(beatState.flashDecay, 0, fLerp(0.14));
      // Strobe toggles every `sRate` 60fps-frames — accumulate in those units so
      // the flash frequency stays constant on 120/144 Hz displays.
      const sRate = Math.max(2, Math.round(8 - energy * 10));
      const strobePrev = Math.floor(beatState.strobeTimer / sRate);
      beatState.strobeTimer += deltaScale;
      const strobeNow = Math.floor(beatState.strobeTimer / sRate);
      beatState.strobeOn = (secPat !== 'strobe') ? true
        : (strobeNow === strobePrev) ? beatState.strobeOn : !beatState.strobeOn;
    } else {
      beatState.speedMult = 1.0; beatState.flashDecay = 0; beatState.strobeOn = true;
    }

    // ── Free-running t (used as fallback + opacity) ───────────────
    // Basic increment already done at top, but we add music-reactive boost here if playing
    if (playing) {
        t += 0.6 * frameDelta * CFG.speed * secSpeed * (1.0 + bass * 2.0) * beatState.speedMult;
    }

    // ── Kamera-Bewegung (Camera-Shake) ────────────────────────────
    _camShake.set(0, 0, 0);
    if (currentMode === 'live' && peakModeEnabled && !droneEnabled) {
        // Organic, mechanical rumble instead of pure random noise
        const shakeInt = (beatState.isBeat || beatState.isTransient) ? kick * (autoCamEnabled ? 1.8 : 0.6) : 0;
        if (shakeInt > 0.02) {
            const sx = (Math.sin(t * 73) * 0.5 + Math.sin(t * 31) * 0.5) * shakeInt;
            const sy = (Math.cos(t * 62) * 0.5 + Math.sin(t * 47) * 0.5) * shakeInt;
            const sz = (Math.sin(t * 88) * 0.5 + Math.cos(t * 37) * 0.5) * shakeInt;
            _camShake.set(sx, sy, sz);
        }
    }

    // ── Drone Cam, Auto-Camera & TV Mode ───────────────────────────────────────────────
    if (droneEnabled && currentMode === 'live') {
        controls.enabled = false;
        
        const frameDt = frameDelta;
        
        // Calculate forward & right vectors relative to yaw
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), droneYaw);
        forward.y = 0;
        forward.normalize();
        
        const right = new THREE.Vector3(1, 0, 0);
        right.applyAxisAngle(new THREE.Vector3(0, 1, 0), droneYaw);
        right.y = 0;
        right.normalize();
        
        const accelPower = 55.0;
        const rotPower = 9.0;
        
        // Key rotations
        if (activeKeys['ArrowLeft'])  droneYawVel += rotPower * frameDt;
        if (activeKeys['ArrowRight']) droneYawVel -= rotPower * frameDt;
        if (activeKeys['ArrowUp'])    dronePitchVel += rotPower * frameDt;
        if (activeKeys['ArrowDown'])  dronePitchVel -= rotPower * frameDt;
        
        // Key movements
        if (activeKeys['KeyW']) droneVel.addScaledVector(forward, accelPower * frameDt);
        if (activeKeys['KeyS']) droneVel.addScaledVector(forward, -accelPower * frameDt);
        if (activeKeys['KeyA']) droneVel.addScaledVector(right, -accelPower * frameDt);
        if (activeKeys['KeyD']) droneVel.addScaledVector(right, accelPower * frameDt);
        if (activeKeys['Space']) droneVel.y += accelPower * frameDt;
        if (activeKeys['ShiftLeft'] || activeKeys['ShiftRight']) droneVel.y -= accelPower * frameDt;
        
        // Physics friction damping
        const linDamp = Math.exp(-4.5 * frameDt);
        droneVel.multiplyScalar(linDamp);
        
        const angDamp = Math.exp(-9.0 * frameDt);
        droneYawVel *= angDamp;
        dronePitchVel *= angDamp;
        
        // Apply flight updates
        droneYaw += droneYawVel * frameDt;
        dronePitch += dronePitchVel * frameDt;
        dronePitch = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47, dronePitch));
        
        dronePos.addScaledVector(droneVel, frameDt);
        
        // Limit flight borders
        dronePos.x = Math.max(-80, Math.min(80, dronePos.x));
        dronePos.y = Math.max(0.8, Math.min(40, dronePos.y));
        dronePos.z = Math.max(-75, Math.min(75, dronePos.z));
        
        // Turn banking (Roll)
        const droneRoll = -droneYawVel * 0.12;
        
        // Physical spring shake on beats
        if (playing && (beatState.isBeat || beatState.isTransient) && kick > 0.15) {
            const shockwaveForce = kick * 2.8;
            droneShakeVel.x += (Math.random() - 0.5) * shockwaveForce;
            droneShakeVel.y += (Math.random() - 0.5) * shockwaveForce;
            droneShakeVel.z += (Math.random() - 0.5) * shockwaveForce;
            
            droneShakeRotVel.x += (Math.random() - 0.5) * shockwaveForce * 0.08;
            droneShakeRotVel.y += (Math.random() - 0.5) * shockwaveForce * 0.08;
        }
        
        // Positional spring physics
        const kPos = 140.0;
        const cPos = 12.0;
        const accelPos = droneShakeOffset.clone().multiplyScalar(-kPos).addScaledVector(droneShakeVel, -cPos);
        droneShakeVel.addScaledVector(accelPos, frameDt);
        droneShakeOffset.addScaledVector(droneShakeVel, frameDt);
        
        // Rotational spring physics
        const kRot = 180.0;
        const cRot = 14.0;
        const accelRot = droneShakeRot.clone().multiplyScalar(-kRot).addScaledVector(droneShakeRotVel, -cRot);
        droneShakeRotVel.addScaledVector(accelRot, frameDt);
        droneShakeRot.addScaledVector(droneShakeRotVel, frameDt);
        
        // Set camera
        camera.position.copy(dronePos).add(droneShakeOffset);
        camera.rotation.set(
            dronePitch + droneShakeRot.x,
            droneYaw + droneShakeRot.y,
            droneRoll,
            'YXZ'
        );
        
        // Speed FOV stretch
        const speedK = droneVel.length();
        camera.fov = THREE.MathUtils.lerp(camera.fov, 55 + speedK * 0.45, fLerp(0.1));
        camera.updateProjectionMatrix();
        
    } else if ((autoCamEnabled || tvModeEnabled) && currentMode === 'live') {
        controls.enabled = false;
        
        if (camera.fov !== 55) {
            camera.fov = 55;
            camera.updateProjectionMatrix();
        }
        
        let targetX, targetY, targetZ;
        let lookX, lookY, lookZ;
        let lerpSpeed = 0.015 + (energy * 0.02) + (beatState.isBeat ? 0.04 : 0);

        if (tvModeEnabled) {
            // TV Jumps Camera Cuts
            let camObj = tvCameras[currentTvCamIdx % tvCameras.length];
            
            // dynamic slow drift inside the shot, with some variance based on current index
            let driftAmp = 1.5 + (currentTvCamIdx % 3) * 2.0; // varies from 1.5 to 5.5
            let driftSpeed = 0.1 + (currentTvCamIdx % 4) * 0.05; // varies from 0.1 to 0.25

            targetX = camObj.pos.x + Math.sin(t * driftSpeed) * driftAmp;
            targetY = camObj.pos.y + Math.sin(t * (driftSpeed * 1.47)) * (driftAmp * 0.6);
            targetZ = camObj.pos.z + Math.cos(t * (driftSpeed * 1.23)) * driftAmp;
            
            // Add a little dynamic look drift as well
            lookX = camObj.look.x + Math.sin(t * 0.1) * 1.5;
            lookY = camObj.look.y + Math.cos(t * 0.15) * 1.0;
            lookZ = camObj.look.z + Math.sin(t * 0.12) * 1.5;
            
            // Add smooth beat pump for energy
            let beatPump = beatState.flashDecay * (0.8 + energy * 0.5);
            targetY += beatPump; // camera jumps up slightly on beat
            lookY += beatPump * 0.5; // look target also jumps slightly
            
            // Ensure camera never goes below the floor
            targetY = Math.max(0.5, targetY);
            
            if (justCut) {
                camera.position.set(targetX, targetY, targetZ);
                autoCamFocus.set(lookX, lookY, lookZ);
                justCut = false;
            } else {
                lerpSpeed = 0.08 + (beatState.flashDecay * 0.04); // moderate tracking speed, snaps faster on beat
            }
        } else {
            // Smooth Cinematic Sweeps
            let camMode = section ? (section.id % 4) : 0;
            const camOrbitRad = 40 + buildUp * 15;

            if (camMode === 0) {
                // Orbit wide
                targetX = Math.sin(t * 0.2) * camOrbitRad;
                targetZ = Math.max(15, Math.cos(t * 0.2) * camOrbitRad); // kept away from stage
                targetY = 8 + (energy * 10) + Math.sin(t * 0.4) * 8;
                lookX = Math.sin(t) * 2 * energy;
                lookY = 5 + buildUp * 3;
                lookZ = -10;
            } else if (camMode === 1) {
                // Sweeping low & dynamic (fixed distance to not hit screens)
                targetX = Math.sin(t * 0.3) * 25;
                targetZ = 16 + Math.cos(t * 0.15) * 12; // Minimum distance Z=4 so screens remain visible
                targetY = 3.5 + energy * 4;
                lookX = Math.sin(t * 0.5) * 2;
                lookY = 6;
                lookZ = -12;
            } else if (camMode === 2) {
                // High overview
                targetX = Math.sin(t * 0.15) * 30;
                targetZ = 20 + Math.cos(t * 0.2) * 12;
                targetY = 22 + buildUp * 12;
                lookX = Math.sin(t * 0.4) * 4;
                lookY = 2;
                lookZ = -10;
            } else {
                // Ground tracking / side pan
                const sideSweep = Math.sin(t * 0.12) > 0 ? 1 : -1;
                targetX = (22 + buildUp * 5) * sideSweep + Math.sin(t * 0.5) * 4;
                targetZ = 12 + Math.cos(t * 0.4) * 8; // min Z=4
                targetY = 6 + energy * 7;
                lookX = 0;
                lookY = 5;
                lookZ = -10;
            }
        }

        // Apply kick bounce (bump forward and slightly down)
        targetZ -= kick * 2.0;
        targetY -= kick * 1.0;
        if (isPeakDrop) {
            // Massive camera shake during drop
            targetX += (Math.random() - 0.5) * 4.0;
            targetY += (Math.random() - 0.5) * 4.0;
            targetZ += (Math.random() - 0.5) * 4.0;
        }

        camera.position.lerp(_targetPos.set(targetX, targetY, targetZ), fLerp(lerpSpeed));
        autoCamFocus.lerp(_lookTarget.set(lookX, lookY, lookZ), fLerp(Math.min(lerpSpeed * 1.5, 0.99)));
        if (isPeakDrop) {
            autoCamFocus.x += (Math.random() - 0.5) * 3.0;
            autoCamFocus.y += (Math.random() - 0.5) * 3.0;
        }
        camera.lookAt(autoCamFocus);

    } else if (crowdPOVEnabled && currentMode === 'live') {
        controls.enabled = false;

        // Track beat triggers for 4-beat crowd hops
        if (beatState.isBeat) {
            povBeatCount++;
            if (povBeatCount >= POV_CONFIG.hopTransition.beatInterval || isPeakDrop) {
                povBeatCount = 0;
                if (crowdObjects.length > 1) {
                    povCurrentCrowdIdx = povTargetCrowdIdx;
                    let nextIdx = Math.floor(Math.random() * crowdObjects.length);
                    if (nextIdx === povCurrentCrowdIdx) {
                        nextIdx = (nextIdx + 1) % crowdObjects.length;
                    }
                    povTargetCrowdIdx = nextIdx;
                    povHopElapsed = 0.0;
                    povHopActive = true;
                }
            }
            // Smooth random yaw jitter target on beat
            povTargetYawVarianceDeg = (Math.random() - 0.5) * 2 * POV_CONFIG.yawVarianceLimitDeg;
        }

        if (kick > POV_CONFIG.kickShake.thresholdBassEnergy) {
            povKickElapsed = 0.0;
        } else {
            povKickElapsed += frameDt;
        }

        if (povHopActive) {
            povHopElapsed += frameDt;
            if (povHopElapsed >= POV_CONFIG.hopTransition.duration) {
                povHopActive = false;
                povCurrentCrowdIdx = povTargetCrowdIdx;
            }
        }

        povYawVarianceDeg = THREE.MathUtils.lerp(povYawVarianceDeg, povTargetYawVarianceDeg, fLerp(0.08));

        const currentMember = (crowdObjects[povCurrentCrowdIdx]?.mesh) ? {
            x: crowdObjects[povCurrentCrowdIdx].mesh.position.x,
            y: crowdObjects[povCurrentCrowdIdx].baseY || 0,
            z: crowdObjects[povCurrentCrowdIdx].mesh.position.z
        } : { x: 0, y: 0, z: 10 };

        const targetMember = (crowdObjects[povTargetCrowdIdx]?.mesh) ? {
            x: crowdObjects[povTargetCrowdIdx].mesh.position.x,
            y: crowdObjects[povTargetCrowdIdx].baseY || 0,
            z: crowdObjects[povTargetCrowdIdx].mesh.position.z
        } : currentMember;

        const isPortrait = (typeof tiktokModeEnabled !== 'undefined' && tiktokModeEnabled);
        const povFrame = evaluateAudiencePOVCamera({
            currentCrowdMember: currentMember,
            targetCrowdMember: povHopActive ? targetMember : null,
            hopElapsed: povHopElapsed,
            timeSeconds: t,
            bpm: (typeof songMap !== 'undefined' && songMap && songMap.bpm) ? songMap.bpm : 128,
            beatEnergy: energy,
            kickElapsed: povKickElapsed,
            isPortraitMode: isPortrait,
            landscapeVFOV: 55
        });

        camera.position.set(povFrame.position.x, povFrame.position.y, povFrame.position.z);
        
        // Look at DJ booth / stage center with yaw variance
        const stageTarget = { x: 0, y: 2.0, z: 0 };
        const yawRad = calculateLookAtYaw(camera.position, stageTarget, povYawVarianceDeg);
        const lookDistance = 25.0;
        const lookX = camera.position.x + Math.sin(yawRad) * lookDistance;
        const lookZ = camera.position.z + Math.cos(yawRad) * lookDistance;
        camera.lookAt(lookX, 2.0, lookZ);

        if (camera.fov !== povFrame.fov) {
            camera.fov = povFrame.fov;
            camera.updateProjectionMatrix();
        }

    } else if (currentMode === 'live' && !droneEnabled && !crowdPOVEnabled) {
        controls.enabled = true;
        if (camera.fov !== 55) {
            camera.fov = 55;
            camera.updateProjectionMatrix();
        }
    }

    // ── Moving Heads Update ──────────────────────────────────────
    if (movingHeadsEnabled || currentMode === 'studio') {
        updateInstancedMovingHeads(t, tAnim, energy, vocals, drums, kick, isPeakDrop, isSilent, buildUp, section);
    }

    // ── Live Crowd Update (Boiler Room Silhouettes) ───────────────
    if (liveCrowdEnabled && crowdObjects.length > 0) {
        const isDrop = playing && energy > 0.85 && buildUp < 0.2;
        const bouncePow = (playing && raybounceEnabled) ? (0.5 + energy * 1.2) : 0;

        crowdObjects.forEach((c, idx) => {
            if (c.lod === 2) return; // Completely hidden, skip calculations!

            if (c.lod === 1) {
                // Simplified fast jump, bypass arm texture/material changes
                const bounceTime = playing ? (bpmBeatPhase * Math.PI + c.phase * 0.3) : (t * 4.0 + c.phase);
                const rawJump = Math.max(0, Math.sin(bounceTime));
                const myJump = playing ? (rawJump * rawJump) * c.jumpHeight * bouncePow * 1.5 : 0;
                c.mesh.position.y = c.baseY + (isDrop ? myJump * 1.5 : myJump);
                return;
            }

            // LOD 0: Full high-fidelity animations
            // Free-running head wobble
            const headBob = Math.sin(t * 4.0 + c.phase) * 0.015 * (0.5 + energy);
            
            // BPM synced jump -> full bounce curve (squared sine) matching the exact beat
            const bounceTime = playing ? (bpmBeatPhase * Math.PI + c.phase * 0.3) : (t * 4.0 + c.phase);
            const rawJump = Math.max(0, Math.sin(bounceTime)); // Top half only
            const myJump = playing ? Math.pow(rawJump, 2.0) * c.jumpHeight * bouncePow * 1.5 : 0;
            
            c.mesh.position.y = c.baseY + headBob + (isDrop ? myJump * 1.5 : myJump);

            // Dynamically raise hands on drop or high buildUp
            if (c.armsUpPossible) {
                const wantsUp = isDrop || buildUp > 0.6 || (energy > 0.8 && idx % 3 === 0);
                if (wantsUp && !c.isUp) {
                    c.mesh.material = c.matUp;
                    c.isUp = true;
                } else if (!wantsUp && c.isUp && Math.random() < 0.05) {
                    c.mesh.material = c.matDown;
                    c.isUp = false;
                }
            }
        });
    }
    // ── Up-Lights Update (Wash Lights) ─────────────────────────
    if (upLightsEnabled && upLightObjects.length > 0) {
        upLightObjects.forEach((ul, i) => {
            let ulOp = 0;
            // Base intensity
            if (!playing) {
                ulOp = 0.5 * CFG.ulIntensity;
                ul.mat.color.setHex(0xffffff);
                ul.lensMat.emissive.setHex(0xffffff);
            } else {
                // ADSR decay for sharp on/off beat flashes
                ul.adsrState = ul.adsrState || 0;
                if (beatState.isTransient || (beatState.isBeat && energy > 0.5) || (isPeakDrop && Math.random() > 0.4)) {
                    ul.adsrState = 1.0;
                } else {
                    ul.adsrState = ul.adsrState * (isPeakDrop ? 0.3 : 0.85); // Extreme blinking on peak
                }
                
                ulOp = ul.adsrState * CFG.ulIntensity * (isSilent ? 0 : 1.0);
                if (section && section.type === 'intro') {
                    ulOp = 0.25 * CFG.ulIntensity; // constant gentle glow, no beat blinking
                } else if (section && section.type === 'outro') {
                    ulOp = 0.15 * CFG.ulIntensity; // fade out up-lights in outro
                }
                
                if (playing && songMap && sectionLaserHues[0] !== undefined) {
                    let hHex;
                    if (CFG.theme === 'dynamic') {
                        const currentBaseHue = (hasVideoColor && videoBaseHue !== null) ? videoBaseHue : sectionLaserHues[0];
                        // Cycle colors with slight shift
                        const bh = (currentBaseHue + t*5 + i * 20) % 360;
                        hHex = hueToHex(bh, 0.95, 0.4);
                    } else {
                        const cols = CFG.themes[CFG.theme];
                        hHex = cols[(i+2) % cols.length];
                    }
                    ul.mat.color.setHex(hHex);
                    ul.lensMat.emissive.setHex(hHex);
                }
            }
            
            // Subtle rotation for volumetric illusion
            ul.mesh.rotation.y += 0.6 * frameDelta;
            
            // Strobe effect checking
            if (playing && secPat === 'strobe' && !beatState.strobeOn) {
                ul.mat.opacity = 0;
                ul.lensMat.emissiveIntensity = 0;
            } else {
                ul.mat.opacity = ulOp * 0.12; 
                ul.lensMat.emissiveIntensity = ulOp * 1.5;
            }
        });
    }


    // ── VJ Console Post-Processing Update ───────────────────────
    if (fxVhsEnabled) {
        // RGB shift amount scales with kick/energy
        let shift = 0.0015 + (beatState.isBeat ? kick * 0.008 : 0) + (energy * 0.002);
        if (isPeakDrop) shift += Math.random() * 0.04; // Extreme visual glitch on drop
        rgbShiftAmount.value = shift;
        filmTimeUniform.value += 3.0 * frameDelta * CFG.speed * (isPeakDrop ? 4.0 : 1.0);
        if (glRgbShiftPass) glRgbShiftPass.uniforms.amount.value = shift;
    }

    if (fxBlurEnabled) {
        // Drive the blur FX from bass/energy directly, independent of the peak-mode flag
        let damp = 0.75 + (beatState.isBeat ? kick * 0.20 : 0) + (energy * 0.10);
        afterImageDamp.value = Math.min(0.98, damp);
        if (glAfterimage) glAfterimage.uniforms.damp.value = Math.min(0.98, damp);
    }

    // ── Music-reactive bloom ─────────────────────────────────────
    // A laser show lives on its glow: pump it on the kick and open it right up
    // on a drop, so beams bloom instead of sitting flat on the screen.
    if (glBloomPass) {
        const pump = glBloomStrength * (1.0 + energy * 0.30 + beatState.flashDecay * 0.35 + (isPeakDrop ? 0.25 : 0));
        glBloomPass.strength += (pump - glBloomPass.strength) * fLerp(0.25);
    }

    if (newFixtures) {
        newFixtures.update({
            t,
            energy,
            bass,
            kick,
            isSilent,
            isPeakDrop,
            buildUp,
            secPat,
            beatState,
            hasVideoColor,
            videoBaseHue,
            sectionLaserHues,
            playing,
            hueToHex
        });
    }

    // ── 3D DJ Avatar Audio Kinematics Update (R6) ────────────────
    if (djAvatarEnabled && djAvatarRig) {
        updateDJAvatar(djAvatarRig, frameDelta, {
            time: t,
            bpm: (typeof songMap !== 'undefined' && songMap && songMap.bpm) ? songMap.bpm : 128,
            beatEnergy: energy,
            kickEnergy: kick,
            bassEnergy: bass,
            isDrop: isPeakDrop || (energy > 0.88 && bass > 0.80)
        });
    }

    syncScreenFxStyles();

    // ──────────────────────────────────────────────────────────────
    //  MODE A: Procedural (Instanced)
    // ──────────────────────────────────────────────────────────────
    if (!isMappingMode) {
      updateInstancedLasers(t, tAnim, energy, bass, mid, high, kick, isPeakDrop, isSilent, section, melody, buildUp);
    }

    // ── MODE B: TIMELINE & MAPPING OVERRIDES ──────────────────────────────────
    
    // Apply Timeline keyframes to global params
    const plTime = getPlaybackTime();
    let kfPan = 0;
    let kfTilt = 0;
    
    if (currentMode === 'studio') {
        if (timelineData.intensity.length > 0) CFG.intensity = getInterpolatedValue('intensity', plTime);
        if (timelineData.speed.length > 0) CFG.speed = getInterpolatedValue('speed', plTime);
        
        kfPan = timelineData.pan.length > 0 ? getInterpolatedValue('pan', plTime) : 0;
        kfTilt = timelineData.tilt.length > 0 ? getInterpolatedValue('tilt', plTime) : 0;
    }
    
    // Process Mapped Points (from SVG/PNG)
    if (isMappingMode && projectedPoints.length > 0) {
        const traceSpeed = 4.0; 
        const isDivide = document.getElementById('param-mapping-divide')?.checked;
        laserObjects.forEach((l, li) => {
             let pt;
             if (isDivide) {
                 const segmentSize = Math.floor(projectedPoints.length / laserObjects.length);
                 if (segmentSize > 0) {
                     const startIdx = li * segmentSize;
                     const simIndex = startIdx + Math.floor((t * 60 * traceSpeed) % segmentSize);
                     pt = projectedPoints[simIndex];
                 } else {
                     pt = projectedPoints[li % projectedPoints.length];
                 }
             } else {
                 const pathOffset = (li / laserObjects.length) * projectedPoints.length;
                 const simIndex = Math.floor((t * 60 * traceSpeed + pathOffset) % projectedPoints.length);
                 pt = projectedPoints[simIndex];
             }
             l.rot.x = kfTilt + pt.y * 0.8;
             l.rot.y = 0;
             l.rot.z = -(kfPan + pt.x * 1.5);
        });
        updateInstancedLasers(t, tAnim, energy, bass, mid, high, kick, isPeakDrop, isSilent, section, melody, buildUp, true);
    } else if (currentMode === 'studio') {
        laserObjects.forEach((l) => {
            if (selectedLaser !== l) {
                l.rot.x = THREE.MathUtils.lerp(l.rot.x, kfTilt, fLerp(0.1));
                l.rot.y = 0;
                l.rot.z = THREE.MathUtils.lerp(l.rot.z, -kfPan, fLerp(0.1));
            }
        });
        updateInstancedLasers(t, tAnim, energy, bass, mid, high, kick, isPeakDrop, isSilent, section, melody, buildUp, true);
    }

    // ── Haze: tint particles to active section hue + beat flicker ───
    if (hazeSystem && hazeMaterial) {
      if (hazeMaterial.uniforms) {
          hazeMaterial.uniforms.time.value = tAnim;
          const activeSec = playing ? getCurrentSection() : null;
          if (activeSec && sectionLaserHues.length > 0) {
              const hHex = hueToHex(sectionLaserHues[0], 0.7, 0.18 + energy * 0.12 + beatState.flashDecay * 0.12);
              hazeMaterial.uniforms.color.value.setHex(hHex);
          }
          hazeMaterial.uniforms.density.value = (0.09 + beatState.flashDecay * 0.14) * CFG.hazeDensity * BEAM_HDR_SCALE;
      }
      hazeSystem.rotation.y += 0.009 * frameDelta; // very slow drift
    }

    // ── Physics & Collision Spot Updates ─────────────────
    const dt = frameDelta; // real elapsed time (clamped in animate())
    
    if (playing) {
        if (isPeakDrop && beatState.isBeat) {
            triggerConfettiBurst();
            if (Math.random() > 0.5) {
                triggerFogJet(-28, 0.2, -22, 1.5, 0.4, 0.4);
                triggerFogJet(28, 0.2, -22, -1.5, 0.4, 0.4);
            }
        }
    }
    
    updateConfetti(dt);
    updateFogParticles(dt);
    updateRainVisuals(dt);
    updateLEDCanvas(dt, energy, bass, mid, high, isPeakDrop);
    updateLaserWriter(dt);
    


    updateTimeline();

  // ── Anamorphic Bokeh Stretch & Chromatic Aberration ───────────
  const activeBokeh = droneEnabled ? 1.6 : 1.0;
  if (fireMaterial.uniforms && fireMaterial.uniforms.uBokehStretch) {
      fireMaterial.uniforms.uBokehStretch.value = activeBokeh;
  }
  if (sparkMaterial.uniforms && sparkMaterial.uniforms.uBokehStretch) {
      sparkMaterial.uniforms.uBokehStretch.value = activeBokeh;
  }
  pyroSystems.forEach(ps => {
      if (ps.points && ps.points.material && ps.points.material.uniforms && ps.points.material.uniforms.uBokehStretch) {
          ps.points.material.uniforms.uBokehStretch.value = activeBokeh;
      }
  });

  if (droneEnabled) {
      if (!lastDronePostState) {
          lastDronePostState = true;
          rgbShiftPass.enabled = true;
          rebuildPostChain();
      }
      rgbShiftAmount.value = 0.0012 + kick * 0.0035;
      if (glRgbShiftPass) glRgbShiftPass.uniforms.amount.value = rgbShiftAmount.value;
  } else {
      if (lastDronePostState) {
          lastDronePostState = false;
          rgbShiftPass.enabled = fxVhsEnabled;
          rgbShiftAmount.value = 0.0015;
          if (glRgbShiftPass) glRgbShiftPass.uniforms.amount.value = 0.0015;
          rebuildPostChain();
    }
  }

  // Aim the shadow casters. Must run after the moving-head update, which is what
  // fills activeBeams, and before the render that consumes the shadow maps.
  updateShadowCasters();

  // Update Volumetric Dynamic Lighting on the Crowd
  updateCrowdLighting(frameDelta);

  camera.position.add(_camShake);

  const activeCam = isStageBuilderMode ? builderCamera : camera;

  // Render pipeline — EffectComposer (bloom + FX) with a plain render as fallback
  if (glComposer) {
      try {
          // The builder uses an orthographic camera; keep the pass in sync with it.
          if (glRenderPass && glRenderPass.camera !== activeCam) glRenderPass.camera = activeCam;
          glComposer.render(frameDelta);
      } catch (e) {
          console.warn('EffectComposer.render() failed, falling back to direct render:', e.message || e);
          disposeGLComposer();
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.render(scene, activeCam);
      }
  } else {
      // Guarded too: a driver-level failure here must not take the loop down.
      try {
          renderer.render(scene, activeCam);
      } catch (err) {
          console.warn('renderer.render() failed:', err);
      }
  }

  if (needsScreenshot) {
      needsScreenshot = false;
      saveScreenshot();
  }
}

// The renderer is constructed synchronously above; this only wires up the post
// chain and starts the loop. It stays async because the WebGPU experiment used
// to await renderer.init() here, and callers/tests may still await it.
async function initRenderer() {
    initGLComposer();
    renderer.setAnimationLoop(animate);

    // Debug handle for performance work: renderer.info carries draw calls and
    // triangle counts, which is the only way to compare rendering cost between
    // builds without guessing. Read-only from the app's point of view.
    if (typeof window !== 'undefined') {
        window.__laserrave = {
            get renderer() { return renderer; },
            get composer() { return glComposer; },
            get scene() { return scene; },
            get camera() { return camera; },
            get fps() { return smoothedFPS; },
            get info() {
                const r = renderer && renderer.info;
                if (!r) return null;
                return {
                    drawCalls: r.render.calls,
                    triangles: r.render.triangles,
                    programs: r.programs ? r.programs.length : 0,
                    geometries: r.memory.geometries,
                    textures: r.memory.textures
                };
            },
            get cfg() { return CFG; },
            get bloom() { return glBloomPass; },
            /**
             * Live brightness trim for the additive beams, relative to the
             * calibrated BEAM_HDR_SCALE. 1 = as shipped, >1 brighter, <1 dimmer.
             * Lets a value be dialled in by eye before baking it into the
             * constant. Not persisted.
             */
            setBeamBrightness(k) {
                if (!this._beamBase) {
                    this._beamBase = [];
                    scene.traverse(o => {
                        const m = o.material;
                        if (!m || m.blending !== THREE.AdditiveBlending) return;
                        this._beamBase.push({
                            m,
                            opacity: m.opacity,
                            uOM: (m.uniforms && m.uniforms.uOpacityMultiplier)
                                ? m.uniforms.uOpacityMultiplier.value : null
                        });
                    });
                }
                this._beamBase.forEach(e => {
                    e.m.opacity = e.opacity * k;
                    if (e.uOM !== null) e.m.uniforms.uOpacityMultiplier.value = e.uOM * k;
                });
                return `${this._beamBase.length} additive Materialien auf x${k} gesetzt`;
            },
            get shadows() { return typeof getShadowStats === 'function' ? getShadowStats() : null; },
            /**
             * Toggles shadows at runtime so their cost can be A/B'd in a single
             * session, on the same machine and the same scene — the only way to
             * get a trustworthy before/after number.
             */
            setShadows(on) { setShadowQuality(on ? 0 : 2); return getShadowStats(); }
        };
    }
}
initRenderer();

// ─────────────────────────────────────────────
//  PYRO UI LISTENERS
// ─────────────────────────────────────────────
CFG.pyroIntensity = 1.0;
CFG.windX = 0;
CFG.windY = 0;

document.getElementById('param-pyro').addEventListener('change', e => {
    pyroEnabled = e.target.checked;
    if (!pyroEnabled) pyroSystems.forEach(ps => { ps.points.visible = false; });
});
document.getElementById('param-pyro-flame').addEventListener('change', e => { pyroFlameEnabled = e.target.checked; });
document.getElementById('param-pyro-spark').addEventListener('change', e => { pyroSparkEnabled = e.target.checked; });
document.getElementById('param-pyro-intensity').addEventListener('input', e => {
    CFG.pyroIntensity = +e.target.value / 100;
    document.getElementById('val-pyro-intensity').textContent = e.target.value + '%';
});
document.getElementById('param-wind-x').addEventListener('input', e => {
    CFG.windX = +e.target.value;
    document.getElementById('val-wind-x').textContent = e.target.value;
});
document.getElementById('param-wind-y').addEventListener('input', e => {
    CFG.windY = +e.target.value;
    document.getElementById('val-wind-y').textContent = e.target.value;
});

// ─────────────────────────────────────────────
//  TIMELINE INTERACTION LOGIC
// ─────────────────────────────────────────────
document.querySelectorAll('.track-label').forEach(el => {
    el.addEventListener('click', (e) => {
        document.querySelectorAll('.track-label').forEach(l => l.classList.remove('active'));
        el.classList.add('active');
        activeTrack = el.dataset.track;
        selectedKeyframe = null;
        updateTimeline(); // force redraw
    });
});

let draggingKf = null;
function startDrag(kf, e) {
    draggingKf = kf;
    selectedKeyframe = kf;
    updateTimeline();
}

document.getElementById('timeline-svg').addEventListener('mousedown', (e) => {
    if (!audioBuffer) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (!draggingKf) {
        // Scrub playhead
        if (playing) togglePlay(); 
        const dur = audioBuffer.duration;
        playbackStartOffset = (x / rect.width) * dur;
        playbackStartCtxTime = audioCtx.currentTime;
        updateTimeline();
    }
});

document.addEventListener('mousemove', (e) => {
    if (draggingKf && audioBuffer) {
        const svg = document.getElementById('timeline-svg');
        const rect = svg.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        
        draggingKf.time = (x / rect.width) * audioBuffer.duration;
        const maxV = (activeTrack === 'pan' || activeTrack === 'tilt') ? 4 : 2;
        draggingKf.value = (1 - (y / rect.height)) * maxV;
        
        timelineData[activeTrack].sort((a,b) => a.time - b.time);
        updateTimeline();
    }
});

document.addEventListener('mouseup', () => {
    draggingKf = null;
});

document.getElementById('btn-add-kf').addEventListener('click', () => {
    if (!audioBuffer) return;
    const t = getPlaybackTime();
    const currV = getInterpolatedValue(activeTrack, t);
    const kf = { time: t, value: currV, type: 'linear' };
    timelineData[activeTrack].push(kf);
    timelineData[activeTrack].sort((a,b) => a.time - b.time);
    selectedKeyframe = kf;
    updateTimeline();
});

document.getElementById('btn-del-kf').addEventListener('click', () => {
    if (selectedKeyframe) {
        timelineData[activeTrack] = timelineData[activeTrack].filter(k => k !== selectedKeyframe);
        selectedKeyframe = null;
        updateTimeline();
    }
});

document.getElementById('timeline-resizer').addEventListener('mousedown', (e) => {
    const th = document.getElementById('song-timeline');
    const startY = e.clientY;
    const startH = th.clientHeight;
    
    function doDrag(e) {
        const h = startH - (e.clientY - startY);
        th.style.height = Math.max(100, Math.min(h, window.innerHeight*0.8)) + 'px';
        tlSkip = 0; updateTimeline();
    }
    function stopDrag() {
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', stopDrag);
    }
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
});

// ─────────────────────────────────────────────
//  PROJECTION MAPPING (SVG/PNG PARSING)
// ─────────────────────────────────────────────
document.getElementById('svg-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    projectedPoints = []; // reset
    const url = URL.createObjectURL(file);
    
    if (file.name.endsWith('.svg')) {
        const svgText = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, "image/svg+xml");
        const paths = doc.querySelectorAll('path');
        paths.forEach(p => {
             const len = p.getTotalLength();
             const steps = 100;
             for (let i=0; i<=steps; i++) {
                 const pt = p.getPointAtLength((i/steps)*len);
                 projectedPoints.push({x: pt.x, y: pt.y});
             }
        });
    } else {
        // PNG Trace pseudo-logic: generate a box for now or image boundary
        const img = new Image();
        img.src = url;
        await new Promise(r => img.onload = r);
        const asp = img.width / img.height;
        projectedPoints = [
            {x: -1*asp, y: -1}, {x: 1*asp, y: -1}, {x: 1*asp, y: 1}, {x: -1*asp, y: 1}, {x: -1*asp, y: -1}
        ];
    }
    
    // Normalize points to -1 to 1 based on bounding box
    if (projectedPoints.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        projectedPoints.forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        const cx = (minX + maxX)/2, cy = (minY + maxY)/2;
        const scale = Math.max(maxX - minX, maxY - minY) / 2;
        projectedPoints = projectedPoints.map(p => ({
            x: (p.x - cx) / scale,
            y: -(p.y - cy) / scale // invert Y for standard math
        }));
        isMappingMode = true;
        console.log("Mapped shape points:", projectedPoints.length);
    }
});

// ─────────────────────────────────────────────
//  4K OFFLINE RENDER (WebCodecs)
// ─────────────────────────────────────────────
let needsScreenshot = false;
document.getElementById('btn-screenshot').addEventListener('click', () => {
  needsScreenshot = true;
});

function saveScreenshot() {
  try {
    if (!renderer || !renderer.domElement || typeof renderer.domElement.toBlob !== 'function') {
        console.warn("Screenshot feature is not supported without a valid canvas domElement.");
        return;
    }
    renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `lasershow_screenshot_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }, 'image/png');
  } catch (err) {
    console.error("Failed to capture screenshot:", err);
  }
}

// ─── Photo Mode Event Wiring & Snapshot Processing (R5) ──────
const elBtnPhotoMode = document.getElementById('btn-photo-mode');
const elPhotoOverlay = document.getElementById('photo-mode-overlay');
const elPhotoCanvas = document.getElementById('photo-preview-canvas');
const elPhotoClose = document.getElementById('btn-photo-close');
const elPhotoResume = document.getElementById('btn-photo-resume');
const elPhotoSave = document.getElementById('btn-photo-save');
const elPhotoFovSlider = document.getElementById('photo-fov-slider');
const elPhotoFovVal = document.getElementById('photo-fov-val');
const elPhotoRollSlider = document.getElementById('photo-roll-slider');
const elPhotoRollVal = document.getElementById('photo-roll-val');
const filterBtns = document.querySelectorAll('.photo-filter-btn');

function renderPhotoSnapshot() {
    if (!renderer || !renderer.domElement) return;

    // Apply freecam FOV and Roll
    const prevFov = camera.fov;
    const prevRoll = camera.rotation.z;

    camera.fov = photoModeManager.freecam.fov;
    camera.rotation.z = (photoModeManager.freecam.rollDeg * Math.PI) / 180;
    camera.updateProjectionMatrix();

    // Render clean frame
    const activeCam = (typeof isStageBuilderMode !== 'undefined' && isStageBuilderMode && typeof builderCamera !== 'undefined') ? builderCamera : camera;
    renderer.render(scene, activeCam);

    // Copy to snapshot canvas
    if (!rawSnapshotCanvas) {
        rawSnapshotCanvas = document.createElement('canvas');
    }
    rawSnapshotCanvas.width = renderer.domElement.width || 1280;
    rawSnapshotCanvas.height = renderer.domElement.height || 720;
    const rawCtx = rawSnapshotCanvas.getContext('2d');
    if (rawCtx) {
        rawCtx.drawImage(renderer.domElement, 0, 0);
    }

    // Apply currently selected filter to preview canvas
    if (elPhotoCanvas) {
        applyPhotoFilter(rawSnapshotCanvas, photoModeManager.currentFilter, { destinationCanvas: elPhotoCanvas });
    }

    // Restore camera state for live rendering
    camera.fov = prevFov;
    camera.rotation.z = prevRoll;
    camera.updateProjectionMatrix();
}

function openPhotoMode() {
    photoModeManager.enter(audioCtx);
    if (elPhotoOverlay) elPhotoOverlay.style.display = 'flex';

    // Initialize sliders from current camera
    photoModeManager.setFreecamParameters({
        fov: camera.fov || 60,
        rollDeg: 0
    });
    if (elPhotoFovSlider) elPhotoFovSlider.value = camera.fov || 60;
    if (elPhotoFovVal) elPhotoFovVal.textContent = `${Math.round(camera.fov || 60)}°`;
    if (elPhotoRollSlider) elPhotoRollSlider.value = 0;
    if (elPhotoRollVal) elPhotoRollVal.textContent = '0°';

    renderPhotoSnapshot();
}

function closePhotoMode() {
    photoModeManager.exit(audioCtx);
    if (elPhotoOverlay) elPhotoOverlay.style.display = 'none';
}

if (elBtnPhotoMode) {
    elBtnPhotoMode.addEventListener('click', openPhotoMode);
}

if (elPhotoClose) elPhotoClose.addEventListener('click', closePhotoMode);
if (elPhotoResume) elPhotoResume.addEventListener('click', closePhotoMode);

window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && photoModeManager.isActive) {
        closePhotoMode();
    }
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        photoModeManager.setFilter(filter);
        if (rawSnapshotCanvas && elPhotoCanvas) {
            applyPhotoFilter(rawSnapshotCanvas, photoModeManager.currentFilter, { destinationCanvas: elPhotoCanvas });
        }
    });
});

if (elPhotoFovSlider) {
    elPhotoFovSlider.addEventListener('input', e => {
        const val = parseFloat(e.target.value);
        photoModeManager.setFreecamParameters({ fov: val });
        if (elPhotoFovVal) elPhotoFovVal.textContent = `${val}°`;
        renderPhotoSnapshot();
    });
}

if (elPhotoRollSlider) {
    elPhotoRollSlider.addEventListener('input', e => {
        const val = parseFloat(e.target.value);
        photoModeManager.setFreecamParameters({ rollDeg: val });
        if (elPhotoRollVal) elPhotoRollVal.textContent = `${val}°`;
        renderPhotoSnapshot();
    });
}

if (elPhotoSave) {
    elPhotoSave.addEventListener('click', () => {
        if (!elPhotoCanvas) return;
        if (typeof elPhotoCanvas.toBlob === 'function') {
            elPhotoCanvas.toBlob(blob => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = generatePhotoFilename();
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
            }, 'image/png');
        }
    });
}

document.getElementById('btn-render').addEventListener('click', async () => {
    if (!audioBuffer) return;
    
    // Stop live
    if (playing) togglePlay();
    isRecording = true;
    isOfflineRendering = true;
    
    const ui = document.getElementById('render-overlay');
    const prog = document.getElementById('render-progress-fill');
    const stat = document.getElementById('render-status-text');
    const eta = document.getElementById('render-eta');
    ui.style.display = 'flex';
    
    // Setup 4K Offline Canvas
    const R_WIDTH = 3840;
    const R_HEIGHT = 2160;
    const fps = 60;
    const motionBlurSamples = 1;
    const totalFrames = Math.floor(audioBuffer.duration * fps);
    
    stat.innerText = `Preparing 4K Engine... [0 / ${totalFrames} frames]`;
    
    // WebCodecs Muxer setup (using webm-writer or MediaRecorder trick)
    // Unfortunately native WebCodecs AudioAudio/VideoEncoder muxing needs an mp4box.js library.
    // Instead we will render to a canvas stream and use standard MediaRecorder 
    // BUT we will pipe frames manually into a canvas at high speed, then export.
    // Since true offline muxing is extremely complex without an external lib, 
    // we use a generator approach to ensure NO frames are skipped.
    
    // Wait, MediaRecorder with a canvas stream drops frames if it cant keep up.
    // So we must use an ImageCapture or WebCodecs. For simplicity in vanilla JS:
    // We will render frames visibly to the main canvas but sized to 4K, 
    // and stream chunks directly to disk using File System Access API to prevent Out of Memory!
    
    let encoder;
    let encoderChunks = [];
    let fileHandle;
    let writableStream;
    let writePromise = Promise.resolve();
    let useFileStream = false;

    try {
        if (window.showSaveFilePicker) {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'lasershow_4k_export.webm',
                types: [{
                    description: 'WebM Video',
                    accept: { 'video/webm': ['.webm'] },
                }],
            });
            writableStream = await fileHandle.createWritable();
            useFileStream = true;
        } else {
            console.warn("showSaveFilePicker not supported. Falling back to RAM. May cause Out of Memory.");
            alert("Heads up: your browser cannot stream the recording straight to disk, so it is held in memory instead. Long recordings may run out of memory. Chrome or Edge is recommended.");
        }
    } catch (e) {
        console.warn("User cancelled save prompt", e);
        ui.style.display = 'none';
        playing = false;
        isRecording = false;
        isOfflineRendering = false;
        animate();
        return;
    }

    try {
        if (typeof VideoEncoder === 'undefined') throw new Error("VideoEncoder not supported");
        const init = {
            output: (chunk, meta) => {
                const buf = new Uint8Array(chunk.byteLength);
                chunk.copyTo(buf);
                if (useFileStream) {
                    writePromise = writePromise.then(() => writableStream.write(buf));
                } else {
                    encoderChunks.push(buf);
                }
            },
            error: (e) => console.error("VideoEncoder Error", e)
        };
        encoder = new VideoEncoder(init);
        // Simple codec configuration
        encoder.configure({
            codec: 'vp8',
            width: R_WIDTH,
            height: R_HEIGHT,
            bitrate: 40_000_000 // 40 Mbps
        });
    } catch (e) {
        console.error("VideoEncoder initialization failed:", e);
        alert("4K Export / WebCodecs is not supported in this browser.");
        ui.style.display = 'none';
        playing = false;
        isRecording = false;
        isOfflineRendering = false;
        animate(); // Restart real-time loop
        return;
    }

    // Resize renderer for 4K
    renderer.setSize(R_WIDTH, R_HEIGHT);
    
    const startRealTime = performance.now();
    
    // Render loop
    try {
        for (let f = 0; f < totalFrames; f++) {
            const frameTime = f / fps;
            
            // Setup internal time variables to fake the playhead
            playbackStartCtxTime = audioCtx.currentTime;
            playbackStartOffset = frameTime;
            playing = true; // force simulate live behavior
            
            // Multi-sample Motion Blur Loop
            // We step 't' very slightly to generate blur
            for(let s=0; s<motionBlurSamples; s++) {
                const subTimeOffset = (s / motionBlurSamples) * (1/fps);
                playbackStartOffset = frameTime + subTimeOffset;

                // Re-eval animate state manually without requestAnimationFrame
                animate();
            }

            // Encode the accumulated frame
            // (Note: in a real PBR engine we need Accumulation shader. Here we just take the last sample for simplicity to not hang the browser!)
            try {
                if (typeof createImageBitmap === 'undefined') throw new Error("createImageBitmap not supported");
                const bmp = await createImageBitmap(renderer.domElement);
                const vFrame = new VideoFrame(bmp, { timestamp: f * 1000000 / fps });
                encoder.encode(vFrame, { keyFrame: f % 60 === 0 });
                vFrame.close();
                bmp.close();
            } catch (err) {
                console.warn("Failed to capture frame with createImageBitmap:", err);
            }
            
            // Throttle to prevent WebCodecs queue explosion which causes silent crashes
            while (encoder.encodeQueueSize > 5) {
                await new Promise(r => setTimeout(r, 5));
            }

            if (f % 5 === 0) {
                const pct = (f / totalFrames) * 100;
                prog.style.width = pct + '%';
                stat.innerText = `Rendering: ${f} / ${totalFrames} frames`;

                const elapsed = (performance.now() - startRealTime) / 1000;
                const tpf = elapsed / (f + 1);
                const remain = (totalFrames - f) * tpf;
                eta.innerText = `ETA: ${Math.round(remain)} seconds`;

                // Yield to browser to update UI
                await new Promise(r => setTimeout(r, 0));
            }
        }

        stat.innerText = `Finalizing video file...`;
        await encoder.flush();
        encoder.close();
        if (useFileStream) {
            await writePromise;
            await writableStream.close();
        }
    } catch (e) {
        console.error("4K render loop failed:", e);
        alert("Render failed. This browser does not fully support WebCodecs or canvas export.");
    }
    
    // Reconstruct fake webm/mkv format or return raw chunks
    // *Warning: vp8 raw chunks need to be muxed. 
    // Here we assume standard Blob generation from raw chunks (this might not be a valid WebM without EBML headers, 
    // but demonstrating the architecture as requested for 'Offline Render').
    // In a fully production system, use 'mp4box.js'.
    
    if (!useFileStream) {
        const blob = new Blob(encoderChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lasershow_4k_export.webm`;
        document.body.appendChild(a);
        a.click();
        
        // Restore
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (glComposer) glComposer.setSize(window.innerWidth, window.innerHeight);
    ui.style.display = 'none';
    playing = false;
    isRecording = false;
    isOfflineRendering = false;
    animate(); // Restart real-time loop
});

// ─────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  const W = window.innerWidth, H = window.innerHeight;
  let renderW = W;
  let renderH = H;
  
  if (typeof tiktokModeEnabled !== 'undefined' && tiktokModeEnabled) {
      // 9:16 aspect ratio fitting inside window
      const aspect = 9 / 16;
      renderW = H * aspect;
      renderH = H;
      if (renderW > W) {
          renderW = W;
          renderH = W / aspect;
      }
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.left = '50%';
      renderer.domElement.style.top = '50%';
      renderer.domElement.style.transform = 'translate(-50%, -50%)';
  } else {
      renderer.domElement.style.position = 'static';
      renderer.domElement.style.transform = 'none';
      renderer.domElement.style.left = 'auto';
      renderer.domElement.style.top = 'auto';
  }

  camera.aspect = renderW / renderH;
  camera.updateProjectionMatrix();

  if (typeof builderCamera !== 'undefined' && builderCamera) {
      const builderAspect = renderW / renderH;
      builderCamera.left = -builderFrustumSize * builderAspect / 2;
      builderCamera.right = builderFrustumSize * builderAspect / 2;
      builderCamera.top = builderFrustumSize / 2;
      builderCamera.bottom = -builderFrustumSize / 2;
      builderCamera.updateProjectionMatrix();
  }

  renderer.setSize(renderW, renderH);
  // The composer owns its own render targets — they must follow the canvas size,
  // otherwise the bloom stays at the old resolution and the image goes blurry/stretched.
  if (glComposer) {
      glComposer.setSize(renderW, renderH);
      if (glBloomPass && glBloomPass.resolution) glBloomPass.resolution.set(renderW, renderH);
  }
});

// --- NEW UI LISTENERS ---
const btnLoadPreset = document.getElementById('btn-load-preset');
const btnSavePreset = document.getElementById('btn-save-preset');
const paramFxDof = document.getElementById('param-fx-dof');
const btnMpHost = document.getElementById('btn-mp-host');
const btnMpJoin = document.getElementById('btn-mp-join');
const inputMpRoom = document.getElementById('input-mp-room');
const mpStatus = document.getElementById('mp-status');

if (btnLoadPreset) {
  btnLoadPreset.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const savedCfg = JSON.parse(evt.target.result);
        Object.assign(CFG, savedCfg);
        buildStageEnvironment();
        initLasers(CFG.stageSize === 'large' ? 180 : 40);
        initMovingHeads(CFG.stageSize === 'large' ? 120 : 20);
        initPyroSystems();
        updateGoboCanvas(CFG.theme);
        alert('Preset loaded!');
      } catch(err) {
        console.error('Error loading preset', err);
        alert('Failed to load preset');
      }
    };
    reader.readAsText(file);
  });
}

if (btnSavePreset) {
  btnSavePreset.addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(CFG, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', 'lasershow_preset.json');
    dlAnchorElem.click();
  });
}

if (paramFxDof) {
  paramFxDof.addEventListener('change', e => {
    fxDofEnabled = e.target.checked;
    rebuildPostChain();
        syncScreenFxStyles();
  });
}

if (btnMpHost) {
    btnMpHost.addEventListener('click', async () => {
        if (mpStatus) mpStatus.textContent = 'Starting Host...';
        window.mpSystem = new Multiplayer(true);
        window.mpSystem.onConnectedAsHost = (id) => {
            if (mpStatus) {
                mpStatus.textContent = `Hosting Room: ${id} (Send to friends!)`;
                mpStatus.style.color = '#00ffaa';
            }
            if (inputMpRoom) inputMpRoom.style.display = 'none';
            if (btnMpHost) btnMpHost.disabled = true;
            if (btnMpJoin) btnMpJoin.disabled = true;

            if (mpBroadcastTimer) clearInterval(mpBroadcastTimer);
            mpBroadcastTimer = setInterval(() => {
                if (!window.mpSystem || !window.mpSystem.isHost) return;

                const uiState = {};
                document.querySelectorAll('[id^="param-"]').forEach(el => {
                    if (el.type === 'checkbox' || el.type === 'radio') {
                        uiState[el.id] = el.checked;
                    } else if (el.type !== 'file') {
                        uiState[el.id] = el.value;
                    }
                });

                window.mpSystem.broadcastState({ cfg: CFG, uiState });

                let time = 0;
                if (State.playing && State.audioCtx) {
                    time = State.audioCtx.currentTime - playbackStartCtxTime;
                } else {
                    time = State.playbackStartOffset;
                }
                window.mpSystem.broadcastPlayback(time, State.playing);
            }, 100);
        };

        try {
            await window.mpSystem.init();
        } catch (err) {
            if (mpStatus) mpStatus.textContent = 'Error hosting room.';
            console.error(err);
        }
    });
}

if (btnMpJoin) {
    btnMpJoin.addEventListener('click', async () => {
        if (!inputMpRoom) return;
        if (inputMpRoom.style.display === 'none') {
            inputMpRoom.style.display = 'block';
            return;
        }

        const roomId = inputMpRoom.value.trim();
        if (!roomId) return;

        if (mpStatus) mpStatus.textContent = 'Joining Room...';
        window.mpSystem = new Multiplayer(false, roomId);

        window.mpSystem.onConnectedAsClient = () => {
            if (mpStatus) {
                mpStatus.textContent = 'Connected to VJ Host! Waiting for Audio...';
                mpStatus.style.color = '#00aaff';
            }
            inputMpRoom.style.display = 'none';
            if (btnMpHost) btnMpHost.disabled = true;
            if (btnMpJoin) btnMpJoin.disabled = true;

            const livePanel = document.getElementById('panel-live');
            if (livePanel) {
                livePanel.style.pointerEvents = 'none';
                livePanel.style.opacity = '0.5';
            }

            const droneBtn = document.getElementById('param-dronecam');
            if (droneBtn && !droneBtn.checked) {
                droneBtn.checked = true;
                droneBtn.dispatchEvent(new Event('change'));
            }
        };

        try {
            await window.mpSystem.init();
        } catch (err) {
            if (mpStatus) mpStatus.textContent = 'Error joining room.';
            console.error(err);
        }
    });
}

// ─────────────────────────────────────────────
//  STAGE BUILDER CONTROLLER (R1) & STAGE PRESETS (R2)
// ─────────────────────────────────────────────

let isStageBuilderMode = false;
const builderFrustumSize = 70;
const builderAspect = window.innerWidth / window.innerHeight;
const builderCamera = new THREE.OrthographicCamera(
    -builderFrustumSize * builderAspect / 2,
    builderFrustumSize * builderAspect / 2,
    builderFrustumSize / 2,
    -builderFrustumSize / 2,
    0.1,
    500
);
builderCamera.position.set(0, 50, 0);
builderCamera.up.set(0, 0, -1);
builderCamera.lookAt(0, 0, 0);

const builderGrid = new THREE.GridHelper(100, 200, 0x00ffcc, 0x1a333a);
builderGrid.position.y = 0.01;
builderGrid.visible = false;
scene.add(builderGrid);

const builderGroup = new THREE.Group();
builderGroup.visible = false;
scene.add(builderGroup);

let builderActiveType = 'select';
let builderGhostMesh = null;
let builderGhostHeight = 0.0;
let builderGhostRotY = 0;
let builderFixtures = [];
let builderSelectedFixture = null;
let builderSelectionBox = null;
const builderRaycaster = new THREE.Raycaster();
const builderMouse = new THREE.Vector2();
const builderGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const builderPlaneIntersect = new THREE.Vector3();
let isBuilderDragging = false;

function createFixtureMesh(fixture, isGhost = false) {
    const group = new THREE.Group();
    const type = fixture.type;
    const opacity = isGhost ? 0.5 : 0.95;
    const transparent = true;

    if (type === 'truss') {
        const mat = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.5, roughness: 0.5, opacity, transparent });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 0.4), mat);
        group.add(mesh);
    } else if (type === 'screen') {
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: isGhost, opacity, transparent });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 0.2), mat);
        group.add(mesh);
    } else if (type === 'laser') {
        const mat = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: isGhost ? 0.2 : 0.6, opacity, transparent });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), mat);
        group.add(mesh);
    } else if (type === 'movinghead') {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0x888800, emissiveIntensity: isGhost ? 0.2 : 0.5, opacity, transparent });
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 16), mat);
        group.add(mesh);
    } else if (type === 'co2') {
        const mat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0x882200, emissiveIntensity: isGhost ? 0.2 : 0.5, opacity, transparent });
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.6, 12), mat);
        group.add(mesh);
    } else if (type === 'uplight') {
        const mat = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0x880088, emissiveIntensity: isGhost ? 0.2 : 0.5, opacity, transparent });
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 12), mat);
        group.add(mesh);
    }

    group.position.set(fixture.position.x, fixture.position.y, fixture.position.z);
    group.rotation.set(fixture.rotation?.x || 0, fixture.rotation?.y || 0, fixture.rotation?.z || 0);
    group.userData.fixture = fixture;
    return group;
}

function updateBuilderGhost() {
    if (builderGhostMesh) {
        scene.remove(builderGhostMesh);
        builderGhostMesh = null;
    }
    if (isStageBuilderMode && builderActiveType !== 'select') {
        const dummyFixture = {
            type: builderActiveType,
            position: { x: 0, y: builderGhostHeight, z: 0 },
            rotation: { x: 0, y: builderGhostRotY, z: 0 }
        };
        builderGhostMesh = createFixtureMesh(dummyFixture, true);
        scene.add(builderGhostMesh);
    }
}

function syncBuilderVisuals() {
    while (builderGroup.children.length > 0) {
        builderGroup.remove(builderGroup.children[0]);
    }
    if (builderSelectionBox) {
        scene.remove(builderSelectionBox);
        builderSelectionBox = null;
    }

    builderFixtures.forEach(fix => {
        const mesh = createFixtureMesh(fix, false);
        builderGroup.add(mesh);
    });

    if (builderSelectedFixture) {
        const selectedMesh = builderGroup.children.find(c => c.userData.fixture?.id === builderSelectedFixture.id);
        if (selectedMesh) {
            builderSelectionBox = new THREE.BoxHelper(selectedMesh, 0x00ffcc);
            scene.add(builderSelectionBox);
            updateBuilderInspectorUI();
        }
    }
}

function updateBuilderInspectorUI() {
    const inspectorEl = document.getElementById('builder-inspector');
    const inspectIdEl = document.getElementById('builder-inspect-id');
    const heightEl = document.getElementById('builder-height');
    const heightValEl = document.getElementById('builder-height-val');

    if (!inspectorEl) return;

    if (builderSelectedFixture) {
        inspectorEl.style.display = 'block';
        if (inspectIdEl) inspectIdEl.textContent = `${builderSelectedFixture.type} (${builderSelectedFixture.id})`;
        if (heightEl) heightEl.value = builderSelectedFixture.position.y;
        if (heightValEl) heightValEl.textContent = `${builderSelectedFixture.position.y.toFixed(1)}m`;
    } else {
        inspectorEl.style.display = 'none';
    }
}

function selectBuilderFixture(fixture) {
    builderSelectedFixture = fixture;
    if (builderSelectionBox) {
        scene.remove(builderSelectionBox);
        builderSelectionBox = null;
    }
    if (fixture) {
        const selectedMesh = builderGroup.children.find(c => c.userData.fixture?.id === fixture.id);
        if (selectedMesh) {
            builderSelectionBox = new THREE.BoxHelper(selectedMesh, 0x00ffcc);
            scene.add(builderSelectionBox);
        }
    }
    updateBuilderInspectorUI();
}

function setStageBuilderMode(active) {
    isStageBuilderMode = active;
    const palette = document.getElementById('stage-builder-palette');

    if (active) {
        builderGrid.visible = true;
        builderGroup.visible = true;
        if (palette) palette.classList.remove('hidden');

        const loaded = loadLayoutFromStorage();
        builderFixtures = loaded && Array.isArray(loaded.fixtures) ? loaded.fixtures : [];
        syncBuilderVisuals();
        updateBuilderGhost();
    } else {
        builderGrid.visible = false;
        builderGroup.visible = false;
        if (builderGhostMesh) {
            scene.remove(builderGhostMesh);
            builderGhostMesh = null;
        }
        if (builderSelectionBox) {
            scene.remove(builderSelectionBox);
            builderSelectionBox = null;
        }
        if (palette) palette.classList.add('hidden');
    }
}

// Stage Builder Pointer & Keyboard Interactions
window.addEventListener('pointermove', e => {
    if (!isStageBuilderMode) return;
    builderMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    builderMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    builderRaycaster.setFromCamera(builderMouse, builderCamera);
    if (builderRaycaster.ray.intersectPlane(builderGroundPlane, builderPlaneIntersect)) {
        const snappedX = snapToGrid(builderPlaneIntersect.x, 0.5);
        const snappedZ = snapToGrid(builderPlaneIntersect.z, 0.5);

        if (builderGhostMesh) {
            builderGhostMesh.position.set(snappedX, builderGhostHeight, snappedZ);
            builderGhostMesh.rotation.y = builderGhostRotY;
        }

        if (isBuilderDragging && builderSelectedFixture) {
            builderSelectedFixture.position.x = snappedX;
            builderSelectedFixture.position.z = snappedZ;
            const mesh = builderGroup.children.find(c => c.userData.fixture?.id === builderSelectedFixture.id);
            if (mesh) {
                mesh.position.set(snappedX, builderSelectedFixture.position.y, snappedZ);
                if (builderSelectionBox) builderSelectionBox.update();
            }
        }
    }
});

window.addEventListener('pointerdown', e => {
    if (!isStageBuilderMode) return;
    if (e.target.closest('#stage-builder-palette') || e.target.closest('#ui-container')) return;

    builderMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    builderMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    builderRaycaster.setFromCamera(builderMouse, builderCamera);

    if (builderActiveType === 'select') {
        const intersects = builderRaycaster.intersectObjects(builderGroup.children, true);
        if (intersects.length > 0) {
            let root = intersects[0].object;
            while (root.parent && root.parent !== builderGroup) root = root.parent;
            if (root.userData.fixture) {
                selectBuilderFixture(root.userData.fixture);
                isBuilderDragging = true;
            }
        } else {
            selectBuilderFixture(null);
        }
    } else {
        if (builderRaycaster.ray.intersectPlane(builderGroundPlane, builderPlaneIntersect)) {
            const snappedX = snapToGrid(builderPlaneIntersect.x, 0.5);
            const snappedZ = snapToGrid(builderPlaneIntersect.z, 0.5);
            const newFixture = {
                id: `fix-${builderActiveType}-${Date.now().toString(36)}-${Math.floor(Math.random()*1000)}`,
                type: builderActiveType,
                position: { x: snappedX, y: builderGhostHeight, z: snappedZ },
                rotation: { x: 0, y: builderGhostRotY, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                properties: {}
            };
            builderFixtures.push(newFixture);
            syncBuilderVisuals();
            selectBuilderFixture(newFixture);
        }
    }
});

window.addEventListener('pointerup', () => {
    isBuilderDragging = false;
});

window.addEventListener('keydown', e => {
    if (!isStageBuilderMode) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (builderSelectedFixture && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
            builderFixtures = builderFixtures.filter(f => f.id !== builderSelectedFixture.id);
            selectBuilderFixture(null);
            syncBuilderVisuals();
        }
    }
});

// Stage Builder UI Bindings
const btnStageBuilder = document.getElementById('btn-stage-builder');
if (btnStageBuilder) {
    btnStageBuilder.addEventListener('click', () => {
        setStageBuilderMode(!isStageBuilderMode);
    });
}

const btnBuilderClose = document.getElementById('btn-builder-close');
if (btnBuilderClose) {
    btnBuilderClose.addEventListener('click', () => {
        setStageBuilderMode(false);
    });
}

const btnBuilderSave = document.getElementById('btn-builder-save');
if (btnBuilderSave) {
    btnBuilderSave.addEventListener('click', () => {
        saveLayoutToStorage({ version: '1.0.0', name: 'Custom Stage', fixtures: builderFixtures });
        alert('Custom layout saved to localStorage!');
    });
}

const btnBuilderLoad = document.getElementById('btn-builder-load');
if (btnBuilderLoad) {
    btnBuilderLoad.addEventListener('click', () => {
        const loaded = loadLayoutFromStorage();
        builderFixtures = loaded.fixtures || [];
        syncBuilderVisuals();
    });
}

const btnBuilderClear = document.getElementById('btn-builder-clear');
if (btnBuilderClear) {
    btnBuilderClear.addEventListener('click', () => {
        builderFixtures = [];
        selectBuilderFixture(null);
        syncBuilderVisuals();
    });
}

const btnTemplateFestival = document.getElementById('btn-template-festival');
if (btnTemplateFestival) {
    btnTemplateFestival.addEventListener('click', () => {
        const t = getTemplateLayout('Large Festival');
        builderFixtures = t.fixtures;
        syncBuilderVisuals();
    });
}

const btnTemplateClub = document.getElementById('btn-template-club');
if (btnTemplateClub) {
    btnTemplateClub.addEventListener('click', () => {
        const t = getTemplateLayout('Small Club');
        builderFixtures = t.fixtures;
        syncBuilderVisuals();
    });
}

const btnBuilderLaunch = document.getElementById('btn-builder-launch');
if (btnBuilderLaunch) {
    btnBuilderLaunch.addEventListener('click', () => {
        saveLayoutToStorage({ version: '1.0.0', name: 'Custom Stage', fixtures: builderFixtures });
        compiledCustomLayout = compileCustomStageLayout({ fixtures: builderFixtures });
        CFG.stagePreset = 'custom';
        const sel = document.getElementById('param-stage-preset');
        if (sel) sel.value = 'custom';
        setStageBuilderMode(false);
        buildStageEnvironment();
        initLasers();
        initMovingHeads();
        initPyroSystems();
        initUpLights();
        initCrowd();
    });
}

document.querySelectorAll('.palette-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        builderActiveType = btn.dataset.type;
        updateBuilderGhost();
    });
});

const builderHeightSlider = document.getElementById('builder-height');
if (builderHeightSlider) {
    builderHeightSlider.addEventListener('input', e => {
        const val = snapToGrid(+e.target.value, 0.5);
        builderGhostHeight = val;
        if (builderSelectedFixture) {
            builderSelectedFixture.position.y = val;
            const mesh = builderGroup.children.find(c => c.userData.fixture?.id === builderSelectedFixture.id);
            if (mesh) mesh.position.y = val;
            if (builderSelectionBox) builderSelectionBox.update();
            const valEl = document.getElementById('builder-height-val');
            if (valEl) valEl.textContent = `${val.toFixed(1)}m`;
        }
        if (builderGhostMesh) builderGhostMesh.position.y = val;
    });
}

['15', '45', '90'].forEach(degStr => {
    const rotBtn = document.getElementById(`btn-builder-rot-${degStr}`);
    if (rotBtn) {
        rotBtn.addEventListener('click', () => {
            const rad = (+degStr * Math.PI) / 180;
            builderGhostRotY = normalizeYaw(builderGhostRotY + rad);
            if (builderSelectedFixture) {
                const currentRot = builderSelectedFixture.rotation?.y || 0;
                builderSelectedFixture.rotation = builderSelectedFixture.rotation || { x: 0, y: 0, z: 0 };
                builderSelectedFixture.rotation.y = normalizeYaw(currentRot + rad);
                const mesh = builderGroup.children.find(c => c.userData.fixture?.id === builderSelectedFixture.id);
                if (mesh) mesh.rotation.y = builderSelectedFixture.rotation.y;
                if (builderSelectionBox) builderSelectionBox.update();
            }
            if (builderGhostMesh) builderGhostMesh.rotation.y = builderGhostRotY;
        });
    }
});

const btnBuilderDeleteFixture = document.getElementById('btn-builder-delete-fixture');
if (btnBuilderDeleteFixture) {
    btnBuilderDeleteFixture.addEventListener('click', () => {
        if (builderSelectedFixture) {
            builderFixtures = builderFixtures.filter(f => f.id !== builderSelectedFixture.id);
            selectBuilderFixture(null);
            syncBuilderVisuals();
        }
    });
}

// Stage Preset Dropdown Listener
const stagePresetSelect = document.getElementById('param-stage-preset');
if (stagePresetSelect) {
    stagePresetSelect.addEventListener('change', e => {
        const presetKey = e.target.value;
        CFG.stagePreset = presetKey;

        if (presetKey === 'custom') {
            const layout = loadLayoutFromStorage();
            compiledCustomLayout = compileCustomStageLayout(layout);
        } else {
            const preset = getStagePreset(presetKey);
            CFG.hazeDensity = preset.hazeDensity;
            const hazeSlider = document.getElementById('param-haze');
            const hazeVal = document.getElementById('val-haze');
            if (hazeSlider) hazeSlider.value = Math.round(preset.hazeDensity * 100);
            if (hazeVal) hazeVal.textContent = `${Math.round(preset.hazeDensity * 100)}%`;

            if (preset.forcedTheme) {
                CFG.theme = preset.forcedTheme;
                const themeSel = document.getElementById('param-theme');
                if (themeSel) themeSel.value = preset.forcedTheme;
                refreshLaserColors();
            }

            if (preset.cameraPreset) {
                camera.position.set(preset.cameraPreset.x, preset.cameraPreset.y, preset.cameraPreset.z);
                camera.fov = preset.cameraPreset.fov;
                camera.updateProjectionMatrix();
                controls.target.set(0, 0, 0);
                controls.update();
            }
        }

        buildStageEnvironment();
        initLasers();
        initMovingHeads();
        initPyroSystems();
        initUpLights();
        initCrowd();
    });
}

// ─── 3D DJ Avatar Toggle Listener (R6) ───────────────────────────
const djAvatarToggle = document.getElementById('param-djavatar');
if (djAvatarToggle) {
    djAvatarToggle.addEventListener('change', e => {
        djAvatarEnabled = !!e.target.checked;
        if (djAvatarRig && djAvatarRig.root) {
            djAvatarRig.root.visible = djAvatarEnabled;
        }
    });
}

// ─── Web MIDI Controller Integration UI & Dispatcher (R7) ────────
const midiIndicatorEl = document.getElementById('midi-status-indicator');
const midiModalOverlay = document.getElementById('midi-modal-overlay');
const btnMidiPanel = document.getElementById('btn-midi-panel');
const btnMidiClose = document.getElementById('btn-midi-close');
const btnMidiDone = document.getElementById('btn-midi-done');
const btnMidiReset = document.getElementById('btn-midi-reset');
const midiDeviceListEl = document.getElementById('midi-device-list');
const midiTableEl = document.getElementById('midi-mapping-table');

function updateMidiStatusUI() {
    if (midiIndicatorEl) {
        midiIndicatorEl.style.display = midiManager.isConnected ? 'block' : 'none';
        midiIndicatorEl.textContent = midiManager.isConnected ? '🎹 MIDI Connected' : '🎹 MIDI Offline';
    }
    if (midiDeviceListEl) {
        if (midiManager.inputs.length > 0) {
            const names = midiManager.inputs.map(i => i.name).join(', ');
            midiDeviceListEl.textContent = `Connected Inputs (${midiManager.inputs.length}): ${names}`;
            midiDeviceListEl.style.color = '#00ffcc';
        } else {
            midiDeviceListEl.textContent = 'Detected Inputs: None (Connect a USB MIDI Controller)';
            midiDeviceListEl.style.color = '#888';
        }
    }
}

function renderMidiMappingTable() {
    if (!midiTableEl) return;
    midiTableEl.innerHTML = '';

    const paramLabels = {
        intensity: 'Laser Intensity',
        hazeDensity: 'Haze Density',
        spread: 'Laser Spread',
        speed: 'Laser Speed',
        bloom: 'Bloom Strength',
        dropTrigger: 'Manual Drop Trigger',
        co2Fire: 'Fire CO2 Jet Blast',
        autoCamToggle: 'Toggle Auto-Cam',
        themeCycle: 'Cycle Color Theme',
        cameraPan: 'Camera Orbit Pan'
    };

    for (const [key, mapping] of Object.entries(midiManager.mappings)) {
        const row = document.createElement('div');
        row.className = 'midi-map-row';

        const label = document.createElement('div');
        label.className = 'midi-param-label';
        label.textContent = paramLabels[key] || mapping.label || key;

        const badge = document.createElement('div');
        badge.className = 'midi-code-badge';
        if (mapping.type === 'pitchbend') {
            badge.textContent = 'Pitch Bend';
        } else if (mapping.type === 'note') {
            badge.textContent = `Note ${mapping.number}`;
        } else {
            badge.textContent = `CC ${mapping.number}`;
        }

        const barContainer = document.createElement('div');
        barContainer.className = 'midi-value-bar-container';
        const barFill = document.createElement('div');
        barFill.className = 'midi-value-bar-fill';
        const recentVal = midiManager.recentValues[mapping.number] ?? 0;
        barFill.style.width = `${Math.min(100, Math.max(0, recentVal * 100))}%`;
        barContainer.appendChild(barFill);

        const learnBtn = document.createElement('button');
        learnBtn.className = `midi-learn-btn ${midiManager.isLearning && midiManager.learningTarget === key ? 'learning' : ''}`;
        learnBtn.textContent = (midiManager.isLearning && midiManager.learningTarget === key) ? 'Learning...' : 'Learn';
        learnBtn.addEventListener('click', () => {
            if (midiManager.isLearning && midiManager.learningTarget === key) {
                midiManager.cancelLearn();
            } else {
                midiManager.startLearn(key);
            }
            renderMidiMappingTable();
        });

        row.appendChild(label);
        row.appendChild(badge);
        row.appendChild(barContainer);
        row.appendChild(learnBtn);
        midiTableEl.appendChild(row);
    }
}

// Wire real-time MIDI parameter callbacks to simulation
const midiCallbacks = {
    intensity: (val) => {
        CFG.intensity = val;
        const slider = document.getElementById('param-intensity');
        if (slider) slider.value = val;
    },
    hazeDensity: (val) => {
        CFG.hazeDensity = val;
        const slider = document.getElementById('param-haze');
        const valEl = document.getElementById('val-haze');
        if (slider) slider.value = Math.round(val * 100);
        if (valEl) valEl.textContent = `${Math.round(val * 100)}%`;
    },
    spread: (val) => {
        CFG.spread = val;
        const slider = document.getElementById('param-spread');
        if (slider) slider.value = val;
    },
    speed: (val) => {
        CFG.speed = val;
        const slider = document.getElementById('param-speed');
        if (slider) slider.value = val;
    },
    bloom: (val) => {
        // The CC 74 mapping is declared as min 0.0 / max 2.0 in MIDI_CONFIG, so `val`
        // arrives in [0, 2]; scale it so a centred knob lands near the default 0.55.
        glBloomStrength = THREE.MathUtils.clamp(val, 0, 2) * 0.6;
        if (glBloomPass) glBloomPass.strength = glBloomStrength;
    },
    dropTrigger: () => {
        isPeakDrop = true;
        setTimeout(() => { isPeakDrop = false; }, 3000);
    },
    co2Fire: () => {
        triggerFogJet(-28, 0.2, -22, 1.5, 0.4, 0.4);
        triggerFogJet(28, 0.2, -22, -1.5, 0.4, 0.4);
    },
    autoCamToggle: (state) => {
        autoCamEnabled = (typeof state === 'boolean') ? state : !autoCamEnabled;
        const chk = document.getElementById('param-autocam');
        if (chk) chk.checked = autoCamEnabled;
    },
    themeCycle: () => {
        const themeSelect = document.getElementById('param-theme');
        if (themeSelect) {
            const options = Array.from(themeSelect.options);
            const nextIdx = (themeSelect.selectedIndex + 1) % options.length;
            themeSelect.selectedIndex = nextIdx;
            CFG.theme = options[nextIdx].value;
            refreshLaserColors();
        }
    },
    cameraPan: (val) => {
        if (controls && controls.target) {
            camera.position.x += val * 0.4;
            controls.update();
        }
    }
};

// ── MIDI Manager wiring ──────────────────────────────────────────────────────
// The manager re-binds every input on hotplug, so the dispatch context lives
// inside it rather than being patched onto input.onmidimessage from out here.
midiManager.setMessageContext({
    state: { triggers: {} },
    cfg: CFG,
    callbacks: midiCallbacks
});

midiManager.onStateChange(() => {
    updateMidiStatusUI();
    renderMidiMappingTable();
});

midiManager.onMessage(() => {
    renderMidiMappingTable();
});

/**
 * Connects to Web MIDI. Called on demand (opening the MIDI panel) and
 * automatically at startup only when the permission has already been granted —
 * prompting every visitor for MIDI access before they asked for it is hostile,
 * and in Chrome an unanswered prompt blocks the promise indefinitely.
 */
function connectMIDI() {
    return midiManager.initMIDIAccess().then((ok) => {
        updateMidiStatusUI();
        return ok;
    });
}

if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'midi', sysex: false })
            .then(status => { if (status.state === 'granted') connectMIDI(); })
            .catch(() => { /* Firefox/Safari don't expose the midi permission — wait for the panel */ });
    }
}

if (btnMidiPanel) {
    btnMidiPanel.addEventListener('click', () => {
        connectMIDI(); // opening the panel is the explicit user gesture that justifies the prompt
        isMidiModalOpen = true;
        if (midiModalOverlay) midiModalOverlay.style.display = 'flex';
        updateMidiStatusUI();
        renderMidiMappingTable();
    });
}

if (btnMidiClose) {
    btnMidiClose.addEventListener('click', () => {
        isMidiModalOpen = false;
        if (midiModalOverlay) midiModalOverlay.style.display = 'none';
        midiManager.cancelLearn();
    });
}

if (btnMidiDone) {
    btnMidiDone.addEventListener('click', () => {
        isMidiModalOpen = false;
        if (midiModalOverlay) midiModalOverlay.style.display = 'none';
        midiManager.cancelLearn();
        midiManager.saveToStorage();
    });
}

if (btnMidiReset) {
    btnMidiReset.addEventListener('click', () => {
        midiManager.mappings = JSON.parse(JSON.stringify(MIDI_CONFIG.defaultMappings));
        midiManager.saveToStorage();
        renderMidiMappingTable();
    });
}

// ─── Offline PWA & Service Worker Registration (R8) ──────────────
// ── Service Worker ───────────────────────────────────────────────────────────
// Only in a production build. During development Vite serves every module as a
// separate request under /src/ and /node_modules/.vite/, and a caching service
// worker will happily hand back yesterday's copy of one module next to today's
// copy of another. The result is a half-updated app that fails in ways that look
// nothing like the code on disk.
//
// Registering is not enough to undo: a worker installed by an earlier build stays
// in control of the origin until something removes it, so dev also actively tears
// down any worker and cache it finds.
if (import.meta.env && import.meta.env.PROD) {
    registerServiceWorker('/sw.js');
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
        .then(async (regs) => {
            if (!regs.length) return;
            await Promise.all(regs.map(r => r.unregister()));
            if (typeof caches !== 'undefined') {
                const keys = await caches.keys();
                await Promise.all(keys.filter(k => k.startsWith('laserrave-')).map(k => caches.delete(k)));
            }
            console.warn('[PWA] Removed a service worker left over from a production build. ' +
                         'Reload once to make sure every module comes from the dev server.');
        })
        .catch(() => { /* not fatal in dev */ });
}


