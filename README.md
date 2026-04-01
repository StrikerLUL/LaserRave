# Tiny Desk Raves - Virtual Laser Simulator

Willkommen zum **Tiny Desk Raves - Virtual Laser Simulator**!
Dieses Projekt ist eine Web-Anwendung, die es dir ermöglicht, eine vollständige, audio-reaktive 3D-Laser-Bühnenshow direkt in deinem Browser zu simulieren.

## ✨ Features

- **Echte 3D Umgebung:** Realistische Bühne (Truss-Konstruktion, Spiegelboden und Nebel) gerendert mit [Three.js](https://threejs.org/).
- **Audio Reaktivität:** Importiere deine eigenen `.mp3` oder `.wav` Dateien. Die Web Audio API analysiert die Frequenzen in Echtzeit:
  - Bässe steuern die Helligkeit und Rhythmik der Laser (Strobe/Pulse-Effekte).
  - Höhen und Mitten steuern die Bewegungen und Winkel.
  - Völlige Dunkelheit, wenn die Musik pausiert oder es keine Signale gibt.
- **Glassmorphism UI:** Ein schickes, modernes Dashboard mit voller Kontrolle über Intensität, Geschwindigkeit, Laser-Spread (Breite) und Winkel.
- **Farbthemen:** Wechsle dynamisch zwischen verschiedenen Laser-Paletten (RGB, Cyberpunk, Fire, Matrix).
- **Glow & Bloom:** Echtes Additive Blending und Post-Processing (UnrealBloomPass) lassen die Laser wirklich leuchten.

## 🚀 Installation & Start

Dieses Projekt nutzt [Vite](https://vitejs.dev/) als schnelles Build-Tool.

1. **Repository klonen** (oder herunterladen und in den Ordner wechseln)
   ```bash
   git clone <dein-repo-link>
   cd Lasershow
   ```

2. **Abhängigkeiten installieren**
   ```bash
   npm install
   ```
   *(Achtung: Solltest du PowerShell nutzen und Script-Blockaden erleben, wechsle in `cmd` oder führe `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` aus)*

3. **Entwicklungsserver starten**
   ```bash
   npm run dev
   ```

4. Öffne deinen Browser auf der angezeigten URL (z.B. `http://localhost:5173`).

## 🎮 Benutzung

1. Klicke links auf den Button **"🎵 Load Audio (MP3/WAV)"**.
2. Wähle deinen Track.
3. Klicke auf **Play**.
4. Drehe die Kamera mit der Maus und stelle dir die Laser ganz nach deinen Wünschen ein.

*(Dieses Projekt steht ganz am Anfang. Ein Keyframe-Sequencer, mit dem man die Laser Frame für Frame einzeln programmieren kann, ist für zukünftige Updates geplant!)*
