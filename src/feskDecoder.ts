import { ToneDetector } from "./toneDetector";
import { PreambleDetector } from "./preambleDetector";
import { SyncDetector } from "./syncDetector";
import { AudioSample, Frame, SymbolDetection, ToneDetection } from "./types";
import { FeskConfig, DEFAULT_CONFIG } from "./config";
import { CanonicalTritDecoder } from "./utils/canonicalTritDecoder";
import { LFSRDescrambler } from "./utils/lfsrDescrambler";
import { CRC16 } from "./utils/crc16";
import { Goertzel } from "./utils/goertzel";
import {
  SymbolExtractor,
  ToneFrequencySet,
  StartTimeRange,
  SymbolExtractionCandidate,
} from "./audio/symbolExtractor";

const HARDWARE_TONE_FREQUENCIES: [number, number, number] = [1200, 1600, 2000];

const ALIASED_TONE_FREQUENCIES: [number, number, number] = [4630, 9560, 14060];

const HIGH_ALIASED_TONES: [number, number, number] = [5525, 9188, 14062];

export interface SymbolExtractorDecodeOptions {
  frequencySets?: ToneFrequencySet[];
  symbolDurations?: number[];
  startTimeRange?: StartTimeRange;
  symbolsToExtract?: number;
  windowFraction?: number;
  minConfidence?: number;
  candidateOffsets?: number[];
}

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

interface PreambleCandidate {
  startSample: number;
  symbolDuration: number;
  matches: number;
  avgConfidence: number;
  score: number;
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
  private activeSymbolDuration!: number;
  private baseToneFrequencies: [number, number, number];

  constructor(config: FeskConfig = DEFAULT_CONFIG) {
    this.config = {
      ...config,
      toneFrequencies: [...config.toneFrequencies] as [number, number, number],
      preambleBits: [...config.preambleBits],
      barker13: [...config.barker13],
      pilotSequence: [...config.pilotSequence] as [number, number],
      adaptiveTiming: config.adaptiveTiming
        ? {
            ...config.adaptiveTiming,
            symbolDurationsMs: config.adaptiveTiming.symbolDurationsMs
              ? [...config.adaptiveTiming.symbolDurationsMs]
              : undefined,
            timingOffsetsMs: config.adaptiveTiming.timingOffsetsMs
              ? [...config.adaptiveTiming.timingOffsetsMs]
              : undefined,
          }
        : undefined,
    };

    this.toneDetector = new ToneDetector(this.config);
    this.preambleDetector = new PreambleDetector(this.config);
    this.syncDetector = new SyncDetector(this.config);

    this.baseToneFrequencies = [...this.config.toneFrequencies] as [
      number,
      number,
      number,
    ];
    this.setSymbolDuration(this.config.symbolDuration);

    this.state = {
      phase: "searching",
      tritBuffer: [],
      estimatedSymbolDuration: this.activeSymbolDuration,
      estimatedFrequencies: [...this.config.toneFrequencies] as [
        number,
        number,
        number,
      ],
      frameStartTime: 0,
      tritCount: 0,
    };
  }

  private setSymbolDuration(symbolDuration: number): void {
    this.activeSymbolDuration = symbolDuration;
    this.toneDetector.setSymbolDuration(symbolDuration);
    this.preambleDetector.setSymbolDuration(symbolDuration);
  }

  private setToneFrequencies(frequencies: [number, number, number]): void {
    const updated = [...frequencies] as [number, number, number];
    this.config.toneFrequencies = updated;
    this.state.estimatedFrequencies = updated;
  }

  private getSymbolExtractorFrequencySets(): ToneFrequencySet[] {
    return [
      {
        name: "default",
        tones: [...this.baseToneFrequencies] as [number, number, number],
      },
      {
        name: "hardware",
        tones: [...HARDWARE_TONE_FREQUENCIES],
      },
      {
        name: "alias_high",
        tones: [...HIGH_ALIASED_TONES],
      },
    ];
  }

