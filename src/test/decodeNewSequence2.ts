import { CanonicalTritDecoder } from '../utils/canonicalTritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

async function decodeNewSequence2() {
    console.log('🧪 Decoding New Sequence #2');
    console.log('===========================');

    const sequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,2,2,2,1,0,2,1,2,2,1,1,0,1,0,0,0,2,1,2,1,2,1,0,2,0,1,1,0,2,0,1,1,2,2,1,0,2,2,0,1,2,1,0,2,0,1,2,0,0,2,0,0,0,2,0,1,2,1,0,0,0,1,1,1,0,2,1,2,1,2,1,0,2,0,0,1,1,1,1,1,1,2,0,2,2,0,1,1,2,2,0,2,1,1,2,2,2,1,0,0,0,0,2,0,0,1,2,2,0,2,1,2,1,1,2,1,0,1,0,0,2,2,0,0,1,0,0,0,0,0,2,2,0,2,2];
    
    console.log(`📊 Total symbols: ${sequence.length}`);
    
    // Verify structure
    const preamble = sequence.slice(0, 12);
    const sync = sequence.slice(12, 25);  
    const payload = sequence.slice(25);
    
    console.log(`\n🔍 Structure check:`);
    console.log(`   Preamble: [${preamble.join(',')}] - ${isPreambleValid(preamble) ? '✅' : '❌'}`);
    console.log(`   Sync: [${sync.join(',')}] - ${isSyncValid(sync) ? '✅' : '❌'}`);
    console.log(`   Payload: ${payload.length} trits`);
    
    if (!isPreambleValid(preamble)) {
        console.log('❌ Invalid preamble - expected alternating [2,0,2,0,...]');
        return;
    }
    
    if (!isSyncValid(sync)) {
        console.log('❌ Invalid sync - expected Barker-13 on f0/f2');
        return;
    }
    
    console.log(`\n✅ Structure valid, processing payload...`);
    console.log(`   Payload trits (first 50): [${payload.slice(0, 50).join(',')}...]`);
    
    // Process payload trits directly
    try {
        // Remove any pilots (every 64 trits)
        const cleanedTrits = removePilots(payload);
        console.log(`\n🔧 Pilot removal:`);
        console.log(`   Original: ${payload.length} trits`);
        console.log(`   Cleaned: ${cleanedTrits.length} trits (removed ${payload.length - cleanedTrits.length} pilots)`);
        
        // Convert to bytes using MS-first canonical
        const tritDecoder = new CanonicalTritDecoder();
        for (const trit of cleanedTrits) {
            tritDecoder.addTrit(trit);
        }
        
        const allBytes = tritDecoder.getBytes();
        console.log(`\n🔢 Trit to byte conversion:`);
        console.log(`   Decoded to ${allBytes.length} bytes: [${Array.from(allBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        
        if (allBytes.length < 4) {
            console.log('❌ Need at least 4 bytes (2 header + payload + 2 CRC)');
            return;
        }
        
        // Descramble header first
        const descrambler = new LFSRDescrambler();
        const headerHi = descrambler.descrambleByte(allBytes[0]);
        const headerLo = descrambler.descrambleByte(allBytes[1]);
        const payloadLength = (headerHi << 8) | headerLo;
        
        console.log(`\n🔓 Header descrambling:`);
        console.log(`   Raw header bytes: [0x${allBytes[0].toString(16).padStart(2, '0')}, 0x${allBytes[1].toString(16).padStart(2, '0')}]`);
        console.log(`   Descrambled: [0x${headerHi.toString(16).padStart(2, '0')}, 0x${headerLo.toString(16).padStart(2, '0')}]`);
        console.log(`   Payload length: ${payloadLength} bytes`);
        
        if (payloadLength <= 0 || payloadLength > 64) {
            console.log(`❌ Invalid payload length: ${payloadLength}`);
            return;
        }
        
        if (allBytes.length < 2 + payloadLength + 2) {
            console.log(`❌ Need ${2 + payloadLength + 2} bytes total, have ${allBytes.length}`);
            return;
        }
        
        // Descramble payload (continuing with same LFSR state)
        const payloadBytes = new Uint8Array(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
            payloadBytes[i] = descrambler.descrambleByte(allBytes[2 + i]);
        }
        
        console.log(`\n📦 Payload processing:`);
        console.log(`   Raw payload: [${Array.from(allBytes.slice(2, 2 + payloadLength)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        console.log(`   Descrambled: [${Array.from(payloadBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        
        // Decode message
        const message = Array.from(payloadBytes).map(b => {
            if (b >= 32 && b <= 126) return String.fromCharCode(b);
            return `\\x${b.toString(16).padStart(2, '0')}`;
        }).join('');
        
        console.log(`   As text: "${message}"`);
        
        // Check CRC (unscrambled in the stream)
        const crcBytes = allBytes.slice(2 + payloadLength, 2 + payloadLength + 2);
        const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
        const calculatedCrc = CRC16.calculate(payloadBytes);
        
        console.log(`\n🔒 CRC verification:`);
        console.log(`   CRC bytes: [0x${crcBytes[0].toString(16).padStart(2, '0')}, 0x${crcBytes[1].toString(16).padStart(2, '0')}]`);
        console.log(`   Received CRC: 0x${receivedCrc.toString(16).padStart(4, '0')}`);
        console.log(`   Calculated CRC: 0x${calculatedCrc.toString(16).padStart(4, '0')}`);
        console.log(`   Valid: ${receivedCrc === calculatedCrc ? '✅' : '❌'}`);
        
        if (receivedCrc === calculatedCrc) {
            console.log(`\n🎉 SUCCESS: "${message}"`);
            console.log(`\n📋 Test case info:`);
            console.log(`   Message: "${message}"`);
            console.log(`   Length: ${payloadLength} bytes`);
            console.log(`   CRC: 0x${receivedCrc.toString(16).padStart(4, '0')}`);
        } else {
            console.log(`\n⚠️  CRC mismatch - data may be corrupted`);
        }
        
    } catch (error) {
        console.error('❌ Decoding error:', error);
    }
}

function isPreambleValid(preamble: number[]): boolean {
    if (preamble.length !== 12) return false;
    for (let i = 0; i < preamble.length; i++) {
        const expected = i % 2 === 0 ? 2 : 0;  // f2, f0, f2, f0, ...
        if (preamble[i] !== expected) return false;
    }
    return true;
}

function isSyncValid(sync: number[]): boolean {
    // Barker-13: 1,1,1,1,1,0,0,1,1,0,1,0,1 mapped to f2=1, f0=0
    const expectedBarker = [2,2,2,2,2,0,0,2,2,0,2,0,2];
    if (sync.length !== 13) return false;
    return sync.every((s, i) => s === expectedBarker[i]);
}

function removePilots(trits: number[]): number[] {
    const cleaned: number[] = [];
    let dataTrits = 0;
    
    for (let i = 0; i < trits.length; i++) {
        // Check for pilot [0,2] every 64 data trits
        if (dataTrits > 0 && dataTrits % 64 === 0) {
            if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
                console.log(`   Removed pilot [0,2] at data position ${dataTrits}`);
                i++; // Skip both pilot trits
                continue;
            }
        }
        
        cleaned.push(trits[i]);
        dataTrits++;
    }
    
    return cleaned;
}

if (require.main === module) {
    decodeNewSequence2().catch(console.error);
}

export { decodeNewSequence2 };