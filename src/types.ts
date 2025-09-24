export interface AudioSample {
  data: Float32Array;
  sampleRate: number;
  timestamp: number;
  normalizationGain?: number;
  peakLevel?: number;
  rmsLevel?: number;
  originalPeakLevel?: number;
  originalRmsLevel?: number;
}

export interface ToneDetection {
  frequency: number;
  magnitude: number;
  confidence: number;
}

export interface SymbolDetection {
  symbol: number; // 0, 1, or 2 for ternary
  confidence: number;
  timestamp: number;
}

export interface Frame {
  header: FrameHeader;
  payload: Uint8Array;
  crc: number;
  isValid: boolean;
}

export interface FrameHeader {
  payloadLength: number;
}

export interface DecoderState {
  phase: "searching" | "preamble" | "sync" | "header" | "payload";
  symbolBuffer: SymbolDetection[];
  estimatedSymbolDuration: number;
  estimatedFrequencies: [number, number, number];
  frameStartTime: number;
}
