import { Goertzel } from "../utils/goertzel";
import { DEFAULT_CONFIG } from "../config";

export interface ToneFrequencySet {
  name: string;
  tones: [number, number, number];
}

export interface StartTimeRange {
  start: number;
  end: number;
  step: number;
}

export interface SymbolExtractorOptions {
  frequencySets: ToneFrequencySet[];
  symbolDurations: number[];
  startTimeRange: StartTimeRange;
  symbolsToExtract?: number;
  windowFraction?: number;
  minConfidence?: number;
}

export interface SymbolExtractionCandidate {
  frequencySet: ToneFrequencySet;
  symbolDuration: number;
  startTime: number;
  rawSymbols: number[];
  mappedSymbols: number[];
  mapping: [number, number, number];
  confidences: number[];
  score: number;
  preambleMatches: number;
  syncMatches: number;
}

const PERMUTATIONS: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

const PREAMBLE = DEFAULT_CONFIG.preambleBits.map((bit) => (bit === 1 ? 2 : 0));
const SYNC = [...DEFAULT_CONFIG.barker13].map((bit) => (bit === 1 ? 2 : 0));

export class SymbolExtractor {
  private options: SymbolExtractorOptions;

  constructor(options: SymbolExtractorOptions) {
    this.options = options;
  }

  findBestCandidate(
    audioData: Float32Array,
    sampleRate: number,
  ): SymbolExtractionCandidate | null {
    const symbolsToExtract = this.options.symbolsToExtract || 90;
    const windowFraction = this.options.windowFraction || 0.6;
    const minConfidence = this.options.minConfidence || 0.15;
    const startTimes = this.generateStartTimes();

    let bestCandidate: SymbolExtractionCandidate | null = null;

    for (const frequencySet of this.options.frequencySets) {
      for (const symbolDuration of this.options.symbolDurations) {
        const symbolSamples = Math.floor(symbolDuration * sampleRate);
        if (symbolSamples <= 0) continue;

        for (const startTime of startTimes) {
          const detection = this.detectSymbols(
            audioData,
            sampleRate,
            startTime,
            symbolDuration,
            symbolsToExtract,
            windowFraction,
            frequencySet.tones,
          );

          if (!detection) continue;

          const candidate = this.evaluateCandidate(
            detection.rawSymbols,
            detection.confidences,
            frequencySet,
            symbolDuration,
            startTime,
            minConfidence,
          );

          if (!candidate) continue;

          if (!bestCandidate || candidate.score > bestCandidate.score) {
            bestCandidate = candidate;
          }
        }
      }
    }

    return bestCandidate;
  }

  private generateStartTimes(): number[] {
    const { start, end, step } = this.options.startTimeRange;
    const times: number[] = [];
    for (let t = start; t <= end; t += step) {
      times.push(Number(t.toFixed(6)));
    }
    return times;
  }

  private detectSymbols(
    audioData: Float32Array,
    sampleRate: number,
    startTime: number,
    symbolDuration: number,
    symbolsToExtract: number,
    windowFraction: number,
    tones: [number, number, number],
  ): { rawSymbols: number[]; confidences: number[] } | null {
    const rawSymbols: number[] = [];
    const confidences: number[] = [];

    const symbolSamples = Math.floor(symbolDuration * sampleRate);
    if (symbolSamples <= 0) return null;

    const windowSamples = Math.max(
      Math.floor(symbolSamples * windowFraction),
      Math.floor(sampleRate * 0.04),
    );
    const halfWindow = Math.floor(windowSamples / 2);

    for (let i = 0; i < symbolsToExtract; i++) {
      const centerSample = Math.floor(
        (startTime + i * symbolDuration + symbolDuration / 2) * sampleRate,
      );
      const windowStart = centerSample - halfWindow;
      const windowEnd = windowStart + windowSamples;

      if (windowStart < 0 || windowEnd >= audioData.length) break;

      const segment = audioData.slice(windowStart, windowEnd);
      const strengths = tones.map((tone) =>
        Goertzel.getFrequencyStrengthParametric(segment, tone, sampleRate),
      );
      const totalStrength = strengths.reduce((sum, value) => sum + value, 0);

      if (totalStrength <= 0) {
        rawSymbols.push(-1);
        confidences.push(0);
        continue;
      }

      const maxStrength = Math.max(...strengths);
      const dominantIndex = strengths.indexOf(maxStrength);
      const confidence = maxStrength / totalStrength;

      rawSymbols.push(dominantIndex);
      confidences.push(confidence);
    }

    if (rawSymbols.length < PREAMBLE.length + SYNC.length) {
      return null;
    }

    return { rawSymbols, confidences };
  }

