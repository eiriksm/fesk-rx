import { FeskDecoder } from "../feskDecoder";
import { WavReader } from "../utils/wavReader";
import { AudioSample } from "../types";
import { DEFAULT_CONFIG } from "../config";

async function workingWavTest() {
  console.log("🔧 WAV Test with Working Parameters");
  console.log("===================================");

  try {
    const wavPath = "/home/eirik/github/fesk_rx/testdata/fesk1.wav";
    const audioData = await WavReader.readWavFile(wavPath);

    // Use the same amplification that showed promise (1000x)
    const amplification = 1000;
    const amplifiedData = new Float32Array(audioData.data.length);
    for (let i = 0; i < audioData.data.length; i++) {
      amplifiedData[i] = audioData.data[i] * amplification;
    }

    console.log(`📄 Signal info:`);
    console.log(`   Sample rate: ${audioData.sampleRate} Hz`);
    console.log(`   Amplification: ${amplification}x`);

    const config = {
      ...DEFAULT_CONFIG,
      sampleRate: audioData.sampleRate,
    };

    const decoder = new FeskDecoder(config);

    // Use the same chunk size that worked (100ms)
    const chunkSize = Math.floor(audioData.sampleRate * 0.1);
    let lastPhase = "searching";

    console.log(
      `\\n🔄 Processing in ${chunkSize}-sample chunks (0.1s each)...`,
    );

    for (
      let i = 0;
      i < Math.min(amplifiedData.length, audioData.sampleRate * 8);
      i += chunkSize
    ) {
      const endIndex = Math.min(i + chunkSize, amplifiedData.length);
      const chunk = amplifiedData.slice(i, endIndex);

      const audioSample: AudioSample = {
        data: new Float32Array(chunk),
        sampleRate: audioData.sampleRate,
        timestamp: i / audioData.sampleRate,
      };

      const result = decoder.processAudio(audioSample);
      const state = decoder.getState();

      // Log phase changes
      if (state.phase !== lastPhase) {
        console.log(
          `   ${audioSample.timestamp.toFixed(1)}s: ${lastPhase} → ${state.phase}`,
        );
        lastPhase = state.phase;

        if (state.phase === "payload") {
          console.log(`     Starting payload collection...`);
        }
      }

      // If we're in payload phase, show periodic updates
      if (state.phase === "payload") {
        const chunkNum = Math.floor(i / chunkSize);
        if (chunkNum % 10 === 0) {
          console.log(
            `     Chunk ${chunkNum}: ${state.tritBuffer.length} trits collected`,
          );
        }
      }

      if (result) {
        const message = new TextDecoder().decode(result.payload);
        console.log(`\\n🎉 SUCCESS at ${audioSample.timestamp.toFixed(2)}s!`);
        console.log(`   Message: "${message}"`);
        console.log(`   Payload length: ${result.header.payloadLength} bytes`);
        console.log(`   CRC: 0x${result.crc.toString(16).padStart(4, "0")}`);
        console.log(`   Valid: ${result.isValid ? "✅" : "❌"}`);
        return;
      }
    }

    // If we get here, no frame was decoded
    console.log(`\\n❌ No frame decoded`);
    const finalState = decoder.getState();
    console.log(
      `Final state: phase=${finalState.phase}, tritBuffer=${finalState.tritBuffer.length}`,
    );

    if (finalState.phase === "payload" && finalState.tritBuffer.length > 0) {
      console.log(`\\n🔍 Payload debugging info:`);
      console.log(`   Collected ${finalState.tritBuffer.length} trits`);
      console.log(
        `   First 20: [${finalState.tritBuffer.slice(0, 20).join(",")}]`,
      );
      console.log(
        `   Last 20: [${finalState.tritBuffer.slice(-20).join(",")}]`,
      );

      // Try manual decode to see what's wrong
      try {
        const { CanonicalTritDecoder } = await import(
          "../utils/canonicalTritDecoder"
        );
        const { LFSRDescrambler } = await import("../utils/lfsrDescrambler");

        const decoder = new CanonicalTritDecoder();
        finalState.tritBuffer.forEach((trit) => decoder.addTrit(trit));
        const bytes = decoder.getBytes();

        console.log(
          `   Decoded to ${bytes.length} bytes: [${Array.from(bytes)
            .map((b) => "0x" + b.toString(16).padStart(2, "0"))
            .join(", ")}]`,
        );

        if (bytes.length >= 4) {
          const descrambler = new LFSRDescrambler();
          const headerHi = descrambler.descrambleByte(bytes[0]);
          const headerLo = descrambler.descrambleByte(bytes[1]);
          const payloadLength = (headerHi << 8) | headerLo;
          console.log(`   Header suggests payload length: ${payloadLength}`);

          if (payloadLength > 0 && payloadLength <= 20) {
            console.log(
              `   Payload length looks reasonable, issue might be elsewhere`,
            );
          }
        }
      } catch (error) {
        console.log(`   Manual decode error: ${error}`);
      }
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

if (require.main === module) {
  workingWavTest().catch(console.error);
}

export { workingWavTest };
