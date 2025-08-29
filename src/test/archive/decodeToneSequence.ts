import { TritDecoder } from '../utils/tritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

// Convert the tone sequence to symbols
// f0=2400Hz -> 0, f1=3000Hz -> 1, f2=3600Hz -> 2
const toneSequence = [
    // Preamble (0-11): f2,f0,f2,f0,f2,f0,f2,f0,f2,f0,f2,f0
    2,0,2,0,2,0,2,0,2,0,2,0,
    // Sync (12-24): f2,f2,f2,f2,f2,f0,f0,f2,f2,f0,f2,f0,f2  
    2,2,2,2,2,0,0,2,2,0,2,0,2,
    // Payload (25-75): converted from the frequency table
    1,0,2,1,1,1,0,0,2,1,0,0,1,0,2,1,2,2,2,0,2,0,2,1,1,2,1,1,0,2,1,2,2,0,2,0,0,2,1,1,2,2,2,1,1,2,1,2,2,0,0
];

console.log('🔧 Decoding Tone Sequence');
console.log('=========================');
console.log(`Total symbols: ${toneSequence.length}`);
console.log(`Full sequence: [${toneSequence.join(',')}]`);

// Verify structure
console.log('\\n📋 Structure verification:');
console.log(`Preamble (0-11):  [${toneSequence.slice(0,12).join(',')}]`);
console.log(`Sync (12-24):     [${toneSequence.slice(12,25).join(',')}]`);
console.log(`Payload (25-75):  [${toneSequence.slice(25,76).join(',')}]`);

// Step 1: Verify preamble
const expectedPreambleBits = [1,0,1,0,1,0,1,0,1,0,1,0];
const actualPreambleBits = toneSequence.slice(0, 12).map(s => s === 2 ? 1 : 0);
console.log(`\\nPreamble check: ${JSON.stringify(expectedPreambleBits) === JSON.stringify(actualPreambleBits) ? '✅' : '❌'}`);

// Step 2: Verify Barker-13 sync
const expectedBarker13 = [1,1,1,1,1,0,0,1,1,0,1,0,1];
const actualSyncBits = toneSequence.slice(12, 25).map(s => s === 2 ? 1 : 0);
console.log(`Sync check: ${JSON.stringify(expectedBarker13) === JSON.stringify(actualSyncBits) ? '✅' : '❌'}`);

// Step 3: Extract and process payload
const payloadTrits = toneSequence.slice(25);
console.log(`\\n📦 Payload section: ${payloadTrits.length} trits`);
console.log(`Payload trits: [${payloadTrits.join(',')}]`);

// Step 4: Remove pilots if any
function removePilots(trits: number[]): { cleaned: number[], pilotsFound: number } {
    const cleaned: number[] = [];
    let tritCount = 0;
    let pilotsFound = 0;
    
    for (let i = 0; i < trits.length; i++) {
        // Check for pilots every 64 data trits
        if (tritCount > 0 && tritCount % 64 === 0) {
            if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
                console.log(`  Found pilot [0,2] at position ${tritCount}`);
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

const { cleaned: cleanedTrits, pilotsFound } = removePilots(payloadTrits);
console.log(`After pilot removal: ${cleanedTrits.length} trits (removed ${pilotsFound} pilots)`);

// Step 5: Convert trits to bytes using canonical MS-first conversion
function tritsToBytesMSFirst(trits: number[]): Uint8Array {
    let value = 0n;
    
    // Convert MS-trit-first
    for (const trit of trits) {
        value = value * 3n + BigInt(trit);
    }
    
    // Extract bytes MS-byte-first
    const bytes: number[] = [];
    while (value > 0n) {
        bytes.unshift(Number(value % 256n));
        value = value / 256n;
    }
    
    return new Uint8Array(bytes);
}

const allBytes = tritsToBytesMSFirst(cleanedTrits);
console.log(`\\n🔢 Decoded bytes: [${Array.from(allBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

if (allBytes.length < 4) {
    console.log('❌ Insufficient data');
    process.exit(1);
}

// Step 6: Parse header to get payload length
const headerScrambled = allBytes.slice(0, 2);
const descrambler = new LFSRDescrambler();

const headerHi = descrambler.descrambleByte(headerScrambled[0]);
const headerLo = descrambler.descrambleByte(headerScrambled[1]);
const payloadLength = (headerHi << 8) | headerLo;

console.log(`\\n📤 Header: [${Array.from(headerScrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}] -> length=${payloadLength}`);

if (payloadLength <= 0 || payloadLength > 64 || allBytes.length < 2 + payloadLength + 2) {
    console.log(`❌ Invalid setup: payloadLength=${payloadLength}, totalBytes=${allBytes.length}`);
    process.exit(1);
}

// Step 7: Descramble payload
const payloadScrambled = allBytes.slice(2, 2 + payloadLength);
const payload = new Uint8Array(payloadLength);

for (let i = 0; i < payloadLength; i++) {
    payload[i] = descrambler.descrambleByte(payloadScrambled[i]);
}

const payloadText = Array.from(payload).map(b => {
    if (b >= 32 && b <= 126) return String.fromCharCode(b);
    return `\\\\x${b.toString(16).padStart(2, '0')}`;
}).join('');

console.log(`\\n📦 Payload: [${Array.from(payloadScrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}] -> "${payloadText}"`);

// Step 8: Verify CRC (unscrambled in new format)
const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
const calculatedCrc = CRC16.calculate(payload);

console.log(`\\n🔒 CRC: [${Array.from(crcBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`Received: 0x${receivedCrc.toString(16).padStart(4, '0')}, Calculated: 0x${calculatedCrc.toString(16).padStart(4, '0')}`);
console.log(`CRC valid: ${receivedCrc === calculatedCrc ? '✅' : '❌'}`);

// Final result
console.log(`\\n🎯 DECODED MESSAGE: "${payloadText}" ${receivedCrc === calculatedCrc ? '(verified)' : '(CRC mismatch)'}`);

console.log('\\n🏁 Decoding complete');