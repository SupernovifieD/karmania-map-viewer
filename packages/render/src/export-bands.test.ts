import { describe, expect, it } from 'vitest';
import { BAND_PIXELS, bandRows, readBands } from './export-bands.js';
import type { ReadRows } from './export-bands.js';

/** A card of `height` rows of `width` pixels in which every pixel of a row has the number of the row, counted from the bottom, in its red. */
const card =
  (width: number, log: [number, number][] = []): ReadRows =>
  async (y, rows, into) => {
    log.push([y, rows]);
    for (let row = 0; row < rows; row += 1) {
      for (let x = 0; x < width; x += 1) {
        into.set([(y + row) % 256, 0, 0, 255], (row * width + x) * 4);
      }
    }
    await Promise.resolve();
  };

describe('bandRows', () => {
  it('is about four megabytes of pixels, in a multiple of 8 rows, as the picture is wide', () => {
    expect(bandRows(3508)).toBe(296);
    expect(bandRows(8192)).toBe(128);
    expect(bandRows(1024)).toBe(1024);
    expect(BAND_PIXELS * 4).toBe(4 * 1024 * 1024);
  });

  it('is never fewer than 8 rows, however wide the picture is', () => {
    expect(bandRows(1_000_000)).toBe(8);
    expect(bandRows(BAND_PIXELS)).toBe(8);
  });
});

describe('readBands', () => {
  it('gives the picture from its top row down, each band turned over from the card’s order, whole', async () => {
    const [width, height] = [3, 21];
    const log: [number, number][] = [];
    const taken: { first: number; count: number; reds: number[] }[] = [];
    await readBands({
      width,
      height,
      rows: 8,
      read: card(width, log),
      onBand: (rows, first, count) => {
        // One red for each row of the band (the first pixel of it): the band is read into by the next one, so it is looked at here.
        taken.push({
          first,
          count,
          reds: Array.from({ length: count }, (_, r) => rows[r * width * 4] ?? -1),
        });
      },
    });
    // 21 rows is three bands of 8, 8 and 5 (the card is asked from the bottom for the last of them).
    expect(log).toEqual([
      [13, 8],
      [5, 8],
      [0, 5],
    ]);
    // The first row of the picture is the top row of the card, which is row 20 from its bottom.
    const reds = taken.flatMap((band) => band.reds);
    expect(reds).toEqual(Array.from({ length: height }, (_, row) => height - 1 - row));
    expect(taken.map((band) => [band.first, band.count])).toEqual([
      [0, 8],
      [8, 8],
      [16, 5],
    ]);
  });

  it('waits for what takes a band before it reads the next, and says how far it is after each', async () => {
    const events: string[] = [];
    await readBands({
      width: 2,
      height: 16,
      rows: 8,
      read: async (y, _rows, into) => {
        events.push(`read ${String(y)}`);
        into.fill(0);
        await Promise.resolve();
      },
      onBand: async (_rows, first) => {
        events.push(`take ${String(first)}`);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5);
        });
        events.push(`taken ${String(first)}`);
      },
      onProgress: (done) => events.push(`progress ${String(done)}`),
    });
    expect(events).toEqual([
      'read 8',
      'take 0',
      'taken 0',
      'progress 0.5',
      'read 0',
      'take 8',
      'taken 8',
      'progress 1',
    ]);
  });

  it('stops between bands when it is aborted, with the reason, and reads no more', async () => {
    const controller = new AbortController();
    const log: [number, number][] = [];
    const run = readBands({
      width: 2,
      height: 24,
      rows: 8,
      read: card(2, log),
      signal: controller.signal,
      onBand: (_rows, first) => {
        if (first === 8) {
          controller.abort(new DOMException('Stopped', 'AbortError'));
        }
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    // Bands 0 and 8 were read; the one that was aborted after was not.
    expect(log).toHaveLength(2);
  });

  it('does not read anything for a signal that is aborted already', async () => {
    const log: [number, number][] = [];
    const signal = AbortSignal.abort();
    await expect(
      readBands({ width: 2, height: 8, read: card(2, log), onBand: () => undefined, signal }),
    ).rejects.toBeDefined();
    expect(log).toHaveLength(0);
  });

  it('lets what goes wrong in the read or in taking a band through', async () => {
    await expect(
      readBands({
        width: 2,
        height: 8,
        read: () => Promise.reject(new Error('the card said no')),
        onBand: () => undefined,
      }),
    ).rejects.toThrow('the card said no');
    await expect(
      readBands({
        width: 2,
        height: 8,
        read: card(2),
        onBand: () => {
          throw new Error('no room');
        },
      }),
    ).rejects.toThrow('no room');
  });

  it('is a mistake of the caller to ask for a picture that is not whole pixels', async () => {
    await expect(
      readBands({ width: 0, height: 8, read: card(1), onBand: () => undefined }),
    ).rejects.toThrow(RangeError);
    await expect(
      readBands({ width: 2, height: 8, rows: 0, read: card(1), onBand: () => undefined }),
    ).rejects.toThrow(RangeError);
    await expect(
      readBands({ width: 2.5, height: 8, read: card(1), onBand: () => undefined }),
    ).rejects.toThrow(RangeError);
  });

  it('takes a picture shorter than a band in one band', async () => {
    const log: [number, number][] = [];
    await readBands({ width: 4, height: 3, read: card(4, log), onBand: () => undefined });
    expect(log).toEqual([[0, 3]]);
  });
});
