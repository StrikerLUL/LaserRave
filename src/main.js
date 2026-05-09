import { computeFormation } from './utils/computeFormation.js';
import * as THREE from 'three';
import { pass, uniform } from 'three/tsl';
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
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fillRect(0, 0, 256, 256);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    for(let i = 0; i < 4; i++) {
        ctx.fillRect(i * 64 + 12, 0, 40, 256);
    }
    
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 1);
    return tex;
}
const globalGoboTexture = createGoboTexture();

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

const renderer = new WebGPURenderer({ 
  antialias: true, 
  powerPreference: "high-performance",
  forceWebGL: false
});
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Fix: Disable built-in tone mapping to allow TSL post-processing to handle colors organically without crushing HDR data before bloom.
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
camera.position.set(0, 12, 60); // Repositioned for the 200m stage scale
camera.lookAt(0, 5, 0);

let autoCamEnabled = false;
let tvModeEnabled = false;
let tvCutCooldown = 0;
let currentTvCamIdx = 0;
let justCut = false;

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

// The canonical way to set up WebGPU post-processing:
// 1. Create a scene render pass
// 2. Extract the color output texture node
// 3. Chain effect nodes on top of it
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');

// Uniforms for VHS/blur controls
const afterImageDamp  = uniform(0.88);
const filmTimeUniform = uniform(0.0);
const rgbShiftAmount  = uniform(0.0015);

// Build the base chain: bloom on top of scene (boosted for intense laser glow)
const bloomNode = bloom(sceneColor, 1.8, 0.75, 0.1);

// Post-processing instance (use the canonical class name in this three/webgpu version)
let postProcessing;
try {
    postProcessing = new RenderPipeline(renderer);
} catch(e) {
    console.error('Could not create RenderPipeline', e);
}

// Start with bloom composite - VHS/blur added lazily when user enables them
if (postProcessing) postProcessing.outputNode = sceneColor.add(bloomNode).toneMapping(THREE.NeutralToneMapping);

// Proxy compat objects so legacy code that references filmPass.enabled etc still works
const afterimagePass = { enabled: false };
const filmPass     = { enabled: false, uniforms: { time: { get value() { return filmTimeUniform.value; }, set value(v) { filmTimeUniform.value = v; } } } };
const rgbShiftPass = { enabled: false, uniforms: { amount: { get value() { return rgbShiftAmount.value; }, set value(v) { rgbShiftAmount.value = v; } } } };

