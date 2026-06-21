export const CFG = {
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
    inferno:  [0xff0000, 0xff4400, 0xff8800, 0xffcc00, 0xffaa00, 0xff2200],
  }
};
