/**
 * Optimized decoder utility that applies timing corrections for better accuracy
 */

import { FeskDecoder, DecoderState } from "../feskDecoder";
import { WavReader } from "./wavReader";
import { AudioSample, Frame } from "../types";
import { DEFAULT_CONFIG } from "../config";

export class OptimizedFeskDecoder {
  public baseDecoder: FeskDecoder; // Make public for testing
  private timingOffsetMs: number;

  constructor(timingOffsetMs: number = 0) {
    this.baseDecoder = new FeskDecoder(DEFAULT_CONFIG);
    this.timingOffsetMs = timingOffsetMs;
  }

  /**
   * Decode a WAV file with optimal timing
   */
  async decodeWavFile(
    wavPath: string,
    audioOffsetSec: number = 0,
  ): Promise<Frame | null> {
    // Apply timing offset to the audio start time
    const totalOffset = audioOffsetSec + this.timingOffsetMs / 1000;
    const audioData = await WavReader.readWavFileWithOffset(
      wavPath,
      totalOffset,
    );

    const chunkSize = Math.floor(audioData.sampleRate * 0.1); // 100ms chunks
    let chunkCount = 0;

    for (let i = 0; i < audioData.data.length; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, audioData.data.length);
      const chunk = audioData.data.slice(i, chunkEnd);

      if (chunk.length < chunkSize) break;

      const timestamp = audioData.timestamp + chunkCount * 100;
      const audioSample: AudioSample = {
        data: chunk,
        timestamp,
        sampleRate: audioData.sampleRate,
      };

      const frame = this.baseDecoder.processAudio(audioSample);

      if (frame && frame.isValid) {
        return frame;
      }

      chunkCount++;
      if (chunkCount > 200) break; // Safety limit
    }

    return null;
  }

  /**
   * Process a single audio sample
   */
  processAudio(audioSample: AudioSample): Frame | null {
    return this.baseDecoder.processAudio(audioSample);
  }

  /**
   * Process continuous audio data automatically and return when frame is decoded
   * @param audioData Full audio data to process
   * @param sampleRate Audio sample rate
   * @param chunkSizeMs Size of processing chunks in milliseconds (default: 100ms)
   * @returns Promise that resolves with decoded frame or null if no valid frame found
   */
  async processAudioComplete(
    audioData: Float32Array,
    sampleRate: number,
    chunkSizeMs: number = 100
  ): Promise<Frame | null> {
    return this.baseDecoder.processAudioComplete(audioData, sampleRate, chunkSizeMs);
  }

  /**
   * Process WAV file directly with timing optimization
   * @param wavPath Path to WAV file
   * @param offsetSec Audio offset in seconds (default: 0)
   * @param chunkSizeMs Processing chunk size in milliseconds (default: 100ms)
   * @returns Promise that resolves with decoded frame or null
   */
  async processWavFileOptimized(
    wavPath: string,
    offsetSec: number = 0,
    _chunkSizeMs: number = 100
  ): Promise<Frame | null> {
    return this.decodeWavFile(wavPath, offsetSec);
  }

  /**
   * Get current decoding progress information
   * @returns Object with phase, progress percentage, and current trit count
   */
  getProgress() {
    return this.baseDecoder.getProgress();
  }

  /**
   * Check if decoder is ready to attempt frame decode
   * @returns True if enough data has been collected to attempt decoding
   */
  isReadyToDecode(): boolean {
    return this.baseDecoder.isReadyToDecode();
  }

  /**
   * Force attempt to decode current buffer (useful for partial frames)
   * @returns Decoded frame or null if unsuccessful
   */
  forceAttemptDecode(): Frame | null {
    return this.baseDecoder.forceAttemptDecode();
  }

  /**
   * Process a complete transmission sequence (preamble + sync + payload)
   * @param symbols Complete symbol sequence including preamble, sync, and payload
   * @returns Decoded frame or null if unsuccessful
   */
  processCompleteTransmission(symbols: number[]): Frame | null {
    return this.baseDecoder.processCompleteTransmission(symbols);
  }

  /**
   * Get decoder state
   */
  getState(): DecoderState {
    return this.baseDecoder.getState();
  }

  /**
   * Reset decoder
   */
  reset() {
    this.baseDecoder.reset();
  }

  /**
   * Find optimal timing offset for a WAV file
   */
  static async findOptimalTiming(
    wavPath: string,
    audioOffsetSec: number,
    expectedMessage: string,
  ): Promise<number> {
    const timingOffsets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]; // Test different offsets

    for (const offsetMs of timingOffsets) {
      const decoder = new OptimizedFeskDecoder(offsetMs);
      const frame = await decoder.decodeWavFile(wavPath, audioOffsetSec);

      if (frame && frame.isValid) {
        const message = new TextDecoder().decode(frame.payload);
        if (message === expectedMessage) {
          console.log(
            `Found optimal timing: ${offsetMs}ms offset for "${expectedMessage}"`,
          );
          return offsetMs;
        }
      }
    }

    console.log(`No optimal timing found for "${expectedMessage}"`);
    return 0; // Default to no offset
  }
}
