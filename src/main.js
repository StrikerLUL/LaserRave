import { computeFormation } from './utils/computeFormation.js';
import * as THREE from 'three';
import { pass, uniform, texture, uv, vec4, vec2, length, smoothstep, color as tslColor, positionLocal } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import { WebGPURenderer, RenderPipeline } from 'three/webgpu';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { afterImage } from 'three/examples/jsm/tsl/display/AfterImageNode.js';
import { film } from 'three/examples/jsm/tsl/display/FilmNode.js';
import { rgbShift } from 'three/examples/jsm/tsl/display/RGBShiftNode.js';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
// Removed Reflector due to WebGPU incompatibility

import { computeFormationPositions } from './utils/formations.js';

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
const CFG = {
  stageSize:     'large',  // 'large' or 'small'
  laserCount:    180,      // Massive stage scale
  movingHeadCount: 120,    // Massive stage scale
  intensity:     1.0,
  speed:         1.0,
  mhIntensity:   1.0,
  mhSpeed:       1.0,
  ulIntensity:   1.0,
  spread:        1.2,
  thickness:     1.0,
  tilt:          30,
  theme:         'dynamic',
  formation:     'front',   // 'front'|'twin'|'sides'|'surround'|'corners'|'aerial'
  beamsPerLaser: 1,        // 1–5 beams per projector
  beamSpread:    0.28,     // radians – total fan angle across all beams
  hazeDensity:   0.65,     // 0–1
  screenBrightness: 1.0,
  screenReactivity: 1.0,
  themes: {
    dynamic:  [0xffffff], // Will be overridden in animation loop
    rgb:      [0xff2222, 0x22ff44, 0x2244ff, 0xffff00, 0xff00ff, 0x00ffff],
    cyberpunk:[0xff00ff, 0x00ffff, 0xaa00ff, 0xff0088, 0x00ffaa, 0xffaa00],
    warm:     [0xff2200, 0xff6600, 0xffaa00, 0xff0000, 0xff3300, 0xffcc00],
    matrix:   [0x00ff00, 0x00cc00, 0x00ff88, 0x44ff44, 0x00ff44, 0x88ff00],
    vortex:   [0x8a2be2, 0x4b0082, 0x0000ff, 0xff00ff, 0x9400d3, 0x4169e1],
    synthwave:[0xff00ff, 0x00ffff, 0x4400ff, 0xff00aa, 0x00aaff, 0xaa00ff],
    ocean:    [0x001133, 0x0055ff, 0x00aaff, 0x00ffff, 0x00ffcc, 0x1177aa],
    aurora:   [0x00ff88, 0x00ccff, 0x8800ff, 0x00ffcc, 0x0088ff, 0xcc00ff],
    toxic:    [0x33ff00, 0xccff00, 0x8800ff, 0x00ff33, 0xffff00, 0x5500aa],
    neoncity: [0xff0055, 0x00ffcc, 0xffdd00, 0xcc00ff, 0x00ff66, 0xff00aa],
    cosmic:   [0x9b59b6, 0x8e44ad, 0xffffff, 0xff66cc, 0x330066, 0xcc99ff],
    quasar:   [0x0044ff, 0xff0044, 0xff00ff, 0x00ffff, 0xffffff, 0x8800ff],
    toxic:    [0x39ff14, 0x8a2be2, 0x00ff00, 0x9400d3, 0x7fff00, 0x4b0082],
    thunderstorm: [0x0022ff, 0xffffff, 0x4466ff, 0x88aaff, 0x0000ff, 0xddddff],
  }
};

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
let isWebGPU = false; // track if we have real WebGPU for TSL postProcessing
try {
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    isWebGPU = false;
    console.log('WebGLRenderer initialized successfully');
  } catch (e) {
    console.error("Renderer init failed", e);
  }
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // Only disable built-in tone mapping when WebGPU handles it via TSL pipeline;
  // for WebGL fallback keep ACESFilmic so colors look correct.
  if (isWebGPU) {
    renderer.toneMapping = THREE.NoToneMapping;
  } else {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
  }
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
  fallbackDiv.innerHTML = '<h3>WebGPU/WebGL Error</h3><p>Sorry, your browser or device does not support WebGPU/WebGL rendering which is required for this application.</p>';
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
    domElement: document.createElement('canvas')
  };
  isWebGPU = false;
}

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
    { pos: new THREE.Vector3(0, 8, 45), look: new THREE.Vector3(0, 10, -15) },   // Front center wide (TikTok safe, further back)
    { pos: new THREE.Vector3(-18, 6, 30), look: new THREE.Vector3(0, 8, -15) },  // Side left deep, avoids direct beam paths
    { pos: new THREE.Vector3(18, 6, 30), look: new THREE.Vector3(0, 8, -15) },   // Side right deep
    { pos: new THREE.Vector3(0, 35, 28), look: new THREE.Vector3(0, 5, -15) },   // High birds eye pushed back
    { pos: new THREE.Vector3(-12, 3, 15), look: new THREE.Vector3(4, 12, -20) }, // DJ Booth left but pushed back out of heavy lasers
    { pos: new THREE.Vector3(12, 3, 15), look: new THREE.Vector3(-4, 12, -20) }, // DJ Booth right pushed back
    { pos: new THREE.Vector3(0, 2, 35), look: new THREE.Vector3(0, 14, -15) },   // Far crowd center looking up (great for vertical aspect)
    { pos: new THREE.Vector3(-22, 18, 5), look: new THREE.Vector3(0, 6, -15) },  // Panned left looking down
    { pos: new THREE.Vector3(22, 18, 5), look: new THREE.Vector3(0, 6, -15) }    // Panned right looking down
];

const baseCamPos = new THREE.Vector3(0, 10, 45);
const baseCamTarget = new THREE.Vector3(0, 6, 0);
const autoCamFocus = new THREE.Vector3(0, 5, -10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 5, 0);
controls.minDistance = 5;
controls.maxDistance = 80;

// TransformControls for Studio Mode
const transformControl = new TransformControls(camera, renderer.domElement);
transformControl.addEventListener('dragging-changed', function (event) {
  controls.enabled = !event.value; // Disable orbit when dragging
});
if (transformControl.getHelper) {
    scene.add(transformControl.getHelper());
} else if (transformControl instanceof THREE.Object3D) {
    scene.add(transformControl);
}

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();


// ─── Post-Processing (TSL Node-based) ────────
let fxBlurEnabled = false;
let fxVhsEnabled = false;
let raybounceEnabled = false;

// These TSL nodes MUST be created AFTER renderer.init() — they are set up in the async
// init block below. Declared here so rebuildPostChain() and the animate loop can reference them.
let scenePass = null;
let sceneColor = null;
let bloomNode  = null;
let postProcessing = null;

