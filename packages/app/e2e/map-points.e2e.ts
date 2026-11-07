import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixturePath } from './support/picker.js';
import { importAndLoad } from './support/wizard.js';
import {
  around,
  bytes,
  camera,
  dispatch,
  distance,
  drawn,
  layerColour,
  layerStatuses,
  marked,
  pause,
  sceneFrame,
  stats,
  withData,
} from './support/render.js';

/** The first point of `points.csv`: easting, northing, in the file's own coordinates (EPSG:32640). */
const FIRST = readFileSync(fixturePath('points.csv'), 'utf8')
  .split('\n')[1]
  ?.split(',')
  .slice(0, 2)
  .map(Number) as [number, number];

/** The colour of the map and of the text, as bytes, as the page has them: what the map is cleared to and what the outline is. */
async function colours(page: Page): Promise<{ map: number[]; ink: number[] }> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const style = getComputedStyle(element);
    const bytesOf = (text: string): number[] =>
      (text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    return { map: [...bytesOf(style.backgroundColor), 255], ink: [...bytesOf(style.color), 255] };
  });
}

/**
 * Puts the camera so that the first point is `right` pixels to the right and `up` pixels above the middle of the map, at `scale` map
 * units a pixel and `heading`; and gives where the point is in the buffer (from the bottom left).
 */
async function place(
  page: Page,
  options: { right?: number; up?: number; scale?: number; heading?: number } = {},
): Promise<{ x: number; y: number }> {
  const { right = 0, up = 0, scale = 1, heading = 0 } = options;
  const turn = (heading * Math.PI) / 180;
  // The map offset of the point from the middle of the screen: right along (cos, -sin) and up along (sin, cos).
  const offset = [
    (right * Math.cos(turn) + up * Math.sin(turn)) * scale,
    (-right * Math.sin(turn) + up * Math.cos(turn)) * scale,
  ];
  await dispatch(page, {
    type: 'setCamera',
    patch: {
      camera2d: {
        centre: [FIRST[0] - (offset[0] ?? 0), FIRST[1] - (offset[1] ?? 0)],
        unitsPerPixel: scale,
        heading,
      },
    },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - scale))
    .toBeLessThan(1e-9);
  const ratio = now.pixelRatio;
  return {
    x: Math.floor(now.width / 2 + right * ratio),
    y: Math.floor(now.height / 2 + up * ratio),
  };
}

