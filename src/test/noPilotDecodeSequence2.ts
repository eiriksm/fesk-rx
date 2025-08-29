import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

async function noPilotDecodeSequence2() {
  console.log("🚫 No Pilot Removal - Sequence #2");
  console.log("==================================");

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
  console.log(`   First 20: [${payload.slice(0, 20).join(", ")}]`);
  console.log(`   Last 20: [${payload.slice(-20).join(", ")}]`);

  // Try different lengths without any pilot removal
  const testLengths = [30, 40, 50, 60, 70, 80, 90, 100];

  for (const len of testLengths) {
    if (len <= payload.length) {
      console.log(`\n📏 Testing first ${len} trits (no pilot removal):`);
      const subset = payload.slice(0, len);
      await tryDecode(subset, "   ");
    }
  }

  // Also try the full payload
  console.log(`\n📏 Testing full ${payload.length} trits (no pilot removal):`);
  await tryDecode(payload, "   ");
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
    if (bytes.length < 4) {
      console.log(
        `${indent}${trits.length} trits → ${bytes.length} bytes (insufficient)`,
      );
      return false;
    }

    const descrambler = new LFSRDescrambler();
    const headerHi = descrambler.descrambleByte(bytes[0]);
    const headerLo = descrambler.descrambleByte(bytes[1]);
    const payloadLength = (headerHi << 8) | headerLo;

    console.log(
      `${indent}${trits.length} trits → ${bytes.length} bytes → header: ${payloadLength} payload bytes`,
    );

    if (
      payloadLength > 0 &&
      payloadLength <= 64 &&
      bytes.length >= 2 + payloadLength + 2
    ) {
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

      console.log(`${indent}   Message: "${message}"`);
      console.log(
        `${indent}   CRC: ${receivedCrc === calculatedCrc ? "✅" : "❌"} (0x${receivedCrc.toString(16).padStart(4, "0")})`,
      );

      if (receivedCrc === calculatedCrc) {
        console.log(`${indent}🎉 SUCCESS: "${message}"`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.log(`${indent}${trits.length} trits → Error: ${error}`);
    return false;
  }
}

if (require.main === module) {
  noPilotDecodeSequence2().catch(console.error);
}

export { noPilotDecodeSequence2 };
