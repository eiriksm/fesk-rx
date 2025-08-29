import { ToneDetector } from "../toneDetector";
import { WavReader } from "../utils/wavReader";
import { AudioSample } from "../types";
import { DEFAULT_CONFIG } from "../config";

async function debugWavFile() {
  console.log("🔍 Debug FESK WAV Processing");
  console.log("============================");

  try {
    const wavPath = "/home/eirik/github/fesk_rx/testdata/fesk1.wav";
    const audioData = await WavReader.readWavFile(wavPath);

    console.log(`📄 WAV file info:`);
    console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
    console.log(
      `   Duration: ${(audioData.data.length / audioData.sampleRate).toFixed(2)} seconds`,
    );
    console.log(`   Samples: ${audioData.data.length}`);
    console.log(
      `   Peak amplitude: ${Math.max(...Array.from(audioData.data)).toFixed(4)}`,
    );
    console.log(
      `   Min amplitude: ${Math.min(...Array.from(audioData.data)).toFixed(4)}`,
    );

    // Update config for the actual sample rate
    const config = {
      ...DEFAULT_CONFIG,
      sampleRate: audioData.sampleRate,
    };

    const toneDetector = new ToneDetector(config);

    // Process in larger chunks to see if we can detect anything
    const chunkSizeMs = 100; // 100ms chunks
    const chunkSize = Math.floor((audioData.sampleRate * chunkSizeMs) / 1000);
    console.log(
      `\\n🔄 Processing in ${chunkSizeMs}ms chunks (${chunkSize} samples each)`,
    );

    let totalToneDetections = 0;
    let maxDetections = 0;
    let bestChunk = -1;

    for (
      let i = 0;
      i < Math.min(audioData.data.length, audioData.sampleRate * 2);
      i += chunkSize
    ) {
      const endIndex = Math.min(i + chunkSize, audioData.data.length);
      const chunk = audioData.data.slice(i, endIndex);

      const audioSample: AudioSample = {
        data: new Float32Array(chunk),
        sampleRate: audioData.sampleRate,
        timestamp: i / audioData.sampleRate,
      };

      const detections = toneDetector.detectTones(audioSample);
      totalToneDetections += detections.length;

      if (detections.length > maxDetections) {
        maxDetections = detections.length;
        bestChunk = Math.floor(i / chunkSize);
      }

      // Log first few chunks with detections
      if (detections.length > 0 && totalToneDetections < 20) {
        console.log(
          `   Chunk ${Math.floor(i / chunkSize)} (${audioSample.timestamp.toFixed(2)}s): ${detections.length} detections`,
        );
        detections.forEach((det, idx) => {
          console.log(
            `     ${idx}: freq=${det.frequency.toFixed(1)}Hz, mag=${det.magnitude.toFixed(4)}, conf=${det.confidence.toFixed(3)}`,
          );
        });
      }
    }

    console.log(`\\n📊 Detection Summary (first 2 seconds):`);
    console.log(`   Total tone detections: ${totalToneDetections}`);
    console.log(`   Best chunk: ${bestChunk} with ${maxDetections} detections`);
    console.log(
      `   Expected frequencies: f0=${config.toneFrequencies[0]}Hz, f1=${config.toneFrequencies[1]}Hz, f2=${config.toneFrequencies[2]}Hz`,
    );

    if (totalToneDetections === 0) {
      console.log("\\n🔍 No tone detections - checking signal properties...");

      // Analyze first second of audio
      const analysisLength = Math.min(
        audioData.sampleRate,
        audioData.data.length,
      );
      const segment = audioData.data.slice(0, analysisLength);

      // Simple energy analysis
      let energy = 0;
      for (let i = 0; i < segment.length; i++) {
        energy += segment[i] * segment[i];
      }
      energy = Math.sqrt(energy / segment.length);

      console.log(`   RMS energy (first 1s): ${energy.toFixed(6)}`);

      // Check for very quiet signal
      if (energy < 0.001) {
        console.log(
          "   ⚠️  Signal appears very quiet - might need gain adjustment",
        );
      }

      // Basic frequency content check using a simple approach
      console.log("   Checking for energy around expected frequencies...");
      const testChunk = audioData.data.slice(
        0,
        Math.min(8192, audioData.data.length),
      );
      const testSample: AudioSample = {
        data: new Float32Array(testChunk),
        sampleRate: audioData.sampleRate,
        timestamp: 0,
      };

      // Force tone detection with debug info
      try {
        const debugDetections = toneDetector.detectTones(testSample);
        console.log(
          `   Forced detection attempt: ${debugDetections.length} results`,
        );
        if (debugDetections.length > 0) {
          debugDetections.slice(0, 5).forEach((det, idx) => {
            console.log(
              `     ${idx}: ${det.frequency.toFixed(1)}Hz (conf: ${det.confidence.toFixed(3)})`,
            );
          });
        }
      } catch (error) {
        console.log(`   Error in tone detection: ${error}`);
      }
    } else {
      console.log(
        "\\n✅ Found tone detections - decoder should be able to process this",
      );
    }
  } catch (error) {
    console.error("❌ Error processing WAV file:", error);
    if (error instanceof Error) {
      console.error("Stack:", error.stack);
    }
  }
}

if (require.main === module) {
  debugWavFile().catch(console.error);
}

export { debugWavFile };
