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
  loadLattice,
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

/** Three squares of 100 m in UTM zone 40 north, from the corner (500000, 2765000): the first has a hole, the second overlaps its top right corner. */
const SQUARES = JSON.stringify({
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
  features: [
    {
      type: 'Feature',
      properties: { name: 'First', value: 1 },
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
          [
            [500030, 2765030],
            [500030, 2765070],
            [500070, 2765070],
            [500070, 2765030],
            [500030, 2765030],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Second', value: null },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [500080, 2765080],
            [500180, 2765080],
            [500180, 2765180],
            [500080, 2765180],
            [500080, 2765080],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Third', value: 3 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [500300, 2765000],
            [500400, 2765000],
            [500400, 2765100],
            [500300, 2765100],
            [500300, 2765000],
          ],
        ],
      },
    },
  ],
});

test.describe('picking polygons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, {
      name: 'squares.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(SQUARES),
    });
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  });

  const at = (east: number, north: number): [number, number] => [500000 + east, 2765000 + north];

  test('says which polygon is under the pointer, counted from 0 as the file has them', async ({
    page,
  }) => {
    expect(await pickNear(page, at(10, 10))).toEqual({ layerId: 'layer-1', element: 0 });
    expect((await pickNear(page, at(150, 150)))?.element).toBe(1);
    expect((await pickNear(page, at(350, 50)))?.element).toBe(2);
  });

  test('is the polygon that is drawn on top where two overlap: the one that comes later', async ({
    page,
  }) => {
    expect((await pickNear(page, at(90, 90)))?.element).toBe(1);
    // Just outside the second, still in the first.
    expect((await pickNear(page, at(70, 90)))?.element).toBe(0);
  });

  test('is nothing in a hole, nor between the polygons, but the polygon a few pixels beyond its edge, where its outline is', async ({
    page,
  }) => {
    // The hole is 40 metres across: its middle is 20 pixels from any edge, at a metre a pixel.
    expect(await pickNear(page, at(50, 50))).toBeNull();
    expect(await pickNear(page, at(200, 50))).toBeNull();
    // Beside the first polygon's left edge: 3 metres off is within the outline, 8 is not.
    expect((await pickNear(page, at(-3, 50)))?.element).toBe(0);
    expect(await pickNear(page, at(-8, 50))).toBeNull();
    // Across the edge of the hole, on the polygon's side and on the other.
    expect((await pickNear(page, at(27, 50)))?.element).toBe(0);
    expect((await pickNear(page, at(33, 50)))?.element).toBe(0);
  });

  test('is where the polygon is drawn when the map is turned', async ({ page }) => {
    const centre = at(350, 50);
    // A quarter turn: east is up, so a point 20 metres east of the view's middle is 20 pixels above it, and south is to the right: 80 pixels to the
    // right of the middle is 80 metres south of it, which is off the polygon (it spans 0 to 100 north of its corner, and the middle is 50 up).
    expect(
      (await pickNear(page, [centre[0] - 20, centre[1]], { up: 20, heading: 90 }))?.element,
    ).toBe(2);
    expect(
      await pickNear(page, [centre[0] - 20, centre[1]], { right: 80, heading: 90 }),
    ).toBeNull();
  });

  test('does not pick a polygon of a layer that is hidden', async ({ page }) => {
    expect((await pickNear(page, at(10, 10)))?.element).toBe(0);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    expect(await pickNear(page, at(10, 10))).toBeNull();
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: true });
    expect((await pickNear(page, at(10, 10)))?.element).toBe(0);
  });

  test('does not pick a polygon that has no value in the classes the layer is coloured by, as it is not drawn, and picks it when it is drawn again', async ({
    page,
  }) => {
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'value',
          method: 'equal',
          classes: 2,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    // The second polygon has no value: where it is alone nothing is picked, and where it overlaps the first it is the first that is.
    await expect.poll(async () => pickNear(page, at(150, 150))).toBeNull();
    expect((await pickNear(page, at(90, 90)))?.element).toBe(0);
    expect((await pickNear(page, at(10, 10)))?.element).toBe(0);
    expect((await pickNear(page, at(350, 50)))?.element).toBe(2);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#e69f00' } },
    });
    await expect.poll(async () => (await pickNear(page, at(150, 150)))?.element).toBe(1);
    expect((await pickNear(page, at(90, 90)))?.element).toBe(1);
  });
});

