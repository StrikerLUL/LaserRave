1. **Zusammenfassung**
   Das Ziel ist es, sicherzustellen, dass Web Audio API und Three.js Aufrufe in try/catch eingebettet sind und Graceful Fallbacks existieren, insbesondere beim WebGPU-Init und beim Laden von Audio-Dateien (VideoEncoder, createImageBitmap etc. sind in memory/prompt erwähnt).

2. **Überprüfung und Anpassungen in src/main.js**
   - **VideoEncoder / createImageBitmap**: Ich sehe, dass in `src/main.js` ab Zeile 7374 `encoder = new VideoEncoder(init)` und ab 7421 `createImageBitmap(renderer.domElement)` bereits in `try/catch` Blöcken liegen, aber ich füge noch `typeof VideoEncoder === 'undefined'` und `typeof createImageBitmap === 'undefined'` Checks hinzu (Memory erwähnt das explizit).
   - **WebGPU-Init**: Die Instanziierung des `WebGPURenderers` passiert bereits in einem `try/catch` mit Fallback auf `WebGLRenderer` und bei einem Fehler auf ein Dummy-Renderer-Objekt (z.B. in `src/main.js` Zeile 183 und in `initRenderer`). Das Dummy-Objekt verwendet allerdings teilweise `THREE.NoToneMapping`. Um den Memory-Hinweis (ReferenceError auf THREE.NoToneMapping vermeiden, 0 verwenden) zu befolgen, werde ich `THREE.NoToneMapping` bei Dummy-Objekten durch `0` ersetzen und auch andere Methoden sicherstellen.
   - **Audio-Context-Fallback**: In `initAudioContext` und `loadAudio` gibt es bereits `try/catch`-Blöcke, aber nach Memory soll bei `loadAudio` ein fehlendes Audio-File nicht crashen, sondern einen stummen Dummy-Buffer generieren (`OfflineAudioContext` verwenden, um Limit-Probleme zu vermeiden).

3. **Schritte**
   - **Schritt 1**: In `src/main.js` (OfflineRender/4K Export), vor der `new VideoEncoder(init)` Instanziierung, die explizite Prüfung `if (typeof VideoEncoder === 'undefined') throw new Error("VideoEncoder not supported");` einfügen.
   - **Schritt 2**: In `src/main.js` (OfflineRender/4K Export), vor `createImageBitmap`, die explizite Prüfung `if (typeof createImageBitmap === 'undefined') throw new Error("createImageBitmap not supported");` einfügen.
   - **Schritt 3**: In `src/main.js`, beim Fallback-Mock-Renderer (`renderer = { ... toneMapping: THREE.NoToneMapping ... }`), das `THREE.NoToneMapping` durch `0` ersetzen, wie vom System-Prompt gefordert. Ebenso in `initRenderer()`.
   - **Schritt 4**: In `src/main.js`, in `loadAudio(file)`, den Guard `if (!file) { throw new Error("No audio file provided."); }` durch eine Logik ersetzen, die einen stillen Fallback-Audio-Buffer mit `OfflineAudioContext(1, 44100 * 10, 44100)` erzeugt und das Werfen des Errors vermeidet.
   - **Schritt 5**: In `src/AudioProcessor.js`, die `AudioContext` Initialisierung robuster machen und `window.OfflineAudioContext` für Fallbacks (mit 3 Parametern) verwenden.
   - **Schritt 6**: Verifikation mit Puppeteer-Test.
   - **Schritt 7**: Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
   - **Schritt 8**: Commit.
