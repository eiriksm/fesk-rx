import { FeskDecoder } from '../feskDecoder';
import { WavReader } from '../utils/wavReader';
import { AudioSample } from '../types';
import { DEFAULT_CONFIG } from '../config';

async function testWavFile() {
    console.log('🎵 Testing FESK Decoder with fesk1.wav');
    console.log('=====================================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk1.wav';
        const audioData = await WavReader.readWavFile(wavPath);
        
        console.log(`📄 WAV file loaded:`);
        console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
        console.log(`   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)} seconds`);
        console.log(`   Samples: ${audioData.data.length}`);

        const decoder = new FeskDecoder(DEFAULT_CONFIG);
        
        // Process audio in chunks (simulating real-time processing)
        const chunkSize = Math.floor(audioData.sampleRate * 0.01); // 10ms chunks
        let frame = null;
        let chunkCount = 0;
        
        console.log(`\\n🔄 Processing audio in ${chunkSize}-sample chunks...`);
        
        for (let i = 0; i < audioData.data.length; i += chunkSize) {
            const endIndex = Math.min(i + chunkSize, audioData.data.length);
            const chunk = audioData.data.slice(i, endIndex);
            
            const audioSample: AudioSample = {
                data: new Float32Array(chunk),
                sampleRate: audioData.sampleRate,
                timestamp: i / audioData.sampleRate
            };
            
            const result = decoder.processAudio(audioSample);
            chunkCount++;
            
            if (result) {
                frame = result;
                console.log(`\\n✅ Frame decoded after ${chunkCount} chunks (${(audioSample.timestamp).toFixed(2)}s)!`);
                break;
            }
            
            // Log progress every 100 chunks
            if (chunkCount % 100 === 0) {
                const state = decoder.getState();
                console.log(`   Chunk ${chunkCount}: phase=${state.phase}, tritBuffer=${state.tritBuffer.length}`);
            }
        }

        if (frame) {
            console.log('\\n📦 Decoded Frame Details:');
            console.log('==========================');
            console.log(`Header: payload length = ${frame.header.payloadLength} bytes`);
            console.log(`Payload bytes: [${Array.from(frame.payload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
            
            const message = new TextDecoder().decode(frame.payload);
            console.log(`Decoded message: "${message}"`);
            console.log(`CRC: received=0x${frame.crc.toString(16).padStart(4, '0')}`);
            console.log(`Frame valid: ${frame.isValid ? '✅' : '❌'}`);
            
            if (frame.isValid) {
                console.log(`\\n🎉 SUCCESS: Decoded "${message}" from WAV file!`);
            } else {
                console.log(`\\n⚠️  Frame decoded but CRC validation failed`);
            }
        } else {
            console.log('\\n❌ No frame was decoded from the WAV file');
            
            // Show final decoder state for debugging
            const finalState = decoder.getState();
            console.log(`\\nFinal decoder state:`);
            console.log(`   Phase: ${finalState.phase}`);
            console.log(`   Trit buffer length: ${finalState.tritBuffer.length}`);
            console.log(`   Trit count: ${finalState.tritCount}`);
            
            if (finalState.tritBuffer.length > 0) {
                console.log(`   Last 20 trits: [${finalState.tritBuffer.slice(-20).join(',')}]`);
            }
        }

    } catch (error) {
        console.error('❌ Error processing WAV file:', error);
        
        if (error instanceof Error) {
            console.error('Error details:', error.message);
            console.error('Stack:', error.stack);
        }
    }
}

// Also create a simpler test that processes the whole file at once
async function testWavFileComplete() {
    console.log('\\n🎵 Alternative: Processing entire WAV file as single sample');
    console.log('===========================================================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk1.wav';
        const audioData = await WavReader.readWavFile(wavPath);
        
        const decoder = new FeskDecoder(DEFAULT_CONFIG);
        
        // Process entire file as one sample
        const audioSample: AudioSample = {
            data: new Float32Array(audioData.data),
            sampleRate: audioData.sampleRate,
            timestamp: 0
        };
        
        console.log('Processing entire file...');
        const result = decoder.processAudio(audioSample);
        
        if (result) {
            const message = new TextDecoder().decode(result.payload);
            console.log(`\\n🎉 SUCCESS: Decoded "${message}" from complete file processing!`);
            console.log(`CRC valid: ${result.isValid ? '✅' : '❌'}`);
        } else {
            console.log('\\n❌ No frame decoded from complete file processing');
        }
        
    } catch (error) {
        console.error('❌ Error in complete file processing:', error);
    }
}

// Run both tests
async function runTests() {
    await testWavFile();
    await testWavFileComplete();
    console.log('\\n🏁 WAV file testing complete');
}

if (require.main === module) {
    runTests().catch(console.error);
}

export { testWavFile, testWavFileComplete };