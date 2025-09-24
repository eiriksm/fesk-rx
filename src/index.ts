export { FeskDecoder } from "./feskDecoder";
export { ToneDetector } from "./toneDetector";
export { PreambleDetector } from "./preambleDetector";
export { SyncDetector } from "./syncDetector";
export { WavReader, type WavReadOptions } from "./utils/wavReader";
export { DEFAULT_CONFIG } from "./config";
export * from "./types";
export * from "./config";
export { SymbolExtractor } from "./audio/symbolExtractor";

// Simple example usage
if (require.main === module) {
  console.log("FESK RX - Acoustic Protocol Receiver");
  console.log("=====================================");
  console.log("");
  console.log("This is a TypeScript implementation of a receiver for the");
  console.log("Harmonic Triad 3-FSK Acoustic Protocol (HT3).");
  console.log("");
  console.log("COMPLETED implementation status:");
  console.log("✅ Project structure and build system");
  console.log("✅ FFT-based tone detection (44.1kHz audio support)");
  console.log("✅ Preamble detection (1010... alternating pattern)");
  console.log("✅ Barker-13 sync sequence detection");
  console.log("✅ Complete decoder orchestration with state machine");
  console.log("✅ WAV file audio input handling");
  console.log("✅ Header and payload decoding");
  console.log("✅ Canonical trit-to-byte conversion");
  console.log("✅ CRC16 validation");
  console.log("✅ Pilot sequence handling");
  console.log("✅ LFSR descrambling");
  console.log("✅ Symbol decimation and timing synchronization");
  console.log("✅ Real audio file processing (fesk1.wav -> 'test')");
  console.log("");
  console.log("🎉 FULLY FUNCTIONAL FESK DECODER!");
}
