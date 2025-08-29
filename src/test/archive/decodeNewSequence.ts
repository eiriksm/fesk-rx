import { TritDecoder } from '../utils/tritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

const sequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,1,0,1,1,0,0,1,0,1,2,2,1,0,2,0,1,1,0,1,1,1,1,1,2,2,1,0,2,2,1,0,1,0,2,1,2,0,2,2,1,0];

console.log('🔧 FESK Decoder - New TX Format');
console.log('===============================');
console.log(`Sequence length: ${sequence.length} symbols`);

// Step 1: Verify preamble (binary: 0→f0=symbol 0, 1→f2=symbol 2)
const expectedPreamble = [1,0,1,0,1,0,1,0,1,0,1,0]; // alternating 1,0 bits
const actualPreambleSymbols = sequence.slice(0, 12);
const actualPreambleBits = actualPreambleSymbols.map(s => s === 2 ? 1 : 0); // f2→1, f0→0

console.log(`\\nPreamble verification:`);
console.log(`Bits:     [${actualPreambleBits.join(',')}]`);
console.log(`Expected: [${expectedPreamble.join(',')}]`);
console.log(`Valid: ${JSON.stringify(expectedPreamble) === JSON.stringify(actualPreambleBits) ? '✅' : '❌'}`);

// Step 2: Verify Barker-13 sync
const expectedBarker13 = [1,1,1,1,1,0,0,1,1,0,1,0,1];
const actualSyncSymbols = sequence.slice(12, 25);
const actualSyncBits = actualSyncSymbols.map(s => s === 2 ? 1 : 0);

console.log(`\\nSync verification:`);
console.log(`Bits:     [${actualSyncBits.join(',')}]`);
console.log(`Expected: [${expectedBarker13.join(',')}]`);
console.log(`Valid: ${JSON.stringify(expectedBarker13) === JSON.stringify(actualSyncBits) ? '✅' : '❌'}`);

if (JSON.stringify(expectedPreamble) !== JSON.stringify(actualPreambleBits) ||
    JSON.stringify(expectedBarker13) !== JSON.stringify(actualSyncBits)) {
    console.log('❌ Invalid preamble/sync - not a valid FESK transmission');
    process.exit(1);
}

// Step 3: Extract payload section (everything after sync)
const payloadSection = sequence.slice(25);
console.log(`\\n📦 Payload section (${payloadSection.length} trits): [${payloadSection.join(',')}]`);

// Step 4: Remove pilots every 64 trits
function removePilots(trits: number[]): { cleaned: number[], pilotsFound: number } {
    const cleaned: number[] = [];
    let tritCount = 0;
    let pilotsFound = 0;
    
    for (let i = 0; i < trits.length; i++) {
        // Check if we're at a pilot position (every 64 data trits)
        if (tritCount > 0 && tritCount % 64 === 0) {
            // Expect pilot sequence [0,2] (f0, f2)
            if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
                console.log(`  Removed pilot [0,2] at data position ${tritCount}`);
                i++; // Skip both pilot trits
                pilotsFound++;
                continue;
            }
        }
        
        cleaned.push(trits[i]);
        tritCount++;
    }
    
    return { cleaned, pilotsFound };
}

const { cleaned: cleanedTrits, pilotsFound } = removePilots(payloadSection);
console.log(`After pilot removal: ${cleanedTrits.length} trits (removed ${pilotsFound} pilots)`);
console.log(`Cleaned trits: [${cleanedTrits.join(',')}]`);

// Step 5: Implement the exact reverse of pack_bytes_to_trits_msfirst
// The new TX uses: build trit stream canonically, then just stream it out
function tritsToBytesMSFirst(trits: number[]): Uint8Array {
    // Reverse of the canonical MS-first packing
    let value = 0n;
    
    // Convert trits to big integer (MS-trit-first)
    for (const trit of trits) {
        value = value * 3n + BigInt(trit);
    }
    
    // Extract bytes (MS-byte-first)
    const bytes: number[] = [];
    while (value > 0n) {
        bytes.unshift(Number(value % 256n));
        value = value / 256n;
    }
    
    return new Uint8Array(bytes);
}

const allBytes = tritsToBytesMSFirst(cleanedTrits);
console.log(`\\n🔢 Decoded ${allBytes.length} bytes: [${Array.from(allBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

if (allBytes.length < 4) {
    console.log('❌ Insufficient data for header + payload + CRC');
    process.exit(1);
}

// Step 6: Parse the byte stream according to new TX format
// Format: scrambled_header(2) + scrambled_payload(N) + unscrambled_crc(2)

// First, we need to find the payload length from the header
let headerBytes = allBytes.slice(0, 2);
console.log(`\\n📤 Header bytes (scrambled): [${Array.from(headerBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

// Descramble header to get payload length
const descrambler = new LFSRDescrambler();
const headerHi = descrambler.descrambleByte(headerBytes[0]);
const headerLo = descrambler.descrambleByte(headerBytes[1]);
const payloadLength = (headerHi << 8) | headerLo;

console.log(`Header descrambled: hi=0x${headerHi.toString(16).padStart(2, '0')}, lo=0x${headerLo.toString(16).padStart(2, '0')}`);
console.log(`Payload length: ${payloadLength} bytes`);

if (payloadLength <= 0 || payloadLength > 64) {
    console.log(`❌ Invalid payload length: ${payloadLength}`);
    process.exit(1);
}

if (allBytes.length < 2 + payloadLength + 2) {
    console.log(`❌ Insufficient data: need ${2 + payloadLength + 2} bytes, have ${allBytes.length}`);
    process.exit(1);
}

// Descramble payload
const payloadBytesScrambled = allBytes.slice(2, 2 + payloadLength);
const payload = new Uint8Array(payloadLength);
for (let i = 0; i < payloadLength; i++) {
    payload[i] = descrambler.descrambleByte(payloadBytesScrambled[i]);
}

console.log(`\\n📦 Payload bytes (scrambled): [${Array.from(payloadBytesScrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`Payload bytes (descrambled): [${Array.from(payload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

const payloadText = Array.from(payload).map(b => {
    if (b >= 32 && b <= 126) return String.fromCharCode(b);
    return `\\\\x${b.toString(16).padStart(2, '0')}`;
}).join('');

console.log(`Payload as text: "${payloadText}"`);

// Step 7: Verify CRC (sent unscrambled in new format)
const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
const calculatedCrc = CRC16.calculate(payload);

console.log(`\\n🔒 CRC bytes (unscrambled): [${Array.from(crcBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`Received CRC: 0x${receivedCrc.toString(16).padStart(4, '0')}`);
console.log(`Calculated CRC: 0x${calculatedCrc.toString(16).padStart(4, '0')}`);
console.log(`CRC valid: ${receivedCrc === calculatedCrc ? '✅' : '❌'}`);

// Final result
console.log(`\\n🎯 DECODED MESSAGE: "${payloadText}" ${receivedCrc === calculatedCrc ? '(verified)' : '(CRC mismatch)'}`);

console.log('\\n🏁 Decoding complete');