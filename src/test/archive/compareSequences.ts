// Compare the unknown sequence with the known "test" sequence

const knownTestSequence = [
  // From your TX output for "test"
  2,0,2,0,2,0,2,0,2,0,2,0,        // Preamble (0-11) 
  2,2,2,2,2,0,0,2,2,0,2,0,2,      // Sync (12-24)
  0,1,1,2,1,1,                    // Header (25-30)
  2,2,0,0,2,1,2,0,0,1,0,1,2,1,1,2,0,1,0,0,0,1,1,0,1,  // Payload (31-55) 
  0,1,1,2,1,1,1,2,1               // CRC (56-64)
];

const unknownSequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,0,1,1,2,1,1,2,2,0,0,2,1,2,0,0,1,0,1,2,1,1,2,0,1,0,0,0,1,1,0,1,0,1,1,2,1,1,1,2,1];

console.log('🔍 Comparing sequences');
console.log('======================');

console.log(`Known "test": ${knownTestSequence.length} symbols`);
console.log(`Unknown:      ${unknownSequence.length} symbols`);

console.log('\\n📋 Section-by-section comparison:');

// Preamble
const knownPreamble = knownTestSequence.slice(0, 12);
const unknownPreamble = unknownSequence.slice(0, 12);
console.log(`Preamble: Known=${knownPreamble.join(',')} Unknown=${unknownPreamble.join(',')} Match=${JSON.stringify(knownPreamble) === JSON.stringify(unknownPreamble) ? '✅' : '❌'}`);

// Sync  
const knownSync = knownTestSequence.slice(12, 25);
const unknownSync = unknownSequence.slice(12, 25);
console.log(`Sync:     Known=${knownSync.join(',')} Unknown=${unknownSync.join(',')} Match=${JSON.stringify(knownSync) === JSON.stringify(unknownSync) ? '✅' : '❌'}`);

// Header
const knownHeader = knownTestSequence.slice(25, 31);
const unknownHeader = unknownSequence.slice(25, 31);
console.log(`Header:   Known=${knownHeader.join(',')} Unknown=${unknownHeader.join(',')} Match=${JSON.stringify(knownHeader) === JSON.stringify(unknownHeader) ? '✅' : '❌'}`);

// Payload  
const knownPayload = knownTestSequence.slice(31, 56);
const unknownPayload = unknownSequence.slice(31, 56);
console.log(`Payload:  Known=${knownPayload.join(',')} Unknown=${unknownPayload.join(',')} Match=${JSON.stringify(knownPayload) === JSON.stringify(unknownPayload) ? '✅' : '❌'}`);

// CRC
const knownCRC = knownTestSequence.slice(56, 65);
const unknownCRC = unknownSequence.slice(56, 65);
console.log(`CRC:      Known=${knownCRC.join(',')} Unknown=${unknownCRC.join(',')} Match=${JSON.stringify(knownCRC) === JSON.stringify(unknownCRC) ? '✅' : '❌'}`);

console.log('\\n🔍 Detailed analysis:');

// Since preamble/sync match, let's assume same structure and decode header
import { TritDecoder } from '../utils/tritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';

console.log('\\n📤 Decoding unknown header with same structure as "test":');
const headerDecoder = new TritDecoder();
for (const trit of unknownHeader) {
    headerDecoder.addTrit(trit);
}

const headerBytes = headerDecoder.extractExactBytes(2);
console.log(`Raw header bytes: [${Array.from(headerBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

const descrambler = new LFSRDescrambler();
const headerHi = descrambler.descrambleByte(headerBytes[0]);
const headerLo = descrambler.descrambleByte(headerBytes[1]);
const payloadLength = (headerHi << 8) | headerLo;

console.log(`Descrambled header: hi=0x${headerHi.toString(16).padStart(2, '0')}, lo=0x${headerLo.toString(16).padStart(2, '0')}`);
console.log(`Payload length: ${payloadLength}`);

// Let's assume 4 bytes like "test" and decode the payload
if (payloadLength !== 4) {
    console.log('⚠️  Length mismatch, assuming 4 bytes anyway...');
}

console.log('\\n📦 Decoding payload assuming 4 bytes:');
const payloadDecoder = new TritDecoder();
for (const trit of unknownPayload) {
    payloadDecoder.addTrit(trit);
}

const scrambledPayload = payloadDecoder.extractExactBytes(4);
console.log(`Scrambled payload: [${Array.from(scrambledPayload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

const payload = new Uint8Array(4);
for (let i = 0; i < 4; i++) {
    payload[i] = descrambler.descrambleByte(scrambledPayload[i]);
}

console.log(`Descrambled payload: [${Array.from(payload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
const payloadText = Array.from(payload).map(b => String.fromCharCode(b)).join('');
console.log(`🎯 Decoded message: "${payloadText}"`);

console.log('\\n🏁 Comparison complete');