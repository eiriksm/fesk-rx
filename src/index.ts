export { FeskDecoder } from "./decoder";
export { ToneDetector } from "./toneDetector";
export { PreambleDetector } from "./preambleDetector";
export { SyncDetector } from "./syncDetector";
export { DEFAULT_CONFIG } from "./config";
export * from "./types";
export * from "./config";

// Simple example usage
if (require.main === module) {
  console.log("FESK RX - Acoustic Protocol Receiver");
  console.log("=====================================");
  console.log("");
  console.log("This is a TypeScript implementation of a receiver for the");
  console.log("Harmonic Triad 3-FSK Acoustic Protocol (HT3).");
  console.log("");
  console.log("Current implementation status:");
  console.log("✓ Project structure");
  console.log("✓ FFT-based tone detection");
  console.log("✓ Preamble detection (1010... pattern)");
  console.log("✓ Barker-13 sync sequence detection");
  console.log("✓ Basic decoder orchestration");
  console.log("");
  console.log("TODO:");
  console.log("- Audio input handling");
  console.log("- Header and payload decoding");
  console.log("- Base-3 to byte conversion");
  console.log("- CRC validation");
  console.log("- Pilot sequence handling");
}
