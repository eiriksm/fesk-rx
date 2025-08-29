export class LFSRDescrambler {
  private state: number;
  private readonly polynomial = 0x0211; // x^9 + x^5 + 1
  private readonly seed = 0x1FF;

  constructor() {
    this.state = this.seed;
  }

  reset(): void {
    this.state = this.seed;
  }

  descrambleByte(scrambedByte: number): number {
    let descrambled = 0;

    for (let i = 0; i < 8; i++) {
      // Extract bit 0 from LFSR
      const lfsrBit = this.state & 1;

      // XOR with input bit to descramble
      const inputBit = (scrambedByte >> i) & 1;
      descrambled |= (inputBit ^ lfsrBit) << i;

      // Advance LFSR: feedback polynomial (match TX exactly)  
      const feedback = ((this.state >> 8) ^ (this.state >> 4)) & 1;
      this.state = ((this.state << 1) | feedback) & 0x1FF;
    }

    return descrambled;
  }
}