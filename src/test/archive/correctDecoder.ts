import { TritDecoder } from '../utils/tritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

const sequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,0,1,1,2,1,1,2,2,0,0,2,1,2,0,0,1,0,1,2,1,1,2,0,1,0,0,0,1,1,0,1,0,1,1,2,1,1,1,2,1];

console.log('🔧 FESK Decoder - Following Exact Protocol');
console.log('==========================================');

// Step 1: Verify preamble (binary: 0→f0=2, 1→f2=2 in sequence)
// Wait, let me correct the mapping: 0→f0, 1→f2, so in the sequence f0=symbol 0, f2=symbol 2
const expectedPreamble = [1,0,1,0,1,0,1,0,1,0,1,0]; // alternating 1,0 bits
const actualPreambleSymbols = sequence.slice(0, 12);
const actualPreambleBits = actualPreambleSymbols.map(s => s === 2 ? 1 : 0); // f2→1, f0→0

console.log(`Preamble bits: [${actualPreambleBits.join(',')}]`);
console.log(`Expected:      [${expectedPreamble.join(',')}]`);
console.log(`Preamble valid: ${JSON.stringify(expectedPreamble) === JSON.stringify(actualPreambleBits) ? '✅' : '❌'}`);

// Step 2: Verify Barker-13 sync
const expectedBarker13 = [1,1,1,1,1,0,0,1,1,0,1,0,1];
const actualSyncSymbols = sequence.slice(12, 25);
const actualSyncBits = actualSyncSymbols.map(s => s === 2 ? 1 : 0);

console.log(`\\nSync bits:     [${actualSyncBits.join(',')}]`);
console.log(`Expected:      [${expectedBarker13.join(',')}]`);
console.log(`Sync valid: ${JSON.stringify(expectedBarker13) === JSON.stringify(actualSyncBits) ? '✅' : '❌'}`);

if (JSON.stringify(expectedPreamble) !== JSON.stringify(actualPreambleBits) ||
    JSON.stringify(expectedBarker13) !== JSON.stringify(actualSyncBits)) {
    console.log('❌ Invalid preamble/sync - not a valid FESK transmission');
    process.exit(1);
}

// Step 3: Extract payload section (everything after sync)
const payloadSection = sequence.slice(25);
console.log(`\\n📦 Payload section (${payloadSection.length} trits): [${payloadSection.join(',')}]`);

// Step 4: Remove pilots every 64 trits
function removePilots(trits: number[]): number[] {
    const cleaned: number[] = [];
    let tritCount = 0;
    
    for (let i = 0; i < trits.length; i++) {
        // Check if we're at a pilot position (every 64 data trits)
        if (tritCount > 0 && tritCount % 64 === 0) {
            // Expect pilot sequence [0,2]
            if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
                console.log(`  Removed pilot [0,2] at data position ${tritCount}`);
                i++; // Skip both pilot trits
                continue;
            }
        }
        
        cleaned.push(trits[i]);
        tritCount++;
    }
    
    return cleaned;
}

const cleanedTrits = removePilots(payloadSection);
console.log(`After pilot removal (${cleanedTrits.length} trits): [${cleanedTrits.join(',')}]`);

// Step 5: Convert base-3 to base-256 (MS-trit-first)
const decoder = new TritDecoder();
for (const trit of cleanedTrits) {
    decoder.addTrit(trit);
}

// We don't know the exact byte count yet, so let's extract what we can
const allBytes = decoder.getCompletedBytes();
console.log(`\\n🔢 Decoded bytes (${allBytes.length}): [${Array.from(allBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

if (allBytes.length < 4) {
    console.log('❌ Insufficient data for header + payload + CRC');
    process.exit(1);
}

// Step 6: Descramble bytes (header first, then payload, then CRC)
const descrambler = new LFSRDescrambler();

// Descramble header (first 2 bytes)
const headerScrambled = allBytes.slice(0, 2);
const headerDescrambled = new Uint8Array(2);
headerDescrambled[0] = descrambler.descrambleByte(headerScrambled[0]);
headerDescrambled[1] = descrambler.descrambleByte(headerScrambled[1]);

const payloadLength = (headerDescrambled[0] << 8) | headerDescrambled[1];
console.log(`\\n📤 Header: scrambled=[${Array.from(headerScrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`          descrambled=[${Array.from(headerDescrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`          payload length=${payloadLength} bytes`);

if (payloadLength <= 0 || payloadLength > 64 || allBytes.length < 2 + payloadLength + 2) {
    console.log(`❌ Invalid payload length or insufficient data: need ${2 + payloadLength + 2} bytes, have ${allBytes.length}`);
    process.exit(1);
}

// Descramble payload
const payloadScrambled = allBytes.slice(2, 2 + payloadLength);
const payloadDescrambled = new Uint8Array(payloadLength);
for (let i = 0; i < payloadLength; i++) {
    payloadDescrambled[i] = descrambler.descrambleByte(payloadScrambled[i]);
}

console.log(`\\n📦 Payload: scrambled=[${Array.from(payloadScrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`           descrambled=[${Array.from(payloadDescrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

const payloadText = Array.from(payloadDescrambled).map(b => String.fromCharCode(b)).join('');
console.log(`           text="${payloadText}"`);

// Step 7: Verify CRC
const crcScrambled = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
const crcDescrambled = new Uint8Array(2);
crcDescrambled[0] = descrambler.descrambleByte(crcScrambled[0]);
crcDescrambled[1] = descrambler.descrambleByte(crcScrambled[1]);

// Note: CRC is calculated on original unscrambled payload
const receivedCrc = (crcDescrambled[0] << 8) | crcDescrambled[1];
const calculatedCrc = CRC16.calculate(payloadDescrambled);

console.log(`\\n🔒 CRC: scrambled=[${Array.from(crcScrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`       descrambled=[${Array.from(crcDescrambled).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`       received=0x${receivedCrc.toString(16).padStart(4, '0')}, calculated=0x${calculatedCrc.toString(16).padStart(4, '0')}`);
console.log(`       valid=${receivedCrc === calculatedCrc ? '✅' : '❌'}`);

// Final result
console.log(`\\n🎯 DECODED MESSAGE: "${payloadText}" ${receivedCrc === calculatedCrc ? '(CRC valid)' : '(CRC invalid)'}`);

console.log('\\n🏁 Decoding complete');