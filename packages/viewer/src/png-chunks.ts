/**
 * The pieces of a PNG file (step 22.5): the signature, and the chunks that the exported picture has: IHDR (8 bits a channel, colour type 2: red, green and blue, because the
 * picture is opaque; no interlace), sRGB (the picture is in sRGB, rendering intent 0, perceptual), pHYs (pixels to the metre, so that the dpi is in the file) and IEND. A chunk is
 * its length, its four letters, its data and the CRC of the letters and the data. The image data (IDAT) is made by `png-encode.ts` and cut into chunks here.
 */
import { crc32 } from './crc32.js';

/** The eight bytes that every PNG file begins with. */
export const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

/** The least of a file's compressed data in each IDAT chunk but the last (the encoder cuts it in pieces of exactly this, so that the file does not depend on how the compressor gave it). */
export const IDAT_SIZE = 65536;

/** The number of pixels to the metre that a dpi is (an inch is 0.0254 metres), rounded as the format needs whole numbers. */
export function pixelsPerMetre(dpi: number): number {
  return Math.round(dpi / 0.0254);
}

/** A chunk of the type `type` (four letters) holding `data`. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  if (type.length !== 4) {
    throw new RangeError(`A chunk type is four letters, and not "${type}".`);
  }
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** IHDR: the size, 8 bits a channel, colour type 2 (RGB), the one method of compression and of filtering, no interlace. */
export function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data.set([8, 2, 0, 0, 0], 8);
  return chunk('IHDR', data);
}

/** sRGB with the rendering intent 0 (perceptual): the colours are sRGB, as the canvas has them. */
export function srgb(): Uint8Array {
  return chunk('sRGB', Uint8Array.of(0));
}

/** pHYs: pixels to the metre across and down, the unit being the metre. */
export function phys(dpi: number): Uint8Array {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, pixelsPerMetre(dpi));
  view.setUint32(4, pixelsPerMetre(dpi));
  data[8] = 1;
  return chunk('pHYs', data);
}

/** IEND: the end of the file. */
export function iend(): Uint8Array {
  return chunk('IEND', new Uint8Array(0));
}
