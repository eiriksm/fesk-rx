import { FeskDecoder } from "../decoder";
import { AudioSample, ToneDetection } from "../types";
import { DEFAULT_CONFIG } from "../config";

// Test data from the TX lib transmission for "test"
const testTransmissionSequence = [
  // Preamble (positions 0-11): alternating f2, f0 (1, 0 pattern)
  { pos: 0, freq: 3600, symbol: 2, description: "Preamble bit 0 = 1" },
  { pos: 1, freq: 2400, symbol: 0, description: "Preamble bit 1 = 0" },
  { pos: 2, freq: 3600, symbol: 2, description: "Preamble bit 2 = 1" },
  { pos: 3, freq: 2400, symbol: 0, description: "Preamble bit 3 = 0" },
  { pos: 4, freq: 3600, symbol: 2, description: "Preamble bit 4 = 1" },
  { pos: 5, freq: 2400, symbol: 0, description: "Preamble bit 5 = 0" },
  { pos: 6, freq: 3600, symbol: 2, description: "Preamble bit 6 = 1" },
  { pos: 7, freq: 2400, symbol: 0, description: "Preamble bit 7 = 0" },
  { pos: 8, freq: 3600, symbol: 2, description: "Preamble bit 8 = 1" },
  { pos: 9, freq: 2400, symbol: 0, description: "Preamble bit 9 = 0" },
  { pos: 10, freq: 3600, symbol: 2, description: "Preamble bit 10 = 1" },
  { pos: 11, freq: 2400, symbol: 0, description: "Preamble bit 11 = 0" },

  // Sync (positions 12-24): Barker-13 sequence
  { pos: 12, freq: 3600, symbol: 2, description: "Barker-13 sync bit 0" },
  { pos: 13, freq: 3600, symbol: 2, description: "Barker-13 sync bit 1" },
  { pos: 14, freq: 3600, symbol: 2, description: "Barker-13 sync bit 2" },
  { pos: 15, freq: 3600, symbol: 2, description: "Barker-13 sync bit 3" },
  { pos: 16, freq: 3600, symbol: 2, description: "Barker-13 sync bit 4" },
  { pos: 17, freq: 2400, symbol: 0, description: "Barker-13 sync bit 5" },
  { pos: 18, freq: 2400, symbol: 0, description: "Barker-13 sync bit 6" },
  { pos: 19, freq: 3600, symbol: 2, description: "Barker-13 sync bit 7" },
  { pos: 20, freq: 3600, symbol: 2, description: "Barker-13 sync bit 8" },
  { pos: 21, freq: 2400, symbol: 0, description: "Barker-13 sync bit 9" },
  { pos: 22, freq: 3600, symbol: 2, description: "Barker-13 sync bit 10" },
  { pos: 23, freq: 2400, symbol: 0, description: "Barker-13 sync bit 11" },
  { pos: 24, freq: 3600, symbol: 2, description: "Barker-13 sync bit 12" },

  // Header (positions 25-30): payload length = 4 bytes
  {
    pos: 25,
    freq: 2400,
    symbol: 0,
    description: "Header (payload length = 4 bytes)",
  },
  {
    pos: 26,
    freq: 3000,
    symbol: 1,
    description: "Header (payload length = 4 bytes)",
  },
  {
    pos: 27,
    freq: 3000,
    symbol: 1,
    description: "Header (payload length = 4 bytes)",
  },
  {
    pos: 28,
    freq: 3600,
    symbol: 2,
    description: "Header (payload length = 4 bytes)",
  },
  {
    pos: 29,
    freq: 3000,
    symbol: 1,
    description: "Header (payload length = 4 bytes)",
  },
  {
    pos: 30,
    freq: 3000,
    symbol: 1,
    description: "Header (payload length = 4 bytes)",
  },

  // Payload (positions 31-55): "test" encoded
  { pos: 31, freq: 3600, symbol: 2, description: "Payload data" },
  { pos: 32, freq: 3600, symbol: 2, description: "Payload data" },
  { pos: 33, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 34, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 35, freq: 3600, symbol: 2, description: "Payload data" },
  { pos: 36, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 37, freq: 3600, symbol: 2, description: "Payload data" },
  { pos: 38, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 39, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 40, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 41, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 42, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 43, freq: 3600, symbol: 2, description: "Payload data" },
  { pos: 44, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 45, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 46, freq: 3600, symbol: 2, description: "Payload data" },
  { pos: 47, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 48, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 49, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 50, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 51, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 52, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 53, freq: 3000, symbol: 1, description: "Payload data" },
  { pos: 54, freq: 2400, symbol: 0, description: "Payload data" },
  { pos: 55, freq: 3000, symbol: 1, description: "Payload data" },

  // CRC (positions 56-64): CRC-16 checksum
  { pos: 56, freq: 2400, symbol: 0, description: "CRC-16 checksum" },
  { pos: 57, freq: 3000, symbol: 1, description: "CRC-16 checksum" },
  { pos: 58, freq: 3000, symbol: 1, description: "CRC-16 checksum" },
  { pos: 59, freq: 3600, symbol: 2, description: "CRC-16 checksum" },
  { pos: 60, freq: 3000, symbol: 1, description: "CRC-16 checksum" },
  { pos: 61, freq: 3000, symbol: 1, description: "CRC-16 checksum" },
  { pos: 62, freq: 3000, symbol: 1, description: "CRC-16 checksum" },
  { pos: 63, freq: 3600, symbol: 2, description: "CRC-16 checksum" },
  { pos: 64, freq: 3000, symbol: 1, description: "CRC-16 checksum" },
];

