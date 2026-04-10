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

function getRMS(array, hopSize) {
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

function normalize(arr) {
    let max = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    if (max > 1e-9) for (let i = 0; i < arr.length; i++) arr[i] /= max;
    return arr;
}

// Besserer Heuristik-Ansatz (Real-Time Heuristic Separation)
function createHeuristicStems(audioData, sampleRate, hopSec) {
    self.postMessage({ type: 'progress', message: 'Applying Filters...', percent: 50 });
    
    const hopSize = Math.round(sampleRate * hopSec);

    // Filter definieren (kaskadierte Filter für steilere Flanken möglich, für Speed aber 1x Biquad)
    const lpBass = new BiquadFilter('lowpass', 150, 0.707, sampleRate);
    const hpDrums = new BiquadFilter('highpass', 4000, 0.707, sampleRate);
    const bpVocals = new BiquadFilter('bandpass', 1500, 1.0, sampleRate); // Breite Mitten
    const bpMelody = new BiquadFilter('bandpass', 3000, 1.5, sampleRate); // Höhere Mitten / Lead

    // Anwenden
    const bassAudio = lpBass.process(audioData);
    const drumsAudio = hpDrums.process(audioData);
    const vocalsAudio = bpVocals.process(audioData);
    const melodyAudio = bpMelody.process(audioData);

    self.postMessage({ type: 'progress', message: 'Computing Energy...', percent: 75 });

    // RMS Mapping
    const bass = normalize(getRMS(bassAudio, hopSize));
    const drums = normalize(getRMS(drumsAudio, hopSize));
    const vocals = normalize(getRMS(vocalsAudio, hopSize));
    const melody = normalize(getRMS(melodyAudio, hopSize));

    // Drums betonen (peaky machen)
    for (let i = 1; i < drums.length - 1; i++) {
        if (drums[i] > drums[i-1] * 1.5) drums[i] *= 1.2;
        else drums[i] *= 0.5;
    }
    normalize(drums);

    // Vocals leicht glätten
    for (let i = 1; i < vocals.length - 1; i++) {
        vocals[i] = (vocals[i-1] + vocals[i]*2 + vocals[i+1]) / 4;
    }

    return { bass, drums, vocals, melody };
}

self.onmessage = async (e) => {
    const { type, audioData, sampleRate } = e.data;

    if (type === 'init') {
        // Sofort bereit
        self.postMessage({ type: 'ready' });
    }

    if (type === 'process') {
        const hopSec = 0.023;
        self.postMessage({ type: 'progress', message: 'Heuristic separation...', percent: 10 });
        
        // Direkte performante Berechnung
        setTimeout(() => {
            const stems = createHeuristicStems(audioData, sampleRate, hopSec);
            self.postMessage({ type: 'progress', message: 'Done.', percent: 100 });
            self.postMessage({ type: 'done', stems });
        }, 50); // Kleiner Timeout um UI Update durchzulassen
    }
};
