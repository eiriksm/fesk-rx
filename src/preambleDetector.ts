import { ToneDetection, SymbolDetection } from "./types";
import { FeskConfig } from "./config";

export class PreambleDetector {
  private config: FeskConfig;
  private symbolBuffer: SymbolDetection[];
  private lastSymbolTime: number;
  private estimatedSymbolDuration: number;

  constructor(config: FeskConfig) {
    this.config = config;
    this.symbolBuffer = [];
    this.lastSymbolTime = 0;
    this.estimatedSymbolDuration = config.symbolDuration;
  }

  processToneDetections(
    detections: ToneDetection[],
    timestamp: number,
  ): PreambleDetectionResult | null {
    // Convert tone detections to symbols - pick the best one per chunk
    if (detections.length > 0) {
      // Find the detection with highest confidence
      const bestDetection = detections.reduce((best, current) =>
        current.confidence > best.confidence ? current : best,
      );

      const symbol = this.toneToSymbol(bestDetection.frequency);
      if (symbol !== null) {
        this.addSymbol({
          symbol,
          confidence: bestDetection.confidence,
          timestamp,
        });
      }
    }

    return this.checkForPreamble();
  }

  private toneToSymbol(frequency: number): number | null {
    const [f0, f1, f2] = this.config.toneFrequencies;
    const tolerance = 50; // Hz tolerance

    if (Math.abs(frequency - f0) < tolerance) return 0;
    if (Math.abs(frequency - f1) < tolerance) return 1;
    if (Math.abs(frequency - f2) < tolerance) return 2;

    return null;
  }

  private addSymbol(symbol: SymbolDetection): void {
    // Remove old symbols (keep only recent ones for timing estimation)
    // Use a much longer time window since our chunks are 100ms apart
    const maxAge = this.config.symbolDuration * 1000 * 20; // Convert to ms, keep last 20 symbol periods
    this.symbolBuffer = this.symbolBuffer.filter(
      (s) => symbol.timestamp - s.timestamp < maxAge,
    );

    // Add new symbol
    this.symbolBuffer.push(symbol);
    // Symbol added to buffer

    // Update timing estimation if we have enough symbols
    this.updateTimingEstimate();
  }

  private updateTimingEstimate(): void {
    if (this.symbolBuffer.length < 3) return;

    // Calculate average time between symbols - be more flexible with timing
    const intervals: number[] = [];
    for (let i = 1; i < this.symbolBuffer.length; i++) {
      const interval =
        this.symbolBuffer[i].timestamp - this.symbolBuffer[i - 1].timestamp;

      // More flexible timing tolerance - allow 25% to 200% of expected duration
      const expectedMs = this.config.symbolDuration * 1000;
      if (interval > expectedMs * 0.25 && interval < expectedMs * 2.0) {
        intervals.push(interval);
      }
    }

    if (intervals.length > 0) {
      const avgIntervalMs =
        intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
      this.estimatedSymbolDuration = avgIntervalMs / 1000; // Convert back to seconds

      // Clamp to reasonable range
      this.estimatedSymbolDuration = Math.max(
        0.05,
        Math.min(0.2, this.estimatedSymbolDuration),
      );
    }
  }

  private checkForPreamble(): PreambleDetectionResult | null {
    if (this.symbolBuffer.length < this.config.preambleBits.length) {
      return null;
    }

    // Look for preamble pattern in recent symbols
    // Preamble uses only f0 (symbol 0) and f2 (symbol 2) for binary 1010... pattern
    const recentSymbols = this.symbolBuffer.slice(
      -this.config.preambleBits.length,
    );

    // Check if we have the alternating pattern
    let matches = 0;
    let totalConfidence = 0;

    for (let i = 0; i < this.config.preambleBits.length; i++) {
      const expectedBit = this.config.preambleBits[i];
      const expectedSymbol = expectedBit === 1 ? 2 : 0; // 1 -> f2 (symbol 2), 0 -> f0 (symbol 0)

      if (recentSymbols[i].symbol === expectedSymbol) {
        matches++;
        totalConfidence += recentSymbols[i].confidence;
      }
    }

    const matchRatio = matches / this.config.preambleBits.length;
    const avgConfidence = totalConfidence / this.config.preambleBits.length;

    // More flexible preamble detection thresholds
    if (matchRatio >= 0.75 && avgConfidence >= 0.4) {
      // Lowered thresholds for real audio
      const startTime = recentSymbols[0].timestamp;
      const endTime = recentSymbols[recentSymbols.length - 1].timestamp;

      return {
        detected: true,
        startTime,
        endTime,
        confidence: avgConfidence,
        estimatedSymbolDuration: this.estimatedSymbolDuration,
        estimatedFrequencies: this.estimateFrequencies(),
      };
    }

    return null;
  }

  private estimateFrequencies(): [number, number, number] {
    // Analyze recent symbols to refine frequency estimates
    const frequencies = new Map<number, number[]>();

    // Collect frequencies for each symbol type
    for (const symbol of this.symbolBuffer.slice(-20)) {
      // Last 20 symbols
      if (!frequencies.has(symbol.symbol)) {
        frequencies.set(symbol.symbol, []);
      }
      // We don't have the original frequency here, so we'll use config values
      // In a real implementation, we'd store the detected frequency with each symbol
    }

    // For now, return the configured frequencies
    // TODO: Implement frequency refinement based on actual detections
    return [...this.config.toneFrequencies] as [number, number, number];
  }

  reset(): void {
    this.symbolBuffer = [];
    this.lastSymbolTime = 0;
    this.estimatedSymbolDuration = this.config.symbolDuration;
  }
}

export interface PreambleDetectionResult {
  detected: boolean;
  startTime: number;
  endTime: number;
  confidence: number;
  estimatedSymbolDuration: number;
  estimatedFrequencies: [number, number, number];
}