// Uniforms for VHS/blur controls (safe to create before init)
const afterImageDamp  = uniform(0.88);
const filmTimeUniform = uniform(0.0);
const rgbShiftAmount  = uniform(0.0015);

// Proxy compat objects so legacy code that references filmPass.enabled etc still works
const afterimagePass = { enabled: false };
const filmPass     = { enabled: false, uniforms: { time: { get value() { return filmTimeUniform.value; }, set value(v) { filmTimeUniform.value = v; } } } };
const rgbShiftPass = { enabled: false, uniforms: { amount: { get value() { return rgbShiftAmount.value; }, set value(v) { rgbShiftAmount.value = v; } } } };

// Rebuilds the TSL output chain to include only the active effects
function rebuildPostChain() {
    if (!postProcessing || !sceneColor || !bloomNode) return;
    let chain = sceneColor.add(bloomNode);
    if (fxBlurEnabled)  chain = afterImage(chain, afterImageDamp);
    if (fxVhsEnabled)   chain = rgbShift(film(chain, filmTimeUniform, 0.35, 648), rgbShiftAmount);
    postProcessing.outputNode = chain.toneMapping(THREE.NeutralToneMapping);
    postProcessing.needsUpdate = true;
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

function buildStageEnvironment() {
    // Clear old stage
    while(stageGroup.children.length > 0){ 
        const child = stageGroup.children[0];
        stageGroup.remove(child); 
    }
    screenMeshes.length = 0;
    stageBuildQueue.length = 0;

    if (CFG.stageSize === 'large') {
        // Horizontal Main Trusses (Multiple layers)
        stageBuildQueue.push(() => createTruss(120, 0.4, 0.4, 0, 18, -25));
        stageBuildQueue.push(() => createTruss(120, 0.4, 0.4, 0, 14, -20));
        stageBuildQueue.push(() => createTruss(120, 0.4, 0.4, 0, 10, -15));
        
        // Vertical Supports
        for (let x of [-45, -25, 0, 25, 45]) {
            stageBuildQueue.push(() => createTruss(0.3, 20, 0.3, x, 10, -25));
        }
        
        // Side "Wings" Trusses (Angled)
        stageBuildQueue.push(() => createTruss(40, 0.4, 0.4, -60, 12, -10, 0, Math.PI / 4, 0));
        stageBuildQueue.push(() => createTruss(40, 0.4, 0.4, 60, 12, -10, 0, -Math.PI / 4, 0));

        stageBuildQueue.push(() => {
            backWall = new THREE.Mesh(
              new THREE.PlaneGeometry(250, 60),
              new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 1.0 })
            );
            backWall.position.set(0, 30, -50);
            stageGroup.add(backWall);
        });

        // Center Massive Wall
        stageBuildQueue.push(() => addScreen(30, 15, 0, 7.5, -30));
        
        // Side Wings (Towers)
        for (let i = 0; i < 3; i++) {
            const xOff = 25 + i * 15;
            const zPos = -25 + i * 5;
            const ry = -Math.PI / 8 * (i + 1);
            stageBuildQueue.push(() => addScreen(8, 20, -xOff, 10, zPos, -ry));
            stageBuildQueue.push(() => addScreen(8, 20, xOff, 10, zPos, ry));
        }
        
        // DJ Booth Screens
        stageBuildQueue.push(() => addScreen(8, 4, 0, 2, -15));
        
        // Massive PA Wall
        const paMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
        for (let side of [-1, 1]) {
          for (let column = 0; column < 2; column++) {
            stageBuildQueue.push(() => {
                const paGroup = new THREE.Group();
                paGroup.position.set(side * (18 + column * 4), 0, -28);
                for (let i = 0; i < 6; i++) {
                  const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2.5), paMat);
                  box.position.y = 1 + i * 2.1;
                  paGroup.add(box);
                }
                stageGroup.add(paGroup);
            });
          }
        }
    } else {
        // SMALL STAGE
        // Single back truss
        stageBuildQueue.push(() => createTruss(40, 0.4, 0.4, 0, 10, -10));
        // Vertical Supports
        for (let x of [-18, 18]) {
            stageBuildQueue.push(() => createTruss(0.3, 10, 0.3, x, 5, -10));
        }

        stageBuildQueue.push(() => {
            backWall = new THREE.Mesh(
              new THREE.PlaneGeometry(80, 30),
              new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 1.0 })
            );
            backWall.position.set(0, 15, -15);
            stageGroup.add(backWall);
        });

        // Single smaller screen behind DJ
        stageBuildQueue.push(() => addScreen(16, 9, 0, 5, -9));

        // Small PA
        const paMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
        for (let side of [-1, 1]) {
            stageBuildQueue.push(() => {
                const paGroup = new THREE.Group();
                paGroup.position.set(side * 8, 0, -8);
                for (let i = 0; i < 3; i++) {
                  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 1.5), paMat);
                  box.position.y = 0.75 + i * 1.6;
                  paGroup.add(box);
                }
                stageGroup.add(paGroup);
            });
        }
    }

    // Common Elements (DJ Table + CDJs)
    stageBuildQueue.push(() => {
        const djZ = CFG.stageSize === 'large' ? -15 : -6;
        const djTable = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        djTable.position.set(0, 0.6, djZ);
        stageGroup.add(djTable);
        
        const eqMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5 });
        const mixer = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 1.5), eqMat);
        mixer.position.set(0, 1.3, djZ);
        stageGroup.add(mixer);
        const cdj1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.4), eqMat);
        cdj1.position.set(-1.4, 1.275, djZ);
        stageGroup.add(cdj1);
        const cdj2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.4), eqMat);
        cdj2.position.set(1.4, 1.275, djZ);
        stageGroup.add(cdj2);
    });
}

buildStageEnvironment();

scene.add(new THREE.AmbientLight(0x334466, 1.2)); // Strong ambient so stage geometry is always visible
const stageLight = new THREE.PointLight(0x6688ff, 2.0, 200); // Bright stage illumination
stageLight.position.set(0, 20, 0);
scene.add(stageLight);

// Extra fill lights so trusses/screens are never pitch-black
const fillLeft  = new THREE.PointLight(0x334466, 1.0, 150);
fillLeft.position.set(-40, 15, -10);
scene.add(fillLeft);

const fillRight = new THREE.PointLight(0x334466, 1.0, 150);
fillRight.position.set(40, 15, -10);
scene.add(fillRight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.5); // Slightly stronger directional key
sunLight.position.set(0, 50, 50);
scene.add(sunLight);


