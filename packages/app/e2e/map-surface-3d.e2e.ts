import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pixelOf3d } from './support/project.js';
import {
  around,
  bytes,
  camera,
  dispatch,
  distance,
  drawn,
  layerColour,
  layerStatuses,
  loadLattice,
  mapColour,
  sceneFrame,
  stats,
} from './support/render.js';

/**
 * Grids in 3D (step 18.5). A grid that has an elevation for each cell is a surface through those heights at the middles of its cells, lit by the
 * light of the view it is in, and coloured by the class of each cell; a flat grid is a plane at its elevation. Both are seen in 3D and, for the
 * surface, from above.
 */

const EAST = 500_000;
const NORTH = 2_765_000;
const CELL = 20;
const COLUMNS = 6;
const ROWS = 6;
/** The ends of viridis: the first class and the last, of the default style of a grid. */
const FIRST = [0x44, 0x01, 0x54];
const LAST = [0xfd, 0xe7, 0x25];
const AMBIENT = 0.25;
const LIGHT = [-0.5, 0.5, Math.SQRT1_2] as const;

/** The shade of a face with the unit normal `n` in the light of the view in 3D: the ambient, and the rest by how much it turns to the light. */
const shade3d = (n: readonly [number, number, number]): number =>
  AMBIENT + (1 - AMBIENT) * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);

/** The unit normal of a surface that rises `slope` metres for each metre east. */
const rising = (slope: number): [number, number, number] => {
  const length = Math.hypot(slope, 1);
  return [-slope / length, 0, 1 / length];
};

/** The middle of the cell `(i, j)`, in metres from the corner of the grid. */
const middle = (i: number, j: number): [number, number] => [(i + 0.5) * CELL, (j + 0.5) * CELL];

/** The heights of a surface that rises `slope` metres for each metre east from 10 m up, and the values of its cells: `low` in the west half and `high` in the east. */
function surface(slope: number, low = 1, high = 10) {
  const heights: number[] = [];
  const values: number[] = [];
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLUMNS; i += 1) {
      heights.push(10 + slope * middle(i, j)[0]);
      values.push(i < COLUMNS / 2 ? low : high);
    }
  }
  return { heights, values };
}

async function loadSurface(
  page: Page,
  data: { heights: number[]; values: number[] },
  rotation?: number,
): Promise<void> {
  await page.goto('/?theme=light');
  await loadLattice(page, 'grid', {
    name: 'ground',
    crs: { kind: 'epsg', code: 32640 },
    origin: [EAST, NORTH, 0],
    spacing: [CELL, CELL, 1],
    dims: [COLUMNS, ROWS, 1],
    ...(rotation === undefined ? {} : { rotation }),
    ...data,
  });
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

/** Looks at the middle of the grid from `heading` and `elevation`, in 3D. */
async function look3d(page: Page, heading: number, elevation: number, distanceAway = 300) {
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [EAST + 60, NORTH + 60, 40],
          distance: distanceAway,
          heading,
          elevation,
          fov: 45,
        },
      },
    },
    { type: 'setViewMode', mode: '3d' },
  );
  await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
  const frame = await sceneFrame(page);
  return { now: await drawn(page), origin: frame?.origin ?? [0, 0, 0] };
}

/** The colour of the picture where the surface is above the point `(east, north)` metres from the corner. */
async function colourOnSurface(
  page: Page,
  view: Awaited<ReturnType<typeof look3d>>,
  east: number,
  north: number,
  slope: number,
): Promise<number[]> {
  const at = pixelOf3d(view.now, view.origin, [EAST + east, NORTH + north, 10 + slope * east]);
  if (at === undefined) {
    throw new Error('The point is behind the camera.');
  }
  return (await around(page, at.x, at.y, 0)).at(0, 0);
}

const scaled = (colour: readonly number[], by: number): number[] => colour.map((c) => c * by);