/** The vertices of a pyramid of a base of 100 m and a height of 40 m, and a plate at 100 m over part of one of its faces (UTM zone 40 north). */
const NORTH_ORIGIN = 2_765_000;
const EAST_ORIGIN = 500_000;
const SHAPES = [
  // The pyramid: the base corners and the apex.
  [0, 0, 0],
  [100, 0, 0],
  [100, 100, 0],
  [0, 100, 0],
  [50, 50, 40],
  // The plate, above the face that faces south.
  [30, 0, 100],
  [70, 0, 100],
  [70, 30, 100],
  [30, 30, 100],
] as const;
// The plate comes first, so that the faces of the pyramid under it come after it in the file and are drawn after it: what is on top is a matter of height.
const FACES = [
  [6, 7, 8],
  [6, 8, 9],
  [1, 2, 5],
  [2, 3, 5],
  [3, 4, 5],
  [4, 1, 5],
];

test.describe('picking a mesh', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    const text = [
      ...SHAPES.map(
        ([e, n, u]) => `v ${String(EAST_ORIGIN + e)} ${String(NORTH_ORIGIN + n)} ${String(u)}`,
      ),
      ...FACES.map((face) => `f ${face.join(' ')}`),
    ].join('\n');
    await importAndLoad(
      page,
      { name: 'shapes.obj', mimeType: 'text/plain', buffer: Buffer.from(`${text}\n`) },
      projectionFor('shapes.prj'),
    );
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  });

  const at = (east: number, north: number): [number, number] => [
    EAST_ORIGIN + east,
    NORTH_ORIGIN + north,
  ];

  test('says which triangle is under the pointer, counted from 0 as the file has them', async ({
    page,
  }) => {
    // The faces of the pyramid, from the south one anticlockwise, after the plate's two triangles (the south one away from the plate).
    expect(await pickNear(page, at(15, 3))).toEqual({ layerId: 'layer-1', element: 2 });
    expect((await pickNear(page, at(92, 50)))?.element).toBe(3);
    expect((await pickNear(page, at(50, 92)))?.element).toBe(4);
    expect((await pickNear(page, at(8, 50)))?.element).toBe(5);
  });

  test('is the highest triangle where two are over each other, as it is drawn, and the one under it where it is not', async ({
    page,
  }) => {
    // The plate at 100 m is over the south face and comes first in the file, but is the higher and is what is seen: its two triangles are 0 and 1, divided
    // along the diagonal from (30, 0) to (70, 30). Outside the plate the face is what is there.
    expect((await pickNear(page, at(50, 20)))?.element).toBe(1);
    expect((await pickNear(page, at(60, 5)))?.element).toBe(0);
    expect((await pickNear(page, at(50, 40)))?.element).toBe(2);
  });

  test('is nothing off the mesh, and is where the mesh is drawn when the map is turned', async ({
    page,
  }) => {
    expect(await pickNear(page, at(-30, 50))).toBeNull();
    expect(await pickNear(page, at(150, 50))).toBeNull();
    // A quarter turn: east is up. The east face (element 3) is centred 42 metres east of the middle of the base.
    expect((await pickNear(page, at(8, 50), { up: 84, heading: 90 }))?.element).toBe(3);
  });

  test('does not pick a layer that is hidden', async ({ page }) => {
    expect((await pickNear(page, at(8, 50)))?.element).toBe(5);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    expect(await pickNear(page, at(8, 50))).toBeNull();
  });
});

