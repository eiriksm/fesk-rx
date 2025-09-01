declare module "fft-js" {
  export function fft(signal: number[]): number[][];
  export function ifft(spectrum: number[]): number[][];
  export const util: {
    fftMag(spectrum: number[][]): number[];
    fftFreq(spectrum: number[][], sampleRate: number): number[];
  };
}
