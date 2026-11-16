/**
 * Reading the exported picture off the card in bands (step 22.1c): a picture of 3,508 by 2,480 pixels is 35 MB and one of 8,192 by 8,192 is 268 MB, so it is read a few
 * rows at a time into one small array, and each band is handed on and gone before the next is read: no array the size of the picture ever exists here, and no task is
 * longer than a band. The card has the rows from the bottom; the picture is made from the top, so each band is turned over (its rows put in the other order) on the way.
 * Pure: the read is given, so this is tested without a card.
 */

/** How many pixels a band is about (4 MiB at four bytes each): long enough that the waits between bands are few, short enough to be copied in a moment. */
export const BAND_PIXELS = 2 ** 20;

/** The least a band is high, and the multiple of rows that it is cut to (so that a band is whole rows in every row of a pixel block). */
const BAND_STEP = 8;

/** How many rows are in a band of a picture `width` pixels across: about `BAND_PIXELS`, a multiple of 8, and never fewer than 8. */
export function bandRows(width: number): number {
  const rows = Math.floor(BAND_PIXELS / Math.max(width, 1));
  return Math.max(BAND_STEP, rows - (rows % BAND_STEP));
}

/**
 * Reads `rows` rows of the picture, `y` rows up from its bottom, into `into` (four bytes a pixel, `width * rows * 4` of them, the bottom row first, as the card has
 * them). It rejects if it cannot.
 */
export type ReadRows = (y: number, rows: number, into: Uint8Array) => Promise<void>;

/**
 * What takes a band: `rows` has the rows of the band from its top, four bytes a pixel, `count` of them, and the first of them is the row `first` of the picture
 * counted from its top. The array is used again for the next band: it is to be copied or used before the call is done (a promise that it returns is waited for).
 */
export type TakeBand = (rows: Uint8Array, first: number, count: number) => void | Promise<void>;

export interface ReadBandsOptions {
  /** The size of the picture, in pixels: whole numbers of at least 1. */
  readonly width: number;
  readonly height: number;
  readonly read: ReadRows;
  readonly onBand: TakeBand;
  /** How many rows a band has, a whole number of at least 1; `bandRows(width)` if it is not given. */
  readonly rows?: number;
  /** Stops the reading between two bands (and rejects with the signal's reason). */
  readonly signal?: AbortSignal;
  /** Called after each band with the part of the picture that has been taken, from 0 to 1. */
  readonly onProgress?: (done: number) => void;
}

/** Reads the whole picture band by band, from the top, and gives each band to `onBand`. */
export async function readBands(options: ReadBandsOptions): Promise<void> {
  const { width, height, read, onBand, signal, onProgress } = options;
  const wanted = options.rows ?? bandRows(width);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(wanted) ||
    width < 1 ||
    height < 1 ||
    wanted < 1
  ) {
    throw new RangeError(
      'The picture has to be whole pixels, at least one each way, in bands of whole rows.',
    );
  }
  const rows = Math.min(wanted, height);
  const stride = width * 4;
  const raw = new Uint8Array(rows * stride);
  const turned = new Uint8Array(rows * stride);
  for (let top = 0; top < height; top += rows) {
    signal?.throwIfAborted();
    const count = Math.min(rows, height - top);
    // The rows the card has for this band are those from `y` up; the band's top row is the highest of them.
    const y = height - top - count;
    const into = raw.subarray(0, count * stride);
    await read(y, count, into);
    signal?.throwIfAborted();
    const out = turned.subarray(0, count * stride);
    for (let row = 0; row < count; row += 1) {
      out.set(into.subarray((count - 1 - row) * stride, (count - row) * stride), row * stride);
    }
    await onBand(out, top, count);
    onProgress?.((top + count) / height);
  }
}
