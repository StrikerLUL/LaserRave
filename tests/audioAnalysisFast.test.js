import test from 'node:test';
import assert from 'node:assert/strict';

// Fast direct Biquad Filter implementation for node / browser test
class FastBiquad {
    constructor(type, freq, Q, sampleRate) {
        const w0 = 2 * Math.PI * freq / sampleRate;
        const alpha = Math.sin(w0) / (2 * Q);
        const cosw0 = Math.cos(w0);
        let a0, a1, a2, b0, b1, b2;
        if (type === 'lowpass') {
            b0 = (1 - cosw0) / 2;
            b1 = 1 - cosw0;
            b2 = (1 - cosw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        } else if (type === 'highpass') {
            b0 = (1 + cosw0) / 2;
            b1 = -(1 + cosw0);
            b2 = (1 + cosw0) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cosw0;
            a2 = 1 - alpha;
        } else { // bandpass
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
        this.x1 = 0; this.x2 = 0;
        this.y1 = 0; this.y2 = 0;
    }
    processSample(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x;
        this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

function analyzeAudioDirect(audioData, sampleRate) {
    const hopSec = 0.023;
    const hop = Math.round(sampleRate * hopSec);
    const N = Math.floor(audioData.length / hop);

    const lpBass = new FastBiquad('lowpass', 220, 0.707, sampleRate);
    const bpMid = new FastBiquad('bandpass', 1500, 0.8, sampleRate);
    const hpHdr = new FastBiquad('highpass', 3500, 0.707, sampleRate);

    const bassMap = new Float32Array(N);
    const midMap = new Float32Array(N);
    const highMap = new Float32Array(N);
    const energyMap = new Float32Array(N);

    let maxB = 0, maxM = 0, maxH = 0, maxE = 0;

    for (let f = 0; f < N; f++) {
        const start = f * hop;
        const end = Math.min(start + hop, audioData.length);
        let sumB = 0, sumM = 0, sumH = 0, sumE = 0;
        const count = end - start;

        for (let i = start; i < end; i++) {
            const x = audioData[i];
            const b = lpBass.processSample(x);
            const m = bpMid.processSample(x);
            const h = hpHdr.processSample(x);

            sumB += b * b;
            sumM += m * m;
            sumH += h * h;
            sumE += x * x;
        }

        const rmsB = Math.sqrt(sumB / count);
        const rmsM = Math.sqrt(sumM / count);
        const rmsH = Math.sqrt(sumH / count);
        const rmsE = Math.sqrt(sumE / count);

        bassMap[f] = rmsB; if (rmsB > maxB) maxB = rmsB;
        midMap[f] = rmsM; if (rmsM > maxM) maxM = rmsM;
        highMap[f] = rmsH; if (rmsH > maxH) maxH = rmsH;
        energyMap[f] = rmsE; if (rmsE > maxE) maxE = rmsE;
    }

    if (maxB > 1e-6) for (let i = 0; i < N; i++) bassMap[i] /= maxB;
    if (maxM > 1e-6) for (let i = 0; i < N; i++) midMap[i] /= maxM;
    if (maxH > 1e-6) for (let i = 0; i < N; i++) highMap[i] /= maxH;
    if (maxE > 1e-6) for (let i = 0; i < N; i++) energyMap[i] /= maxE;

    // Transient Onset Beat Detection
    const beats = [];
    const bw = Math.round(0.35 / hopSec);
    for (let f = bw + 1; f < N - bw; f++) {
        const v = bassMap[f];
        if (bassMap[f-1] >= v || bassMap[f+1] >= v) continue;
        let avg = 0;
        for (let k = -bw; k < bw; k++) avg += bassMap[f + k];
        avg /= (bw * 2);
        if (v > avg * 1.35 && v > 0.12) {
            beats.push({ frame: f, time: f * hopSec, strength: v });
        }
    }

    // BPM Calculation
    let estimatedBPM = 128;
    if (beats.length > 4) {
        const intervals = [];
        for (let i = 1; i < beats.length - 1; i++) {
            const dt = beats[i + 1].time - beats[i].time;
            if (dt > 0.25 && dt < 1.5) intervals.push(dt);
        }
        if (intervals.length > 2) {
            intervals.sort((a, b) => a - b);
            const med = intervals[Math.floor(intervals.length / 2)];
            estimatedBPM = Math.round(60 / med);
            while (estimatedBPM < 70) estimatedBPM *= 2;
            while (estimatedBPM > 185) estimatedBPM /= 2;
        }
    }

    return {
        bassMap,
        midMap,
        highMap,
        energyMap,
        beats,
        bpm: estimatedBPM,
        N,
        hopSec
    };
}

test('Direct audio analysis extracts valid bands, beats, and BPM without hanging', () => {
    const sampleRate = 44100;
    const duration = 5.0; // 5 seconds
    const totalSamples = Math.floor(sampleRate * duration);
    const audioData = new Float32Array(totalSamples);

    // Generate 128 BPM kick drum (every 0.46875s)
    const kickInterval = 60 / 128;
    for (let t = 0; t < duration; t += kickInterval) {
        const startIdx = Math.floor(t * sampleRate);
        const kickLen = Math.floor(0.1 * sampleRate);
        for (let i = 0; i < kickLen && (startIdx + i) < totalSamples; i++) {
            const prog = i / kickLen;
            const freq = 120 * (1 - prog * 0.7);
            audioData[startIdx + i] += Math.sin(2 * Math.PI * freq * (i / sampleRate)) * (1 - prog);
        }
    }

    const t0 = performance.now();
    const result = analyzeAudioDirect(audioData, sampleRate);
    const t1 = performance.now();

    console.log(`Analyzed 5s audio in ${(t1 - t0).toFixed(2)}ms, found ${result.beats.length} beats, BPM = ${result.bpm}`);

    assert.ok(t1 - t0 < 500, 'Analysis should complete in under 500ms');
    assert.ok(result.beats.length >= 8, 'Should detect beats from kick pulses');
    assert.ok(result.bpm >= 120 && result.bpm <= 135, 'Estimated BPM should be close to 128');
    assert.equal(result.bassMap.length, result.N);
    assert.equal(result.midMap.length, result.N);
    assert.equal(result.highMap.length, result.N);
    assert.equal(result.energyMap.length, result.N);
});
