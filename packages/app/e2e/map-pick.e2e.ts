/**
 * Picking (step 21.1): which element of which layer is at a point of the map, read back from a pass that draws the layers a second time with
 * what they are written as. The points of `points.csv` are put at known pixels, and what is picked there, near there and away from there is
 * what the drawing says.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
import { fixturePath } from './support/picker.js';
import {
  camera,
  dispatch,
  drawn,
  layerStatuses,
  pickAt,
  pixels,
  withData,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/** The points of `points.csv`: easting and northing in the file's own coordinates (EPSG:32640), in the order of the file (element 0 first). */
const POINTS = readFileSync(fixturePath('points.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.split(',').slice(0, 2).map(Number) as [number, number]);

/**
 * Puts the camera so that point `index` is `right` pixels to the right of and `up` pixels above the middle of the map, at `scale` map units a
 * pixel and `heading`; gives where it is as a point of the map (CSS pixels from the top left, the middle of its pixel).
 */
async function place(
  page: Page,
  index: number,
  options: { right?: number; up?: number; scale?: number; heading?: number } = {},
): Promise<{ x: number; y: number }> {
  const { right = 0, up = 0, scale = 1, heading = 0 } = options;
  const turn = (heading * Math.PI) / 180;
  const offset = [
    (right * Math.cos(turn) + up * Math.sin(turn)) * scale,
    (-right * Math.sin(turn) + up * Math.cos(turn)) * scale,
  ];
  const at = POINTS[index] as [number, number];
  await dispatch(page, {
    type: 'setCamera',
    patch: {
      camera2d: {
        centre: [at[0] - (offset[0] ?? 0), at[1] - (offset[1] ?? 0)],
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
    x: (Math.floor(now.width / 2 + right * ratio) + 0.5) / ratio,
    y: (now.height - Math.floor(now.height / 2 + up * ratio) - 0.5) / ratio,
  };
}

test.describe('picking points', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
  });

  test('says which point is under the pointer, counted from 0 as the file has them, and which layer it is of', async ({
    page,
  }) => {
    for (const index of [0, 1, 4, POINTS.length - 1]) {
      const spot = await place(page, index, { right: 20, up: 10 });
      expect(await pickAt(page, spot.x, spot.y), `point ${String(index)}`).toEqual({
        layerId: 'layer-1',
        element: index,
      });
    }
  });

  test('is a little larger than the point: a few pixels off it still picks it, and further off picks nothing', async ({
    page,
  }) => {
    const spot = await place(page, 2, { right: 0, up: 0 });
    // The marker is 6 pixels and what is picked 12: a pixel at 5 away is in, one at 9 is not.
    expect((await pickAt(page, spot.x + 5, spot.y))?.element).toBe(2);
    expect((await pickAt(page, spot.x, spot.y - 5))?.element).toBe(2);
    expect(await pickAt(page, spot.x + 9, spot.y)).toBeNull();
    expect(await pickAt(page, spot.x - 9, spot.y + 9)).toBeNull();
  });

  test('is where the point is drawn when the map is turned, and nothing where it would be if it were not', async ({
    page,
  }) => {
    // 90 degrees: the top faces east, so a point that is 100 pixels east of the middle is 100 pixels above it.
    const spot = await place(page, 3, { right: 0, up: 100, heading: 90 });
    expect((await pickAt(page, spot.x, spot.y))?.element).toBe(3);
    const now = await drawn(page);
    expect(await pickAt(page, now.cssWidth / 2 + 100, now.cssHeight / 2)).toBeNull();
  });

  test('is the point whose middle is nearest when two are within reach of the pointer', async ({
    page,
  }) => {
    // Points 0 and 1 are 34.6 metres apart: at 4 metres a pixel, about 8.7 pixels, so the two are within each other's reach.
    const first = await place(page, 0, { scale: 4 });
    expect((await pickAt(page, first.x, first.y))?.element).toBe(0);
    // The second is up and to the right of the first: 2 pixels along the way to it is still the first (it is nearer); 6 pixels, the second is.
    const unit = Math.SQRT1_2;
    expect((await pickAt(page, first.x + 2 * unit, first.y - 2 * unit))?.element).toBe(0);
    expect((await pickAt(page, first.x + 6 * unit, first.y - 6 * unit))?.element).toBe(1);
  });

  test('does not pick a layer that is hidden, and picks it again when it is shown', async ({
    page,
  }) => {
    const spot = await place(page, 1);
    expect((await pickAt(page, spot.x, spot.y))?.element).toBe(1);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    expect(await pickAt(page, spot.x, spot.y)).toBeNull();
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: true });
    expect((await pickAt(page, spot.x, spot.y))?.element).toBe(1);
  });

  test('is nothing outside the map or where the point is not a number, and leaves the map as it was', async ({
    page,
  }) => {
    const now = await drawn(page);
    expect(await pickAt(page, -5, 10)).toBeNull();
    expect(await pickAt(page, now.cssWidth + 5, 10)).toBeNull();
    expect(await pickAt(page, 10, now.cssHeight + 5)).toBeNull();
    expect(await pickAt(page, Number.NaN, 10)).toBeNull();
    // Picking draws into a target of its own: the map that is on the screen is the map that was (the middle of it, where the point is put).
    const spot = await place(page, 1);
    const middle: [number, number, number, number] = [
      Math.floor(now.width / 2) - 40,
      Math.floor(now.height / 2) - 40,
      80,
      80,
    ];
    const before = await pixels(page, middle);
    expect(before.some((byte, i) => i % 4 === 0 && byte !== before[0])).toBe(true);
    expect((await pickAt(page, spot.x, spot.y))?.element).toBe(1);
    expect(await pixels(page, middle)).toEqual(before);
  });

  test('numbers the points of a layer that is put on the card in several parts from 0 over all of them', async ({
    page,
  }) => {
    // 100,500 points: the first part holds 100,000 (`POINTS_PER_PART`), so the last 500 are in a second, and their numbers go on from it.
    const total = 100_500;
    const status = await page.evaluate((n) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        load(input: unknown): Promise<{ status: string }>;
      };
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        x[i] = 510_000 + (i % 1000) * 2;
        y[i] = 2_765_000 + Math.floor(i / 1000) * 2;
      }
      return viewer.load({
        kind: 'points',
        name: 'Many',
        crs: { kind: 'epsg', code: 32640 },
        x,
        y,
        columns: [],
      });
    }, total);
    expect(status.status).toBe('loaded');
    const find = async (index: number): Promise<number | undefined> => {
      // Point `index` is at column index % 1000 and row floor(index / 1000).
      await dispatch(page, {
        type: 'setCamera',
        patch: {
          camera2d: {
            centre: [510_000 + (index % 1000) * 2, 2_765_000 + Math.floor(index / 1000) * 2],
            unitsPerPixel: 1,
            heading: 0,
          },
        },
      });
      const now = await drawn(page);
      return (await pickAt(page, now.cssWidth / 2, now.cssHeight / 2))?.element;
    };
    // The layer is built over several frames: the last point is there when it is all built.
    await expect.poll(async () => find(total - 1), { timeout: 30_000 }).toBe(total - 1);
    expect(await find(0)).toBe(0);
    expect(await find(99_999)).toBe(99_999);
    expect(await find(100_000)).toBe(100_000);
    expect(await find(54_321)).toBe(54_321);
  });

  test('does not pick a point that has no value in the classes the layer is coloured by, as it is not drawn', async ({
    page,
  }) => {
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'Au_ppm',
          method: 'equal',
          classes: 5,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    // The fifth point (element 4) has no value: it is not drawn, and the sixth is.
    const empty = await place(page, 4);
    await expect.poll(async () => pickAt(page, empty.x, empty.y)).toBeNull();
    const drawnOne = await place(page, 5);
    expect((await pickAt(page, drawnOne.x, drawnOne.y))?.element).toBe(5);
    // In one colour again it is there.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#e69f00' } },
    });
    const back = await place(page, 4);
    await expect.poll(async () => (await pickAt(page, back.x, back.y))?.element).toBe(4);
  });
});

