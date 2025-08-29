import { FeskDecoder } from '../feskDecoder';
import { WavReader } from '../utils/wavReader';
import { AudioSample } from '../types';
import { DEFAULT_CONFIG } from '../config';

async function singleChunkFesk2() {
    console.log('🔄 Testing fesk2.wav with Large Chunks');
    console.log('======================================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk2.wav';
        const audioData = await WavReader.readWavFile(wavPath);
        
        console.log(`📄 File info:`);
        console.log(`   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)}s`);
        console.log(`   Samples: ${audioData.data.length}`);

        // Check if signal level improved
        const rms = Math.sqrt(audioData.data.slice(0, 10000).reduce((sum, s) => sum + s*s, 0) / 10000);
        console.log(`   RMS: ${rms.toFixed(6)} (${rms > 0.01 ? 'Good' : rms > 0.001 ? 'Moderate' : 'Quiet'})`);

        const amplification = rms < 0.01 ? (rms < 0.001 ? 1000 : 100) : 1;
        console.log(`   Using ${amplification}x amplification`);

        const amplifiedData = new Float32Array(audioData.data.length);
        for (let i = 0; i < audioData.data.length; i++) {
            amplifiedData[i] = audioData.data[i] * amplification;
        }

        const config = {
            ...DEFAULT_CONFIG,
            sampleRate: audioData.sampleRate
        };

        const decoder = new FeskDecoder(config);
        
        // Try different chunk sizes
        const chunkSizes = [
            { name: '1s chunks', size: audioData.sampleRate * 1.0 },
            { name: '0.5s chunks', size: audioData.sampleRate * 0.5 },
            { name: '0.2s chunks', size: audioData.sampleRate * 0.2 },
            { name: 'Single chunk', size: audioData.data.length }
        ];

        for (const { name, size } of chunkSizes) {
            console.log(`\\n🔄 Trying ${name}:`);
            decoder.reset();
            
            const chunkSize = Math.floor(size);
            let frameCount = 0;
            
            for (let i = 0; i < amplifiedData.length; i += chunkSize) {
                const endIndex = Math.min(i + chunkSize, amplifiedData.length);
                const chunk = amplifiedData.slice(i, endIndex);
                
                const audioSample: AudioSample = {
                    data: new Float32Array(chunk),
                    sampleRate: audioData.sampleRate,
                    timestamp: i / audioData.sampleRate
                };
                
                const result = decoder.processAudio(audioSample);
                
                if (result) {
                    frameCount++;
                    const message = new TextDecoder().decode(result.payload);
                    console.log(`   🎉 Frame ${frameCount}: "${message}" at ${audioSample.timestamp.toFixed(2)}s`);
                    console.log(`      Length: ${result.header.payloadLength}, CRC: ${result.isValid ? '✅' : '❌'}`);
                    
                    // Don't reset - let it continue looking for more frames
                }
                
                // Show progress for longer processing
                if (name === 'Single chunk') {
                    const state = decoder.getState();
                    console.log(`   Processed ${(endIndex / audioData.data.length * 100).toFixed(1)}% - Phase: ${state.phase}, Trits: ${state.tritBuffer.length}`);
                    break; // Single chunk only processes once
                }
            }
            
            if (frameCount === 0) {
                const finalState = decoder.getState();
                console.log(`   ❌ No frames (Phase: ${finalState.phase}, Trits: ${finalState.tritBuffer.length})`);
            } else {
                console.log(`   ✅ Success with ${name}!`);
                return; // Stop trying other chunk sizes
            }
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

if (require.main === module) {
    singleChunkFesk2().catch(console.error);
}

export { singleChunkFesk2 };