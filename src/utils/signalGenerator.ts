import { AudioSample } from "../types";
import { FeskConfig } from "../config";

export class SignalGenerator {
  private config: FeskConfig;

  constructor(config: FeskConfig) {
    this.config = config;
  }

  generatePreambleSignal(sampleRate: number = 8000): AudioSample {
    const symbolDurationSamples = Math.floor(
      sampleRate * this.config.symbolDuration,
    );
    const totalSamples =
      symbolDurationSamples * this.config.preambleBits.length;
    const samples = new Float32Array(totalSamples);

    const [f0, _, f2] = this.config.toneFrequencies; // Preamble uses only f0 and f2

    for (let i = 0; i < this.config.preambleBits.length; i++) {
      const bit = this.config.preambleBits[i];
      const frequency = bit === 1 ? f2 : f0; // 1 -> f2, 0 -> f0

      const startSample = i * symbolDurationSamples;
      const endSample = Math.min((i + 1) * symbolDurationSamples, totalSamples);

      for (let j = startSample; j < endSample; j++) {
        const t = j / sampleRate;
        samples[j] = 0.5 * Math.sin(2 * Math.PI * frequency * t);
      }
    }

    return {
      data: samples,
      sampleRate,
      timestamp: Date.now(),
    };
  }

  generateSyncSignal(sampleRate: number = 8000): AudioSample {
    const symbolDurationSamples = Math.floor(
      sampleRate * this.config.symbolDuration,
    );
    const totalSamples = symbolDurationSamples * this.config.barker13.length;
    const samples = new Float32Array(totalSamples);

    const [f0, _, f2] = this.config.toneFrequencies; // Sync uses only f0 and f2

    for (let i = 0; i < this.config.barker13.length; i++) {
      const bit = this.config.barker13[i];
      const frequency = bit === 1 ? f2 : f0; // 1 -> f2, 0 -> f0

      const startSample = i * symbolDurationSamples;
      const endSample = Math.min((i + 1) * symbolDurationSamples, totalSamples);

      for (let j = startSample; j < endSample; j++) {
        const t = j / sampleRate;
        samples[j] = 0.5 * Math.sin(2 * Math.PI * frequency * t);
      }
    }

    return {
      data: samples,
      sampleRate,
      timestamp: Date.now(),
    };
  }

  generateCompleteStartSequence(sampleRate: number = 8000): AudioSample {
    const preamble = this.generatePreambleSignal(sampleRate);
    const sync = this.generateSyncSignal(sampleRate);

    // Concatenate preamble and sync
    const totalSamples = preamble.data.length + sync.data.length;
    const samples = new Float32Array(totalSamples);

    samples.set(preamble.data, 0);
    samples.set(sync.data, preamble.data.length);

    return {
      data: samples,
      sampleRate,
      timestamp: Date.now(),
    };
  }

  generateTernarySymbols(
    symbols: number[],
    sampleRate: number = 8000,
  ): AudioSample {
    const symbolDurationSamples = Math.floor(
      sampleRate * this.config.symbolDuration,
    );
    const totalSamples = symbolDurationSamples * symbols.length;
    const samples = new Float32Array(totalSamples);

    const [f0, f1, f2] = this.config.toneFrequencies;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      let frequency: number;

      switch (symbol) {
        case 0:
          frequency = f0;
          break;
        case 1:
          frequency = f1;
          break;
        case 2:
          frequency = f2;
          break;
        default:
          throw new Error(`Invalid symbol: ${symbol}`);
      }

      const startSample = i * symbolDurationSamples;
      const endSample = Math.min((i + 1) * symbolDurationSamples, totalSamples);

      for (let j = startSample; j < endSample; j++) {
        const t = j / sampleRate;
        samples[j] = 0.5 * Math.sin(2 * Math.PI * frequency * t);
      }
    }

    return {
      data: samples,
      sampleRate,
      timestamp: Date.now(),
    };
  }

  addNoise(signal: AudioSample, snrDb: number): AudioSample {
    const noisySamples = new Float32Array(signal.data.length);

    // Calculate signal power
    let signalPower = 0;
    for (let i = 0; i < signal.data.length; i++) {
      signalPower += signal.data[i] * signal.data[i];
    }
    signalPower /= signal.data.length;

    // Calculate required noise power
    const snrLinear = Math.pow(10, snrDb / 10);
    const noisePower = signalPower / snrLinear;
    const noiseStd = Math.sqrt(noisePower);

    // Add Gaussian noise
    for (let i = 0; i < signal.data.length; i++) {
      const noise = this.gaussianRandom() * noiseStd;
      noisySamples[i] = signal.data[i] + noise;
    }

    return {
      ...signal,
      data: noisySamples,
    };
  }

  private gaussianRandom(): number {
    // Box-Muller transform for Gaussian random numbers
    const u = Math.random();
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  static saveAsWav(signal: AudioSample, filePath: string): void {
    // Simple WAV file writer for testing
    // This is a basic implementation - for production use a proper library
    const fs = require("fs");

    const sampleRate = signal.sampleRate;
    const numChannels = 1;
    const bitsPerSample = 16;
    const dataLength = signal.data.length * 2; // 16-bit samples

    const buffer = Buffer.alloc(44 + dataLength);
    let offset = 0;

    // WAV header
    buffer.write("RIFF", offset);
    offset += 4;
    buffer.writeUInt32LE(36 + dataLength, offset);
    offset += 4;
    buffer.write("WAVE", offset);
    offset += 4;
    buffer.write("fmt ", offset);
    offset += 4;
    buffer.writeUInt32LE(16, offset);
    offset += 4; // PCM format chunk size
    buffer.writeUInt16LE(1, offset);
    offset += 2; // PCM format
    buffer.writeUInt16LE(numChannels, offset);
    offset += 2;
    buffer.writeUInt32LE(sampleRate, offset);
    offset += 4;
    buffer.writeUInt32LE(
      (sampleRate * numChannels * bitsPerSample) / 8,
      offset,
    );
    offset += 4;
    buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, offset);
    offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset);
    offset += 2;
    buffer.write("data", offset);
    offset += 4;
    buffer.writeUInt32LE(dataLength, offset);
    offset += 4;

    // Convert float samples to 16-bit PCM
    for (let i = 0; i < signal.data.length; i++) {
      const sample = Math.max(-1, Math.min(1, signal.data[i])); // Clamp
      const pcmSample = Math.round(sample * 32767);
      buffer.writeInt16LE(pcmSample, offset);
      offset += 2;
    }

    fs.writeFileSync(filePath, buffer);
  }
}
