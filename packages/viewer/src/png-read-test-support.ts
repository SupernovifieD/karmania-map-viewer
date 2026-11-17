/**
 * A reader of PNG files for the tests of the encoder, written by hand (the brief allows this in place of `pngjs` if it stays under about 80 lines): it checks the signature, every
 * chunk's length and CRC and the order of the chunks, reads the header, and inflates and unfilters the image data (filters 0 to 4) into RGB bytes. It is a separate piece of
 * code from the encoder on purpose: what one writes the other has to read.
 */
import { crc32 } from './crc32.js';

export interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}
export interface DecodedPng {
  readonly chunks: readonly PngChunk[];
  readonly width: number;
  readonly height: number;
  /** Red, green and blue of each pixel, rows from the top. */
  readonly rgb: Uint8Array;
  /** The pixels to the metre of the `pHYs` chunk, or `undefined` if there is none. */
  readonly physical: { across: number; down: number; unit: number } | undefined;
}

/** Reads `bytes` as a PNG of 8 bits an channel and colour type 2; throws a plain error for anything that is not what the encoder makes. */
export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ([137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b)) {
    throw new Error('not a PNG: the signature is wrong');
  }
  const chunks: PngChunk[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (view.getUint32(at + 8 + length) !== crc32(bytes.subarray(at + 4, at + 8 + length))) {
      throw new Error(`the CRC of the ${type} chunk is wrong`);
    }
    chunks.push({ type, data });
    at += 12 + length;
  }
  const head = chunks[0];
  if (head?.type !== 'IHDR' || chunks.at(-1)?.type !== 'IEND') {
    throw new Error('a PNG begins with IHDR and ends with IEND');
  }
  const h = new DataView(head.data.buffer, head.data.byteOffset, 13);
  const [width, height] = [h.getUint32(0), h.getUint32(4)];
  if (head.data[8] !== 8 || head.data[9] !== 2 || head.data[12] !== 0) {
    throw new Error('only 8 bit RGB without interlace is read');
  }
  // Inflated by the platform's own DecompressionStream: not the code that the encoder's CompressionStream is, so what one writes the other has to read.
  const compressed = new Blob(
    chunks.filter((c) => c.type === 'IDAT').map((c) => c.data as BlobPart),
  );
  const inflated = compressed.stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(inflated).arrayBuffer());
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const x = raw[y * (stride + 1) + 1 + i] ?? 0;
      const left = i >= 3 ? (rgb[y * stride + i - 3] ?? 0) : 0;
      const up = y > 0 ? (rgb[(y - 1) * stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= 3 ? (rgb[(y - 1) * stride + i - 3] ?? 0) : 0;
      const p = left + up - upLeft;
      const paeth = [left, up, upLeft].sort((a, b) => Math.abs(p - a) - Math.abs(p - b))[0] ?? 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter ?? 0];
      rgb[y * stride + i] = (x + (predictor ?? 0)) & 0xff;
    }
  }
  const p = chunks.find((c) => c.type === 'pHYs');
  const physical =
    p === undefined
      ? undefined
      : (() => {
          const v = new DataView(p.data.buffer, p.data.byteOffset, 9);
          return { across: v.getUint32(0), down: v.getUint32(4), unit: p.data[8] ?? 0 };
        })();
  return { chunks, width, height, rgb, physical };
}
