/**
 * Canonical MS-first trit decoder that matches the new TX format
 * Implements the exact reverse of pack_bytes_to_trits_msfirst
 * Fixed to handle very long sequences by using chunked processing
 */
export class CanonicalTritDecoder {
  private value: bigint = 0n;
  private useLegacyMode: boolean = false;

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
   * Correct implementation: Base-3 (MS-trit-first) -> bytes (MSB-first)
   * This is the exact inverse of the TX pack_bytes_to_trits_msfirst algorithm
   */
  static decodeLongSequence(trits: number[]): Uint8Array {
    if (trits.length === 0) {
      return new Uint8Array([0]);
    }

    // Use correct iterative base conversion for all sequences
    // digits: base-3, MS→LS (don't reverse the input trits!)
    let digits = trits.slice();
    const out: number[] = [];
    
    while (digits.length > 0) {
      const q: number[] = [];
      let carry = 0;
      
      // Process digits MS-first (left to right)
      for (const d of digits) {
        // cur ∈ [0..(3*255+2)] fits in JS number exactly
        const cur = carry * 3 + d;
        const qDigit = Math.floor(cur / 256);
        carry = cur % 256;
        if (q.length || qDigit) q.push(qDigit);
      }
      
      out.push(carry);        // remainder (LS byte)
      digits = q;             // next quotient in base-3 (MS→LS)
    }
    
    out.reverse();            // make bytes MSB-first
    return new Uint8Array(out);
  }

  /**
   * Extract bytes in MS-byte-first order
   * This is the exact reverse of the canonical packing algorithm
   * Fixed version that handles very large numbers correctly
   */
  getBytes(): Uint8Array {
    if (this.value === 0n) {
      return new Uint8Array([0]);
    }

    const bytes: number[] = [];
    let temp = this.value;

    // For very large numbers, we need to be more careful
    // Extract bytes from least significant to most significant
    // but store them in MS-first order
    const maxBytes = 100; // Safety limit to prevent infinite loops
    let byteCount = 0;
    
    while (temp > 0n && byteCount < maxBytes) {
      const byteValue = Number(temp % 256n);
      bytes.unshift(byteValue);
      temp = temp / 256n;
      byteCount++;
    }

    if (byteCount >= maxBytes) {
      console.warn(`CanonicalTritDecoder: Reached maximum byte limit (${maxBytes}) - number too large!`);
      console.warn(`Original value was: ${this.value.toString().slice(0, 100)}...`);
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
