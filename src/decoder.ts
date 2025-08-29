import { ToneDetector } from './toneDetector';
import { PreambleDetector, PreambleDetectionResult } from './preambleDetector';
import { SyncDetector, SyncDetectionResult } from './syncDetector';
import { AudioSample, DecoderState, Frame, SymbolDetection } from './types';
import { FeskConfig, DEFAULT_CONFIG } from './config';
import { TritDecoder } from './utils/tritDecoder';
import { LFSRDescrambler } from './utils/lfsrDescrambler';
import { CRC16 } from './utils/crc16';

export class FeskDecoder {
  private config: FeskConfig;
  private toneDetector: ToneDetector;
  private preambleDetector: PreambleDetector;
  private syncDetector: SyncDetector;
  private state: DecoderState;
  private headerDecoder: TritDecoder;
  private payloadDecoder: TritDecoder;
  private crcDecoder: TritDecoder;
  private descrambler: LFSRDescrambler;
  private payloadLength: number;
  private payloadBytesReceived: number;
  private tritCount: number;
  
  constructor(config: FeskConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.toneDetector = new ToneDetector(config);
    this.preambleDetector = new PreambleDetector(config);
    this.syncDetector = new SyncDetector(config);
    
    this.state = {
      phase: 'searching',
      symbolBuffer: [],
      estimatedSymbolDuration: config.symbolDuration,
      estimatedFrequencies: [...config.toneFrequencies] as [number, number, number],
      frameStartTime: 0
    };
    
    this.headerDecoder = new TritDecoder();
    this.payloadDecoder = new TritDecoder();
    this.crcDecoder = new TritDecoder();
    this.descrambler = new LFSRDescrambler();
    this.payloadLength = 0;
    this.payloadBytesReceived = 0;
    this.tritCount = 0;
  }

  processAudio(audioSample: AudioSample): Frame | null {
    // Step 1: Detect tones in the audio
    const toneDetections = this.toneDetector.detectTones(audioSample);
    
    if (toneDetections.length === 0) {
      return null;
    }

    // Step 2: Process based on current decoder state
    switch (this.state.phase) {
      case 'searching':
        return this.handleSearchingPhase(toneDetections, audioSample.timestamp);
      
      case 'preamble':
        return this.handlePreamblePhase(toneDetections, audioSample.timestamp);
      
      case 'sync':
        return this.handleSyncPhase(toneDetections, audioSample.timestamp);
      
      case 'header':
        return this.handleHeaderPhase(toneDetections, audioSample.timestamp);
      
      case 'payload':
        return this.handlePayloadPhase(toneDetections, audioSample.timestamp);
      
      default:
        return null;
    }
  }

  private handleSearchingPhase(toneDetections: any[], timestamp: number): Frame | null {
    // Look for preamble pattern
    const preambleResult = this.preambleDetector.processToneDetections(toneDetections, timestamp);
    
    if (preambleResult?.detected) {
      console.log('Preamble detected! Transitioning to sync phase...');
      this.state.phase = 'sync';
      this.state.estimatedSymbolDuration = preambleResult.estimatedSymbolDuration;
      this.state.estimatedFrequencies = preambleResult.estimatedFrequencies;
      this.state.frameStartTime = preambleResult.startTime;
      this.syncDetector.reset(); // Start fresh for sync detection
    }
    
    return null;
  }

  private handlePreamblePhase(toneDetections: any[], timestamp: number): Frame | null {
    // This phase is handled in searching phase
    return null;
  }

  private handleSyncPhase(toneDetections: any[], timestamp: number): Frame | null {
    // Convert tone detections to symbols and look for Barker-13 sync
    for (const detection of toneDetections) {
      const symbol = this.toneToSymbol(detection.frequency);
      if (symbol !== null) {
        const symbolDetection: SymbolDetection = {
          symbol,
          confidence: detection.confidence,
          timestamp
        };
        
        const syncResult = this.syncDetector.addSymbol(symbolDetection);
        if (syncResult?.detected) {
          console.log('Sync detected! Transitioning to header phase...');
          this.state.phase = 'header';
          this.state.symbolBuffer = []; // Clear buffer for header/payload
          this.headerDecoder.reset();
          this.tritCount = 0;
          return null;
        }
      }
    }
    
    return null;
  }

