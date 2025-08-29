import { FeskDecoder } from "../feskDecoder";
import { WavReader } from "../utils/wavReader";
import { AudioSample } from "../types";
import { DEFAULT_CONFIG } from "../config";
import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

async function debugFesk2() {
  console.log("🔍 Debug Analysis of fesk2.wav");
  console.log("===============================");

  try {
    const wavPath = "/home/eirik/github/fesk_rx/testdata/fesk2.wav";
    const audioData = await WavReader.readWavFile(wavPath);

    const amplification = 1000;
    const amplifiedData = new Float32Array(audioData.data.length);
    for (let i = 0; i < audioData.data.length; i++) {
      amplifiedData[i] = audioData.data[i] * amplification;
    }

    const config = {
      ...DEFAULT_CONFIG,
      sampleRate: audioData.sampleRate,
    };

    const decoder = new FeskDecoder(config);
    const chunkSize = Math.floor(audioData.sampleRate * 0.1);

    console.log(`Processing to collect trits...`);

    // Process until we're well into payload phase
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

      if (result) {
        const message = new TextDecoder().decode(result.payload);
        console.log(`🎉 Decoded: "${message}"`);
        return;
      }

      // Stop when we have a good amount of trits to analyze
      if (state.phase === "payload" && state.tritBuffer.length >= 80) {
        console.log(
          `\\n🔍 Analyzing ${state.tritBuffer.length} collected trits...`,
        );
        break;
      }
    }

    const finalState = decoder.getState();
    const tritBuffer = [...finalState.tritBuffer];

    console.log(`\\n📊 Trit Analysis:`);
    console.log(`   Total trits: ${tritBuffer.length}`);
    console.log(`   Full sequence: [${tritBuffer.join(",")}]`);

    // Remove pilots manually
    function removePilots(trits: number[]): number[] {
      const cleaned: number[] = [];
      let dataTrits = 0;

      for (let i = 0; i < trits.length; i++) {
        if (dataTrits > 0 && dataTrits % 64 === 0) {
          if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
            console.log(`   Removed pilot [0,2] at position ${dataTrits}`);
            i++; // Skip both pilot trits
            continue;
          }
        }
        cleaned.push(trits[i]);
        dataTrits++;
      }
      return cleaned;
    }

    const cleanedTrits = removePilots(tritBuffer);
    console.log(`   After pilot removal: ${cleanedTrits.length} trits`);
    console.log(`   Cleaned: [${cleanedTrits.join(",")}]`);

    // Try to decode what we have
    try {
      const decoder = new CanonicalTritDecoder();
      for (const trit of cleanedTrits) {
        decoder.addTrit(trit);
      }

      const bytes = decoder.getBytes();
      console.log(
        `\\n🔢 Decoded to ${bytes.length} bytes: [${Array.from(bytes)
          .map((b) => "0x" + b.toString(16).padStart(2, "0"))
          .join(", ")}]`,
      );

      if (bytes.length >= 4) {
        // Try to parse as FESK frame
        const descrambler = new LFSRDescrambler();

        // Header
        const headerHi = descrambler.descrambleByte(bytes[0]);
        const headerLo = descrambler.descrambleByte(bytes[1]);
        const payloadLength = (headerHi << 8) | headerLo;

        console.log(`\\n📤 Header Analysis:`);
        console.log(
          `   Raw header: [0x${bytes[0].toString(16).padStart(2, "0")}, 0x${bytes[1].toString(16).padStart(2, "0")}]`,
        );
        console.log(
          `   Descrambled: [0x${headerHi.toString(16).padStart(2, "0")}, 0x${headerLo.toString(16).padStart(2, "0")}]`,
        );
        console.log(`   Payload length: ${payloadLength} bytes`);

        if (
          payloadLength > 0 &&
          payloadLength <= 64 &&
          bytes.length >= 2 + payloadLength + 2
        ) {
          // We have enough bytes - try full decode
          const payload = new Uint8Array(payloadLength);
          for (let i = 0; i < payloadLength; i++) {
            payload[i] = descrambler.descrambleByte(bytes[2 + i]);
          }

          const message = Array.from(payload)
            .map((b) => {
              if (b >= 32 && b <= 126) return String.fromCharCode(b);
              return `\\\\x${b.toString(16).padStart(2, "0")}`;
            })
            .join("");

          console.log(`\\n📦 Payload Analysis:`);
          console.log(
            `   Raw payload: [${Array.from(bytes.slice(2, 2 + payloadLength))
              .map((b) => "0x" + b.toString(16).padStart(2, "0"))
              .join(", ")}]`,
          );
          console.log(
            `   Descrambled: [${Array.from(payload)
              .map((b) => "0x" + b.toString(16).padStart(2, "0"))
              .join(", ")}]`,
          );
          console.log(`   As text: "${message}"`);

          // Check CRC
          const crcBytes = bytes.slice(
            2 + payloadLength,
            2 + payloadLength + 2,
          );
          const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
          const calculatedCrc = CRC16.calculate(payload);

          console.log(`\\n🔒 CRC Analysis:`);
          console.log(
            `   CRC bytes: [0x${crcBytes[0].toString(16).padStart(2, "0")}, 0x${crcBytes[1].toString(16).padStart(2, "0")}]`,
          );
          console.log(
            `   Received CRC: 0x${receivedCrc.toString(16).padStart(4, "0")}`,
          );
          console.log(
            `   Calculated CRC: 0x${calculatedCrc.toString(16).padStart(4, "0")}`,
          );
          console.log(
            `   CRC valid: ${receivedCrc === calculatedCrc ? "✅" : "❌"}`,
          );

          if (receivedCrc === calculatedCrc) {
            console.log(`\\n🎉 MANUAL DECODE SUCCESS: "${message}"`);
          } else {
            console.log(
              `\\n⚠️  Manual decode shows CRC mismatch - might need more data`,
            );
          }
        } else {
          console.log(`   Invalid payload length or insufficient data`);
          console.log(
            `   Need: ${2 + payloadLength + 2} bytes, have: ${bytes.length}`,
          );
        }
      } else {
        console.log(`   Not enough bytes for header analysis`);
      }
    } catch (error) {
      console.log(`❌ Decode error: ${error}`);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

if (require.main === module) {
  debugFesk2().catch(console.error);
}

export { debugFesk2 };
