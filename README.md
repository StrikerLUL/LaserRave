# 🎛️ LaserRave — Real-Time 3D Laser Show Simulator

> A browser-based, audio-reactive 3D laser stage simulator built with Three.js (WebGPU) and the Web Audio API.  
> Load your music, hit play, and watch the stage erupt.

---

## ⚠️ License & Usage Restrictions

This project is **for private / personal use only**.

- ✅ You may run, study, and modify this project for **personal, non-commercial use**.
- ❌ You may **NOT** use this project, its visuals, recordings, or any derivative works for **commercial purposes**, **public performances**, **social media content** (e.g. TikTok, YouTube, Instagram, Twitch), or **any monetised platform** without **explicit written permission from the author**.
- ❌ You may **NOT** redistribute or re-publish this project or any part of it without permission.

> **To request permission** (e.g. for content creation or live events), open a GitHub Issue or contact the author directly.

See the [LICENSE](./LICENSE) file for full terms.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎵 **Full Song Analysis** | Uploads are analyzed offline using AI stem separation — bass, drums, melody, and vocals each drive different visual elements. |
| ⚡ **Peak Drop Chaos** | When the bass fully drops, lasers go completely wild — rapid wide scatter, strobe flicker and continuous chaos movement fill the entire stage. |
| 🌐 **3D Stage Environment** | Fully rendered truss structure, mirror floor, atmospheric haze/fog — Large Festival or Small Club stage, switchable in real time. |
| 💡 **180+ Laser Fixtures** | Front, twin, side, surround, corner, aerial and dancefloor formations with zone-aware choreography. |
| 🤖 **Intelligent Pattern Engine** | Live pattern decider chooses from 14 choreographic patterns (fan, wave, scatter, tunnel, strobe, salvo, zigzag, chase, sparkle…) based on real-time audio signals. |
| 🎨 **Color Themes + Video Sync** | Dynamic, RGB, Cyberpunk, Warm, and Matrix palettes. Upload a background video and lasers + screens automatically mirror its colors. |
| 🖥️ **Reactive LED Screens** | Stage screens display uploaded video or pulse with vivid theme colors when no video is loaded. |
| 💥 **Bloom & Glow (WebGPU)** | Node-based TSL post-processing pipeline — bloom, after-image trail, film grain, and RGB chromatic shift. |
| 🔥 **Pyrotechnics System** | Curl-noise fluid-dynamics flame and spark particles that burst on song climaxes. |
| 🎬 **TV Mode / Auto-Camera** | Automated cinematic camera cuts and smooth orbit sweeps synced to the beat and section changes. |
| 🎛️ **Live Control Panel** | Glassmorphism dashboard — adjust intensity, speed, spread, tilt, haze, laser count, beam count, and more on the fly. |
| 📹 **Video Recording** | Capture the show as a WebM/MKV video directly from the browser at up to 35 Mbps. |
| 🕹️ **TikTok Mode** | Auto-jumps to the highest energy drop and formats the recording for 9:16 social media. |
| 🔇 **Auto Blackout** | Lasers and screens fade to black when music is paused or the audio signal drops. |
| 120 **Moving Heads** | Instanced beam fixtures with spring-physics pan/tilt, ADSR envelope, and gobo textures. |

---

## 🛠️ Tech Stack

- **[Three.js (WebGPU)](https://threejs.org/)** — 3D rendering, WebGPU renderer, TSL node-based post-processing
- **[Vite](https://vitejs.dev/)** — lightning-fast dev server & build tool
- **Web Audio API** — real-time FFT frequency analysis + offline full-song stem analysis
- **Web Workers** — background AI audio processing without blocking the main thread
- **Vanilla JavaScript** — no framework overhead, pure ES modules

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)
- A **Chromium-based browser** (Chrome / Edge) for WebGPU support

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/StrikerLUL/LaserRave.git
cd LaserRave

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

> **Windows / PowerShell note:** If you get a script execution error, run:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```

4. Open your browser at the URL shown in the terminal (e.g. `http://localhost:5173`).

---

## 🎮 How to Use

1. Click **"🎵 Load Audio (MP3/WAV)"** in the left panel and select any audio file.
2. Wait for the song analysis to complete (progress bar at the bottom).
3. Hit **▶ Play**.
4. Optionally upload a background **video** — the screens and lasers will sync to its colors.
5. **Rotate** the camera by dragging with the mouse. **Scroll** to zoom in/out.
6. Adjust the control panel in real time:
   - **Stage** — switch between Large Festival and Small Club
   - **Formation** — change laser placement (front / sides / surround / corners / aerial…)
   - **Intensity / Speed / Spread / Angle** — fine-tune the show
   - **Haze** — atmospheric fog density
   - **Beams Per Laser** — stack multiple beams per projector
   - **Color Theme** — switch palettes instantly
   - **FX** — toggle Bloom trail, VHS/Film grain, Lens flares
7. Use **Auto-Cam** or **TV Mode** for automated cinematic camera movement.
8. Click **🔴 Record Video** to capture a WebM export.

---

## 📁 Project Structure

```
LaserRave/
├── index.html          # App entry point & UI layout
├── src/
│   ├── main.js         # Core simulator (3D scene, audio engine, animation loop)
│   ├── style.css       # Glassmorphism UI styles
│   └── ai-worker.js    # Background audio-analysis / stem-separation worker
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── package.json
└── README.md
```

> **Note:** The `songs/` directory (personal audio files), `node_modules/`, and debug screenshots are intentionally excluded from this repository.

---

## 🔮 Planned Features

- MIDI controller support
- Multiple export formats (MP4 H.264)
- DMX/Art-Net output for real hardware fixtures
- Beat grid editor for manual BPM correction

---

## 👤 Author

**StrikerLUL**  
GitHub: [@StrikerLUL](https://github.com/StrikerLUL)

---

*© 2025 StrikerLUL — All rights reserved. Private use only. See LICENSE for full terms.*
