export class TritDecoder {
  private value: bigint = 0n;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.value = 0n;
  }

  addTrit(trit: number): void {
    if (trit < 0 || trit > 2) {
      throw new Error(`Invalid trit value: ${trit}`);
    }

    // MS-trit-first: multiply current value by 3 and add new trit
    this.value = this.value * 3n + BigInt(trit);
  }

  getCompletedBytes(): Uint8Array {
    const bytes: number[] = [];
    let temp = this.value;

    // Extract bytes from least significant to most significant
    while (temp > 0n) {
      bytes.unshift(Number(temp % 256n));
      temp = temp / 256n;
    }

    return new Uint8Array(bytes.length > 0 ? bytes : [0]);
  }

  // Alternative method for when we know exactly how many bytes to extract
  extractExactBytes(numBytes: number): Uint8Array {
    const bytes = new Uint8Array(numBytes);
    let temp = this.value;

    // Fill bytes from right to left (LS byte first)
    for (let i = numBytes - 1; i >= 0; i--) {
      bytes[i] = Number(temp % 256n);
      temp = temp / 256n;
    }

    return bytes;
  }

  hasRemainingData(): boolean {
    return this.value > 0n;
  }
}
