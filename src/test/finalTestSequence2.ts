import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

async function finalTestSequence2() {
  console.log("🎯 Final Test - Sequence #2 with Updated Logic");
  console.log("==============================================");

  const sequence = [
    2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2,
    2, 2, 2, 1, 0, 2, 1, 2, 2, 1, 1, 0, 1, 0, 0, 0, 2, 1, 2, 1, 2, 1, 0, 2, 0,
    1, 1, 0, 2, 0, 1, 1, 2, 2, 1, 0, 2, 2, 0, 1, 2, 1, 0, 2, 0, 1, 2, 0, 0, 2,
    0, 0, 0, 2, 0, 1, 2, 1, 0, 0, 0, 1, 1, 1, 0, 2, 1, 2, 1, 2, 1, 0, 2, 0, 0,
    1, 1, 1, 1, 1, 1, 2, 0, 2, 2, 0, 1, 1, 2, 2, 0, 2, 1, 1, 2, 2, 2, 1, 0, 0,
    0, 0, 2, 0, 0, 1, 2, 2, 0, 2, 1, 2, 1, 1, 2, 1, 0, 1, 0, 0, 2, 2, 0, 0, 1,
    0, 0, 0, 0, 0, 2, 2, 0, 2, 2,
  ];

  // Verify structure
  const preamble = sequence.slice(0, 12);
  const sync = sequence.slice(12, 25);
  const payload = sequence.slice(25);

  console.log(`📊 Structure check:`);
  console.log(
    `   Preamble: [${preamble.join(",")}] - ${isPreambleValid(preamble) ? "✅" : "❌"}`,
  );
  console.log(
    `   Sync: [${sync.join(",")}] - ${isSyncValid(sync) ? "✅" : "❌"}`,
  );
  console.log(`   Payload: ${payload.length} trits`);

  if (!isPreambleValid(preamble) || !isSyncValid(sync)) {
    console.log("❌ Invalid preamble or sync");
    return;
  }

  console.log(`\n🔧 Using updated pilot removal logic...`);

  // Use the same logic as the updated FeskDecoder
  const cleanedTrits = removePilotsUpdated(payload);
  console.log(
    `   ${payload.length} → ${cleanedTrits.length} trits (removed ${payload.length - cleanedTrits.length} pilots)`,
  );

  // Try to decode
  await tryDecode(cleanedTrits);
}

function isPreambleValid(preamble: number[]): boolean {
  if (preamble.length !== 12) return false;
  for (let i = 0; i < preamble.length; i++) {
    const expected = i % 2 === 0 ? 2 : 0; // f2, f0, f2, f0, ...
    if (preamble[i] !== expected) return false;
  }
  return true;
}

function isSyncValid(sync: number[]): boolean {
  // Barker-13: 1,1,1,1,1,0,0,1,1,0,1,0,1 mapped to f2=1, f0=0
  const expectedBarker = [2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2];
  if (sync.length !== 13) return false;
  return sync.every((s, i) => s === expectedBarker[i]);
}

function removePilotsUpdated(trits: number[]): number[] {
  const PILOT_INTERVAL = 64;
  const cleaned: number[] = [];
  let dataCount = 0;
  let i = 0;

  while (i < trits.length) {
    // Check if we've reached a pilot interval
    if (dataCount > 0 && dataCount % PILOT_INTERVAL === 0) {
      // Look ahead for [0,2] pilot sequence
      if (i < trits.length - 1 && trits[i] === 0 && trits[i + 1] === 2) {
        console.log(
          `   Found and removed pilot [0,2] at data position ${dataCount}`,
        );
        i += 2; // Skip both pilot trits
        // DO NOT increment dataCount for pilots
        continue;
      }
      // Be tolerant: if pilots are missing, just keep going
    }

    // Add data trit and increment counter
    cleaned.push(trits[i]);
    dataCount++;
    i++;
  }

  return cleaned;
}

async function tryDecode(trits: number[]): Promise<boolean> {
  console.log("\n🔬 Decoding attempt...");

  try {
    const decoder = new CanonicalTritDecoder();
    for (const trit of trits) {
      decoder.addTrit(trit);
    }

    const bytes = decoder.getBytes();
    console.log(`   Trits → Bytes: ${trits.length} → ${bytes.length}`);

    if (bytes.length < 4) {
      console.log("❌ Insufficient bytes for FESK frame");
      return false;
    }

    const descrambler = new LFSRDescrambler();
    const headerHi = descrambler.descrambleByte(bytes[0]);
    const headerLo = descrambler.descrambleByte(bytes[1]);
    const payloadLength = (headerHi << 8) | headerLo;

    console.log(
      `   Header: 0x${headerHi.toString(16).padStart(2, "0")}${headerLo.toString(16).padStart(2, "0")} → ${payloadLength} bytes`,
    );

    if (payloadLength <= 0 || payloadLength > 64) {
      console.log(`❌ Unrealistic payload length: ${payloadLength}`);
      console.log(`   This suggests the sequence is not a valid FESK frame.`);
      console.log(
        `   Either the transmission was incomplete, corrupted, or not generated properly.`,
      );
      return false;
    }

    if (bytes.length < 2 + payloadLength + 2) {
      console.log(
        `❌ Need ${2 + payloadLength + 2} bytes total, have ${bytes.length}`,
      );
      return false;
    }

    // Continue with decoding...
    const payload = new Uint8Array(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = descrambler.descrambleByte(bytes[2 + i]);
    }

    const message = Array.from(payload)
      .map((b) => {
        if (b >= 32 && b <= 126) return String.fromCharCode(b);
        return `\\x${b.toString(16).padStart(2, "0")}`;
      })
      .join("");

    const crcBytes = bytes.slice(2 + payloadLength, 2 + payloadLength + 2);
    const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const calculatedCrc = CRC16.calculate(payload);

    const isValid = receivedCrc === calculatedCrc;

    console.log(`\n🎉 DECODE RESULT:`);
    console.log(`   Message: "${message}"`);
    console.log(`   Length: ${payloadLength} bytes`);
    console.log(
      `   CRC: 0x${receivedCrc.toString(16).padStart(4, "0")} ${isValid ? "✅" : "❌"}`,
    );

    return isValid;
  } catch (error) {
    console.log(`❌ Decode error: ${error}`);
    return false;
  }
}

if (require.main === module) {
  finalTestSequence2().catch(console.error);
}

export { finalTestSequence2 };
