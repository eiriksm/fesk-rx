// Simulate the exact transmitter logic to understand the encoding

console.log('🔬 Simulating TX encoder for "test"');
console.log('=====================================');

// Step 1: Payload data
const payload = Buffer.from('test');
console.log(`Payload: "${payload.toString()}" = [${Array.from(payload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

// Step 2: Calculate CRC
function calculateCRC16(data: Uint8Array): number {
  let crc = 0xFFFF;
  const polynomial = 0x1021;
  
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  
  return crc;
}

const crc16 = calculateCRC16(payload);
console.log(`CRC-16: 0x${crc16.toString(16).padStart(4, '0')}`);

// Step 3: Header (payload length)
const payloadLength = payload.length;
const headerHi = (payloadLength >> 8) & 0xFF;
const headerLo = payloadLength & 0xFF;
console.log(`Header: length=${payloadLength} -> hi=0x${headerHi.toString(16).padStart(2, '0')}, lo=0x${headerLo.toString(16).padStart(2, '0')}`);

// Step 4: LFSR scrambling simulation
class LFSRSimulator {
  private state: number = 0x1FF; // Seed

  scrambleByte(byteVal: number): number {
    let scrambled = 0;

    for (let i = 0; i < 8; i++) {
      // Extract bit 0 from LFSR
      const lfsrBit = this.state & 1;

      // XOR with input bit
      const inputBit = (byteVal >> i) & 1;
      scrambled |= (inputBit ^ lfsrBit) << i;

      // Advance LFSR: feedback polynomial x^9 + x^5 + 1
      const feedback = ((this.state >> 8) ^ (this.state >> 4)) & 1;
      this.state = ((this.state << 1) | feedback) & 0x1FF;
    }

    return scrambled;
  }
}

// Step 5: Scramble header and payload
const lfsr = new LFSRSimulator();

const scrambledHeaderHi = lfsr.scrambleByte(headerHi);
const scrambledHeaderLo = lfsr.scrambleByte(headerLo);
console.log(`Scrambled header: hi=0x${scrambledHeaderHi.toString(16).padStart(2, '0')}, lo=0x${scrambledHeaderLo.toString(16).padStart(2, '0')}`);

const scrambledPayload = Array.from(payload).map(byte => lfsr.scrambleByte(byte));
console.log(`Scrambled payload: [${scrambledPayload.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

// Step 6: CRC bytes
const crcHi = (crc16 >> 8) & 0xFF;
const crcLo = crc16 & 0xFF;
console.log(`CRC bytes: hi=0x${crcHi.toString(16).padStart(2, '0')}, lo=0x${crcLo.toString(16).padStart(2, '0')}`);

// Step 7: Simulate MS-trit-first packing for header
function packBytesToTrits(bytes: number[]): number[] {
  console.log(`\\nPacking bytes [${bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}] to trits:`);
  
  // Simulate the big-int approach
  let packWork = [...bytes];
  const trits: number[] = [];
  
  while (packWork.length > 0) {
    // Divide by 3
    let carry = 0;
    const newWork: number[] = [];
    
    for (let i = 0; i < packWork.length; i++) {
      const cur = (carry << 8) | packWork[i];
      const quotient = Math.floor(cur / 3);
      carry = cur % 3;
      
      if (newWork.length > 0 || quotient > 0) {
        newWork.push(quotient);
      }
    }
    
    // Remainder is the least significant trit, but we want MS-first
    trits.unshift(carry);
    packWork = newWork;
  }
  
  console.log(`  Result: [${trits.join(', ')}]`);
  return trits;
}

console.log('\\n📦 Packing simulation:');
const headerTrits = packBytesToTrits([scrambledHeaderHi, scrambledHeaderLo]);
const payloadTrits = packBytesToTrits(scrambledPayload);
const crcTrits = packBytesToTrits([crcHi, crcLo]);

console.log(`\\n🎯 Expected sequences:`);
console.log(`Header trits: [${headerTrits.join(',')}]`);
console.log(`Payload trits: [${payloadTrits.join(',')}]`);
console.log(`CRC trits: [${crcTrits.join(',')}]`);

// Step 8: Verify against actual transmission
const actualHeaderTrits = [0,1,1,2,1,1]; // From the TX output positions 25-30
const actualPayloadTrits = [2,2,0,0,2,1,2,0,0,1,0,1,2,1,1,2,0,1,0,0,0,1,1,0,1]; // From positions 31-55
const actualCrcTrits = [0,1,1,2,1,1,1,2,1]; // From positions 56-64

console.log(`\\n🔍 Comparison with actual transmission:`);
console.log(`Header - Expected: [${headerTrits.join(',')}], Actual: [${actualHeaderTrits.join(',')}], Match: ${JSON.stringify(headerTrits) === JSON.stringify(actualHeaderTrits) ? '✅' : '❌'}`);
console.log(`Payload - Expected: [${payloadTrits.join(',')}], Actual: [${actualPayloadTrits.join(',')}], Match: ${JSON.stringify(payloadTrits) === JSON.stringify(actualPayloadTrits) ? '✅' : '❌'}`);
console.log(`CRC - Expected: [${crcTrits.join(',')}], Actual: [${actualCrcTrits.join(',')}], Match: ${JSON.stringify(crcTrits) === JSON.stringify(actualCrcTrits) ? '✅' : '❌'}`);

console.log('\\n🏁 Transmitter simulation complete');