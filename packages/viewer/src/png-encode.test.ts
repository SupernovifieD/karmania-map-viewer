import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.js';
import {
  IDAT_SIZE,
  PNG_SIGNATURE,
  chunk,
  iend,
  ihdr,
  phys,
  pixelsPerMetre,
  srgb,
} from './png-chunks.js';
import { PngError, SLICE_PIXELS, encodePng } from './png-encode.js';
import { decodePng } from './png-read-test-support.js';

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

/** A picture of `width` by `height` whose pixel at `(x, y)` is a made-up colour, as RGBA rows from `first`. */
const colourAt = (x: number, y: number): [number, number, number] => [
  (x * 7 + y * 3) & 0xff,
  (x * 5 + y * 11) & 0xff,
  (x ^ y) & 0xff,
];
const rowsOf =
  (width: number) =>
  (first: number, count: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(width * count * 4);
    for (let r = 0; r < count; r += 1) {
      for (let x = 0; x < width; x += 1) {
        out.set([...colourAt(x, first + r), 255], (r * width + x) * 4);
      }
    }
    return out;
  };

describe('crc32', () => {
  it('is the CRC-32 of the standard check string, 0xCBF43926, and of nothing 0', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('can be carried on over pieces: the CRC of a and then b is that of ab', () => {
    const a = new TextEncoder().encode('12345');
    const b = new TextEncoder().encode('6789');
    expect(crc32(b, crc32(a))).toBe(0xcbf43926);
  });
});

describe('the chunks', () => {
  it('begin with the signature of the format and are length, four letters, data and the CRC of the letters and the data', () => {
    expect([...PNG_SIGNATURE]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const c = chunk('tEXt', Uint8Array.of(1, 2, 3));
    expect([...c.subarray(0, 8)]).toEqual([0, 0, 0, 3, 116, 69, 88, 116]);
    expect(new DataView(c.buffer).getUint32(11)).toBe(crc32(c.subarray(4, 11)));
    expect(() => chunk('abc', new Uint8Array(0))).toThrow(RangeError);
  });

  it('say 8 bits, colour type 2 and no interlace in IHDR, intent 0 in sRGB, and the dpi as pixels to the metre in pHYs', () => {
    expect([...ihdr(3508, 2480).subarray(8, 21)]).toEqual([
      0, 0, 13, 180, 0, 0, 9, 176, 8, 2, 0, 0, 0,
    ]);
    expect([...srgb().subarray(8, 9)]).toEqual([0]);
    expect([96, 150, 300].map(pixelsPerMetre)).toEqual([3780, 5906, 11811]);
    const p = phys(300);
    const view = new DataView(p.buffer);
    expect([view.getUint32(8), view.getUint32(12), p[16]]).toEqual([11811, 11811, 1]);
    expect(iend().length).toBe(12);
  });
});

describe('encodePng', () => {
  const encode = (
    width: number,
    height: number,
    extra: Partial<Parameters<typeof encodePng>[0]> = {},
  ) =>
    encodePng({
      width,
      height,
      dpi: 300,
      readRows: rowsOf(width),
      yieldNow: () => Promise.resolve(),
      ...extra,
    });

  it('makes a file that another reader reads back to the same pixels, with the chunks of the picture in order: IHDR, sRGB, pHYs, IDAT, IEND', async () => {
    const blob = await encode(37, 23);
    expect(blob.type).toBe('image/png');
    const png = await decodePng(await bytesOf(blob));
    expect([png.width, png.height]).toEqual([37, 23]);
    expect(png.chunks.map((c) => c.type)).toEqual(['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
    for (let y = 0; y < 23; y += 1) {
      for (let x = 0; x < 37; x += 1) {
        const at = (y * 37 + x) * 3;
        expect([...png.rgb.subarray(at, at + 3)], `pixel ${String(x)}, ${String(y)}`).toEqual(
          colourAt(x, y),
        );
      }
    }
  });

  it('has the dpi in pHYs: 96, 150 and 300 are 3,780, 5,906 and 11,811 pixels to the metre, in metres', async () => {
    for (const [dpi, ppm] of [
      [96, 3780],
      [150, 5906],
      [300, 11811],
    ] as const) {
      const png = await decodePng(await bytesOf(await encode(8, 8, { dpi })));
      expect(png.physical).toEqual({ across: ppm, down: ppm, unit: 1 });
    }
  });

  it('cuts the image data into chunks of exactly 64 KiB and a last that holds the rest, however large the picture is', async () => {
    // Noise does not compress, so this is several chunks of data.
    let seed = 1;
    const noise = (_first: number, count: number): Uint8ClampedArray => {
      const out = new Uint8ClampedArray(300 * count * 4);
      for (let i = 0; i < out.length; i += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        out[i] = i % 4 === 3 ? 255 : seed >>> 24;
      }
      return out;
    };
    const png = await decodePng(await bytesOf(await encode(300, 300, { readRows: noise })));
    const sizes = png.chunks.filter((c) => c.type === 'IDAT').map((c) => c.data.length);
    expect(sizes.length).toBeGreaterThan(3);
    expect(sizes.slice(0, -1).every((size) => size === IDAT_SIZE)).toBe(true);
    expect(sizes.at(-1)).toBeGreaterThan(0);
    expect(sizes.at(-1)).toBeLessThanOrEqual(IDAT_SIZE);
  });

  it('gives the same file twice in a row, and the same whatever the number of rows given at a time', async () => {
    const [a, b] = [await bytesOf(await encode(61, 47)), await bytesOf(await encode(61, 47))];
    expect(a).toEqual(b);
    for (const sliceRows of [1, 5, 47, 1000]) {
      expect(
        await bytesOf(await encode(61, 47, { sliceRows })),
        `${String(sliceRows)} rows`,
      ).toEqual(a);
    }
  });

  it('reads the rows of the picture in slices of at most the number of pixels it says, and gives the page a turn after each', async () => {
    const calls: number[] = [];
    let turns = 0;
    await encodePng({
      width: 1000,
      height: 600,
      dpi: 96,
      readRows: (first, count) => {
        calls.push(count);
        return rowsOf(1000)(first, count);
      },
      yieldNow: () => {
        turns += 1;
        return Promise.resolve();
      },
    });
    const rows = Math.floor(SLICE_PIXELS / 1000);
    expect(calls.every((count) => count <= rows)).toBe(true);
    expect(calls.reduce((a, b) => a + b, 0)).toBe(600);
    expect(calls).toHaveLength(Math.ceil(600 / rows));
    // A turn after each slice, and one after each chunk of data.
    expect(turns).toBeGreaterThanOrEqual(calls.length);
  });

  it('says how far it is by rows, never going back, and ends at 1', async () => {
    const done: number[] = [];
    await encode(10, 40, { sliceRows: 10, onProgress: (d) => done.push(d) });
    expect(done).toEqual([0.25, 0.5, 0.75, 1, 1]);
  });

  it('stops between slices when it is aborted, with the reason, and reads no more rows', async () => {
    const controller = new AbortController();
    let reads = 0;
    const run = encodePng({
      width: 10,
      height: 100,
      dpi: 96,
      sliceRows: 10,
      signal: controller.signal,
      yieldNow: () => Promise.resolve(),
      readRows: (first, count) => {
        reads += 1;
        if (reads === 3) {
          controller.abort(new DOMException('Stopped', 'AbortError'));
        }
        return rowsOf(10)(first, count);
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads).toBe(3);
  });

  it('does not start for a signal that is aborted already', async () => {
    let reads = 0;
    await expect(
      encode(4, 4, {
        signal: AbortSignal.abort(),
        readRows: () => {
          reads += 1;
          return new Uint8Array(0);
        },
      }),
    ).rejects.toBeDefined();
    expect(reads).toBe(0);
  });

  it('rejects, and does not make a file of colour type 2, for a pixel that is not opaque', async () => {
    const see = (first: number, count: number): Uint8ClampedArray => {
      const rows = rowsOf(4)(first, count);
      rows[7] = 254;
      return rows;
    };
    await expect(encode(4, 4, { readRows: see })).rejects.toBeInstanceOf(PngError);
  });

  it('lets what the reading of the rows fails with through', async () => {
    await expect(
      encode(4, 4, {
        readRows: () => {
          throw new Error('the canvas is gone');
        },
      }),
    ).rejects.toThrow('the canvas is gone');
  });

  it('is a mistake of the caller to ask for a picture that is not whole pixels, a dpi that is not above 0, or no rows in a slice', async () => {
    await expect(encode(0, 4)).rejects.toThrow(RangeError);
    await expect(encode(4, 2.5)).rejects.toThrow(RangeError);
    await expect(encode(4, 4, { dpi: 0 })).rejects.toThrow(RangeError);
    await expect(encode(4, 4, { dpi: Number.NaN })).rejects.toThrow(RangeError);
    await expect(encode(4, 4, { sliceRows: 0 })).rejects.toThrow(RangeError);
  });

  it('makes a picture of one pixel, and one that is a single row and a single column', async () => {
    for (const [w, h] of [
      [1, 1],
      [50, 1],
      [1, 50],
    ] as const) {
      const png = await decodePng(await bytesOf(await encode(w, h)));
      expect([png.width, png.height]).toEqual([w, h]);
      expect([...png.rgb.subarray(0, 3)]).toEqual(colourAt(0, 0));
    }
  });
});