/** The two lines of `lines.csv` (EPSG:32640): A has the vertices 0, 1 and 2, B the vertices 3 and 4; A is element 0 and B element 1. */
const A = [
  [500000, 2765000],
  [500050, 2765040],
  [500100, 2765100],
] as const;
const B = [
  [500200, 2765000],
  [500260, 2765060],
] as const;

test.describe('picking lines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  });

  /**
   * Looks at the map point `at` with it in the middle of the map at `scale` and `heading`, and says what is picked `right` pixels to the right
   * of and `up` pixels above it.
   */
  async function pickNear(
    page: Page,
    at: readonly [number, number],
    offset: { right?: number; up?: number; scale?: number; heading?: number } = {},
  ): Promise<{ layerId: string; element: number } | null> {
    const { right = 0, up = 0, scale = 1, heading = 0 } = offset;
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [at[0], at[1]], unitsPerPixel: scale, heading } },
    });
    const now = await drawn(page);
    await expect
      .poll(async () => Math.abs((await camera(page)).unitsPerPixel - scale))
      .toBeLessThan(1e-9);
    return pickAt(page, now.cssWidth / 2 + right, now.cssHeight / 2 - up);
  }

  const middle = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];

  test('says which line is under the pointer, whichever of its segments, and at a vertex where two of them meet', async ({
    page,
  }) => {
    expect(await pickNear(page, middle(A[0], A[1]))).toEqual({ layerId: 'layer-1', element: 0 });
    expect(await pickNear(page, middle(A[1], A[2]))).toEqual({ layerId: 'layer-1', element: 0 });
    expect(await pickNear(page, A[1])).toEqual({ layerId: 'layer-1', element: 0 });
    expect(await pickNear(page, middle(B[0], B[1]))).toEqual({ layerId: 'layer-1', element: 1 });
    expect(await pickNear(page, B[1])).toEqual({ layerId: 'layer-1', element: 1 });
  });

  test('is a little wider than the line: a few pixels off it still picks it, and further off picks nothing', async ({
    page,
  }) => {
    // The first segment of A goes 50 east and 40 north, so its normal (to the left) is (-40, 50) / 64: the middle of the line seen from 3 pixels
    // to the left of it is on the line, and from 12 pixels is not.
    const from = middle(A[0], A[1]);
    const unit = [-40 / Math.hypot(40, 50), 50 / Math.hypot(40, 50)] as const;
    const off = (pixels: number): [number, number] => [
      from[0] - unit[0] * pixels,
      from[1] - unit[1] * pixels,
    ];
    // (The map is looked at from `off`, so the line is `pixels` away on the side of the normal: the pointer is in the middle of the map.)
    expect((await pickNear(page, off(3)))?.element).toBe(0);
    expect(await pickNear(page, off(8))).toBeNull();
    expect(await pickNear(page, off(-8))).toBeNull();
    expect((await pickNear(page, off(-3)))?.element).toBe(0);
  });

  test('is where the line is drawn when the map is turned', async ({ page }) => {
    // Turned a quarter: east is up. A point of B's segment 100 pixels east of the middle of the view, at scale 1, is 100 pixels above it.
    const at: [number, number] = [middle(B[0], B[1])[0] - 100, middle(B[0], B[1])[1]];
    expect((await pickNear(page, at, { up: 100, heading: 90 }))?.element).toBe(1);
    expect(await pickNear(page, at, { right: 100, heading: 90 })).toBeNull();
  });

  test('is the line nearer the pointer where two are within reach of it', async ({ page }) => {
    // A starts at (500000, 2765000) and B at (500200, 2765000): at 60 metres a pixel they are 3.3 pixels apart, within each other's reach. A pixel
    // to the right of the first and a pixel to the left of the second is nearer the first, and the other way round.
    const centre: [number, number] = [A[0][0], A[0][1]];
    expect((await pickNear(page, centre, { scale: 60, right: 1 }))?.element).toBe(0);
    expect((await pickNear(page, centre, { scale: 60, right: 2.4 }))?.element).toBe(1);
  });

  test('does not pick a layer that is hidden', async ({ page }) => {
    expect((await pickNear(page, middle(A[0], A[1])))?.element).toBe(0);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    expect(await pickNear(page, middle(A[0], A[1]))).toBeNull();
  });
});
