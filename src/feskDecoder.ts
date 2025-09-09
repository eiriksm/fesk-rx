import { ToneDetector } from "./toneDetector";
import { PreambleDetector } from "./preambleDetector";
import { SyncDetector } from "./syncDetector";
import { AudioSample, Frame, SymbolDetection, ToneDetection } from "./types";
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

  /**
   * Process continuous audio data automatically and return when frame is decoded
   * @param audioData Full audio data to process
   * @param sampleRate Audio sample rate
   * @param chunkSizeMs Size of processing chunks in milliseconds (default: 100ms)
   * @returns Promise that resolves with decoded frame or null if no valid frame found
   */
  async processAudioComplete(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeMs: number = 100,
  ): Promise<Frame | null> {
    const chunkSize = Math.floor(sampleRate * (chunkSizeMs / 1000));
    let chunkCount = 0;

    for (let i = 0; i < audioData.length; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, audioData.length);
      const chunk = audioData.slice(i, chunkEnd);

      if (chunk.length < chunkSize) break;

      const timestamp = chunkCount * chunkSizeMs;
      const audioSample: AudioSample = {
        data: chunk,
        timestamp,
        sampleRate,
      };

      const frame = this.processAudio(audioSample);

      if (frame && frame.isValid) {
        return frame;
      }

      chunkCount++;
      // Safety limit - don't process more than 30 seconds of audio
      if (chunkCount > 30000 / chunkSizeMs) break;

      // Yield to event loop every 10 chunks to keep UI responsive
      if (chunkCount % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return null;
  }

  /**
   * Process WAV file directly from file path
   * @param wavPath Path to WAV file
   * @param offsetSec Audio offset in seconds (default: 0)
   * @param chunkSizeMs Processing chunk size in milliseconds (default: 100ms)
   * @returns Promise that resolves with decoded frame or null
   */
  async processWavFile(
    wavPath: string,
    offsetSec: number = 0,
    chunkSizeMs: number = 100,
  ): Promise<Frame | null> {
    const { WavReader } = await import("./utils/wavReader");
    const audioData = await WavReader.readWavFileWithOffset(wavPath, offsetSec);
    return this.processAudioComplete(
      audioData.data,
      audioData.sampleRate,
      chunkSizeMs,
    );
  }

  /**
   * Find the start of transmission in audio buffer using energy detection
   * @param audioData Float32Array of audio samples
   * @param sampleRate Audio sample rate in Hz
   * @param energyThreshold Energy threshold for detection (default: 0.01)
   * @returns Time in milliseconds when transmission starts, or null if not found
   */
  findTransmissionStart(
    audioData: Float32Array,
    sampleRate: number,
    energyThreshold: number = 0.01,
  ): number | null {
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows

    for (let i = 0; i < audioData.length - windowSize; i += windowSize) {
      const chunk = audioData.slice(i, i + windowSize);

      // Calculate RMS energy
      let energy = 0;
      for (const sample of chunk) {
        energy += sample * sample;
      }
      energy = Math.sqrt(energy / chunk.length);

      // If energy exceeds threshold, this is likely the start
      if (energy > energyThreshold) {
        return (i / sampleRate) * 1000;
      }
    }

    return null;
  }

  /**
   * Find the start of transmission in a WAV file
   * @param wavPath Path to WAV file
   * @param energyThreshold Energy threshold for detection (default: 0.01)
   * @returns Promise that resolves with time in milliseconds when transmission starts, or null if not found
   */
  async findTransmissionStartFromWav(
    wavPath: string,
    energyThreshold: number = 0.01,
  ): Promise<number | null> {
    const { WavReader } = await import("./utils/wavReader");
    const audioData = await WavReader.readWavFile(wavPath);
    return this.findTransmissionStart(
      audioData.data,
      audioData.sampleRate,
      energyThreshold,
    );
  }

  /**
   * Extract symbols from audio file at specified offset
   * @param wavPath Path to WAV file
   * @param startOffsetSeconds Start time in seconds (0 = beginning of file)
   * @returns Array of detected symbol indices (0, 1, 2)
   */
  async extractSymbolsFromWav(
    wavPath: string,
    startOffsetSeconds: number = 0
  ): Promise<number[]> {
    const { WavReader } = await import("./utils/wavReader");
    const audioData = await WavReader.readWavFileWithOffset(wavPath, startOffsetSeconds);
    
    const audioSample = {
      data: audioData.data,
      sampleRate: audioData.sampleRate,
      timestamp: startOffsetSeconds * 1000 // Convert to ms
    };
    
    return this.toneDetector.extractSymbols(audioSample, 0);
  }

  /**
   * Complete WAV-to-symbols pipeline: detect transmission start and extract symbols
   * @param wavPath Path to WAV file  
   * @returns Object with detected start time and extracted symbols
   */
  async decodeSymbolsFromWav(
    wavPath: string
  ): Promise<{ startTime: number; symbols: number[] } | null> {
    // First detect transmission start
    const startTime = await this.findTransmissionStartFromWav(wavPath);
    if (startTime === null) {
      return null;
    }
    
    const startSeconds = startTime / 1000; // Convert ms to seconds
    
    // Extract symbols from the detected start point
    const symbols = await this.extractSymbolsFromWav(wavPath, startSeconds);
    
    return {
      startTime,
      symbols
    };
  }

  /**
   * Get current decoding progress information
   * @returns Object with phase, progress percentage, and current trit count
   */
  getProgress(): {
    phase: string;
    progressPercent: number;
    tritCount: number;
    estimatedComplete: boolean;
  } {
    const minTritsForDecode = 20;
    // const maxExpectedTrits = 200; // Reasonable upper bound

    let progressPercent = 0;
    let estimatedComplete = false;

    if (this.state.phase === "payload") {
      progressPercent = Math.min(
        (this.state.tritCount / minTritsForDecode) * 100,
        100,
      );
      estimatedComplete = this.state.tritCount >= minTritsForDecode;
    } else if (this.state.phase === "sync") {
      progressPercent = 10; // Made it past preamble
    }

    return {
      phase: this.state.phase,
      progressPercent,
      tritCount: this.state.tritCount,
      estimatedComplete,
    };
  }

  /**
   * Check if decoder is ready to attempt frame decode
   * @returns True if enough data has been collected to attempt decoding
   */
  isReadyToDecode(): boolean {
    return this.state.phase === "payload" && this.state.tritBuffer.length >= 20;
  }

  /**
   * Force attempt to decode current buffer (useful for partial frames)
   * @returns Decoded frame or null if unsuccessful
   */
  forceAttemptDecode(): Frame | null {
    if (this.state.tritBuffer.length === 0) {
      return null;
    }
    return this.attemptDecode();
  }

  private handleSearchingPhase(
    toneDetections: ToneDetection[],
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
    toneDetections: ToneDetection[],
    timestamp: number,
  ): Frame | null {
    // Use symbol decimation - take the best detection per chunk (same as preamble detector)
    if (toneDetections.length > 0) {
      const bestDetection = toneDetections.reduce(
        (best: ToneDetection, current: ToneDetection) =>
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
    toneDetections: ToneDetection[],
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
            (best: ToneDetection, current: ToneDetection) =>
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
    } catch {
      // Decoding failed, need more data
      return null;
    }
  }

  private removePilots(trits: number[]): number[] {
    const interval = 64; // FESK_PILOT_INTERVAL
    if (interval <= 0) return trits.slice();

    const out: number[] = [];
    let dataCount = 0;
    let i = 0;

    while (i < trits.length) {
      if (dataCount > 0 && dataCount % interval === 0) {
        const p0 = trits[i],
          p1 = trits[i + 1];
        if (p0 === 0 && p1 === 2) i += 2; // drop [0,2]
      }
      if (i >= trits.length) break;
      out.push(trits[i++]); // count only data trits
      dataCount++;
    }
    return out;
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
   * Process a complete transmission sequence (preamble + sync + payload)
   * @param symbols Complete symbol sequence including preamble, sync, and payload
   * @returns Decoded frame or null if unsuccessful
   */
  processCompleteTransmission(symbols: number[]): Frame | null {
    this.reset();

    const chunkSizeMs = 100;
    let currentTime = 0;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const timestamp = currentTime;

      // Create mock tone detection for this symbol
      const mockToneDetection = {
        frequency: this.state.estimatedFrequencies[symbol],
        magnitude: 1.0,
        confidence: 1.0,
      };

      // Process through the phase handlers directly
      let result: Frame | null = null;

      switch (this.state.phase) {
        case "searching":
          result = this.handleSearchingPhase([mockToneDetection], timestamp);
          break;

        case "sync":
          result = this.handleSyncPhase([mockToneDetection], timestamp);
          break;

        case "payload":
          result = this.handlePayloadPhase([mockToneDetection], timestamp);
          break;
      }

      if (result && result.isValid) {
        return result;
      }

      currentTime += chunkSizeMs;

      // Safety limit
      if (i > 1000) break;
    }

    return null;
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
      // Use chunked approach for long sequences to avoid mathematical precision issues
      const allBytes =
        trits.length > 50
          ? CanonicalTritDecoder.decodeLongSequence(trits)
          : (() => {
              const decoder = new CanonicalTritDecoder();
              for (const trit of trits) {
                decoder.addTrit(trit);
              }
              return decoder.getBytes();
            })();
      if (allBytes.length < 4) {
        return null;
      }

      // Descramble header+payload continuously (as per TX algorithm)
      // The TX scrambler is continuous, so RX must descramble in one pass
      const descrambler = new LFSRDescrambler();

      // Get payload length first to know how much to descramble
      const tempDescrambler = new LFSRDescrambler();
      const headerHi = tempDescrambler.descrambleByte(allBytes[0]);
      const headerLo = tempDescrambler.descrambleByte(allBytes[1]);
      const payloadLength = (headerHi << 8) | headerLo;

      // Validate payload length and total size
      if (
        payloadLength <= 0 ||
        payloadLength > 64 ||
        allBytes.length < 2 + payloadLength + 2
      ) {
        return null;
      }

      // Descramble header+payload continuously
      const headerAndPayloadScrambled = allBytes.slice(0, 2 + payloadLength);
      const headerAndPayload = new Uint8Array(2 + payloadLength);
      for (let i = 0; i < headerAndPayload.length; i++) {
        headerAndPayload[i] = descrambler.descrambleByte(
          headerAndPayloadScrambled[i],
        );
      }

      // Extract payload (skip header)
      const payload = headerAndPayload.slice(2);

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
    } catch {
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
