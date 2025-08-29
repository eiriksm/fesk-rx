import { FeskDecoder } from '../feskDecoder';
import { WavReader } from '../utils/wavReader';
import { AudioSample } from '../types';
import { DEFAULT_CONFIG } from '../config';

async function payloadDebugTest() {
    console.log('🔍 Payload Phase Debug');
    console.log('======================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk1.wav';
        const audioData = await WavReader.readWavFile(wavPath);
        
        // Amplify signal (1000x worked best from previous test)
        const amplification = 1000;
        const amplifiedData = new Float32Array(audioData.data.length);
        for (let i = 0; i < audioData.data.length; i++) {
            amplifiedData[i] = audioData.data[i] * amplification;
        }
        
        console.log(`📄 Processing amplified signal (${amplification}x)`);
        
        const config = {
            ...DEFAULT_CONFIG,
            sampleRate: audioData.sampleRate
        };
        
        const decoder = new FeskDecoder(config);
        const chunkSize = Math.floor(audioData.sampleRate * 0.05); // 50ms chunks for more granular debug
        
        let preambleTime = -1;
        let syncTime = -1;
        let payloadStartTime = -1;
        let lastPhase = 'searching';
        let payloadChunksProcessed = 0;
        
        for (let i = 0; i < Math.min(amplifiedData.length, audioData.sampleRate * 6); i += chunkSize) {
            const endIndex = Math.min(i + chunkSize, amplifiedData.length);
            const chunk = amplifiedData.slice(i, endIndex);
            
            const audioSample: AudioSample = {
                data: new Float32Array(chunk),
                sampleRate: audioData.sampleRate,
                timestamp: i / audioData.sampleRate
            };
            
            const result = decoder.processAudio(audioSample);
            const state = decoder.getState();
            
            // Track phase transitions
            if (state.phase !== lastPhase) {
                console.log(`\\n📍 Phase transition: ${lastPhase} → ${state.phase} at ${audioSample.timestamp.toFixed(2)}s`);
                
                if (state.phase === 'sync') {
                    preambleTime = audioSample.timestamp;
                } else if (state.phase === 'payload') {
                    syncTime = audioSample.timestamp;
                    payloadStartTime = audioSample.timestamp;
                    console.log(`   Starting payload collection...`);
                }
                
                lastPhase = state.phase;
            }
            
            // Debug payload phase
            if (state.phase === 'payload') {
                payloadChunksProcessed++;
                
                // Log progress every 20 chunks
                if (payloadChunksProcessed % 20 === 0) {
                    console.log(`   Payload chunk ${payloadChunksProcessed}: tritBuffer=${state.tritBuffer.length}, tritCount=${state.tritCount}`);
                    
                    // Show recent trits if we have any
                    if (state.tritBuffer.length > 0) {
                        const recentTrits = state.tritBuffer.slice(-10).join(',');
                        console.log(`     Recent trits: [...${recentTrits}]`);
                    }
                }
                
                // Try to decode when we have reasonable trit buffer
                if (state.tritBuffer.length >= 30 && payloadChunksProcessed % 50 === 0) {
                    console.log(`\\n🧮 Attempting decode with ${state.tritBuffer.length} trits...`);
                    
                    try {
                        // Manual decode attempt using the collected trits
                        const tritBuffer = [...state.tritBuffer];
                        console.log(`   First 20 trits: [${tritBuffer.slice(0, 20).join(',')}]`);
                        console.log(`   Last 20 trits: [${tritBuffer.slice(-20).join(',')}]`);
                        
                        // Simple validation - check for reasonable trit distribution
                        const counts = [0, 0, 0];
                        tritBuffer.forEach(trit => {
                            if (trit >= 0 && trit <= 2) counts[trit]++;
                        });
                        console.log(`   Trit distribution: 0=${counts[0]}, 1=${counts[1]}, 2=${counts[2]}`);
                        
                        // Check if distribution looks reasonable (should be roughly balanced)
                        const total = counts[0] + counts[1] + counts[2];
                        if (total > 0) {
                            const ratios = counts.map(c => (c/total * 100).toFixed(1));
                            console.log(`   Percentages: 0=${ratios[0]}%, 1=${ratios[1]}%, 2=${ratios[2]}%`);
                        }
                        
                    } catch (error) {
                        console.log(`   ❌ Decode attempt failed: ${error}`);
                    }
                }
            }
            
            if (result) {
                const message = new TextDecoder().decode(result.payload);
                console.log(`\\n🎉 SUCCESS: Decoded "${message}" at ${audioSample.timestamp.toFixed(2)}s`);
                console.log(`   CRC valid: ${result.isValid}`);
                break;
            }
            
            // Stop if we've been in payload phase too long without success
            if (payloadChunksProcessed > 200) {
                console.log(`\\n⏰ Stopping after ${payloadChunksProcessed} payload chunks`);
                break;
            }
        }
        
        console.log(`\\n📊 Summary:`);
        console.log(`   Preamble detected: ${preambleTime >= 0 ? preambleTime.toFixed(2) + 's' : 'No'}`);
        console.log(`   Sync detected: ${syncTime >= 0 ? syncTime.toFixed(2) + 's' : 'No'}`);
        console.log(`   Payload chunks processed: ${payloadChunksProcessed}`);
        console.log(`   Final phase: ${decoder.getState().phase}`);
        console.log(`   Final trit buffer size: ${decoder.getState().tritBuffer.length}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

if (require.main === module) {
    payloadDebugTest().catch(console.error);
}

export { payloadDebugTest };