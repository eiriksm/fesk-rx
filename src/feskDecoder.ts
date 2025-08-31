import { ToneDetector } from "./toneDetector";
import { PreambleDetector } from "./preambleDetector";
import { SyncDetector } from "./syncDetector";
import { AudioSample, Frame, SymbolDetection } from "./types";
import { FeskConfig, DEFAULT_CONFIG } from "./config";
import { CanonicalTritDecoder } from "./utils/canonicalTritDecoder";
import { LFSRDescrambler } from "./utils/lfsrDescrambler";
import { CRC16 } from "./utils/crc16";

export interface DecoderState {
  phase: "searching" | "sync" | "payload";
  tritBuffer: number[];
  estimatedSymbolDuration: number;
  estimatedFrequencies: [number, number, number];
  frameStartTime: number;
  tritCount: number;
}

interface SymbolCandidate {
  symbol: number;
  confidence: number;
  timestamp: number;
}

/**
 * Complete FESK decoder implementing the new TX format
 */
export class FeskDecoder {
  private config: FeskConfig;
  private toneDetector: ToneDetector;
  private preambleDetector: PreambleDetector;
  private syncDetector: SyncDetector;
  private state: DecoderState;
  private symbolCandidates: SymbolCandidate[] = [];
  private lastCommittedSymbolTime: number = 0;
  private timingOptimized: boolean = false;

  constructor(config: FeskConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.toneDetector = new ToneDetector(config);
    this.preambleDetector = new PreambleDetector(config);
    this.syncDetector = new SyncDetector(config);

    this.state = {
      phase: "searching",
      tritBuffer: [],
      estimatedSymbolDuration: config.symbolDuration,
      estimatedFrequencies: [...config.toneFrequencies] as [
        number,
        number,
        number,
      ],
      frameStartTime: 0,
      tritCount: 0,
    };
  }

  /**
   * Process audio sample and attempt to decode FESK frame
   */
  processAudio(audioSample: AudioSample): Frame | null {
    const toneDetections = this.toneDetector.detectTones(audioSample);

    if (toneDetections.length === 0) {
      return null;
    }

    switch (this.state.phase) {
      case "searching":
        return this.handleSearchingPhase(toneDetections, audioSample.timestamp);

      case "sync":
        return this.handleSyncPhase(toneDetections, audioSample.timestamp);

      case "payload":
        return this.handlePayloadPhase(toneDetections, audioSample.timestamp);

      default:
        return null;
    }
  }

  private handleSearchingPhase(
    toneDetections: any[],
    timestamp: number,
  ): Frame | null {
    const preambleResult = this.preambleDetector.processToneDetections(
      toneDetections,
      timestamp,
    );

    if (preambleResult?.detected) {
      console.log("Preamble detected! Transitioning to sync phase...");
      this.state.phase = "sync";
      this.state.estimatedSymbolDuration =
        preambleResult.estimatedSymbolDuration;
      this.state.estimatedFrequencies = preambleResult.estimatedFrequencies;
      this.state.frameStartTime = preambleResult.startTime;
      this.syncDetector.reset();
    }

    return null;
  }

  private handleSyncPhase(
    toneDetections: any[],
    timestamp: number,
  ): Frame | null {
    // Use symbol decimation - take the best detection per chunk (same as preamble detector)
    if (toneDetections.length > 0) {
      const bestDetection = toneDetections.reduce((best: any, current: any) =>
        current.confidence > best.confidence ? current : best,
      );

      const symbol = this.toneToSymbol(bestDetection.frequency);
      if (symbol !== null) {
        const symbolDetection: SymbolDetection = {
          symbol,
          confidence: bestDetection.confidence,
          timestamp,
        };

        const syncResult = this.syncDetector.addSymbol(symbolDetection);
        if (syncResult?.detected) {
          console.log("Sync detected! Transitioning to payload phase...");
          this.state.phase = "payload";
          this.state.tritBuffer = [];
          this.state.tritCount = 0;
          this.symbolCandidates = [];
          this.lastCommittedSymbolTime = timestamp;
          return null;
        }
      }
    }

    return null;
  }

