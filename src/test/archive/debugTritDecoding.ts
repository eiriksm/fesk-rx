// Debug the trit decoding by simulating the exact TX algorithm

console.log("🔬 Debugging trit decoding");
console.log("===========================");

// Known facts from TX:
// - "test" = [0x74, 0x65, 0x73, 0x74]
// - Scrambled to [0x9c, 0x29, 0xe3, 0x06]
// - Should produce payload trits [2,2,0,0,2,1,2,0,0,1,0,1,2,1,1,2,0,1,0,0,0,1,1,0,1]

const expectedScrambledBytes = [0x9c, 0x29, 0xe3, 0x06];
const expectedPayloadTrits = [
  2, 2, 0, 0, 2, 1, 2, 0, 0, 1, 0, 1, 2, 1, 1, 2, 0, 1, 0, 0, 0, 1, 1, 0, 1,
];

console.log(
  "Expected scrambled bytes:",
  expectedScrambledBytes
    .map((b) => "0x" + b.toString(16).padStart(2, "0"))
    .join(", "),
);
console.log("Expected payload trits: ", expectedPayloadTrits.join(","));

// Simulate the TX packing algorithm more precisely
function simulateTXPackingIncremental(bytes: number[]): number[] {
  console.log("\\n🔧 Simulating TX packing (incremental style):");

  // Simulate the incremental packing approach from TX
  let packWork: number[] = [];
  let tritAccumulator = 0;
  let tritsInAccumulator = 0;
  const allTrits: number[] = [];

  for (let byteIdx = 0; byteIdx < bytes.length; byteIdx++) {
    const byte = bytes[byteIdx];
    console.log(
      `\\nProcessing byte ${byteIdx}: 0x${byte.toString(16).padStart(2, "0")}`,
    );

    // Append byte to pack_work
    packWork.push(byte);
    console.log(
      `  pack_work: [${packWork.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}]`,
    );

    // Do division passes
    const remBatch: number[] = [];

    // At least one division
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

    remBatch.push(carry);
    packWork = newWork;

    // Maybe a couple more passes
    for (let pass = 0; pass < 2 && packWork.length > 0; pass++) {
      carry = 0;
      const nextWork: number[] = [];

      for (let i = 0; i < packWork.length; i++) {
        const cur = (carry << 8) | packWork[i];
        const quotient = Math.floor(cur / 3);
        carry = cur % 3;

        if (nextWork.length > 0 || quotient > 0) {
          nextWork.push(quotient);
        }
      }

      remBatch.push(carry);
      packWork = nextWork;
    }

    console.log(`  remainders from this byte: [${remBatch.join(", ")}]`);

    // Push remainders MS-first into trit accumulator
    for (let r = remBatch.length - 1; r >= 0; r--) {
      const trit = remBatch[r];
      tritAccumulator = (tritAccumulator << 2) | trit;
      tritsInAccumulator++;

      console.log(
        `    pushed trit ${trit}, accumulator now has ${tritsInAccumulator} trits`,
      );
    }

    // Extract trits when we have some
    while (tritsInAccumulator > 0) {
      tritsInAccumulator--;
      const extractedTrit = (tritAccumulator >> (tritsInAccumulator * 2)) & 3;
      allTrits.push(extractedTrit);
      console.log(`    extracted trit ${extractedTrit}`);
    }
  }

  // Flush remaining
  while (packWork.length > 0) {
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

    // Push remainder MS-first
    tritAccumulator = (tritAccumulator << 2) | carry;
    tritsInAccumulator++;
    packWork = newWork;
  }

  // Extract final trits
  while (tritsInAccumulator > 0) {
    tritsInAccumulator--;
    const extractedTrit = (tritAccumulator >> (tritsInAccumulator * 2)) & 3;
    allTrits.push(extractedTrit);
  }

  console.log(`\\n  Final trits: [${allTrits.join(",")}]`);
  return allTrits;
}

const simulatedTrits = simulateTXPackingIncremental(expectedScrambledBytes);
console.log("\\n🎯 Comparison:");
console.log(`Expected: [${expectedPayloadTrits.join(",")}]`);
console.log(`Simulated: [${simulatedTrits.join(",")}]`);
console.log(
  `Match: ${JSON.stringify(expectedPayloadTrits) === JSON.stringify(simulatedTrits) ? "✅" : "❌"}`,
);

if (JSON.stringify(expectedPayloadTrits) === JSON.stringify(simulatedTrits)) {
  console.log("\\n✅ TX simulation is correct!");
}

console.log("\\n🏁 Debug complete");