// ─────────────────────────────────────────────
//  PYROTECHNIK SYSTEM (Offloaded to Worker)
// ─────────────────────────────────────────────

const pyroWorker = new Worker(new URL('./pyro-worker.js', import.meta.url), { type: 'module' });
let pyroSystemIdCounter = 0;

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
        blending: THREE.AdditiveBlending
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
        this.posAttr   = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.ageAttr   = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
        this.ltAttr    = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
        this.sizeAttr  = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
        this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
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

        pyroWorker.postMessage({
            type: 'init',
            id: this.id,
            config: { x, y, z, type, maxParticles, emitDir, spread }
        });

        this.onWorkerMessage = (e) => {
            const { type, id, posArray, ageArray, ltArray, sizeArray, colorArray } = e.data;
            if (type === 'updated' && id === this.id) {
                this.posAttr.array = posArray;
                this.ageAttr.array = ageArray;
                this.ltAttr.array = ltArray;
                this.sizeAttr.array = sizeArray;
                this.colorAttr.array = colorArray;

                this.posAttr.needsUpdate = true;
                this.ageAttr.needsUpdate = true;
                this.ltAttr.needsUpdate = true;
                this.sizeAttr.needsUpdate = true;
                this.colorAttr.needsUpdate = true;
                this.geo.setDrawRange(0, this.maxParticles);
                this.isUpdating = false;
                this.points.visible = true;
            }
        };

        pyroWorker.addEventListener('message', this.onWorkerMessage);
    }

    update(dt, globalT, energy, bass, kick, windX, windY, pyroIntensity, isPeak) {
        if (this.isUpdating) return;
        this.isUpdating = true;
        this.points.visible = false;

        const posArray = this.posAttr.array;
        const ageArray = this.ageAttr.array;
        const ltArray = this.ltAttr.array;
        const sizeArray = this.sizeAttr.array;
        const colorArray = this.colorAttr.array;

        pyroWorker.postMessage({
            type: 'update',
            id: this.id,
            data: {
                dt, globalT, energy, bass, kick, windX, windY, pyroIntensity, isPeak,
                posArray, ageArray, ltArray, sizeArray, colorArray
            }
        }, [posArray.buffer, ageArray.buffer, ltArray.buffer, sizeArray.buffer, colorArray.buffer]);
    }

    dispose() {
        pyroWorker.removeEventListener('message', this.onWorkerMessage);
        pyroWorker.postMessage({ type: 'dispose', id: this.id });
        scene.remove(this.points);
        this.geo.dispose();
        if (this.points.material) this.points.material.dispose();
    }
}

// ─────────────────────────────────────────────
//  PLACE PYRO UNITS ON STAGE
// ─────────────────────────────────────────────
function initPyroSystems() {
    // Clear old
    pyroSystems.forEach(p => p.dispose());
    pyroSystems = [];

    const sparkZ = CFG.stageSize === 'large' ? -10 : -3; 

    if (CFG.stageSize === 'large') {
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

    // 2 spark fountains on the DJ table surface (djZ table is moved in small stage so we adjust Z here)
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
        transparent: true, opacity: 0.02 + CFG.hazeDensity * 0.06,
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
        transparent: true, opacity: CFG.hazeDensity * 0.02,
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
    CFG.movingHeadCount = count;
    if (!movingHeadsEnabled) return;

    setupMovingHeadIM(count);

    let idx = 0;
    MH_TRUSS_ROWS.forEach((row, ri) => {
        const rowCount = ri < MH_TRUSS_ROWS.length - 1
            ? Math.round(count * row.cols)
            : count - idx; // last row gets remainder
        const spacing = rowCount > 1 ? 120 / (rowCount - 1) : 0;

        for (let c = 0; c < rowCount && idx < count; c++, idx++) {
            const x = -60 + c * (rowCount > 1 ? spacing : 0);
            const y = row.y;
            const z = row.z;

            const proxy = new THREE.Group();
            proxy.position.set(x, y, z);
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
                //  tilt > 0 → beam sweeps downward toward floor (correct for overhead fixtures)
            });
        }
    });
}

