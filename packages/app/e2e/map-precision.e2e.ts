import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { around, camera, dispatch, distance, drawn, layerStatuses } from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/**
 * Section 9.1 of the brief: every position that goes to the card is relative to an origin near the data, as a 32-bit number, so that
 * within 100,000 map units of the origin positions keep at least 1 cm, and points 1 cm apart at UTM-sized numbers stay apart when
 * zoomed in. These are files of points at the numbers of UTM zone 40, 100 m and 50 km from where the origin is.
 */
const point = (east: number, north: number) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: [east, north] },
});
const file = (points: readonly (readonly [number, number])[]) => ({
  name: 'precise.geojson',
  mimeType: 'application/geo+json',
  buffer: Buffer.from(
    JSON.stringify({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
      features: points.map(([east, north]) => point(east, north)),
    }),
  ),
});

async function load(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, file(points));
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

/** Makes the markers `size` pixels, the least there is for the pair and bigger for the one that is followed. */
async function markers(page: Page, size: number): Promise<void> {
  await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { pointSize: size } });
}

/** Looks at `centre` at `scale` metres a pixel, and waits for it to be so. */
async function look(
  page: Page,
  centre: readonly [number, number],
  scale: number,
): Promise<{ width: number; height: number; ratio: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre, unitsPerPixel: scale, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - scale) / scale)
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio };
}

/** The runs of marked pixels along the row through the middle of the map, within `reach` pixels of it, as `[first, last]` offsets from the middle. */
async function runs(
  page: Page,
  view: { width: number; height: number },
  reach: number,
): Promise<[number, number][]> {
  const map = await mapColour(page);
  const row = (await around(page, Math.floor(view.width / 2), Math.floor(view.height / 2), reach))
    .all()
    .filter(([, dy]) => dy === 0)
    .map(([dx, , px]) => ({ dx, marked: distance(px, map) > 8 }));
  const found: [number, number][] = [];
  for (const { dx, marked } of row) {
    const last = found.at(-1);
    if (marked && last !== undefined && last[1] === dx - 1) {
      last[1] = dx;
    } else if (marked) {
      found.push([dx, dx]);
    }
  }
  return found;
}

test.describe('precision of the positions on the card', () => {
  test('keeps two points 1 cm apart at the numbers of UTM apart when zoomed in to a millimetre a pixel', async ({
    page,
  }) => {
    await load(page, [
      [500_123.45, 2_765_432.1],
      [500_123.46, 2_765_432.1],
      // Two more, 100 m away, so that the origin is not on these two.
      [500_000, 2_765_000],
      [500_200, 2_765_500],
    ]);
    await markers(page, 2);
    const view = await look(page, [500_123.455, 2_765_432.1], 0.001);
    const found = await runs(page, view, 20);
    // Two markers of a few pixels, 10 pixels between their middles, with map between them.
    expect(found).toHaveLength(2);
    const [first, second] = found;
    const middles = [
      ((first?.[0] ?? 0) + (first?.[1] ?? 0)) / 2,
      ((second?.[0] ?? 0) + (second?.[1] ?? 0)) / 2,
    ];
    expect((middles[1] ?? 0) - (middles[0] ?? 0)).toBeGreaterThanOrEqual(9);
    expect((middles[1] ?? 0) - (middles[0] ?? 0)).toBeLessThanOrEqual(11);
    // The gap between them is map.
    expect((second?.[0] ?? 0) - (first?.[1] ?? 0)).toBeGreaterThanOrEqual(5);
  });

  test('keeps them apart 50 km from the origin, where a 32-bit number is a few millimetres', async ({
    page,
  }) => {
    // The data is 100 km across, so the origin is in the middle, and the pair is at the east end, 50 km from it.
    await load(page, [
      [450_000, 2_765_000],
      [549_999.99, 2_765_000],
      [550_000, 2_765_000],
    ]);
    await markers(page, 2);
    const view = await look(page, [549_999.995, 2_765_000], 0.001);
    const found = await runs(page, view, 20);
    expect(found).toHaveLength(2);
    const [first, second] = found;
    // A number of that size has about 4 mm between the ones it can be: the nearest to 49,999.99 is 49,999.98828125, so the 10 mm are 11.7 mm on the card, and they are apart.
    const apart =
      ((second?.[0] ?? 0) + (second?.[1] ?? 0)) / 2 - ((first?.[0] ?? 0) + (first?.[1] ?? 0)) / 2;
    expect(apart).toBeGreaterThanOrEqual(6);
    expect(apart).toBeLessThanOrEqual(13);
  });

  test('moves a marker as far as the camera moves, a fifth of a pixel at a time, with no jitter', async ({
    page,
  }) => {
    await load(page, [
      [500_123.45, 2_765_432.1],
      [500_000, 2_765_000],
      [500_200, 2_765_500],
    ]);
    await markers(page, 12);
    const map = await mapColour(page);
    const steps = 20;
    const centroids: number[] = [];
    for (let step = 0; step < steps; step += 1) {
      // The camera moves east by a fifth of a pixel (0.2 mm) each time, so the marker moves west by as much on the screen.
      const view = await look(page, [500_123.45 + step * 0.0002, 2_765_432.1], 0.001);
      const x = Math.floor(view.width / 2);
      const y = Math.floor(view.height / 2);
      const block = await around(page, x, y, 12);
      let weight = 0;
      let moment = 0;
      for (const [dx, , px] of block.all()) {
        const w = distance(px, map) / 255;
        weight += w;
        moment += w * dx;
      }
      centroids.push(moment / weight);
    }
    // The centre of the marker (weighted by how much of each pixel is ink) moves by a fifth of a pixel a step, west.
    const moved = (centroids.at(-1) ?? 0) - (centroids[0] ?? 0);
    expect(moved).toBeGreaterThan(-4.4);
    expect(moved).toBeLessThan(-3.6);
    for (let i = 1; i < centroids.length; i += 1) {
      const step = (centroids[i] ?? 0) - (centroids[i - 1] ?? 0);
      // Each step is about -0.2, never forward and never more than half a pixel: a marker that jumped would show here.
      expect(step, `step ${String(i)}`).toBeLessThan(0.05);
      expect(step, `step ${String(i)}`).toBeGreaterThan(-0.5);
    }
  });
});