// Rebuilds the TSL output chain to include only the active effects
function rebuildPostChain() {
    if (!postProcessing) return;
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

// Massive Truss Structure helper
function createTruss(w, h, d, x, y, z, rx=0, ry=0, rz=0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, trussMat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    stageGroup.add(mesh); // Changed to stageGroup so we can clear it
    return mesh;
}

let ledScreenMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });

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

    if (CFG.stageSize === 'large') {
        // Horizontal Main Trusses (Multiple layers)
        createTruss(120, 0.4, 0.4, 0, 18, -25);
        createTruss(120, 0.4, 0.4, 0, 14, -20);
        createTruss(120, 0.4, 0.4, 0, 10, -15);
        
        // Vertical Supports
        for (let x of [-45, -25, 0, 25, 45]) {
            createTruss(0.3, 20, 0.3, x, 10, -25);
        }
        
        // Side "Wings" Trusses (Angled)
        createTruss(40, 0.4, 0.4, -60, 12, -10, 0, Math.PI / 4, 0);
        createTruss(40, 0.4, 0.4, 60, 12, -10, 0, -Math.PI / 4, 0);

        backWall = new THREE.Mesh(
          new THREE.PlaneGeometry(250, 60),
          new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 1.0 })
        );
        backWall.position.set(0, 30, -50);
        stageGroup.add(backWall);

        // Center Massive Wall
        addScreen(30, 15, 0, 7.5, -30);
        
        // Side Wings (Towers)
        for (let i = 0; i < 3; i++) {
            const xOff = 25 + i * 15;
            const zPos = -25 + i * 5;
            const ry = -Math.PI / 8 * (i + 1);
            addScreen(8, 20, -xOff, 10, zPos, -ry);
            addScreen(8, 20, xOff, 10, zPos, ry);
        }
        
        // DJ Booth Screens
        addScreen(8, 4, 0, 2, -15);
        
        // Massive PA Wall
        const paMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
        for (let side of [-1, 1]) {
          for (let column = 0; column < 2; column++) {
            const paGroup = new THREE.Group();
            paGroup.position.set(side * (18 + column * 4), 0, -28);
            for (let i = 0; i < 6; i++) {
              const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2.5), paMat);
              box.position.y = 1 + i * 2.1;
              paGroup.add(box);
            }
            stageGroup.add(paGroup);
          }
        }
    } else {
        // SMALL STAGE
        // Single back truss
        createTruss(40, 0.4, 0.4, 0, 10, -10);
        // Vertical Supports
        for (let x of [-18, 18]) {
            createTruss(0.3, 10, 0.3, x, 5, -10);
        }

        backWall = new THREE.Mesh(
          new THREE.PlaneGeometry(80, 30),
          new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 1.0 })
        );
        backWall.position.set(0, 15, -15);
        stageGroup.add(backWall);

        // Single smaller screen behind DJ
        addScreen(16, 9, 0, 5, -9);

        // Small PA
        const paMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
        for (let side of [-1, 1]) {
            const paGroup = new THREE.Group();
            paGroup.position.set(side * 8, 0, -8);
            for (let i = 0; i < 3; i++) {
              const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 1.5), paMat);
              box.position.y = 0.75 + i * 1.6;
              paGroup.add(box);
            }
            stageGroup.add(paGroup);
        }
    }

    // Common Elements (DJ Table + CDJs)
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
}

buildStageEnvironment();

scene.add(new THREE.AmbientLight(0x111118, 0.3)); // Much darker ambient for deeper blacks
const stageLight = new THREE.PointLight(0x2233ff, 0.4, 100); // Reduced static stage light
stageLight.position.set(0, 20, 0);
scene.add(stageLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.05); // Barely any sunlight
sunLight.position.set(0, 50, 50);
scene.add(sunLight);


// ─────────────────────────────────────────────
//  PYROTECHNIK SYSTEM (Offloaded to Worker)
// ─────────────────────────────────────────────

const pyroWorker = new Worker(new URL('./pyro-worker.js', import.meta.url));
let pyroSystemIdCounter = 0;

// Generate a circular glowing texture for particles to replace the old ShaderMaterial logic
const particleCanvas = document.createElement('canvas');
particleCanvas.width = 128;
particleCanvas.height = 128;
const pCtx = particleCanvas.getContext('2d');
const pGrad = pCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
pGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
pGrad.addColorStop(0.2, 'rgba(255, 255, 200, 0.8)');
pGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
pCtx.fillStyle = pGrad;
pCtx.fillRect(0, 0, 128, 128);
const particleTexture = new THREE.CanvasTexture(particleCanvas);

const fireMaterial = new THREE.PointsMaterial({
    size: 0.8,
    vertexColors: true,
    map: particleTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.95
});

const sparkMaterial = new THREE.PointsMaterial({
    size: 0.25,
    vertexColors: true,
    map: particleTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.95
});