  private evaluateCandidate(
    rawSymbols: number[],
    confidences: number[],
    frequencySet: ToneFrequencySet,
    symbolDuration: number,
    startTime: number,
    minConfidence: number,
  ): SymbolExtractionCandidate | null {
    let best: SymbolExtractionCandidate | null = null;

    for (const mapping of PERMUTATIONS) {
      const mappedSymbols = rawSymbols.map((symbol) =>
        symbol >= 0 ? mapping[symbol] : -1,
      );

      const { score, preambleMatches, syncMatches } = this.scoreSequence(
        mappedSymbols,
        confidences,
        minConfidence,
      );

      if (score <= 0) continue;

      if (!best || score > best.score) {
        best = {
          frequencySet,
          symbolDuration,
          startTime,
          rawSymbols,
          mappedSymbols,
          mapping,
          confidences,
          score,
          preambleMatches,
          syncMatches,
        };
      }
    }

    return best;
  }

  private scoreSequence(
    mappedSymbols: number[],
    confidences: number[],
    minConfidence: number,
  ): { score: number; preambleMatches: number; syncMatches: number } {
    const preambleLength = PREAMBLE.length;
    const syncLength = SYNC.length;

    const preambleSlice = mappedSymbols.slice(0, preambleLength);
    const syncSlice = mappedSymbols.slice(
      preambleLength,
      preambleLength + syncLength,
    );

    let preambleMatches = 0;
    let syncMatches = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (let i = 0; i < preambleSlice.length; i++) {
      const symbol = preambleSlice[i];
      if (symbol === PREAMBLE[i]) {
        preambleMatches++;
      }
      const conf = confidences[i] || 0;
      if (conf >= minConfidence) {
        confidenceSum += conf;
        confidenceCount++;
      }
    }

    for (let i = 0; i < syncSlice.length; i++) {
      const symbol = syncSlice[i];
      if (symbol === SYNC[i]) {
        syncMatches++;
      }
      const conf = confidences[preambleLength + i] || 0;
      if (conf >= minConfidence) {
        confidenceSum += conf;
        confidenceCount++;
      }
    }

    const preambleRatio = preambleMatches / preambleLength;
    const syncRatio = syncMatches / syncLength;
    const averageConfidence =
      confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

    const score = ((preambleRatio + syncRatio) / 2) * (0.5 + averageConfidence);

    return { score, preambleMatches, syncMatches };
  }

