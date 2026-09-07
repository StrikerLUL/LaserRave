import { State } from './State.js';
import { initAudioContext } from './main.js';
import { calculateRainAudioGain, WEATHER_CONFIG } from './WeatherEffects.js';

export class ProceduralRainSynth {
    constructor() {
        this.ctx = null;
        this.noiseBuffer = null;
        this.noiseSource = null;
        this.bandpassFilter = null;
        this.highpassFilter = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.currentGain = 0.0;
    }

    init(audioCtx) {
        if (!audioCtx) return;
        this.ctx = audioCtx;

        try {
            // Generate 3 seconds of white noise buffer
            const sampleRate = this.ctx.sampleRate || 44100;
            const bufferSize = sampleRate * 3;
            this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
            const output = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = (Math.random() * 2 - 1) * 0.4;
            }

            // Cascaded BiquadFilterNodes
            this.bandpassFilter = this.ctx.createBiquadFilter();
            this.bandpassFilter.type = 'bandpass';
            this.bandpassFilter.frequency.value = 1200; // ~1200 Hz
            this.bandpassFilter.Q.value = 0.8;

            this.highpassFilter = this.ctx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = 400; // ~400 Hz

            this.gainNode = this.ctx.createGain();
            this.gainNode.gain.value = 0.0;

            // Connect graph: noiseSource -> bandpass -> highpass -> gainNode -> destination
            this.bandpassFilter.connect(this.highpassFilter);
            this.highpassFilter.connect(this.gainNode);
            this.gainNode.connect(this.ctx.destination);
        } catch (e) {
            console.warn('[ProceduralRainSynth] init failed:', e);
        }
    }

    start(intensity = WEATHER_CONFIG.defaultIntensity) {
        if (this.isPlaying) {
            this.setIntensity(intensity, true);
            return;
        }
        if (!this.ctx) return;
        if (!this.noiseBuffer || !this.bandpassFilter) {
            this.init(this.ctx);
        }
        if (!this.noiseBuffer || !this.bandpassFilter) return;

        try {
            this.noiseSource = this.ctx.createBufferSource();
            this.noiseSource.buffer = this.noiseBuffer;
            this.noiseSource.loop = true;
            this.noiseSource.connect(this.bandpassFilter);
            this.noiseSource.start(0);
            this.isPlaying = true;
            this.setIntensity(intensity, true);
        } catch (e) {
            console.warn('[ProceduralRainSynth] start failed:', e);
        }
    }

    stop() {
        if (!this.isPlaying) return;
        if (this.noiseSource) {
            try {
                this.noiseSource.stop();
                this.noiseSource.disconnect();
            } catch (e) {}
            this.noiseSource = null;
        }
        if (this.gainNode && this.ctx) {
            try {
                const t = this.ctx.currentTime || 0;
                this.gainNode.gain.cancelScheduledValues(t);
                this.gainNode.gain.setValueAtTime(0, t);
            } catch (e) {}
        }
        this.isPlaying = false;
        this.currentGain = 0.0;
    }

    setIntensity(intensity, enabled = true) {
        const targetGain = calculateRainAudioGain(enabled, intensity);
        this.currentGain = targetGain;
        if (this.gainNode && this.ctx) {
            try {
                const t = this.ctx.currentTime || 0;
                this.gainNode.gain.cancelScheduledValues(t);
                this.gainNode.gain.linearRampToValueAtTime(targetGain, t + 0.08);
            } catch (e) {
                try {
                    this.gainNode.gain.value = targetGain;
                } catch (e2) {}
            }
        }
    }
}

const BEAT_HISTORY = 43;
const beatEnergy = new Float32Array(BEAT_HISTORY);
let beatPtr = 0;

