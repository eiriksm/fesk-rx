export interface FeskConfig {
  sampleRate: number;
  symbolDuration: number; // in seconds
  toneFrequencies: [number, number, number]; // f0, f1, f2
  preambleBits: number[];
  barker13: number[];
  pilotSequence: [number, number];
  pilotInterval: number; // trits

  // Adaptive timing parameters for WAV file processing
  adaptiveTiming?: {
    symbolDurationsMs?: number[]; // Alternative symbol durations to try
    timingOffsetsMs?: number[]; // Timing offsets to try
    enableAdaptive?: boolean; // Enable adaptive timing synchronization
  };
}

export const DEFAULT_CONFIG: FeskConfig = {
  sampleRate: 44100, // Updated to match actual audio files
  symbolDuration: 0.1, // 100ms - discovered from fesk1.wav analysis
  toneFrequencies: [2793.83, 3520.00, 4698.63], // F7, A7, D8 - harmonically safe frequencies
  preambleBits: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], // 12 bit alternating pattern
  barker13: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1], // Barker-13 sequence
  pilotSequence: [0, 2], // [f0, f2]
  pilotInterval: 64, // insert pilot every 64 trits

  // Adaptive timing configuration for robust WAV file processing
  adaptiveTiming: {
    symbolDurationsMs: [105, 100, 95, 110], // Symbol durations (prioritize 105ms which works for both fesk1 and fesk2)
    timingOffsetsMs: [20, 25, 0, 15, 40, 50, 60], // Timing offsets (added 60ms for fesk1hw)
    enableAdaptive: true, // Enable adaptive timing by default
  },
};
