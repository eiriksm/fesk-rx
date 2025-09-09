import { ToneDetection, AudioSample } from "./types";
import { FeskConfig } from "./config";
import { Goertzel } from "./utils/goertzel";

export class ToneDetector {
  private config: FeskConfig;
  private windowSize: number;
  private hopSize: number;

  constructor(config: FeskConfig) {
    this.config = config;
    // Use window size optimized for FESK tone detection with Goertzel
    const windowDurationMs = 30; // 30ms window for good balance
    this.windowSize = Math.floor((config.sampleRate * windowDurationMs) / 1000);
    this.hopSize = Math.floor(this.windowSize / 2); // 50% overlap
  }

  detectTones(audioSample: AudioSample): ToneDetection[] {
    const detections: ToneDetection[] = [];
    const data = audioSample.data;

    // Process audio in overlapping windows
    for (let i = 0; i < data.length - this.windowSize; i += this.hopSize) {
      const window = data.slice(i, i + this.windowSize);
      const detection = this.processWindow(window, audioSample.sampleRate);
      if (detection) {
        detections.push(detection);
      }
    }

    return detections;
  }

  private processWindow(
    window: Float32Array,
    sampleRate: number,
  ): ToneDetection | null {
    // Use Goertzel algorithm to detect strongest tone
    const result = Goertzel.detectStrongestTone(window, this.config.toneFrequencies, sampleRate);

    // Calculate confidence threshold - require reasonable strength
    if (result.strength > 0.01) { // Minimum strength threshold
      return {
        frequency: this.config.toneFrequencies[result.toneIndex],
        magnitude: result.strength,
        confidence: result.strength, // Use strength directly as confidence
      };
    }

    return null;
  }

  /**
   * Extract symbols from audio using optimal timing and Goertzel algorithm
   */
  extractSymbols(audioSample: AudioSample, startOffsetSeconds: number = 0): number[] {
    const symbols: number[] = [];
    const data = audioSample.data;
    const sampleRate = audioSample.sampleRate;
    
    const symbolDurationSamples = Math.floor(this.config.symbolDuration * sampleRate);
    const analysisWindowSamples = this.windowSize; // Use our optimized window size
    const startOffsetSamples = Math.floor(startOffsetSeconds * sampleRate);
    
    let symbolIndex = 0;
    const maxSymbols = Math.floor((data.length - startOffsetSamples) / symbolDurationSamples);
    
    while (symbolIndex < maxSymbols) {
      const symbolStartSample = startOffsetSamples + symbolIndex * symbolDurationSamples;
      const windowCenterSample = symbolStartSample + Math.floor(symbolDurationSamples / 2);
      const windowStartSample = windowCenterSample - Math.floor(analysisWindowSamples / 2);
      const windowEndSample = windowStartSample + analysisWindowSamples;
      
      if (windowEndSample >= data.length) break;
      
      const segment = data.slice(windowStartSample, windowEndSample);
      const result = Goertzel.detectStrongestTone(segment, this.config.toneFrequencies, sampleRate);
      
      symbols.push(result.toneIndex);
      symbolIndex++;
      
      // Stop if we have a reasonable number of symbols for a complete transmission
      if (symbols.length >= 300) break;
    }
    
    return symbols;
  }
}
