import { TritDecoder } from "../utils/tritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

const sequence = [
  2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2, 0,
  1, 1, 2, 1, 1, 2, 2, 0, 0, 2, 1, 2, 0, 0, 1, 0, 1, 2, 1, 1, 2, 0, 1, 0, 0, 0,
  1, 1, 0, 1, 0, 1, 1, 2, 1, 1, 1, 2, 1,
];

console.log("🔍 Trying different header/payload splits");
console.log("==========================================");

// Skip preamble (0-11) and sync (12-24), start at position 25
const dataStart = 25;
const dataTrits = sequence.slice(dataStart);
console.log(`Data section (${dataStart} onwards): [${dataTrits.join(",")}]`);
console.log(`Data length: ${dataTrits.length} trits`);

// Try different header lengths
const headerLengths = [4, 5, 6, 7, 8, 9, 10];

for (const headerLen of headerLengths) {
  console.log(`\\n🧪 Trying ${headerLen} header trits:`);

  const headerTrits = dataTrits.slice(0, headerLen);
  console.log(`Header trits: [${headerTrits.join(",")}]`);

  const headerDecoder = new TritDecoder();
  for (const trit of headerTrits) {
    headerDecoder.addTrit(trit);
  }

  const headerBytes = headerDecoder.extractExactBytes(2);
  console.log(
    `Raw header bytes: [${Array.from(headerBytes)
      .map((b) => "0x" + b.toString(16).padStart(2, "0"))
      .join(", ")}]`,
  );

  // Descramble header
  const descrambler = new LFSRDescrambler();
  const headerHi = descrambler.descrambleByte(headerBytes[0]);
  const headerLo = descrambler.descrambleByte(headerBytes[1]);
  const payloadLength = (headerHi << 8) | headerLo;

  console.log(
    `Descrambled: hi=0x${headerHi.toString(16)}, lo=0x${headerLo.toString(16)} -> length=${payloadLength}`,
  );

  if (payloadLength > 0 && payloadLength <= 32) {
    console.log(`✅ Reasonable payload length: ${payloadLength} bytes`);

    // Try to decode payload with this split
    const remainingTrits = dataTrits.slice(headerLen);
    const estimatedCrcTrits = 9;
    const payloadTrits = remainingTrits.slice(
      0,
      remainingTrits.length - estimatedCrcTrits,
    );

    console.log(
      `Payload trits (${payloadTrits.length}): [${payloadTrits.join(",")}]`,
    );

    const payloadDecoder = new TritDecoder();
    for (const trit of payloadTrits) {
      payloadDecoder.addTrit(trit);
    }

    const scrambledPayload = payloadDecoder.extractExactBytes(payloadLength);
    console.log(
      `Scrambled: [${Array.from(scrambledPayload)
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(", ")}]`,
    );

    // Descramble payload
    const payload = new Uint8Array(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = descrambler.descrambleByte(scrambledPayload[i]);
    }

    const payloadText = Array.from(payload)
      .map((b) => {
        if (b >= 32 && b <= 126) return String.fromCharCode(b);
        return `\\x${b.toString(16).padStart(2, "0")}`;
      })
      .join("");

    console.log(`🎯 Decoded: "${payloadText}"`);

    // Check CRC
    const crcTrits = remainingTrits.slice(payloadTrits.length);
    if (crcTrits.length >= 8) {
      const crcDecoder = new TritDecoder();
      for (const trit of crcTrits) {
        crcDecoder.addTrit(trit);
      }

      const crcBytes = crcDecoder.extractExactBytes(2);
      const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
      const calculatedCrc = CRC16.calculate(payload);

      console.log(
        `CRC: received=0x${receivedCrc.toString(16).padStart(4, "0")}, calculated=0x${calculatedCrc.toString(16).padStart(4, "0")}, match=${receivedCrc === calculatedCrc ? "✅" : "❌"}`,
      );
    }
  }
}

console.log("\\n🏁 Analysis complete");
