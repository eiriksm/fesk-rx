import { CanonicalTritDecoder } from '../utils/canonicalTritDecoder';
import { LFSRDescrambler } from '../utils/lfsrDescrambler';
import { CRC16 } from '../utils/crc16';

async function testProperPilotRemoval() {
    console.log('🛠️  Proper Pilot Removal Implementation');
    console.log('======================================');

    const sequence = [2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,2,2,2,1,0,2,1,2,2,1,1,0,1,0,0,0,2,1,2,1,2,1,0,2,0,1,1,0,2,0,1,1,2,2,1,0,2,2,0,1,2,1,0,2,0,1,2,0,0,2,0,0,0,2,0,1,2,1,0,0,0,1,1,1,0,2,1,2,1,2,1,0,2,0,0,1,1,1,1,1,1,2,0,2,2,0,1,1,2,2,0,2,1,1,2,2,2,1,0,0,0,0,2,0,0,1,2,2,0,2,1,2,1,1,2,1,0,1,0,0,2,2,0,0,1,0,0,0,0,0,2,2,0,2,2];
    const payload = sequence.slice(25);
    
    console.log(`📊 Input payload: ${payload.length} trits`);
    
    // Implement proper pilot removal
    const cleanedTrits = removePilotsProper(payload);
    console.log(`📊 After pilot removal: ${cleanedTrits.length} trits (removed ${payload.length - cleanedTrits.length})`);
    
    // Try to decode
    await tryDecode(cleanedTrits);
}

function removePilotsProper(trits: number[]): number[] {
    const PILOT_INTERVAL = 64;
    const cleaned: number[] = [];
    let dataCount = 0;
    let i = 0;
    
    console.log('\n🔧 Pilot removal process:');
    
    while (i < trits.length) {
        // Check if we've reached a pilot interval
        if (dataCount > 0 && dataCount % PILOT_INTERVAL === 0) {
            console.log(`   At data trit ${dataCount}: checking for pilot...`);
            
            // Look ahead for [0,2] pilot sequence
            if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
                console.log(`   Found pilot [0,2] at position ${i}-${i+1}, skipping`);
                i += 2; // Skip both pilot trits
                // DO NOT increment dataCount for pilots
                continue;
            } else {
                console.log(`   No pilot found at expected position ${i}, continuing (tolerance)`);
                // Be tolerant: if pilots are missing, just keep going
            }
        }
        
        // Add data trit and increment counter
        cleaned.push(trits[i]);
        dataCount++;
        i++;
    }
    
    return cleaned;
}

async function tryDecode(trits: number[]): Promise<boolean> {
    console.log('\n🔬 Attempting decode...');
    
    try {
        const decoder = new CanonicalTritDecoder();
        for (const trit of trits) {
            decoder.addTrit(trit);
        }
        
        const bytes = decoder.getBytes();
        console.log(`   Decoded to ${bytes.length} bytes: [${Array.from(bytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        
        if (bytes.length < 4) {
            console.log('❌ Not enough bytes for frame');
            return false;
        }
        
        const descrambler = new LFSRDescrambler();
        const headerHi = descrambler.descrambleByte(bytes[0]);
        const headerLo = descrambler.descrambleByte(bytes[1]);
        const payloadLength = (headerHi << 8) | headerLo;
        
        console.log(`\n🔓 Header analysis:`);
        console.log(`   Raw: [0x${bytes[0].toString(16).padStart(2,'0')}, 0x${bytes[1].toString(16).padStart(2,'0')}]`);
        console.log(`   Descrambled: [0x${headerHi.toString(16).padStart(2,'0')}, 0x${headerLo.toString(16).padStart(2,'0')}]`);
        console.log(`   Payload length: ${payloadLength} bytes`);
        
        if (payloadLength <= 0 || payloadLength > 64) {
            console.log(`❌ Invalid payload length: ${payloadLength}`);
            return false;
        }
        
        if (bytes.length < 2 + payloadLength + 2) {
            console.log(`❌ Need ${2 + payloadLength + 2} bytes total, have ${bytes.length}`);
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
        
        console.log(`\n📦 Payload:`);
        console.log(`   Raw: [${Array.from(bytes.slice(2, 2 + payloadLength)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        console.log(`   Descrambled: [${Array.from(payload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        console.log(`   Message: "${message}"`);
        
        // Check CRC
        const crcBytes = bytes.slice(2 + payloadLength, 2 + payloadLength + 2);
        const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
        const calculatedCrc = CRC16.calculate(payload);
        
        console.log(`\n🔒 CRC verification:`);
        console.log(`   CRC bytes: [0x${crcBytes[0].toString(16).padStart(2,'0')}, 0x${crcBytes[1].toString(16).padStart(2,'0')}]`);
        console.log(`   Received: 0x${receivedCrc.toString(16).padStart(4,'0')}`);
        console.log(`   Calculated: 0x${calculatedCrc.toString(16).padStart(4,'0')}`);
        console.log(`   Valid: ${receivedCrc === calculatedCrc ? '✅' : '❌'}`);
        
        if (receivedCrc === calculatedCrc) {
            console.log(`\n🎉 SUCCESS: "${message}" (Length: ${payloadLength}, CRC: 0x${receivedCrc.toString(16).padStart(4,'0')})`);
            return true;
        } else {
            console.log(`\n⚠️  CRC mismatch - possible data corruption`);
            return false;
        }
        
    } catch (error) {
        console.log(`❌ Decode error: ${error}`);
        return false;
    }
}

if (require.main === module) {
    testProperPilotRemoval().catch(console.error);
}

export { testProperPilotRemoval };