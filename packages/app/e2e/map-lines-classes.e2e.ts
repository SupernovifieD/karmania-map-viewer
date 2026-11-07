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
 * Three lines of 100 m, 50 m apart, from south to north, as GeoJSON in UTM zone 40: A of a grade of 1, B of 5, and C of none (a null), so
 * that of 5 classes of equal intervals A is the first and B the last, and C has no class.
 */
const line = (name: string, north: number, grade: number | null) => ({
  type: 'Feature',
  properties: { name, grade },
  geometry: {
    type: 'LineString',
    coordinates: [
      [500000, north],
      [500100, north],
    ],
  },
});
const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
  features: [line('A', 2765000, 1), line('B', 2765050, 5), line('C', 2765100, null)],
});

const LINES = { A: 0, B: 50, C: 100 } as const;

async function loadLines(page: Page): Promise<void> {
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

/** Looks at the middle of the lines at a metre to a pixel. */
async function look(page: Page): Promise<{ width: number; height: number; ratio: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [500050, 2765050], unitsPerPixel: 1, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio };
}

/** The pixels of a block round the middle of the line at `north` metres above the first, as `[r, g, b, a]` each. */
async function blockOf(
  page: Page,
  view: { width: number; height: number; ratio: number },
  north: number,
) {
  const x = Math.floor(view.width / 2);
  const y = Math.floor(view.height / 2 + (north - 50) * view.ratio);
  return (await around(page, x, y, 3)).all().map(([, , px]) => px);
}

/** How near any pixel of `block` gets to `colour`. */
const nearest = (block: readonly (readonly number[])[], colour: readonly number[]): number =>
  Math.min(...block.map((px) => distance(px, colour)));

async function style(page: Page, colour: object): Promise<void> {
  await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { colour } });
}

const BY = (column: string, classes: number) => ({
  mode: 'classes',
  column,
  method: 'equal',
  classes,
  ramp: 'viridis',
  reverse: false,
});

test.describe('the lines layer coloured by classes', () => {
  test('colours each line by the class of its value, and draws no line that has no value', async ({
    page,
  }) => {
    await loadLines(page);
    const view = await look(page);
    const map = await mapColour(page);
    await style(page, BY('grade', 5));
    await expect
      .poll(async () => nearest(await blockOf(page, view, LINES.A), FIRST))
      .toBeLessThanOrEqual(2);
    expect(nearest(await blockOf(page, view, LINES.B), LAST)).toBeLessThanOrEqual(2);
    // C has no value: not a pixel of its block is not the map.
    const none = await blockOf(page, view, LINES.C);
    expect(none.filter((px) => distance(px, map) > 2)).toEqual([]);
  });

  test('is the colour of the layer again in one colour, and draws the line that had no value', async ({
    page,
  }) => {
    await loadLines(page);
    const view = await look(page);
    await style(page, BY('grade', 5));
    await expect
      .poll(async () => nearest(await blockOf(page, view, LINES.A), FIRST))
      .toBeLessThanOrEqual(2);
    await style(page, { mode: 'single', value: '#009e73' });
    for (const north of [LINES.A, LINES.B, LINES.C]) {
      await expect
        .poll(async () => nearest(await blockOf(page, view, north), [0, 0x9e, 0x73]))
        .toBeLessThanOrEqual(2);
    }
  });

  test('changes the colours with the ramp, without the engine: the same layer and geometry', async ({
    page,
  }) => {
    await loadLines(page);
    const view = await look(page);
    await style(page, BY('grade', 5));
    await expect
      .poll(async () => nearest(await blockOf(page, view, LINES.B), LAST))
      .toBeLessThanOrEqual(2);
    const before = await stats(page);
    await style(page, { ...BY('grade', 5), reverse: true });
    await expect
      .poll(async () => nearest(await blockOf(page, view, LINES.B), FIRST))
      .toBeLessThanOrEqual(2);
    const after = await drawn(page);
    expect([after.layers, after.geometries]).toEqual([before?.layers, before?.geometries]);
  });
});
