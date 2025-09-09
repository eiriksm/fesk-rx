/**
 * Goertzel algorithm implementation for frequency detection
 * 
 * The Goertzel algorithm is an efficient method for detecting the presence
 * of specific frequencies in a signal, especially useful for tone detection
 * in FESK (Frequency Shift Keying) systems.
 */
export class Goertzel {
  /**
   * Calculate the magnitude/strength of a specific frequency in an audio segment
   * 
   * @param segment - Audio samples to analyze
   * @param frequency - Target frequency to detect (in Hz)  
   * @param sampleRate - Sample rate of the audio (in Hz)
   * @returns Normalized magnitude of the frequency component
   */
  static getFrequencyStrength(segment: Float32Array, frequency: number, sampleRate: number): number {
    const N = segment.length;
    const k = Math.round(N * frequency / sampleRate);
    const omega = 2 * Math.PI * k / N;
    const cosine = Math.cos(omega);
    
    let q1 = 0, q2 = 0;
    
    for (let i = 0; i < N; i++) {
      const q0 = 2 * cosine * q1 - q2 + segment[i];
      q2 = q1;
      q1 = q0;
    }
    
    const real = q1 - q2 * cosine;
    const imag = q2 * Math.sin(omega);
    
    return Math.sqrt(real * real + imag * imag) / N;
  }

  /**
   * Detect which of multiple target frequencies is strongest in the signal
   * 
   * @param segment - Audio samples to analyze
   * @param frequencies - Array of target frequencies to compare
   * @param sampleRate - Sample rate of the audio (in Hz)
   * @returns Object containing the detected tone index and its strength
   */
  static detectStrongestTone(
    segment: Float32Array, 
    frequencies: number[], 
    sampleRate: number
  ): { toneIndex: number; strength: number } {
    let bestTone = 0;
    let bestStrength = 0;

    for (let i = 0; i < frequencies.length; i++) {
      const strength = this.getFrequencyStrength(segment, frequencies[i], sampleRate);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestTone = i;
      }
    }

    return { toneIndex: bestTone, strength: bestStrength };
  }

  /**
   * Get the strength of all target frequencies in the signal
   * 
   * @param segment - Audio samples to analyze  
   * @param frequencies - Array of target frequencies to analyze
   * @param sampleRate - Sample rate of the audio (in Hz)
   * @returns Array of frequency strengths in the same order as input frequencies
   */
  static getFrequencyStrengths(
    segment: Float32Array,
    frequencies: number[],
    sampleRate: number
  ): number[] {
    return frequencies.map(freq => this.getFrequencyStrength(segment, freq, sampleRate));
  }
}