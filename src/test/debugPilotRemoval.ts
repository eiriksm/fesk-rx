import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";

function debugPilotRemoval() {
  console.log("🔍 Debug Pilot Removal for Truth Sequence");
  console.log("=========================================");

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

  console.log(`📊 Payload analysis:`);
  console.log(`   Length: ${payload.length} trits`);
  console.log(`   Full payload: [${payload.join(",")}]`);

  // Find all [0,2] patterns
  const pilotCandidates: number[] = [];
  for (let i = 0; i < payload.length - 1; i++) {
    if (payload[i] === 0 && payload[i + 1] === 2) {
      pilotCandidates.push(i);
    }
  }

  console.log(
    `\n🔍 All [0,2] patterns found at positions: [${pilotCandidates.join(", ")}]`,
  );

  // Show what's around each candidate
  for (const pos of pilotCandidates) {
    const start = Math.max(0, pos - 3);
    const end = Math.min(payload.length, pos + 5);
    const context = payload.slice(start, end);
    const arrow = "   ".repeat(pos - start) + "^^";
    console.log(`   Position ${pos}: [...${context.join(",")}...]`);
    console.log(`                    ${arrow}`);
  }

  // Test different pilot removal strategies
  console.log(`\n🧪 Testing different pilot removal strategies:`);

  // Strategy 1: Remove only at expected 64-intervals
  console.log(`\n1️⃣ Remove only at 64-intervals:`);
  const strategy1 = removeOnlyAtIntervals(payload);
  console.log(`   ${payload.length} → ${strategy1.length} trits`);
  const bytes1 = tritsToBytesCount(strategy1);
  console.log(`   ${strategy1.length} trits → ${bytes1} bytes`);

  // Strategy 2: Remove ALL [0,2] patterns
  console.log(`\n2️⃣ Remove ALL [0,2] patterns:`);
  const strategy2 = removeAllPilots(payload);
  console.log(`   ${payload.length} → ${strategy2.length} trits`);
  const bytes2 = tritsToBytesCount(strategy2);
  console.log(`   ${strategy2.length} trits → ${bytes2} bytes`);

  // Strategy 3: Remove pilots based on TX pattern (every 64 + tolerances)
  console.log(`\n3️⃣ Smart removal (consider TX timing):`);
  const strategy3 = removeSmartPilots(payload);
  console.log(`   ${payload.length} → ${strategy3.length} trits`);
  const bytes3 = tritsToBytesCount(strategy3);
  console.log(`   ${strategy3.length} trits → ${bytes3} bytes`);

  // The target is 26 bytes from TX
  console.log(`\n🎯 Target: 26 bytes (from TX output)`);
  console.log(
    `   Strategy 1: ${bytes1 === 26 ? "✅" : "❌"} (${bytes1} bytes)`,
  );
  console.log(
    `   Strategy 2: ${bytes2 === 26 ? "✅" : "❌"} (${bytes2} bytes)`,
  );
  console.log(
    `   Strategy 3: ${bytes3 === 26 ? "✅" : "❌"} (${bytes3} bytes)`,
  );
}

function removeOnlyAtIntervals(trits: number[]): number[] {
  const cleaned: number[] = [];
  let dataCount = 0;
  let i = 0;

  while (i < trits.length) {
    if (dataCount > 0 && dataCount % 64 === 0) {
      if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
        console.log(`     Removed pilot at data position ${dataCount}`);
        i += 2;
        continue;
      }
    }
    cleaned.push(trits[i]);
    dataCount++;
    i++;
  }
  return cleaned;
}

function removeAllPilots(trits: number[]): number[] {
  const result: number[] = [];
  let i = 0;

  while (i < trits.length) {
    if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
      console.log(`     Removed [0,2] at position ${i}`);
      i += 2;
    } else {
      result.push(trits[i]);
      i++;
    }
  }
  return result;
}

function removeSmartPilots(trits: number[]): number[] {
  // The TX inserts pilots every 64 trits. But maybe there are multiple intervals
  // or the counting is different than expected

  // Let's try removing pilots at positions that make sense for a 22-byte message
  // 22 bytes = 176 bits. In base-3, this should be roughly 111 trits (log3(2^176))
  // Plus 2 header bytes = 24 bytes total = ~152 trits
  // Plus 2 CRC bytes = 26 bytes total = ~164 trits

  const expectedDataTrits = 164; // Rough estimate for 26 bytes
  const cleaned: number[] = [];
  let i = 0;

  while (i < trits.length && cleaned.length < expectedDataTrits) {
    // Check if this might be a pilot based on position and pattern
    if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
      // This could be a pilot - check if removing it gets us closer to target
      const remainingTrits = trits.length - i - 2;
      const currentTrits = cleaned.length;
      const wouldEndUp = currentTrits + remainingTrits;

      if (wouldEndUp > expectedDataTrits * 1.1) {
        // If we'd overshoot, it's probably a pilot
        console.log(`     Smart removal at position ${i} (would overshoot)`);
        i += 2;
        continue;
      }
    }

    cleaned.push(trits[i]);
    i++;
  }

  return cleaned;
}

function tritsToBytesCount(trits: number[]): number {
  const decoder = new CanonicalTritDecoder();
  for (const trit of trits) {
    decoder.addTrit(trit);
  }
  return decoder.getBytes().length;
}

if (require.main === module) {
  debugPilotRemoval();
}

export { debugPilotRemoval };