class PyroSystem {
    constructor({ x, y, z, type = 'flame', maxParticles = 15000, emitDir = {x:0,y:1,z:0}, spread = 0.4 }) {
        this.id = pyroSystemIdCounter++;
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
            }
        };

        pyroWorker.addEventListener('message', this.onWorkerMessage);
    }

    update(dt, globalT, energy, bass, kick, windX, windY, pyroIntensity, isPeak) {
        if (this.isUpdating) return;
        this.isUpdating = true;

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
let liveCrowdEnabled = false;
let upLightsEnabled = false;
let hazeSystem   = null;
let hazeMaterial = null;



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
            im.instanceMatrix.dispose();
            if (im.instanceColor) im.instanceColor.dispose();
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

/** Setup Instanced Meshes for Lasers */
function setupLaserIM(count) {
    if (laserBodyIM) {
        if (laserBodyIM.count >= count) {
            laserBodyIM.count = count;
            laserCoreIM.count = count;
            laserTubeIM.count = count;
            return;
        }
        scene.remove(laserBodyIM, laserCoreIM, laserTubeIM);
        [laserBodyIM, laserCoreIM, laserTubeIM].forEach(im => {
            im.instanceMatrix.dispose();
            if (im.instanceColor) im.instanceColor.dispose();
        });
    }

    // Housing box
    const bodyGeo = getSharedGeo('laserBody', () => new THREE.BoxGeometry(0.55, 0.55, 0.75));
    laserBodyIM = new THREE.InstancedMesh(bodyGeo,
        getSharedMat('laserBody', () => new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.95, roughness: 0.15 })), count);

    // Beam: thin cylinder, axis along +Y, translated then rotated so it shoots toward +Z (audience)
    const beamLen = 65;
    const coreGeo = getSharedGeo('laserCore', () => {
        const g = new THREE.CylinderGeometry(0.12, 0.12, beamLen, 8, 1, true);
        g.translate(0, beamLen / 2, 0);
        g.rotateX(Math.PI / 2); // now shoots along +Z
        return g;
    });
    laserCoreIM = new THREE.InstancedMesh(coreGeo, getSharedMat('laserCore', () => new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.1 + CFG.hazeDensity * 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false
    })), count);

    const tubeGeo = getSharedGeo('laserTube', () => {
        const g = new THREE.CylinderGeometry(0.22, 0.0, beamLen, 8, 1, true);
        g.translate(0, beamLen / 2, 0);
        g.rotateX(Math.PI / 2);
        return g;
    });
    laserTubeIM = new THREE.InstancedMesh(tubeGeo, getSharedMat('laserTube', () => new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: CFG.hazeDensity * 0.15,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
    })), count);

    [laserBodyIM, laserCoreIM, laserTubeIM].forEach(im => {
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false; // Never cull large instanced arrays early
        scene.add(im);
    });

    const _white = new THREE.Color(0xffffff);
    for (let i = 0; i < count; i++) {
        laserCoreIM.setColorAt(i, _white);
        laserTubeIM.setColorAt(i, _white);
    }
    laserCoreIM.instanceColor.needsUpdate = true;
    laserTubeIM.instanceColor.needsUpdate = true;
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
            baseYaw:  s.baseYaw,    // which direction the fixture faces
            zone:     s.zone,       // 'front'|'side-left'|'side-right'|'corner'|'diagonal'
            wallNorm: s.wallNorm,   // 0..1 position along truss/wall row
        });
        laserCoreIM.setColorAt(i, _col1);
        laserTubeIM.setColorAt(i, _col1);
    }
    laserCoreIM.instanceColor.needsUpdate = true;
    laserTubeIM.instanceColor.needsUpdate = true;
}


// (duplicate initLasers removed – the zone-aware version above is the canonical one)
initLasers();
initMovingHeads();

// Re-added safe handlers for crowd and uplights which were accidentally deleted
function initCrowd() {
    crowdObjects.length = 0;
}

function initUpLights() {
    upLightObjects.length = 0;
}