  /**
   * Process audio sample and attempt to decode FESK frame
   */
  processAudio(audioSample: AudioSample): Frame | null {
    const toneDetections = this.toneDetector.detectTones(audioSample);

    // Continue processing in payload phase even with no detections (for symbol timing)
    if (toneDetections.length === 0 && this.state.phase !== "payload") {
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
  async processAudioCompleteBasic(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeMs: number = 100,
  ): Promise<Frame | null> {
    // First try the standard incremental approach
    const standardResult = await this.tryProcessAudioWithOffset(
      audioData,
      sampleRate,
      chunkSizeMs,
      0,
    );
    if (standardResult) {
      return standardResult;
    }

    // If standard approach fails, try symbol extraction approach (like the working manual method)
    return await this.trySymbolExtractionApproach(audioData, sampleRate);
  }

  private async trySymbolExtractionApproach(
    audioData: Float32Array,
    sampleRate: number,
  ): Promise<Frame | null> {
    // Check signal strength and apply amplification if needed
    let processedData = audioData;
    let maxAmplitude = 0;
    for (let i = 0; i < audioData.length; i++) {
      const abs = Math.abs(audioData[i]);
      if (abs > maxAmplitude) maxAmplitude = abs;
    }

    // If signal is very weak (max amplitude < 0.5), apply amplification
    if (maxAmplitude < 0.5 && maxAmplitude > 0) {
      const amplificationFactor = Math.min(10, 0.8 / maxAmplitude); // Cap at 10x, target 0.8 max
      processedData = audioData.map((val) =>
        Math.max(-1, Math.min(1, val * amplificationFactor)),
      );
    }

    // Use configurable adaptive timing parameters
    const adaptiveTiming = this.config.adaptiveTiming;
    const symbolDurationsToTest = adaptiveTiming?.symbolDurationsMs || [100];
    const offsetsToTest = adaptiveTiming?.timingOffsetsMs || [0];

    for (const symbolDurationMs of symbolDurationsToTest) {
      const symbolSamples = Math.floor(sampleRate * (symbolDurationMs / 1000));

      // For each symbol duration, try different timing offsets

      for (const offsetMs of offsetsToTest) {
        const offsetSamples = Math.floor((offsetMs / 1000) * sampleRate);
        const extractedSymbols = [];
        const maxSymbols = 350; // Process enough symbols for extremely long messages

        let leadingSilenceSymbols = 0;
        const maxLeadingSilence = 25;

        for (let i = 0; i < maxSymbols; i++) {
          const start = i * symbolSamples + offsetSamples;
          const end = Math.min(start + symbolSamples, processedData.length);

          if (start >= processedData.length || start < 0) break;

          const symbolChunk = processedData.slice(start, end);

          const audioSample = {
            data: symbolChunk,
            timestamp: i * symbolDurationMs,
            sampleRate: sampleRate,
          };

          const detections = this.toneDetector.detectTones(audioSample);

          if (detections.length > 0) {
            // Take the detection with highest confidence
            const bestDetection = detections.reduce((best, current) =>
              current.confidence > best.confidence ? current : best,
            );

            // Map frequency to symbol
            const symbol = this.toneToSymbol(bestDetection.frequency);
            if (symbol !== null) {
              extractedSymbols.push(symbol);
            }
            leadingSilenceSymbols = 0;
          } else {
            if (extractedSymbols.length === 0) {
              leadingSilenceSymbols++;
              if (leadingSilenceSymbols > maxLeadingSilence) {
                break;
              }
              continue;
            }
            // No detection after capturing symbols - end of transmission
            break;
          }
        }

        // If we got enough symbols, try to decode them
        if (extractedSymbols.length >= 25) {
          const decodeResult =
            this.decodeCompleteTransmission(extractedSymbols);

          if (decodeResult.frame && decodeResult.frame.isValid) {
            return decodeResult.frame;
          }
        }
      }
    }

    return null;
  }

  private async tryProcessAudioWithOffset(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeMs: number,
    offsetMs: number,
  ): Promise<Frame | null> {
    const chunkSize = Math.floor(sampleRate * (chunkSizeMs / 1000));
    const offsetSamples = Math.floor((offsetMs / 1000) * sampleRate);
    let chunkCount = 0;

    // Reset decoder state for this attempt
    this.reset();

    for (let i = offsetSamples; i < audioData.length; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, audioData.length);
      const chunk = audioData.slice(i, chunkEnd);

      // Skip empty chunks but allow smaller chunks at the end
      if (chunk.length === 0) {
        continue;
      }

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
      // Safety limit - don't process more than 60 seconds of audio for long messages
      if (chunkCount > 60000 / chunkSizeMs) {
        break;
      }

      // Yield to event loop every 10 chunks to keep UI responsive
      if (chunkCount % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Final decode attempt with whatever trits we have collected
    if (this.state.tritBuffer && this.state.tritBuffer.length >= 20) {
      const frame = this.attemptDecode();
      if (frame && frame.isValid) {
        return frame;
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

  async decodeWavFileWithSymbolExtractor(
    wavPath: string,
    options: SymbolExtractorDecodeOptions = {},
  ): Promise<Frame | null> {
    const { WavReader } = await import("./utils/wavReader");
    const audio = await WavReader.readWavFile(wavPath);
    return this.decodeWithSymbolExtractor(
      audio.data,
      audio.sampleRate,
      options,
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
    const windowSize = Math.floor(sampleRate * 0.025); // 25ms windows for better stability
    const stepSize = Math.floor(sampleRate * 0.005); // 5ms steps

    for (let i = 0; i < audioData.length - windowSize; i += stepSize) {
      const chunk = audioData.slice(i, i + windowSize);

      // Calculate RMS energy
      let energy = 0;
      for (const sample of chunk) {
        energy += sample * sample;
      }
      energy = Math.sqrt(energy / chunk.length);

      // If energy exceeds threshold, this is the start
      if (energy > energyThreshold) {
        // Found signal, now back up to find the actual onset
        // Look backward for the point where energy first rises significantly
        const backtrackSteps = Math.floor((0.1 * sampleRate) / stepSize); // Look back ~100ms
        let bestStart = i;

        for (
          let j = Math.max(0, i - backtrackSteps * stepSize);
          j <= i;
          j += stepSize
        ) {
          const testChunk = audioData.slice(j, j + windowSize);
          let testEnergy = 0;
          for (const sample of testChunk) {
            testEnergy += sample * sample;
          }
          testEnergy = Math.sqrt(testEnergy / testChunk.length);

          // Look for the first significant rise above noise floor
          if (testEnergy > energyThreshold * 0.3) {
            // 30% of threshold as noise floor
            bestStart = j;
            break;
          }
        }

        return (bestStart / sampleRate) * 1000;
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
    startOffsetSeconds: number = 0,
  ): Promise<number[]> {
    const { WavReader } = await import("./utils/wavReader");
    const audioData = await WavReader.readWavFileWithOffset(
      wavPath,
      startOffsetSeconds,
    );

    const audioSample = {
      data: audioData.data,
      sampleRate: audioData.sampleRate,
      timestamp: startOffsetSeconds * 1000, // Convert to ms
    };

    return this.toneDetector.extractSymbols(audioSample, 0);
  }

  /**
   * Complete WAV-to-symbols pipeline: detect transmission start and extract symbols
   * @param wavPath Path to WAV file
   * @returns Object with detected start time and extracted symbols
   */
  async decodeSymbolsFromWav(
    wavPath: string,
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
      symbols,
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
        this.state.tritBuffer.push(committedSymbol);
        this.state.tritCount++;
        this.lastCommittedSymbolTime = timestamp;

        // Try to decode when we have enough data
        // For max 256-byte payload, TX library uses up to 600 trits with headroom
        // Attempt decode at intervals, more frequently around expected lengths
        if (
          this.state.tritBuffer.length >= 20 &&
          (this.state.tritBuffer.length <= 100 ||
            this.state.tritBuffer.length % 25 === 0 ||
            (this.state.tritBuffer.length >= 290 &&
              this.state.tritBuffer.length <= 300))
        ) {
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
            // For max 256-byte payload, TX library uses up to 600 trits with headroom
            if (
              this.state.tritBuffer.length >= 20 &&
              (this.state.tritBuffer.length <= 100 ||
                this.state.tritBuffer.length % 25 === 0)
            ) {
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
      // Apply differential decoding to the trit buffer before converting to bytes
      const decodedTrits = this.differentialDecode(this.state.tritBuffer);

      // Convert trits to bytes using canonical MS-first algorithm
      const decoder = new CanonicalTritDecoder();
      for (const trit of decodedTrits) {
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

      // Validate payload length and total size (match TX library limit of 256 bytes)
      if (
        payloadLength <= 0 ||
        payloadLength > 256 ||
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

  /**
   * Apply differential decoding to a sequence of trits
   * Reverses the differential encoding: decoded = (encoded - last_encoded + 3) % 3
   */
  private differentialDecode(encodedTrits: number[]): number[] {
    const decodedTrits: number[] = [];
    let lastEncoded = 0; // Initialize to 0 as per TX implementation

    for (const encodedTrit of encodedTrits) {
      // Reverse differential encoding: decoded = (encoded - last_encoded + 3) % 3
      const decodedTrit = (encodedTrit - lastEncoded + 3) % 3;
      decodedTrits.push(decodedTrit);
      lastEncoded = encodedTrit;
    }

    return decodedTrits;
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
    return decoder.decodeTritsInternal(trits);
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

      // Validate payload length and total size (match TX library limit of 256 bytes)
      if (
        payloadLength <= 0 ||
        payloadLength > 256 ||
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
      estimatedSymbolDuration: this.activeSymbolDuration,
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

  /**
   * Decode a complete FESK transmission including preamble, sync, and payload validation
   * This is the primary method for decoding complete symbol sequences
   */
  decodeCompleteTransmission(symbols: number[]): {
    frame: Frame | null;
    preambleValid: boolean;
    syncValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (symbols.length < 25) {
      errors.push(
        `Insufficient symbols: expected at least 25, got ${symbols.length}`,
      );
      return { frame: null, preambleValid: false, syncValid: false, errors };
    }

    // Validate preamble (first 12 symbols)
    const preambleBits = symbols.slice(0, 12).map((s) => (s === 2 ? 1 : 0));
    const expectedPreamble = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const preambleValid =
      JSON.stringify(preambleBits) === JSON.stringify(expectedPreamble);

    if (!preambleValid) {
      errors.push(
        `Invalid preamble: expected ${expectedPreamble}, got ${preambleBits}`,
      );
    }

    // Validate sync pattern (symbols 12-24, 13 symbols total)
    const syncBits = symbols.slice(12, 25).map((s) => (s === 2 ? 1 : 0));
    const expectedSync = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1];
    const syncValid = JSON.stringify(syncBits) === JSON.stringify(expectedSync);

    if (!syncValid) {
      errors.push(`Invalid sync: expected ${expectedSync}, got ${syncBits}`);
    }

    // Extract payload trits (everything after preamble + sync)
    const payloadTrits = symbols.slice(25);

    if (payloadTrits.length === 0) {
      errors.push("No payload symbols found after preamble and sync");
      return { frame: null, preambleValid, syncValid, errors };
    }

    // Apply differential decoding to payload trits
    const decodedTrits = this.differentialDecode(payloadTrits);

    // Decode payload trits to frame
    let frame: Frame | null = null;
    try {
      frame = this.decodeTritsInternal(decodedTrits);
      if (!frame) {
        errors.push("Failed to decode payload trits to frame");
      }
    } catch (error) {
      errors.push(
        `Payload decoding error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { frame, preambleValid, syncValid, errors };
  }

  /**
   * Attempt to synchronize symbol timing based on preamble pattern
   * @param symbols Raw symbols to analyze
   * @param searchWindow Number of samples to search for timing adjustment
   * @returns Object with timing offset and confidence score
   */
  optimizeSymbolTiming(
    symbols: number[],
    searchWindow: number = 10,
  ): { offset: number; confidence: number; syncedSymbols: number[] } {
    const expectedPreamblePattern = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0]; // Raw symbols
    const expectedSyncPattern = [2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2]; // Raw symbols after preamble

    let bestOffset = 0;
    let bestConfidence = 0;
    let bestSymbols: number[] = [];

    // Try different timing offsets
    for (let offset = -searchWindow; offset <= searchWindow; offset++) {
      const adjustedSymbols = this.applyTimingOffset(symbols, offset);

      if (adjustedSymbols.length < 25) continue; // Need at least preamble + sync

      // Check preamble match
      const preambleMatch = this.calculatePatternMatch(
        adjustedSymbols.slice(0, 12),
        expectedPreamblePattern,
      );

      // Check sync match
      const syncMatch = this.calculatePatternMatch(
        adjustedSymbols.slice(12, 25),
        expectedSyncPattern,
      );

      const confidence = (preambleMatch + syncMatch) / 2;

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestOffset = offset;
        bestSymbols = adjustedSymbols;
      }
    }

    return {
      offset: bestOffset,
      confidence: bestConfidence,
      syncedSymbols: bestSymbols,
    };
  }

  /**
   * Apply timing offset to symbols by interpolating or decimating
   */
  private applyTimingOffset(symbols: number[], offset: number): number[] {
    if (offset === 0) return [...symbols];

    if (offset > 0) {
      // Positive offset: skip some symbols at start
      return symbols.slice(offset);
    } else {
      // Negative offset: duplicate some symbols at start (simple approach)
      const duplicateCount = Math.abs(offset);
      return [...Array(duplicateCount).fill(symbols[0]), ...symbols];
    }
  }

  /**
   * Calculate pattern match score between observed and expected symbols
   */
  private calculatePatternMatch(
    observed: number[],
    expected: number[],
  ): number {
    if (observed.length !== expected.length) return 0;

    const matches = observed.filter((sym, i) => sym === expected[i]).length;
    return matches / expected.length;
  }

  /**
   * Process audio with automatic chunk size optimization
   * Tries different chunk sizes to find the best decoding result
   * Chunk sizes are based on symbol duration for better alignment
   */
  async processAudioComplete(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeOrSizes: number | number[] | null = null,
    enableTimingSync: boolean = true,
  ): Promise<Frame | null> {
    const frequencySets = this.collectCandidateFrequencySets();
    const originalSymbolDuration = this.activeSymbolDuration;

    let bestFrame: Frame | null = null;

    for (const frequencies of frequencySets) {
      this.setToneFrequencies(frequencies);
      const frame = await this.processAudioCompleteForCurrentConfig(
        audioData,
        sampleRate,
        chunkSizeOrSizes,
        enableTimingSync,
      );

      if (frame) {
        if (frame.isValid) {
          this.setToneFrequencies(this.baseToneFrequencies);
          if (this.activeSymbolDuration !== originalSymbolDuration) {
            this.setSymbolDuration(originalSymbolDuration);
          }
          return frame;
        }
        if (!bestFrame) {
          bestFrame = frame;
        }
      }
    }

    this.setToneFrequencies(this.baseToneFrequencies);
    if (this.activeSymbolDuration !== originalSymbolDuration) {
      this.setSymbolDuration(originalSymbolDuration);
    }

    if (!bestFrame) {
      const extractorFrame = await this.decodeWithSymbolExtractor(
        audioData,
        sampleRate,
      );
      if (extractorFrame) {
        return extractorFrame;
      }
    }

    return bestFrame;
  }

  private async processAudioCompleteForCurrentConfig(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeOrSizes: number | number[] | null,
    enableTimingSync: boolean,
  ): Promise<Frame | null> {
    const attempts: Array<{
      data: Float32Array;
      offsetSamples: number;
      symbolDuration: number;
    }> = [
      {
        data: audioData,
        offsetSamples: 0,
        symbolDuration: this.activeSymbolDuration,
      },
    ];

    const candidateDurations = this.collectCandidateSymbolDurations();
    const preambleCandidates = this.findPreambleCandidates(
      audioData,
      sampleRate,
      candidateDurations,
    );

    const seenKeys = new Set<string>([
      `0-${this.activeSymbolDuration.toFixed(6)}`,
    ]);
    const maxAdditionalAttempts = 8;

    for (const candidate of preambleCandidates) {
      const symbolSamples = Math.max(
        1,
        Math.floor(candidate.symbolDuration * sampleRate),
      );
      const preBufferSamples = Math.min(
        symbolSamples * 2,
        candidate.startSample,
      );
      const offsetSamples = Math.max(
        candidate.startSample - preBufferSamples,
        0,
      );
      const key = `${offsetSamples}-${candidate.symbolDuration.toFixed(6)}`;

      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      attempts.push({
        data: audioData.slice(offsetSamples),
        offsetSamples,
        symbolDuration: candidate.symbolDuration,
      });

      if (attempts.length - 1 >= maxAdditionalAttempts) {
        break;
      }
    }

    let bestFrame: Frame | null = null;

    for (const attempt of attempts) {
      const previousDuration = this.activeSymbolDuration;
      if (attempt.symbolDuration !== previousDuration) {
        this.setSymbolDuration(attempt.symbolDuration);
      }

      const frame = await this.runProcessAudioComplete(
        attempt.data,
        sampleRate,
        chunkSizeOrSizes,
        enableTimingSync,
      );

      if (attempt.symbolDuration !== previousDuration) {
        this.setSymbolDuration(previousDuration);
      }

      if (frame) {
        if (frame.isValid) {
          return frame;
        }
        if (!bestFrame) {
          bestFrame = frame;
        }
      }
    }

    if (preambleCandidates.length > 0) {
      const fallbackFrame = await this.decodeWithPreambleCandidates(
        audioData,
        sampleRate,
        preambleCandidates,
      );

      if (fallbackFrame) {
        if (fallbackFrame.isValid) {
          return fallbackFrame;
        }
        if (!bestFrame) {
          bestFrame = fallbackFrame;
        }
      }
    }

    return bestFrame;
  }

  private async runProcessAudioComplete(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeOrSizes: number | number[] | null,
    enableTimingSync: boolean,
  ): Promise<Frame | null> {
    if (typeof chunkSizeOrSizes === "number") {
      return await this.processAudioCompleteBasic(
        audioData,
        sampleRate,
        chunkSizeOrSizes,
      );
    }

    const symbolDurationMs = this.activeSymbolDuration * 1000;
    const defaultChunkSizes = [
      symbolDurationMs * 0.5,
      symbolDurationMs * 0.75,
      symbolDurationMs,
      symbolDurationMs * 1.5,
      symbolDurationMs * 2,
    ];

    const chunkSizes: number[] =
      chunkSizeOrSizes === null ? defaultChunkSizes : chunkSizeOrSizes;

    let fallbackFrame: Frame | null = null;

    for (const chunkSize of chunkSizes) {
      this.reset();

      try {
        const frame = await this.processAudioCompleteBasic(
          audioData,
          sampleRate,
          chunkSize,
        );

        if (frame && frame.isValid) {
          return frame;
        }

        if (!fallbackFrame && frame) {
          fallbackFrame = frame;
        }
      } catch (error) {
        console.warn(`Chunk size ${chunkSize}ms failed:`, error);
      }
    }

    if (enableTimingSync && !fallbackFrame) {
      try {
        return await this.processAudioWithTimingSync(
          audioData,
          sampleRate,
          chunkSizes,
        );
      } catch (error) {
        console.warn("Timing sync processing failed:", error);
      }
    }

    return fallbackFrame;
  }

  private collectCandidateSymbolDurations(): number[] {
    const durations = new Set<number>();
    durations.add(this.config.symbolDuration);
    durations.add(this.activeSymbolDuration);

    const adaptive = this.config.adaptiveTiming;
    if (adaptive?.symbolDurationsMs) {
      for (const durationMs of adaptive.symbolDurationsMs) {
        if (durationMs > 0) {
          durations.add(durationMs / 1000);
        }
      }
    }

    return Array.from(durations).sort((a, b) => a - b);
  }

  private collectCandidateFrequencySets(): [number, number, number][] {
    const sets = new Map<string, [number, number, number]>();

    const addSet = (frequencies: [number, number, number]) => {
      const key = frequencies.map((freq) => freq.toFixed(2)).join("-");
      if (!sets.has(key)) {
        sets.set(key, [...frequencies] as [number, number, number]);
      }
    };

    addSet(this.baseToneFrequencies);
    addSet(HARDWARE_TONE_FREQUENCIES);
    addSet(ALIASED_TONE_FREQUENCIES);
    addSet(HIGH_ALIASED_TONES);

    return Array.from(sets.values());
  }

  private findPreambleCandidates(
    audioData: Float32Array,
    sampleRate: number,
    symbolDurations: number[],
  ): PreambleCandidate[] {
    const expectedSymbols = this.config.preambleBits.map((bit) =>
      bit === 1 ? 2 : 0,
    );

    if (expectedSymbols.length === 0) {
      return [];
    }

    const candidates: PreambleCandidate[] = [];
    const maxCandidates = 60;

    for (const duration of symbolDurations) {
      const symbolSamples = Math.max(1, Math.floor(duration * sampleRate));
      const preambleSpan = symbolSamples * expectedSymbols.length;
      if (preambleSpan >= audioData.length) continue;

      const stepSamples = Math.max(1, Math.floor(symbolSamples / 5));
      const windowSamples = Math.max(
        Math.floor(symbolSamples * 0.6),
        Math.floor(sampleRate * 0.04),
      );
      const minSeparation = Math.max(
        Math.floor(symbolSamples / 2),
        Math.floor(sampleRate * 0.02),
      );

      for (
        let startSample = 0;
        startSample + preambleSpan < audioData.length;
        startSample += stepSamples
      ) {
        const rms = this.calculateRms(audioData, startSample, preambleSpan);
        if (rms < 0.01) continue;

        const evaluation = this.evaluatePreambleCandidate(
          audioData,
          sampleRate,
          startSample,
          symbolSamples,
          windowSamples,
          expectedSymbols,
        );

        if (!evaluation) continue;

        const { matches, avgConfidence } = evaluation;
        const matchRatio = matches / expectedSymbols.length;
        if (matchRatio < 0.5) continue;

        const score = matchRatio * 0.7 + avgConfidence * 0.3;
        const candidate: PreambleCandidate = {
          startSample,
          symbolDuration: duration,
          matches,
          avgConfidence,
          score,
        };

        const existingIndex = candidates.findIndex(
          (c) => Math.abs(c.startSample - startSample) < minSeparation,
        );

        if (existingIndex >= 0) {
          if (score > candidates[existingIndex].score) {
            candidates[existingIndex] = candidate;
          }
        } else {
          candidates.push(candidate);
        }

        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length > maxCandidates) {
          candidates.length = maxCandidates;
        }
      }
    }

    return candidates;
  }

  private evaluatePreambleCandidate(
    audioData: Float32Array,
    sampleRate: number,
    startSample: number,
    symbolSamples: number,
    windowSamples: number,
    expectedSymbols: number[],
  ): { matches: number; avgConfidence: number } | null {
    let matches = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    const searchWindow = Math.max(1, Math.floor(symbolSamples * 0.4));
    const searchStep = Math.max(1, Math.floor(searchWindow / 6));

    for (let i = 0; i < expectedSymbols.length; i++) {
      const symbolCenter =
        startSample + i * symbolSamples + Math.floor(symbolSamples / 2);
      let bestDetection: { symbol: number | null; confidence: number } | null =
        null;

      for (
        let offset = -searchWindow;
        offset <= searchWindow;
        offset += searchStep
      ) {
        const detection = this.detectSymbolAt(
          audioData,
          sampleRate,
          symbolCenter + offset,
          windowSamples,
        );

        if (!detection) {
          continue;
        }

        if (!bestDetection || detection.confidence > bestDetection.confidence) {
          bestDetection = detection;
        }
      }

      if (!bestDetection) {
        continue;
      }

      if (bestDetection.symbol === expectedSymbols[i]) {
        matches++;
      }

      if (bestDetection.confidence > 0) {
        confidenceSum += bestDetection.confidence;
        confidenceCount++;
      }
    }

    if (confidenceCount === 0) {
      return null;
    }

    const avgConfidence = confidenceSum / confidenceCount;
    return { matches, avgConfidence };
  }

  private detectSymbolAt(
    audioData: Float32Array,
    sampleRate: number,
    centerSample: number,
    windowSamples: number,
  ): { symbol: number | null; confidence: number } | null {
    const halfWindow = Math.floor(windowSamples / 2);
    const start = centerSample - halfWindow;
    const end = centerSample + halfWindow;

    if (start < 0 || end >= audioData.length) {
      return null;
    }

    const segment = audioData.slice(start, end);
    const strengths = Goertzel.getFrequencyStrengths(
      segment,
      this.config.toneFrequencies,
      sampleRate,
    );

    const maxStrength = Math.max(...strengths);
    const totalStrength = strengths.reduce((sum, value) => sum + value, 0);

    if (totalStrength <= 0) {
      return { symbol: null, confidence: 0 };
    }

    const toneIndex = strengths.indexOf(maxStrength);
    const confidence = maxStrength / totalStrength;

    return { symbol: toneIndex, confidence };
  }

  private calculateRms(
    data: Float32Array,
    startSample: number,
    lengthSamples: number,
  ): number {
    const endSample = Math.min(startSample + lengthSamples, data.length);
    if (endSample <= startSample) {
      return 0;
    }

    let sum = 0;
    for (let i = startSample; i < endSample; i++) {
      const value = data[i];
      sum += value * value;
    }

    return Math.sqrt(sum / (endSample - startSample));
  }

  private async decodeWithPreambleCandidates(
    audioData: Float32Array,
    sampleRate: number,
    candidates: PreambleCandidate[],
  ): Promise<Frame | null> {
    const maxCandidates = Math.min(candidates.length, 60);

    for (let i = 0; i < maxCandidates; i++) {
      const candidate = candidates[i];
      const symbolDuration = candidate.symbolDuration;
      const symbolSamples = Math.max(
        1,
        Math.floor(symbolDuration * sampleRate),
      );

      const adjustmentSamples = Math.max(1, Math.floor(symbolSamples * 0.25));
      const halfAdjustment = Math.max(1, Math.floor(adjustmentSamples / 2));
      const adjustmentSteps = [
        -adjustmentSamples,
        -halfAdjustment,
        0,
        halfAdjustment,
        adjustmentSamples,
      ];

      for (const adjustment of adjustmentSteps) {
        const startSample = Math.max(candidate.startSample + adjustment, 0);
        const symbols = this.extractSymbolsParametric(
          audioData,
          sampleRate,
          startSample,
          symbolDuration,
        );

        if (symbols.length < 25) {
          continue;
        }

        const decodeResult = this.decodeCompleteTransmission(symbols);
        if (decodeResult.frame && decodeResult.frame.isValid) {
          return decodeResult.frame;
        }

        const corrected = this.attemptPatternCorrection(symbols);
        if (corrected) {
          const correctedResult = this.decodeCompleteTransmission(corrected);
          if (correctedResult.frame && correctedResult.frame.isValid) {
            return correctedResult.frame;
          }

          const correctedPreambleIndex = this.findPreambleInSymbols(corrected);
          if (correctedPreambleIndex >= 0) {
            const trimmedCorrected = corrected.slice(correctedPreambleIndex);
            const trimmedCorrectedResult =
              this.decodeCompleteTransmission(trimmedCorrected);
            if (
              trimmedCorrectedResult.frame &&
              trimmedCorrectedResult.frame.isValid
            ) {
              return trimmedCorrectedResult.frame;
            }
          }
        }

        const preambleIndex = this.findPreambleInSymbols(symbols);
        if (preambleIndex >= 0) {
          const trimmedSymbols = symbols.slice(preambleIndex);
          const trimmedResult = this.decodeCompleteTransmission(trimmedSymbols);
          if (trimmedResult.frame && trimmedResult.frame.isValid) {
            return trimmedResult.frame;
          }
        }
      }
    }

    return null;
  }

  private extractSymbolsParametric(
    audioData: Float32Array,
    sampleRate: number,
    startSample: number,
    symbolDuration: number,
    maxSymbols: number = 200,
  ): number[] {
    const symbols: number[] = [];
    const symbolSamples = Math.max(1, Math.floor(symbolDuration * sampleRate));
    const windowSamples = Math.max(
      Math.floor(symbolSamples * 0.6),
      Math.floor(sampleRate * 0.04),
    );
    const searchWindow = Math.max(1, Math.floor(symbolSamples * 0.2));
    const searchStep = Math.max(1, Math.floor(searchWindow / 4));

    let leadingMisses = 0;
    const maxLeadingMisses = 25;
    let trailingMisses = 0;
    const maxTrailingMisses = 6;

    for (let i = 0; i < maxSymbols; i++) {
      const symbolCenter =
        startSample + i * symbolSamples + Math.floor(symbolSamples / 2);

      if (symbolCenter + Math.floor(windowSamples / 2) >= audioData.length) {
        break;
      }

      let bestSymbol: number | null = null;
      let bestConfidence = 0;

      for (
        let offset = -searchWindow;
        offset <= searchWindow;
        offset += searchStep
      ) {
        const detection = this.detectSymbolAt(
          audioData,
          sampleRate,
          symbolCenter + offset,
          windowSamples,
        );

        if (!detection || detection.symbol === null) {
          continue;
        }

        if (detection.confidence > bestConfidence) {
          bestConfidence = detection.confidence;
          bestSymbol = detection.symbol;
        }
      }

      if (bestSymbol === null || bestConfidence < 0.25) {
        if (symbols.length === 0) {
          leadingMisses++;
          if (leadingMisses > maxLeadingMisses) {
            break;
          }
          continue;
        }

        trailingMisses++;
        if (trailingMisses > maxTrailingMisses) {
          break;
        }
        continue;
      }

      trailingMisses = 0;
      symbols.push(bestSymbol);
    }

    return symbols;
  }

  /**
   * Find the preamble pattern in the symbol stream with flexible matching
   * @param symbols Symbol stream to search
   * @returns Index of preamble start, or -1 if not found
   */
  findPreambleInSymbols(symbols: number[]): number {
    const expectedPreamblePattern = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0];

    for (let i = 0; i <= symbols.length - expectedPreamblePattern.length; i++) {
      const match = this.calculatePatternMatch(
        symbols.slice(i, i + expectedPreamblePattern.length),
        expectedPreamblePattern,
      );

      if (match >= 0.75) {
        // 75% match threshold (9/12 symbols correct)
        return i;
      }
    }

    // If exact pattern not found, look for alternating 2,0 pattern at the start
    if (symbols.length >= 8) {
      const alternatingMatches = [];
      for (let i = 0; i < Math.min(12, symbols.length); i += 2) {
        const hasCorrectPair =
          i + 1 < symbols.length && symbols[i] === 2 && symbols[i + 1] === 0;
        alternatingMatches.push(hasCorrectPair);
      }

      // If at least 4 out of 6 pairs are correct (67% match)
      const correctPairs = alternatingMatches.filter(Boolean).length;
      if (correctPairs >= 4 && symbols[0] === 2) {
        return 0;
      }
    }

    return -1;
  }

  /**
   * Attempt to correct common symbol errors in preamble and sync
   * @param symbols Raw symbols to correct
   * @returns Corrected symbols if pattern is recognizable, otherwise null
   */
  attemptPatternCorrection(symbols: number[]): number[] | null {
    if (symbols.length < 25) return null;

    const expectedPreamble = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0];
    const expectedSync = [2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2];

    const corrected = [...symbols];
    let correctionsMade = 0;

    // Check if this looks like a preamble (alternating pattern with some errors)
    let alternatingScore = 0;
    for (let i = 0; i < Math.min(12, symbols.length); i += 2) {
      if (i + 1 < symbols.length && symbols[i] === 2 && symbols[i + 1] === 0) {
        alternatingScore++;
      }
    }

    // If we have at least 4 out of 6 alternating pairs, attempt correction
    if (alternatingScore >= 2) {
      // Correct preamble
      for (let i = 0; i < 12 && i < symbols.length; i++) {
        if (symbols[i] !== expectedPreamble[i]) {
          corrected[i] = expectedPreamble[i];
          correctionsMade++;
        }
      }

      // Check sync pattern similarity
      if (symbols.length >= 25) {
        const syncSlice = symbols.slice(12, 25);
        const syncMatches = syncSlice.filter(
          (sym, i) => sym === expectedSync[i],
        ).length;

        // If sync is at least 60% similar, correct it (lowered threshold)
        if (syncMatches >= 8) {
          for (let i = 0; i < 13; i++) {
            if (corrected[12 + i] !== expectedSync[i]) {
              corrected[12 + i] = expectedSync[i];
              correctionsMade++;
            }
          }
        }
      }
    }

    // Return corrected symbols if we made corrections and they seem reasonable
    if (correctionsMade > 0 && correctionsMade <= 20) {
      return corrected;
    }

    return null;
  }

  /**
   * Process audio with symbol timing synchronization
   */
  private async processAudioWithTimingSync(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizes: number[],
  ): Promise<Frame | null> {
    // Extract symbols using the most conservative chunk size
    const _conservativeChunkSize = Math.min(...chunkSizes);

    // Try extracting symbols from different start positions
    const windowSizeSeconds = 0.2; // 200ms search window (increased)
    const stepSeconds = 0.01; // 10ms steps (more granular)

    for (
      let startOffset = 0;
      startOffset < windowSizeSeconds;
      startOffset += stepSeconds
    ) {
      try {
        const audioSample = {
          data: audioData,
          sampleRate,
          timestamp: startOffset * 1000,
        };

        const rawSymbols = this.toneDetector.extractSymbols(
          audioSample,
          startOffset,
        );

        if (rawSymbols.length < 50) continue; // Need more symbols for robust detection

        // First try to find preamble in the stream
        const preambleIndex = this.findPreambleInSymbols(rawSymbols);

        if (preambleIndex >= 0) {
          // Extract transmission starting from preamble
          const transmissionSymbols = rawSymbols.slice(preambleIndex);

          if (transmissionSymbols.length >= 25) {
            // Try to decode directly
            const decodeResult =
              this.decodeCompleteTransmission(transmissionSymbols);

            if (decodeResult.frame && decodeResult.frame.isValid) {
              return decodeResult.frame;
            }

            // Try pattern correction
            const correctedSymbols =
              this.attemptPatternCorrection(transmissionSymbols);
            if (correctedSymbols) {
              const correctedResult =
                this.decodeCompleteTransmission(correctedSymbols);
              if (correctedResult.frame && correctedResult.frame.isValid) {
                return correctedResult.frame;
              }
            }

            // If direct decode fails, try timing optimization
            const timingResult = this.optimizeSymbolTiming(transmissionSymbols);

            if (timingResult.confidence > 0.5) {
              // Lower threshold since we found preamble
              const timingSyncResult = this.decodeCompleteTransmission(
                timingResult.syncedSymbols,
              );

              if (timingSyncResult.frame && timingSyncResult.frame.isValid) {
                return timingSyncResult.frame;
              }

              // Try pattern correction on timing-synced symbols
              const correctedTimingSymbols = this.attemptPatternCorrection(
                timingResult.syncedSymbols,
              );
              if (correctedTimingSymbols) {
                const finalResult = this.decodeCompleteTransmission(
                  correctedTimingSymbols,
                );
                if (finalResult.frame && finalResult.frame.isValid) {
                  return finalResult.frame;
                }
              }
            }
          }
        } else {
          // Apply timing synchronization to entire stream
          const timingResult = this.optimizeSymbolTiming(rawSymbols);

          if (timingResult.confidence > 0.7) {
            // Higher threshold when no clear preamble
            const decodeResult = this.decodeCompleteTransmission(
              timingResult.syncedSymbols,
            );

            if (decodeResult.frame && decodeResult.frame.isValid) {
              return decodeResult.frame;
            }
          }
        }
      } catch {
        // Continue with next start offset
        continue;
      }
    }

    return null;
  }

  private async decodeWithSymbolExtractor(
    audioData: Float32Array,
    sampleRate: number,
    options: SymbolExtractorDecodeOptions = {},
  ): Promise<Frame | null> {
    const baseFrequencySets = this.getSymbolExtractorFrequencySets();
    const isLowerSampleRate = sampleRate <= 46000;

    const frequencySets =
      options.frequencySets ||
      (isLowerSampleRate
        ? [
            { name: "hardware", tones: [...HARDWARE_TONE_FREQUENCIES] },
            { name: "default", tones: [...this.baseToneFrequencies] },
            { name: "alias_high", tones: [...HIGH_ALIASED_TONES] },
          ]
        : baseFrequencySets);

    const defaultSymbolDurations = isLowerSampleRate
      ? [0.098, 0.1, 0.102]
      : [0.108, 0.109, 0.112];
    const symbolDurations = Array.from(
      new Set(
        [
          ...this.collectCandidateSymbolDurations(),
          ...(options.symbolDurations || defaultSymbolDurations),
        ].map((value) => Number(value.toFixed(6))),
      ),
    ).sort((a, b) => a - b);

    const audioDuration = audioData.length / sampleRate;
    const startBase = Math.min(
      audioDuration - 0.5,
      Math.max(0, audioDuration * 0.08),
    );
    let startTimeRange: StartTimeRange = options.startTimeRange || {
      start: Math.max(0, startBase - 0.6),
      end: Math.min(audioDuration - 0.25, startBase + 5.5),
      step: 0.02,
    };

    if (!options.startTimeRange) {
      const detectedStart = this.findTransmissionStart(audioData, sampleRate);
      if (detectedStart !== null) {
        const detectedSeconds = detectedStart / 1000;
        startTimeRange = {
          start: Math.max(0, detectedSeconds - 0.6),
          end: Math.min(audioDuration - 0.25, detectedSeconds + 4.0),
          step: startTimeRange.step,
        };
      }
    }

    const minConfidence =
      options.minConfidence ?? (isLowerSampleRate ? 0.08 : 0.12);

    const extractor = new SymbolExtractor({
      frequencySets,
      symbolDurations,
      startTimeRange,
      symbolsToExtract: options.symbolsToExtract || 90,
      windowFraction: options.windowFraction || 0.6,
      minConfidence,
    });

    const topCandidates: SymbolExtractionCandidate[] = [];

    const overallCandidate = extractor.findBestCandidate(audioData, sampleRate);
    if (overallCandidate) {
      topCandidates.push(overallCandidate);
    }

    for (const frequencySet of frequencySets) {
      const setExtractor = new SymbolExtractor({
        frequencySets: [frequencySet],
        symbolDurations,
        startTimeRange,
        symbolsToExtract: options.symbolsToExtract || 90,
        windowFraction: options.windowFraction || 0.6,
        minConfidence,
      });
      const candidateForSet = setExtractor.findBestCandidate(
        audioData,
        sampleRate,
      );
      if (candidateForSet) {
        topCandidates.push(candidateForSet);
      }
    }

    if (topCandidates.length === 0) {
      return null;
    }

    const candidateOffsets =
      options.candidateOffsets ||
      (isLowerSampleRate
        ? [0, -0.02, 0.02, -0.015, 0.015, -0.01, 0.01, -0.005, 0.005]
        : [0, -0.015, 0.015, -0.01, 0.01, -0.005, 0.005]);

    for (const candidate of topCandidates) {
      if (!candidate) continue;

      const startRefinedCandidate = extractor.refineStartTime(
        audioData,
        sampleRate,
        candidate,
      );

      const candidatesToEvaluate: SymbolExtractionCandidate[] = [
        startRefinedCandidate,
      ];

      for (const offset of candidateOffsets) {
        if (offset === 0) continue;
        const startTime = startRefinedCandidate.startTime + offset;
        if (
          startTime < startTimeRange.start ||
          startTime > startTimeRange.end
        ) {
          continue;
        }

        const variant = extractor.generateCandidateForStart(
          audioData,
          sampleRate,
          startRefinedCandidate.frequencySet,
          startRefinedCandidate.symbolDuration,
          startTime,
        );

        if (!variant) continue;

        const refinedVariant = extractor.refineCandidate(
          audioData,
          sampleRate,
          variant,
          0.55,
        );

        candidatesToEvaluate.push(refinedVariant);
      }

      for (const refinedCandidate of candidatesToEvaluate) {
        if (!refinedCandidate) continue;

        const previousDuration = this.activeSymbolDuration;
        this.setSymbolDuration(refinedCandidate.symbolDuration);

        try {
          const workingSymbols = [...refinedCandidate.mappedSymbols];

          while (
            workingSymbols.length > 0 &&
            workingSymbols[workingSymbols.length - 1] === -1
          ) {
            workingSymbols.pop();
          }

          const preambleLength = this.config.preambleBits.length;
          const syncLength = this.config.barker13.length;
          const minLength = preambleLength + syncLength + 20;
          const maxLength = workingSymbols.length;

          for (let end = minLength; end <= maxLength; end++) {
            let candidateSequence = workingSymbols.slice(0, end);
            const preambleIndex = this.findPreambleInSymbols(candidateSequence);
            if (preambleIndex > 0) {
              candidateSequence = candidateSequence.slice(preambleIndex);
            }

            let result = this.decodeSymbolsStandalone(candidateSequence);
            if (result.frame && result.frame.isValid) {
              return result.frame;
            }

            const corrected = this.attemptPatternCorrection(candidateSequence);
            if (corrected) {
              const correctedIndex = this.findPreambleInSymbols(corrected);
              const correctedSequence =
                correctedIndex > 0
                  ? corrected.slice(correctedIndex)
                  : corrected;
              result = this.decodeSymbolsStandalone(correctedSequence);
              if (result.frame && result.frame.isValid) {
                return result.frame;
              }
            }
          }
        } finally {
          this.setSymbolDuration(previousDuration);
        }
      }
    }

    return null;
  }

  private decodeSymbolsStandalone(symbols: number[]) {
    const tempDecoder = new FeskDecoder();
    return tempDecoder.decodeCompleteTransmission(symbols);
  }
}