test.describe('the surface of a grid with elevations', () => {
  test('is drawn in 3D, lit as a slope of that steepness is, and coloured by the class of each cell, from different sides', async ({
    page,
  }) => {
    const slope = 0.5;
    await loadSurface(page, surface(slope));
    for (const [heading, elevation] of [
      [0, 60],
      [140, 40],
      [250, 55],
    ] as const) {
      const view = await look3d(page, heading, elevation);
      const shade = shade3d(rising(slope));
      // Well inside the west half (cells of the first class) and the east half (the last), away from where the two meet and from the edges.
      for (const [east, north] of [
        [30, 40],
        [30, 85],
        [45, 60],
      ] as const) {
        expect(
          distance(await colourOnSurface(page, view, east, north, slope), scaled(FIRST, shade)),
          `west at ${String(east)},${String(north)} from heading ${String(heading)}`,
        ).toBeLessThanOrEqual(3);
      }
      for (const [east, north] of [
        [80, 40],
        [95, 85],
        [85, 60],
      ] as const) {
        expect(
          distance(await colourOnSurface(page, view, east, north, slope), scaled(LAST, shade)),
          `east at ${String(east)},${String(north)} from heading ${String(heading)}`,
        ).toBeLessThanOrEqual(3);
      }
    }
  });

  test('is lit by the light of the view in 3D that a slope the other way gets less of: a surface that falls to the east is darker than one that rises, in the pictures of the two', async ({
    page,
  }) => {
    // The same cells of the same class, seen from the same side: on a surface that rises to the east, and on one that falls to it.
    await loadSurface(page, surface(0.5));
    const rises = await colourOnSurface(page, await look3d(page, 20, 50), 30, 60, 0.5);
    await loadSurface(page, surface(-0.5));
    const falls = await colourOnSurface(page, await look3d(page, 20, 50), 30, 60, -0.5);
    expect(
      distance(rises, scaled(FIRST, shade3d(rising(0.5)))),
      'the surface that rises is at its shade',
    ).toBeLessThanOrEqual(3);
    expect(
      distance(falls, scaled(FIRST, shade3d(rising(-0.5)))),
      'the surface that falls is at its shade',
    ).toBeLessThanOrEqual(3);
    // And the two pictures say it by themselves, without the shades above: the one that falls has less of every colour of the class together.
    const total = (colour: readonly number[]): number =>
      (colour[0] ?? 0) + (colour[1] ?? 0) + (colour[2] ?? 0);
    expect(total(falls), 'the pixel of the surface that falls').toBeLessThan(total(rises) - 30);
  });

  test('is drawn in 2D too, lit from straight above: the colour of the class at 0.25 + 0.75 of the part of a slope that faces up', async ({
    page,
  }) => {
    const slope = 0.5;
    await loadSurface(page, surface(slope));
    // The view the page starts in is from above, north up; the fit has the whole grid in it. Read at 40 east, 60 north of the corner.
    const now = await drawn(page);
    const view = await camera(page);
    const pixel = (east: number, north: number) => ({
      x: Math.floor(
        now.width / 2 + ((EAST + east - view.centre[0]) / view.unitsPerPixel) * now.pixelRatio,
      ),
      y: Math.floor(
        now.height / 2 + ((NORTH + north - view.centre[1]) / view.unitsPerPixel) * now.pixelRatio,
      ),
    });
    const up = 1 / Math.hypot(slope, 1);
    const wanted = AMBIENT + (1 - AMBIENT) * up;
    const west = pixel(40, 60);
    const east = pixel(85, 60);
    expect(
      distance((await around(page, west.x, west.y, 0)).at(0, 0), scaled(FIRST, wanted)),
    ).toBeLessThanOrEqual(3);
    expect(
      distance((await around(page, east.x, east.y, 0)).at(0, 0), scaled(LAST, wanted)),
    ).toBeLessThanOrEqual(3);
  });

  test('leaves out the cells that have no height: there is a hole in it where their triangles would be, and the map shows through', async ({
    page,
  }) => {
    const slope = 0.5;
    const data = surface(slope);
    // The cell (2, 3) has no height: its centre is not a vertex, and the four squares between centres that meet there are not drawn.
    data.heights[3 * COLUMNS + 2] = NaN;
    await loadSurface(page, data);
    const view = await look3d(page, 0, 70, 260);
    const [east, north] = middle(2, 3);
    const hole = pixelOf3d(view.now, view.origin, [EAST + east, NORTH + north, 10 + slope * east]);
    expect(hole).toBeDefined();
    const map = await mapColour(page);
    expect(
      distance((await around(page, hole?.x ?? 0, hole?.y ?? 0, 0)).at(0, 0), map),
    ).toBeLessThanOrEqual(2);
    // A square away from it is drawn.
    const drawnAt = await colourOnSurface(page, view, 80, 40, slope);
    expect(distance(drawnAt, map)).toBeGreaterThan(30);
  });

  test('is a layer that can be recoloured in one colour, which is the colour of the layer at the shade of its slope', async ({
    page,
  }) => {
    const slope = 0.5;
    await loadSurface(page, surface(slope));
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#56b4e9' } },
    });
    await drawn(page);
    const colour = bytes(await layerColour(page));
    const view = await look3d(page, 70, 55);
    for (const [east, north] of [
      [30, 40],
      [85, 70],
    ] as const) {
      expect(
        distance(
          await colourOnSurface(page, view, east, north, slope),
          scaled(colour, shade3d(rising(slope))),
        ),
      ).toBeLessThanOrEqual(3);
    }
  });
});

test.describe('a flat grid in 3D', () => {
  test('is a plane at its elevation, and not at the height of its origin or at 0', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadLattice(page, 'grid', {
      name: 'high',
      crs: { kind: 'epsg', code: 32640 },
      origin: [EAST, NORTH, 0],
      spacing: [CELL, CELL, 1],
      dims: [COLUMNS, ROWS, 1],
      elevation: 60,
      values: Array.from({ length: COLUMNS * ROWS }, (_, i) => (i % COLUMNS < 3 ? 1 : 10)),
    });
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    // Seen from the side, a little above the horizon: the plane at 60 m is where its points are projected, and the plane at 0 m is empty.
    await dispatch(
      page,
      {
        type: 'setCamera',
        patch: {
          camera3d: {
            target: [EAST + 60, NORTH + 60, 60],
            distance: 400,
            heading: 0,
            elevation: 20,
            fov: 45,
          },
        },
      },
      { type: 'setViewMode', mode: '3d' },
    );
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    const frame = await sceneFrame(page);
    const now = await drawn(page);
    const origin = frame?.origin ?? [0, 0, 0];
    const at = (east: number, north: number, up: number) =>
      pixelOf3d(now, origin, [EAST + east, NORTH + north, up]);
    const colourAt = async (point: { x: number; y: number } | undefined) =>
      (await around(page, point?.x ?? 0, point?.y ?? 0, 0)).at(0, 0);
    // On the plane at 60 m: the first class in the west half, the last in the east half.
    expect(distance(await colourAt(at(30, 60, 60)), FIRST)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(at(90, 60, 60)), LAST)).toBeLessThanOrEqual(2);
    // The same places at 0 m are below the plane and in front of it, in the map's colour (nothing is there to be seen).
    const map = await mapColour(page);
    expect(distance(await colourAt(at(30, 20, 0)), map)).toBeLessThanOrEqual(2);
  });
});