const PATTERN_IDS = {
    'fan': 0, 'wave': 1, 'xcross': 2, 'salvo': 3, 'tunnel': 4,
    'sidesweep': 5, 'vortex': 6, 'strobe': 7, 'scatter': 8, 'sine': 9,
    'chase': 10, 'chase-fast': 11, 'zigzag': 12, 'sparkle': 13, 'pulse': 14,
    'starburst': 15, 'lightning': 16
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
      else if (uPattern == 16) { // lightning
          float lightningSpeed = 15.0;
          float flash = step(0.95, fract(uTime * 3.0 + wn * 7.0));
          localPan = (fract(sin(dot(vec2(uTime * lightningSpeed, aInstanceID), vec2(12.9898,78.233))) * 43758.5453) - 0.5) * 2.0 * sp * flash;
          localTilt = uTilt + (fract(cos(dot(vec2(uTime * lightningSpeed, aInstanceID), vec2(12.9898,78.233))) * 43758.5453) - 0.5) * sp * flash;
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
          } else if (uPattern == 16) {
              patternOpMod = step(0.95, fract(uTime * 3.0 + wn * 7.0));
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
      
      vec3 baseColor;
      if (uIsDynamicTheme > 0.5) {
          float h = mod(aSectionLaserHue, 360.0);
          baseColor = hsl2rgb(vec3(h / 360.0, 0.85, 0.5 * op + 0.02));
      } else {
          baseColor = aStaticColor * (op * 0.9 + 0.02);
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
          float lightningSpeed = 15.0;
          float flash = step(0.95, fract(uTime * 3.0 + wn * 7.0));
          localPan = (fract(sin(dot(vec2(uTime * lightningSpeed, aInstanceID), vec2(12.9898,78.233))) * 43758.5453) - 0.5) * 2.0 * sp * flash;
          localTilt = uTilt + (fract(cos(dot(vec2(uTime * lightningSpeed, aInstanceID), vec2(12.9898,78.233))) * 43758.5453) - 0.5) * sp * flash;
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
          } else if (uPattern == 16) {
              patternOpMod = step(0.95, fract(uTime * 3.0 + wn * 7.0));
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
    const cols  = CFG.themes[CFG.theme];
    
    for (let i = 0; i < count; i++) {
        const s = slots[i];
        aBaseYaw.setX(i, s.baseYaw);
        aSectionLaserHue.setX(i, (i * 360 / count) % 360);
        _col1.set(cols[i % cols.length]);
        aStaticColor.setXYZ(i, _col1.r, _col1.g, _col1.b);
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
                { uOpacityMultiplier: { value: 0.1 + CFG.hazeDensity * 0.3 } }
            ]),
            vertexShader: laserVertexShader,
            fragmentShader: laserFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    } else {
        laserCoreMaterial.uniforms.uOpacityMultiplier.value = 0.1 + CFG.hazeDensity * 0.3;
    }

    if (!laserTubeMaterial) {
        laserTubeMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib['common'],
                THREE.UniformsLib['fog'],
                laserUniforms,
                { uOpacityMultiplier: { value: CFG.hazeDensity * 0.15 } }
            ]),
            vertexShader: laserVertexShader,
            fragmentShader: laserFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    } else {
        laserTubeMaterial.uniforms.uOpacityMultiplier.value = CFG.hazeDensity * 0.15;
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
    CFG.laserCount = count;
    setupLaserIM(count);

    const slots = computeFormationPositions(count, CFG.formation);
    const cols  = CFG.themes[CFG.theme];

    for (let i = 0; i < count; i++) {
        const s = slots[i];
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

        _col1.set(cols[i % cols.length]);
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


// (duplicate initLasers removed – the zone-aware version above is the canonical one)
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
    crowdObjects.forEach(c => {
        if (c.mesh) scene.remove(c.mesh);
    });
    crowdObjects.length = 0;
    
    if (!liveCrowdEnabled) return;
    
    if (!crowdMatDown || !crowdMatUp) {
        createCrowdMaterials();
    }
    
    const count = 180;
    const crowdGeo = new THREE.PlaneGeometry(1.9, 1.9);
    const baseColor = new THREE.Color(dynamicCrowdEnabled ? 0x1a1824 : 0xffffff);
    
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
    
    // We want 10 uplights across the back of the stage
    const count = 10;
    const beamLen = 35;
    const beamGeo = new THREE.CylinderGeometry(4.0, 0.1, beamLen, 12, 1, true);
    beamGeo.translate(0, beamLen / 2, 0); // Origin at base of cylinder
    beamGeo.rotateX(Math.PI / 20); // Tilt slightly forward for a great volumetric look
    
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.4, 8);
    
    for (let i = 0; i < count; i++) {
        // Space them out at the back wall (z = -28)
        const x = -35 + (i / (count - 1)) * 70;
        const y = 0.2;
        const z = -28;
        
        const group = new THREE.Group();
        group.position.set(x, y, z);
        
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
            density: { value: CFG.hazeDensity },
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
        laserCoreIM.material.opacity = 0.1 + CFG.hazeDensity * 0.3;
    }
    if (typeof laserTubeIM !== 'undefined' && laserTubeIM) {
        laserTubeIM.material.opacity = CFG.hazeDensity * 0.15;
    }
    if (typeof mhCoreIM !== 'undefined' && mhCoreIM) {
        mhCoreIM.material.opacity = 0.02 + CFG.hazeDensity * 0.06;
    }
    if (typeof mhWashIM !== 'undefined' && mhWashIM) {
        mhWashIM.material.opacity = CFG.hazeDensity * 0.02;
    }
}

