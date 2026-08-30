import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';

// ---------------------------------------------------------------------------
// These tests exercise the REAL src/MIDIController.js. They previously carried a
// private copy of the implementation and asserted against that copy, which meant
// they stayed green no matter what the shipped module did.
// ---------------------------------------------------------------------------
import {
    MIDI_CONFIG,
    parseMIDIMessage,
    dispatchMIDIEvent,
    MIDIManager
} from '../src/MIDIController.js';

// ---------------------------------------------------------------------------
// TEST SUITE: R7 Web MIDI Controller Integration
// ---------------------------------------------------------------------------

describe('R7: Web MIDI Controller Integration', () => {
    let mockStorage;

    beforeEach(() => {
        const store = {};
        mockStorage = {
            getItem: (k) => store[k] ?? null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        };
    });

    describe('Tier 1: Feature Coverage', () => {
        test('parseMIDIMessage decodes CC, NoteOn, NoteOff, and PitchBend correctly', () => {
            // CC 7 value 127 on channel 0
            const cc = parseMIDIMessage(new Uint8Array([0xB0, 7, 127]));
            assert.strictEqual(cc.type, 'cc');
            assert.strictEqual(cc.number, 7);
            assert.strictEqual(cc.value, 127);
            assert.strictEqual(cc.normalized, 1.0);

            // Note On Note 36 Vel 100 on channel 1 (0x91)
            const noteOn = parseMIDIMessage(new Uint8Array([0x91, 36, 100]));
            assert.strictEqual(noteOn.type, 'noteon');
            assert.strictEqual(noteOn.number, 36);
            assert.strictEqual(noteOn.channel, 1);
            assert.strictEqual(noteOn.velocity, 100);

            // Pitch bend center (LSB 0, MSB 64)
            const pb = parseMIDIMessage(new Uint8Array([0xE0, 0, 64]));
            assert.strictEqual(pb.type, 'pitchbend');
            assert.strictEqual(pb.raw, 8192);
            assert.strictEqual(pb.normalized, 0.0);
        });

        test('dispatchDefaultMIDI updates CFG for CC 1 (Intensity), CC 7 (Haze), CC 10 (Spread)', () => {
            const cfg = { intensity: 1.0, hazeDensity: 0.5, spread: 1.2 };
            const state = {};
            const manager = new MIDIManager();

            // CC 1 max (value 127 -> 2.0)
            manager.handleIncomingMessage(new Uint8Array([0xB0, 1, 127]), state, cfg);
            assert.strictEqual(cfg.intensity, 2.0);

            // CC 7 half (value 64 -> ~0.50)
            manager.handleIncomingMessage(new Uint8Array([0xB0, 7, 64]), state, cfg);
            assert.ok(Math.abs(cfg.hazeDensity - (64 / 127)) < 1e-4);

            // CC 10 min (value 0 -> 0.2 spread)
            manager.handleIncomingMessage(new Uint8Array([0xB0, 10, 0]), state, cfg);
            assert.strictEqual(cfg.spread, 0.2);
        });

        test('dispatchDefaultMIDI handles Note triggers (Note 36 Drop, Note 38 CO2)', () => {
            const state = { triggers: { dropTrigger: 0, co2Fire: 0 } };
            const cfg = {};
            const manager = new MIDIManager();

            // Note 36 (Drop)
            manager.handleIncomingMessage(new Uint8Array([0x90, 36, 127]), state, cfg);
            assert.strictEqual(state.triggers.dropTrigger, 1);

            // Note 38 (CO2)
            manager.handleIncomingMessage(new Uint8Array([0x90, 38, 127]), state, cfg);
            assert.strictEqual(state.triggers.co2Fire, 1);
        });

        test('dispatchDefaultMIDI toggles Auto-Cam on Note 40', () => {
            const state = { autoCamToggle: false };
            const cfg = {};
            const manager = new MIDIManager();

            manager.handleIncomingMessage(new Uint8Array([0x90, 40, 100]), state, cfg);
            assert.strictEqual(state.autoCamToggle, true);

            manager.handleIncomingMessage(new Uint8Array([0x90, 40, 100]), state, cfg);
            assert.strictEqual(state.autoCamToggle, false);
        });

        test('MIDILearnManager learns new CC mapping and updates target parameter', () => {
            const manager = new MIDIManager(mockStorage);
            const cfg = { intensity: 1.0 };
            const state = {};

            // Start learn for intensity
            manager.startLearn('intensity');
            assert.strictEqual(manager.isLearning, true);

            // Send CC 25 (custom knob)
            const result = manager.handleIncomingMessage(new Uint8Array([0xB0, 25, 64]), state, cfg);
            assert.strictEqual(result.action, 'learned');
            assert.strictEqual(manager.isLearning, false);
            assert.strictEqual(manager.mappings.intensity.number, 25);

            // Verify subsequent CC 25 messages update intensity
            manager.handleIncomingMessage(new Uint8Array([0xB0, 25, 127]), state, cfg);
            assert.strictEqual(cfg.intensity, 2.0);
        });
    });

    describe('Tier 2: Boundary & Corner Cases', () => {
        test('Note On with velocity 0 is decoded as Note Off', () => {
            const res = parseMIDIMessage(new Uint8Array([0x90, 36, 0]));
            assert.strictEqual(res.type, 'noteoff');
            assert.strictEqual(res.velocity, 0);
            assert.strictEqual(res.normalized, 0);
        });

        test('Pitch bend bounds check (-1.0 at min 0, +1.0 at max 16383)', () => {
            const minPB = parseMIDIMessage(new Uint8Array([0xE0, 0, 0]));
            assert.strictEqual(minPB.normalized, -1.0);

            const maxPB = parseMIDIMessage(new Uint8Array([0xE0, 127, 127]));
            assert.ok(maxPB.normalized > 0.999 && maxPB.normalized <= 1.0);
        });

        test('parseMIDIMessage handles invalid, empty, or short byte arrays without throwing', () => {
            assert.strictEqual(parseMIDIMessage(null), null);
            assert.strictEqual(parseMIDIMessage(new Uint8Array([])), null);
            assert.strictEqual(parseMIDIMessage(new Uint8Array([0xB0])), null);
        });

        test('loadFromStorage handles corrupted JSON safely by resetting to default mappings', () => {
            mockStorage.setItem(MIDI_CONFIG.storageKey, '{ corrupt json');
            const manager = new MIDIManager(mockStorage);
            const loaded = manager.loadFromStorage();

            assert.strictEqual(loaded, false);
            assert.strictEqual(manager.mappings.intensity.number, 1);
            assert.strictEqual(manager.mappings.hazeDensity.number, 7);
        });

        test('Messages across all 16 MIDI channels (0x0 to 0xF) are recognized', () => {
            for (let ch = 0; ch < 16; ch++) {
                const status = 0xB0 | ch;
                const parsed = parseMIDIMessage(new Uint8Array([status, 1, 64]));
                assert.strictEqual(parsed.type, 'cc');
                assert.strictEqual(parsed.channel, ch);
            }
        });
    });

    describe('Tier 3: Pairwise & Storage Persistence', () => {
        test('Learned MIDI mappings persist across manager re-instantiation via localStorage', () => {
            const mgr1 = new MIDIManager(mockStorage);
            mgr1.startLearn('spread');
            mgr1.handleIncomingMessage(new Uint8Array([0xB0, 88, 100])); // Map spread to CC 88

            // Re-instantiate manager 2 reading from storage
            const mgr2 = new MIDIManager(mockStorage);
            mgr2.loadFromStorage();
            assert.strictEqual(mgr2.mappings.spread.number, 88);

            const cfg = { spread: 1.0 };
            mgr2.handleIncomingMessage(new Uint8Array([0xB0, 88, 127]), {}, cfg);
            assert.strictEqual(cfg.spread, 3.0);
        });
    });
});