  refineCandidate(
    audioData: Float32Array,
    sampleRate: number,
    candidate: SymbolExtractionCandidate,
    confidenceThreshold: number = 0.6,
  ): SymbolExtractionCandidate {
    const refinedRaw = [...candidate.rawSymbols];
    const refinedConfidences = [...candidate.confidences];

    const offsets: number[] = [];
    const baseStep = candidate.symbolDuration * 0.02;
    for (let i = -4; i <= 4; i++) {
      offsets.push(i * baseStep);
    }

    const symbolSamples = Math.floor(candidate.symbolDuration * sampleRate);
    const windowSamples = Math.max(
      Math.floor(symbolSamples * (this.options.windowFraction || 0.6)),
      Math.floor(sampleRate * 0.04),
    );

    for (let i = 0; i < refinedRaw.length; i++) {
      if (refinedConfidences[i] >= confidenceThreshold) continue;

      let bestSymbol = refinedRaw[i];
      let bestConfidence = refinedConfidences[i];

      for (const offset of offsets) {
        const centerTime =
          candidate.startTime +
          i * candidate.symbolDuration +
          candidate.symbolDuration / 2 +
          offset;
        const detection = this.detectSingleSymbol(
          audioData,
          sampleRate,
          centerTime,
          windowSamples,
          candidate.frequencySet.tones,
        );

        if (detection.confidence > bestConfidence) {
          bestConfidence = detection.confidence;
          bestSymbol = detection.symbol;
        }
      }

      refinedRaw[i] = bestSymbol;
      refinedConfidences[i] = bestConfidence;
    }

    const minConfidence = this.options.minConfidence || 0.15;
    const updated = this.evaluateCandidate(
      refinedRaw,
      refinedConfidences,
      candidate.frequencySet,
      candidate.symbolDuration,
      candidate.startTime,
      minConfidence,
    );

    return (
      updated || {
        ...candidate,
        rawSymbols: refinedRaw,
        confidences: refinedConfidences,
      }
    );
  }

  refineStartTime(
    audioData: Float32Array,
    sampleRate: number,
    candidate: SymbolExtractionCandidate,
    radius: number = 0.05,
    step: number = 0.0005,
  ): SymbolExtractionCandidate {
    let bestCandidate: SymbolExtractionCandidate = candidate;
    const minConfidence = this.options.minConfidence || 0.15;

    for (
      let offset = -radius;
      offset <= radius;
      offset = Number((offset + step).toFixed(6))
    ) {
      const startTime = candidate.startTime + offset;
      if (startTime < this.options.startTimeRange.start) continue;
      if (startTime > this.options.startTimeRange.end) continue;

      const detection = this.detectSymbols(
        audioData,
        sampleRate,
        startTime,
        candidate.symbolDuration,
        this.options.symbolsToExtract || 90,
        this.options.windowFraction || 0.6,
        candidate.frequencySet.tones,
      );

      if (!detection) continue;

      const evaluated = this.evaluateCandidate(
        detection.rawSymbols,
        detection.confidences,
        candidate.frequencySet,
        candidate.symbolDuration,
        startTime,
        minConfidence,
      );

      if (evaluated && evaluated.score > bestCandidate.score) {
        bestCandidate = evaluated;
      }
    }

    return bestCandidate;
  }

  generateCandidateForStart(
    audioData: Float32Array,
    sampleRate: number,
    frequencySet: ToneFrequencySet,
    symbolDuration: number,
    startTime: number,
  ): SymbolExtractionCandidate | null {
    const detection = this.detectSymbols(
      audioData,
      sampleRate,
      startTime,
      symbolDuration,
      this.options.symbolsToExtract || 90,
      this.options.windowFraction || 0.6,
      frequencySet.tones,
    );

    if (!detection) return null;

    return this.evaluateCandidate(
      detection.rawSymbols,
      detection.confidences,
      frequencySet,
      symbolDuration,
      startTime,
      this.options.minConfidence || 0.15,
    );
  }

  private detectSingleSymbol(
    audioData: Float32Array,
    sampleRate: number,
    centerTime: number,
    windowSamples: number,
    tones: [number, number, number],
  ): { symbol: number; confidence: number } {
    const centerSample = Math.floor(centerTime * sampleRate);
    const halfWindow = Math.floor(windowSamples / 2);
    const windowStart = centerSample - halfWindow;
    const windowEnd = windowStart + windowSamples;

    if (windowStart < 0 || windowEnd >= audioData.length) {
      return { symbol: -1, confidence: 0 };
    }

    const segment = audioData.slice(windowStart, windowEnd);
    const strengths = tones.map((tone) =>
      Goertzel.getFrequencyStrengthParametric(segment, tone, sampleRate),
    );
    const total = strengths.reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
      return { symbol: -1, confidence: 0 };
    }

    const maxStrength = Math.max(...strengths);
    const symbol = strengths.indexOf(maxStrength);
    const confidence = maxStrength / total;

    return { symbol, confidence };
  }
}