function simulateAudioFromTones(): AudioSample[] {
  const samples: AudioSample[] = [];

  for (let i = 0; i < testTransmissionSequence.length; i++) {
    const tone = testTransmissionSequence[i];

    // Create a simple audio sample with the tone frequency
    const sampleRate = 8000;
    const symbolDuration = 0.09375; // 93.75ms
    const samplesPerSymbol = Math.floor(sampleRate * symbolDuration);
    const audioData = new Float32Array(samplesPerSymbol);

    // Generate a sine wave at the tone frequency
    const frequency = tone.freq;
    for (let j = 0; j < audioData.length; j++) {
      audioData[j] = Math.sin((2 * Math.PI * frequency * j) / sampleRate) * 0.5;
    }

    samples.push({
      data: audioData,
      sampleRate,
      timestamp: i * symbolDuration,
    });
  }

  return samples;
}

function testDecoder() {
  console.log('🧪 Testing FESK Decoder with "test" transmission');
  console.log("================================================");

  const decoder = new FeskDecoder(DEFAULT_CONFIG);
  const audioSamples = simulateAudioFromTones();

  let frame: any = null;

  for (let i = 0; i < audioSamples.length; i++) {
    const sample = audioSamples[i];
    const result = decoder.processAudio(sample);

    if (result) {
      frame = result;
      console.log(`✅ Frame decoded at position ${i}!`);
      break;
    }

    // Log state transitions
    const state = decoder.getState();
    if (i % 5 === 0) {
      console.log(`Position ${i}: Phase=${state.phase}`);
    }
  }

  if (frame) {
    console.log("\\n📦 Decoded Frame:");
    console.log("================");
    console.log(`Header: payload length = ${frame.header.payloadLength}`);
    console.log(`Payload: "${new TextDecoder().decode(frame.payload)}"`);
    console.log(`CRC: 0x${frame.crc.toString(16).padStart(4, "0")}`);
    console.log(`Valid: ${frame.isValid ? "✅" : "❌"}`);

    // Verify the expected result
    const expectedMessage = "test";
    const actualMessage = new TextDecoder().decode(frame.payload);

    if (actualMessage === expectedMessage) {
      console.log(
        `\\n🎉 SUCCESS: Decoded message matches expected "${expectedMessage}"`,
      );
    } else {
      console.log(
        `\\n❌ FAILURE: Expected "${expectedMessage}", got "${actualMessage}"`,
      );
    }
  } else {
    console.log("\\n❌ No frame was decoded");
  }
}

// Run the test
if (require.main === module) {
  testDecoder();
}

export { testDecoder };
