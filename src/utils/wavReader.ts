import * as fs from "fs";
import { decode } from "wav-decoder";
import { AudioSample } from "../types";

export class WavReader {
  static async readWavFile(filePath: string): Promise<AudioSample> {
    try {
      const buffer = fs.readFileSync(filePath);
      const audioData = await decode(buffer);

      // Convert to Float32Array and handle mono/stereo
      let samples: Float32Array;

      if (audioData.numberOfChannels === 1) {
        // Mono - use directly
        samples = new Float32Array(audioData.channelData[0]);
      } else {
        // Stereo - mix down to mono
        const leftChannel = audioData.channelData[0];
        const rightChannel = audioData.channelData[1];
        samples = new Float32Array(leftChannel.length);

        for (let i = 0; i < leftChannel.length; i++) {
          samples[i] = (leftChannel[i] + rightChannel[i]) / 2;
        }
      }

      return {
        data: samples,
        sampleRate: audioData.sampleRate,
        timestamp: Date.now(),
      };
    } catch (error) {
      throw new Error(`Failed to read WAV file: ${error}`);
    }
  }

  static async readWavFileInChunks(
    filePath: string,
    chunkSizeSeconds: number = 1.0,
  ): Promise<AudioSample[]> {
    const fullAudio = await this.readWavFile(filePath);
    const chunkSizeSamples = Math.floor(
      fullAudio.sampleRate * chunkSizeSeconds,
    );
    const chunks: AudioSample[] = [];

    for (let i = 0; i < fullAudio.data.length; i += chunkSizeSamples) {
      const chunkEnd = Math.min(i + chunkSizeSamples, fullAudio.data.length);
      const chunkData = fullAudio.data.slice(i, chunkEnd);

      chunks.push({
        data: chunkData,
        sampleRate: fullAudio.sampleRate,
        timestamp: fullAudio.timestamp + (i / fullAudio.sampleRate) * 1000, // Add time offset
      });
    }

    return chunks;
  }

  /**
   * Read WAV file starting from a specific offset (useful for skipping silence)
   */
  static async readWavFileWithOffset(
    filePath: string,
    offsetSeconds: number = 0,
  ): Promise<AudioSample> {
    const fullAudio = await this.readWavFile(filePath);
    const offsetSamples = Math.floor(offsetSeconds * fullAudio.sampleRate);

    if (offsetSamples >= fullAudio.data.length) {
      throw new Error(`Offset ${offsetSeconds}s exceeds audio duration`);
    }

    const offsetData = fullAudio.data.slice(offsetSamples);

    return {
      data: offsetData,
      sampleRate: fullAudio.sampleRate,
      timestamp: fullAudio.timestamp + offsetSeconds * 1000,
    };
  }
}