  private handlePayloadPhase(
    toneDetections: any[],
    timestamp: number,
  ): Frame | null {
    // Collect symbol candidates from all detections in this chunk
    const candidates: SymbolCandidate[] = [];

    for (const detection of toneDetections) {
      const symbol = this.toneToSymbol(detection.frequency);
      if (symbol !== null) {
        candidates.push({
          symbol,
          confidence: detection.confidence,
          timestamp,
        });
      }
    }

    // Add candidates to our voting window
    this.symbolCandidates.push(...candidates);

    // Remove old candidates (keep only last 300ms worth)
    const windowTimeMs = 300;
    this.symbolCandidates = this.symbolCandidates.filter(
      (candidate) => timestamp - candidate.timestamp < windowTimeMs,
    );

    // Commit symbol every 100ms (symbol period)
    const symbolPeriodMs = 100;
    if (timestamp - this.lastCommittedSymbolTime >= symbolPeriodMs) {
      const committedSymbol = this.performMajorityVoting(timestamp);

      if (committedSymbol !== null) {
        // Check for pilot sequences [0,2] every 64 trits
        if (this.state.tritCount > 0 && this.state.tritCount % 64 === 0) {
          if (committedSymbol === 0) {
            console.log(
              `Potential pilot start at trit ${this.state.tritCount}`,
            );
          }
        }

        this.state.tritBuffer.push(committedSymbol);
        this.state.tritCount++;
        this.lastCommittedSymbolTime = timestamp;

        // Try to decode when we have enough data
        if (this.state.tritBuffer.length >= 20) {
          const frame = this.attemptDecode();
          if (frame) {
            this.reset();
            return frame;
          }
        }
      } else {
        // Fall back to simple best detection if majority voting fails
        if (toneDetections.length > 0) {
          const bestDetection = toneDetections.reduce(
            (best: any, current: any) =>
              current.confidence > best.confidence ? current : best,
          );

          const symbol = this.toneToSymbol(bestDetection.frequency);
          if (symbol !== null) {
            this.state.tritBuffer.push(symbol);
            this.state.tritCount++;
            this.lastCommittedSymbolTime = timestamp;

            // Try to decode when we have enough data
            if (this.state.tritBuffer.length >= 20) {
              const frame = this.attemptDecode();
              if (frame) {
                this.reset();
                return frame;
              }
            }
          }
        }
      }
    }

    return null;
  }

  private performMajorityVoting(currentTimestamp: number): number | null {
    if (this.symbolCandidates.length === 0) {
      return null;
    }

    // Only consider recent candidates (last 120ms for tighter focus)
    const recentCandidates = this.symbolCandidates.filter(
      (candidate) => currentTimestamp - candidate.timestamp < 120,
    );

    if (recentCandidates.length === 0) {
      return null;
    }

    // For synthetic audio or single detections, just return the best recent candidate
    if (recentCandidates.length === 1) {
      return recentCandidates[0].symbol;
    }

    // Count votes for each symbol, weighted by confidence and recency
    const votes = new Map<number, number>();

    for (const candidate of recentCandidates) {
      // Weight heavily by confidence and recency
      const age = currentTimestamp - candidate.timestamp;
      const recencyWeight = Math.exp(-age / 40); // Faster decay over 40ms

      // Square the confidence to emphasize high-confidence detections
      const weight = Math.pow(candidate.confidence, 1.5) * recencyWeight;

      votes.set(candidate.symbol, (votes.get(candidate.symbol) || 0) + weight);
    }

    // Find symbol with highest weighted vote
    let bestSymbol: number | null = null;
    let bestScore = 0;

    for (const [symbol, score] of votes.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestSymbol = symbol;
      }
    }

