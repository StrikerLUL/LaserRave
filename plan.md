1. *Fix `decodeAudioData` compatibility in `src/main.js`.*
   - Modify the `audioCtx.decodeAudioData(ab)` call in `loadAudio` to use a custom Promise wrapper that handles both standard Promise returns and legacy callback signatures.
2. *Fix `VideoEncoder` and `createImageBitmap` initialization in `src/main.js`.*
   - In `src/main.js` where `VideoEncoder` is initialized around line 7289, add `if (typeof VideoEncoder === 'undefined') { throw new Error("VideoEncoder not supported"); }` before attempting to initialize `VideoEncoder`.
   - For `createImageBitmap`, add `if (typeof createImageBitmap === 'undefined') { throw new Error("createImageBitmap not supported"); }` in the render loop around line 7336 to prevent calling an undefined function, wrapped in `try/catch`.
3. *Fix WebGPURenderer and animate() fallback logic in `src/main.js`.*
   - Update the `catch (webglErr)` block around line 204 in `src/main.js` to assign a plain mock object to `renderer` (with dummy methods like `render: () => {}`, `setSize: () => {}`, `setPixelRatio: () => {}`, `domElement: document.createElement('canvas')`) instead of throwing an error to prevent crashes.
   - Wrap all `renderer.render(scene, camera)` calls within the `animate()` function in a `try/catch` block.
4. *Fix audio fallback logic in `src/main.js`.*
   - Update the fallback logic in `loadAudio()` and `togglePlay()` in `src/main.js` to use `window.OfflineAudioContext || window.webkitOfflineAudioContext` instead of standard `AudioContext` to create proper `AudioBuffer` mock instances and avoid quota exceeded errors.
5. *Verify changes syntax.*
   - Run `node -c src/main.js` to verify the JavaScript syntax of the modified file.
6. *Run test suite.*
   - Run the automated test suite using `node --test tests/*.test.js` to ensure the changes are correct and no regressions were introduced.
7. *Complete pre commit steps*
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
8. *Submit the change.*
   - Once verified, submit the change with a descriptive commit message in German.