test.describe('the points layer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
  });

  test('draws a point where the camera puts it: a disc of its size, in the colour of the layer, on the map', async ({
    page,
  }) => {
    const spot = await place(page, { right: 100, up: 40 });
    const { map } = await colours(page);
    const fill = bytes(await layerColour(page));
    // The middle of the marker is the colour of the layer, exactly.
    expect((await around(page, spot.x, spot.y, 0)).at(0, 0)).toEqual([...fill, 255]);
    // What is marked on the map is the marker and nothing else: 6 pixels wide and as many high, give or take its smoothed edge.
    const box = marked(await around(page, spot.x, spot.y, 15), map);
    expect(box.maxX - box.minX + 1).toBeGreaterThanOrEqual(6);
    expect(box.maxX - box.minX + 1).toBeLessThanOrEqual(7);
    expect(box.maxY - box.minY + 1).toBeGreaterThanOrEqual(6);
    expect(box.maxY - box.minY + 1).toBeLessThanOrEqual(7);
    expect(Math.abs(box.minX + box.maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.minY + box.maxY)).toBeLessThanOrEqual(1);
    // Where the camera is looking, and everywhere else that has no point, is the map.
    const now = await drawn(page);
    expect(
      (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(0, 0),
    ).toEqual(map);
    expect((await around(page, spot.x + 30, spot.y, 0)).at(0, 0)).toEqual(map);
  });

  test('has the outline round the marker, in the colour of the text: dark on the light map and light on the dark', async ({
    page,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/?theme=${theme}`);
      await withData(page);
      const spot = await place(page, { right: 60 });
      const { ink, map } = await colours(page);
      const block = await around(page, spot.x, spot.y, 6);
      // The pixel in the ring of the outline (2.5 pixels from the middle) is nearly the colour of the text, and the fill is not.
      const ring = block
        .all()
        .filter(([dx, dy]) => Math.abs(Math.hypot(dx, dy) - 2.5) < 0.6)
        .map(([, , pixel]) => distance(pixel, ink));
      expect(Math.min(...ring), theme).toBeLessThan(30);
      const fill = bytes(await layerColour(page));
      expect(distance(ink, fill)).toBeGreaterThan(30);
      // And the ink is the other side of the map: dark on a light map, light on a dark one.
      expect(theme === 'light' ? ink[0] : map[0], theme).toBeLessThan(theme === 'light' ? 80 : 40);
    }
  });

  test('turns with the heading: with the top of the screen facing east, east is up', async ({
    page,
  }) => {
    // The point is 100 pixels east of the middle of the map, and the top faces east: it is 100 pixels above the middle.
    const spot = await place(page, { right: 0, up: 100, heading: 90 });
    const fill = bytes(await layerColour(page));
    expect((await around(page, spot.x, spot.y, 0)).at(0, 0)).toEqual([...fill, 255]);
    const now = await drawn(page);
    expect(spot).toEqual({ x: Math.floor(now.width / 2), y: Math.floor(now.height / 2 + 100) });
    // Not where it would be if the map were not turned.
    const { map } = await colours(page);
    expect(
      (await around(page, Math.floor(now.width / 2 + 100), Math.floor(now.height / 2), 0)).at(0, 0),
    ).toEqual(map);
  });

  test('is as far from the middle as the scale says: a point 100 pixels away at 4 units a pixel is 200 away at 2', async ({
    page,
  }) => {
    const fill = bytes(await layerColour(page));
    const first = await place(page, { right: 100, scale: 4 });
    expect((await around(page, first.x, first.y, 0)).at(0, 0)).toEqual([...fill, 255]);
    // The camera now has the same centre and half the units a pixel: the point is 200 pixels away.
    await dispatch(page, { type: 'setCamera', patch: { camera2d: { unitsPerPixel: 2 } } });
    await drawn(page);
    const now = await drawn(page);
    const spot = { x: Math.floor(now.width / 2 + 200), y: Math.floor(now.height / 2) };
    await expect
      .poll(async () => (await around(page, spot.x, spot.y, 0)).at(0, 0))
      .toEqual([...fill, 255]);
  });

  test('has the size of the style, and the colour, and the opacity, and can be hidden, without being built again', async ({
    page,
  }) => {
    const spot = await place(page, { right: 80 });
    const { map } = await colours(page);
    const fill = bytes(await layerColour(page));
    const before = await drawn(page);
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { pointSize: 12 } });
    await expect
      .poll(async () => {
        const box = marked(await around(page, spot.x, spot.y, 15), map);
        return box.maxX - box.minX + 1;
      })
      .toBeGreaterThanOrEqual(12);
    const big = marked(await around(page, spot.x, spot.y, 15), map);
    expect(big.maxX - big.minX + 1).toBeLessThanOrEqual(13);
    // Another colour, and the middle of the marker is that colour.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#009e73' } },
    });
    await expect
      .poll(async () => (await around(page, spot.x, spot.y, 0)).at(0, 0))
      .toEqual([0, 158, 115, 255]);
    // Half opaque: half of the colour and half of the map.
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    await expect
      .poll(async () =>
        distance((await around(page, spot.x, spot.y, 0)).at(0, 0), [
          (0 + (map[0] ?? 0)) / 2,
          (158 + (map[1] ?? 0)) / 2,
          (115 + (map[2] ?? 0)) / 2,
        ]),
      )
      .toBeLessThanOrEqual(2);
    // Hidden: nothing.
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    await expect.poll(async () => (await around(page, spot.x, spot.y, 0)).at(0, 0)).toEqual(map);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: true });
    await expect
      .poll(async () => distance((await around(page, spot.x, spot.y, 0)).at(0, 0), map))
      .toBeGreaterThan(20);
    // And all of that on the same layer: nothing was built again.
    const after = await drawn(page);
    expect([after.geometries, after.layers]).toEqual([before.geometries, before.layers]);
    expect(fill).toHaveLength(3);
  });

  test('puts the layer on the card once, and has none of it left when the dataset is removed', async ({
    page,
  }) => {
    const loaded = await drawn(page);
    expect(loaded.layers).toBe(1);
    expect(loaded.geometries).toBe(1);
    await page
      .locator('karmania-dataset-list li')
      .first()
      .locator('.remove k-button button')
      .click();
    await page.locator('karmania-dataset-list k-button[slot="footer-end"]').click();
    await expect.poll(async () => (await stats(page))?.layers).toBe(0);
    const gone = await drawn(page);
    expect(gone.geometries).toBe(0);
    expect(gone.textures).toBe(0);
  });

  test('is drawn again when the card gives the context back', async ({ page }) => {
    const spot = await place(page, { right: 50, up: 20 });
    const fill = bytes(await layerColour(page));
    await page.evaluate(() => {
      const canvas = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer')
        ?.shadowRoot?.querySelector('karmania-map-area')
        ?.shadowRoot?.querySelector('canvas');
      const extension = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      (window as unknown as { loseContext: WEBGL_lose_context | null | undefined }).loseContext =
        extension;
      extension?.loseContext();
    });
    await expect.poll(async () => (await stats(page))?.contextLost).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { loseContext: WEBGL_lose_context }).loseContext.restoreContext();
    });
    await expect.poll(async () => (await stats(page))?.contextLost).toBe(false);
    await expect
      .poll(async () => (await around(page, spot.x, spot.y, 0)).at(0, 0))
      .toEqual([...fill, 255]);
    await pause(page, 100);
  });

  test('does not draw a point that is a long way outside the map, and it is no error', async ({
    page,
  }) => {
    // A point a long way off the map is not drawn and is no error; the map is the map.
    await place(page, { right: 100000 });
    const { map } = await colours(page);
    const now = await drawn(page);
    expect(
      (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(0, 0),
    ).toEqual(map);
    expect(await sceneFrame(page)).not.toBeNull();
  });
});

test.describe('the points layer on a screen of twice the density', () => {
  test.use({ deviceScaleFactor: 2 });

  test('is the same size in CSS pixels, so twice the pixels, with the outline twice as wide', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await withData(page);
    const spot = await place(page, { right: 100 });
    const { map } = await colours(page);
    const box = marked(await around(page, spot.x, spot.y, 20), map);
    // 6 CSS pixels are 12 device pixels, with the smoothed edge.
    expect(box.maxX - box.minX + 1).toBeGreaterThanOrEqual(12);
    expect(box.maxX - box.minX + 1).toBeLessThanOrEqual(13);
    expect(box.maxY - box.minY + 1).toBeGreaterThanOrEqual(12);
    expect(box.maxY - box.minY + 1).toBeLessThanOrEqual(13);
  });
});

test.describe('a layer of more points than one part holds', () => {
  test('is put on the card in two parts, all of it drawn, and all of it freed', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // 100,001 points on a grid a metre apart: 100,000 make a part, so there are two. Point i is at (i mod 1000, i div 1000) metres.
    const rows = ['Easting,Northing,RL'];
    for (let i = 0; i <= 100_000; i += 1) {
      rows.push(`${String(500_000 + (i % 1000))},${String(2_765_000 + Math.floor(i / 1000))},100`);
    }
    await page.goto('/?theme=light');
    await importAndLoad(
      page,
      { name: 'grid.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) },
      {
        name: 'grid.prj',
        mimeType: 'text/plain',
        buffer: Buffer.from('PROJCS["x",AUTHORITY["EPSG","32640"]]'),
      },
    );
    await drawn(page);
    // The last part comes on the card in a frame of its own.
    await expect.poll(async () => (await stats(page))?.geometries, { timeout: 30_000 }).toBe(2);
    await expect
      .poll(async () => (await layerStatuses(page)).map(([, status]) => status), {
        timeout: 30_000,
      })
      .toEqual(['drawn']);
    const fill = bytes(await layerColour(page));
    // The one point of the second part (the 100,001st: at the corner's east and 100 m north of it), and one of the first.
    for (const [east, north] of [
      [0, 100],
      [10, 5],
    ] as const) {
      await dispatch(page, {
        type: 'setCamera',
        patch: {
          // Zoomed in until the points are 50 pixels apart: they are not on each other.
          camera2d: {
            centre: [500_000 + east, 2_765_000 + north],
            unitsPerPixel: 0.02,
            heading: 0,
          },
        },
      });
      const now = await drawn(page);
      await expect
        .poll(async () =>
          (await around(page, Math.floor(now.width / 2), Math.floor(now.height / 2), 0)).at(0, 0),
        )
        .toEqual([...fill, 255]);
    }
    await page
      .locator('karmania-dataset-list li')
      .first()
      .locator('.remove k-button button')
      .click();
    await page.locator('karmania-dataset-list k-button[slot="footer-end"]').click();
    await expect.poll(async () => (await stats(page))?.layers).toBe(0);
    expect((await stats(page))?.geometries).toBe(0);
  });
});
