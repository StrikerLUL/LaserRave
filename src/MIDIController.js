// ---------------------------------------------------------------------------
// Web MIDI Controller Integration Module
// Handles Web MIDI API access, input enumeration, message dispatch,
// MIDI Learn, value scaling, and localStorage persistence.
// ---------------------------------------------------------------------------

export const MIDI_CONFIG = {
    storageKey: 'laserrave_midi_map',
    defaultMappings: {
        intensity: { type: 'cc', number: 1, label: 'Laser Intensity (CC 1)', mode: 'continuous', min: 0.0, max: 2.0 },
        hazeDensity: { type: 'cc', number: 7, label: 'Haze Density (CC 7)', mode: 'continuous', min: 0.0, max: 1.0 },
        spread: { type: 'cc', number: 10, label: 'Laser Spread (CC 10)', mode: 'continuous', min: 0.2, max: 3.0 },
        speed: { type: 'cc', number: 11, label: 'Laser Speed (CC 11)', mode: 'continuous', min: 0.1, max: 3.0 },
        bloom: { type: 'cc', number: 74, label: 'Bloom Strength (CC 74)', mode: 'continuous', min: 0.0, max: 2.0 },
        dropTrigger: { type: 'note', number: 36, label: 'Manual Drop (Note 36)', mode: 'trigger' },
        co2Fire: { type: 'note', number: 38, label: 'Fire CO2 Jet (Note 38)', mode: 'trigger' },
        autoCamToggle: { type: 'note', number: 40, label: 'Toggle Auto-Cam (Note 40)', mode: 'toggle' },
        themeCycle: { type: 'note', number: 42, label: 'Cycle Theme (Note 42)', mode: 'trigger' },
        cameraPan: { type: 'pitchbend', number: 0, label: 'Camera Orbit Pan (Pitch Bend)', mode: 'bipolar', min: -1.0, max: 1.0 }
    }
};

/**
 * Parses raw MIDI byte array into structured event object.
 */
export function parseMIDIMessage(data) {
    if (!data || data.length < 2) return null;

    const status = data[0];
    const messageType = status & 0xF0;
    const channel = status & 0x0F;

    if (messageType === 0x90) { // Note On
        const note = data[1];
        const velocity = data[2] ?? 0;
        if (velocity === 0) {
            // Note on with 0 velocity is functionally Note Off
            return { type: 'noteoff', channel, number: note, velocity: 0, normalized: 0 };
        }
        return {
            type: 'noteon',
            channel,
            number: note,
            velocity,
            normalized: velocity / 127
        };
    }

    if (messageType === 0x80) { // Note Off
        const note = data[1];
        const velocity = data[2] ?? 0;
        return { type: 'noteoff', channel, number: note, velocity, normalized: 0 };
    }

    if (messageType === 0xB0) { // Control Change (CC)
        const ccNumber = data[1];
        const value = data[2] ?? 0;
        return {
            type: 'cc',
            channel,
            number: ccNumber,
            value,
            normalized: value / 127
        };
    }

    if (messageType === 0xE0) { // Pitch Bend
        const lsb = data[1] ?? 0;
        const msb = data[2] ?? 64;
        const raw = (msb << 7) | lsb; // 14-bit [0, 16383]
        // Center is 8192 -> 0.0, range is [-1.0, +1.0]
        const normalized = (raw - 8192) / 8192;
        return {
            type: 'pitchbend',
            channel,
            number: 0,
            raw,
            normalized: Math.max(-1.0, Math.min(1.0, normalized))
        };
    }

    return null;
}

/**
 * Dispatches parsed MIDI event to state targets according to mapping matrix.
 */
export function dispatchMIDIEvent(event, mappings, targetState = {}, targetCFG = {}, callbacks = {}) {
    if (!event || !mappings) return null;

    for (const [paramKey, mapping] of Object.entries(mappings)) {
        let isMatch = false;

        if (mapping.type === 'cc' && event.type === 'cc' && mapping.number === event.number) {
            isMatch = true;
        } else if (mapping.type === 'note' && event.type === 'noteon' && mapping.number === event.number) {
            isMatch = true;
        } else if (mapping.type === 'pitchbend' && event.type === 'pitchbend') {
            isMatch = true;
        }

        if (isMatch) {
            if (mapping.mode === 'continuous') {
                const min = mapping.min ?? 0.0;
                const max = mapping.max ?? 1.0;
                const scaled = min + event.normalized * (max - min);
                if (targetCFG && paramKey in targetCFG) targetCFG[paramKey] = scaled;
                if (targetState && paramKey in targetState) targetState[paramKey] = scaled;
                if (callbacks && typeof callbacks[paramKey] === 'function') callbacks[paramKey](scaled);
                return { target: paramKey, value: scaled, mode: 'continuous' };
            }

            if (mapping.mode === 'bipolar') {
                const scaled = event.normalized; // [-1.0, +1.0]
                if (targetState && paramKey in targetState) targetState[paramKey] = scaled;
                if (callbacks && typeof callbacks[paramKey] === 'function') callbacks[paramKey](scaled);
                return { target: paramKey, value: scaled, mode: 'bipolar' };
            }

            if (mapping.mode === 'toggle') {
                if (targetState && paramKey in targetState) {
                    targetState[paramKey] = !targetState[paramKey];
                }
                if (callbacks && typeof callbacks[paramKey] === 'function') {
                    callbacks[paramKey](targetState ? targetState[paramKey] : true);
                }
                return { target: paramKey, value: targetState ? targetState[paramKey] : true, mode: 'toggle' };
            }

            if (mapping.mode === 'trigger') {
                if (targetState && targetState.triggers) {
                    targetState.triggers[paramKey] = (targetState.triggers[paramKey] || 0) + 1;
                }
                if (callbacks && typeof callbacks[paramKey] === 'function') {
                    callbacks[paramKey]();
                }
                return { target: paramKey, value: true, mode: 'trigger' };
            }
        }
    }
    return null;
}

