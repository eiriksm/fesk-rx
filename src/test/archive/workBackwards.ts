// Work backwards from known answer to understand the encoding

console.log('🔄 Working backwards from "test"');
console.log("=================================");

// We know the answer should be "test"
const expectedMessage = "test";
const expectedBytes = Array.from(Buffer.from(expectedMessage));
console.log(`Expected message: "${expectedMessage}"`);
console.log(
  `Expected bytes: [${expectedBytes.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}]`,
);

// From the sequence, extract the data section
const sequence = [
  2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 2, 0, 2, 0,
  1, 1, 2, 1, 1, 2, 2, 0, 0, 2, 1, 2, 0, 0, 1, 0, 1, 2, 1, 1, 2, 0, 1, 0, 0, 0,
  1, 1, 0, 1, 0, 1, 1, 2, 1, 1, 1, 2, 1,
];
const payloadSection = sequence.slice(25); // After preamble + sync

console.log(`\\nPayload section: [${payloadSection.join(",")}]`);
console.log(`Length: ${payloadSection.length} trits`);

// Let's assume header is ~6 trits, payload is ~25 trits (like in your example), CRC is ~9 trits
const headerTrits = payloadSection.slice(0, 6);
const payloadTrits = payloadSection.slice(6, 31);
const crcTrits = payloadSection.slice(31);

console.log(`\\nSplit assumption:`);
console.log(`Header (6):   [${headerTrits.join(",")}]`);
console.log(`Payload (25): [${payloadTrits.join(",")}]`);
console.log(`CRC (9):      [${crcTrits.join(",")}]`);

// Now let's see what these decode to with current algorithm
import { TritDecoder } from "../utils/tritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

console.log("\\n🧮 Testing current algorithm:");

// Header
const headerDecoder = new TritDecoder();
for (const trit of headerTrits) headerDecoder.addTrit(trit);
const headerBytes = headerDecoder.extractExactBytes(2);
console.log(
  `Header bytes: [${Array.from(headerBytes)
    .map((b) => "0x" + b.toString(16).padStart(2, "0"))
    .join(", ")}]`,
);

const descrambler = new LFSRDescrambler();
const headerHi = descrambler.descrambleByte(headerBytes[0]);
const headerLo = descrambler.descrambleByte(headerBytes[1]);
const payloadLength = (headerHi << 8) | headerLo;
console.log(`Descrambled header: length=${payloadLength}`);

// If length is reasonable, try payload
if (payloadLength === 4) {
  console.log("✅ Header looks correct!");

  // Payload
  const payloadDecoder = new TritDecoder();
  for (const trit of payloadTrits) payloadDecoder.addTrit(trit);
  const payloadBytes = payloadDecoder.extractExactBytes(4);
  console.log(
    `Payload bytes: [${Array.from(payloadBytes)
      .map((b) => "0x" + b.toString(16).padStart(2, "0"))
      .join(", ")}]`,
  );

  const payload = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    payload[i] = descrambler.descrambleByte(payloadBytes[i]);
  }
  const text = Array.from(payload)
    .map((b) => String.fromCharCode(b))
    .join("");
  console.log(`Descrambled: "${text}"`);

  if (text === "test") {
    console.log("🎉 SUCCESS! Algorithm works correctly!");
  } else {
    console.log("❌ Still not matching - need to debug further");

    // Let's try the exact known scrambled values
    console.log("\\n🔍 Trying with known scrambled values:");
    console.log('From TX: "test" scrambles to [0x9c, 0x29, 0xe3, 0x06]');

    const knownScrambled = [0x9c, 0x29, 0xe3, 0x06];
    const testDescrambler = new LFSRDescrambler();
    // Skip header
    testDescrambler.descrambleByte(0x00);
    testDescrambler.descrambleByte(0x04);

    const testDecoded = knownScrambled.map((b) =>
      testDescrambler.descrambleByte(b),
    );
    const testText = testDecoded.map((b) => String.fromCharCode(b)).join("");
    console.log(`Known scrambled -> "${testText}"`);

    // So if our decoder gets different bytes, the trit->byte conversion is wrong
    console.log(`\\nPayload comparison:`);
    console.log(
      `Expected scrambled: [${knownScrambled.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}]`,
    );
    console.log(
      `Our decoded:        [${Array.from(payloadBytes)
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(", ")}]`,
    );
  }
} else {
  console.log(`❌ Header length wrong: ${payloadLength}, expected 4`);
}

console.log("\\n🏁 Analysis complete");
