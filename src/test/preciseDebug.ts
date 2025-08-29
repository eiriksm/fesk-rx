import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";

function preciseDebug() {
  console.log("🎯 Precise Debugging for 26-byte Target");
  console.log("=======================================");

  const sequence = [
    2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2,
    2, 2, 2, 1, 0, 2, 1, 2, 2, 1, 1, 0, 1, 0, 0, 0, 2, 1, 2, 1, 2, 1, 0, 2, 0,
    1, 1, 0, 2, 0, 1, 1, 2, 2, 1, 0, 2, 2, 0, 1, 2, 1, 0, 2, 0, 1, 2, 0, 0, 2,
    0, 0, 0, 2, 0, 1, 2, 1, 0, 0, 0, 1, 1, 1, 0, 2, 1, 2, 1, 2, 1, 0, 2, 0, 0,
    1, 1, 1, 1, 1, 1, 2, 0, 2, 2, 0, 1, 1, 2, 2, 0, 2, 1, 1, 2, 2, 2, 1, 0, 0,
    0, 0, 2, 0, 0, 1, 2, 2, 0, 2, 1, 2, 1, 1, 2, 1, 0, 1, 0, 0, 2, 2, 0, 0, 1,
    0, 0, 0, 0, 0, 2, 2, 0, 2, 2,
  ];
  const payload = sequence.slice(25);

  console.log(`📊 Need to go from ${payload.length} trits to 26 bytes`);
  console.log(`   Current: 135 trits → 27 bytes (1 byte too many)`);
  console.log(`   Target:  ??? trits → 26 bytes`);

  // Let's work backwards: what number of trits gives us exactly 26 bytes?
  console.log(`\n🔬 Working backwards from target:`);
  for (let tritCount = 125; tritCount <= 135; tritCount++) {
    const testTrits = payload.slice(0, tritCount);
    const decoder = new CanonicalTritDecoder();
    for (const trit of testTrits) {
      decoder.addTrit(trit);
    }
    const byteCount = decoder.getBytes().length;
    console.log(
      `   ${tritCount} trits → ${byteCount} bytes ${byteCount === 26 ? "🎯" : ""}`,
    );

    if (byteCount === 26) {
      console.log(`   ✅ FOUND IT! Need exactly ${tritCount} trits`);
      console.log(
        `   Must remove ${payload.length - tritCount} trits from payload`,
      );
      break;
    }
  }

  // Let's look at the exact positions where we need to remove trits
  console.log(`\n🔍 Finding optimal pilot removal:`);

  // We need to remove enough trits to get from 135 → target
  // Let's try removing 2 trits (1 pilot pair) at different positions
  const pilotCandidates = [64, 128]; // Expected pilot positions

  for (const pos of pilotCandidates) {
    if (
      pos < payload.length - 1 &&
      payload[pos] === 0 &&
      payload[pos + 1] === 2
    ) {
      console.log(
        `   Pilot candidate at position ${pos}: [${payload[pos]}, ${payload[pos + 1]}]`,
      );

      // Test removing this pilot
      const testTrits = [...payload];
      testTrits.splice(pos, 2);

      const decoder = new CanonicalTritDecoder();
      for (const trit of testTrits) {
        decoder.addTrit(trit);
      }
      const byteCount = decoder.getBytes().length;
      console.log(
        `     Removing pilot at ${pos}: ${payload.length} → ${testTrits.length} trits → ${byteCount} bytes`,
      );
    } else {
      console.log(`   No pilot at expected position ${pos}`);
      if (pos < payload.length) {
        console.log(
          `     Found: [${payload[pos]}, ${pos + 1 < payload.length ? payload[pos + 1] : "END"}]`,
        );
      }
    }
  }

  // Maybe we need to remove multiple pilots
  console.log(`\n🔬 Testing multiple pilot removal:`);

  // Remove pilots at 64 AND check for another one
  let testTrits = [...payload];
  let removedCount = 0;

  // Remove at position 64
  if (payload[64] === 0 && payload[65] === 2) {
    testTrits.splice(64, 2);
    removedCount += 2;
    console.log(`   Removed pilot at 64`);

    // Now look for next pilot around position 128 (but adjusted for removal)
    const adjustedPos = 128 - removedCount;
    if (
      adjustedPos < testTrits.length - 1 &&
      testTrits[adjustedPos] === 0 &&
      testTrits[adjustedPos + 1] === 2
    ) {
      testTrits.splice(adjustedPos, 2);
      removedCount += 2;
      console.log(
        `   Removed pilot at adjusted position ${adjustedPos} (originally ~128)`,
      );
    }
  }

  const decoder = new CanonicalTritDecoder();
  for (const trit of testTrits) {
    decoder.addTrit(trit);
  }
  const finalBytes = decoder.getBytes().length;

  console.log(`\n📊 Final result:`);
  console.log(
    `   ${payload.length} → ${testTrits.length} trits (removed ${removedCount}))`,
  );
  console.log(`   ${testTrits.length} trits → ${finalBytes} bytes`);
  console.log(`   Target achieved: ${finalBytes === 26 ? "🎯 YES!" : "❌ No"}`);

  if (finalBytes === 26) {
    console.log(`\n🎉 SUCCESS! The correct pilot removal is:`);
    console.log(`   - Remove [0,2] at position 64`);
    if (removedCount > 2) {
      console.log(`   - Remove [0,2] at position ~128 (adjusted)`);
    }
  }
}

if (require.main === module) {
  preciseDebug();
}

export { preciseDebug };
