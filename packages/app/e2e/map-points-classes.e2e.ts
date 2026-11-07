import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  around,
  bytes,
  camera,
  dispatch,
  distance,
  drawn,
  layerColour,
  stats,
  withData,
} from './support/render.js';

/** The last colour of viridis: the class of the highest values of a column. */
const LAST = [0xfd, 0xe7, 0x25];

/** The 8 points of `points.csv` (easting, northing), the rock of each, and its `Au_ppm` ('' for no value, which is the fifth). */
const POINTS = [
  { at: [500010.5, 2765020.25], rock: 'granite', au: '0.35' },
  { at: [500035.0, 2765044.75], rock: 'granite', au: '1.20' },
  { at: [500060.5, 2765071.0], rock: 'basalt', au: '-999' },
  { at: [500082.0, 2765099.5], rock: 'basalt', au: '0.07' },
  { at: [500110.25, 2765120.0], rock: 'schist', au: '' },
  { at: [500135.0, 2765151.5], rock: 'schist', au: '2.45' },
  { at: [500160.75, 2765178.0], rock: 'granite', au: '0.90' },
  { at: [500185.5, 2765205.25], rock: 'basalt', au: '0.00' },
] as const;

async function mapColour(page: Page): Promise<number[]> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const text = getComputedStyle(element).backgroundColor;
    return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
  });
}

/** Where the point `n` is in the buffer, for the camera the first view of the data made. */
async function pixelOfPoint(page: Page, n: number): Promise<{ x: number; y: number }> {
  const view = await camera(page);
  const now = await drawn(page);
  const [east = 0, north = 0] = POINTS[n]?.at ?? [];
  return {
    x: Math.floor(now.width / 2 + ((east - view.centre[0]) / view.unitsPerPixel) * now.pixelRatio),
    y: Math.floor(
      now.height / 2 + ((north - view.centre[1]) / view.unitsPerPixel) * now.pixelRatio,
    ),
  };
}

/** The colour at the middle of the marker of the point `n`. */
async function colourOfPoint(page: Page, n: number): Promise<number[]> {
  const p = await pixelOfPoint(page, n);
  return (await around(page, p.x, p.y, 0)).at(0, 0);
}

/** The pixels of a block round the point `n` that are not the map: nothing is there if the point is not drawn. */
async function inkAround(page: Page, n: number): Promise<number> {
  const p = await pixelOfPoint(page, n);
  const map = await mapColour(page);
  return (await around(page, p.x, p.y, 5)).all().filter(([, , px]) => distance(px, map) > 2).length;
}

async function style(page: Page, patch: object): Promise<void> {
  const current = await page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { layers: Record<string, { style: { colour: object } }> };
    };
    return viewer.scene().layers['layer-1']?.style.colour ?? {};
  });
  await dispatch(page, {
    type: 'setStyle',
    layerId: 'layer-1',
    patch: { colour: { ...current, ...patch } },
  });
}

const BY = (column: string, method: string, classes: number) => ({
  mode: 'classes',
  column,
  method,
  classes,
  ramp: 'viridis',
  reverse: false,
});

test.describe('the points layer coloured by classes', () => {
  test('colours each point by the class of its value: points of one rock are one colour and the rocks differ', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await withData(page);
    // The colour the points have before, as the layer's: it is not in the style once the style is by classes.
    const own = bytes(await layerColour(page));
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('Rock', 'categories', 3) },
    });
    await expect
      .poll(async () => {
        const first = await colourOfPoint(page, 0);
        const last = await colourOfPoint(page, 1);
        return distance(first, last);
      })
      .toBeLessThanOrEqual(1);
    const rocks = new Map<string, number[]>();
    for (const [n, point] of POINTS.entries()) {
      const colour = await colourOfPoint(page, n);
      const known = rocks.get(point.rock);
      if (known === undefined) {
        rocks.set(point.rock, colour);
      } else {
        expect(distance(colour, known), `point ${String(n)} of ${point.rock}`).toBeLessThanOrEqual(
          1,
        );
      }
    }
    const [granite = [], basalt = [], schist = []] = [
      rocks.get('granite'),
      rocks.get('basalt'),
      rocks.get('schist'),
    ];
    expect(distance(granite, basalt)).toBeGreaterThan(40);
    expect(distance(granite, schist)).toBeGreaterThan(40);
    expect(distance(basalt, schist)).toBeGreaterThan(40);
    // And none of them is the colour of the layer, which the points had before.
    for (const colour of [granite, basalt, schist]) {
      expect(distance(colour, own)).toBeGreaterThan(20);
    }
  });

  test('does not draw a point that has no value, and draws the highest value in the last colour', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await withData(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('Au_ppm', 'equal', 5) },
    });
    // The fifth point has no value (an empty cell) and is not drawn; the sixth has the highest.
    await expect.poll(async () => inkAround(page, 4)).toBe(0);
    expect(distance(await colourOfPoint(page, 5), LAST)).toBeLessThanOrEqual(2);
    // The others are drawn, whatever the file does with its -999.
    expect(await inkAround(page, 0)).toBeGreaterThan(0);
    expect(await inkAround(page, 3)).toBeGreaterThan(0);
  });

  test('changes the colours with the ramp, without the engine: the same layer and geometry', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await withData(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('Au_ppm', 'equal', 5) },
    });
    await expect
      .poll(async () => distance(await colourOfPoint(page, 5), LAST))
      .toBeLessThanOrEqual(2);
    const before = await stats(page);
    await style(page, { reverse: true });
    // The highest is the first colour of the ramp now.
    await expect
      .poll(async () => distance(await colourOfPoint(page, 5), [0x44, 0x01, 0x54]))
      .toBeLessThanOrEqual(2);
    const after = await drawn(page);
    expect([after.layers, after.geometries]).toEqual([before?.layers, before?.geometries]);
  });

  test('is the colour of the layer again in one colour, and takes the opacity either way', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await withData(page);
    const own = bytes(await layerColour(page));
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: BY('Rock', 'categories', 3) },
    });
    await expect.poll(async () => distance(await colourOfPoint(page, 0), own)).toBeGreaterThan(20);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#e69f00' } },
    });
    await expect
      .poll(async () => distance(await colourOfPoint(page, 0), [0xe6, 0x9f, 0x00]))
      .toBeLessThanOrEqual(2);
    // The point that had no value is drawn again.
    expect(await inkAround(page, 4)).toBeGreaterThan(0);
  });
});
