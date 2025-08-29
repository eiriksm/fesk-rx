import { CanonicalTritDecoder } from '../utils/canonicalTritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

async function flexibleDecodeSequence2() {
    console.log('🔧 Flexible Pilot Removal - Sequence #2');
    console.log('========================================');

    const sequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,2,2,2,1,0,2,1,2,2,1,1,0,1,0,0,0,2,1,2,1,2,1,0,2,0,1,1,0,2,0,1,1,2,2,1,0,2,2,0,1,2,1,0,2,0,1,2,0,0,2,0,0,0,2,0,1,2,1,0,0,0,1,1,1,0,2,1,2,1,2,1,0,2,0,0,1,1,1,1,1,1,2,0,2,2,0,1,1,2,2,0,2,1,1,2,2,2,1,0,0,0,0,2,0,0,1,2,2,0,2,1,2,1,1,2,1,0,1,0,0,2,2,0,0,1,0,0,0,0,0,2,2,0,2,2];
    const payload = sequence.slice(25);
    
    console.log(`📊 Payload: ${payload.length} trits`);
    
    // Find all [0,2] patterns
    const pilotPositions: number[] = [];
    for (let i = 0; i < payload.length - 1; i++) {
        if (payload[i] === 0 && payload[i + 1] === 2) {
            pilotPositions.push(i);
        }
    }
    
    console.log(`\n🔍 Found ${pilotPositions.length} potential pilots at positions: [${pilotPositions.join(', ')}]`);
    
    // Try aggressive pilot removal - remove ALL [0,2] patterns
    console.log(`\n🧪 Approach 1: Remove ALL [0,2] patterns`);
    const aggressive = removeAllPilots(payload);
    console.log(`   ${payload.length} → ${aggressive.length} trits (removed ${payload.length - aggressive.length})`);
    await tryDecode(aggressive, '   ');
    
    // Try selective pilot removal based on approximate 64-trit intervals
    console.log(`\n🧪 Approach 2: Remove pilots near 64-trit intervals`);
    const selective = removeSelectivePilots(payload);
    console.log(`   ${payload.length} → ${selective.length} trits (removed ${payload.length - selective.length})`);
    await tryDecode(selective, '   ');
    
    // Try removing pilots at positions that roughly match 64-interval expectations
    console.log(`\n🧪 Approach 3: Remove by expected pattern`);
    const expected = removeExpectedPilots(payload);
    console.log(`   ${payload.length} → ${expected.length} trits (removed ${payload.length - expected.length})`);
    await tryDecode(expected, '   ');
}

function removeAllPilots(trits: number[]): number[] {
    const result: number[] = [];
    let i = 0;
    
    while (i < trits.length) {
        if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
            console.log(`   Removing [0,2] at position ${i}`);
            i += 2; // Skip both
        } else {
            result.push(trits[i]);
            i++;
        }
    }
    
    return result;
}

function removeSelectivePilots(trits: number[]): number[] {
    const result: number[] = [];
    let dataCount = 0;
    let i = 0;
    
    while (i < trits.length) {
        // Check if we're near a 64-trit boundary (within ±5 trits)
        const nearBoundary = (dataCount % 64) >= 59 || (dataCount % 64) <= 5;
        
        if (nearBoundary && i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
            console.log(`   Removing [0,2] at data position ${dataCount} (boundary check)`);
            i += 2; // Skip both
        } else {
            result.push(trits[i]);
            dataCount++;
            i++;
        }
    }
    
    return result;
}

function removeExpectedPilots(trits: number[]): number[] {
    // Based on TX code: pilots inserted every 64 data trits
    // Try to identify which [0,2] patterns are likely pilots
    const result: number[] = [];
    let dataCount = 0;
    let i = 0;
    
    const pilotPositions = [64, 128, 192]; // Expected pilot positions
    
    while (i < trits.length) {
        if (pilotPositions.includes(dataCount) && 
            i < trits.length - 1 && 
            trits[i] === 0 && trits[i + 1] === 2) {
            console.log(`   Removing expected pilot at data position ${dataCount}`);
            i += 2;
        } else {
            result.push(trits[i]);
            dataCount++;
            i++;
        }
    }
    
    return result;
}

async function tryDecode(trits: number[], indent: string = ''): Promise<boolean> {
    try {
        const decoder = new CanonicalTritDecoder();
        for (const trit of trits) {
            decoder.addTrit(trit);
        }
        
        const bytes = decoder.getBytes();
        console.log(`${indent}Decoded to ${bytes.length} bytes`);
        
        if (bytes.length < 4) {
            console.log(`${indent}❌ Not enough bytes for frame`);
            return false;
        }
        
        const descrambler = new LFSRDescrambler();
        const headerHi = descrambler.descrambleByte(bytes[0]);
        const headerLo = descrambler.descrambleByte(bytes[1]);
        const payloadLength = (headerHi << 8) | headerLo;
        
        console.log(`${indent}Header: 0x${headerHi.toString(16).padStart(2,'0')} 0x${headerLo.toString(16).padStart(2,'0')} → ${payloadLength} bytes`);
        
        if (payloadLength <= 0 || payloadLength > 64 || bytes.length < 2 + payloadLength + 2) {
            console.log(`${indent}❌ Invalid payload length or insufficient data`);
            return false;
        }
        
        // Decode payload
        const payload = new Uint8Array(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
            payload[i] = descrambler.descrambleByte(bytes[2 + i]);
        }
        
        const message = Array.from(payload).map(b => {
            if (b >= 32 && b <= 126) return String.fromCharCode(b);
            return `\\x${b.toString(16).padStart(2, '0')}`;
        }).join('');
        
        // Check CRC (unscrambled)
        const crcBytes = bytes.slice(2 + payloadLength, 2 + payloadLength + 2);
        const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
        const calculatedCrc = CRC16.calculate(payload);
        
        console.log(`${indent}Message: "${message}"`);
        console.log(`${indent}CRC: received=0x${receivedCrc.toString(16).padStart(4, '0')}, calculated=0x${calculatedCrc.toString(16).padStart(4, '0')}`);
        
        if (receivedCrc === calculatedCrc) {
            console.log(`${indent}🎉 SUCCESS: "${message}" (CRC: 0x${receivedCrc.toString(16).padStart(4, '0')})`);
            return true;
        } else {
            console.log(`${indent}❌ CRC mismatch`);
            return false;
        }
        
    } catch (error) {
        console.log(`${indent}❌ Decode error: ${error}`);
        return false;
    }
}

if (require.main === module) {
    flexibleDecodeSequence2().catch(console.error);
}

export { flexibleDecodeSequence2 };