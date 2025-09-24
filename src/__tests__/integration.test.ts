// Integration tests for FESK decoding

import { WavReader } from "../utils/wavReader";

jest.setTimeout(180000);

/**
 * Integration tests for complete FESK decoding using new TX format
 */
describe("FESK Integration Tests", () => {
  describe("Tone sequence tests", () => {
    it("should decode a simple tone sequence", () => {
      const toneSequence =
        "2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,1,1,2,0,0,0,1,1,2,1,0,1,1,0,0,1,2,2,0,1,2,0,1,0,2,0,0,2,1,2,2,0,0,2,0,2,2,1,0,1,1"
          .split(",")
          .map(Number);

      const { FeskDecoder } = require("../feskDecoder");
      const decoder = new FeskDecoder();
      const result = decoder.decodeCompleteTransmission(toneSequence);

      expect(result.preambleValid).toBe(true);
      expect(result.syncValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.frame).not.toBeNull();
      expect(result.frame!.isValid).toBe(true);
      expect(result.frame!.header.payloadLength).toBe(4);
      expect(new TextDecoder().decode(result.frame!.payload)).toBe("test");
    });

    it('should decode long message "a pretty long yes long long long text oh so long i dont know what?"', () => {
      // This sequence was generated with: make demo TEXT="a pretty long yes long long long text oh so long i dont know what?"
      const toneSequence =
        "2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,1,1,1,0,0,0,1,2,1,0,0,1,1,2,0,0,1,0,0,0,0,0,2,1,1,0,1,2,2,0,0,1,2,2,2,0,1,2,0,0,0,2,0,0,1,0,2,2,1,2,2,0,0,1,1,1,2,1,0,1,1,0,2,0,1,2,2,1,2,2,1,0,1,0,2,2,1,0,2,0,0,0,0,0,0,1,1,1,0,1,2,2,2,1,2,0,2,0,0,1,0,2,2,1,0,1,1,1,1,1,1,0,1,2,0,2,2,2,2,0,1,1,0,1,1,1,0,1,1,2,1,0,1,2,2,1,0,0,2,0,0,1,0,2,1,0,0,0,0,0,2,1,2,0,0,2,0,1,2,0,1,2,1,1,0,0,2,0,1,1,0,0,2,1,2,2,2,2,1,0,1,2,1,1,0,2,1,0,0,2,0,1,1,2,1,1,1,2,1,0,2,2,1,0,1,2,2,0,0,2,2,0,1,2,1,2,2,0,2,0,2,1,2,2,2,1,2,1,1,0,2,1,1,1,0,0,0,2,2,2,0,2,2,0,2,1,0,2,0,0,1,1,1,2,0,1,0,0,2,1,0,2,2,1,1,0,0,2,1,2,2,2,1,0,0,1,1,1,0,1,1,1,1,1,2,1,0,2,1,1,2,0,0,2,0,1,2,2,2,2,1,1,0,2,1,0,2,0,0,0,2,2,2,2,1,2,1,0,2,2,2,1,0,2,0,1,0,1,1,2,2,2,1,1,1,1,2,0,2,0,2,1,0,2,0,1,2,0,2,0,0,2,2,1"
          .split(",")
          .map(Number);

      const { FeskDecoder } = require("../feskDecoder");
      const decoder = new FeskDecoder();
      const result = decoder.decodeCompleteTransmission(toneSequence);

      expect(result.preambleValid).toBe(true);
      expect(result.syncValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.frame).not.toBeNull();
      expect(result.frame!.isValid).toBe(true);

      const message = new TextDecoder().decode(result.frame!.payload);
      expect(message).toBe(
        "a pretty long yes long long long text oh so long i dont know what?",
      );
      expect(result.frame!.header.payloadLength).toBe(message.length);
    });

    it("should decode fesk3 tone sequence", () => {
      const toneSequence =
        "2,0,2,0,2,0,2,0,2,0,2,0,2,2,2,2,2,0,0,2,2,0,2,0,2,1,0,0,1,2,1,0,2,1,0,0,1,1,2,2,1,1,0,2,2,0,2,0,2,2,0,2,1,1,0,0,1,0,2,2,0,0,2,0,1,1,0,1,1,0,0,0,2,1,0,0,1,2,2,0,0,0,2,0,0,2,1,0,0,0,2,0,2,1,1,0,0,1,2,1,2,0,0,0,0,0,0,1,2,2,0,1,2,1,0,1,1,0,0,1,1,1,1,0,0,2,0,2,0,0,1,1,0,1,1,0,0,0,0,0,1,1,0,0,2,2,2,1,1,1,2,1,0,0,2,1,0,2,1,2,0,0,1,0,2,0,0,1,0,0,0,1,2,2,2,1,2,2,1,0,1,0,1,0,1,0,2,1,0,2,0,0,1,1,1,2,1,0,0,0,1,2,1,0,1,1,2,0,0,1,0,1,1,1,2,2,0,0,2,1,0,2,1,2,2,0,0,0,0,2,1,1,0,0,1,1,1,1,2,1,0,1,0,1,1,1,2,1,2,2,0,0,1,2,0,0,0,1,1,0,0,0,0,0,2,1,1,2,1,1,0,2,1,1,2,1,2,1,2,2,1,2,0,0,1,0,1,2,0,1,2,2,1,1,0,1,1,0,2,0,1,0,0,1,0,2,1,0,2,1,1,2,0,0,0,1,1,2"
          .split(",")
          .map(Number);

      const { FeskDecoder } = require("../feskDecoder");
      const decoder = new FeskDecoder();
      const result = decoder.decodeCompleteTransmission(toneSequence);

      expect(result.preambleValid).toBe(true);
      expect(result.syncValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.frame).not.toBeNull();
      expect(result.frame!.isValid).toBe(true);

      const message = new TextDecoder().decode(result.frame!.payload);
      expect(message).toBe(
        "a fairly long and might i say convoluted test message?",
      );
      expect(result.frame!.header.payloadLength).toBe(54);
    });
  });

  describe("Wav decoding tests", () => {
    it('Should decode "test" from wav file fesk1.wav', async () => {
      const { FeskDecoder } = await import("../feskDecoder");
      const path = require("path");

      const wavPath = path.join(__dirname, "../../testdata/fesk1.wav");

      const decoder = new FeskDecoder();
      const startTime = (await decoder.findTransmissionStartFromWav(
        wavPath,
      )) as number;

      expect(startTime).toBeGreaterThan(0);

      const audioWithOffset = await WavReader.readWavFileWithOffset(
        wavPath,
        startTime / 1000,
      );

      const frame = await decoder.processAudioComplete(
        audioWithOffset.data,
        audioWithOffset.sampleRate,
        100, // 100ms chunks - exact symbol duration
      );

      expect(frame).not.toBeNull();
      expect(frame!.isValid).toBe(true);
      const message = new TextDecoder().decode(frame!.payload);
      expect(message).toBe("test");
      expect(frame!.header.payloadLength).toBe(4);
    });
    it("Should decode the message from fesk2.wav", async () => {
      const { FeskDecoder } = await import("../feskDecoder");
      const path = require("path");

      const wavPath = path.join(__dirname, "../../testdata/fesk2.wav");

      const decoder = new FeskDecoder();
      const startTime = (await decoder.findTransmissionStartFromWav(
        wavPath,
      )) as number;

      expect(startTime).toBeGreaterThan(0);

      const audioWithOffset = await WavReader.readWavFileWithOffset(
        wavPath,
        startTime / 1000,
      );

      const frame = await decoder.processAudioComplete(
        audioWithOffset.data,
        audioWithOffset.sampleRate,
      );

      expect(frame).not.toBeNull();
      expect(frame!.isValid).toBe(true);
      const message = new TextDecoder().decode(frame!.payload);
      expect(message).toBe("three45");
      expect(frame!.header.payloadLength).toBe(7);
    });
    it("Should decode the message from fesk3.wav", async () => {
      const { FeskDecoder } = await import("../feskDecoder");
      const path = require("path");

      const wavPath = path.join(__dirname, "../../testdata/fesk3.wav");

      const decoder = new FeskDecoder();
      const startTime = (await decoder.findTransmissionStartFromWav(
        wavPath,
      )) as number;

      expect(startTime).toBeGreaterThan(0);

      const audioWithOffset = await WavReader.readWavFileWithOffset(
        wavPath,
        startTime / 1000,
      );

      const frame = await decoder.processAudioComplete(
        audioWithOffset.data,
        audioWithOffset.sampleRate,
        100, // Same as other tests
      );

      expect(frame).not.toBeNull();
      expect(frame!.isValid).toBe(true);
      const message = new TextDecoder().decode(frame!.payload);
      expect(message).toBe(
        "a fairly long and might i say convoluted test message?",
      );
      expect(frame!.header.payloadLength).toBe(54);
    });
  });

  describe("Hardware wav decoding", () => {
    it('should decode "test" from fesk1mp.wav', async () => {
      const { FeskDecoder } = await import("../feskDecoder");
      const path = require("path");

      const wavPath = path.join(__dirname, "../../testdata/fesk1mp.wav");
      const decoder = new FeskDecoder();
      const frame = await decoder.decodeWavFileWithSymbolExtractor(wavPath);

      expect(frame).not.toBeNull();
      expect(frame!.isValid).toBe(true);
      const message = new TextDecoder().decode(frame!.payload);
      expect(message).toBe("test");
      expect(frame!.header.payloadLength).toBe(4);
    });

    // Now the same for webapp-fesk1.wav.
    it('should decode "test" from webapp-fesk1.wav', async () => {
      const { FeskDecoder } = await import("../feskDecoder");
      const path = require("path");

      const wavPath = path.join(__dirname, "../../testdata/webapp-fesk1.wav");
      const decoder = new FeskDecoder();
      const frame = await decoder.decodeWavFileWithSymbolExtractor(wavPath);

      expect(frame).not.toBeNull();
      expect(frame!.isValid).toBe(true);
      const message = new TextDecoder().decode(frame!.payload);
      expect(message).toBe("test");
      expect(frame!.header.payloadLength).toBe(4);
    });
  });
});
