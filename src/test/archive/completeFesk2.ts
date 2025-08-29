import { FeskDecoder } from "../feskDecoder";
import { WavReader } from "../utils/wavReader";
import { AudioSample } from "../types";
import { DEFAULT_CONFIG } from "../config";

async function completeFesk2() {
  console.log("🔍 Complete Processing of fesk2.wav");
  console.log("===================================");

  try {
    const wavPath = "/home/eirik/github/fesk_rx/testdata/fesk2.wav";
    const audioData = await WavReader.readWavFile(wavPath);

    const amplification = 1000;
    const amplifiedData = new Float32Array(audioData.data.length);
    for (let i = 0; i < audioData.data.length; i++) {
      amplifiedData[i] = audioData.data[i] * amplification;
    }

    console.log(
      `📄 Processing ${(audioData.data.length / audioData.sampleRate).toFixed(1)}s of audio...`,
    );

    const config = {
      ...DEFAULT_CONFIG,
      sampleRate: audioData.sampleRate,
    };

    const decoder = new FeskDecoder(config);
    const chunkSize = Math.floor(audioData.sampleRate * 0.1);

    let frameCount = 0;
    let lastPhase = "searching";
    let payloadStartTime = -1;

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

      // Track phase changes
      if (state.phase !== lastPhase) {
        console.log(
          `${audioSample.timestamp.toFixed(1)}s: ${lastPhase} → ${state.phase}`,
        );
        if (state.phase === "payload") {
          payloadStartTime = audioSample.timestamp;
        }
        lastPhase = state.phase;
      }

      // Show payload progress
      if (state.phase === "payload") {
        const chunkNum = Math.floor(i / chunkSize);
        if (chunkNum % 30 === 0) {
          // Every 3 seconds
          const elapsed = audioSample.timestamp - payloadStartTime;
          console.log(
            `  Payload: ${state.tritBuffer.length} trits (${elapsed.toFixed(1)}s in payload)`,
          );
        }
      }

      if (result) {
        frameCount++;
        const message = new TextDecoder().decode(result.payload);
        console.log(
          `\\n🎉 FRAME ${frameCount} at ${audioSample.timestamp.toFixed(2)}s:`,
        );
        console.log(`   Message: "${message}"`);
        console.log(`   Length: ${result.header.payloadLength} bytes`);
        console.log(
          `   CRC: 0x${result.crc.toString(16).padStart(4, "0")} ${result.isValid ? "✅" : "❌"}`,
        );

        // Reset to look for more frames
        decoder.reset();
        lastPhase = "searching";
        payloadStartTime = -1;
      }

      // If we've been in payload too long without success, show debug info
      if (state.phase === "payload" && payloadStartTime > 0) {
        const timeInPayload = audioSample.timestamp - payloadStartTime;
        if (timeInPayload > 8.0) {
          // 8 seconds is very long for a payload
          console.log(
            `\\n⏰ Been in payload phase for ${timeInPayload.toFixed(1)}s - debugging...`,
          );
          console.log(`   Current trits: ${state.tritBuffer.length}`);
          console.log(`   Sample: [${state.tritBuffer.slice(-20).join(",")}]`);

          // Force attempt a decode to see what we have
          try {
            const { CanonicalTritDecoder } = await import(
              "../utils/canonicalTritDecoder"
            );
            const { LFSRDescrambler } = await import(
              "../utils/lfsrDescrambler"
            );

            const tritDecoder = new CanonicalTritDecoder();
            state.tritBuffer.forEach((trit) => tritDecoder.addTrit(trit));
            const bytes = tritDecoder.getBytes();

            if (bytes.length >= 2) {
              const descrambler = new LFSRDescrambler();
              const headerHi = descrambler.descrambleByte(bytes[0]);
              const headerLo = descrambler.descrambleByte(bytes[1]);
              const payloadLength = (headerHi << 8) | headerLo;
              console.log(`   Interpreted payload length: ${payloadLength}`);

              if (payloadLength > 0 && payloadLength <= 50) {
                console.log(
                  `   Length seems reasonable - might need more trits`,
                );
              }
            }
          } catch (error) {
            console.log(`   Debug decode failed: ${error}`);
          }

          // Reset decoder to try fresh
          console.log(`   Resetting decoder to try again...`);
          decoder.reset();
          lastPhase = "searching";
          payloadStartTime = -1;
        }
      }
    }

    console.log(`\\n📊 Final Results:`);
    console.log(`   Total frames decoded: ${frameCount}`);
    console.log(
      `   File duration: ${(audioData.data.length / audioData.sampleRate).toFixed(1)}s`,
    );

    if (frameCount === 0) {
      console.log(`\\n❌ No complete frames decoded`);
      console.log(
        `   This might indicate the transmission is longer than expected`,
      );
      console.log(`   or there might be timing/sync issues in the longer file`);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

if (require.main === module) {
  completeFesk2().catch(console.error);
}

export { completeFesk2 };