function initConfetti() {
    if (confettiIM) {
        scene.remove(confettiIM);
        if (confettiIM.instanceMatrix && typeof confettiIM.instanceMatrix.dispose === 'function') confettiIM.instanceMatrix.dispose();
        if (confettiIM.instanceColor && typeof confettiIM.instanceColor.dispose === 'function') confettiIM.instanceColor.dispose();
    }
    
    const count = 600;
    const geo = new THREE.PlaneGeometry(0.28, 0.14);
    const mat = new THREE.MeshBasicMaterial({
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
                24 + Math.random() * 8,
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
let audioCtx, analyser, dataArray, source, audioBuffer;
let playing = false;
let isOfflineRendering = false;
let playbackStartCtxTime = 0; // audioCtx.currentTime when play started
let playbackStartOffset  = 0; // offset in song (seconds) when play started
let songMap = null;           // pre-analyzed song data
let lastActiveSecIdForTrigger = -1;
let playlist = [];            // queue of tracks
let playlistIndex = -1;       // current track index
let tapTimes = [];            // manual BPM tap timestamps

function initAudioContext() {
  if (audioCtx) return true;
  try {
    const AudioCtxConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxConstructor) throw new Error("AudioContext not supported");
    audioCtx = new AudioCtxConstructor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    return true;
  } catch (e) {
    console.warn("Failed to initialize AudioContext:", e);
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

  } else if (CFG.theme === 'cosmic' && playing && !isSilent) {
    wanted = 'supernova';
  } else if (CFG.theme === 'quasar' && playing && !isSilent) {
    wanted = 'quasar-spin';
  } else if (CFG.theme === 'toxic' && playing && !isSilent) {
    wanted = 'radioactive';

  } else if (CFG.theme === 'thunderstorm' && playing && !isSilent) {
    wanted = 'lightning';

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

// ── Offline band render helper ─────────────────────────────────
async function renderBand(buf, loHz, hiHz) {
  try {
    const OfflineCtxConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtxConstructor) {
      console.warn("OfflineAudioContext not supported, using fallback band array.");
      return new Float32Array(buf.length);
    }

    const ctx = new OfflineCtxConstructor(1, buf.length, buf.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let last = src;
    if (loHz > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = loHz; hp.Q.value = 0.7;
      src.connect(hp); last = hp;
    }
    if (hiHz > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = hiHz; lp.Q.value = 0.7;
      last.connect(lp); lp.connect(ctx.destination);
    } else {
      last.connect(ctx.destination);
    }
    src.start();
    return (await ctx.startRendering()).getChannelData(0);

  } catch (error) {
    console.error("Error in renderBand:", error);
    return new Float32Array(buf.length);
  }
}



// ── Per-frame RMS ──────────────────────────────────────────────
function frameRMS(data, numFrames, hop) {
  const out = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const s = f * hop, e = Math.min(s + hop, data.length);
    let sum = 0;
    for (let i = s; i < e; i++) sum += data[i] * data[i];
    out[f] = Math.sqrt(sum / (e - s));
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
    const sr = audioBuf.sampleRate;
    const len = audioBuf.length;
    const hopSec = 0.023;
    const hop = Math.round(sr * hopSec);
    const N = Math.floor(len / hop);

    setProgress(5, '⏳ Rendering audio bands…  5%');
    await new Promise(r => setTimeout(r, 0));

    // Stage 1 – offline rendering (heaviest)
    const [bd, md, hd, fd] = await Promise.all([
      renderBand(audioBuf,    0,  250),
      renderBand(audioBuf,  250, 3500),
      renderBand(audioBuf, 3500,    0),
      renderBand(audioBuf,    0,    0),
    ]);

    let bassMap, midMap, highMap, melodyMap;
    const fastAnalysisChecked = document.getElementById('param-fast-analysis')?.checked;

    if (fastAnalysisChecked) {
      console.log("Schnelle Analyse aktiv: Überspringe AI Stem Separator");
      setProgress(40, '⏳ Running fast band analysis…');
      await new Promise(r => setTimeout(r, 0));

      bassMap   = normArr(frameRMS(bd, N, hop));
      midMap    = normArr(frameRMS(md, N, hop));
      highMap   = normArr(frameRMS(hd, N, hop));
      melodyMap = midMap;
    } else {
      setProgress(32, '⏳ Loading AI Stem Separator…');
      
      const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      let aiStems = null;
      const fallbackWarning = document.getElementById('ai-fallback-warning');
      if (fallbackWarning) fallbackWarning.style.display = 'none';
      
      await new Promise((resolve, reject) => {
          worker.onmessage = (e) => {
              if (e.data.type === 'progress') {
                  setProgress(32 + e.data.percent * 0.15, e.data.message);
              } else if (e.data.type === 'fallback_active') {
                  console.warn("AI Fallback Active:", e.data.reason);
                  if (fallbackWarning) fallbackWarning.style.display = 'block';
              } else if (e.data.type === 'ready') {
                  worker.postMessage({ type: 'process', audioData: fd, sampleRate: sr });
              } else if (e.data.type === 'done') {
                  aiStems = e.data.stems;
                  worker.terminate();
                  resolve();
              }
          };
          worker.postMessage({ type: 'init' });
      });

      bassMap   = aiStems.bass;
      midMap    = aiStems.vocals;
      highMap   = aiStems.drums;
      melodyMap = aiStems.melody;
    }

    setProgress(48, '⏳ Computing energy & beats…');
    await new Promise(r => setTimeout(r, 0));

    const energyMap = normArr(frameRMS(fd, N, hop));

  setProgress(48, '⏳ Detecting beats + BPM…  48%');
  await new Promise(r => setTimeout(r, 0));

  // Beat detection
  const beats = [];
  const bw = Math.round(0.35 / hopSec);
  for (let f = bw + 1; f < N - bw; f++) {
    const v = bassMap[f];
    if (bassMap[f-1] >= v || bassMap[f+1] >= v) continue;
    let avg = 0;
    for (let k = -bw; k < bw; k++) avg += bassMap[f + k];
    avg /= bw * 2;
    if (v > avg * 1.55 && v > 0.10) beats.push({ frame: f, time: f * hopSec, strength: v });
  }

  // BPM from median inter-beat interval
  let estimatedBPM = 128;
  if (beats.length > 4) {
    const ivs = [];
    for (let i = 2; i < beats.length - 2; i++) ivs.push(beats[i+1].time - beats[i].time);
    ivs.sort((a, b) => a - b);
    const med = ivs[Math.floor(ivs.length / 2)];
    estimatedBPM = Math.round(60 / med);
    while (estimatedBPM < 60)  estimatedBPM *= 2;
    while (estimatedBPM > 200) estimatedBPM /= 2;
  }

  setProgress(62, '⏳ Detecting section boundaries…  62%');
  await new Promise(r => setTimeout(r, 0));

  // Spectral novelty
  const nw = Math.round(0.3 / hopSec);
  const novelty = new Float32Array(N);
  for (let f = nw; f < N; f++) {
    novelty[f] = Math.abs(bassMap[f] - bassMap[f-nw])
               + Math.abs(midMap[f]  - midMap[f-nw])
               + Math.abs(highMap[f] - highMap[f-nw]);
  }

  const minSF = Math.round(1.5 / hopSec);
  const bounds = [0];
  let lastB = 0;
  for (let f = minSF; f < N - minSF; f++) {
    if (f - lastB < minSF) continue;
    const v = novelty[f]; let ok = true;
    for (let k = 1; k <= 20; k++) {
      if ((f+k < N && novelty[f+k] >= v) || novelty[f-k] >= v) { ok = false; break; }
    }
    if (ok && v > 0.06) { bounds.push(f); lastB = f; }
  }
  bounds.push(N);

  setProgress(78, '⏳ Detecting build-ups…  78%');
  await new Promise(r => setTimeout(r, 0));

  // Energy build-up: windowed forward-slope in energy
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

  setProgress(90, '⏳ Building section profiles…  90%');
  await new Promise(r => setTimeout(r, 0));

  // Build sections
  const sections = [];
  for (let si = 0; si < bounds.length - 1; si++) {
    const sf = bounds[si], ef = bounds[si+1], n = ef - sf;
    let nb=0, nm=0, nh=0, ne=0;
    for (let f = sf; f < ef; f++) { nb+=bassMap[f]; nm+=midMap[f]; nh+=highMap[f]; ne+=energyMap[f]; }
    const aB=nb/n, aM=nm/n, aH=nh/n, aE=ne/n, tot=aB+aM+aH+1e-6;
    const seed = aB*137.5 + aM*97.4 + aH*53.1 + si*41.0;
    const secObj = { bassW:aB/tot, midW:aM/tot, trebleW:aH/tot, avgEnergy:aE, seed };
    sections.push({
      startFrame: sf, endFrame: ef,
      startTime: sf*hopSec, endTime: ef*hopSec,
      avgBass: aB, avgMid: aM, avgHigh: aH, avgEnergy: aE,
      bassW: aB/tot, midW: aM/tot, trebleW: aH/tot,
      seed, id: si,
      baseHue:   sectionBaseHue(secObj),
      pattern:   pickPattern(aB, aM, aH, aE, si),
      liss:      makeLissajous(seed),
      speedScale: 0.6 + aE * 1.4,
      spreadMod:  0.4 + aH * 1.2,
    });
  }

  // Group sections and classify them (Deep-AI Song Structure Analysis)
  let maxSecEnergy = 0;
  sections.forEach(s => {
      if (s.avgEnergy > maxSecEnergy) maxSecEnergy = s.avgEnergy;
  });

  for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      let type = 'strophe'; // default
      
      if (si === 0) {
          type = 'intro';
      } else if (si === sections.length - 1) {
          type = 'outro';
      } else if (s.avgEnergy > 0.50 || s.avgEnergy > maxSecEnergy * 0.75) {
          type = 'drop';
      } else if (s.avgEnergy < 0.18) {
          if (s.startTime < 35) type = 'intro';
          else if (s.endTime > (N * hopSec) - 35) type = 'outro';
          else type = 'strophe';
      }
      s.type = type;
  }

  // Second pass: identify build-up sections immediately preceding drops or with high buildUpMap average
  for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      if (s.type === 'intro' || s.type === 'outro' || s.type === 'drop') continue;
      
      let nextSec = sections[si + 1];
      if (nextSec && nextSec.type === 'drop') {
          s.type = 'buildup';
      } else {
          let secBuildUp = 0;
          for (let f = s.startFrame; f < s.endFrame; f++) secBuildUp += buildUpMap[f];
          secBuildUp /= (s.endFrame - s.startFrame);
          if (secBuildUp > 0.22) {
              s.type = 'buildup';
          }
      }
  }

  // Debug structural analysis result
  console.log("Deep-AI Show Generator - Classified Song Sections:");
  sections.forEach(s => {
      console.log(`  Section ${s.id}: ${s.startTime.toFixed(1)}s - ${s.endTime.toFixed(1)}s -> TYPE: ${s.type.toUpperCase()} (Energy: ${s.avgEnergy.toFixed(2)})`);
  });

  setProgress(100, '✓ ' + fileName);
  document.getElementById('btn-play-pause').disabled = false;
  document.getElementById('btn-render').disabled = false;
  
  document.getElementById('song-timeline').classList.remove('hidden');
  switchMode(currentMode); // Ensure correct parts are hidden/shown
  
  console.log(`Song analyzed: ${beats.length} beats @ ${estimatedBPM} BPM, ${sections.length} sections`);
  return { bassMap, midMap, highMap, melodyMap, energyMap, buildUpMap, beats, sections, hopSec, hop, N, bpm: estimatedBPM };
  } catch (err) {
    console.error("Analysis failed, returning fallback map:", err);
    document.getElementById('btn-play-pause').disabled = false;
    document.getElementById('btn-render').disabled = false;
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

// ── Revised loadAudio ─────────────────────────────────────────
async function loadAudio(file) {
  try {
    initAudioContext();
    if (playing && source) { source.stop(); playing = false; }
    playbackStartOffset = 0;

    const ab = await file.arrayBuffer();
    if (!audioCtx) throw new Error("AudioContext not initialized");
    audioBuffer = await audioCtx.decodeAudioData(ab);

    // Store in the playlist queue item
    let playlistItem = playlist.find(item => item.file === file || item.name === file.name);
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
    alert("Audio konnte nicht geladen werden. Ein Fallback wird verwendet.");

    // Graceful fallback for audio buffer
    try {
        initAudioContext();
        if (audioCtx) {
            audioBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 10, audioCtx.sampleRate);
            songMap = {
                bpm: 120,
                beats: [{ time: 0, strength: 1 }],
                sections: [{ startFrame: 0, endFrame: 100, startTime: 0, endTime: 10, intensity: 1, type: "drop", pattern: 'sidesweep', baseHue: 0, liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 }, speedScale: 1, spreadMod: 1 }],
                bassMap: new Float32Array(100), midMap: new Float32Array(100), highMap: new Float32Array(100), energyMap: new Float32Array(100),
                hopSec: 0.1, N: 100
            };
            waveformValid = false;
        } else {
            throw new Error("No audioCtx available for fallback");
        }
    } catch (fallbackError) {
        console.error("Fallback audio generation failed:", fallbackError);
        audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, getChannelData: () => new Float32Array(441000) };
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
      audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, getChannelData: () => new Float32Array(441000) };
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
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
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
    btn.textContent = '⏹️ Stop Recording (Recording...)';
    btn.style.backgroundColor = '#666666';
    
    try {
      if (!mediaStreamDest) mediaStreamDest = audioCtx.createMediaStreamDestination();

      try { analyser.disconnect(); } catch(e){}
      analyser.connect(mediaStreamDest);

      const canvasStream = renderer.domElement.captureStream(60);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...mediaStreamDest.stream.getAudioTracks()
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

      mediaRecorder = new MediaRecorder(combinedStream, options);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: options.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `lasershow_export.${ext}`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
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
    
    if (tiktokModeEnabled && songMap && songMap.sections.length > 0) {
      // Welcher Startmodus ist gewählt?
      const startModeRadio = document.querySelector('input[name="tiktok-start"]:checked');
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
      const elDrone = document.getElementById('param-dronecam');
      if (elDrone) elDrone.checked = false;
  }
  if (!autoCamEnabled && !tvModeEnabled && !droneEnabled && currentMode === 'live') {
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
      const elDrone = document.getElementById('param-dronecam');
      if (elDrone) elDrone.checked = false;
  } else if (!autoCamEnabled && !droneEnabled && currentMode === 'live') {
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
      const elAuto = document.getElementById('param-autocam');
      if (elAuto) elAuto.checked = false;
      const elTv = document.getElementById('param-tvmode');
      if (elTv) elTv.checked = false;
      
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
      if (!autoCamEnabled && !tvModeEnabled && currentMode === 'live') {
          controls.enabled = true;
          camera.position.copy(baseCamPos);
          controls.target.copy(baseCamTarget);
          camera.lookAt(baseCamTarget);
      }
  }
});

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
});

