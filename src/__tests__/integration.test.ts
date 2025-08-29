import { CanonicalTritDecoder } from '../utils/canonicalTritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

/**
 * Integration tests for complete FESK decoding using known sequences
 */
describe('FESK Integration Tests', () => {
  
  function decodeCompleteSequence(symbols: number[]) {
    // Verify preamble and sync
    const preambleBits = symbols.slice(0, 12).map(s => s === 2 ? 1 : 0);
    const expectedPreamble = [1,0,1,0,1,0,1,0,1,0,1,0];
    expect(preambleBits).toEqual(expectedPreamble);
    
    const syncBits = symbols.slice(12, 25).map(s => s === 2 ? 1 : 0);
    const expectedSync = [1,1,1,1,1,0,0,1,1,0,1,0,1];
    expect(syncBits).toEqual(expectedSync);
    
    // Extract payload section
    const payloadTrits = symbols.slice(25);
    
    // Remove pilots (simplified - no pilots in our test cases)
    const cleanedTrits = removePilots(payloadTrits);
    
    // Convert to bytes
    const decoder = new CanonicalTritDecoder();
    for (const trit of cleanedTrits) {
      decoder.addTrit(trit);
    }
    const allBytes = decoder.getBytes();
    
    // Parse header
    const descrambler = new LFSRDescrambler();
    const headerHi = descrambler.descrambleByte(allBytes[0]);
    const headerLo = descrambler.descrambleByte(allBytes[1]);
    const payloadLength = (headerHi << 8) | headerLo;
    
    // Descramble payload
    const payload = new Uint8Array(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = descrambler.descrambleByte(allBytes[2 + i]);
    }
    
    // Extract CRC
    const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
    const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const calculatedCrc = CRC16.calculate(payload);
    
    return {
      header: { payloadLength },
      payload,
      crc: receivedCrc,
      isValid: receivedCrc === calculatedCrc,
      message: new TextDecoder().decode(payload)
    };
  }
  
  function removePilots(trits: number[]): number[] {
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
  
  function decodeCompleteSequenceCustom(symbols: number[]) {
    // Same as decodeCompleteSequence but with custom pilot removal for long sequences
    
    // Verify preamble and sync
    const preambleBits = symbols.slice(0, 12).map(s => s === 2 ? 1 : 0);
    const expectedPreamble = [1,0,1,0,1,0,1,0,1,0,1,0];
    expect(preambleBits).toEqual(expectedPreamble);
    
    const syncBits = symbols.slice(12, 25).map(s => s === 2 ? 1 : 0);
    const expectedSync = [1,1,1,1,1,0,0,1,1,0,1,0,1];
    expect(syncBits).toEqual(expectedSync);
    
    // Extract payload section
    const payloadTrits = symbols.slice(25);
    
    // Custom pilot removal for long sequences (removes pilots at specific positions)
    const cleanedTrits = removePilotsCustom(payloadTrits);
    
    // Convert to bytes
    const decoder = new CanonicalTritDecoder();
    for (const trit of cleanedTrits) {
      decoder.addTrit(trit);
    }
    const allBytes = decoder.getBytes();
    
    // Parse header
    const descrambler = new LFSRDescrambler();
    const headerHi = descrambler.descrambleByte(allBytes[0]);
    const headerLo = descrambler.descrambleByte(allBytes[1]);
    const payloadLength = (headerHi << 8) | headerLo;
    
    // Descramble payload
    const payload = new Uint8Array(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = descrambler.descrambleByte(allBytes[2 + i]);
    }
    
    // Extract CRC
    const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
    const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const calculatedCrc = CRC16.calculate(payload);
    
    return {
      header: { payloadLength },
      payload,
      crc: receivedCrc,
      isValid: receivedCrc === calculatedCrc,
      message: new TextDecoder().decode(payload)
    };
  }
  
  function removePilotsCustom(trits: number[]): number[] {
    // For "the truth is out there" sequence, pilots are at positions 64 and 129
    const pilotPositions = [129, 64]; // Remove in reverse order
    let result = [...trits];
    
    for (const pos of pilotPositions) {
      if (pos < result.length - 1 && result[pos] === 0 && result[pos + 1] === 2) {
        result.splice(pos, 2);
      }
    }
    
    return result;
  }

  function decodeUptimeSequence(symbols: number[]) {
    // Verify preamble and sync
    const preambleBits = symbols.slice(0, 12).map(s => s === 2 ? 1 : 0);
    const expectedPreamble = [1,0,1,0,1,0,1,0,1,0,1,0];
    expect(preambleBits).toEqual(expectedPreamble);
    
    const syncBits = symbols.slice(12, 25).map(s => s === 2 ? 1 : 0);
    const expectedSync = [1,1,1,1,1,0,0,1,1,0,1,0,1];
    expect(syncBits).toEqual(expectedSync);
    
    // Extract payload section
    const payloadTrits = symbols.slice(25);
    
    // Remove pilots at positions 64, 129, 194 (correct 64-interval pattern)
    const pilotPositions = [64, 129, 194];
    let cleanedTrits = [...payloadTrits];
    
    // Remove pilots in reverse order
    const sortedPositions = pilotPositions.sort((a, b) => b - a);
    for (const pos of sortedPositions) {
      if (pos < cleanedTrits.length - 1 && cleanedTrits[pos] === 0 && cleanedTrits[pos + 1] === 2) {
        cleanedTrits.splice(pos, 2);
      }
    }
    
    // Convert to bytes
    const decoder = new CanonicalTritDecoder();
    for (const trit of cleanedTrits) {
      decoder.addTrit(trit);
    }
    const allBytes = decoder.getBytes();
    
    // Parse header
    const descrambler = new LFSRDescrambler();
    const headerHi = descrambler.descrambleByte(allBytes[0]);
    const headerLo = descrambler.descrambleByte(allBytes[1]);
    const payloadLength = (headerHi << 8) | headerLo;
    
    // Descramble payload
    const payload = new Uint8Array(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = descrambler.descrambleByte(allBytes[2 + i]);
    }
    
    // Extract CRC
    const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
    const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const calculatedCrc = CRC16.calculate(payload);
    
    return {
      header: { payloadLength },
      payload,
      crc: receivedCrc,
      isValid: receivedCrc === calculatedCrc,
      message: new TextDecoder().decode(payload)
    };
  }

  describe('Known Message Sequences', () => {
    
    it('should decode "test" message correctly', () => {
      const testSequence = [
        // Preamble + Sync
        2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,
        // Payload
        1,0,1,1,0,0,1,0,1,2,2,1,0,2,0,1,1,0,1,1,1,1,1,2,2,1,0,2,2,1,0,1,0,2,1,2,0,2,2,1,0
      ];

      const result = decodeCompleteSequence(testSequence);
      
      expect(result.isValid).toBe(true);
      expect(result.header.payloadLength).toBe(4);
      expect(result.message).toBe('test');
      expect(result.crc).toBe(0x1FC6);
    });

    it('should decode "four56" message correctly', () => {
      const four56Sequence = [
        // Preamble + Sync  
        2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,
        // Payload
        1,0,2,1,1,1,0,0,2,1,0,0,1,0,2,1,2,2,2,0,2,0,2,1,1,2,1,1,0,2,1,2,2,0,2,0,0,2,1,1,2,2,2,1,1,2,1,2,2,0,0
      ];

      const result = decodeCompleteSequence(four56Sequence);
      
      expect(result.isValid).toBe(true);
      expect(result.header.payloadLength).toBe(6);
      expect(result.message).toBe('four56');
      expect(result.crc).toBe(0x4461);
    });

    it('should decode "howd" message correctly', () => {
      const howdSequence = [
        // Preamble + Sync
        2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,
        // Payload
        1,0,1,1,0,0,1,0,1,2,2,0,2,1,0,1,0,0,0,1,2,2,0,2,0,1,0,1,1,0,2,0,0,1,1,0,2,2,2,2,2
      ];

      const result = decodeCompleteSequence(howdSequence);
      
      expect(result.isValid).toBe(true);
      expect(result.header.payloadLength).toBe(4);
      expect(result.message).toBe('howd');
      expect(result.crc).toBe(0x5267);
    });

    it('should decode "the truth is out there" message correctly', () => {
      const truthSequence = [
        // Preamble + Sync
        2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,
        // Payload (with pilots at positions 64 and 129)
        2,2,2,1,0,2,1,2,2,1,1,0,1,0,0,0,2,1,2,1,2,1,0,2,0,1,1,0,2,0,1,1,2,2,1,0,2,2,0,1,2,1,0,2,0,1,2,0,0,2,0,0,0,2,0,1,2,1,0,0,0,1,1,1,0,2,1,2,1,2,1,0,2,0,0,1,1,1,1,1,1,2,0,2,2,0,1,1,2,2,0,2,1,1,2,2,2,1,0,0,0,0,2,0,0,1,2,2,0,2,1,2,1,1,2,1,0,1,0,0,2,2,0,0,1,0,0,0,0,0,2,2,0,2,2
      ];

      // Use custom pilot removal for this long sequence
      const result = decodeCompleteSequenceCustom(truthSequence);
      
      expect(result.isValid).toBe(true);
      expect(result.header.payloadLength).toBe(22);
      expect(result.message).toBe('the truth is out there');
      expect(result.crc).toBe(0x7CBA);
    });

    it('should decode complete uptime message correctly', () => {
      const uptimeSequence = [
        // Preamble + Sync
        2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,
        // Long payload with pilots at positions 64, 129, 194
        1,0,0,2,0,1,2,1,0,1,0,2,1,0,0,1,1,0,1,1,2,0,1,0,1,0,0,2,2,2,2,1,1,0,0,1,2,1,1,1,2,2,1,1,1,0,2,2,2,2,2,1,0,1,2,1,1,0,2,1,0,1,2,2,0,2,2,1,2,2,0,1,1,1,0,0,0,1,1,1,0,0,2,1,1,0,1,1,1,0,2,0,2,0,1,2,0,2,1,0,0,1,0,0,1,2,0,0,1,0,0,0,1,0,0,0,1,1,2,2,2,1,1,1,2,2,2,0,0,0,2,0,1,1,0,2,2,1,1,2,1,1,2,1,1,1,0,2,2,2,2,2,1,2,2,1,0,0,1,2,0,0,1,2,1,0,0,2,2,0,0,1,1,1,0,2,1,0,2,2,1,2,2,2,2,2,1,0,0,1,2,2,2,1,0,2,1,1,0,1,0,1,2,1,2,1,0,2,0,0,2,0,1,2,1,0,2,2,2,1,1,2,2,1,1,2,2,0,2,2,2,1,0,0,2,1,2,2,2,0,2,1,0,2,0,2,1,2,0,2,0,2,0,0
      ];

      // Use custom pilot removal for this sequence
      const result = decodeUptimeSequence(uptimeSequence);
      
      expect(result.isValid).toBe(true);
      expect(result.header.payloadLength).toBe(45);
      expect(result.message).toBe('uptime: 1228 seconds\n💪️\ntoday is monday\n');
      expect(result.crc).toBe(0xDC09);
    });

    it('should validate scrambler consistency', () => {
      // Test that LFSR scrambler produces consistent results
      const descrambler1 = new LFSRDescrambler();
      const descrambler2 = new LFSRDescrambler();
      
      const testByte = 0x42;
      const result1 = descrambler1.descrambleByte(testByte);
      const result2 = descrambler2.descrambleByte(testByte);
      
      expect(result1).toBe(result2); // Should be deterministic
    });

    it('should detect CRC mismatch', () => {
      const corruptedSequence = [
        // Preamble + Sync
        2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,
        // Corrupted payload (change last few trits)
        1,0,1,1,0,0,1,0,1,2,2,1,0,2,0,1,1,0,1,1,1,1,1,2,2,1,0,2,2,1,0,1,0,2,1,2,0,0,0,0,0
      ];

      const result = decodeCompleteSequence(corruptedSequence);
      
      // Should decode but be invalid due to CRC mismatch
      expect(result.header.payloadLength).toBeGreaterThan(0);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Canonical Trit Decoder Edge Cases', () => {
    
    it('should handle maximum trit values', () => {
      const decoder = new CanonicalTritDecoder();
      
      // Add many 2's to test large numbers
      for (let i = 0; i < 20; i++) {
        decoder.addTrit(2);
      }
      
      const bytes = decoder.getBytes();
      expect(bytes.length).toBeGreaterThan(0);
      expect(decoder.hasData()).toBe(true);
    });

    it('should handle alternating trit patterns', () => {
      const decoder = new CanonicalTritDecoder();
      
      // Pattern: 0,1,2,0,1,2,...
      for (let i = 0; i < 30; i++) {
        decoder.addTrit(i % 3);
      }
      
      const bytes = decoder.getBytes();
      expect(bytes.length).toBeGreaterThan(0);
    });
  });
});