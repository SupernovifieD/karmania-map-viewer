/**
 * The highlight of the selected element (step 21.2): an outline round it, in the accent colour, with a ring of the colour of the text outside that,
 * drawn over the layers from what picking says the element's pixels are. The pixels round known elements are read back from the map.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
import { fixturePath } from './support/picker.js';
import { pixelOf3d } from './support/project.js';
import {
  around,
  camera,
  dispatch,
  distance,
  drawn,
  layerStatuses,
  loadLattice,
  sceneFrame,
  stats,
  withData,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/** The points of `points.csv`: easting and northing, in the order of the file (element 0 first). */
const POINTS = readFileSync(fixturePath('points.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.split(',').slice(0, 2).map(Number) as [number, number]);

/** The colours the canvas has: the accent, the text (the ring outside the accent), and the map. As bytes, with an alpha of 255. */
async function colours(page: Page): Promise<{ accent: number[]; ink: number[]; map: number[] }> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const style = getComputedStyle(element);
    const bytesOf = (text: string): number[] => [
      ...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number),
      255,
    ];
    return {
      accent: bytesOf(style.accentColor),
      ink: bytesOf(style.color),
      map: bytesOf(style.backgroundColor),
    };
  });
}

/** Looks at `at` with it in the middle of the map at `scale`, and gives the pixel of the buffer (from the bottom left) that is its middle. */
async function centreOn(
  page: Page,
  at: readonly [number, number],
  scale = 1,
): Promise<{ x: number; y: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [at[0], at[1]], unitsPerPixel: scale, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - scale))
    .toBeLessThan(1e-9);
  return { x: Math.floor(now.width / 2), y: Math.floor(now.height / 2) };
}

const select = (page: Page, layerId: string, element: number) =>
  dispatch(page, { type: 'setSelection', selection: { layerId, element } });
const clear = (page: Page) => dispatch(page, { type: 'setSelection', selection: null });

/** The pixel `(dx, dy)` from `from` (up is positive y, as the buffer has it). */
async function pixelAt(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<number[]> {
  return (await around(page, from.x + dx, from.y + dy, 0)).at(0, 0);
}

test.describe('the outline of the selected point', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
  });

  test('is a ring of the accent colour just outside where the point is picked, and a ring of the colour of the text outside that, all round, and the point is as it was', async ({
    page,
  }) => {
    const { accent, ink, map } = await colours(page);
    const centre = await centreOn(page, POINTS[2] as [number, number]);
    const before = await pixelAt(page, centre, 0, 0);
    await select(page, 'layer-1', 2);
    // The marker is a disc of 7 pixels across, 3.5 from its middle to its edge: the ring is the 3 pixels after that (to 6.5), the edge of the colour of the
    // text the 1.5 after (to 8).
    // (The middle of the point is the middle of the pixel `centre` and a half more, so the pixels are chosen to be well inside the rings.)
    for (const [dx, dy] of [
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
      [3, 3],
      [-4, -4],
      [4, -4],
      [-4, 4],
    ] as const) {
      await expect
        .poll(
          async () => distance(await pixelAt(page, centre, dx, dy), accent),
          `${String(dx)}, ${String(dy)}`,
        )
        .toBeLessThanOrEqual(6);
    }
    for (const [dx, dy] of [
      [7, 0],
      [-7, 0],
      [0, 7],
      [0, -7],
    ] as const) {
      expect(
        distance(await pixelAt(page, centre, dx, dy), ink),
        `${String(dx)}, ${String(dy)}`,
      ).toBeLessThanOrEqual(6);
    }
    // Beyond it the map, and in the middle the point, as it was (the outline is round it and not over it).
    for (const [dx, dy] of [
      [12, 0],
      [0, -12],
      [-10, 10],
    ] as const) {
      expect(distance(await pixelAt(page, centre, dx, dy), map)).toBeLessThanOrEqual(6);
    }
    expect(await pixelAt(page, centre, 0, 0)).toEqual(before);
    // The accent is not the colour of the text nor of the map.
    expect(distance(accent, ink)).toBeGreaterThan(40);
    expect(distance(accent, map)).toBeGreaterThan(40);
  });

  test('moves to the element that is selected next, and is gone when nothing is selected', async ({
    page,
  }) => {
    const { accent, map } = await colours(page);
    const centre = await centreOn(page, POINTS[2] as [number, number]);
    await select(page, 'layer-1', 2);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), accent))
      .toBeLessThanOrEqual(6);
    // Another point: this one's ring is gone (the camera has not moved).
    await select(page, 'layer-1', 6);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), map))
      .toBeLessThanOrEqual(6);
    await select(page, 'layer-1', 2);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), accent))
      .toBeLessThanOrEqual(6);
    await clear(page);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), map))
      .toBeLessThanOrEqual(6);
  });

  test('is in the accent of the theme: another colour in the dark theme, and still round the point', async ({
    page,
  }) => {
    const light = await colours(page);
    await page.goto('/?theme=dark');
    await withData(page);
    const dark = await colours(page);
    expect(distance(light.accent, dark.accent)).toBeGreaterThan(40);
    const centre = await centreOn(page, POINTS[2] as [number, number]);
    await select(page, 'layer-1', 2);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), dark.accent))
      .toBeLessThanOrEqual(6);
    // The ring outside it is the light text of the dark theme.
    expect(distance(await pixelAt(page, centre, 7, 0), dark.ink)).toBeLessThanOrEqual(6);
  });

  test('is not drawn for a layer that is hidden, or a selection of a layer that is not there, and comes back with the layer', async ({
    page,
  }) => {
    const { accent, map } = await colours(page);
    const centre = await centreOn(page, POINTS[2] as [number, number]);
    await select(page, 'layer-1', 2);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), accent))
      .toBeLessThanOrEqual(6);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), map))
      .toBeLessThanOrEqual(6);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: true });
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 5, 0), accent))
      .toBeLessThanOrEqual(6);
  });
});