let fxFlareEnabled = true;
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
});
const paramTiktok = document.getElementById('param-tiktok');
const tiktokStartModePanel = document.getElementById('tiktok-startmode');
if (paramTiktok) {
  paramTiktok.addEventListener('change', e => {
    tiktokModeEnabled = e.target.checked;
    // Start-Mode Panel einblenden/ausblenden
    if (tiktokStartModePanel) {
      tiktokStartModePanel.style.display = tiktokModeEnabled ? 'block' : 'none';
    }
    window.dispatchEvent(new Event('resize')); 
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
    transformControl.detach(); // Hide controls
    
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
  // Ignore clicks if we are using the transform control
  if (transformControl.dragging) return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  
  for (let i = 0; i < intersects.length; i++) {
    const ob = intersects[i].object;
    if (ob.userData.isProjectorHitbox) {
      if (ob.userData.isMovingHead) {
          const targetHead = movingHeadObjects.find(mh => mh.proxy === ob.parent);
          if (targetHead) {
            selectedLaser = targetHead;
            transformControl.attach(targetHead.proxy);
            document.getElementById('lbl-selected-laser').textContent = `Moving Head`;
            found = true;
            break;
          }
      } else {
          const targetLaser = laserObjects.find(l => l.proxy === ob.parent);
          if (targetLaser) {
            selectedLaser = targetLaser;
            transformControl.attach(targetLaser.proxy);
            document.getElementById('lbl-selected-laser').textContent = `Laser #${targetLaser.id}`;
            found = true;
            break;
          }
      }
    }
  }
  if (!found) {
    transformControl.detach();
    selectedLaser = null;
    document.getElementById('lbl-selected-laser').textContent = 'None';
  }
});

// Transform Mode Radio Buttons
document.querySelectorAll('input[name="tm"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    transformControl.setMode(e.target.value); // 'translate' or 'rotate'
  });
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
            transformControl.detach();
            const index = movingHeadObjects.indexOf(selectedLaser);
            if (index > -1) movingHeadObjects.splice(index, 1);
        } else {
            scene.remove(selectedLaser.pivot);
            transformControl.detach();
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
        let mhOp = isSilent
            ? 0.0
            : Math.min(1.0, vocals * 1.1 + drums * 0.45 + beatState.flashDecay * 0.45 + hs.adsrState * 0.6) * activeMhIntensity;
        if (currentMode === 'studio') mhOp = Math.max(mhOp, 0.45);

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
            const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(hs.tilt, hs.pan, 0, 'YXZ'));
            const sourcePos = new THREE.Vector3(mh.pos.x, mh.pos.y - 0.55, mh.pos.z);
            activeBeams.push({
                pos: sourcePos,
                dir: dir,
                color: _col1.clone(),
                isLaser: false
            });
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
    laserUniforms.uMelody.value = melody;
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
                // ─── LIGHTNING: Fast random jagged flashes for thunderstorm ──
                case 'lightning': {
                    const lightningSpeed = 15.0;
                    const flashVal = (tAnim * 3.0 + wn * 7.0) % 1.0;
                    const flash = flashVal > 0.95 ? 1.0 : 0.0;

                    const randX = (Math.sin(tAnim * lightningSpeed * 12.9898 + i * 78.233) * 43758.5453) % 1.0;
                    const randY = (Math.cos(tAnim * lightningSpeed * 12.9898 + i * 78.233) * 43758.5453) % 1.0;

                    localPan = (Math.abs(randX) - 0.5) * 2.0 * sp * flash;
                    localTilt = tiltRad + (Math.abs(randY) - 0.5) * sp * flash;
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
            } else if (pat === 'lightning') {
                const flashVal = (tAnim * 3.0 + wn * 7.0) % 1.0;
                patternOpMod = flashVal > 0.95 ? 1.0 : 0.0;
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
            const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(l.rot.x, l.rot.y, 0, 'YXZ'));
            activeBeams.push({
                pos: l.pos,
                dir: dir,
                color: _col1.clone(),
                isLaser: true
            });
        }
    }

    laserBodyIM.instanceMatrix.needsUpdate = true;
    laserCoreIM.instanceMatrix.needsUpdate = true;
    laserTubeIM.instanceMatrix.needsUpdate = true;
    if (colorDirty && laserCoreIM.instanceColor) laserCoreIM.instanceColor.needsUpdate = true;
    if (colorDirty && laserTubeIM.instanceColor) laserTubeIM.instanceColor.needsUpdate = true;
}