// ---------------------------------------------------------------------------
// Regression tests for defects found in the shipped MIDIController.
// ---------------------------------------------------------------------------
describe('R7: Regression — hotplug rebinding & idempotent access', () => {

    /**
     * navigator is a getter-only global in modern Node, so it has to be replaced
     * via defineProperty rather than plain assignment.
     */
    function stubNavigator(value) {
        const had = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
        const original = had ? Object.getOwnPropertyDescriptor(globalThis, 'navigator') : null;
        Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
        return () => {
            if (original) Object.defineProperty(globalThis, 'navigator', original);
            else delete globalThis.navigator;
        };
    }

    /** Minimal MIDIAccess stand-in whose inputs can be swapped like real hotplug. */
    function makeFakeAccess(inputNames = ['Launchpad']) {
        const inputs = new Map();
        inputNames.forEach((name, i) => {
            inputs.set(String(i), { id: String(i), name, manufacturer: 'Test', state: 'connected', onmidimessage: null });
        });
        return { inputs, outputs: new Map(), onstatechange: null };
    }

    test('setupInputs re-binding after a device hotplug keeps CFG and callbacks wired', () => {
        const mgr = new MIDIManager(null);
        const cfg = { intensity: 0 };
        let seen = null;
        mgr.setMessageContext({ state: { triggers: {} }, cfg, callbacks: { intensity: (v) => { seen = v; } } });

        mgr.midiAccess = makeFakeAccess(['Launchpad']);
        mgr.setupInputs();

        // CC 1 at full value -> intensity mapped to max 2.0
        const firstInput = mgr.midiAccess.inputs.get('0');
        firstInput.onmidimessage({ data: [0xB0, 1, 127] });
        assert.equal(seen, 2.0, 'callback must fire on the initially bound input');
        assert.equal(cfg.intensity, 2.0, 'CFG must be updated on the initially bound input');

        // Simulate a device being plugged in: setupInputs() runs again and rebinds
        // every handler. This is exactly where the old code dropped the wiring.
        seen = null;
        cfg.intensity = 0;
        mgr.midiAccess = makeFakeAccess(['Launchpad', 'Keystation']);
        mgr.setupInputs();

        mgr.midiAccess.inputs.get('1').onmidimessage({ data: [0xB0, 1, 127] });
        assert.equal(seen, 2.0, 'callback must still fire after a hotplug rebind');
        assert.equal(cfg.intensity, 2.0, 'CFG must still be updated after a hotplug rebind');
    });

    test('initMIDIAccess requests access only once even when called concurrently', async () => {
        const mgr = new MIDIManager(null);
        let calls = 0;
        const restore = stubNavigator({
            requestMIDIAccess: async () => { calls++; return makeFakeAccess([]); }
        });
        try {
            await Promise.all([mgr.initMIDIAccess(), mgr.initMIDIAccess()]);
            await mgr.initMIDIAccess();
            assert.equal(calls, 1, 'a second call must reuse the first promise, not re-prompt');
        } finally {
            restore();
        }
    });

    test('a failed initMIDIAccess can be retried after the user grants permission', async () => {
        const mgr = new MIDIManager(null);
        let calls = 0;
        const restore = stubNavigator({
            requestMIDIAccess: async () => {
                calls++;
                if (calls === 1) throw new Error('NotAllowedError: permission denied');
                return makeFakeAccess(['Launchpad']);
            }
        });
        try {
            assert.equal(await mgr.initMIDIAccess(), false, 'first attempt is denied');
            assert.equal(await mgr.initMIDIAccess(), true, 'retry after granting succeeds');
            assert.equal(calls, 2);
        } finally {
            restore();
        }
    });
});
