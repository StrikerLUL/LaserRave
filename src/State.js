import * as THREE from 'three';

export const State = {
    globalFlareTexture: null,
    globalGoboTexture: null,
    
    // Audio
    audioCtx: null,
    audioBuffer: null,
    playing: false,
    source: null,
    playbackStartOffset: 0,
    playlist: [],
    songMap: null,
    waveformValid: false,
    playlistIndex: -1,
    analyser: null,
    dataArray: null,
    
    // Core state
    currentMode: 'live',
    
    // Camera
    autoCamEnabled: false,
    tvModeEnabled: false,
    droneEnabled: false,
    crowdPOVEnabled: false,
    dronePos: new THREE.Vector3(0, 8, 30),
    droneVel: new THREE.Vector3(0, 0, 0),
    tvCutCooldown: 0,
    
    // Effects
    raybounceEnabled: false,
    peakModeEnabled: false,
    isMappingMode: false,
    photoModeActive: false,
    
    // Choreography
    beatsInSection: 0,
    variationPhase: 0,
    lastSectionId: -1,
};
