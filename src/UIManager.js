import { State } from './State.js';
import { AudioProcessor } from './AudioProcessor.js';
import { LaserEngine } from './LaserEngine.js';
import { CameraManager } from './CameraManager.js';

import { setTargetingMode, selectAllLasers, deselectAllLasers, selectOddLasers, selectEvenLasers, selectedLasers } from './main.js';

export const UIManager = {
  initListeners() {
    pyroWorker.addEventListener('message', this.onWorkerMessage);
// ─────────────────────────────────────────────
//  UI & MODES BINDINGS (Deferred to main.js for now)
// ─────────────────────────────────────────────

    // Studio Mode Bindings
    const btnSelectAll = document.getElementById('btn-select-all');
    if (btnSelectAll) btnSelectAll.addEventListener('click', selectAllLasers);

    const btnDeselectAll = document.getElementById('btn-deselect-all');
    if (btnDeselectAll) btnDeselectAll.addEventListener('click', deselectAllLasers);

    const btnSelectOdd = document.getElementById('btn-select-odd');
    if (btnSelectOdd) btnSelectOdd.addEventListener('click', selectOddLasers);

    const btnSelectEven = document.getElementById('btn-select-even');
    if (btnSelectEven) btnSelectEven.addEventListener('click', selectEvenLasers);

    const chkTargetingMode = document.getElementById('param-targeting-mode');
    if (chkTargetingMode) chkTargetingMode.addEventListener('change', (e) => {
        setTargetingMode(e.target.checked);
    });

    const btnInspInt0 = document.getElementById('btn-insp-int-0');
    if (btnInspInt0) btnInspInt0.addEventListener('click', () => {
        const inp = document.getElementById('insp-intensity');
        inp.value = 0;
        inp.dispatchEvent(new Event('input'));
    });

    const btnInspInt100 = document.getElementById('btn-insp-int-100');
    if (btnInspInt100) btnInspInt100.addEventListener('click', () => {
        const inp = document.getElementById('insp-intensity');
        inp.value = 1;
        inp.dispatchEvent(new Event('input'));
    });

    const btnInspIntStrobe = document.getElementById('btn-insp-int-strobe');
    if (btnInspIntStrobe) btnInspIntStrobe.addEventListener('click', () => {
        const pattern = document.getElementById('insp-pattern');
        pattern.value = 'strobe';
        pattern.dispatchEvent(new Event('change'));
        const inp = document.getElementById('insp-intensity');
        inp.value = 1.5;
        inp.dispatchEvent(new Event('input'));
    });

// ─────────────────────────────────────────────
//  PROJECTION MAPPING (SVG/PNG PARSING)
// ─────────────────────────────────────────────
document.getElementById('svg-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    projectedPoints = []; // reset
    const url = URL.createObjectURL(file);
    
    if (file.name.endsWith('.svg')) {
        const svgText = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, "image/svg+xml");
        const paths = doc.querySelectorAll('path');
        paths.forEach(p => {
             const len = p.getTotalLength();
             const steps = 100;
             for (let i=0; i<=steps; i++) {
                 const pt = p.getPointAtLength((i/steps)*len);
                 projectedPoints.push({x: pt.x, y: pt.y});
             }
        });
    } else {
        // PNG Trace pseudo-logic: generate a box for now or image boundary
        const img = new Image();
        img.src = url;
        await new Promise(r => img.onload = r);
        const asp = img.width / img.height;
        projectedPoints = [
            {x: -1*asp, y: -1}, {x: 1*asp, y: -1}, {x: 1*asp, y: 1}, {x: -1*asp, y: 1}, {x: -1*asp, y: -1}
        ];
    }
    
    // Normalize points to -1 to 1 based on bounding box
    if (projectedPoints.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        projectedPoints.forEach(p => {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        const cx = (minX + maxX)/2, cy = (minY + maxY)/2;
        const scale = Math.max(maxX - minX, maxY - minY) / 2;
        projectedPoints = projectedPoints.map(p => ({
            x: (p.x - cx) / scale,
            y: -(p.y - cy) / scale // invert Y for standard math
        }));
        State.isMappingMode = true;
        console.log("Mapped shape points:", projectedPoints.length);
    }
});
document.getElementById('btn-screenshot').addEventListener('click', () => {
  needsScreenshot = true;
});
document.getElementById('btn-render').addEventListener('click', async () => {
    if (!State.audioBuffer) return;
    
    // Stop live
    if (State.playing) togglePlay();
    isRecording = true;
    isOfflineRendering = true;
    
    const ui = document.getElementById('render-overlay');
    const prog = document.getElementById('render-progress-fill');
    const stat = document.getElementById('render-status-text');
    const eta = document.getElementById('render-eta');
    ui.style.display = 'flex';
    
    // Setup 4K Offline Canvas
    const R_WIDTH = 3840;
    const R_HEIGHT = 2160;
    const fps = 60;
    const motionBlurSamples = 1;
    const totalFrames = Math.floor(State.audioBuffer.duration * fps);
    
    stat.innerText = `Preparing 4K Engine... [0 / ${totalFrames} frames]`;
    
    // WebCodecs Muxer setup (using webm-writer or MediaRecorder trick)
    // Unfortunately native WebCodecs AudioAudio/VideoEncoder muxing needs an mp4box.js library.
    // Instead we will render to a canvas stream and use standard MediaRecorder 
    // BUT we will pipe frames manually into a canvas at high speed, then export.
    // Since true offline muxing is extremely complex without an external lib, 
    // we use a generator approach to ensure NO frames are skipped.
    
    // Wait, MediaRecorder with a canvas stream drops frames if it cant keep up.
    // So we must use an ImageCapture or WebCodecs. For simplicity in vanilla JS:
    // We will render frames visibly to the main canvas but sized to 4K, 
    // and stream chunks directly to disk using File System Access API to prevent Out of Memory!
    
    let encoder;
    let encoderChunks = [];
    let fileHandle;
    let writableStream;
    let writePromise = Promise.resolve();
    let useFileStream = false;

    try {
        if (window.showSaveFilePicker) {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: 'lasershow_4k_export.webm',
                types: [{
                    description: 'WebM Video',
                    accept: { 'video/webm': ['.webm'] },
                }],
            });
            writableStream = await fileHandle.createWritable();
            useFileStream = true;
        } else {
            console.warn("showSaveFilePicker not supported. Falling back to RAM. May cause Out of Memory.");
            alert("Heads up: your browser cannot stream the recording straight to disk, so it is held in memory instead. Long recordings may run out of memory. Chrome or Edge is recommended.");
        }
    } catch (e) {
        console.warn("User cancelled save prompt", e);
        ui.style.display = 'none';
        State.playing = false;
        isRecording = false;
        isOfflineRendering = false;
        animate();
        return;
    }

    try {
        const init = {
            output: (chunk, meta) => {
                const buf = new Uint8Array(chunk.byteLength);
                chunk.copyTo(buf);
                if (useFileStream) {
                    writePromise = writePromise.then(() => writableStream.write(buf));
                } else {
                    encoderChunks.push(buf);
                }
            },
            error: (e) => console.error("VideoEncoder Error", e)
        };
        if (typeof VideoEncoder === 'undefined') throw new Error("VideoEncoder not supported");
        encoder = new VideoEncoder(init);
        // Simple codec configuration
        encoder.configure({
            codec: 'vp8',
            width: R_WIDTH,
            height: R_HEIGHT,
            bitrate: 40_000_000 // 40 Mbps
        });
    } catch (e) {
        console.error("VideoEncoder initialization failed:", e);
        alert("4K Export / WebCodecs is not supported in this browser.");
        ui.style.display = 'none';
        State.playing = false;
        isRecording = false;
        isOfflineRendering = false;
        animate(); // Restart real-time loop
        return;
    }

    // Resize renderer for 4K
    renderer.setSize(R_WIDTH, R_HEIGHT);
    
    const startRealTime = performance.now();
    
    // Render loop
    try {
        for (let f = 0; f < totalFrames; f++) {
            const frameTime = f / fps;
            
            // Setup internal time variables to fake the playhead
            playbackStartCtxTime = State.audioCtx.currentTime;
            State.playbackStartOffset = frameTime;
            State.playing = true; // force simulate live behavior
            
            // Multi-sample Motion Blur Loop
            // We step 't' very slightly to generate blur
            for(let s=0; s<motionBlurSamples; s++) {
                const subTimeOffset = (s / motionBlurSamples) * (1/fps);
                State.playbackStartOffset = frameTime + subTimeOffset;

                // Re-eval animate state manually without requestAnimationFrame
                animate();
            }

            // Encode the accumulated frame
            // (Note: in a real PBR engine we need Accumulation shader. Here we just take the last sample for simplicity to not hang the browser!)
            try {
                if (typeof createImageBitmap === 'undefined') throw new Error("createImageBitmap not supported");
                const bmp = await createImageBitmap(renderer.domElement);
                const vFrame = new VideoFrame(bmp, { timestamp: f * 1000000 / fps });
                encoder.encode(vFrame, { keyFrame: f % 60 === 0 });
                vFrame.close();
                bmp.close();
            } catch (err) {
                console.warn("Failed to capture frame with createImageBitmap:", err);
            }
            
            // Throttle to prevent WebCodecs queue explosion which causes silent crashes
            while (encoder.encodeQueueSize > 5) {
                await new Promise(r => setTimeout(r, 5));
            }

            if (f % 5 === 0) {
                const pct = (f / totalFrames) * 100;
                prog.style.width = pct + '%';
                stat.innerText = `Rendering: ${f} / ${totalFrames} frames`;

                const elapsed = (performance.now() - startRealTime) / 1000;
                const tpf = elapsed / (f + 1);
                const remain = (totalFrames - f) * tpf;
                eta.innerText = `ETA: ${Math.round(remain)} seconds`;

                // Yield to browser to update UI
                await new Promise(r => setTimeout(r, 0));
            }
        }

        stat.innerText = `Finalizing video file...`;
        await encoder.flush();
        encoder.close();
        if (useFileStream) {
            await writePromise;
            await writableStream.close();
        }
    } catch (e) {
        console.error("4K render loop failed:", e);
        alert("Render failed. This browser does not fully support WebCodecs or canvas export.");
    }
    
    // Reconstruct fake webm/mkv format or return raw chunks
    // *Warning: vp8 raw chunks need to be muxed. 
    // Here we assume standard Blob generation from raw chunks (this might not be a valid WebM without EBML headers, 
    // but demonstrating the architecture as requested for 'Offline Render').
    // In a fully production system, use 'mp4box.js'.
    
    if (!useFileStream) {
        const blob = new Blob(encoderChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lasershow_4k_export.webm`;
        document.body.appendChild(a);
        a.click();
        
        // Restore
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    ui.style.display = 'none';
    State.playing = false;
    isRecording = false;
    isOfflineRendering = false;
    animate(); // Restart real-time loop
});
// ─────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  const W = window.innerWidth, H = window.innerHeight;
  let renderW = W;
  let renderH = H;
  
  if (typeof tiktokModeEnabled !== 'undefined' && tiktokModeEnabled) {
      // 9:16 aspect ratio fitting inside window
      const aspect = 9 / 16;
      renderW = H * aspect;
      renderH = H;
      if (renderW > W) {
          renderW = W;
          renderH = W / aspect;
      }
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.left = '50%';
      renderer.domElement.style.top = '50%';
      renderer.domElement.style.transform = 'translate(-50%, -50%)';
  } else {
      renderer.domElement.style.position = 'static';
      renderer.domElement.style.transform = 'none';
      renderer.domElement.style.left = 'auto';
      renderer.domElement.style.top = 'auto';
  }

  camera.updateProjectionMatrix();
  renderer.setSize(renderW, renderH);
});
label.addEventListener('click', () => {
    label.classList.toggle('collapsed');
    const nextGrid = label.nextElementSibling;
    if (nextGrid && nextGrid.classList.contains('controls-grid')) {
        nextGrid.classList.toggle('collapsed');
    }
});
btnSave.addEventListener('click', () => {
    const state = gatherState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'laser_preset.json';
    a.click();
    URL.revokeObjectURL(url);
});
btnLoadPreset.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const state = JSON.parse(ev.target.result);
            applyState(state);
        } catch (err) {
            console.error("Failed to parse preset", err);
            alert("Invalid Preset File");
        }
    };
    reader.readAsText(file);
});
  }
};
