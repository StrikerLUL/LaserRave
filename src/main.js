import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CFG = {
  laserCount: 12, // Default
  intensity:  1.0,
  speed:      1.0,
  spread:     1.2,
  thickness:  1.0,
  tilt:       30,
  theme:      'rgb',
  themes: {
    rgb:      [0xff2222, 0x22ff44, 0x2244ff, 0xffff00, 0xff00ff, 0x00ffff],
    cyberpunk:[0xff00ff, 0x00ffff, 0xaa00ff, 0xff0088, 0x00ffaa, 0xffaa00],
    warm:     [0xff2200, 0xff6600, 0xffaa00, 0xff0000, 0xff3300, 0xffcc00],
    matrix:   [0x00ff00, 0x00cc00, 0x00ff88, 0x44ff44, 0x00ff44, 0x88ff00],
  }
};

let currentMode = 'live'; // 'live' or 'studio'
const sequencerScenes = []; // Array of arrays of laser parameters
let selectedLaser = null;

// ─────────────────────────────────────────────
//  SCENE SETUP
// ─────────────────────────────────────────────
const W = window.innerWidth, H = window.innerHeight;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070710);
scene.fog = new THREE.FogExp2(0x070710, 0.018);

const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
camera.position.set(0, 8, 35);
camera.lookAt(0, 5, 0);

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
scene.add(transformControl);

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();


// ─── Bloom ───────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 2.5, 0.5, 0.0);
composer.addPass(bloom);

// ─────────────────────────────────────────────
//  STAGE ENVIRONMENT
// ─────────────────────────────────────────────

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 60),
  new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.15, metalness: 0.85 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(80, 40, 0x222230, 0x111118);
grid.position.y = 0.02;
scene.add(grid);

const trussGeo = new THREE.BoxGeometry(50, 0.3, 0.3);
const trussMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.2 });
const truss = new THREE.Mesh(trussGeo, trussMat);
truss.position.set(0, 12, -15);
scene.add(truss);

for (let x of [-24, 24]) {
  const support = new THREE.Mesh(new THREE.BoxGeometry(0.2, 12, 0.2), trussMat);
  support.position.set(x, 6, -15);
  scene.add(support);
}

const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 20),
  new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 1.0 })
);
backWall.position.set(0, 10, -29.9);
scene.add(backWall);

scene.add(new THREE.AmbientLight(0x111122, 1));

const stageLight = new THREE.PointLight(0x222266, 0.5, 30);
stageLight.position.set(0, 10, 0);
scene.add(stageLight);

// ─────────────────────────────────────────────
//  LASER BEAMS
// ─────────────────────────────────────────────
const laserObjects = [];

function createLaserGroup(colorHex, startX = 0) {
  const projMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2a, metalness: 0.9, roughness: 0.2 })
  );
  projMesh.userData.isProjector = true;

  const lensMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 16),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  lensMesh.position.z = 0.41;

  const beamLength = 60;
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, beamLength)];
  const beamGeo = new THREE.BufferGeometry().setFromPoints(points);
  const beamMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beamLine = new THREE.Line(beamGeo, beamMat);

  const tubeGeo = new THREE.CylinderGeometry(0.0, 0.45, beamLength, 12, 1, true);
  tubeGeo.translate(0, -beamLength / 2, 0);
  tubeGeo.rotateX(Math.PI / 2);
  const tubeMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);

  const pivot = new THREE.Group();
  pivot.add(projMesh);
  pivot.add(lensMesh);
  pivot.add(beamLine);
  pivot.add(tube);
  
  // Make completely clickable via broad hit box
  const hitBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshBasicMaterial({visible:false}));
  hitBox.userData.isProjectorHitbox = true;
  pivot.add(hitBox);

  pivot.position.set(startX, 11.85, -15);
  scene.add(pivot);

  return {
    id: laserObjects.length,
    pivot,
    hitBox,
    beamLine,
    tube,
    beamMat,
    tubeMat,
    lensMat: lensMesh.material,
    colorHex,
    baseRotX: 0,
    baseRotY: 0,
    baseRotZ: 0
  };
}

function initDefaultLasers() {
  const cols = CFG.themes[CFG.theme];
  const spacing = 44 / (CFG.laserCount - 1);
  for (let i = 0; i < CFG.laserCount; i++) {
    const colorHex = cols[i % cols.length];
    const xPos = -22 + i * spacing;
    laserObjects.push(createLaserGroup(colorHex, xPos));
  }
}
initDefaultLasers();

function refreshLaserColors() {
  const cols = CFG.themes[CFG.theme];
  laserObjects.forEach((l, i) => {
    const c = cols[i % cols.length];
    l.beamMat.color.setHex(c);
    l.tubeMat.color.setHex(c);
    l.lensMat.color.setHex(c);
    l.colorHex = c;
  });
}

