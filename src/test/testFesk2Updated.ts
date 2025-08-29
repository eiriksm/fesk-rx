import { FeskDecoder } from "../feskDecoder";
import { WavReader } from "../utils/wavReader";
import { AudioSample } from "../types";
import { DEFAULT_CONFIG } from "../config";

async function testFesk2Updated() {
  console.log("🎵 Testing UPDATED fesk2.wav (Improved Volume)");
  console.log("===============================================");

  try {
    const wavPath = "/home/eirik/github/fesk_rx/testdata/fesk2.wav";
    console.log(`Loading: ${wavPath}`);

    const audioData = await WavReader.readWavFile(wavPath);

    console.log(`📄 WAV file info:`);
    console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
    console.log(
      `   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)} seconds`,
    );
    console.log(`   Total samples: ${audioData.data.length}`);

    // Check signal level to see if it's improved
    const testSamples = Math.min(10000, audioData.data.length);
    let rms = 0;
    let maxAmp = 0;
    for (let i = 0; i < testSamples; i++) {
      const sample = Math.abs(audioData.data[i]);
      rms += audioData.data[i] * audioData.data[i];
      if (sample > maxAmp) maxAmp = sample;
    }
    rms = Math.sqrt(rms / testSamples);

    console.log(`   RMS level: ${rms.toFixed(6)}`);
    console.log(`   Peak level: ${maxAmp.toFixed(6)}`);
    console.log(
      `   Signal quality: ${rms > 0.001 ? "✅ Good" : "⚠️  Still quiet"}`,
    );

    // Determine amplification needed
    let amplification = 1;
    if (rms < 0.001) {
      amplification = 1000;
      console.log(
        `   Applying ${amplification}x amplification (signal still quiet)`,
      );
    } else if (rms < 0.01) {
      amplification = 10;
      console.log(
        `   Applying ${amplification}x amplification (signal moderate)`,
      );
    } else {
      console.log(`   Using signal as-is (good level)`);
    }

    const amplifiedData = new Float32Array(audioData.data.length);
    for (let i = 0; i < audioData.data.length; i++) {
      amplifiedData[i] = audioData.data[i] * amplification;
    }

    const config = {
      ...DEFAULT_CONFIG,
      sampleRate: audioData.sampleRate,
    };

    const decoder = new FeskDecoder(config);
    const chunkSize = Math.floor(audioData.sampleRate * 0.1); // 100ms chunks

    let frameCount = 0;
    let lastPhase = "searching";

    console.log(`\\n🔄 Processing in ${chunkSize}-sample chunks...`);

    for (let i = 0; i < amplifiedData.length; i += chunkSize) {
      const endIndex = Math.min(i + chunkSize, amplifiedData.length);
      const chunk = amplifiedData.slice(i, endIndex);

      const audioSample: AudioSample = {
        data: new Float32Array(chunk),
        sampleRate: audioData.sampleRate,
        timestamp: i / audioData.sampleRate,
      };

      const result = decoder.processAudio(audioSample);
      const state = decoder.getState();

      // Log phase transitions
      if (state.phase !== lastPhase) {
        console.log(
          `   ${audioSample.timestamp.toFixed(1)}s: ${lastPhase} → ${state.phase}`,
        );
        lastPhase = state.phase;
      }

      // Show payload progress
      if (state.phase === "payload") {
        const chunkNum = Math.floor(i / chunkSize);
        if (chunkNum % 20 === 0 && state.tritBuffer.length > 0) {
          console.log(
            `     Chunk ${chunkNum}: ${state.tritBuffer.length} trits collected`,
          );
        }
      }

      if (result) {
        frameCount++;
        const message = new TextDecoder().decode(result.payload);
        console.log(
          `\\n🎉 FRAME ${frameCount} decoded at ${audioSample.timestamp.toFixed(2)}s!`,
        );
        console.log(`   Message: "${message}"`);
        console.log(`   Length: ${result.header.payloadLength} bytes`);
        console.log(`   CRC: 0x${result.crc.toString(16).padStart(4, "0")}`);
        console.log(`   Valid: ${result.isValid ? "✅" : "❌"}`);

        // Reset to look for more frames
        decoder.reset();
        lastPhase = "searching";
        continue;
      }
    }

    console.log(`\\n📊 Results:`);
    console.log(`   Frames decoded: ${frameCount}`);
    console.log(
      `   File processed: ${(amplifiedData.length / audioData.sampleRate).toFixed(2)}s`,
    );

    if (frameCount === 0) {
      console.log("\\n❌ No frames decoded");
      const finalState = decoder.getState();
      console.log(`   Final phase: ${finalState.phase}`);
      console.log(
        `   Final trit buffer: ${finalState.tritBuffer.length} trits`,
      );
    } else {
      console.log(
        `\\n🎯 Successfully decoded ${frameCount} frame(s) from fesk2.wav!`,
      );
    }
  } catch (error) {
    console.error("❌ Error processing fesk2.wav:", error);
  }
}

if (require.main === module) {
  testFesk2Updated().catch(console.error);
}

export { testFesk2Updated };
