import { ToneDetection, AudioSample } from "./types";
import { FeskConfig } from "./config";
import { Goertzel } from "./utils/goertzel";

export class ToneDetector {
  private config: FeskConfig;
  private windowSize: number;
  private hopSize: number;

  constructor(config: FeskConfig) {
    this.config = config;
    // Use window size optimized for FESK tone detection
    // For 44.1kHz, we want good frequency resolution around 2-4kHz
    const windowDurationMs = 25; // 25ms window for good time/freq tradeoff (matching original)
    const windowSamples = Math.floor(
      (config.sampleRate * windowDurationMs) / 1000,
    );
    this.windowSize = Math.pow(2, Math.ceil(Math.log2(windowSamples))); // Round to next power of 2 for consistency
    this.hopSize = Math.floor(this.windowSize / 8); // More overlap for better detection (matching original)
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
    // Apply Hamming window for better frequency resolution (matching old FFT behavior)
    const windowedData = this.applyHammingWindow(window);

    // Get all frequency strengths
    const strengths = Goertzel.getFrequencyStrengths(
      windowedData,
      this.config.toneFrequencies,
      sampleRate,
    );

    // Find the tone with maximum energy (like old FFT approach)
    const maxIndex = strengths.indexOf(Math.max(...strengths));
    const maxStrength = strengths[maxIndex];

    // Calculate confidence based on energy ratio (matching old logic)
    const totalStrength = strengths.reduce((sum, s) => sum + s, 0);
    const confidence = totalStrength > 0 ? maxStrength / totalStrength : 0;

    // Only return detection if confidence is above threshold (matching old 30% threshold)
    if (confidence > 0.3 && maxStrength > 0.001) {
      // Require both confidence and minimum strength
      return {
        frequency: this.config.toneFrequencies[maxIndex],
        magnitude: maxStrength,
        confidence: confidence,
      };
    }

    return null;
  }

  private applyHammingWindow(data: Float32Array): Float32Array {
    const windowed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (data.length - 1));
      windowed[i] = data[i] * w;
    }
    return windowed;
  }

  /**
   * Extract symbols from audio using optimal timing and Goertzel algorithm
   */
  extractSymbols(
    audioSample: AudioSample,
    startOffsetSeconds: number = 0,
  ): number[] {
    const symbols: number[] = [];
    const data = audioSample.data;
    const sampleRate = audioSample.sampleRate;

    const symbolDurationSamples = Math.floor(
      this.config.symbolDuration * sampleRate,
    );
    const analysisWindowSamples = this.windowSize; // Use our optimized window size
    const startOffsetSamples = Math.floor(startOffsetSeconds * sampleRate);

    let symbolIndex = 0;
    const maxSymbols = Math.floor(
      (data.length - startOffsetSamples) / symbolDurationSamples,
    );

    while (symbolIndex < maxSymbols) {
      const symbolStartSample =
        startOffsetSamples + symbolIndex * symbolDurationSamples;
      const windowCenterSample =
        symbolStartSample + Math.floor(symbolDurationSamples / 2);
      const windowStartSample =
        windowCenterSample - Math.floor(analysisWindowSamples / 2);
      const windowEndSample = windowStartSample + analysisWindowSamples;

      if (windowEndSample >= data.length) break;

      const segment = data.slice(windowStartSample, windowEndSample);
      const result = Goertzel.detectStrongestTone(
        segment,
        this.config.toneFrequencies,
        sampleRate,
      );

      symbols.push(result.toneIndex);
      symbolIndex++;

      // Stop if we have a reasonable number of symbols for a complete transmission
      if (symbols.length >= 300) break;
    }

    return symbols;
  }
}
