/**
 * Canonical MS-first trit decoder that matches the new TX format
 * Implements the exact reverse of pack_bytes_to_trits_msfirst
 */
export class CanonicalTritDecoder {
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

  /**
   * Extract bytes in MS-byte-first order
   * This is the exact reverse of the canonical packing algorithm
   */
  getBytes(): Uint8Array {
    if (this.value === 0n) {
      return new Uint8Array([0]);
    }

    const bytes: number[] = [];
    let temp = this.value;
    
    // Extract bytes from least significant to most significant
    // but store them in MS-first order
    while (temp > 0n) {
      bytes.unshift(Number(temp % 256n));
      temp = temp / 256n;
    }

    return new Uint8Array(bytes);
  }

  /**
   * Extract exactly N bytes, padding with zeros if needed
   */
  extractExactBytes(numBytes: number): Uint8Array {
    const bytes = new Uint8Array(numBytes);
    let temp = this.value;
    
    // Fill from right to left (LS byte gets the remainder)
    for (let i = numBytes - 1; i >= 0; i--) {
      bytes[i] = Number(temp % 256n);
      temp = temp / 256n;
    }
    
    return bytes;
  }

  hasData(): boolean {
    return this.value > 0n;
  }

  getValue(): bigint {
    return this.value;
  }
}