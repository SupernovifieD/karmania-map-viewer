/**
 * The CRC-32 of the PNG format (the one of ISO 3309 and zlib: polynomial 0xEDB88320, started and ended with all ones), table-driven and with no dependency. It can be
 * carried on over several pieces: `crc32(b, crc32(a))` is the CRC of a followed by b.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as a number from 0 to 2^32 - 1; `previous` is the CRC of what comes before them (0 for none). */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (const byte of bytes) {
    crc = (TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}