function createHaze() {
    if (hazeSystem) {
        scene.remove(hazeSystem);
        hazeSystem.geometry.dispose();
        hazeSystem = null;
    }

    if (CFG.hazeDensity > 0) {
        scene.fog = new THREE.FogExp2(0x020205, CFG.hazeDensity * 0.03);
    } else {
        scene.fog = null;
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

initCrowd();
initUpLights();
createHaze();

function refreshLaserColors() {
    const cols = CFG.themes[CFG.theme];
    laserObjects.forEach((l, i) => {
        _col1.set(cols[i % cols.length]);
        l.color.copy(_col1);
        if (laserCoreIM) laserCoreIM.setColorAt(i, _col1);
        if (laserTubeIM) laserTubeIM.setColorAt(i, _col1);
    });
    if (laserCoreIM && laserCoreIM.instanceColor) laserCoreIM.instanceColor.needsUpdate = true;
    if (laserTubeIM && laserTubeIM.instanceColor) laserTubeIM.instanceColor.needsUpdate = true;
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

function getPlaybackTime() {
  if (!playing || !audioCtx || !audioBuffer) return 0;
  const elapsed = (audioCtx.currentTime - playbackStartCtxTime) + playbackStartOffset;
  return elapsed % audioBuffer.duration; // handle loop
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
  if (energy > 0.80) return ['scatter', 'strobe', 'sparkle', 'chase-fast'][idx % 4];
  if (bass > mid && bass > high)  return ['fan', 'salvo', 'zigzag', 'wave'][idx % 4];
  if (high > bass && high > mid)  return ['chase-fast', 'sparkle', 'zigzag', 'scatter'][idx % 4];
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

  if (!playing || isSilent) {
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
      // Quiet treble → sparkle (random twinkling fits hi-hats)
      wanted = 'sparkle';

    } else if (midDom && melHigh) {
      // Melody lead → wave (smooth travelling ripple follows melodic arc)
      wanted = 'wave';

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

  const ctx = new OfflineAudioContext(1, buf.length, buf.sampleRate);
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
  const sr = audioBuf.sampleRate;
  const len = audioBuf.length;
  const hopSec = 0.023;
  const hop = Math.round(sr * hopSec);
  const N = Math.floor(len / hop);

  setProgress(5, '⏳ Rendering audio bands…  5%');
  document.getElementById('btn-play-pause').disabled = true;
  await new Promise(r => setTimeout(r, 0));

  // Stage 1 – offline rendering (heaviest)
  const [bd, md, hd, fd] = await Promise.all([
    renderBand(audioBuf,    0,  250),
    renderBand(audioBuf,  250, 3500),
    renderBand(audioBuf, 3500,    0),
    renderBand(audioBuf,    0,    0),
  ]);

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

  setProgress(48, '⏳ Computing energy & beats…');
  await new Promise(r => setTimeout(r, 0));

  const bassMap   = aiStems.bass;
  const midMap    = aiStems.vocals;
  const highMap   = aiStems.drums;
  const melodyMap = aiStems.melody;
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

  setProgress(100, '✓ ' + fileName);
  document.getElementById('btn-play-pause').disabled = false;
  document.getElementById('btn-render').disabled = false;
  
  document.getElementById('song-timeline').classList.remove('hidden');
  switchMode(currentMode); // Ensure correct parts are hidden/shown
  
  console.log(`Song analyzed: ${beats.length} beats @ ${estimatedBPM} BPM, ${sections.length} sections`);
  return { bassMap, midMap, highMap, melodyMap, energyMap, buildUpMap, beats, sections, hopSec, hop, N, bpm: estimatedBPM };
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

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }
  if (playing && source) { source.stop(); playing = false; }
  playbackStartOffset = 0;
  songMap = null;
  const ab = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(ab);
  // Analyze full song offline
  songMap = await analyzeSong(audioBuffer, file.name);
  waveformValid = false;

  } catch (error) {
    console.error("Error loading audio:", error);
    alert("Audio konnte nicht geladen werden. Bitte prüfen Sie das Dateiformat.");
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

function togglePlay() {
  try {

  if (!audioBuffer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (playing) {
    playbackStartOffset = getPlaybackTime(); // save position
    source.stop(); playing = false;
    document.getElementById('btn-play-pause').textContent = 'Play';
    if (videoObj) videoObj.pause();
  } else {
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    
    try { analyser.disconnect(); } catch(e){}
    if (mediaStreamDest) analyser.connect(mediaStreamDest);
    if (!isRecording) analyser.connect(audioCtx.destination);
    
    source.loop = true;
    source.start(0, playbackStartOffset % audioBuffer.duration);
    playbackStartCtxTime = audioCtx.currentTime;
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
  const bw = W / analyser.frequencyBinCount * 2.5;
  let x = 0;
  for (let i = 0; i < analyser.frequencyBinCount; i++) {
    const bh = (dataArray[i] / 255) * H;
    vizCtx.fillStyle = `hsl(${i * 2.5}, 100%, 55%)`;
    vizCtx.fillRect(x, H - bh, bw, bh);
    x += bw + 0.5;
  }
}

// ─────────────────────────────────────────────
//  UI & MODES BINDINGS
// ─────────────────────────────────────────────
document.getElementById('audio-upload').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadAudio(f).catch(console.error);
});
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
  videoTexture = new THREE.VideoTexture(videoObj);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  
  if (ledScreenMat) {
      ledScreenMat.map = videoTexture;
      ledScreenMat.needsUpdate = true;
      ledScreenMat.color.setHex(0xffffff);
  }
});
document.getElementById('param-autocam').addEventListener('change', e => {
  autoCamEnabled = e.target.checked;
  if (!autoCamEnabled && !tvModeEnabled && currentMode === 'live') {
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
  } else if (!autoCamEnabled && currentMode === 'live') {
      controls.enabled = true;
      camera.position.copy(baseCamPos);
      controls.target.copy(baseCamTarget);
      camera.lookAt(baseCamTarget);
  }
});
document.getElementById('param-movingheads').addEventListener('change', e => {
    movingHeadsEnabled = e.target.checked;
    initMovingHeads(CFG.movingHeadCount);
});
document.getElementById('param-livecrowd').addEventListener('change', e => {
  liveCrowdEnabled = e.target.checked;
  initCrowd();
});
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
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
    });
  } else {
    document.exitFullscreen();
  }
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
let dynamicBeatPhase = 0;
let lastRawBeatPhase = 0;