    return bestSymbol;
  }

  private attemptDecode(): Frame | null {
    try {
      // Remove pilots from trit buffer
      const cleanedTrits = this.removePilots(this.state.tritBuffer);

      // Convert trits to bytes using canonical MS-first algorithm
      const decoder = new CanonicalTritDecoder();
      for (const trit of cleanedTrits) {
        decoder.addTrit(trit);
      }

      const allBytes = decoder.getBytes();
      if (allBytes.length < 4) {
        // Need at least header + minimal payload + CRC
        return null;
      }

      // Parse header to get payload length
      const descrambler = new LFSRDescrambler();
      const headerHi = descrambler.descrambleByte(allBytes[0]);
      const headerLo = descrambler.descrambleByte(allBytes[1]);
      const payloadLength = (headerHi << 8) | headerLo;

      // Validate payload length and total size
      if (
        payloadLength <= 0 ||
        payloadLength > 64 ||
        allBytes.length < 2 + payloadLength + 2
      ) {
        return null; // Not enough data yet or invalid
      }

      // Descramble payload
      const payloadScrambled = allBytes.slice(2, 2 + payloadLength);
      const payload = new Uint8Array(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        payload[i] = descrambler.descrambleByte(payloadScrambled[i]);
      }

      // Extract CRC (unscrambled in new format)
      const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
      const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
      const calculatedCrc = CRC16.calculate(payload);

      return {
        header: { payloadLength },
        payload,
        crc: receivedCrc,
        isValid: receivedCrc === calculatedCrc,
      };
    } catch (error) {
      // Decoding failed, need more data
      return null;
    }
  }

  private removePilots(trits: number[]): number[] {
    const PILOT_INTERVAL = 64;
    const cleaned: number[] = [];
    let dataCount = 0;
    let i = 0;

    while (i < trits.length) {
      // Check if we've reached a pilot interval
      if (dataCount > 0 && dataCount % PILOT_INTERVAL === 0) {
        // Look ahead for [0,2] pilot sequence
        if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
          i += 2; // Skip both pilot trits
          // DO NOT increment dataCount for pilots
          continue;
        }
        // Be tolerant: if pilots are missing, just keep going
      }

      // Add data trit and increment counter
      cleaned.push(trits[i]);
      dataCount++;
      i++;
    }

    return cleaned;
  }

  private toneToSymbol(frequency: number): number | null {
    const [f0, f1, f2] = this.state.estimatedFrequencies;
    const tolerance = 50; // Hz tolerance

    if (Math.abs(frequency - f0) < tolerance) return 0;
    if (Math.abs(frequency - f1) < tolerance) return 1;
    if (Math.abs(frequency - f2) < tolerance) return 2;

    return null;
  }

  getState(): DecoderState {
    return { ...this.state };
  }

  /**
   * Process a complete symbol sequence directly (for testing)
   * Skips preamble/sync detection and goes straight to payload processing
   */
  processSymbolSequence(symbols: number[]): Frame | null {
    // Reset to payload state
    this.state.phase = "payload";
    this.state.tritBuffer = [];
    this.state.tritCount = 0;

    // Add all symbols to trit buffer
    for (const symbol of symbols) {
      this.state.tritBuffer.push(symbol);
      this.state.tritCount++;
    }

    return this.attemptDecode();
  }

  /**
   * Decode a trit sequence directly (for testing)
   * Bypasses all protocol overhead and decodes raw payload trits
   */
  static decodeTrits(trits: number[]): Frame | null {
    const decoder = new FeskDecoder();

    // Use the private methods directly
    const cleanedTrits = decoder.removePilots(trits);
    return decoder.decodeTritsInternal(cleanedTrits);
  }

  private decodeTritsInternal(trits: number[]): Frame | null {
    try {
      // Convert trits to bytes using canonical MS-first algorithm
      const decoder = new CanonicalTritDecoder();
      for (const trit of trits) {
        decoder.addTrit(trit);
      }

      const allBytes = decoder.getBytes();
      if (allBytes.length < 4) {
        return null;
      }

      // Parse header to get payload length
      const descrambler = new LFSRDescrambler();
      const headerHi = descrambler.descrambleByte(allBytes[0]);
      const headerLo = descrambler.descrambleByte(allBytes[1]);
      const payloadLength = (headerHi << 8) | headerLo;

      // Validate payload length and total size
      if (
        payloadLength <= 0 ||
        payloadLength > 64 ||
        allBytes.length < 2 + payloadLength + 2
      ) {
        return null;
      }

      // Descramble payload
      const payloadScrambled = allBytes.slice(2, 2 + payloadLength);
      const payload = new Uint8Array(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        payload[i] = descrambler.descrambleByte(payloadScrambled[i]);
      }

      // Extract CRC (unscrambled in new format)
      const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
      const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
      const calculatedCrc = CRC16.calculate(payload);

      return {
        header: { payloadLength },
        payload,
        crc: receivedCrc,
        isValid: receivedCrc === calculatedCrc,
      };
    } catch (error) {
      return null;
    }
  }

  reset(): void {
    this.state = {
      phase: "searching",
      tritBuffer: [],
      estimatedSymbolDuration: this.config.symbolDuration,
      estimatedFrequencies: [...this.config.toneFrequencies] as [
        number,
        number,
        number,
      ],
      frameStartTime: 0,
      tritCount: 0,
    };

    this.symbolCandidates = [];
    this.lastCommittedSymbolTime = 0;
    this.timingOptimized = false;
    this.preambleDetector.reset();
    this.syncDetector.reset();
  }
}
