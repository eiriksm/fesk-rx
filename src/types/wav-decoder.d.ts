declare module "wav-decoder" {
  export interface AudioData {
    sampleRate: number;
    channelData: Float32Array[];
    numberOfChannels: number;
  }

  export function decode(buffer: Buffer): Promise<AudioData>;
}
