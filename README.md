# 🎛️ LaserRave — Real-Time 3D Laser Show Simulator

> A browser-based, audio-reactive 3D laser stage simulator built with Three.js and the Web Audio API.  
> Load your music, hit play, and watch the stage come alive.

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
| 🎵 **Audio Reactivity** | Load any `.mp3` or `.wav` file. Bass drives strobes & pulse effects; mids & highs control laser angles and movement speed. |
| 🌐 **3D Stage Environment** | Fully rendered truss structure, mirror floor, atmospheric fog and haze — all powered by Three.js. |
| 💡 **Multiple Laser Fixtures** | Front, side, and corner-mounted lasers with independent movement patterns. |
| 🎨 **Color Themes** | Switch between RGB, Cyberpunk, Fire, and Matrix palettes in real time. |
| ✨ **Bloom & Glow** | Additive blending + `UnrealBloomPass` post-processing makes every beam feel real. |
| 📸 **Peak Mode** | Camera shake syncs to detected audio peaks for an extra dramatic effect. |
| 🎛️ **Live Control Panel** | Glassmorphism dashboard — adjust intensity, speed, spread, and beam angle on the fly. |
| 🔇 **Auto Blackout** | Lasers fade fully dark when music is paused or audio signal drops. |
| 🔥 **Pyrotechnics System** | Reactive flame and spark particle effects that burst on song climaxes. |

---

## 🛠️ Tech Stack

- **[Three.js](https://threejs.org/)** — 3D rendering, geometry, materials, post-processing
- **[Vite](https://vitejs.dev/)** — lightning-fast dev server & build tool
- **Web Audio API** — real-time frequency and waveform analysis (no external library)
- **Vanilla JavaScript** — no framework overhead

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)

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

> **Windows / PowerShell note:** If you get a script execution error, either switch to `cmd.exe` or run:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```

4. Open your browser at the URL shown in the terminal (e.g. `http://localhost:5173`).

---

## 🎮 How to Use

1. Click **"🎵 Load Audio (MP3/WAV)"** in the left panel.
2. Select any MP3 or WAV file from your device.
3. Hit **▶ Play**.
4. **Rotate** the camera by dragging with the mouse.
5. **Scroll** to zoom in/out.
6. Adjust sliders in the control panel to tweak the show in real time:
   - **Intensity** — overall laser brightness
   - **Speed** — animation / movement speed
   - **Spread** — beam fan width
   - **Angle** — vertical tilt of all fixtures
7. Use the **color theme buttons** to switch palettes instantly.

---

## 📁 Project Structure

```
LaserRave/
├── index.html          # App entry point & UI layout
├── src/
│   ├── main.js         # Core simulator (3D scene, audio engine, animation loop)
│   ├── style.css       # Glassmorphism UI styles
│   └── ai-worker.js    # Background audio-analysis worker
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── package.json
└── README.md
```

> **Note:** The `songs/` directory (personal audio files) and `node_modules/` are intentionally excluded from this repository.

---

## 🔮 Planned Features

- Keyframe Sequencer — program laser scenes frame by frame
- MIDI controller support
- Exportable show recordings (WebM/MP4)
- Multiple stage presets (club, festival, arena)

---

## 👤 Author

**StrikerLUL**  
GitHub: [@StrikerLUL](https://github.com/StrikerLUL)

---

*© 2024 StrikerLUL — All rights reserved. Private use only. See LICENSE for full terms.*
