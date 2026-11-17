/**
 * The PNG file of the exported picture (step 22.5), with no dependency: the rows of the picture are made into scanlines (a filter byte of 0, then red, green and blue: the picture is
 * opaque, so there is no alpha), compressed by the browser's `CompressionStream('deflate')` (a zlib stream, which is what the image data of a PNG is), and cut into IDAT chunks of
 * exactly 64 KiB, so that the bytes of the file depend on the picture and the dpi and on nothing else: not on how many rows were given at a time, nor on how the compressor
 * handed out its output. The same picture and dpi give the same file twice in a row (the same browser, the same machine: the compressor's own choices may differ between
 * browsers and versions, and a file is not promised to be the same bytes across them).
 *
 * It never holds more than a slice of the picture in its own arrays and takes no long task: the rows come a slice at a time (a number of pixels, never a time), each slice is
 * filtered and given to the compressor, which works off the page's thread, and the page is given a turn between slices and between the chunks of output. The compressor's output
 * is read as it is made (a stream that is not read stops writing), and everything is let go if the encoding is aborted or fails.
 */
import { IDAT_SIZE, PNG_SIGNATURE, chunk, ihdr, iend, phys, srgb } from './png-chunks.js';

/** How many pixels are filtered and given to the compressor at once (1 MiB of RGBA in, 0.75 MiB of scanlines out). */
export const SLICE_PIXELS = 2 ** 18;

/** What the file is made from. */
export interface PngInput {
  /** The size of the picture, in pixels: whole numbers of at least 1. */
  readonly width: number;
  readonly height: number;
  /** Dots to the inch: what the `pHYs` chunk says, above 0. */
  readonly dpi: number;
  /** The rows `first` to `first + count - 1` of the picture from its top, four bytes a pixel (red, green, blue, alpha): the canvas's `getImageData(0, first, width, count).data`. */
  readonly readRows: (first: number, count: number) => ArrayLike<number>;
  /** Gives the page a turn. By default a task of the page's own (a `MessageChannel`, or a timer if there is none). */
  readonly yieldNow?: () => Promise<void>;
  /** Stops the encoding between two slices (and in the output); it then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Called with how much is done, from 0 to 1 (counted in rows, never in time). */
  readonly onProgress?: (done: number) => void;
  /** How many rows a slice has; by default as many as `SLICE_PIXELS` allows. For tests: the file is the same whatever it is. */
  readonly sliceRows?: number;
}

/** Why a file could not be made, other than being stopped. */
export class PngError extends Error {
  readonly code: 'not_opaque';

  constructor(code: 'not_opaque', message: string) {
    super(message);
    this.name = 'PngError';
    this.code = code;
  }
}

/** A turn of the page: a macrotask, which lets the page paint and answer the person. */
function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === 'function') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** The scanlines of `count` rows of RGBA: each a filter byte of 0 and then red, green and blue. Throws if a pixel is not opaque. */
function scanlines(rgba: ArrayLike<number>, width: number, count: number): Uint8Array<ArrayBuffer> {
  const stride = 1 + width * 3;
  const out = new Uint8Array(count * stride);
  for (let row = 0; row < count; row += 1) {
    let from = row * width * 4;
    let to = row * stride + 1;
    for (let x = 0; x < width; x += 1) {
      if (rgba[from + 3] !== 255) {
        throw new PngError(
          'not_opaque',
          'The picture is not opaque, and a file of colour type 2 has no alpha.',
        );
      }
      out[to] = rgba[from] ?? 0;
      out[to + 1] = rgba[from + 1] ?? 0;
      out[to + 2] = rgba[from + 2] ?? 0;
      from += 4;
      to += 3;
    }
  }
  return out;
}

/**
 * Makes the PNG file of a picture as a `Blob` of the type `image/png`, in the pieces it was made in (no array of the whole file is made).
 *
 * @throws RangeError for a size that is not whole pixels or a dpi that is not above 0 (a mistake of the caller).
 * Rejects with `PngError` for a pixel that is not opaque, with the signal's reason if it is aborted, and with whatever the reading of the rows or the compressor fails with.
 */
export async function encodePng(input: PngInput): Promise<Blob> {
  const { width, height, dpi, readRows, signal, onProgress } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('The picture has to be whole pixels, at least one each way.');
  }
  if (!(dpi > 0) || !Number.isFinite(dpi)) {
    throw new RangeError('The dpi is not a number above 0.');
  }
  const wanted = input.sliceRows ?? Math.max(1, Math.floor(SLICE_PIXELS / width));
  if (!Number.isInteger(wanted) || wanted < 1) {
    throw new RangeError('A slice is a whole number of rows, at least one.');
  }
  const yieldNow = input.yieldNow ?? nextTask;
  signal?.throwIfAborted();

  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // The output is read as it is made: a stream that nobody reads stops taking what is written to it.
  const pieces: Uint8Array[] = [];
  const draining = (async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      pieces.push(value);
    }
  })();
  try {
    for (let top = 0; top < height; top += wanted) {
      signal?.throwIfAborted();
      const count = Math.min(wanted, height - top);
      await writer.write(scanlines(readRows(top, count), width, count));
      onProgress?.((top + count) / height);
      await yieldNow();
    }
    signal?.throwIfAborted();
    await writer.close();
    await draining;
  } catch (error) {
    // Let the compressor go, and the reading of it, and take the failure that its being let go gives out of the way of the one that caused it.
    draining.catch(() => undefined);
    await writer.abort(error).catch(() => undefined);
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }

  // The compressed bytes in IDAT chunks of exactly IDAT_SIZE (the last is what is left), each with its CRC made in a turn of its own.
  const parts: Uint8Array[] = [PNG_SIGNATURE, ihdr(width, height), srgb(), phys(dpi)];
  const piece = new Uint8Array(IDAT_SIZE);
  let held = 0;
  const emit = async (size: number): Promise<void> => {
    parts.push(chunk('IDAT', piece.slice(0, size)));
    held = 0;
    await yieldNow();
    signal?.throwIfAborted();
  };
  for (const bytes of pieces) {
    let at = 0;
    while (at < bytes.length) {
      const take = Math.min(IDAT_SIZE - held, bytes.length - at);
      piece.set(bytes.subarray(at, at + take), held);
      held += take;
      at += take;
      if (held === IDAT_SIZE) {
        await emit(IDAT_SIZE);
      }
    }
  }
  if (held > 0 || parts.length === 4) {
    await emit(held);
  }
  parts.push(iend());
  onProgress?.(1);
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}
