import { CanonicalTritDecoder } from "../utils/canonicalTritDecoder";
import { LFSRDescrambler } from "../utils/lfsrDescrambler";
import { CRC16 } from "../utils/crc16";

describe("CanonicalTritDecoder", () => {
  let decoder: CanonicalTritDecoder;

  beforeEach(() => {
    decoder = new CanonicalTritDecoder();
  });

  describe("basicFunctionality", () => {
    it("should handle empty input", () => {
      const bytes = decoder.getBytes();
      expect(bytes).toEqual(new Uint8Array([0]));
    });

    it("should decode single trit correctly", () => {
      decoder.addTrit(1);
      const bytes = decoder.getBytes();
      expect(bytes).toEqual(new Uint8Array([1]));
    });

    it("should decode multiple trits correctly", () => {
      // Test with trits [1,0,2] which should give value 1*9 + 0*3 + 2*1 = 11
      decoder.addTrit(1);
      decoder.addTrit(0);
      decoder.addTrit(2);
      const bytes = decoder.getBytes();
      expect(bytes).toEqual(new Uint8Array([11]));
    });
  });

  describe("testMessageDecoding", () => {
    it('should decode "test" payload trits correctly', () => {
      // Known payload trits for "test" (after removing preamble/sync)
      const payloadTrits = [
        1, 0, 1, 1, 0, 0, 1, 0, 1, 2, 2, 1, 0, 2, 0, 1, 1, 0, 1, 1, 1, 1, 1, 2,
        2, 1, 0, 2, 2, 1, 0, 1, 0, 2, 1, 2, 0, 2, 2, 1, 0,
      ];

      for (const trit of payloadTrits) {
        decoder.addTrit(trit);
      }

      const allBytes = decoder.getBytes();
      expect(allBytes.length).toBe(8); // header(2) + payload(4) + crc(2)

      // Expected bytes: [0xc1, 0xff, 0x9c, 0x29, 0xe3, 0x06, 0x1f, 0xc6]
      expect(allBytes).toEqual(
        new Uint8Array([0xc1, 0xff, 0x9c, 0x29, 0xe3, 0x06, 0x1f, 0xc6]),
      );

      // Verify the decoding by descrambling
      const descrambler = new LFSRDescrambler();

      // Header
      const headerHi = descrambler.descrambleByte(allBytes[0]);
      const headerLo = descrambler.descrambleByte(allBytes[1]);
      const payloadLength = (headerHi << 8) | headerLo;
      expect(payloadLength).toBe(4);

      // Payload
      const payload = new Uint8Array(4);
      for (let i = 0; i < 4; i++) {
        payload[i] = descrambler.descrambleByte(allBytes[2 + i]);
      }
      expect(new TextDecoder().decode(payload)).toBe("test");

      // CRC
      const receivedCrc = (allBytes[6] << 8) | allBytes[7];
      const calculatedCrc = CRC16.calculate(payload);
      expect(receivedCrc).toBe(calculatedCrc);
      expect(receivedCrc).toBe(0x1fc6);
    });
  });

  describe("four56MessageDecoding", () => {
    it('should decode "four56" payload trits correctly', () => {
      // Known payload trits for "four56"
      const payloadTrits = [
        1, 0, 2, 1, 1, 1, 0, 0, 2, 1, 0, 0, 1, 0, 2, 1, 2, 2, 2, 0, 2, 0, 2, 1,
        1, 2, 1, 1, 0, 2, 1, 2, 2, 0, 2, 0, 0, 2, 1, 1, 2, 2, 2, 1, 1, 2, 1, 2,
        2, 0, 0,
      ];

      for (const trit of payloadTrits) {
        decoder.addTrit(trit);
      }

      const allBytes = decoder.getBytes();
      expect(allBytes.length).toBe(10); // header(2) + payload(6) + crc(2)

      // Expected bytes: [0xc1, 0xfd, 0x8e, 0x23, 0xe5, 0x00, 0xbe, 0xd1, 0x44, 0x61]
      expect(allBytes).toEqual(
        new Uint8Array([
          0xc1, 0xfd, 0x8e, 0x23, 0xe5, 0x00, 0xbe, 0xd1, 0x44, 0x61,
        ]),
      );

      // Verify the decoding
      const descrambler = new LFSRDescrambler();

      // Header
      const headerHi = descrambler.descrambleByte(allBytes[0]);
      const headerLo = descrambler.descrambleByte(allBytes[1]);
      const payloadLength = (headerHi << 8) | headerLo;
      expect(payloadLength).toBe(6);

      // Payload
      const payload = new Uint8Array(6);
      for (let i = 0; i < 6; i++) {
        payload[i] = descrambler.descrambleByte(allBytes[2 + i]);
      }
      expect(new TextDecoder().decode(payload)).toBe("four56");

      // CRC
      const receivedCrc = (allBytes[8] << 8) | allBytes[9];
      const calculatedCrc = CRC16.calculate(payload);
      expect(receivedCrc).toBe(calculatedCrc);
      expect(receivedCrc).toBe(0x4461);
    });
  });

  describe("extractExactBytes", () => {
    it("should extract exact number of bytes with padding", () => {
      decoder.addTrit(1);
      decoder.addTrit(0);

      const bytes = decoder.extractExactBytes(4);
      expect(bytes).toEqual(new Uint8Array([0, 0, 0, 3])); // Value 3 padded to 4 bytes
    });

    it("should extract exact number of bytes without padding", () => {
      // Add trits to make a larger value
      for (let i = 0; i < 10; i++) {
        decoder.addTrit(2);
      }

      const bytes = decoder.extractExactBytes(2);
      expect(bytes.length).toBe(2);
    });
  });

  describe("errorHandling", () => {
    it("should reject invalid trit values", () => {
      expect(() => decoder.addTrit(-1)).toThrow("Invalid trit value: -1");
      expect(() => decoder.addTrit(3)).toThrow("Invalid trit value: 3");
      expect(() => decoder.addTrit(100)).toThrow("Invalid trit value: 100");
    });
  });

  describe("resetFunctionality", () => {
    it("should reset correctly", () => {
      decoder.addTrit(2);
      decoder.addTrit(1);
      expect(decoder.hasData()).toBe(true);

      decoder.reset();
      expect(decoder.hasData()).toBe(false);
      expect(decoder.getValue()).toBe(0n);
    });
  });
});
