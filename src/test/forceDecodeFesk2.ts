import { FeskDecoder } from "../feskDecoder";
import { WavReader } from "../utils/wavReader";
import { AudioSample } from "../types";
import { DEFAULT_CONFIG } from "../config";
import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

async function forceDecodeFesk2() {
  console.log("🔧 Force Decode Analysis of fesk2.wav");
  console.log("=====================================");

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

    console.log("🔄 Processing to collect maximum trits...");

    let maxTrits: number[] = [];
    let bestTime = 0;

    // Process entire file to find the maximum trit collection
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
        console.log(
          `\\n🎉 SUCCESS: "${message}" at ${audioSample.timestamp.toFixed(2)}s`,
        );
        return;
      }

      // Track maximum trit collection
      if (
        state.phase === "payload" &&
        state.tritBuffer.length > maxTrits.length
      ) {
        maxTrits = [...state.tritBuffer];
        bestTime = audioSample.timestamp;
      }
    }

    if (maxTrits.length === 0) {
      console.log("❌ No trits collected at all");
      return;
    }

    console.log(
      `\\n📊 Maximum trit collection: ${maxTrits.length} trits at ${bestTime.toFixed(1)}s`,
    );
    console.log(`Full trit sequence: [${maxTrits.join(",")}]`);

    // Try different interpretations
    console.log("\\n🔍 Trying different decoding approaches...");

    // Approach 1: Use all trits as-is
    console.log("\\n1️⃣ Attempt with all trits:");
    await tryDecode(maxTrits, "  ");

    // Approach 2: Remove assumed pilots manually
    const cleanedTrits = removePilotsManually(maxTrits);
    if (cleanedTrits.length !== maxTrits.length) {
      console.log("\\n2️⃣ Attempt after manual pilot removal:");
      console.log(`   Removed ${maxTrits.length - cleanedTrits.length} trits`);
      await tryDecode(cleanedTrits, "  ");
    }

    // Approach 3: Try different starting points (maybe we captured mid-stream)
    for (let start = 1; start <= Math.min(10, maxTrits.length - 20); start++) {
      const subset = maxTrits.slice(start);
      console.log(`\\n${start + 2}️⃣ Attempt starting from trit ${start}:`);
      const result = await tryDecode(subset, "  ");
      if (result) break; // Stop if we find a valid decode
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

function removePilotsManually(trits: number[]): number[] {
  const cleaned: number[] = [];
  let dataTrits = 0;

  for (let i = 0; i < trits.length; i++) {
    if (dataTrits > 0 && dataTrits % 64 === 0) {
      if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
        console.log(`   Found pilot [0,2] at data position ${dataTrits}`);
        i++; // Skip both pilot trits
        continue;
      }
    }
    cleaned.push(trits[i]);
    dataTrits++;
  }
  return cleaned;
}

async function tryDecode(
  trits: number[],
  indent: string = "",
): Promise<boolean> {
  try {
    const decoder = new CanonicalTritDecoder();
    for (const trit of trits) {
      decoder.addTrit(trit);
    }

    const bytes = decoder.getBytes();
    console.log(
      `${indent}Decoded to ${bytes.length} bytes: [${Array.from(bytes)
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(", ")}]`,
    );

    if (bytes.length < 4) {
      console.log(`${indent}❌ Not enough bytes for frame`);
      return false;
    }

    const descrambler = new LFSRDescrambler();
    const headerHi = descrambler.descrambleByte(bytes[0]);
    const headerLo = descrambler.descrambleByte(bytes[1]);
    const payloadLength = (headerHi << 8) | headerLo;

    console.log(`${indent}Header: ${payloadLength} bytes payload`);

    if (
      payloadLength <= 0 ||
      payloadLength > 64 ||
      bytes.length < 2 + payloadLength + 2
    ) {
      console.log(`${indent}❌ Invalid payload length or insufficient data`);
      return false;
    }

    // Decode payload
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

    // Check CRC
    const crcBytes = bytes.slice(2 + payloadLength, 2 + payloadLength + 2);
    const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const calculatedCrc = CRC16.calculate(payload);

    console.log(`${indent}Message: "${message}"`);
    console.log(
      `${indent}CRC: received=0x${receivedCrc.toString(16).padStart(4, "0")}, calculated=0x${calculatedCrc.toString(16).padStart(4, "0")}`,
    );

    if (receivedCrc === calculatedCrc) {
      console.log(`${indent}🎉 VALID DECODE: "${message}"`);
      return true;
    } else {
      console.log(`${indent}❌ CRC mismatch`);
      return false;
    }
  } catch (error) {
    console.log(`${indent}❌ Decode error: ${error}`);
    return false;
  }
}

if (require.main === module) {
  forceDecodeFesk2().catch(console.error);
}

export { forceDecodeFesk2 };
