import { SymbolDetection } from "./types";
import { FeskConfig } from "./config";

export class SyncDetector {
  private config: FeskConfig;
  private symbolBuffer: SymbolDetection[];

  constructor(config: FeskConfig) {
    this.config = config;
    this.symbolBuffer = [];
  }

  addSymbol(symbol: SymbolDetection): SyncDetectionResult | null {
    // Add symbol to buffer
    this.symbolBuffer.push(symbol);

    // Keep buffer size manageable
    if (this.symbolBuffer.length > this.config.barker13.length * 2) {
      this.symbolBuffer = this.symbolBuffer.slice(-this.config.barker13.length);
    }

    return this.checkForSync();
  }

  private checkForSync(): SyncDetectionResult | null {
    if (this.symbolBuffer.length < this.config.barker13.length) {
      return null;
    }

    // Get the most recent symbols matching Barker-13 length
    const recentSymbols = this.symbolBuffer.slice(-this.config.barker13.length);

    // Convert symbols to binary bits for Barker-13 matching
    // Sync uses same binary alphabet as preamble: f0 = 0, f2 = 1
    const detectedBits: number[] = [];
    let totalConfidence = 0;

    for (const symbol of recentSymbols) {
      let bit: number;
      if (symbol.symbol === 0) {
        // f0
        bit = 0;
      } else if (symbol.symbol === 2) {
        // f2
        bit = 1;
      } else {
        // f1 (middle frequency) is not used in sync - this might be noise or error
        return null;
      }

      detectedBits.push(bit);
      totalConfidence += symbol.confidence;
    }

    // Check correlation with Barker-13 sequence
    const correlation = this.calculateCorrelation(
      detectedBits,
      this.config.barker13,
    );
    const avgConfidence = totalConfidence / recentSymbols.length;

    // Barker-13 has excellent autocorrelation properties
    // Perfect match gives correlation of 13, any 1-bit error gives correlation <= 1
    if (correlation >= 11 && avgConfidence >= 0.5) {
      // Allow for 1-2 bit errors
      return {
        detected: true,
        startTime: recentSymbols[0].timestamp,
        endTime: recentSymbols[recentSymbols.length - 1].timestamp,
        confidence: avgConfidence,
        correlation: correlation / this.config.barker13.length, // Normalize to 0-1
        bitErrors: this.config.barker13.length - correlation,
      };
    }

    return null;
  }

  private calculateCorrelation(detected: number[], expected: number[]): number {
    if (detected.length !== expected.length) {
      return 0;
    }

    let matches = 0;
    for (let i = 0; i < detected.length; i++) {
      if (detected[i] === expected[i]) {
        matches++;
      }
    }

    return matches;
  }

  reset(): void {
    this.symbolBuffer = [];
  }

  // Method to search for sync in a sliding window approach
  searchSync(symbols: SymbolDetection[]): SyncDetectionResult[] {
    const results: SyncDetectionResult[] = [];

    for (let i = 0; i <= symbols.length - this.config.barker13.length; i++) {
      const window = symbols.slice(i, i + this.config.barker13.length);

      // Convert to binary bits
      const bits: number[] = [];
      let totalConfidence = 0;
      let validWindow = true;

      for (const symbol of window) {
        if (symbol.symbol === 0) {
          bits.push(0);
        } else if (symbol.symbol === 2) {
          bits.push(1);
        } else {
          validWindow = false;
          break;
        }
        totalConfidence += symbol.confidence;
      }

      if (!validWindow) continue;

      const correlation = this.calculateCorrelation(bits, this.config.barker13);
      const avgConfidence = totalConfidence / window.length;

      if (correlation >= 11 && avgConfidence >= 0.5) {
        results.push({
          detected: true,
          startTime: window[0].timestamp,
          endTime: window[window.length - 1].timestamp,
          confidence: avgConfidence,
          correlation: correlation / this.config.barker13.length,
          bitErrors: this.config.barker13.length - correlation,
        });
      }
    }

    return results;
  }
}

export interface SyncDetectionResult {
  detected: boolean;
  startTime: number;
  endTime: number;
  confidence: number;
  correlation: number; // 0-1, normalized correlation score
  bitErrors: number; // Number of bit errors detected
}
