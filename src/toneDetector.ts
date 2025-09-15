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

  /**
   * Process window with advanced DSP options for problematic recordings
   */
  private processWindowAdvanced(
    window: Float32Array,
    sampleRate: number,
    options: {
      useParametricGoertzel?: boolean;
      useHannWindow?: boolean;
      confidenceThreshold?: number;
      strengthThreshold?: number;
    } = {},
  ): ToneDetection | null {
    const useParametricGoertzel = options.useParametricGoertzel || false;
    const useHannWindow = options.useHannWindow || false;
    const confidenceThreshold = options.confidenceThreshold || 0.3;
    const strengthThreshold = options.strengthThreshold || 0.001;

    // Apply windowing
    let windowedData: Float32Array;
    if (useHannWindow) {
      windowedData = this.applyHannWindow(window);
    } else {
      windowedData = this.applyHammingWindow(window);
    }

    // Get frequency strengths using appropriate method
    const strengths = useParametricGoertzel
      ? Goertzel.getFrequencyStrengthsParametric(
          windowedData,
          this.config.toneFrequencies,
          sampleRate,
        )
      : Goertzel.getFrequencyStrengths(
          windowedData,
          this.config.toneFrequencies,
          sampleRate,
        );

    // Find the tone with maximum energy
    const maxIndex = strengths.indexOf(Math.max(...strengths));
    const maxStrength = strengths[maxIndex];

    // Calculate confidence based on energy ratio
    const totalStrength = strengths.reduce((sum, s) => sum + s, 0);
    const confidence = totalStrength > 0 ? maxStrength / totalStrength : 0;

    // Only return detection if above thresholds
    if (confidence > confidenceThreshold && maxStrength > strengthThreshold) {
      return {
        frequency: this.config.toneFrequencies[maxIndex],
        magnitude: maxStrength,
        confidence: confidence,
      };
    }

    return null;
  }

  /**
   * Detect tones with advanced DSP options for problematic recordings
   */
  detectTonesAdvanced(
    audioSample: AudioSample,
    options: {
      useParametricGoertzel?: boolean;
      useHannWindow?: boolean;
      confidenceThreshold?: number;
      strengthThreshold?: number;
    } = {},
  ): ToneDetection[] {
    const detections: ToneDetection[] = [];
    const data = audioSample.data;

    // Process audio in overlapping windows
    for (let i = 0; i < data.length - this.windowSize; i += this.hopSize) {
      const window = data.slice(i, i + this.windowSize);
      const detection = this.processWindowAdvanced(
        window,
        audioSample.sampleRate,
        options,
      );
      if (detection) {
        detections.push(detection);
      }
    }

    return detections;
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
   * Uses standard binned approach - compatible with existing tests
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

  /**
   * Extract symbols using advanced DSP techniques for problematic recordings
   * Implements coarse-to-fine timing search and parametric Goertzel
   */
  extractSymbolsAdvanced(
    audioSample: AudioSample,
    options: {
      useParametricGoertzel?: boolean;
      timingSearchWindow?: number; // samples to search around expected timing
      useHannWindow?: boolean;
    } = {},
  ): number[] {
    const symbols: number[] = [];
    const data = audioSample.data;
    const sampleRate = audioSample.sampleRate;

    const symbolDurationSamples = Math.floor(
      this.config.symbolDuration * sampleRate,
    );
    const analysisWindowSamples = this.windowSize;

    // Advanced timing search parameters
    const timingSearchWindow =
      options.timingSearchWindow || Math.floor(symbolDurationSamples * 0.1); // 10% search window
    const useParametricGoertzel = options.useParametricGoertzel || false;
    const useHannWindow = options.useHannWindow || false;

    // First, do coarse timing estimation by looking for preamble correlation
    const bestStartOffset = this.findOptimalStartOffset(
      audioSample,
      timingSearchWindow,
    );
    const startOffsetSamples = Math.floor(bestStartOffset * sampleRate);

    let symbolIndex = 0;
    const maxSymbols = Math.floor(
      (data.length - startOffsetSamples) / symbolDurationSamples,
    );

    while (symbolIndex < maxSymbols) {
      const symbolStartSample =
        startOffsetSamples + symbolIndex * symbolDurationSamples;

      // Fine timing search around expected symbol center
      let bestTiming =
        symbolStartSample + Math.floor(symbolDurationSamples / 2);
      let bestStrength = 0;
      let bestTone = 0;

      const searchStart = Math.max(0, bestTiming - timingSearchWindow);
      const searchEnd = Math.min(
        data.length - analysisWindowSamples,
        bestTiming + timingSearchWindow,
      );

      for (
        let searchPos = searchStart;
        searchPos <= searchEnd;
        searchPos += Math.max(1, Math.floor(timingSearchWindow / 10))
      ) {
        const windowStartSample =
          searchPos - Math.floor(analysisWindowSamples / 2);
        const windowEndSample = windowStartSample + analysisWindowSamples;

        if (windowStartSample < 0 || windowEndSample >= data.length) continue;

        const segmentData = data.slice(windowStartSample, windowEndSample);

        // Apply Hann window if requested
        const processedSegment = useHannWindow
          ? this.applyHannWindow(segmentData as Float32Array)
          : segmentData;

        const result = useParametricGoertzel
          ? Goertzel.detectStrongestToneParametric(
              processedSegment as Float32Array,
              this.config.toneFrequencies,
              sampleRate,
            )
          : Goertzel.detectStrongestTone(
              processedSegment as Float32Array,
              this.config.toneFrequencies,
              sampleRate,
            );

        if (result.strength > bestStrength) {
          bestStrength = result.strength;
          bestTone = result.toneIndex;
          bestTiming = searchPos;
        }
      }

      symbols.push(bestTone);
      symbolIndex++;

      // Stop if we have a reasonable number of symbols for a complete transmission
      if (symbols.length >= 300) break;
    }

    return symbols;
  }

  /**
   * Find optimal start offset by correlating with expected preamble pattern
   */
  private findOptimalStartOffset(
    audioSample: AudioSample,
    searchWindow: number,
  ): number {
    // Look for alternating 2-0 preamble pattern
    const expectedPreamble = [2, 0, 2, 0, 2, 0, 2, 0];
    const data = audioSample.data;
    const sampleRate = audioSample.sampleRate;
    const symbolDurationSamples = Math.floor(
      this.config.symbolDuration * sampleRate,
    );

    let bestOffset = 0;
    let bestScore = 0;

    // Search first few seconds for preamble
    const maxSearchSeconds = 3;
    const searchSamples = Math.min(data.length, maxSearchSeconds * sampleRate);

    for (
      let offset = 0;
      offset < searchSamples - expectedPreamble.length * symbolDurationSamples;
      offset += searchWindow
    ) {
      let score = 0;

      for (let i = 0; i < expectedPreamble.length; i++) {
        const symbolStart = offset + i * symbolDurationSamples;
        const symbolCenter =
          symbolStart + Math.floor(symbolDurationSamples / 2);
        const windowStart = symbolCenter - Math.floor(this.windowSize / 2);
        const windowEnd = windowStart + this.windowSize;

        if (windowStart < 0 || windowEnd >= data.length) continue;

        const segment = data.slice(windowStart, windowEnd);
        const result = Goertzel.detectStrongestTone(
          segment,
          this.config.toneFrequencies,
          sampleRate,
        );

        if (result.toneIndex === expectedPreamble[i]) {
          score += result.strength;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }

    return bestOffset / sampleRate;
  }

  /**
   * Apply Hann window for better spectral characteristics
   */
  private applyHannWindow(data: Float32Array): Float32Array {
    const windowed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (data.length - 1)));
      windowed[i] = data[i] * w;
    }
    return windowed;
  }
}
