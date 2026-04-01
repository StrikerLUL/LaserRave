import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CFG = {
  laserCount: 12,
  intensity:  1.0,
  speed:      1.0,
  spread:     1.2,
  thickness:  1.0,
  tilt:       30,          // degrees from floor
  theme:      'rgb',
  themes: {
    rgb:      [0xff2222, 0x22ff44, 0x2244ff, 0xffff00, 0xff00ff, 0x00ffff],
    cyberpunk:[0xff00ff, 0x00ffff, 0xaa00ff, 0xff0088, 0x00ffaa, 0xffaa00],
    warm:     [0xff2200, 0xff6600, 0xffaa00, 0xff0000, 0xff3300, 0xffcc00],
    matrix:   [0x00ff00, 0x00cc00, 0x00ff88, 0x44ff44, 0x00ff44, 0x88ff00],
  }
};

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

// ─── Bloom ───────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 2.5, 0.5, 0.0);
composer.addPass(bloom);

// ─────────────────────────────────────────────
//  STAGE ENVIRONMENT
// ─────────────────────────────────────────────

// Floor (shiny)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 60),
  new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.15, metalness: 0.85 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Grid on floor
const grid = new THREE.GridHelper(80, 40, 0x222230, 0x111118);
grid.position.y = 0.02;
scene.add(grid);

// Ceiling / Truss bar (where projectors hang from)
const trussGeo = new THREE.BoxGeometry(50, 0.3, 0.3);
const trussMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.2 });
const truss = new THREE.Mesh(trussGeo, trussMat);
truss.position.set(0, 12, -15);
scene.add(truss);

// Vertical truss supports
for (let x of [-24, 24]) {
  const support = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 12, 0.2),
    trussMat
  );
  support.position.set(x, 6, -15);
  scene.add(support);
}

// Back wall (dark)
const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 20),
  new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 1.0 })
);
backWall.position.set(0, 10, -29.9);
scene.add(backWall);

// Ambient light (very dim – let lasers be the light)
scene.add(new THREE.AmbientLight(0x111122, 1));

// Small point light on stage
const stageLight = new THREE.PointLight(0x222266, 0.5, 30);
stageLight.position.set(0, 10, 0);
scene.add(stageLight);

// ─────────────────────────────────────────────
//  LASER BEAMS  (using Line geometry for real laser look)
// ─────────────────────────────────────────────
const laserObjects = [];
const themeColors = CFG.themes[CFG.theme];

function buildLasers() {
  // Remove old lasers
  laserObjects.forEach(l => {
    scene.remove(l.pivot);
    l.pivot.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  });
  laserObjects.length = 0;

  const cols = themeColors;
  const spacing = 44 / (CFG.laserCount - 1);

  for (let i = 0; i < CFG.laserCount; i++) {
    const colorHex = cols[i % cols.length];

    // Projector box
    const projMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a2a, metalness: 0.9, roughness: 0.2 })
    );

    // Projector front lens (glowing dot)
    const lensMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 16),
      new THREE.MeshBasicMaterial({ color: colorHex })
    );
    lensMesh.position.z = 0.41;

    // The beam: a line from origin downward / forward
    // We use a thick line via a thin tube for glow
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

    // Volumetric tube (cone shape for volume)
    const tubeGeo = new THREE.CylinderGeometry(0.0, 0.45, beamLength, 12, 1, true);
    tubeGeo.translate(0, -beamLength / 2, 0);
    tubeGeo.rotateX(Math.PI / 2); // point along +Z
    const tubeMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);

    // Pivot group (rotates the beam)
    const pivot = new THREE.Group();
    pivot.add(projMesh);
    pivot.add(lensMesh);
    pivot.add(beamLine);
    pivot.add(tube);

    // Position on truss
    const xPos = -22 + i * spacing;
    pivot.position.set(xPos, 11.85, -15);

    scene.add(pivot);

    laserObjects.push({
      pivot,
      beamLine,
      tube,
      beamMat,
      tubeMat,
      lensMat: lensMesh.material,
      colorHex,
      phaseOffset: (i / CFG.laserCount) * Math.PI * 2,
      side: i % 2 === 0 ? 1 : -1,
    });
  }
}

buildLasers();

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

// Freq helpers
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
//  UI BINDINGS
// ─────────────────────────────────────────────
document.getElementById('audio-upload').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadAudio(f).catch(console.error);
});
document.getElementById('btn-play-pause').addEventListener('click', togglePlay);