/**
 * Controller mapping manager supporting MIDI Learn and persistence.
 */
export class MIDIManager {
    constructor(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
        this.storage = storage;
        this.mappings = JSON.parse(JSON.stringify(MIDI_CONFIG.defaultMappings));
        this.isLearning = false;
        this.learningTarget = null;
        this.midiAccess = null;
        this.inputs = [];
        this.isConnected = false;
        this.onStateChangeCallbacks = [];
        this.onMessageCallbacks = [];
        this.recentValues = {};
        // Dispatch context used by the input handlers. setupInputs() re-binds every
        // input on device hotplug, so the CFG/callback wiring has to live here —
        // patching input.onmidimessage from outside gets silently clobbered on the
        // next statechange event.
        this.messageContext = { state: { triggers: {} }, cfg: {}, callbacks: {} };
        this._initPromise = null;
    }

    /**
     * Supplies the live CFG object and action callbacks that incoming MIDI should
     * drive. Safe to call before or after initMIDIAccess().
     */
    setMessageContext({ state, cfg, callbacks } = {}) {
        if (state) this.messageContext.state = state;
        if (cfg) this.messageContext.cfg = cfg;
        if (callbacks) this.messageContext.callbacks = callbacks;
    }

    async initMIDIAccess() {
        if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
            console.warn('[MIDI] Web MIDI API not supported in this browser.');
            return false;
        }
        // Requesting access twice triggers a second permission prompt and races the
        // first call's setup. Hand back the in-flight/settled promise instead.
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInitMIDIAccess();
        return this._initPromise;
    }

    async _doInitMIDIAccess() {
        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            this.isConnected = this.midiAccess.inputs.size > 0;
            this.loadFromStorage();
            this.setupInputs();

            this.midiAccess.onstatechange = (e) => {
                this.setupInputs();
                this.notifyStateChange();
            };

            this.notifyStateChange();
            return true;
        } catch (err) {
            console.warn('[MIDI] Failed to access MIDI devices:', err);
            this._initPromise = null; // allow a retry once the user grants permission
            return false;
        }
    }

    setupInputs() {
        if (!this.midiAccess) return;
        this.inputs = [];
        this.midiAccess.inputs.forEach((input) => {
            this.inputs.push({
                id: input.id,
                name: input.name || 'MIDI Device',
                manufacturer: input.manufacturer || 'Generic',
                state: input.state
            });

            input.onmidimessage = (e) => {
                const ctx = this.messageContext;
                this.handleRawMessage(e.data, ctx.state, ctx.cfg, ctx.callbacks);
            };
        });
        this.isConnected = this.inputs.length > 0;
    }

    handleRawMessage(data, targetState = {}, targetCFG = {}, callbacks = {}) {
        const event = parseMIDIMessage(data);
        if (!event) return null;

        // Track recent value for UI feedback
        if (event.type === 'cc' || event.type === 'pitchbend' || event.type === 'noteon') {
            this.recentValues[event.number] = event.normalized;
        }

        if (this.isLearning && this.learningTarget) {
            const target = this.learningTarget;
            const currentDef = this.mappings[target] || { mode: 'continuous' };

            this.mappings[target] = {
                type: event.type === 'noteon' ? 'note' : event.type,
                number: event.number,
                label: `${target} (${event.type.toUpperCase()} ${event.number})`,
                mode: currentDef.mode,
                min: currentDef.min,
                max: currentDef.max
            };

            this.isLearning = false;
            this.learningTarget = null;
            this.saveToStorage();
            this.notifyMessage({ action: 'learned', target, mapping: this.mappings[target] });
            return { action: 'learned', target, mapping: this.mappings[target] };
        }

        const res = dispatchMIDIEvent(event, this.mappings, targetState, targetCFG, callbacks);
        if (res) {
            this.notifyMessage(res);
        }
        return res;
    }

    handleIncomingMessage(data, targetState = {}, targetCFG = {}, callbacks = {}) {
        return this.handleRawMessage(data, targetState, targetCFG, callbacks);
    }

    startLearn(paramKey) {
        this.isLearning = true;
        this.learningTarget = paramKey;
        this.notifyStateChange();
    }

    cancelLearn() {
        this.isLearning = false;
        this.learningTarget = null;
        this.notifyStateChange();
    }

    saveToStorage() {
        if (this.storage && typeof this.storage.setItem === 'function') {
            this.storage.setItem(MIDI_CONFIG.storageKey, JSON.stringify(this.mappings));
        }
    }

    loadFromStorage() {
        if (this.storage && typeof this.storage.getItem === 'function') {
            const raw = this.storage.getItem(MIDI_CONFIG.storageKey);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        this.mappings = { ...MIDI_CONFIG.defaultMappings, ...parsed };
                        return true;
                    }
                } catch {
                    // Fallback to default
                }
            }
        }
        this.mappings = JSON.parse(JSON.stringify(MIDI_CONFIG.defaultMappings));
        return false;
    }

    onStateChange(cb) {
        this.onStateChangeCallbacks.push(cb);
    }

    onMessage(cb) {
        this.onMessageCallbacks.push(cb);
    }

    notifyStateChange() {
        for (const cb of this.onStateChangeCallbacks) {
            try { cb(this); } catch (e) { console.error(e); }
        }
    }

    notifyMessage(msg) {
        for (const cb of this.onMessageCallbacks) {
            try { cb(msg); } catch (e) { console.error(e); }
        }
    }
}