  private handleHeaderPhase(toneDetections: any[], timestamp: number): Frame | null {
    // Convert tone detections to symbols and collect header trits
    for (const detection of toneDetections) {
      const symbol = this.toneToSymbol(detection.frequency);
      if (symbol !== null) {
        this.headerDecoder.addTrit(symbol);
        this.tritCount++;
        
        // Check if we have enough trits for header (2 bytes)
        // Each byte needs ~5 trits on average, so check periodically
        if (this.tritCount >= 8) { // Conservative check
          const headerBytes = this.headerDecoder.extractExactBytes(2);
          if (headerBytes[0] !== 0 || headerBytes[1] !== 0) {
            // We got some data, try to descramble
            const hiScrambled = headerBytes[0];
            const loScrambled = headerBytes[1];
            
            const hiDescrambled = this.descrambler.descrambleByte(hiScrambled);
            const loDescrambled = this.descrambler.descrambleByte(loScrambled);
            
            this.payloadLength = (hiDescrambled << 8) | loDescrambled;
            
            if (this.payloadLength > 0 && this.payloadLength <= 256) {
              console.log(`Header decoded: payload length = ${this.payloadLength} bytes`);
              this.state.phase = 'payload';
              this.payloadDecoder.reset();
              this.payloadBytesReceived = 0;
              this.tritCount = 0;
              return null;
            }
          }
        }
      }
    }
    
    return null;
  }

  private handlePayloadPhase(toneDetections: any[], timestamp: number): Frame | null {
    // Convert tone detections to symbols and collect payload trits
    for (const detection of toneDetections) {
      const symbol = this.toneToSymbol(detection.frequency);
      if (symbol !== null) {
        // Check for pilot sequences [0,2] every 64 trits
        if (this.tritCount > 0 && this.tritCount % 64 === 0) {
          // Expect pilot sequence, skip validation for now
          console.log(`Expecting pilot at trit ${this.tritCount}`);
        }
        
        this.payloadDecoder.addTrit(symbol);
        this.tritCount++;
        
        // Try to extract complete bytes periodically
        if (this.tritCount % 10 === 0) { // Check every 10 trits
          const availableBytes = this.payloadDecoder.extractExactBytes(this.payloadLength);
          
          // Check if we have enough non-zero bytes
          let nonZeroBytes = 0;
          for (const byte of availableBytes) {
            if (byte !== 0) nonZeroBytes++;
          }
          
          if (nonZeroBytes >= this.payloadLength) {
            console.log(`Payload collected: ${nonZeroBytes} bytes`);
            
            // Descramble payload
            const descrambledPayload = new Uint8Array(this.payloadLength);
            for (let i = 0; i < this.payloadLength; i++) {
              descrambledPayload[i] = this.descrambler.descrambleByte(availableBytes[i]);
            }
            
            console.log(`Payload decoded: "${Array.from(descrambledPayload).map(b => String.fromCharCode(b)).join('')}"`);
            
            // Move to CRC validation - for now return the frame
            const calculatedCrc = CRC16.calculate(descrambledPayload);
            
            return {
              header: { payloadLength: this.payloadLength },
              payload: descrambledPayload,
              crc: calculatedCrc,
              isValid: true // For now, assume valid
            };
          }
        }
      }
    }
    
    return null;
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

  reset(): void {
    this.state = {
      phase: 'searching',
      symbolBuffer: [],
      estimatedSymbolDuration: this.config.symbolDuration,
      estimatedFrequencies: [...this.config.toneFrequencies] as [number, number, number],
      frameStartTime: 0
    };
    
    this.headerDecoder.reset();
    this.payloadDecoder.reset();
    this.crcDecoder.reset();
    this.descrambler.reset();
    this.payloadLength = 0;
    this.payloadBytesReceived = 0;
    this.tritCount = 0;
    
    this.preambleDetector.reset();
    this.syncDetector.reset();
  }

  // Method for testing - allows injection of pre-detected symbols
  processSymbols(symbols: SymbolDetection[]): Frame | null {
    for (const symbol of symbols) {
      this.state.symbolBuffer.push(symbol);
    }
    
    // This would be used for testing the decoder logic
    return null;
  }
}