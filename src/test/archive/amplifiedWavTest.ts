import { FeskDecoder } from '../feskDecoder';
import { WavReader } from '../utils/wavReader';
import { AudioSample } from '../types';
import { DEFAULT_CONFIG } from '../config';

async function amplifiedWavTest() {
    console.log('🔊 Testing with Signal Amplification');
    console.log('====================================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk1.wav';
        const audioData = await WavReader.readWavFile(wavPath);
        
        console.log(`📄 Original signal:`);
        console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
        console.log(`   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)} seconds`);
        
        // Calculate RMS of original signal
        let originalRms = 0;
        const testSamples = Math.min(10000, audioData.data.length);
        for (let i = 0; i < testSamples; i++) {
            originalRms += audioData.data[i] * audioData.data[i];
        }
        originalRms = Math.sqrt(originalRms / testSamples);
        console.log(`   Original RMS: ${originalRms.toFixed(6)}`);
        
        // Try different amplification levels
        const amplificationLevels = [100, 1000, 10000];
        
        for (const amp of amplificationLevels) {
            console.log(`\\n🎚️  Testing with ${amp}x amplification:`);
            
            // Create amplified copy
            const amplifiedData = new Float32Array(audioData.data.length);
            for (let i = 0; i < audioData.data.length; i++) {
                amplifiedData[i] = audioData.data[i] * amp;
            }
            
            // Calculate new RMS
            let newRms = 0;
            for (let i = 0; i < testSamples; i++) {
                newRms += amplifiedData[i] * amplifiedData[i];
            }
            newRms = Math.sqrt(newRms / testSamples);
            console.log(`   Amplified RMS: ${newRms.toFixed(6)}`);
            
            // Check for clipping
            const maxAmp = Math.max(...Array.from(amplifiedData.slice(0, testSamples)));
            const minAmp = Math.min(...Array.from(amplifiedData.slice(0, testSamples)));
            console.log(`   Peak range: ${minAmp.toFixed(6)} to ${maxAmp.toFixed(6)}`);
            
            if (maxAmp > 1.0 || minAmp < -1.0) {
                console.log(`   ⚠️  Signal clipped - too much amplification`);
                continue;
            }
            
            // Test with decoder
            const config = {
                ...DEFAULT_CONFIG,
                sampleRate: audioData.sampleRate
            };
            
            const decoder = new FeskDecoder(config);
            
            // Process in chunks
            const chunkSize = Math.floor(audioData.sampleRate * 0.1); // 100ms chunks
            let frame = null;
            
            for (let i = 0; i < Math.min(amplifiedData.length, audioData.sampleRate * 5); i += chunkSize) {
                const endIndex = Math.min(i + chunkSize, amplifiedData.length);
                const chunk = amplifiedData.slice(i, endIndex);
                
                const audioSample: AudioSample = {
                    data: new Float32Array(chunk),
                    sampleRate: audioData.sampleRate,
                    timestamp: i / audioData.sampleRate
                };
                
                const result = decoder.processAudio(audioSample);
                if (result) {
                    frame = result;
                    console.log(`   🎉 Frame decoded at ${audioSample.timestamp.toFixed(2)}s!`);
                    break;
                }
            }
            
            if (frame) {
                const message = new TextDecoder().decode(frame.payload);
                console.log(`   ✅ SUCCESS: "${message}" (CRC: ${frame.isValid ? 'valid' : 'invalid'})`);
                return; // Stop testing other amplification levels
            } else {
                const state = decoder.getState();
                console.log(`   ❌ No frame decoded (final phase: ${state.phase})`);
            }
        }
        
        console.log('\\n❌ No successful decoding with any amplification level');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

if (require.main === module) {
    amplifiedWavTest().catch(console.error);
}

export { amplifiedWavTest };