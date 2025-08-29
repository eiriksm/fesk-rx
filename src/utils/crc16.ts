export class CRC16 {
  private static readonly POLY = 0x1021; // CRC-16/CCITT polynomial

  static calculate(data: Uint8Array, initValue: number = 0xffff): number {
    let crc = initValue;

    for (let i = 0; i < data.length; i++) {
      crc = CRC16.updateCRC16(crc, data[i]);
    }

    return crc;
  }

  static updateCRC16(crc: number, byteVal: number): number {
    crc ^= byteVal << 8;

    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ CRC16.POLY;
      } else {
        crc <<= 1;
      }
    }

    return crc & 0xffff;
  }

  static validate(data: Uint8Array, expectedCrc: number): boolean {
    const calculatedCrc = CRC16.calculate(data);
    return calculatedCrc === expectedCrc;
  }
}
