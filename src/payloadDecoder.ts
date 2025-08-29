import { TritDecoder } from './utils/tritDecoder';
import { LFSRDescrambler } from './utils/lfsrDescrambler';
import { CRC16 } from './utils/crc16';

export class FeskPayloadDecoder {
  
  /**
   * Decode FESK payload using the new MS-trit-first base-3 conversion
   */
  static decodePayload(payloadTrits: number[], crcTrits: number[]): {
    success: boolean,
    data: Uint8Array | null,
    error?: string,
    steps: {
      originalTrits: number,
      afterPilotRemoval: number,
      bytes: number,
      afterDescrambling: Uint8Array | null,
      crcReceived: number,
      crcCalculated: number,
      crcValid: boolean
    }
  } {
    const steps = {
      originalTrits: payloadTrits.length,
      afterPilotRemoval: 0,
      bytes: 0,
      afterDescrambling: null as Uint8Array | null,
      crcReceived: 0,
      crcCalculated: 0,
      crcValid: false
    };
    
    try {
      console.log('🔄 FESK PAYLOAD DECODER');
      console.log('=======================');
      
      // Step 1: Remove pilots
      const noPilots = this.removePilots(payloadTrits);
      steps.afterPilotRemoval = noPilots.length;
      console.log(`After pilot removal: ${noPilots.length} trits`);
      
      // Step 2: Convert trits to bytes using MS-trit-first base-3 conversion
      const scrambledBytes = this.convertTritsToBytes(noPilots);
      steps.bytes = scrambledBytes.length;
      console.log(`Scrambled bytes: [${Array.from(scrambledBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
      
      // Step 3: Descramble
      const descrambler = new LFSRDescrambler();
      // Skip header bytes in LFSR state
      descrambler.descrambleByte(0); // Hi byte
      descrambler.descrambleByte(0); // Lo byte
      
      const descrambledBytes = new Uint8Array(scrambledBytes.length);
      for (let i = 0; i < scrambledBytes.length; i++) {
        descrambledBytes[i] = descrambler.descrambleByte(scrambledBytes[i]);
      }
      
      steps.afterDescrambling = descrambledBytes;
      console.log(`Descrambled: [${Array.from(descrambledBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
      console.log(`As text: "${Array.from(descrambledBytes).map(b => String.fromCharCode(b)).join('')}"`);
      
      // Step 4: Extract and validate CRC
      const receivedCRC = this.extractCRC(crcTrits);
      const calculatedCRC = CRC16.calculate(descrambledBytes);
      
      steps.crcReceived = receivedCRC;
      steps.crcCalculated = calculatedCRC;
      steps.crcValid = receivedCRC === calculatedCRC;
      
      console.log(`CRC received: 0x${receivedCRC.toString(16).padStart(4, '0')}`);
      console.log(`CRC calculated: 0x${calculatedCRC.toString(16).padStart(4, '0')}`);
      console.log(`CRC valid: ${steps.crcValid ? '✅' : '❌'}`);
      
      return {
        success: true,
        data: descrambledBytes,
        steps
      };
      
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
        steps
      };
    }
  }
  
  /**
   * Remove pilot sequences [0,2] inserted every 64 trits
   */
  private static removePilots(trits: number[]): number[] {
    const cleaned: number[] = [];
    let dataTrits = 0;
    
    for (let i = 0; i < trits.length; i++) {
      if (dataTrits > 0 && dataTrits % 64 === 0) {
        if (i + 1 < trits.length && trits[i] === 0 && trits[i + 1] === 2) {
          console.log(`Found pilot [${trits[i]},${trits[i + 1]}] at position ${dataTrits}`);
          i++; // Skip both pilot trits
          continue;
        }
      }
      
      cleaned.push(trits[i]);
      dataTrits++;
    }
    
    return cleaned;
  }
  
  /**
   * Convert trits to bytes using new MS-trit-first base-3 conversion
   */
  private static convertTritsToBytes(trits: number[]): Uint8Array {
    const decoder = new TritDecoder();
    
    // Add trits in order (MS-trit-first)
    for (const trit of trits) {
      decoder.addTrit(trit);
    }
    
    return decoder.getCompletedBytes();
  }
  
  
  
  /**
   * Extract CRC from CRC trits using base-3 conversion
   */
  private static extractCRC(crcTrits: number[]): number {
    const decoder = new TritDecoder();
    
    // Add CRC trits in order
    for (const trit of crcTrits) {
      decoder.addTrit(trit);
    }
    
    const crcBytes = decoder.getCompletedBytes();
    if (crcBytes.length < 2) {
      throw new Error(`Insufficient CRC data: got ${crcBytes.length} bytes, expected 2`);
    }
    
    return (crcBytes[0] << 8) | crcBytes[1];
  }
  
  
}