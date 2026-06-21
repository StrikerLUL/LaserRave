import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

class BiquadFilter {
    constructor(type, freq, Q, sampleRate) {
        this.type = type;
        this.sampleRate = sampleRate;
        this.x1 = 0; this.x2 = 0;
        this.y1 = 0; this.y2 = 0;
        this.setParams(freq, Q);
    }
    
    setParams(freq, Q) {
        let w0 = 2 * Math.PI * freq / this.sampleRate;
        let alpha = Math.sin(w0) / (2 * Q);
        let cosw0 = Math.cos(w0);
        
        let a0, a1, a2, b0, b1, b2;
        
        if (this.type === 'lowpass') {
            b0 = (1 - cosw0) / 2;
            b1 = 1 - cosw0;
            b2 = (1 - cosw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        } else if (this.type === 'highpass') {
            b0 = (1 + cosw0) / 2;
            b1 = -(1 + cosw0);
            b2 = (1 + cosw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        } else if (this.type === 'bandpass') {
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        }
        
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }
    
    process(inputArray) {
        let outputArray = new Float32Array(inputArray.length);
        for (let i = 0; i < inputArray.length; i++) {
            let x = inputArray[i];
            let y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
                    - this.a1 * this.y1 - this.a2 * this.y2;
            
            this.x2 = this.x1;
            this.x1 = x;
            this.y2 = this.y1;
            this.y1 = y;
            
            outputArray[i] = y;
        }
        return outputArray;
    }
}

export function getRMS(array, hopSize) {
    const numFrames = Math.floor(array.length / hopSize);
    const out = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
        const start = f * hopSize;
        const end = Math.min(start + hopSize, array.length);
        let sum = 0;
        for (let i = start; i < end; i++) {
            sum += array[i] * array[i];
        }
        out[f] = Math.sqrt(sum / (end - start));
    }
    return out;
}

export function normalize(arr) {
    let max = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    if (max > 1e-9) for (let i = 0; i < arr.length; i++) arr[i] /= max;
    return arr;
}

// Verbesserte Analyse: Kaskadierte Filter für steilere Trennung
function createHeuristicStems(audioData, sampleRate, hopSec) {
    const hopSize = Math.round(sampleRate * hopSec);

    // Kaskadierte Filter (4th order Linkwitz-Riley-ähnlich für viel schärfere Trennung!)
    const lpBass1 = new BiquadFilter('lowpass', 150, 0.707, sampleRate);
    const lpBass2 = new BiquadFilter('lowpass', 150, 0.707, sampleRate);
    
    const hpDrums1 = new BiquadFilter('highpass', 5000, 0.707, sampleRate);
    const hpDrums2 = new BiquadFilter('highpass', 5000, 0.707, sampleRate);
    
    const bpVocals1 = new BiquadFilter('bandpass', 1800, 1.2, sampleRate); 
    const bpVocals2 = new BiquadFilter('bandpass', 1800, 1.2, sampleRate); 
    
    const bpMelody1 = new BiquadFilter('bandpass', 3500, 1.5, sampleRate);
    const bpMelody2 = new BiquadFilter('bandpass', 3500, 1.5, sampleRate);

    // Anwenden
    const bassAudio = lpBass2.process(lpBass1.process(audioData));
    const drumsAudio = hpDrums2.process(hpDrums1.process(audioData));
    const vocalsAudio = bpVocals2.process(bpVocals1.process(audioData));
    const melodyAudio = bpMelody2.process(bpMelody1.process(audioData));

    // RMS Mapping
    const bass = normalize(getRMS(bassAudio, hopSize));
    const drums = normalize(getRMS(drumsAudio, hopSize));
    const vocals = normalize(getRMS(vocalsAudio, hopSize));
    const melody = normalize(getRMS(melodyAudio, hopSize));

    // Erweiterte Onset-Betonung für bessere Laser-Schläge
    for (let i = 1; i < drums.length - 1; i++) {
        let diff = drums[i] - drums[i-1];
        if (diff > 0.1) drums[i] = Math.min(1.0, drums[i] + diff * 1.5); // transients pop more
        else drums[i] *= 0.7; // stärkere Dämpfung für klare Schläge
    }
    normalize(drums);
    
    // Bass Punching (Kick Drum separation)
    for (let i = 1; i < bass.length - 1; i++) {
        let diff = bass[i] - bass[i-1];
        if (diff > 0.05) bass[i] = Math.min(1.0, bass[i] + diff * 1.2);
    }
    normalize(bass);

    // Vocals glätten
    for (let i = 1; i < vocals.length - 1; i++) {
        vocals[i] = (vocals[i-1] + vocals[i]*2 + vocals[i+1]) / 4;
    }

    return { bass, drums, vocals, melody };
}

function resampleTo16k(audioData, sampleRate) {
    const ratio = sampleRate / 16000;
    const newLen = Math.floor(audioData.length / ratio);
    const result = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
        result[i] = audioData[Math.floor(i * ratio)];
    }
    return result;
}

let transcriber = null;

if (typeof self !== 'undefined') self.onmessage = async (e) => {
    const { type, audioData, sampleRate } = e.data;

    if (type === 'init') {
        try {
            self.postMessage({ type: 'progress', message: 'Loading AI Lyrics Model (Whisper)...', percent: 10 });
            // Wir verwenden das tiny Modell für Schnelligkeit und Zuverlässigkeit im Browser
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
            self.postMessage({ type: 'progress', message: 'AI Models Ready', percent: 100 });
            self.postMessage({ type: 'ready' });
        } catch (error) {
            console.error("Whisper initialization failed", error);
            self.postMessage({ type: 'fallback_active', reason: 'Whisper failed, using fast analysis only' });
            self.postMessage({ type: 'ready' });
        }
    }

    if (type === 'process') {
        const hopSec = 0.023;
        self.postMessage({ type: 'progress', message: 'Advanced Stem Separation...', percent: 10 });
        
        // 1. Separation
        const stems = createHeuristicStems(audioData, sampleRate, hopSec);
        
        // 2. Lyrics Transcription
        let lyrics = [];
        if (transcriber) {
            self.postMessage({ type: 'progress', message: 'Transcribing lyrics (this may take a minute)...', percent: 50 });
            try {
                const audio16k = resampleTo16k(audioData, sampleRate);
                
                let p = 50;
                const chunkSec = 30;
                const chunkLen = chunkSec * 16000;
                let offset = 0;
                let allChunks = [];

                while (offset < audio16k.length) {
                    const slice = audio16k.slice(offset, offset + chunkLen);
                    
                    // Update progress
                    p += (95 - p) * (chunkLen / audio16k.length);
                    self.postMessage({ type: 'progress', message: `Transcribing lyrics (${Math.round((offset/audio16k.length)*100)}%)...`, percent: p });

                    const result = await transcriber(slice, {
                        return_timestamps: true
                    });
                    
                    if (result.chunks) {
                        const timeOffset = offset / 16000;
                        result.chunks.forEach(c => {
                            const newStart = c.timestamp[0] + timeOffset;
                            const newEnd = c.timestamp[1] !== null ? c.timestamp[1] + timeOffset : null;
                            allChunks.push({ timestamp: [newStart, newEnd], text: c.text });
                        });
                    }
                    offset += chunkLen;
                }
                
                lyrics = allChunks;
            } catch (err) {
                console.error("Transcription failed", err);
            }
        }
        
        stems.lyrics = lyrics;

        self.postMessage({ type: 'progress', message: 'Done.', percent: 100 });
        self.postMessage({ type: 'done', stems });
    }
};
