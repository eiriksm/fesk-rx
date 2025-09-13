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
      processedData = audioData.map(val => Math.max(-1, Math.min(1, val * amplificationFactor)));
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
          } else {
            // No detection - could be end of transmission
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
    // Handle backward compatibility: if a single number is passed, use the basic method
    if (typeof chunkSizeOrSizes === "number") {
      return await this.processAudioCompleteBasic(
        audioData,
        sampleRate,
        chunkSizeOrSizes,
      );
    }

    // Use symbol-duration-aligned chunk sizes if none provided
    const symbolDurationMs = this.config.symbolDuration * 1000;
    const defaultChunkSizes = [
      symbolDurationMs * 0.5, // 50ms - half symbol
      symbolDurationMs * 0.75, // 75ms - 3/4 symbol
      symbolDurationMs, // 100ms - exact symbol duration (optimal)
      symbolDurationMs * 1.5, // 150ms - 1.5 symbols
      symbolDurationMs * 2, // 200ms - 2 symbols
    ];

    const actualChunkSizes = chunkSizeOrSizes || defaultChunkSizes;
    const _bestFrame: Frame | null = null;
    const _bestConfidence = 0;

    for (const chunkSize of actualChunkSizes) {
      // Reset decoder state for each attempt
      this.reset();

      try {
        const frame = await this.processAudioCompleteBasic(
          audioData,
          sampleRate,
          chunkSize,
        );

        if (frame && frame.isValid) {
          // For now, return the first valid frame found
          // Could be enhanced with confidence scoring
          return frame;
        }
      } catch (error) {
        // Continue with next chunk size if this one fails
        console.warn(`Chunk size ${chunkSize}ms failed:`, error);
      }
    }

    // If standard processing failed, try with symbol timing optimization
    if (enableTimingSync && !_bestFrame) {
      try {
        return await this.processAudioWithTimingSync(
          audioData,
          sampleRate,
          actualChunkSizes,
        );
      } catch (error) {
        console.warn("Timing sync processing failed:", error);
      }
    }

    return _bestFrame;
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
    if (alternatingScore >= 4) {
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
    if (correctionsMade > 0 && correctionsMade <= 10) {
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
}
