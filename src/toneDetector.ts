const { fft } = require('fft-js');
import { ToneDetection, AudioSample } from './types';
import { FeskConfig } from './config';

export class ToneDetector {
  private config: FeskConfig;
  private windowSize: number;
  private hopSize: number;

  constructor(config: FeskConfig) {
    this.config = config;
    // Use window size that gives good frequency resolution
    this.windowSize = Math.pow(2, Math.ceil(Math.log2(config.sampleRate * 0.05))); // ~50ms window
    this.hopSize = Math.floor(this.windowSize / 4); // 75% overlap
  }

  detectTones(audioSample: AudioSample): ToneDetection[] {
    const detections: ToneDetection[] = [];
    const data = audioSample.data;
    
    // Process audio in overlapping windows
    for (let i = 0; i < data.length - this.windowSize; i += this.hopSize) {
      const window = data.slice(i, i + this.windowSize);
      const detection = this.processWindow(window, audioSample.sampleRate);
      if (detection) {
        detections.push(detection);
      }
    }

    return detections;
  }

  private processWindow(window: Float32Array, sampleRate: number): ToneDetection | null {
    // Apply Hamming window
    const windowedData = this.applyHammingWindow(window);
    
    // Pad to next power of 2 for efficient FFT
    const fftSize = Math.pow(2, Math.ceil(Math.log2(windowedData.length)));
    const paddedData = new Array(fftSize).fill(0);
    for (let i = 0; i < windowedData.length; i++) {
      paddedData[i] = windowedData[i];
    }

    // Compute FFT
    const fftResult = fft(paddedData);
    const magnitudes = fftResult.map((c: number[]) => Math.sqrt(c[0] * c[0] + c[1] * c[1]));
    
    // Find peak energies at expected frequencies
    const [f0, f1, f2] = this.config.toneFrequencies;
    const freqResolution = sampleRate / fftSize;
    
    const energies = [
      this.getEnergyAtFrequency(magnitudes, f0, freqResolution),
      this.getEnergyAtFrequency(magnitudes, f1, freqResolution),
      this.getEnergyAtFrequency(magnitudes, f2, freqResolution)
    ];

    // Find the tone with maximum energy
    const maxIndex = energies.indexOf(Math.max(...energies));
    const maxEnergy = energies[maxIndex];
    
    // Calculate confidence based on energy ratio
    const totalEnergy = energies.reduce((sum, e) => sum + e, 0);
    const confidence = totalEnergy > 0 ? maxEnergy / totalEnergy : 0;
    
    // Only return detection if confidence is above threshold
    if (confidence > 0.4) { // Require at least 40% of energy in the detected tone
      return {
        frequency: this.config.toneFrequencies[maxIndex],
        magnitude: maxEnergy,
        confidence: confidence
      };
    }

    return null;
  }

  private applyHammingWindow(data: Float32Array): Float32Array {
    const windowed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (data.length - 1));
      windowed[i] = data[i] * w;
    }
    return windowed;
  }

  private getEnergyAtFrequency(magnitudes: number[], frequency: number, freqResolution: number): number {
    const binIndex = Math.round(frequency / freqResolution);
    const bandwidth = Math.ceil(frequency * 0.05 / freqResolution); // 5% bandwidth around target
    
    let energy = 0;
    const startBin = Math.max(0, binIndex - bandwidth);
    const endBin = Math.min(magnitudes.length - 1, binIndex + bandwidth);
    
    for (let i = startBin; i <= endBin; i++) {
      energy += magnitudes[i] * magnitudes[i];
    }
    
    return energy;
  }
}