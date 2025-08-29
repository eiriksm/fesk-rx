import { TritDecoder } from "../utils/tritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

const sequence = [
  2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2, 0,
  1, 1, 2, 1, 1, 2, 2, 0, 0, 2, 1, 2, 0, 0, 1, 0, 1, 2, 1, 1, 2, 0, 1, 0, 0, 0,
  1, 1, 0, 1, 0, 1, 1, 2, 1, 1, 1, 2, 1,
];

console.log("🔍 Decoding FESK sequence");
console.log("========================");
console.log(`Sequence length: ${sequence.length} symbols`);
console.log(`Sequence: [${sequence.join(",")}]`);

// Based on the FESK protocol structure:
// Preamble: 12 symbols (alternating 2,0 for binary 1,0)
// Sync: 13 symbols (Barker-13: 1,1,1,1,1,0,0,1,1,0,1,0,1 -> 2,2,2,2,2,0,0,2,2,0,2,0,2)
// Header: ~6 symbols (payload length)
// Payload: variable symbols
// CRC: ~9 symbols

console.log("\n📋 Parsing protocol structure:");

// Check for preamble pattern (alternating 2,0)
const preambleExpected = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0];
const preambleActual = sequence.slice(0, 12);
const preambleMatch =
  JSON.stringify(preambleExpected) === JSON.stringify(preambleActual);
console.log(
  `Preamble (0-11): [${preambleActual.join(",")}] ${preambleMatch ? "✅" : "❌"}`,
);

// Check for Barker-13 sync pattern
const barker13Expected = [2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2];
const barker13Actual = sequence.slice(12, 25);
const barker13Match =
  JSON.stringify(barker13Expected) === JSON.stringify(barker13Actual);
console.log(
  `Sync (12-24): [${barker13Actual.join(",")}] ${barker13Match ? "✅" : "❌"}`,
);

if (preambleMatch && barker13Match) {
  console.log("\n✅ Valid FESK transmission detected!");

  // Parse header (positions 25 onwards)
  const headerStart = 25;
  const headerTrits = sequence.slice(headerStart, headerStart + 6); // Try 6 trits first

  console.log(`\n📤 Header trits (25-30): [${headerTrits.join(",")}]`);

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
    `Descrambled header: hi=0x${headerHi.toString(16).padStart(2, "0")}, lo=0x${headerLo.toString(16).padStart(2, "0")}`,
  );
  console.log(`Payload length: ${payloadLength} bytes`);

  if (payloadLength > 0 && payloadLength <= 64) {
    // Parse payload - estimate trit count needed
    const expectedPayloadTrits = Math.ceil(payloadLength * 5.3); // ~5.3 trits per byte
    const payloadStart = headerStart + 6;
    const payloadEnd = Math.min(
      sequence.length - 9,
      payloadStart + expectedPayloadTrits,
    ); // Leave 9 for CRC
    const payloadTrits = sequence.slice(payloadStart, payloadEnd);

    console.log(
      `\n📦 Payload trits (${payloadStart}-${payloadEnd - 1}): [${payloadTrits.join(",")}]`,
    );

    const payloadDecoder = new TritDecoder();
    for (const trit of payloadTrits) {
      payloadDecoder.addTrit(trit);
    }

    const scrambledPayload = payloadDecoder.extractExactBytes(payloadLength);
    console.log(
      `Scrambled payload: [${Array.from(scrambledPayload)
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(", ")}]`,
    );

    // Descramble payload
    const payload = new Uint8Array(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = descrambler.descrambleByte(scrambledPayload[i]);
    }

    console.log(
      `Descrambled payload: [${Array.from(payload)
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(", ")}]`,
    );
    const payloadText = Array.from(payload)
      .map((b) => String.fromCharCode(b))
      .join("");
    console.log(`📝 Decoded message: "${payloadText}"`);

    // Parse CRC
    const crcTrits = sequence.slice(payloadEnd);
    console.log(
      `\n🔒 CRC trits (${payloadEnd}-${sequence.length - 1}): [${crcTrits.join(",")}]`,
    );

    if (crcTrits.length >= 8) {
      const crcDecoder = new TritDecoder();
      for (const trit of crcTrits.slice(0, 9)) {
        // Take up to 9 trits for CRC
        crcDecoder.addTrit(trit);
      }

      const crcBytes = crcDecoder.extractExactBytes(2);
      const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
      const calculatedCrc = CRC16.calculate(payload);

      console.log(
        `Received CRC: 0x${receivedCrc.toString(16).padStart(4, "0")}`,
      );
      console.log(
        `Calculated CRC: 0x${calculatedCrc.toString(16).padStart(4, "0")}`,
      );
      console.log(`CRC valid: ${receivedCrc === calculatedCrc ? "✅" : "❌"}`);

      console.log(
        `\n🎉 FINAL RESULT: "${payloadText}" ${receivedCrc === calculatedCrc ? "(verified)" : "(CRC mismatch)"}`,
      );
    } else {
      console.log(`⚠️  Insufficient CRC data: ${crcTrits.length} trits`);
    }
  } else {
    console.log(`❌ Invalid payload length: ${payloadLength}`);
  }
} else {
  console.log("\n❌ Not a valid FESK transmission (preamble/sync mismatch)");
}

console.log("\n🏁 Decoding complete");
