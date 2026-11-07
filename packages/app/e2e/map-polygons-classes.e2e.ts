import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  around,
  camera,
  dispatch,
  distance,
  drawn,
  layerStatuses,
  stats,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

const FIRST = [0x44, 0x01, 0x54];
const LAST = [0xfd, 0xe7, 0x25];

/**
 * Three squares of 40 m in a row, 60 m apart, in UTM zone 40, from west to east: of a grade of 1, 5 and none, so that of 5 classes of equal
 * intervals the first is the first class and the second the last, and the third has no class.
 */
const square = (name: string, east: number, grade: number | null) => ({
  type: 'Feature',
  properties: { name, grade },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [east, 2765000],
        [east + 40, 2765000],
        [east + 40, 2765040],
        [east, 2765040],
        [east, 2765000],
      ],
    ],
  },
});
const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
  features: [square('A', 500000, 1), square('B', 500060, 5), square('C', 500120, null)],
});
const SQUARES = { A: 500020, B: 500080, C: 500140 } as const;

async function loadSquares(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, {
    name: 'graded.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(GEOJSON),
  });
  await drawn(page);
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

async function mapColour(page: Page): Promise<number[]> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const text = getComputedStyle(element).backgroundColor;
    return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
  });
}

/** Looks at the middle of the squares at a metre to a pixel. */
async function look(page: Page): Promise<{ width: number; height: number; ratio: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [500080, 2765020], unitsPerPixel: 1, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio };
}

/** The colour at the middle of a square, given by its east, and at its edge (the outline), 20 metres from the middle. */
async function colourAt(
  page: Page,
  view: { width: number; height: number; ratio: number },
  east: number,
  across = 0,
): Promise<number[]> {
  const x = Math.floor(view.width / 2 + (east - 500080 + across) * view.ratio);
  const y = Math.floor(view.height / 2);
  return (await around(page, x, y, 0)).at(0, 0);
}

/** `layer` at `alpha` over `under`. */
const over = (layer: readonly number[], alpha: number, under: readonly number[]): number[] =>
  layer.slice(0, 3).map((c, i) => c * alpha + (under[i] ?? 0) * (1 - alpha));

const BY = (column: string, classes: number) => ({
  mode: 'classes',
  column,
  method: 'equal',
  classes,
  ramp: 'viridis',
  reverse: false,
});

test.describe('the polygons layer coloured by classes', () => {
  test('fills each polygon at the opacity of the layer in the colour of its class, outlines it in that colour, and draws nothing for one with no value', async ({
    page,
  }) => {
    await loadSquares(page);
    const view = await look(page);
    const map = await mapColour(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('grade', 5) },
    });
    // The default opacity of a polygon is 0.6: the first colour, and the last, over the map.
    await expect
      .poll(async () => distance(await colourAt(page, view, SQUARES.A), over(FIRST, 0.6, map)))
      .toBeLessThanOrEqual(2);
    expect(
      distance(await colourAt(page, view, SQUARES.B), over(LAST, 0.6, map)),
    ).toBeLessThanOrEqual(2);
    // The outline is the colour of the class, not transparent, and over the fill: across the west edge of A, whose class is the first and whose
    // colour is the darkest, the pixel that the outline covers most is darker than the fill is (a fill drawn over its outline would be paler).
    const filled = over(FIRST, 0.6, map);
    const edge = await Promise.all(
      [-21, -20, -19].map((across) => colourAt(page, view, SQUARES.A, across)),
    );
    expect(Math.min(...edge.map((px) => px[0] ?? 255))).toBeLessThanOrEqual((filled[0] ?? 0) - 25);
    // And the outline of B, which is the last colour, is as green as the colour and not as the layer's own orange would leave it.
    const strongest = (
      await Promise.all([-21, -20, -19].map((across) => colourAt(page, view, SQUARES.B, across)))
    ).reduce((a, b) => ((a[2] ?? 0) <= (b[2] ?? 0) ? a : b));
    expect(strongest[1]).toBeGreaterThanOrEqual(225);
    // (The fill is as green: what tells the outline from it is that it is not blended with the map, so it has less blue than the fill has.)
    expect(strongest[2]).toBeLessThanOrEqual((over(LAST, 0.6, map)[2] ?? 0) - 25);
    // C has no value: nothing of it, inside or on its edge, is not the map.
    for (const across of [-22, -21, -20, -19, -18, 0, 18, 19, 20, 21, 22]) {
      expect(await colourAt(page, view, SQUARES.C, across), `across ${String(across)}`).toEqual(
        map,
      );
    }
  });

  test('is the colour of the layer again in one colour, and draws the polygon that had no value', async ({
    page,
  }) => {
    await loadSquares(page);
    const view = await look(page);
    const map = await mapColour(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('grade', 5) },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, SQUARES.A), over(FIRST, 0.6, map)))
      .toBeLessThanOrEqual(2);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    for (const east of [SQUARES.A, SQUARES.B, SQUARES.C]) {
      await expect
        .poll(async () => distance(await colourAt(page, view, east), over([0, 114, 178], 0.6, map)))
        .toBeLessThanOrEqual(2);
    }
  });

  test('changes the colours with the ramp, without the engine: the same layer and geometry count', async ({
    page,
  }) => {
    await loadSquares(page);
    const view = await look(page);
    const map = await mapColour(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('grade', 5) },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, SQUARES.B), over(LAST, 0.6, map)))
      .toBeLessThanOrEqual(2);
    const before = await stats(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...BY('grade', 5), reverse: true } },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, SQUARES.B), over(FIRST, 0.6, map)))
      .toBeLessThanOrEqual(2);
    const after = await drawn(page);
    expect([after.layers, after.geometries]).toEqual([before?.layers, before?.geometries]);
  });
});
