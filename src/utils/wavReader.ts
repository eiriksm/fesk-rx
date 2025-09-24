import * as fs from "fs";
import { decode } from "wav-decoder";
import { AudioSample } from "../types";

export interface WavReadOptions {
  normalize?: boolean;
  targetPeak?: number;
  maxGain?: number;
  normalizationFloor?: number;
}

export class WavReader {
  static async readWavFile(
    filePath: string,
    options: WavReadOptions = {},
  ): Promise<AudioSample> {
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

      const {
        normalize = true,
        targetPeak = 0.9,
        maxGain = 25,
        normalizationFloor = 0.005,
      } = options;

      let peak = 0;
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i];
        const abs = Math.abs(value);
        if (abs > peak) {
          peak = abs;
        }
        sumSquares += value * value;
      }

      const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
      const originalPeak = peak;
      const originalRms = rms;

      let gainApplied = 1;

      if (normalize && peak > normalizationFloor) {
        const desiredGain = targetPeak / peak;
        if (desiredGain > 1) {
          const gain = Math.min(desiredGain, maxGain);
          if (gain > 1.0001) {
            for (let i = 0; i < samples.length; i++) {
              samples[i] *= gain;
            }
            gainApplied = gain;
            peak = Math.min(1, peak * gain);
          }
        }
      }

      const normalizedRms = gainApplied !== 1 ? rms * gainApplied : rms;

      return {
        data: samples,
        sampleRate: audioData.sampleRate,
        timestamp: Date.now(),
        normalizationGain: gainApplied !== 1 ? gainApplied : undefined,
        peakLevel: peak,
        rmsLevel: normalizedRms,
        originalPeakLevel: originalPeak,
        originalRmsLevel: originalRms,
      };
    } catch (error) {
      throw new Error(`Failed to read WAV file: ${error}`);
    }
  }

  static async readWavFileInChunks(
    filePath: string,
    chunkSizeSeconds: number = 1.0,
    options: WavReadOptions = {},
  ): Promise<AudioSample[]> {
    const fullAudio = await this.readWavFile(filePath, options);
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
        normalizationGain: fullAudio.normalizationGain,
        peakLevel: fullAudio.peakLevel,
        rmsLevel: fullAudio.rmsLevel,
        originalPeakLevel: fullAudio.originalPeakLevel,
        originalRmsLevel: fullAudio.originalRmsLevel,
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
    options: WavReadOptions = {},
  ): Promise<AudioSample> {
    const fullAudio = await this.readWavFile(filePath, options);
    const offsetSamples = Math.floor(offsetSeconds * fullAudio.sampleRate);

    if (offsetSamples >= fullAudio.data.length) {
      throw new Error(`Offset ${offsetSeconds}s exceeds audio duration`);
    }

    const offsetData = fullAudio.data.slice(offsetSamples);

    return {
      data: offsetData,
      sampleRate: fullAudio.sampleRate,
      timestamp: fullAudio.timestamp + offsetSeconds * 1000,
      normalizationGain: fullAudio.normalizationGain,
      peakLevel: fullAudio.peakLevel,
      rmsLevel: fullAudio.rmsLevel,
      originalPeakLevel: fullAudio.originalPeakLevel,
      originalRmsLevel: fullAudio.originalRmsLevel,
    };
  }
}
