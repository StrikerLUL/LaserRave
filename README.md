# 🎛️ LaserRave — Real-Time 3D Laser Show Simulator

> A browser-based, audio-reactive 3D laser stage simulator built with Three.js and the Web Audio API.
> Load your music, hit play, and watch the stage erupt.

---

## ⚠️ License & Usage Restrictions

This project is **for private / personal use only**.

- ✅ You may run, study, and modify this project for **personal, non-commercial use**.
- ❌ You may **not** use this project, its visuals, recordings, or any derivative work for **commercial purposes**, **public performances**, **social media content** (TikTok, YouTube, Instagram, Twitch…), or **any monetised platform** without **explicit written permission from the author**.
- ❌ You may **not** redistribute or re-publish this project or any part of it without permission.

To request permission — for content creation or live events, say — open a GitHub Issue or contact the author directly.

See the [LICENSE](./LICENSE) file for full terms.

---

## 🎥 See it in Action

Videos and photos of the simulator in action are on TikTok:
👉 **[@strikerlulu1](https://www.tiktok.com/@strikerlulu1)**

---

## ✨ Features

### Audio & Show Logic

| Feature | Description |
|---|---|
| 🎵 **Full Song Analysis** | Uploaded tracks are analysed offline with AI stem separation — bass, drums, melody and vocals each drive different visual elements. A fast FFT-only mode is available when you don't want to wait. |
| 🧠 **Musical Structure Detection** | The analyser labels the song structure — intro, verse, build-up, drop, outro — and each section triggers its own lighting choreography. |
| ⚡ **Peak Drop Chaos** | When the bass drops, the lasers go wide and erratic, strobes flicker and the CO₂ jets fire on the beat. |
| 🤖 **Live Pattern Engine** | A pattern decider picks from 14+ choreographies (fan, wave, scatter, tunnel, strobe, salvo, zigzag, chase, sparkle…) from the real-time audio signal. |
| 🥁 **Manual BPM Tap** | Tap the beat by hand when the automatic detection disagrees with you. |

### Stage & Fixtures

| Feature | Description |
|---|---|
| 🏗️ **Custom Stage Builder** | Top-down orthographic editor with a 0.5 m snapping grid. Place trusses, screens, lasers, moving heads, CO₂ jets and up-lights, then compile the layout into a live show. Saved to `localStorage`. |
| 🏟️ **Four Venue Presets** | Berghain (concrete bunker, dense haze), Open-Air Festival (procedural starfield, grass, rain), Arena (in-the-round, 360° rig, 200-strong crowd) and Basement Club (8×8×3 m, neon signs, max haze). |
| 💡 **Instanced Laser Fixtures** | Front, twin, side, surround, corner, aerial and dancefloor formations with zone-aware choreography. |
| 🔦 **Instanced Moving Heads** | Spring-physics pan/tilt with an ADSR envelope and gobo textures. |
| 🌑 **Real-Time Shadows** | A pool of shadow-casting spotlights is re-aimed each frame at the brightest active heads, so structures block light instead of glowing through it. Resolution scales down automatically when the frame rate drops. |
| 🎇 **Up-Lights & Wash** | Stage wash lights react to mix energy and section type. |
| 🔥 **Pyrotechnics** | Curl-noise flame and spark particles, simulated in a Web Worker over `SharedArrayBuffer` so the physics never blocks the render loop. |
| 🌫️ **Haze & CO₂ Jets** | Volumetric haze plus cryo-jet bursts that fire on drops. |
| 🌧️ **Weather Effects** | 2,000–8,000 GPU rain streaks with wind drift, floor splash bursts, laser-tinted droplets, and a procedural rain sound synthesised from filtered white noise. |
| 🕺 **Live Crowd** | Animated festival crowd that jumps and raises hands in time with the BPM and song sections. |
| 👥 **Volumetric Crowd Lighting** | When a beam sweeps over a crowd member they light up in that beam's exact colour; overlapping beams blend (red + blue = magenta) and fade out on a glow trail. |
| 🎧 **Procedural DJ Avatar** | Low-poly rig at the booth — head nod on the BPM, arms working the mixer on bass/mid, shoulder bounce on the kick, fist pump on the drop. |

### Camera, Capture & Control

| Feature | Description |
|---|---|
| 🎬 **TV Mode / Auto-Camera** | Cinematic cuts and orbit sweeps synced to beats and section changes. |
| 🎮 **VJ Camera Drone** | Free-flight first-person camera with inertia, aerodynamic banking and spring-damped bass rumble on every kick. |
| 👤 **Audience POV** | Eye-level camera (1.75 m) attached to a crowd member, with beat-synced head bob, kick shake, and a hop to a new person every fourth beat. Portrait 9:16 supported. |
| 📸 **Photo Mode** | Freezes the show and audio, gives you a free-look camera with FOV/roll/depth-of-field, six creative filters (Raw, VHS, Film, Analog, Neon, Hologram) and a high-resolution PNG export. |
| 🎹 **Web MIDI** | Connect a Launchpad, APC40 or any controller. Default CC and note mappings plus an interactive MIDI Learn dialog, persisted to `localStorage`. |
| 🔮 **Laser Text & SVG Projection** | Type text or upload an SVG and a dedicated array projects it with simulated galvo-scanner physics — mechanical inertia, corner dwell flicker and beam blanking between glyphs. |
| 🎨 **Colour Themes & Video Sync** | Dynamic, RGB, Cyberpunk, Warm, Matrix and more. Upload a background video and the lasers and screens mirror its colours. |
| 📹 **Video Recording** | Capture the show as WebM/MKV straight from the browser at up to 35 Mbps. |
| 🕹️ **TikTok Mode** | Jumps to the highest-energy drop and formats the capture for 9:16, with optional muted export to avoid Content-ID matches. |
| 📱 **Offline PWA** | Installable web app with a service worker: network-first navigation, cache-first hashed assets, and an offline fallback. |
| 🌐 **Multiplayer** | Host or join a room over PeerJS to share a session. |

---

## 🕹️ VJ Console Controls

| Control | Function |
|---|---|
| 🎥 **Auto-Cam** | Cinematic camera movement synced to the music |
| 📺 **TV Mode** | Broadcast-style cuts between preset angles |
| 🎮 **Drone Cam** | Fly the camera freely |
| 💡 **Heads** | Toggle moving head fixtures |
| 🕺 **Crowd** | Toggle the animated crowd |
| 👥 **Dynamic Light** | Volumetric per-person crowd lighting vs. flat silhouettes |
| 🎇 **Up-Lights** | Toggle wash up-lights |
| 🪞 **Bounce** | Ray-bounce reflections off the mirror floor |
| 📼 **VHS FX** | RGB chromatic shift + film grain |
| 🌪️ **Blur FX** | After-image motion trail |
| ✨ **Flares** | Lens flares on bright sources |
| 🔮 **Laser Writing** | Toggle the galvo-scanner text/SVG projector |

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `F` | Fullscreen (or double-click the 3D view) |
| `C` | Toggle Auto-Cam |
| `T` | Toggle TV Mode |
| `H` | Show / hide the UI panels |

### Drone Cam

| Key | Action |
|---|---|
| `W` / `S` | Forward / backward |
| `A` / `D` | Strafe left / right |
| `Space` | Ascend |
| `Shift` | Descend |
| Arrow keys | Pan / tilt |
| Mouse drag | Look around |

---

## 🛠️ Tech Stack

- **[Three.js](https://threejs.org/)** (WebGL renderer) — 3D rendering and instanced fixtures
- **EffectComposer** — bloom, after-image, film grain and RGB shift, with music-reactive bloom strength
- **[Vite](https://vitejs.dev/)** — dev server and build
- **Web Audio API** — real-time FFT plus offline full-song stem analysis
- **Web Workers** — audio analysis and pyro particle physics off the main thread
- **Web MIDI API** — hardware controller input
- **Vanilla JavaScript** — no framework, plain ES modules

> **On WebGPU:** earlier versions attempted a WebGPU/TSL post-processing pipeline. It never actually ran — the show is built on raw GLSL `ShaderMaterial` (beams, volumetric haze, fog, LED wall), which `WebGPURenderer` cannot compile, so the code path was disabled by an unconditional `throw` and the renderer always fell back to WebGL. That dead path has been removed and post-processing now runs through `EffectComposer` on WebGL. Porting the shaders to TSL would be a prerequisite for revisiting WebGPU.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- npm (ships with Node.js)
- A modern browser with WebGL 2 — Chrome or Edge recommended (Web MIDI and file-system recording are Chromium-only)

### Installation

```bash
git clone https://github.com/StrikerLUL/LaserRave.git
cd LaserRave
npm install
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`).

> **Windows / PowerShell:** if you hit a script execution error, run
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite (Node's built-in test runner) |

---

## 🎮 How to Use

1. Click **🎵 Load Audio (MP3/WAV)** in the left panel and pick a file.
2. Wait for the analysis to finish (progress bar at the bottom). Tick **⚡ Fast Analysis (No AI)** to skip stem separation.
3. Hit **▶ Play**.
4. Optionally upload a background **video** — screens and lasers will follow its colours.
5. Drag to orbit the camera, scroll to zoom.
6. Tune the show live: stage size, formation, intensity, speed, spread, angle, haze, beams per laser, colour theme, FX toggles.
7. Switch camera with **Auto-Cam**, **TV Mode**, **Drone Cam** or **Audience POV**.
8. Hit **🔴 Record Video** to capture, or open **Photo Mode** for a still.

---

## 📁 Project Structure

```
LaserRave/
├── index.html              # App entry point and UI layout
├── src/
│   ├── main.js             # Simulator core: render loop, fixtures, camera, UI wiring
│   ├── config.js           # Global parameters, presets, colour themes
│   ├── State.js            # Runtime state store
│   ├── StageBuilder.js     # Builder maths, schema, serialisation, compilation
│   ├── StagePresets.js     # The four venue presets and their procedural props
│   ├── WeatherEffects.js   # Rain physics, splashes, laser reflections
│   ├── AudiencePOV.js      # Crowd-level camera, head bob, hop transitions
│   ├── PhotoMode.js        # Freeze-frame, free-look camera, filters, PNG export
│   ├── DJAvatar.js         # Procedural DJ rig and audio-reactive animation
│   ├── MIDIController.js   # Web MIDI access, mappings, MIDI Learn
│   ├── AudioProcessor.js   # Web Audio graph and procedural rain synth
│   ├── LaserEngine.js      # Laser generation and choreography
│   ├── NewFixtures.js      # Additional fixture types
│   ├── Multiplayer.js      # PeerJS session sharing
│   ├── PWA.js              # Service worker registration and manifest validation
│   ├── ai-worker.js        # Stem separation / structure analysis worker
│   ├── pyro-worker.js      # Pyro particle physics worker
│   └── style.css           # Glassmorphism UI styles
│
│   # Currently unreferenced — kept for reference, not part of the build:
│   ├── PostProcessing.js   # Old WebGPU/TSL post chain, superseded by EffectComposer
│   ├── UIManager.js        # Superseded once main.js absorbed the UI wiring
│   ├── CameraManager.js
│   └── LaserFont.js
├── public/
│   ├── manifest.json       # Web app manifest
│   ├── sw.js               # Service worker
│   └── icons/              # PWA icons
├── tests/                  # Test suite (node --test)
├── vite.config.js
└── package.json
```

> `songs/` (personal audio), `node_modules/`, `dist/` and local scratch files are excluded from the repository.

---

## 🧪 Tests

```bash
npm test
```

The suite runs on Node's built-in test runner and covers the stage builder, venue presets, weather effects, audience POV, photo mode, DJ avatar, MIDI controller, the real service worker, and cross-feature scenarios.

Tests import the modules under `src/` directly. Several suites previously carried a private copy of the implementation inside the test file and asserted against that copy, which meant they stayed green no matter what the shipped code did; those have been rewired to the real modules. `tests/serviceWorker.real.test.js` goes further and executes the actual `public/sw.js` inside a service-worker-shaped sandbox.

---

## 🔧 Debug Handle

The app exposes a small read-mostly handle on `window` for performance work. In the browser console:

```js
__laserrave.info              // draw calls, triangles, programs, geometries, textures
__laserrave.fps               // smoothed frame rate
__laserrave.shadows           // shadow state: enabled, map size, casters in use
__laserrave.setShadows(false) // A/B shadow cost in a single session
__laserrave.setBeamBrightness(1.4) // live trim for additive beam brightness
```

`renderer.info` resets itself on every `render()` call, and the post chain issues several per frame — so the renderer is put into manual reset mode and cleared once per frame. Without that, the counters only ever report the last fullscreen pass.

---

## 🐛 Notes & Known Limitations

- **Crowd rendering** — the crowd is currently one `THREE.Mesh` per person with two cloned materials each. At the Arena preset's 200 people that is 200 draw calls and 400 material instances, and it is the largest remaining performance item. Converting it to a single `InstancedMesh` is the planned fix.
- **Crowd shadows** — crowd members use `MeshBasicMaterial`, which ignores lighting entirely, so `receiveShadow` has no effect on them yet. The flag is already set so they start receiving as soon as the material changes.
- **Floor albedo** — the floor is nearly black (`0x050505`), so shadow-cast light pools barely register on it. Lifting the albedo makes them visible but changes the overall look, so it has been left as an explicit choice.
- **Unreferenced modules** — `PostProcessing.js`, `UIManager.js`, `CameraManager.js` and `LaserFont.js` are no longer imported by anything. They are left in place for reference but are not part of the build; `PostProcessing.js` in particular is the old TSL pipeline and would pull `three/tsl` back in if it were ever wired up again.
- **AI analysis payload** — the ONNX runtime WASM used by the stem separator is around 22 MB. It ships with the build even though **Fast Analysis** is the default; making it a genuine lazy load is planned.

---

## 🔮 Planned

- Anamorphic lens flares and streaks
- Depth-aware soft beams (no hard intersection edges with geometry)
- Volumetric raymarched haze
- Real fixture profiles with motor inertia (°/s limits)
- Beam occlusion against stage geometry
- DMX / Art-Net output for real hardware
- Microphone / line-in live input
- Cue list and scene stack for live operation
- Offline 4K render with accumulated motion blur
- WebXR (VR) mode

---

## 👤 Author

**StrikerLUL**
GitHub: [@StrikerLUL](https://github.com/StrikerLUL)

---

*© 2025 StrikerLUL — All rights reserved. Private use only. See [LICENSE](./LICENSE) for full terms.*