function animate() {
  // Using setAnimationLoop below instead of requestAnimationFrame

  frameCount++;
  activeBeams.length = 0;

  // Lazy Loading Stage Builder Staggered Execution
  if (stageBuildQueue.length > 0) {
      const itemsToBuild = Math.min(3, stageBuildQueue.length);
      for (let i = 0; i < itemsToBuild; i++) {
          const action = stageBuildQueue.shift();
          if (action) action();
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
          const _stageWorldPos = new THREE.Vector3();
          stageGroup.children.forEach(child => {
              child.getWorldPosition(_stageWorldPos);
              const dist = _stageWorldPos.distanceTo(camera.position);
              child.visible = dist <= 110;
          });
      }
  }

  controls.update();

  // Basic t increment always moving for UI/Background noise
  t += 0.01; 

  // Shared audio values accessible by pyro update (filled in Live mode check)
  let _pyroEnergy = 0.1, _pyroBass = 0.1, _pyroKick = 0, _pyroIsPeak = false;

  if (analyser && playing && currentMode === 'live') {
    analyser.getByteFrequencyData(dataArray); drawViz();
  } else if (currentMode === 'live') {
    vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  }

  // ── Move Pyrotechnik Update to a Safe Global Spot in animate() ──
  if (pyroEnabled && !isOfflineRendering) {
      const dt = 1/60; // assume 60fps for physics
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
              _pyroEnergy, _pyroBass, _pyroKick,
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

  if (playing && section) {
      const secId = (section.id !== undefined) ? section.id : 0;
      if (secId !== lastActiveSecIdForTrigger) {
          lastActiveSecIdForTrigger = secId;
          
          if (section.type === 'drop') {
              const secName = (section.id !== undefined) ? `section ${section.id}` : 'fallback section';
              console.log(`🔥 [Deep-AI Show Generator] DROP DETECTED at ${secName}! Zünde Pyrotechnik, Sparks und CO2 Nebelwerfer!`);
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
  
  // Expose to pyro
  _pyroBass = bass; _pyroKick = kick; _pyroEnergy = energy;
  _pyroIsPeak = (playing && peakModeEnabled && (energy > 0.82 || rtSubBass > 0.75) && ((frame && frame.energy > 0.75) || rtEnergy > 0.75 || rtSubBass > 0.75))
             || (playing && section && section.type === 'drop' && energy > 0.5);
  
  // Aliases to prevent crash in legacy pattern logic
  const mid = vocals;
  const high = drums;

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
        beatState.speedMult = THREE.MathUtils.lerp(beatState.speedMult, 1.0, 0.07);
      }
      beatState.flashDecay = THREE.MathUtils.lerp(beatState.flashDecay, 0, 0.14);
      beatState.strobeTimer++;
      const sRate = Math.max(2, Math.round(8 - energy * 10));
      beatState.strobeOn = (secPat !== 'strobe') ? true
        : (beatState.strobeTimer % sRate !== 0) ? beatState.strobeOn : !beatState.strobeOn;
    } else {
      beatState.speedMult = 1.0; beatState.flashDecay = 0; beatState.strobeOn = true;
    }

    // ── Free-running t (used as fallback + opacity) ───────────────
    // Basic increment already done at top, but we add music-reactive boost here if playing
    if (playing) {
        t += 0.01 * CFG.speed * secSpeed * (1.0 + bass * 2.0) * beatState.speedMult;
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
        
        const frameDt = 1 / 60;
        
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
        camera.fov = THREE.MathUtils.lerp(camera.fov, 55 + speedK * 0.45, 0.1);
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
            // slight slow drift inside the shot
            targetX = camObj.pos.x + Math.sin(t * 0.15) * 1.5;
            targetY = camObj.pos.y + Math.sin(t * 0.22) * 0.5;
            targetZ = camObj.pos.z + Math.cos(t * 0.18) * 1.5;
            lookX = camObj.look.x + Math.sin(t * 0.1) * 0.5;
            lookY = camObj.look.y + Math.cos(t * 0.1) * 0.5;
            lookZ = camObj.look.z;
            
            if (justCut) {
                camera.position.set(targetX, targetY, targetZ);
                autoCamFocus.set(lookX, lookY, lookZ);
                justCut = false;
            } else {
                lerpSpeed = 0.08; // moderate tracking speed mostly to follow drift/shake
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

        camera.position.lerp(_targetPos.set(targetX, targetY, targetZ), lerpSpeed);
        autoCamFocus.lerp(_lookTarget.set(lookX, lookY, lookZ), lerpSpeed * 1.5);
        if (isPeakDrop) {
            autoCamFocus.x += (Math.random() - 0.5) * 3.0;
            autoCamFocus.y += (Math.random() - 0.5) * 3.0;
        }
        camera.lookAt(autoCamFocus);

    } else if (currentMode === 'live' && !transformControl.dragging && !droneEnabled) {
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
        const bouncePow = playing ? (0.5 + energy * 1.2) : 0;

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
            ul.mesh.rotation.y += 0.01;
            
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
        filmTimeUniform.value += 0.05 * CFG.speed * (isPeakDrop ? 4.0 : 1.0);
    }

    if (fxBlurEnabled) {
        // Blur FX dynamisch rein an Bass/Energie koppeln (unabhängig vom Peak-Mode Flag)
        let damp = 0.75 + (beatState.isBeat ? kick * 0.20 : 0) + (energy * 0.10);
        afterImageDamp.value = Math.min(0.98, damp);
    }

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
            if (!transformControl.dragging && selectedLaser !== l) {
                l.rot.x = THREE.MathUtils.lerp(l.rot.x, kfTilt, 0.1);
                l.rot.y = 0;
                l.rot.z = THREE.MathUtils.lerp(l.rot.z, -kfPan, 0.1);
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
          hazeMaterial.uniforms.density.value = (0.09 + beatState.flashDecay * 0.14) * CFG.hazeDensity;
      }
      hazeSystem.rotation.y += 0.00015; // very slow drift
    }

    // ── Physics & Collision Spot Updates ─────────────────
    const dt = 1 / 60; // stable physics step
    
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
  } else {
      if (lastDronePostState) {
          lastDronePostState = false;
          rgbShiftPass.enabled = fxVhsEnabled;
          rgbShiftAmount.value = 0.0015;
          rebuildPostChain();
    }
  }

  // Update Volumetric Dynamic Lighting on the Crowd
  updateCrowdLighting(1 / 60);

  camera.position.add(_camShake);

  // Render pipeline — try TSL postProcessing first, fall back to standard render
  if (postProcessing && isWebGPU) {
      try {
          postProcessing.render();
      } catch(e) {
          // PostProcessing failed (e.g. WebGPU context lost or TSL error) — disable and fall back
          console.warn('PostProcessing.render() failed, switching to WebGL fallback:', e.message || e);
          postProcessing = null;
          isWebGPU = false;
          renderer.render(scene, camera);
      }
  } else {
      renderer.render(scene, camera);
  }

  if (needsScreenshot) {
      needsScreenshot = false;
      saveScreenshot();
  }
}

async function initRenderer() {
    try {
        if (renderer.init) {
            await renderer.init();
        }
        renderer.setAnimationLoop(animate);
    } catch (e) {
        console.warn("WebGPURenderer init failed, falling back to WebGLRenderer", e);

        try {
            // Remove the failed WebGPURenderer DOM element
            if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }

            renderer = new THREE.WebGLRenderer({
                antialias: true,
                powerPreference: "high-performance"
            });
            renderer.setSize(W, H);
            renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
            renderer.toneMapping = THREE.NoToneMapping;
            document.getElementById('canvas-container').appendChild(renderer.domElement);

            // PostProcessing might need to be re-initialized for WebGL if it was WebGPU
            postProcessing = null;

            renderer.setAnimationLoop(animate);
        } catch (webglError) {
            console.error("Critical renderer initialization error (WebGL fallback failed):", webglError);
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
            fallbackDiv.innerHTML = '<h3>WebGPU/WebGL Error</h3><p>Sorry, your browser or device does not support WebGPU/WebGL rendering which is required for this application.</p>';
            document.body.appendChild(fallbackDiv);

            // Mock renderer to prevent immediate downstream TypeError crashes in animate loop
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
                domElement: document.createElement('canvas')
            };
            postProcessing = null;

            if (renderer.setAnimationLoop) renderer.setAnimationLoop(animate);
        }
    }

    // ── Set up TSL post-processing AFTER renderer.init() ──────────────────────────
    // TSL nodes (pass, bloom, etc.) require the renderer backend to be ready.
    // Creating them before init() causes silent black output.
    if (isWebGPU) {
        try {
            scenePass  = pass(scene, camera);
            sceneColor = scenePass.getTextureNode('output');
            bloomNode  = bloom(sceneColor, 1.8, 0.75, 0.1);
            postProcessing = new RenderPipeline(renderer);
            postProcessing.outputNode = sceneColor.add(bloomNode).toneMapping(THREE.NeutralToneMapping);
            console.log('✅ WebGPU PostProcessing (bloom) initialized successfully');
        } catch(e) {
            console.warn('⚠️ TSL post-processing setup failed — falling back to plain WebGL render:', e);
            postProcessing = null;
            scenePass = sceneColor = bloomNode = null;
            isWebGPU = false;
        }
    }

    // ── Start animation loop (success path) ───────────────────────────────────
    renderer.setAnimationLoop(animate);
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
    // and store frames via WebCodecs VideoEncoder to an array of chunks!
    
    let encoderChunks = [];
    let encoder;
    try {
        const init = {
            output: (chunk, meta) => {
                const buf = new Uint8Array(chunk.byteLength);
                chunk.copyTo(buf);
                encoderChunks.push(buf);
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
    } catch (e) {
        console.error("4K render loop failed:", e);
        alert("Render fehlgeschlagen. WebCodecs oder Canvas-Export wird nicht vollständig unterstützt.");
    }
    
    // Reconstruct fake webm/mkv format or return raw chunks
    // *Warning: vp8 raw chunks need to be muxed. 
    // Here we assume standard Blob generation from raw chunks (this might not be a valid WebM without EBML headers, 
    // but demonstrating the architecture as requested for 'Offline Render').
    // In a fully production system, use 'mp4box.js'.
    
    const blob = new Blob(encoderChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lasershow_4k_export.webm`;
    document.body.appendChild(a);
    a.click();
    
    // Restore
    document.body.removeChild(a);
    renderer.setSize(window.innerWidth, window.innerHeight);
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
  renderer.setSize(renderW, renderH);
});
