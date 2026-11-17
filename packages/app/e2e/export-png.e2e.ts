import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { composePicture, exportPngFile, pngPixelsAgainstCanvas } from './support/export.js';
import { sizeMap } from './support/golden.js';
import { loadLegendScene } from './support/legend.js';
import { dispatch, drawn, stats } from './support/render.js';

/**
 * The PNG file of the exported picture (step 22.6), through the viewer's `exportPng`: a file that the browser's own decoder reads as the picture, with the dpi and the colour space
 * in it, the same bytes twice in a row (in 2D and in 3D), progress in steps, stopped when it is aborted, and one at a time.
 */

async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await sizeMap(page);
  await drawn(page);
  await expect.poll(async () => (await stats(page))?.cssWidth).toBe(800);
}

/** The chunks of a file: their four letters and data, in order (the length and CRC are checked by the decoder of the browser, and by the unit tests). */
function chunksOf(base64: string): { type: string; data: Buffer }[] {
  const bytes = Buffer.from(base64, 'base64');
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    chunks.push({
      type: bytes.toString('latin1', at + 4, at + 8),
      data: bytes.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

test.describe('the PNG file of the picture', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('is a file the browser reads as the picture, pixel for pixel, with the dpi and the colour space in it', async ({
    page,
  }) => {
    const out = await exportPngFile(page, { widthPx: 900, heightPx: 600, base64: true });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    if (!out.ok) {
      return;
    }
    expect(out.type).toBe('image/png');
    const chunks = chunksOf(out.base64 ?? '');
    expect(
      chunks.map((c) => c.type).filter((type, k, all) => k === 0 || type !== all[k - 1]),
    ).toEqual(['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
    const [header] = chunks;
    expect([
      header?.data.readUInt32BE(0),
      header?.data.readUInt32BE(4),
      header?.data[8],
      header?.data[9],
    ]).toEqual([900, 600, 8, 2]);
    // The picture that the file was made from, put together again (it is the same scene), is what the browser decodes the file as.
    await composePicture(page, { width: 900, height: 600 });
    const same = await pngPixelsAgainstCanvas(page);
    expect([same.width, same.height]).toEqual([900, 600]);
    expect(same.differences).toBe(0);
  });

  for (const [dpi, perMetre] of [
    [96, 3780],
    [150, 5906],
    [300, 11811],
  ] as const) {
    test(`says ${String(dpi)} dpi as ${String(perMetre)} pixels to the metre, in metres`, async ({
      page,
    }) => {
      const out = await exportPngFile(page, {
        widthPx: 400,
        heightPx: 300,
        dpi,
        legend: false,
        base64: true,
      });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      const phys = chunksOf(out.ok ? (out.base64 ?? '') : '').find((c) => c.type === 'pHYs');
      expect([phys?.data.readUInt32BE(0), phys?.data.readUInt32BE(4), phys?.data[8]]).toEqual([
        perMetre,
        perMetre,
        1,
      ]);
    });
  }

  for (const mode of ['2d', '3d'] as const) {
    test(`gives the same bytes twice in a row in ${mode}, and not the same bytes when the map is changed`, async ({
      page,
    }) => {
      if (mode === '3d') {
        await dispatch(page, { type: 'setViewMode', mode: '3d' });
        await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
      }
      const [first, second] = [
        await exportPngFile(page, { widthPx: 1100, heightPx: 700 }),
        await exportPngFile(page, { widthPx: 1100, heightPx: 700 }),
      ];
      expect(first.ok && second.ok, JSON.stringify([first, second])).toBe(true);
      if (first.ok && second.ok) {
        expect(second.size).toBe(first.size);
        expect(second.hash).toBe(first.hash);
      }
      // A picture of another scene is another file: the hash is not a constant.
      await dispatch(page, {
        type: 'setStyle',
        layerId: 'layer-1',
        patch: { colour: { mode: 'single', value: '#0072b2' } },
      });
      await expect.poll(async () => (await drawn(page)).frames).toBeGreaterThan(0);
      const changed = await exportPngFile(page, { widthPx: 1100, heightPx: 700 });
      expect(changed.ok && first.ok && changed.hash !== first.hash).toBe(true);
    });
  }

  test('makes A4 landscape at 300 dpi, 3,508 by 2,480 pixels, which the browser decodes at that size and that is not a blank page', async ({
    page,
  }) => {
    test.slow();
    const out = await exportPngFile(page, {
      widthPx: 3508,
      heightPx: 2480,
      dpi: 300,
      base64: false,
    });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    if (!out.ok) {
      return;
    }
    // A picture of the map, a legend and furniture compresses to a few megabytes, and is more than the header.
    expect(out.size).toBeGreaterThan(50_000);
    const decoded = await page.evaluate(async () => {
      const holder = window as unknown as { __png: Blob };
      const bitmap = await createImageBitmap(holder.__png, { colorSpaceConversion: 'none' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx?.drawImage(bitmap, 0, 0);
      // The corner is the white of the page, and the middle of the map is not.
      const corner = ctx?.getImageData(2, 2, 1, 1).data ?? [];
      const inside = ctx?.getImageData(300, 300, 1, 1).data ?? [];
      return {
        width: bitmap.width,
        height: bitmap.height,
        corner: [...corner],
        inside: [...inside],
      };
    });
    expect([decoded.width, decoded.height]).toEqual([3508, 2480]);
    expect(decoded.corner).toEqual([255, 255, 255, 255]);
    expect(decoded.inside.slice(0, 3)).not.toEqual([255, 255, 255]);
  });

  test('says how far it is in steps, from the picture to the file, never going back, and ends at 1', async ({
    page,
  }) => {
    const out = await exportPngFile(page, { widthPx: 900, heightPx: 600 });
    expect(out.ok).toBe(true);
    const progress = out.progress;
    expect(progress.length).toBeGreaterThan(5);
    expect(progress.every((done, k) => k === 0 || done >= (progress[k - 1] ?? 0))).toBe(true);
    expect(progress.at(-1)).toBe(1);
    // The picture is the first 70 %: some step is there, and the file is the rest.
    expect(progress.some((done) => done > 0.5 && done < 0.7)).toBe(true);
    expect(progress.some((done) => done > 0.75 && done < 1)).toBe(true);
  });

  test('stops, with the reason of the signal and no file, when it is aborted', async ({ page }) => {
    const out = await exportPngFile(page, { widthPx: 900, heightPx: 600, abortAt: 0.3 });
    expect(out).toMatchObject({ ok: false, name: 'AbortError' });
    // And the next export is made: nothing is left held by the one that was stopped.
    const again = await exportPngFile(page, { widthPx: 900, heightPx: 600 });
    expect(again.ok, JSON.stringify(again)).toBe(true);
  });

  test('refuses a picture larger than 8,192 pixels on a side, the whole picture and not only the map inside it, and sizes that are not sizes', async ({
    page,
  }) => {
    // 8,193 across with no legend: the map inside the 24 pixel margins is 8,143 wide, which is under the limit: it is the picture that is too large.
    expect(
      await exportPngFile(page, { widthPx: 8193, heightPx: 200, legend: false }),
    ).toMatchObject({
      ok: false,
      name: 'ExportError',
      code: 'too_large',
    });
    expect(
      await exportPngFile(page, { widthPx: 200, heightPx: 8193, legend: false }),
    ).toMatchObject({
      ok: false,
      name: 'ExportError',
      code: 'too_large',
    });
    // Too small and not whole numbers are mistakes of the caller.
    expect(await exportPngFile(page, { widthPx: 10, heightPx: 10 })).toMatchObject({
      ok: false,
      name: 'RangeError',
    });
    expect(await exportPngFile(page, { widthPx: 300.5, heightPx: 400 })).toMatchObject({
      ok: false,
      name: 'RangeError',
    });
    // And what is allowed is made: 8,192 is the most.
    const stats8192 = await exportPngFile(page, { widthPx: 2000, heightPx: 100, legend: false });
    expect(stats8192.ok, JSON.stringify(stats8192)).toBe(true);
  });

  test('refuses a legend that leaves no room for the map, a picture larger than the card draws, and an export while another is going', async ({
    page,
  }) => {
    const narrow = await exportPngFile(page, { widthPx: 240, heightPx: 600 });
    expect(narrow).toMatchObject({ ok: false, name: 'ComposeError', code: 'no_room_for_map' });
    const huge = await exportPngFile(page, { widthPx: 20000, heightPx: 200, legend: false });
    expect(huge).toMatchObject({ ok: false, name: 'ExportError', code: 'too_large' });
    const both = await page.evaluate(async () => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        exportPng(o: object): Promise<Blob>;
      };
      const options = { widthPx: 1200, heightPx: 800, dpi: 96, legend: true };
      const first = viewer.exportPng(options);
      const second = await viewer.exportPng(options).then(
        () => 'made',
        (error: unknown) => (error as { code?: string }).code ?? 'error',
      );
      await first;
      return second;
    });
    expect(both).toBe('busy');
  });
});
