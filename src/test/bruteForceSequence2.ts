import { CanonicalTritDecoder } from '../utils/canonicalTritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

async function bruteForceSequence2() {
    console.log('🔬 Brute Force Analysis of Sequence #2');
    console.log('======================================');

    const sequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,2,2,2,1,0,2,1,2,2,1,1,0,1,0,0,0,2,1,2,1,2,1,0,2,0,1,1,0,2,0,1,1,2,2,1,0,2,2,0,1,2,1,0,2,0,1,2,0,0,2,0,0,0,2,0,1,2,1,0,0,0,1,1,1,0,2,1,2,1,2,1,0,2,0,0,1,1,1,1,1,1,2,0,2,2,0,1,1,2,2,0,2,1,1,2,2,2,1,0,0,0,0,2,0,0,1,2,2,0,2,1,2,1,1,2,1,0,1,0,0,2,2,0,0,1,0,0,0,0,0,2,2,0,2,2];
    const payload = sequence.slice(25);
    
    console.log(`🎯 Trying different payload interpretations...`);
    
    // Try various reasonable length subsets that might decode to something meaningful
    const reasonableLengths = [25, 30, 35, 41, 47, 50, 55, 60]; // Based on typical message lengths
    
    for (const len of reasonableLengths) {
        if (len <= payload.length) {
            console.log(`\n📏 Trying first ${len} trits:`);
            const subset = payload.slice(0, len);
            await tryDecodeSubset(subset, '   ');
        }
    }
    
    // Try subsets that might have specific patterns or known messages
    console.log(`\n🔍 Looking for patterns that decode to known words:`);
    
    // Look for sequences that might decode to common words
    const knownWords = ['hello', 'world', 'test', 'four56', 'howd', 'message', 'data'];
    
    for (let start = 0; start < Math.min(20, payload.length - 30); start++) {
        for (let len = 25; len <= Math.min(60, payload.length - start); len += 5) {
            const subset = payload.slice(start, start + len);
            const result = await tryDecodeSubset(subset, '', false);
            
            if (result && result.message) {
                const words = result.message.toLowerCase().split(/\W+/).filter((w: string) => w.length > 2);
                const hasKnownWord = words.some((w: string) => knownWords.includes(w));
                
                if (hasKnownWord || words.some((w: string) => w.length >= 4)) {
                    console.log(`\n🎯 Interesting result at start=${start}, len=${len}:`);
                    console.log(`   Message: "${result.message}"`);
                    console.log(`   Words found: [${words.join(', ')}]`);
                    console.log(`   CRC valid: ${result.isValid}`);
                }
            }
        }
    }
}

async function tryDecodeSubset(trits: number[], indent: string = '', log: boolean = true): Promise<any> {
    try {
        const decoder = new CanonicalTritDecoder();
        for (const trit of trits) {
            decoder.addTrit(trit);
        }
        
        const bytes = decoder.getBytes();
        if (log) console.log(`${indent}Trits: ${trits.length} → Bytes: ${bytes.length}`);
        
        if (bytes.length < 4) {
            if (log) console.log(`${indent}❌ Not enough bytes`);
            return null;
        }
        
        const descrambler = new LFSRDescrambler();
        const headerHi = descrambler.descrambleByte(bytes[0]);
        const headerLo = descrambler.descrambleByte(bytes[1]);
        const payloadLength = (headerHi << 8) | headerLo;
        
        if (log) console.log(`${indent}Payload length: ${payloadLength} bytes`);
        
        if (payloadLength <= 0 || payloadLength > 64 || bytes.length < 2 + payloadLength + 2) {
            if (log) console.log(`${indent}❌ Invalid length or insufficient data`);
            return null;
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
        
        // Check CRC
        const crcBytes = bytes.slice(2 + payloadLength, 2 + payloadLength + 2);
        const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
        const calculatedCrc = CRC16.calculate(payload);
        const isValid = receivedCrc === calculatedCrc;
        
        if (log) {
            console.log(`${indent}Message: "${message}"`);
            console.log(`${indent}CRC: ${isValid ? '✅' : '❌'} (0x${receivedCrc.toString(16).padStart(4, '0')})`);
        }
        
        return {
            message,
            isValid,
            payloadLength,
            crc: receivedCrc
        };
        
    } catch (error) {
        if (log) console.log(`${indent}❌ Error: ${error}`);
        return null;
    }
}

if (require.main === module) {
    bruteForceSequence2().catch(console.error);
}

export { bruteForceSequence2 };