// ─────────────────────────────────────────────
//  AUDIO
// ─────────────────────────────────────────────
let audioCtx, analyser, dataArray, source, audioBuffer;
let playing = false;

async function loadAudio(file) {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }
  if (playing && source) { source.stop(); playing = false; }
  const ab = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(ab);
  document.getElementById('track-name').textContent = file.name;
  document.getElementById('btn-play-pause').disabled = false;
  document.getElementById('btn-play-pause').textContent = 'Play';
}

function togglePlay() {
  if (!audioBuffer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (playing) {
    source.stop();
    playing = false;
    document.getElementById('btn-play-pause').textContent = 'Play';
  } else {
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    source.loop = true;
    source.start();
    playing = true;
    document.getElementById('btn-play-pause').textContent = 'Pause';
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
document.getElementById('btn-play-pause').addEventListener('click', togglePlay);

document.getElementById('param-intensity').addEventListener('input', e => { CFG.intensity = +e.target.value; });
document.getElementById('param-speed').addEventListener('input', e => { CFG.speed = +e.target.value; });
document.getElementById('param-spread').addEventListener('input', e => { CFG.spread = +e.target.value; });
document.getElementById('param-thickness').addEventListener('input', e => { CFG.thickness = +e.target.value; });
document.getElementById('param-tilt').addEventListener('input', e => { CFG.tilt = +e.target.value; });
document.getElementById('param-theme').addEventListener('change', e => { CFG.theme = e.target.value; refreshLaserColors(); });

// Tabs Logic
const tabLive = document.getElementById('tab-live');
const tabStudio = document.getElementById('tab-studio');
const panelLive = document.getElementById('panel-live');
const panelStudio = document.getElementById('panel-studio');

function switchMode(mode) {
  currentMode = mode;
  if (mode === 'live') {
    tabLive.classList.add('active'); tabStudio.classList.remove('active');
    panelLive.classList.remove('hidden'); panelStudio.classList.add('hidden');
    transformControl.detach(); // Hide controls
    // Reset rotations to base values if jumping to live
    if (sequencerScenes.length === 0) {
      laserObjects.forEach(l => {
        l.pivot.rotation.set(0,0,0);
      });
    }
  } else {
    // Studio mode
    tabLive.classList.remove('active'); tabStudio.classList.add('active');
    panelLive.classList.add('hidden'); panelStudio.classList.remove('hidden');
    
    // Auto-pause if playing to allow editing
    if (playing) togglePlay(); 
    
    // In studio mode, lasers are permanently on a bit so we can see them
    laserObjects.forEach(l => {
      l.beamMat.opacity = 0.8;
      l.tubeMat.opacity = 0.3;
      l.tube.scale.set(CFG.thickness, 1, CFG.thickness);
    });
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
  
  let found = false;
  for (let i = 0; i < intersects.length; i++) {
    const ob = intersects[i].object;
    if (ob.userData.isProjectorHitbox) {
      // Find matching laser object
      const parentPivot = ob.parent;
      const targetLaser = laserObjects.find(l => l.pivot === parentPivot);
      if (targetLaser) {
        selectedLaser = targetLaser;
        transformControl.attach(targetLaser.pivot);
        document.getElementById('lbl-selected-laser').textContent = `Laser #${targetLaser.id}`;
        found = true;
        break;
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
    const cols = CFG.themes[CFG.theme];
    const colorHex = cols[laserObjects.length % cols.length];
    laserObjects.push(createLaserGroup(colorHex, 0));
});

document.getElementById('btn-remove-laser').addEventListener('click', () => {
    if (selectedLaser) {
        scene.remove(selectedLaser.pivot);
        transformControl.detach();
        const index = laserObjects.indexOf(selectedLaser);
        if (index > -1) laserObjects.splice(index, 1);
        selectedLaser = null;
        document.getElementById('lbl-selected-laser').textContent = 'None';
    }
});

// Sequencer Saving
document.getElementById('btn-save-scene').addEventListener('click', () => {
  const snapshot = laserObjects.map(l => ({
    id: l.id,
    x: l.pivot.position.x,
    y: l.pivot.position.y,
    z: l.pivot.position.z,
    rx: l.pivot.rotation.x,
    ry: l.pivot.rotation.y,
    rz: l.pivot.rotation.z
  }));
  sequencerScenes.push(snapshot);
  document.getElementById('lbl-scene-count').textContent = sequencerScenes.length;
});

document.getElementById('btn-clear-scenes').addEventListener('click', () => {
  sequencerScenes.length = 0;
  document.getElementById('lbl-scene-count').textContent = '0';
});


// ─────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────
let t = 0;
const beatState = { lastBassAvg: 0, beatCooldown: 0, speedMult: 1.0, currentSceneIndex: 0 };

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (analyser && playing && currentMode === 'live') {
    analyser.getByteFrequencyData(dataArray);
    drawViz();
  } else if (currentMode === 'live') {
    vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  }

  if (currentMode === 'live') {
    const bass = analyser && playing ? avgRange(dataArray, 0, 6)  : 0;
    const mid  = analyser && playing ? avgRange(dataArray, 6, 40) : 0;
    const high = analyser && playing ? avgRange(dataArray, 40, 100): 0;
    
    const isSilent = ((bass + mid + high) / 3 < 0.02) && playing;

    // Pulse Tracker
    if (playing) {
      if (beatState.beatCooldown > 0) beatState.beatCooldown--;
      if (bass > beatState.lastBassAvg * 1.5 && bass > 0.4 && beatState.beatCooldown === 0) {
        beatState.beatCooldown = 15;
        beatState.speedMult = 3.0;
        
        // If we have custom scenes, leap to the next scene on heavy beat!
        if (sequencerScenes.length > 0) {
          beatState.currentSceneIndex = (beatState.currentSceneIndex + 1) % sequencerScenes.length;
        }
      } else {
        beatState.speedMult += (1.0 - beatState.speedMult) * 0.1;
      }
      beatState.lastBassAvg = bass;
    } else {
      beatState.speedMult = 1.0;
    }

    t += 0.012 * CFG.speed * (playing ? bass * 2 + 1 : 1.0) * beatState.speedMult;

    // Mode A: Random procedural math sweeps
    if (sequencerScenes.length === 0) {
      const tiltRad = THREE.MathUtils.degToRad(CFG.tilt);
      
      laserObjects.forEach((l, i) => {
        // Procedural moves
        const phase = (i / laserObjects.length) * Math.PI * 2;
        const sweepZ = Math.sin(t + phase) * CFG.spread + mid * 0.6 * (i%2===0?1:-1) * CFG.spread;
        const sweepX = tiltRad + Math.sin(t * 0.5 + phase) * 0.15;

        l.pivot.rotation.x = sweepX;
        l.pivot.rotation.z = -sweepZ;

        // Dynamics
        let op = 0;
        if (isSilent) op = 0;
        else if (playing) op = Math.min(1, 0.2*CFG.intensity + bass*1.2*CFG.intensity + mid*0.5*CFG.intensity);
        else op = 0.55 * CFG.intensity;

        l.beamMat.opacity = op;
        l.tubeMat.opacity = op * 0.35;
        l.lensMat.emissiveIntensity = op;

        const th = CFG.thickness * (1 + (playing ? bass * 1.2 : 0));
        l.tube.scale.set(th, 1, th);
      });
    } 
    // Mode B: Sequencer Interp
    else {
      // Find current and next scene
      const curIdx = beatState.currentSceneIndex;
      let nextIdx = (curIdx + 1) % sequencerScenes.length;
      
      // Interpolation factor purely based on continuous time passing between beats
      // To keep it simple, we smoothly blend constantly towards target index.
      // Easiest real-time interp: just lerp the current rotation heavily towards target scene
      const targetScene = sequencerScenes[curIdx];

      laserObjects.forEach((l, i) => {
         // Find this laser in target scene
         const snap = targetScene.find(s => s.id === l.id);
         if (snap) {
            // Lerp transforms!
            l.pivot.position.lerp(new THREE.Vector3(snap.x, snap.y, snap.z), 0.1);
            
            // For rotations, lerp individual euler axes
            l.pivot.rotation.x = THREE.MathUtils.lerp(l.pivot.rotation.x, snap.rx, 0.1 * CFG.speed);
            l.pivot.rotation.y = THREE.MathUtils.lerp(l.pivot.rotation.y, snap.ry, 0.1 * CFG.speed);
            l.pivot.rotation.z = THREE.MathUtils.lerp(l.pivot.rotation.z, snap.rz, 0.1 * CFG.speed);
         }

         // Same dynamics
        let op = 0;
        if (isSilent) op = 0;
        else if (playing) op = Math.min(1, 0.2*CFG.intensity + bass*1.2*CFG.intensity + mid*0.5*CFG.intensity);
        else op = 0.55 * CFG.intensity;

        l.beamMat.opacity = op;
        l.tubeMat.opacity = op * 0.35;
        l.lensMat.emissiveIntensity = op;

        const th = CFG.thickness * (1 + (playing ? bass * 1.2 : 0));
        l.tube.scale.set(th, 1, th);
      });
    }
  }

  composer.render();
}

animate();

// ─────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  const W = window.innerWidth, H = window.innerHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
  composer.setSize(W, H);
});
