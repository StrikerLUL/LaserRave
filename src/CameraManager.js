import { State } from './State.js';
import * as THREE from 'three';

export const CameraManager = {

    toggleAutoCam() {
        State.autoCamEnabled = !State.autoCamEnabled;
        if (!State.autoCamEnabled && !State.tvModeEnabled && State.currentMode === 'live') {
            State.currentMode = 'live'; 
        }
    },
    toggleTvMode() {
        State.tvModeEnabled = !State.tvModeEnabled;
    },
    updateDrone(dt) {
        // Drone logic
    }
    };