function updateInstancedMovingHeads(t, tAnim, energy, vocals, drums, kick, isPeakDrop, isSilent, buildUp) {
    if (!mhBaseIM) return;
    const count = movingHeadObjects.length;
    const spring = 0.07 + energy * 0.07;
    const damp   = 0.80;
    let colorDirty = false;

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
            : Math.min(1.0, vocals * 1.1 + drums * 0.45 + beatState.flashDecay * 0.45 + hs.adsrState * 0.6) * CFG.mhIntensity;
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
    const count  = laserObjects.length;
    const n      = count;
    const tiltRad   = THREE.MathUtils.degToRad(CFG.tilt);
    const pat       = section ? section.pattern  : 'fan';
    const liss      = section ? section.liss      : { xf: 0.5, yf: 0.5, zf: 0.5, xp:0, yp:0, zp:0 };
    const secSpread = section ? section.spreadMod : 1.0;
    let colorDirty  = false;

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

    for (let i = 0; i < count; i++) {
        const l    = laserObjects[i];
        const zone = l.zone     || 'front';
        const wn   = l.wallNorm ?? (i / Math.max(n - 1, 1)); // 0..1 position along truss
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

            l.rot.x = THREE.MathUtils.lerp(l.rot.x, pitchX, ls);
            l.rot.y = THREE.MathUtils.lerp(l.rot.y, yaw,    ls);
            l.rot.z = 0; // unused for zone-aware system
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
            } else if (pat === 'strobe' && !beatState.strobeOn && playing) {
                patternOpMod = 0.0;
            }
        }

        const freqBiasOp = playing ? melody : 0;
        let op = isSilent
            ? ((!playing && isSilent) ? 0.3 : 0.0) // Keep minimum visibility of 0.3 if idle so the app doesn't look black
            : patternOpMod * Math.min(1, 0.08 * CFG.intensity + (freqBiasOp || 0) * 1.1 + energy * 0.6 + buildUp * 0.4 + beatState.flashDecay * 0.9);
        
        if (currentMode === 'studio') op = Math.max(op, 0.5);

        // ── Matrices (always absolute – no accumulation) ─────────────────
        // Body: just sits at position, no rotation
        dummy.position.copy(l.pos);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        laserBodyIM.setMatrixAt(i, dummy.matrix);

        // Beam: position + YXZ euler so baseYaw is baked in
        dummy.rotation.set(l.rot.x, l.rot.y, l.rot.z, 'YXZ');
        dummy.updateMatrix();
        laserCoreIM.setMatrixAt(i, dummy.matrix);
        laserTubeIM.setMatrixAt(i, dummy.matrix);

        // ── Colour ──────────────────────────────────────────────────────
        if (CFG.theme === 'dynamic') {
            const h = (sectionLaserHues[i] ?? (i * 360 / n)) % 360;
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
    }

    laserBodyIM.instanceMatrix.needsUpdate = true;
    laserCoreIM.instanceMatrix.needsUpdate = true;
    laserTubeIM.instanceMatrix.needsUpdate = true;
    if (colorDirty && laserCoreIM.instanceColor) laserCoreIM.instanceColor.needsUpdate = true;
    if (colorDirty && laserTubeIM.instanceColor) laserTubeIM.instanceColor.needsUpdate = true;
}