document.getElementById('param-intensity').addEventListener('input', e => { CFG.intensity  = +e.target.value; });
document.getElementById('param-speed')    .addEventListener('input', e => { CFG.speed      = +e.target.value; });
document.getElementById('param-spread')   .addEventListener('input', e => { CFG.spread     = +e.target.value; });
document.getElementById('param-thickness').addEventListener('input', e => {
  CFG.thickness = +e.target.value;
  laserObjects.forEach(l => {
    l.tube.scale.x = CFG.thickness;
    l.tube.scale.y = CFG.thickness;
  });
});
document.getElementById('param-tilt').addEventListener('input', e => { CFG.tilt = +e.target.value; });
document.getElementById('param-theme').addEventListener('change', e => {
  CFG.theme = e.target.value;
  const cols = CFG.themes[CFG.theme];
  laserObjects.forEach((l, i) => {
    const c = cols[i % cols.length];
    l.beamMat.color.setHex(c);
    l.tubeMat.color.setHex(c);
    l.lensMat.color.setHex(c);
    l.colorHex = c;
  });
});

// ─────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────
let t = 0;

// Beat Detection State
const beatState = {
  lastBassAvg: 0,
  beatCooldown: 0,
  speedMultiplier: 1.0,
  sweepDirection: 1,
  currentPattern: 0
};

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (analyser && playing) {
    analyser.getByteFrequencyData(dataArray);
    drawViz();
  } else {
    vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  }

  const bass = analyser && playing ? avgRange(dataArray, 0, 6)  : 0;
  const mid  = analyser && playing ? avgRange(dataArray, 6, 40) : 0;
  const high = analyser && playing ? avgRange(dataArray, 40, 100): 0;
  
  const totalVolume = (bass + mid + high) / 3;
  const isSilent = (totalVolume < 0.02) && playing; // Auto-off threshold

  // --- Beat Detection Logic ---
  if (playing) {
    if (beatState.beatCooldown > 0) beatState.beatCooldown--;
    
    // Beat hits if bass suddenly spikes
    if (bass > beatState.lastBassAvg * 1.5 && bass > 0.4 && beatState.beatCooldown === 0) {
      beatState.beatCooldown = 20; // Prevent constant triggering
      beatState.speedMultiplier = 3.0; // Jolts forward
      beatState.sweepDirection *= -1; // Changes sweep direction instantly
      beatState.currentPattern = Math.random() > 0.5 ? 1 : 0; // Randomize pattern (0: fan, 1: tilt sweep)
    } else {
      // Decay speed multiplier smoothly back to 1.0
      beatState.speedMultiplier += (1.0 - beatState.speedMultiplier) * 0.1;
    }
  } else {
    beatState.speedMultiplier = 1.0;
  }
  
  beatState.lastBassAvg = bass;

  // Base progression
  const tickSpeed = (playing ? bass * 2.5 + mid : 1.0) * CFG.speed * beatState.speedMultiplier;
  t += 0.012 * tickSpeed;

  const tiltRad = THREE.MathUtils.degToRad(CFG.tilt);

  laserObjects.forEach((l, i) => {
    // Advanced Sweeping based on currentPattern
    let sweepZ = 0;
    let sweepX = tiltRad;

    if (beatState.currentPattern === 0) {
      // Fan Sweep (Left / Right)
      sweepZ = Math.sin(t * beatState.sweepDirection + l.phaseOffset) * CFG.spread + (mid * 0.8 * l.side * CFG.spread);
      sweepX = tiltRad + Math.sin(t * 0.5 + l.phaseOffset * 2) * 0.15 * beatState.speedMultiplier;
    } else {
      // Tilt Matrix (Up / Down alternating, less fan)
      sweepZ = Math.sin(t * 0.5) * CFG.spread; 
      sweepX = tiltRad + Math.sin(t * beatState.sweepDirection + l.side) * 0.5 * CFG.spread + (high * 0.5);
    }

    l.pivot.rotation.x = sweepX;     // up/down (tilt)
    l.pivot.rotation.z = -sweepZ;    // left/right (fan)

    // --- Intensity / Opacity ---
    let op = 0;

    if (isSilent) {
      // Blackout
      op = 0;
    } else if (playing) {
      const baseOp = 0.2 * CFG.intensity; // Base is very low
      const beatOp = bass * 1.2 * CFG.intensity; // Highly reactive to bass
      const midGlow = mid * 0.5 * CFG.intensity;
      op = Math.min(1, baseOp + beatOp + midGlow);
    } else {
      // Idle mode
      op = 0.55 * CFG.intensity;
    }

    // Apply Opacity
    l.beamMat.opacity = op;
    l.tubeMat.opacity = op * 0.35;
    l.lensMat.emissiveIntensity = op;

    // --- Thickness ---
    const th = CFG.thickness * (1 + (playing ? bass * 1.2 : 0));
    l.tube.scale.x = th;
    l.tube.scale.y = th;
  });

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
