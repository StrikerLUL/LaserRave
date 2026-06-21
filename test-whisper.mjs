import { pipeline, env } from '@huggingface/transformers';

async function test() {
    console.log("Loading model...");
    try {
        const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
        console.log("Model loaded successfully!");
        
        // Mock 1 second of silence at 16kHz
        const audio = new Float32Array(16000);
        console.log("Transcribing...");
        const result = await transcriber(audio, { return_timestamps: true });
        console.log("Result:", result);
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
