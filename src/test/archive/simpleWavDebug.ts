import { WavReader } from '../utils/wavReader';

async function simpleWavDebug() {
    console.log('🔍 Simple WAV File Analysis');
    console.log('===========================');

    try {
        const wavPath = '/home/eirik/github/fesk_rx/testdata/fesk1.wav';
        console.log(`Loading: ${wavPath}`);
        
        const audioData = await WavReader.readWavFile(wavPath);
        
        console.log(`\\n📄 Basic WAV Properties:`);
        console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
        console.log(`   Total samples: ${audioData.data.length}`);
        console.log(`   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)} seconds`);
        
        // Analyze first 1000 samples to avoid stack overflow
        const analysisSamples = Math.min(1000, audioData.data.length);
        const segment = audioData.data.slice(0, analysisSamples);
        
        let min = segment[0];
        let max = segment[0];
        let sum = 0;
        
        for (let i = 0; i < segment.length; i++) {
            const sample = segment[i];
            if (sample < min) min = sample;
            if (sample > max) max = sample;
            sum += sample * sample;
        }
        
        const rms = Math.sqrt(sum / segment.length);
        
        console.log(`\\n📊 Signal Analysis (first ${analysisSamples} samples):`);
        console.log(`   Min amplitude: ${min.toFixed(6)}`);
        console.log(`   Max amplitude: ${max.toFixed(6)}`);
        console.log(`   RMS energy: ${rms.toFixed(6)}`);
        console.log(`   Peak-to-peak: ${(max - min).toFixed(6)}`);
        
        // Check if signal exists
        if (rms < 0.0001) {
            console.log(`   ⚠️  Very low signal level - might be silence`);
        } else if (rms > 0.1) {
            console.log(`   ⚠️  Very high signal level - might be clipped`);
        } else {
            console.log(`   ✅ Signal level looks reasonable`);
        }
        
        // Show first few samples
        console.log(`\\n🔢 First 10 samples:`);
        for (let i = 0; i < Math.min(10, segment.length); i++) {
            console.log(`   [${i}]: ${segment[i].toFixed(6)}`);
        }
        
        // Simple zero-crossing analysis to detect if there's any signal
        let zeroCrossings = 0;
        for (let i = 1; i < analysisSamples; i++) {
            if ((segment[i-1] > 0 && segment[i] <= 0) || (segment[i-1] <= 0 && segment[i] > 0)) {
                zeroCrossings++;
            }
        }
        
        console.log(`\\n📈 Zero crossings in first ${analysisSamples} samples: ${zeroCrossings}`);
        const estimatedFreq = (zeroCrossings / 2) * (audioData.sampleRate / analysisSamples);
        console.log(`   Estimated dominant frequency: ${estimatedFreq.toFixed(1)} Hz`);
        
        // Check if it's in our expected range
        const expectedRange = [2400, 3600];
        if (estimatedFreq >= expectedRange[0] && estimatedFreq <= expectedRange[1]) {
            console.log(`   ✅ Frequency is in FESK range (${expectedRange[0]}-${expectedRange[1]} Hz)`);
        } else {
            console.log(`   ⚠️  Frequency outside FESK range (expected ${expectedRange[0]}-${expectedRange[1]} Hz)`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

if (require.main === module) {
    simpleWavDebug().catch(console.error);
}

export { simpleWavDebug };