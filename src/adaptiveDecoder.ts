import { ToneDetector } from "./toneDetector";
import { AudioSample, DecoderState, Frame } from "./types";
import { FeskConfig, DEFAULT_CONFIG } from "./config";

export class AdaptiveFeskDecoder {
  private config: FeskConfig;
  private toneDetector: ToneDetector;
  private state: DecoderState;
  private measuredSymbolDuration?: number;
  private transmissionStartTime?: number;

  constructor(config: FeskConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.toneDetector = new ToneDetector(config);

    this.state = {
      phase: "searching",
      symbolBuffer: [],
      estimatedSymbolDuration: config.symbolDuration,
      estimatedFrequencies: [...config.toneFrequencies] as [
        number,
        number,
        number,
      ],
      frameStartTime: 0,
    };
  }

  processAudio(audioSample: AudioSample): Frame | null {
    switch (this.state.phase) {
      case "searching":
        return this.searchForPreamble(audioSample);
      case "preamble":
        // Preamble processing is handled in searching phase
        return null;
      case "sync":
        return this.processSync(audioSample);
      case "header":
        return this.processHeader(audioSample);
      case "payload":
        return this.processPayload(audioSample);
      default:
        return null;
    }
  }

  private searchForPreamble(audioSample: AudioSample): Frame | null {
    // Look for the alternating preamble pattern with adaptive timing
    const result = this.detectPreambleWithAdaptiveTiming(audioSample);

    if (result) {
      console.log("🎯 Adaptive preamble detected!");
      console.log("  Start time:", result.startTime.toFixed(3) + "s");
      console.log(
        "  Measured symbol duration:",
        result.symbolDuration.toFixed(3) +
          "s (" +
          (result.symbolDuration * 1000).toFixed(1) +
          "ms)",
      );
      console.log(
        "  Timing ratio vs spec:",
        (result.symbolDuration / this.config.symbolDuration).toFixed(3) + "x",
      );

      // Update decoder with measured timing
      this.measuredSymbolDuration = result.symbolDuration;
      this.transmissionStartTime = result.startTime;
      this.state.estimatedSymbolDuration = result.symbolDuration;
      this.state.phase = "sync";
      this.state.frameStartTime = result.startTime;
    }

    return null;
  }

  private detectPreambleWithAdaptiveTiming(
    audioSample: AudioSample,
  ): { startTime: number; symbolDuration: number } | null {
    // Test different timing parameters around the expected duration
    const baseDuration = this.config.symbolDuration;
    const testDurations = [
      baseDuration * 0.8, // 20% faster
      baseDuration * 0.9, // 10% faster
      baseDuration, // Spec timing
      baseDuration * 1.1, // 10% slower
      baseDuration * 1.2, // 20% slower
    ];

    // Scan through the audio with overlapping windows
    const windowSize = Math.floor(audioSample.sampleRate * 3.0); // 3 second windows
    const hopSize = Math.floor(audioSample.sampleRate * 0.1); // 100ms hops

    let bestResult: {
      startTime: number;
      symbolDuration: number;
      accuracy: number;
    } | null = null;

    for (
      let startSample = 0;
      startSample < audioSample.data.length - windowSize;
      startSample += hopSize
    ) {
      const windowData = audioSample.data.slice(
        startSample,
        startSample + windowSize,
      );
      const windowStartTime =
        audioSample.timestamp / 1000 + startSample / audioSample.sampleRate;

      const windowAudio = {
        data: windowData,
        sampleRate: audioSample.sampleRate,
        timestamp:
          audioSample.timestamp + (startSample / audioSample.sampleRate) * 1000,
      };

      // Test each duration
      for (const testDuration of testDurations) {
        const result = this.testPreambleAtTiming(
          windowAudio,
          windowStartTime,
          testDuration,
        );

        if (
          result &&
          result.accuracy > 0.8 &&
          (!bestResult || result.accuracy > bestResult.accuracy)
        ) {
          bestResult = result;
        }
      }
    }

    return bestResult
      ? {
          startTime: bestResult.startTime,
          symbolDuration: bestResult.symbolDuration,
        }
      : null;
  }

  private testPreambleAtTiming(
    audioSample: AudioSample,
    startTime: number,
    symbolDuration: number,
  ): { startTime: number; symbolDuration: number; accuracy: number } | null {
    const expectedPreamble = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0]; // 12 alternating symbols
    const symbolSamples = Math.floor(audioSample.sampleRate * symbolDuration);

    if (symbolSamples * expectedPreamble.length > audioSample.data.length) {
      return null; // Not enough data
    }

    const symbols: number[] = [];

    // Extract symbols at the test timing
    for (let i = 0; i < expectedPreamble.length; i++) {
      const sampleStart = i * symbolSamples;
      const sampleEnd = Math.min(
        sampleStart + symbolSamples,
        audioSample.data.length,
      );

      if (sampleStart >= audioSample.data.length) break;

      const symbolData = audioSample.data.slice(sampleStart, sampleEnd);

      const symbolAudio = {
        data: symbolData,
        sampleRate: audioSample.sampleRate,
        timestamp: audioSample.timestamp,
      };

      const detections = this.toneDetector.detectTones(symbolAudio);

      // Find best binary symbol (only 0 or 2 for preamble)
      let bestSymbol = -1;
      let bestConfidence = 0;

      for (const detection of detections) {
        const [f0, _, f2] = this.config.toneFrequencies;
        let symbol = -1;

        if (Math.abs(detection.frequency - f0) < 100) symbol = 0;
        else if (Math.abs(detection.frequency - f2) < 100) symbol = 2;

        if (
          symbol >= 0 &&
          detection.confidence > bestConfidence &&
          detection.confidence > 0.7
        ) {
          bestSymbol = symbol;
          bestConfidence = detection.confidence;
        }
      }

      if (bestSymbol >= 0) {
        symbols.push(bestSymbol);
      } else {
        return null; // Failed to detect symbol
      }
    }