/** The two lines of `lines.csv` (EPSG:32640): A has three vertices, B two (60 east and 60 north: a line at 45 degrees). */
const B = [
  [500200, 2765000],
  [500260, 2765060],
] as const;

test.describe('the outline of the selected line, polygon, cell and block', () => {
  test('is round a line as it is picked: a ribbon of 8 pixels, the ring at its edge, and the line itself as it was', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const { accent, ink, map } = await colours(page);
    const centre = await centreOn(page, [(B[0][0] + B[1][0]) / 2, (B[0][1] + B[1][1]) / 2]);
    const own = await pixelAt(page, centre, 0, 0);
    await select(page, 'layer-1', 1);
    // The line goes up and to the right at 45 degrees; its normal is up and to the left. It is 2 pixels wide, so 1.5 from its middle to the edge of what
    // is drawn: the ring is the 3 pixels after that (to 4.5), the edge of the colour of the text the 1.5 after (to 6). A pixel 2 along the normal is
    // 2.8 from the line, one 4 along 5.7, one 8 along 11.3.
    await expect
      .poll(async () => distance(await pixelAt(page, centre, -2, 2), accent))
      .toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, 2, -2), accent)).toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, -4, 4), ink)).toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, -8, 8), map)).toBeLessThanOrEqual(6);
    expect(await pixelAt(page, centre, 0, 0)).toEqual(own);
  });

  test('is round a polygon, outside its outline, over what is next to it, and the polygon is as it was', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, {
      name: 'squares.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [500000, 2765000],
                    [500100, 2765000],
                    [500100, 2765100],
                    [500000, 2765100],
                    [500000, 2765000],
                  ],
                ],
              },
            },
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [500200, 2765000],
                    [500300, 2765000],
                    [500300, 2765100],
                    [500200, 2765100],
                    [500200, 2765000],
                  ],
                ],
              },
            },
          ],
        }),
      ),
    });
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const { accent, map } = await colours(page);
    // The second polygon is 100 metres across: 200 pixels at half a metre a pixel, its edge 100 pixels from its middle. Its outline is a pixel wide, so what
    // is drawn reaches 101 pixels from the middle; the ring is the 3 pixels after that.
    const centre = await centreOn(page, [500_250, 2_765_050], 0.5);
    const own = await pixelAt(page, centre, 0, 0);
    await select(page, 'layer-1', 1);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 103, 0), accent))
      .toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, 0, 103), accent)).toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, -103, 0), accent)).toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, 112, 0), map)).toBeLessThanOrEqual(6);
    expect(await pixelAt(page, centre, 0, 0)).toEqual(own);
    // The other polygon is not outlined.
    await select(page, 'layer-1', 0);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 103, 0), map))
      .toBeLessThanOrEqual(6);
  });

  test('is round a cell of a grid, outside its edge, over the cells next to it, and the cell is as it was', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadLattice(page, 'grid', {
      name: 'cells',
      crs: { kind: 'epsg', code: 32640 },
      origin: [500_000, 2_765_000, 0],
      spacing: [10, 10, 1],
      dims: [4, 3, 1],
      values: Array.from({ length: 12 }, (_, n) => n),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const { accent } = await colours(page);
    // The cell (1, 1) is 20 pixels across at half a metre a pixel; the middle of it is at (15, 15) from the corner.
    const centre = await centreOn(page, [500_015, 2_765_015], 0.5);
    const own = await pixelAt(page, centre, 0, 0);
    await select(page, 'layer-1', 1 * 4 + 1);
    // The edge of the cell is 10 pixels from its middle: the ring is the next 3, the edge of the colour of the text the 1.5 after.
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 12, 0), accent))
      .toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, -12, 0), accent)).toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, 0, 12), accent)).toBeLessThanOrEqual(6);
    expect(distance(await pixelAt(page, centre, 0, -12), accent)).toBeLessThanOrEqual(6);
    expect(await pixelAt(page, centre, 0, 0)).toEqual(own);
    // Not round the cells next to it that are not selected: the neighbour's far side is its own colour.
    expect(distance(await pixelAt(page, centre, 22, 0), accent)).toBeGreaterThan(20);
  });

  test('is round a block, as the camera sees it, in 3D too', async ({ page }) => {
    await page.goto('/?theme=light');
    await loadLattice(page, 'blocks', {
      name: 'model',
      crs: { kind: 'epsg', code: 32640 },
      origin: [500_000, 2_765_000, 0],
      spacing: [10, 10, 5],
      dims: [4, 3, 2],
      values: Array.from({ length: 24 }, (_, n) => n),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    const { accent } = await colours(page);
    // From above, the block (1, 1, 1) is a square 20 pixels across at half a metre a pixel.
    const centre = await centreOn(page, [500_015, 2_765_015], 0.5);
    const own = await pixelAt(page, centre, 0, 0);
    await select(page, 'layer-1', 1 * 12 + 1 * 4 + 1);
    await expect
      .poll(async () => distance(await pixelAt(page, centre, 12, 0), accent))
      .toBeLessThanOrEqual(6);
    // The layer is drawn as it was while its outline is: its pick materials are put back after each outline.
    expect(await pixelAt(page, centre, 0, 0)).toEqual(own);
    expect(await pixelAt(page, centre, -20, 0)).not.toEqual(own);
    // In 3D, from the south: the outline is round the part of the model that the camera sees of it.
    await dispatch(
      page,
      {
        type: 'setCamera',
        patch: {
          camera3d: {
            target: [500_015, 2_765_015, 7.5],
            distance: 80,
            heading: 0,
            elevation: 50,
            fov: 45,
          },
        },
      },
      { type: 'setViewMode', mode: '3d' },
    );
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    const now = await drawn(page);
    const frame = await sceneFrame(page);
    const at = pixelOf3d(now, frame?.origin ?? [0, 0, 0], [500_015, 2_765_015, 10]);
    if (at === undefined) throw new Error('The block is behind the camera.');
    // Some pixels of the ring are round the block, wherever it is: the accent is in the picture near it and not far from it.
    const near = await around(page, at.x, at.y, 40);
    const inRing = near.all().filter(([, , pixel]) => distance(pixel, accent) <= 6);
    expect(inRing.length).toBeGreaterThan(40);
    const far = await around(page, Math.min(now.width - 2, at.x + 150), at.y, 20);
    expect(far.all().filter(([, , pixel]) => distance(pixel, accent) <= 6)).toHaveLength(0);
  });
});