// NOTE: the main branch carried a stub `class AudioProcessor` here whose only
// method was a TODO reading "Migrate loadAudio and detectBeat logic here". That
// migration is what the object below already is, so the stub was dropped during
// the merge rather than kept as a second, conflicting export of the same name.
export const AudioProcessor = {
// ── Revised loadAudio ─────────────────────────────────────────
async loadAudio(file) {
  try {
    initAudioContext();
    if (State.playing && State.source) { State.source.stop(); State.playing = false; }
    State.playbackStartOffset = 0;

    if (!file) {
      console.warn("No audio file provided, generating fallback buffer.");
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (OfflineCtx) {
          const tempCtx = new OfflineCtx(1, 44100 * 10, 44100);
          State.audioBuffer = tempCtx.createBuffer(1, 44100 * 10, 44100);
      } else {
          State.audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
      }
    } else {
        try {
            const ab = await file.arrayBuffer();
            if (!State.audioCtx) throw new Error("AudioContext not initialized");
            State.audioBuffer = await State.audioCtx.decodeAudioData(ab);
        } catch (e) {
            console.warn("Error decoding audio data, generating fallback buffer.", e);
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            if (OfflineCtx) {
                const tempCtx = new OfflineCtx(1, 44100 * 10, 44100);
                State.audioBuffer = tempCtx.createBuffer(1, 44100 * 10, 44100);
            } else {
                State.audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
            }
        }
    }

    // Store in the playlist queue item
    let playlistItem = file ? State.playlist.find(item => item.file === file || item.name === file.name) : null;
    if (playlistItem) {
      playlistItem.audioBuffer = State.audioBuffer;
    }

    // Instant fallback/temporary songMap
    const N = Math.floor(State.audioBuffer.duration / 0.1) || 100;
    const tempSongMap = {
      bpm: 120,
      beats: [{ time: 0, strength: 1.0 }],
      sections: [{
        startFrame: 0, endFrame: N, startTime: 0, endTime: State.audioBuffer.duration || 10,
        avgBass: 0.5, avgMid: 0.5, avgHigh: 0.5, avgEnergy: 0.5,
        bassW: 0.33, midW: 0.33, trebleW: 0.33,
        seed: 0, id: 0,
        baseHue: 0, pattern: 'sidesweep',
        liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 },
        speedScale: 1, spreadMod: 1
      }],
      bassMap: new Float32Array(N),
      midMap: new Float32Array(N),
      highMap: new Float32Array(N),
      melodyMap: new Float32Array(N),
      energyMap: new Float32Array(N),
      buildUpMap: new Float32Array(N),
      hopSec: 0.1, hop: 4410, N: N
    };

    if (playlistItem) {
      playlistItem.songMap = tempSongMap;
    }
    State.songMap = tempSongMap;
    State.waveformValid = false;

    // Enable Play/Export buttons immediately
    const btnPP = document.getElementById('btn-play-pause');
    if (btnPP) btnPP.disabled = false;
    const btnR = document.getElementById('btn-render');
    if (btnR) btnR.disabled = false;
    document.getElementById('song-timeline').classList.remove('hidden');
    switchMode(State.currentMode);
    updateTimeline();

    // Asynchronously trigger detailed analysis in the background
    analyzeSong(State.audioBuffer, file.name).then(fullMap => {
      if (playlistItem) {
        playlistItem.songMap = fullMap;
      }
      // Hot-swap if this song is still the active one!
      if (State.playlistIndex !== -1 && State.playlist[State.playlistIndex] === playlistItem) {
        State.songMap = fullMap;
        State.waveformValid = false;
        updateTimeline();
        console.log(`[Background Analysis] Hot-swapped map for ${playlistItem.name}`);
      }
    }).catch(err => {
      console.error("Background analysis failed:", err);
    });

  } catch (error) {
    console.error("Error loading audio:", error);
    alert("Could not load the audio file. Falling back to a silent placeholder track.");

    // Graceful fallback for audio buffer
    try {
        initAudioContext();
        if (!State.audioCtx) throw new Error("No audioCtx available for fallback");

        let localAudioBuffer = null;
        try {
            localAudioBuffer = State.audioCtx.createBuffer(1, State.audioCtx.sampleRate * 10, State.audioCtx.sampleRate);
        } catch (e) {
            const TempAudioContext = window.AudioContext || window.webkitAudioContext;
            if (TempAudioContext) {
                const tempCtx = new TempAudioContext();
                localAudioBuffer = tempCtx.createBuffer(1, tempCtx.sampleRate * 10, tempCtx.sampleRate);
                tempCtx.close().catch(() => {});
            } else {
                throw e;
            }
        }

        if (!localAudioBuffer) throw new Error("Could not create actual AudioBuffer instance");

        State.audioBuffer = localAudioBuffer;
        State.songMap = {
            bpm: 120,
            beats: [{ time: 0, strength: 1 }],
            sections: [{ startFrame: 0, endFrame: 100, startTime: 0, endTime: 10, intensity: 1, type: "drop", pattern: 'sidesweep', baseHue: 0, liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 }, speedScale: 1, spreadMod: 1 }],
            bassMap: new Float32Array(100), midMap: new Float32Array(100), highMap: new Float32Array(100), energyMap: new Float32Array(100),
            hopSec: 0.1, N: 100
        };
        State.waveformValid = false;
    } catch (fallbackError) {
        console.error("Fallback audio generation failed:", fallbackError);
        // Attempt one last time to create an AudioBuffer, otherwise use the plain object
        try {
            const TempAudioContext = window.AudioContext || window.webkitAudioContext;
            if (TempAudioContext) {
                const tempCtx = new TempAudioContext();
                State.audioBuffer = tempCtx.createBuffer(1, tempCtx.sampleRate * 10, tempCtx.sampleRate);
                tempCtx.close().catch(() => {});
            } else {
                throw new Error("No AudioContext");
            }
        } catch (e2) {
             State.audioBuffer = { duration: 10, sampleRate: 44100, length: 441000, numberOfChannels: 1, getChannelData: () => new Float32Array(441000) };
        }

        State.songMap = {
            bassMap: new Float32Array(100),
            midMap: new Float32Array(100),
            highMap: new Float32Array(100),
            melodyMap: new Float32Array(100),
            energyMap: new Float32Array(100),
            buildUpMap: new Float32Array(100),
            beats: [{ time: 0, str: 1 }],
            sections: [{
                startFrame: 0, endFrame: 100, startTime: 0, endTime: 10,
                start: 0, end: 10, intensity: 1, type: "drop",
                avgBass: 0.5, avgMid: 0.5, avgHigh: 0.5, avgEnergy: 0.5,
                bassW: 0.33, midW: 0.33, trebleW: 0.33,
                seed: 0, id: 0,
                baseHue: 0, pattern: 'sidesweep',
                liss: { xf: 0.13, yf: 0.1, zf: 0.17, xp: 0, yp: 0, zp: 0 },
                speedScale: 1, spreadMod: 1
            }],
            hopSec: 0.1, hop: 4410, N: 100, bpm: 120
        };
        State.waveformValid = false;
    }
  }
},
detectBeat(bass) {
  beatEnergy[beatPtr] = bass; beatPtr = (beatPtr + 1) % BEAT_HISTORY;
  let avg = 0;
  for (let i = 0; i < BEAT_HISTORY; i++) avg += beatEnergy[i];
  avg /= BEAT_HISTORY;
  return bass > Math.max(avg * 1.5, 0.22);
}
};