test.describe('picking a surface', () => {
  const COLUMNS = 4;
  const ROWS = 4;
  const CELL = 10;

  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    // The heights rise to the east and the north: a surface through the middles of the cells.
    await loadLattice(page, 'grid', {
      name: 'ground',
      crs: { kind: 'epsg', code: 32640 },
      origin: [EAST_ORIGIN, NORTH_ORIGIN, 0],
      spacing: [CELL, CELL, 1],
      dims: [COLUMNS, ROWS, 1],
      heights: Array.from(
        { length: COLUMNS * ROWS },
        (_, n) => (n % COLUMNS) + Math.floor(n / COLUMNS),
      ),
      values: Array.from({ length: COLUMNS * ROWS }, (_, n) => n),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  });

  test('says the cell of the triangle under the pointer: the one with the lowest number of its corners, counted from 0 with i fastest', async ({
    page,
  }) => {
    // The vertices are the middles of the cells; a square of four of them is two triangles that take their colour from the cell at its corner
    // with the lowest number. The middle of the square whose lower left corner is the cell (i, j) is that cell's.
    for (const [i, j] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 2],
    ] as const) {
      const spot: [number, number] = [EAST_ORIGIN + (i + 1) * CELL, NORTH_ORIGIN + (j + 1) * CELL];
      expect(
        await pickNear(page, spot, { scale: 0.25 }),
        `the square of the cell ${String(i)}, ${String(j)}`,
      ).toEqual({ layerId: 'layer-1', element: j * COLUMNS + i });
    }
  });

  test('is nothing beyond the surface, which ends at the middles of the cells at its edge', async ({
    page,
  }) => {
    expect(await pickNear(page, [EAST_ORIGIN - 20, NORTH_ORIGIN + 20], { scale: 0.25 })).toBeNull();
    expect(
      await pickNear(page, [EAST_ORIGIN + COLUMNS * CELL + 20, NORTH_ORIGIN + 20], { scale: 0.25 }),
    ).toBeNull();
  });
});

