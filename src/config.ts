export interface FeskConfig {
  sampleRate: number;
  symbolDuration: number; // in seconds
  toneFrequencies: [number, number, number]; // f0, f1, f2
  preambleBits: number[];
  barker13: number[];
  pilotSequence: [number, number];
  pilotInterval: number; // trits
}

export const DEFAULT_CONFIG: FeskConfig = {
  sampleRate: 44100, // Updated to match actual audio files
  symbolDuration: 0.1, // 100ms - discovered from fesk1.wav analysis
  toneFrequencies: [2400, 3000, 3600], // 4:5:6 major triad
  preambleBits: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], // 12 bit alternating pattern
  barker13: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1], // Barker-13 sequence
  pilotSequence: [0, 2], // [f0, f2]
  pilotInterval: 64, // insert pilot every 64 trits
};
