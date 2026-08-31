import { STAGE_BUILDER_CONFIG } from './StageBuilder.js';
import { STAGE_PRESETS } from './StagePresets.js';
import { POV_CONFIG, AUDIENCE_POV_CONFIG } from './AudiencePOV.js';
import { PHOTO_MODE_CONFIG, PHOTO_FILTERS } from './PhotoMode.js';

export { STAGE_BUILDER_CONFIG, STAGE_PRESETS, POV_CONFIG, AUDIENCE_POV_CONFIG, PHOTO_MODE_CONFIG, PHOTO_FILTERS };

export const CFG = {
  stageSize:     'large',  // 'large' or 'small'
  stagePreset:   'openair', // 'openair' | 'berghain' | 'arena' | 'basement' | 'custom'
  customStageLayout: null,
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
    cybertron:[0x00ffcc, 0xff00ff, 0x0033ff, 0x33ff00, 0xffcc00, 0x00ffff],
    cosmic:   [0x9b59b6, 0x8e44ad, 0xffffff, 0xff66cc, 0x330066, 0xcc99ff],
    quasar:   [0x0044ff, 0xff0044, 0xff00ff, 0x00ffff, 0xffffff, 0x8800ff],
    inferno:  [0xff0000, 0xff4400, 0xff8800, 0xffcc00, 0xffaa00, 0xff2200],
    supernova:[0xffaa00, 0xff0055, 0xaa00ff, 0x00aaff, 0x00ffaa, 0xffff00],
    phantom:  [0x00ffff, 0x9900ff, 0x00ffcc, 0x6600ff, 0x00cccc, 0xcc00ff],
    eclipse:  [0xffffff, 0xff0000, 0x222222, 0xffffff, 0x660000, 0xff3333],
    glacier:  [0x00ffff, 0xffffff, 0x00aaff, 0x88ccff, 0x00ffcc, 0x0055ff],
    hexagon:  [0x00ffcc, 0xff00ff, 0xffff00, 0x00ccff, 0xff00cc, 0xccff00],
    bloodmoon:[0xff0000, 0x8b0000, 0xff4500, 0xdc143c, 0xff8c00, 0xb22222],
    // 🔥 ANIME & AMV THEMES
    evangelion: [0x7600BC, 0x00FF00, 0xFF6600, 0x550088, 0x33FF33, 0xFFFFFF], // Unit-01
    demonslayer:[0xFF2200, 0xFF8800, 0xFFD700, 0x8B0000, 0xFF4500, 0xFFFFFF], // Hinokami Kagura
    edgerunners:[0xFFFF00, 0x00FFFF, 0xFF00FF, 0xCCFF00, 0x00FFCC, 0xFF33CC], // Cyberpunk
    hollowpurple:[0x8B008B, 0x4B0082, 0xFF0000, 0x0000FF, 0x9400D3, 0xFFFFFF], // Gojo
    supersaiyan:[0xFFD700, 0xFFA500, 0xFFFF00, 0xFFFFFF, 0xFFE4B5, 0xFF8C00], // DBZ Gold
    starlight:[0xffffff, 0x88ccff, 0xffff88, 0x00ccff, 0xffffff, 0xaaaaaa],
    plasma:   [0xff0055, 0x5500ff, 0x00ffcc, 0xff00ff, 0xcc00ff, 0xffaa00]
  }
};