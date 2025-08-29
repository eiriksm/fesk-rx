import { FeskDecoder } from '../feskDecoder';
import { WavReader } from '../utils/wavReader';
import { AudioSample } from '../types';
import { DEFAULT_CONFIG } from '../config';

async function testFesk2() {
    console.log('🎵 Testing FESK Decoder with fesk2.wav');
    console.log('======================================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk2.wav';
        const audioData = await WavReader.readWavFile(wavPath);
        
        console.log(`📄 WAV file loaded:`);
        console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
        console.log(`   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)} seconds`);
        console.log(`   Samples: ${audioData.data.length}`);

        // Check signal level first
        const testSamples = Math.min(10000, audioData.data.length);
        let rms = 0;
        for (let i = 0; i < testSamples; i++) {
            rms += audioData.data[i] * audioData.data[i];
        }
        rms = Math.sqrt(rms / testSamples);
        console.log(`   Original RMS: ${rms.toFixed(6)}`);

        // Apply same amplification that worked for fesk1.wav
        const amplification = rms < 0.001 ? 1000 : 1; // Amplify if signal is very quiet
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
        
        // Use 100ms chunks like before
        const chunkSize = Math.floor(audioData.sampleRate * 0.1);
        let lastPhase = 'searching';
        let frameCount = 0;
        
        console.log(`\\n🔄 Processing in ${chunkSize}-sample chunks...`);
        
        for (let i = 0; i < amplifiedData.length; i += chunkSize) {
            const endIndex = Math.min(i + chunkSize, amplifiedData.length);
            const chunk = amplifiedData.slice(i, endIndex);
            
            const audioSample: AudioSample = {
                data: new Float32Array(chunk),
                sampleRate: audioData.sampleRate,
                timestamp: i / audioData.sampleRate
            };
            
            const result = decoder.processAudio(audioSample);
            const state = decoder.getState();
            
            // Log phase transitions
            if (state.phase !== lastPhase) {
                console.log(`   ${audioSample.timestamp.toFixed(1)}s: ${lastPhase} → ${state.phase}`);
                lastPhase = state.phase;
            }
            
            // Log payload progress
            if (state.phase === 'payload') {
                const chunkNum = Math.floor(i / chunkSize);
                if (chunkNum % 20 === 0 && state.tritBuffer.length > 0) {
                    console.log(`     Trits collected: ${state.tritBuffer.length}`);
                }
            }
            
            if (result) {
                frameCount++;
                const message = new TextDecoder().decode(result.payload);
                console.log(`\\n🎉 FRAME ${frameCount} decoded at ${audioSample.timestamp.toFixed(2)}s!`);
                console.log(`   Message: "${message}"`);
                console.log(`   Length: ${result.header.payloadLength} bytes`);
                console.log(`   CRC: 0x${result.crc.toString(16).padStart(4, '0')}`);
                console.log(`   Valid: ${result.isValid ? '✅' : '❌'}`);
                
                // Reset decoder to look for more frames
                decoder.reset();
                lastPhase = 'searching';
                
                // Continue processing to see if there are more frames
                continue;
            }
        }
        
        console.log(`\\n📊 Summary:`);
        console.log(`   Total frames decoded: ${frameCount}`);
        console.log(`   File fully processed: ${(amplifiedData.length / audioData.sampleRate).toFixed(2)}s`);
        
        if (frameCount === 0) {
            console.log(`\\n❌ No frames decoded`);
            const finalState = decoder.getState();
            console.log(`   Final phase: ${finalState.phase}`);
            console.log(`   Trit buffer: ${finalState.tritBuffer.length} trits`);
            
            if (finalState.tritBuffer.length > 0) {
                console.log(`   Sample trits: [${finalState.tritBuffer.slice(0, 20).join(',')}...]`);
            }
        }

    } catch (error) {
        console.error('❌ Error processing fesk2.wav:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
    }
}

if (require.main === module) {
    testFesk2().catch(console.error);
}

export { testFesk2 };