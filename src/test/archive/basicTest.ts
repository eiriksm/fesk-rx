import { TritDecoder } from "../utils/tritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

console.log("🧪 Testing basic components");
console.log("===========================");

// Test 1: TritDecoder with known pattern
console.log("\\n1. Testing TritDecoder with header trits [0,1,1,2,1,1]");
const headerDecoder = new TritDecoder();
const headerTrits = [0, 1, 1, 2, 1, 1]; // Should give us 2 bytes for length 4

for (const trit of headerTrits) {
  headerDecoder.addTrit(trit);
}

const headerBytes = headerDecoder.extractExactBytes(2);
console.log(
  `Raw header bytes: [${Array.from(headerBytes)
    .map((b) => "0x" + b.toString(16).padStart(2, "0"))
    .join(", ")}]`,
);

// Test 2: LFSR descrambling
console.log("\\n2. Testing LFSR descrambling");
const descrambler = new LFSRDescrambler();

// Descramble header to get payload length
const hiDescrambled = descrambler.descrambleByte(headerBytes[0]);
const loDescrambled = descrambler.descrambleByte(headerBytes[1]);
const payloadLength = (hiDescrambled << 8) | loDescrambled;

console.log(
  `Header descrambled: hi=0x${hiDescrambled.toString(16).padStart(2, "0")}, lo=0x${loDescrambled.toString(16).padStart(2, "0")}`,
);
console.log(`Payload length: ${payloadLength}`);

// Test 3: TritDecoder with payload trits
console.log("\\n3. Testing TritDecoder with payload trits");
const payloadTrits = [
  2, 2, 0, 0, 2, 1, 2, 0, 0, 1, 0, 1, 2, 1, 1, 2, 0, 1, 0, 0, 0, 1, 1, 0, 1,
]; // From the TX output

const payloadDecoder = new TritDecoder();
for (const trit of payloadTrits) {
  payloadDecoder.addTrit(trit);
}

const scrambledPayload = payloadDecoder.extractExactBytes(4);
console.log(
  `Scrambled payload: [${Array.from(scrambledPayload)
    .map((b) => "0x" + b.toString(16).padStart(2, "0"))
    .join(", ")}]`,
);

// Test 4: Descramble payload
console.log("\\n4. Testing payload descrambling");
const descrambledPayload = new Uint8Array(4);
for (let i = 0; i < 4; i++) {
  descrambledPayload[i] = descrambler.descrambleByte(scrambledPayload[i]);
}

console.log(
  `Descrambled payload: [${Array.from(descrambledPayload)
    .map((b) => "0x" + b.toString(16).padStart(2, "0"))
    .join(", ")}]`,
);
console.log(
  `As text: "${Array.from(descrambledPayload)
    .map((b) => String.fromCharCode(b))
    .join("")}"`,
);

// Test 5: CRC validation
console.log("\\n5. Testing CRC calculation");
const calculatedCrc = CRC16.calculate(descrambledPayload);
console.log(`Calculated CRC: 0x${calculatedCrc.toString(16).padStart(4, "0")}`);

// Test CRC trits
const crcTrits = [0, 1, 1, 2, 1, 1, 1, 2, 1]; // From the TX output
const crcDecoder = new TritDecoder();
for (const trit of crcTrits) {
  crcDecoder.addTrit(trit);
}

const crcBytes = crcDecoder.extractExactBytes(2);
const receivedCrc = (crcBytes[0] << 8) | crcBytes[1];
console.log(`Received CRC: 0x${receivedCrc.toString(16).padStart(4, "0")}`);
console.log(`CRC matches: ${calculatedCrc === receivedCrc ? "✅" : "❌"}`);

console.log("\\n🏁 Basic component test complete");
