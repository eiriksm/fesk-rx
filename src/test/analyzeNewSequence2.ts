import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

async function analyzeNewSequence2() {
  console.log("🔍 Deep Analysis of New Sequence #2");
  console.log("===================================");

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
  console.log(`📊 Payload: ${payload.length} trits`);
  console.log(`   Full payload: [${payload.join(",")}]`);

  // Look for potential pilot patterns
  console.log(`\n🔍 Looking for pilot patterns [0,2]:`);
  for (let i = 0; i < payload.length - 1; i++) {
    if (payload[i] === 0 && payload[i + 1] === 2) {
      console.log(
        `   Found [0,2] at positions ${i},${i + 1} (absolute: ${25 + i},${25 + i + 1})`,
      );
    }
  }

  // Try different interpretations
  console.log(`\n🧪 Trying different decoding approaches:`);

  // Approach 1: All trits as payload
  console.log(`\n1️⃣ Using all ${payload.length} trits:`);
  await tryDecode(payload, "   ");

  // Approach 2: Remove just the one pilot we found
  const withOnePilotRemoved = removePilots(payload);
  console.log(
    `\n2️⃣ After removing 1 pilot (${withOnePilotRemoved.length} trits):`,
  );
  await tryDecode(withOnePilotRemoved, "   ");

  // Approach 3: Try manual pilot removal at different positions
  const positions = [64, 65, 66, 67, 68]; // Try slightly different positions
  for (const pos of positions) {
    if (
      pos < payload.length - 1 &&
      payload[pos] === 0 &&
      payload[pos + 1] === 2
    ) {
      const manual = [...payload];
      manual.splice(pos, 2); // Remove 2 trits at position
      console.log(
        `\n3️⃣ Manual removal at position ${pos} (${manual.length} trits):`,
      );
      await tryDecode(manual, "   ");
    }
  }

  // Approach 4: Try different starting points (maybe we're in the middle of something)
  console.log(`\n4️⃣ Trying different starting points:`);
  for (let start = 1; start <= Math.min(10, payload.length - 20); start++) {
    const subset = payload.slice(start);
    console.log(`\n   Starting from trit ${start} (${subset.length} trits):`);
    const cleaned = removePilots(subset);
    if (cleaned.length !== subset.length) {
      await tryDecode(cleaned, "     ");
    }
  }
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

async function tryDecode(
  trits: number[],
  indent: string = "",
): Promise<boolean> {
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

    console.log(
      `${indent}Header: [0x${bytes[0].toString(16).padStart(2, "0")}, 0x${bytes[1].toString(16).padStart(2, "0")}] → [0x${headerHi.toString(16).padStart(2, "0")}, 0x${headerLo.toString(16).padStart(2, "0")}] → ${payloadLength} bytes`,
    );

    if (
      payloadLength <= 0 ||
      payloadLength > 64 ||
      bytes.length < 2 + payloadLength + 2
    ) {
      console.log(
        `${indent}❌ Invalid payload length or insufficient data (need ${2 + payloadLength + 2}, have ${bytes.length})`,
      );
      return false;
    }

    // Decode payload
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

    // Check CRC
    const crcBytes = bytes.slice(2 + payloadLength, 2 + payloadLength + 2);
    const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
    const calculatedCrc = CRC16.calculate(payload);

    console.log(`${indent}Message: "${message}"`);
    console.log(
      `${indent}CRC: received=0x${receivedCrc.toString(16).padStart(4, "0")}, calculated=0x${calculatedCrc.toString(16).padStart(4, "0")}`,
    );

    if (receivedCrc === calculatedCrc) {
      console.log(`${indent}🎉 VALID DECODE: "${message}"`);
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
  analyzeNewSequence2().catch(console.error);
}

export { analyzeNewSequence2 };