    // Calculate accuracy
    let matches = 0;
    for (let i = 0; i < expectedPreamble.length && i < symbols.length; i++) {
      if (symbols[i] === expectedPreamble[i]) matches++;
    }

    const accuracy = symbols.length > 0 ? matches / symbols.length : 0;

    return accuracy > 0.8
      ? {
          startTime,
          symbolDuration,
          accuracy,
        }
      : null;
  }

  private processSync(audioSample: AudioSample): Frame | null {
    if (!this.measuredSymbolDuration || !this.transmissionStartTime) {
      return null;
    }

    // Extract sync sequence (13 symbols after preamble)
    const preambleLength = 12;
    const syncLength = 13;
    const syncStartTime =
      this.transmissionStartTime + preambleLength * this.measuredSymbolDuration;

    const syncResult = this.extractSequence(
      audioSample,
      syncStartTime,
      syncLength,
      this.measuredSymbolDuration,
    );

    if (syncResult) {
      const expectedSync = [2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2]; // Barker-13
      const accuracy = this.calculateAccuracy(syncResult, expectedSync);

      if (accuracy >= 0.7) {
        console.log(
          "✅ Sync detected with",
          (accuracy * 100).toFixed(1) + "% accuracy",
        );
        this.state.phase = "header";
        return null;
      }
    }

    return null;
  }

  private processHeader(audioSample: AudioSample): Frame | null {
    if (!this.measuredSymbolDuration || !this.transmissionStartTime) {
      return null;
    }

    // Extract header sequence (11 symbols after preamble + sync)
    const headerStartSymbols = 12 + 13; // preamble + sync
    const headerLength = 11;
    const headerStartTime =
      this.transmissionStartTime +
      headerStartSymbols * this.measuredSymbolDuration;

    const headerResult = this.extractSequence(
      audioSample,
      headerStartTime,
      headerLength,
      this.measuredSymbolDuration,
    );

    if (headerResult) {
      console.log("📋 Header detected:", headerResult.join(","));
      this.state.phase = "payload";
      return null;
    }

    return null;
  }

  private processPayload(audioSample: AudioSample): Frame | null {
    // Payload processing would go here
    console.log("📦 Processing payload...");
    return null;
  }

  private extractSequence(
    audioSample: AudioSample,
    startTime: number,
    length: number,
    symbolDuration: number,
  ): number[] | null {
    const symbols: number[] = [];
    const symbolSamples = Math.floor(audioSample.sampleRate * symbolDuration);
    const audioStartTime = audioSample.timestamp / 1000;

    for (let i = 0; i < length; i++) {
      const symbolTime = startTime + i * symbolDuration;
      const sampleOffset = Math.floor(
        (symbolTime - audioStartTime) * audioSample.sampleRate,
      );

      if (
        sampleOffset < 0 ||
        sampleOffset + symbolSamples >= audioSample.data.length
      ) {
        continue; // Symbol not in this audio chunk
      }

      const symbolData = audioSample.data.slice(
        sampleOffset,
        sampleOffset + symbolSamples,
      );

      const symbolAudio = {
        data: symbolData,
        sampleRate: audioSample.sampleRate,
        timestamp: audioSample.timestamp,
      };

      const detections = this.toneDetector.detectTones(symbolAudio);

      let bestSymbol = -1;
      let bestConfidence = 0;

      for (const detection of detections) {
        const [f0, f1, f2] = this.config.toneFrequencies;
        let symbol = -1;

        if (Math.abs(detection.frequency - f0) < 100) symbol = 0;
        else if (Math.abs(detection.frequency - f1) < 100) symbol = 1;
        else if (Math.abs(detection.frequency - f2) < 100) symbol = 2;

        if (symbol >= 0 && detection.confidence > bestConfidence) {
          bestSymbol = symbol;
          bestConfidence = detection.confidence;
        }
      }

      if (bestSymbol >= 0 && bestConfidence > 0.5) {
        symbols.push(bestSymbol);
      }
    }

    return symbols.length === length ? symbols : null;
  }

  private calculateAccuracy(actual: number[], expected: number[]): number {
    if (actual.length !== expected.length) return 0;

    let matches = 0;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] === expected[i]) matches++;
    }

    return matches / actual.length;
  }

  getState(): DecoderState {
    return { ...this.state };
  }

  getMeasuredTiming(): { symbolDuration: number; startTime: number } | null {
    if (this.measuredSymbolDuration && this.transmissionStartTime) {
      return {
        symbolDuration: this.measuredSymbolDuration,
        startTime: this.transmissionStartTime,
      };
    }
    return null;
  }

  reset(): void {
    this.state = {
      phase: "searching",
      symbolBuffer: [],
      estimatedSymbolDuration: this.config.symbolDuration,
      estimatedFrequencies: [...this.config.toneFrequencies] as [
        number,
        number,
        number,
      ],
      frameStartTime: 0,
    };

    this.measuredSymbolDuration = undefined;
    this.transmissionStartTime = undefined;
  }
}
