import { LFSRDescrambler } from '../utils/lfsrDescrambler';

function lfsrDebug() {
    console.log('🔬 LFSR Debug - Step by step comparison');
    console.log('======================================');

    // Test with the first byte from our working "test" sequence
    // We know that raw 0x8b should descramble to 0x00 for a 4-byte payload
    const testByte = 0x8b;
    
    console.log(`\n🧪 Testing byte 0x${testByte.toString(16).padStart(2, '0')}:`);
    console.log(`   Expected result: 0x00 (from working "test" sequence)`);
    
    const descrambler = new LFSRDescrambler();
    console.log(`   Initial LFSR state: 0x${descrambler['state'].toString(16).padStart(3, '0')}`);
    
    // Step through bit by bit
    let result = 0;
    let state = 0x1FF; // Initial state
    
    console.log(`\n   Bit-by-bit processing:`);
    for (let i = 0; i < 8; i++) {
        const lfsrBit = state & 1;
        const inputBit = (testByte >> i) & 1;
        const outputBit = inputBit ^ lfsrBit;
        result |= outputBit << i;
        
        console.log(`     Bit ${i}: LFSR=0x${state.toString(16).padStart(3,'0')} lsb=${lfsrBit}, input=${inputBit}, output=${outputBit}`);
        
        // Advance LFSR
        const feedback = ((state >> 8) ^ (state >> 4)) & 1;
        state = ((state << 1) | feedback) & 0x1FF;
        console.log(`       Next LFSR state: 0x${state.toString(16).padStart(3,'0')} (feedback=${feedback})`);
    }
    
    console.log(`\n   Final result: 0x${result.toString(16).padStart(2, '0')}`);
    
    // Compare with our class
    const classResult = new LFSRDescrambler().descrambleByte(testByte);
    console.log(`   Class result: 0x${classResult.toString(16).padStart(2, '0')}`);
    console.log(`   Match: ${result === classResult ? '✅' : '❌'}`);
    
    // Test against expected
    console.log(`   Expected 0x00: ${result === 0x00 ? '✅' : '❌'}`);
    
    if (result !== 0x00) {
        console.log(`\n❌ LFSR mismatch detected!`);
        console.log(`   This explains why we get wrong payload lengths.`);
        console.log(`   Need to match TX LFSR exactly.`);
    }
}

if (require.main === module) {
    lfsrDebug();
}

export { lfsrDebug };