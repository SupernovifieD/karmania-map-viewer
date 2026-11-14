import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { projectionFor } from './support/fixtures.js';
import { pixelOf3d } from './support/project.js';
import {
  around,
  bytes,
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
import { importAndLoad } from './support/wizard.js';

/**
 * Layers that lie in one plane, in 3D (step 18.5a). Data that has no heights is all at z = 0, so layers of it are at the same depth, which the depth
 * buffer cannot order: the legend does (section 9.4 of the brief). A layer that is higher in the legend is on top of one in its plane, from every side,
 * near and far, and moving it in the legend changes which is seen.
 */

const EAST = 500_000;
const NORTH = 2_765_000;
/** The shade of a flat face in 3D (`light.ts`): the colour of a mesh is this much of its layer's. */
const FLAT = 0.25 + 0.75 * Math.SQRT1_2;

/** A flat square of 100 m from `(east, north)` metres from the corner, at height 0, as an OBJ file made on the spot. */
function square(name: string, east: number, north: number) {
  const corners = [
    [east, north],
    [east + 100, north],
    [east + 100, north + 100],
    [east, north + 100],
  ];
  const text = [
    ...corners.map(([e = 0, n = 0]) => `v ${String(EAST + e)} ${String(NORTH + n)} 0`),
    'f 1 2 3',
    'f 1 3 4',
    '',
  ].join('\n');
  return { name, mimeType: 'text/plain', buffer: Buffer.from(text) };
}

/** Where the layers are looked at from: the middle of the overlap, at an elevation and a heading, from a distance. */
const VIEWS = [
  { heading: 0, elevation: 89, distance: 250 },
  { heading: 35, elevation: 60, distance: 300 },
  { heading: 210, elevation: 30, distance: 400 },
  { heading: 100, elevation: 15, distance: 500 },
  { heading: 300, elevation: 50, distance: 3000 },
] as const;

async function look(page: Page, view: (typeof VIEWS)[number]) {
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [EAST + 75, NORTH + 75, 0],
          distance: view.distance,
          heading: view.heading,
          elevation: view.elevation,
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

/** The colour of the picture at a point of the plane z = 0, `east` and `north` metres from the corner. */
async function colourAt(
  page: Page,
  view: Awaited<ReturnType<typeof look>>,
  east: number,
  north: number,
): Promise<number[]> {
  const at = pixelOf3d(view.now, view.origin, [EAST + east, NORTH + north, 0]);
  if (at === undefined) {
    throw new Error('The point is behind the camera.');
  }
  return (await around(page, at.x, at.y, 0)).at(0, 0);
}

const lit = (colour: readonly number[]): number[] => colour.map((channel) => channel * FLAT);

/** Two squares that overlap, in one plane: A from (0, 0) and B from (50, 50), B loaded last and so higher in the legend. */
async function loadSquares(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, square('a.obj', 0, 0), projectionFor('a.prj'));
  await drawn(page);
  await importAndLoad(page, square('b.obj', 50, 50), projectionFor('b.prj'));
  await expect
    .poll(async () => layerStatuses(page))
    .toEqual([
      ['layer-1', 'drawn'],
      ['layer-2', 'drawn'],
    ]);
}

/** Layers by id from the top of the legend to its bottom: moves `id` to the bottom of `count`. */
const toTheBottom = (page: Page, id: string, count: number) =>
  dispatch(page, { type: 'moveNode', id, to: { parent: null, index: count - 1 } });

/** The points of the overlap to look at: away from the edges and from each other, so that a speckle would show in one of them. */
const OVERLAP = [
  [60, 60],
  [75, 75],
  [90, 90],
  [60, 90],
  [90, 60],
] as const;

test.describe('layers in one plane, in 3D', () => {
  test('show the layer that is higher in the legend, from every side and near and far, and the other when the order is turned round', async ({
    page,
  }) => {
    await loadSquares(page);
    const a = lit(bytes(await layerColour(page, 'layer-1')));
    const b = lit(bytes(await layerColour(page, 'layer-2')));
    expect(distance(a, b)).toBeGreaterThan(40);
    for (const order of ['B on top', 'A on top'] as const) {
      if (order === 'A on top') {
        await toTheBottom(page, 'layer-2', 2);
      }
      const top = order === 'B on top' ? b : a;
      for (const view of VIEWS) {
        const here = await look(page, view);
        for (const [east, north] of OVERLAP) {
          expect(
            distance(await colourAt(page, here, east, north), top),
            `${order}, from heading ${String(view.heading)}, ${String(view.elevation)} degrees up, ${String(view.distance)} away, at ${String(east)},${String(north)}`,
          ).toBeLessThanOrEqual(3);
        }
        // Where only one of them is, it is itself.
        expect(distance(await colourAt(page, here, 25, 25), a)).toBeLessThanOrEqual(3);
        expect(distance(await colourAt(page, here, 125, 125), b)).toBeLessThanOrEqual(3);
      }
    }
  });

  test('show a marker that is higher in the legend than the plane it lies in, and the plane when it is lower', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, square('a.obj', 0, 0), projectionFor('a.prj'));
    await drawn(page);
    await importAndLoad(
      page,
      {
        name: 'dot.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`Easting,Northing,RL\n${String(EAST + 50)},${String(NORTH + 50)},0\n`),
      },
      projectionFor('dot.prj'),
    );
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    const plane = lit(bytes(await layerColour(page, 'layer-1')));
    const marker = bytes(await layerColour(page, 'layer-2'));
    expect(distance(plane, marker)).toBeGreaterThan(40);
    for (const order of ['marker on top', 'plane on top'] as const) {
      if (order === 'plane on top') {
        await toTheBottom(page, 'layer-2', 2);
      }
      for (const view of VIEWS.slice(0, 4)) {
        const here = await look(page, view);
        // The middle of the marker: the plane or the marker, by where the legend puts them.
        const seen = await colourAt(page, here, 50, 50);
        expect(
          distance(seen, order === 'marker on top' ? marker : plane),
          `${order}, from heading ${String(view.heading)}, ${String(view.elevation)} degrees up`,
        ).toBeLessThanOrEqual(3);
      }
    }
  });

  test('show a line that is higher in the legend than the plane it lies in, whichever way the line goes, and the plane when it is lower', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, square('a.obj', 0, 0), projectionFor('a.prj'));
    await drawn(page);
    // One line along the east, and one along the north, in the plane of the square: seen at every angle one of them runs across the screen.
    const rows = [
      `A,${String(EAST + 20)},${String(NORTH + 50)},0`,
      `A,${String(EAST + 80)},${String(NORTH + 50)},0`,
      `B,${String(EAST + 50)},${String(NORTH + 20)},0`,
      `B,${String(EAST + 50)},${String(NORTH + 80)},0`,
    ];
    await importAndLoad(
      page,
      {
        name: 'cross.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`Line,X,Y,Z\n${rows.join('\n')}\n`),
      },
      projectionFor('cross.prj'),
    );
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    const plane = lit(bytes(await layerColour(page, 'layer-1')));
    const line = bytes(await layerColour(page, 'layer-2'));
    expect(distance(plane, line)).toBeGreaterThan(40);
    for (const order of ['line on top', 'plane on top'] as const) {
      if (order === 'plane on top') {
        await toTheBottom(page, 'layer-2', 2);
      }
      for (const view of VIEWS.slice(0, 4)) {
        const here = await look(page, view);
        // The line is 2 pixels wide, and the projection rounds: the middle of each of the two is one of nine pixels that are on it.
        for (const [east, north] of [
          [35, 50],
          [50, 35],
          [65, 50],
          [50, 65],
        ] as const) {
          const at = pixelOf3d(here.now, here.origin, [EAST + east, NORTH + north, 0]);
          expect(at).toBeDefined();
          const block = await around(page, at?.x ?? 0, at?.y ?? 0, 1);
          const found = block
            .all()
            .some(([, , pixel]) => distance(pixel, order === 'line on top' ? line : plane) <= 3);
          const other = block
            .all()
            .some(([, , pixel]) => distance(pixel, order === 'line on top' ? plane : line) <= 3);
          const label = `${order}, from heading ${String(view.heading)}, ${String(view.elevation)} degrees up, at ${String(east)},${String(north)}`;
          expect(found, label).toBe(true);
          // And when the plane is on top there is none of the line to be seen at all.
          if (order === 'plane on top') {
            expect(other, `${label}: the line is hidden`).toBe(false);
          }
        }
      }
    }
  });

  test('show a plane of a mesh over a grid that lies in it, and the grid over the mesh, as the legend has them', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await importAndLoad(page, square('a.obj', 0, 0), projectionFor('a.prj'));
    await drawn(page);
    await loadLattice(page, 'grid', {
      name: 'cells',
      crs: { kind: 'epsg', code: 32640 },
      origin: [EAST, NORTH, 0],
      spacing: [25, 25, 1],
      dims: [4, 4, 1],
      elevation: 0,
      values: Array.from({ length: 16 }, (_, i) => i + 1),
    });
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    const mesh = lit(bytes(await layerColour(page, 'layer-1')));
    const map = await mapColour(page);
    for (const order of ['grid on top', 'mesh on top'] as const) {
      if (order === 'mesh on top') {
        await toTheBottom(page, 'layer-2', 2);
      }
      for (const view of VIEWS.slice(0, 4)) {
        const here = await look(page, view);
        for (const [east, north] of [
          [30, 30],
          [60, 80],
          [80, 20],
        ] as const) {
          const seen = await colourAt(page, here, east, north);
          const label = `${order}, from heading ${String(view.heading)}, ${String(view.elevation)} degrees up, at ${String(east)},${String(north)}`;
          if (order === 'mesh on top') {
            expect(distance(seen, mesh), label).toBeLessThanOrEqual(3);
          } else {
            // Not the mesh, and not the map showing through either (a grid that was not drawn would also be "not the mesh"): the grid's own colour.
            expect(distance(seen, mesh), label).toBeGreaterThan(30);
            expect(distance(seen, map), `${label}, not the map`).toBeGreaterThan(30);
          }
        }
      }
    }
  });
});