test.describe('picking a grid', () => {
  const COLUMNS = 4;
  const ROWS = 3;
  const CELL = 10;
  const NAN = Number.NaN;

  /** A grid of 4 by 3 cells of 10 metres with its first cell's lower left corner at the origin, and a value for each cell (the cell with a NaN has none). */
  async function load(page: Page, rotation?: number, values?: readonly number[]): Promise<void> {
    await page.goto('/?theme=light');
    await loadLattice(page, 'grid', {
      name: 'cells',
      crs: { kind: 'epsg', code: 32640 },
      origin: [EAST_ORIGIN, NORTH_ORIGIN, 0],
      spacing: [CELL, CELL, 1],
      dims: [COLUMNS, ROWS, 1],
      ...(rotation === undefined ? {} : { rotation }),
      values: values ?? Array.from({ length: COLUMNS * ROWS }, (_, n) => n),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  }

  /** The middle of the cell `(i, j)` in map coordinates, for a grid turned by `rotation` degrees about its origin. */
  const middleOf = (i: number, j: number, rotation = 0): [number, number] => {
    const turn = (rotation * Math.PI) / 180;
    const along = (i + 0.5) * CELL;
    const up = (j + 0.5) * CELL;
    return [
      EAST_ORIGIN + along * Math.cos(turn) - up * Math.sin(turn),
      NORTH_ORIGIN + along * Math.sin(turn) + up * Math.cos(turn),
    ];
  };

  test('says the number of the cell under the pointer, counted from 0 with i fastest', async ({
    page,
  }) => {
    await load(page);
    for (const [i, j] of [
      [0, 0],
      [3, 0],
      [1, 1],
      [0, 2],
      [3, 2],
      [2, 1],
    ] as const) {
      expect(
        await pickNear(page, middleOf(i, j), { scale: 0.25 }),
        `cell ${String(i)}, ${String(j)}`,
      ).toEqual({
        layerId: 'layer-1',
        element: j * COLUMNS + i,
      });
    }
  });

  test('changes cell exactly at the edge between two cells, and is nothing beyond the grid', async ({
    page,
  }) => {
    await load(page);
    // At 0.25 metres a pixel: two pixels, half a metre, each side of the edge between the cells 0 and 1 at 10 metres from the corner, and of the one above.
    const edge: [number, number] = [EAST_ORIGIN + CELL, NORTH_ORIGIN + CELL / 2];
    expect((await pickNear(page, edge, { scale: 0.25, right: -2 }))?.element).toBe(0);
    expect((await pickNear(page, edge, { scale: 0.25, right: 2 }))?.element).toBe(1);
    const above: [number, number] = [EAST_ORIGIN + CELL / 2, NORTH_ORIGIN + CELL];
    expect((await pickNear(page, above, { scale: 0.25, up: -2 }))?.element).toBe(0);
    expect((await pickNear(page, above, { scale: 0.25, up: 2 }))?.element).toBe(COLUMNS);
    // Beyond the grid on each side.
    expect(await pickNear(page, [EAST_ORIGIN - 5, NORTH_ORIGIN + 15], { scale: 0.25 })).toBeNull();
    expect(
      await pickNear(page, [EAST_ORIGIN + COLUMNS * CELL + 5, NORTH_ORIGIN + 15], { scale: 0.25 }),
    ).toBeNull();
    expect(await pickNear(page, [EAST_ORIGIN + 15, NORTH_ORIGIN - 5], { scale: 0.25 })).toBeNull();
    expect(
      await pickNear(page, [EAST_ORIGIN + 15, NORTH_ORIGIN + ROWS * CELL + 5], { scale: 0.25 }),
    ).toBeNull();
  });

  test('is nothing in a cell that has no value, which is not drawn', async ({ page }) => {
    // The cell (1, 1), number 5, has no value.
    await load(
      page,
      undefined,
      Array.from({ length: COLUMNS * ROWS }, (_, n) => (n === 5 ? NAN : n)),
    );
    expect(await pickNear(page, middleOf(1, 1), { scale: 0.25 })).toBeNull();
    expect((await pickNear(page, middleOf(2, 1), { scale: 0.25 }))?.element).toBe(6);
    expect((await pickNear(page, middleOf(1, 0), { scale: 0.25 }))?.element).toBe(1);
  });

  test('is where the cells are drawn when the lattice is turned, and when the map is', async ({
    page,
  }) => {
    await load(page, 30);
    for (const [i, j] of [
      [0, 0],
      [3, 2],
      [2, 1],
    ] as const) {
      expect((await pickNear(page, middleOf(i, j, 30), { scale: 0.25 }))?.element).toBe(
        j * COLUMNS + i,
      );
    }
    // A cell of a grid that is not turned, seen with the map turned a quarter: the middle of the cell (3, 0) is 30 metres east of the cell (0, 0)'s.
    await load(page);
    const from = middleOf(0, 0);
    expect(
      (await pickNear(page, from, { scale: 0.5, heading: 90, up: 30 / 0.5, right: 0 }))?.element,
    ).toBe(3);
  });

  test('numbers the cells over all the tiles of a grid that is cut because it is wider than a texture', async ({
    page,
  }) => {
    const wide = 4100;
    await page.goto('/?theme=light');
    await loadLattice(page, 'grid', {
      name: 'wide',
      crs: { kind: 'epsg', code: 32640 },
      origin: [EAST_ORIGIN, NORTH_ORIGIN, 0],
      spacing: [1, 1, 1],
      dims: [wide, 2, 1],
      values: Array.from({ length: wide * 2 }, (_, n) => n % 50),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    for (const [i, j] of [
      [0, 0],
      [4095, 1],
      [4096, 0],
      [4099, 1],
    ] as const) {
      expect(
        (await pickNear(page, [EAST_ORIGIN + i + 0.5, NORTH_ORIGIN + j + 0.5], { scale: 0.1 }))
          ?.element,
        `cell ${String(i)}, ${String(j)}`,
      ).toBe(j * wide + i);
    }
  });

  test('numbers the cells over all the tiles of a grid that is cut because it is taller than a texture', async ({
    page,
  }) => {
    const tall = 4100;
    await page.goto('/?theme=light');
    await loadLattice(page, 'grid', {
      name: 'tall',
      crs: { kind: 'epsg', code: 32640 },
      origin: [EAST_ORIGIN, NORTH_ORIGIN, 0],
      spacing: [1, 1, 1],
      dims: [3, tall, 1],
      values: Array.from({ length: 3 * tall }, (_, n) => n % 50),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    for (const [i, j] of [
      [0, 0],
      [2, 4095],
      [1, 4096],
      [2, 4099],
    ] as const) {
      expect(
        (await pickNear(page, [EAST_ORIGIN + i + 0.5, NORTH_ORIGIN + j + 0.5], { scale: 0.1 }))
          ?.element,
        `cell ${String(i)}, ${String(j)}`,
      ).toBe(j * 3 + i);
    }
  });

  test('does not pick a layer that is hidden', async ({ page }) => {
    await load(page);
    expect((await pickNear(page, middleOf(1, 1), { scale: 0.25 }))?.element).toBe(5);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    expect(await pickNear(page, middleOf(1, 1), { scale: 0.25 })).toBeNull();
  });
});