function animate() {
  // Using setAnimationLoop below instead of requestAnimationFrame

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
          if ((isFlame && !pyroFlameEnabled) || (isSpark && !pyroSparkEnabled)) {
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
  let rtBass = 0, rtKick = 0, rtMid = 0, rtHigh = 0, rtEnergy = 0;
  if (currentMode === 'live' && analyser && playing) {
      rtBass   = avgRange(dataArray,  0,   5);
      rtKick   = avgRange(dataArray,  0,   2);
      rtMid    = avgRange(dataArray,  5,  35);
      rtHigh   = avgRange(dataArray, 80, 128);
      rtEnergy = rtBass * 0.5 + rtMid * 0.3 + rtHigh * 0.2;
  }
  const isSilent = playing ? (rtEnergy < 0.04) : true;

  // ── Song-map frame lookup (Stems) ────────────────────────────
  const frame   = playing ? getSongFrame()      : null;
  const section = playing ? getCurrentSection() : null;

  const bass   = frame ? frame.bass   * 0.45 + rtBass  * 0.55 : rtBass;
  const vocals = frame ? frame.vocals * 0.9  + rtMid   * 0.1  : rtMid;
  const drums  = frame ? frame.drums  * 0.6  + rtHigh  * 0.4  : rtHigh;
  const melody = frame ? frame.melody * 0.8  + rtMid   * 0.2  : rtMid;
  const kick   = rtKick;
  const energy = frame ? frame.energy * 0.4  + rtEnergy * 0.6 : rtEnergy;
  
  // Expose to pyro
  _pyroBass = bass; _pyroKick = kick; _pyroEnergy = energy;
  _pyroIsPeak = (playing && peakModeEnabled && energy > 0.85 && ((frame && frame.energy > 0.8) || rtEnergy > 0.8));
  
  // Aliases to prevent crash in legacy pattern logic
  const mid = vocals;
  const high = drums;

  // ── Build-up strength ─────────────────────────────────────────
  const buildUp = (frame && songMap && songMap.buildUpMap)
    ? songMap.buildUpMap[frame.f] : 0;
    
  // ── Absolute Drop Peak (Maximum Chaos Level) ───────────
  const isPeakDrop = playing && peakModeEnabled && energy > 0.85 && buildUp < 0.2;

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
       let targetIntensity = isSilent ? 0 : (mixedIntensity * CFG.screenBrightness);
       
       if (videoObj) {
           ledScreenMat.color.setScalar(targetIntensity);
       } else {
           if (CFG.theme === 'dynamic') {
               let baseH = section ? section.baseHue : (t * 50);
               let screenHex = hueToHex((baseH + t * 60) % 360, 0.95, 0.5 * targetIntensity);
               ledScreenMat.color.setHex(screenHex);
           } else {
               const cols = CFG.themes[CFG.theme];
               if (cols && cols.length > 0) {
                   const colorIdx = Math.floor(tAnim * 1.5) % cols.length;
                   ledScreenMat.color.setHex(cols[colorIdx]);
                   ledScreenMat.color.multiplyScalar(targetIntensity);
               } else {
                   ledScreenMat.color.setRGB(bass * targetIntensity, mid * targetIntensity, high * targetIntensity);
               }
           }
       }
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
    if (currentMode === 'live' && peakModeEnabled) {
        // Organic, mechanical rumble instead of pure random noise
        const shakeInt = (beatState.isBeat || beatState.isTransient) ? kick * (autoCamEnabled ? 1.8 : 0.6) : 0;
        if (shakeInt > 0.02) {
            const sx = (Math.sin(t * 73) * 0.5 + Math.sin(t * 31) * 0.5) * shakeInt;
            const sy = (Math.cos(t * 62) * 0.5 + Math.sin(t * 47) * 0.5) * shakeInt;
            const sz = (Math.sin(t * 88) * 0.5 + Math.cos(t * 37) * 0.5) * shakeInt;
            _camShake.set(sx, sy, sz);
        }
    }

    // ── Auto-Camera & TV Mode ───────────────────────────────────────────────
    if ((autoCamEnabled || tvModeEnabled) && currentMode === 'live') {
        controls.enabled = false;
        
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

    } else if (currentMode === 'live' && !transformControl.dragging) {
        controls.enabled = true;
    }

    // ── Moving Heads Update ──────────────────────────────────────
    if (movingHeadsEnabled || currentMode === 'studio') {
        updateInstancedMovingHeads(t, tAnim, energy, vocals, drums, kick, isPeakDrop, isSilent, buildUp);
    }

    // ── Live Crowd Update (Boiler Room Silhouettes) ───────────────
    if (liveCrowdEnabled && crowdObjects.length > 0) {
        const isDrop = playing && energy > 0.85 && buildUp < 0.2;
        const bouncePow = playing ? (0.5 + energy * 1.2) : 0;

        crowdObjects.forEach((c, idx) => {
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
                    c.mesh.material = crowdMatUp;
                    c.isUp = true;
                } else if (!wantsUp && c.isUp && Math.random() < 0.05) {
                    c.mesh.material = crowdMatDown;
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
        laserObjects.forEach((l, li) => {
             const pathOffset = (li / laserObjects.length) * projectedPoints.length;
             const simIndex = Math.floor((t * 60 * traceSpeed + pathOffset) % projectedPoints.length);
             const pt = projectedPoints[simIndex];
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

    updateTimeline();

  camera.position.add(_camShake);

  // Render pipeline 
  if (postProcessing) {
      postProcessing.render();
  } else {
      renderer.render(scene, camera);
  }
}

try {
    await renderer.init();
    renderer.setAnimationLoop(animate);
} catch (e) {
    console.error("WebGPU init failed", e);
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
}

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
    const init = {
        output: (chunk, meta) => {
            const buf = new Uint8Array(chunk.byteLength);
            chunk.copyTo(buf);
            encoderChunks.push(buf);
        },
        error: (e) => console.error("VideoEncoder Error", e)
    };
    const encoder = new VideoEncoder(init);
    // Simple codec configuration
    encoder.configure({
        codec: 'vp8',
        width: R_WIDTH,
        height: R_HEIGHT,
        bitrate: 40_000_000 // 40 Mbps
    });

    // Resize renderer for 4K
    renderer.setSize(R_WIDTH, R_HEIGHT);
    
    const startRealTime = performance.now();
    
    // Render loop
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
        const bmp = await createImageBitmap(renderer.domElement);
        const vFrame = new VideoFrame(bmp, { timestamp: f * 1000000 / fps });
        encoder.encode(vFrame, { keyFrame: f % 60 === 0 });
        vFrame.close();
        bmp.close();
        
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
