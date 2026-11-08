import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  around,
  camera,
  dispatch,
  distance,
  drawn,
  layerStatuses,
  loadLattice,
} from './support/render.js';
import type { LatticeSpec } from './support/render.js';

/**
 * A grid and a block model that are turned, seen in a browser. No file and no step of the wizard gives a lattice a rotation (the formats have
 * none), so these were tested in Node only, where the corners and the uniforms are read and not seen; the viewer's `load` is the way a script
 * hands over a lattice that is turned, and here the pixels say where the cells are.
 */

/** The ends of the viridis ramp, which the default style of a grid or a block model is coloured from: the first class and the last. */
const FIRST = [0x44, 0x01, 0x54];
const LAST = [0xfd, 0xe7, 0x25];

const ORIGIN = [500_000, 2_765_000] as const;
const CELL = 10;
const TURN = 30;

/** A lattice of 3 by 2 cells of 10 metres with the values 1 to 6 (X fastest), turned 30 degrees anticlockwise about its origin. */
const lattice = (rotation: number | undefined): LatticeSpec => ({
  name: 'turned',
  crs: { kind: 'epsg', code: 32640 },
  origin: [ORIGIN[0], ORIGIN[1], 0],
  spacing: [CELL, CELL, 5],
  dims: [3, 2, 1],
  ...(rotation === undefined ? {} : { rotation }),
  values: [1, 2, 3, 4, 5, 6],
});

/** `(x, y)` along the lattice's own axes, as a point of the map: turned by `TURN` degrees about the origin. */
function onTheMap(x: number, y: number, turn = TURN): [number, number] {
  const angle = (turn * Math.PI) / 180;
  return [
    ORIGIN[0] + x * Math.cos(angle) - y * Math.sin(angle),
    ORIGIN[1] + x * Math.sin(angle) + y * Math.cos(angle),
  ];
}

interface View {
  width: number;
  height: number;
  ratio: number;
  centre: readonly [number, number];
  scale: number;
}

/** Looks at `centre` at `scale` map units a pixel, north up, and waits for the camera to be there and a frame to be drawn. */
async function look(page: Page, centre: readonly [number, number], scale: number): Promise<View> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre, unitsPerPixel: scale, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - scale) / scale)
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio, centre, scale };
}

/** The pixel of a point of the map, with north up and the origin of the buffer at its bottom left. */
const pixelOf = (view: View, east: number, north: number) => ({
  x: Math.floor(view.width / 2 + ((east - view.centre[0]) / view.scale) * view.ratio),
  y: Math.floor(view.height / 2 + ((north - view.centre[1]) / view.scale) * view.ratio),
});

async function colourAt(
  page: Page,
  view: View,
  point: readonly [number, number],
): Promise<number[]> {
  const pixel = pixelOf(view, point[0], point[1]);
  return (await around(page, pixel.x, pixel.y, 0)).at(0, 0);
}

async function mapColour(page: Page): Promise<number[]> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const text = getComputedStyle(element).backgroundColor;
    return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
  });
}

/** Loads the lattice through the viewer, and looks at the middle of it at a quarter of a unit a pixel (a cell is 40). */
async function show(
  page: Page,
  kind: 'grid' | 'blocks',
  rotation: number | undefined,
): Promise<View> {
  await page.goto('/?theme=light');
  const result = await loadLattice(page, kind, lattice(rotation));
  expect(result.status).toBe('loaded');
  await drawn(page);
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  return look(page, onTheMap(15, 10, rotation ?? 0), 0.25);
}

/** The middle of the cell `(i, j)`. */
const middleOf = (i: number, j: number, turn: number): [number, number] =>
  onTheMap((i + 0.5) * CELL, (j + 0.5) * CELL, turn);

for (const kind of ['grid', 'blocks'] as const) {
  test.describe(`a ${kind} that is turned`, () => {
    test('is a dataset that was loaded with `load`, listed and drawn as an imported one is', async ({
      page,
    }) => {
      await show(page, kind, TURN);
      await expect(page.locator('karmania-dataset-list li[data-dataset="turned"]')).toBeVisible();
      await expect(page.locator('karmania-dataset-summary dl')).toContainText(
        kind === 'grid' ? '6 cells' : '6 blocks',
      );
    });

    test('has its cells where the turn puts them: the first at the origin end and the last at the far corner', async ({
      page,
    }) => {
      const view = await show(page, kind, TURN);
      // The first value is the first class of the ramp and the last value the last, so that which cell is where is told by colour.
      expect(distance(await colourAt(page, view, middleOf(0, 0, TURN)), FIRST)).toBeLessThanOrEqual(
        2,
      );
      expect(distance(await colourAt(page, view, middleOf(2, 1, TURN)), LAST)).toBeLessThanOrEqual(
        2,
      );
      // All six are coloured, and no two neighbours the same.
      const colours = await Promise.all(
        [0, 1, 2].flatMap((i) => [0, 1].map((j) => colourAt(page, view, middleOf(i, j, TURN)))),
      );
      for (const [index, colour] of colours.entries()) {
        for (const other of colours.slice(index + 1)) {
          expect(distance(colour, other)).toBeGreaterThan(8);
        }
      }
    });

    test('is turned, not drawn square: what is outside it is the map, and what is inside it only because of the turn is coloured', async ({
      page,
    }) => {
      const view = await show(page, kind, TURN);
      const map = await mapColour(page);
      // The point 28 east and 18 north of the origin is inside the lattice of 30 by 20 if it is not turned; turned 30 degrees it is at 33.25
      // along the lattice's own x, which is outside it: a grid that was drawn square would be coloured there.
      expect(await colourAt(page, view, [ORIGIN[0] + 28, ORIGIN[1] + 18])).toEqual(map);
      // And the point that is left of the origin and well up is inside it, since the grid is turned to the left (anticlockwise).
      const inside = onTheMap(5, 19);
      expect(inside[0]).toBeLessThan(ORIGIN[0]);
      expect(distance(await colourAt(page, view, inside), map)).toBeGreaterThan(30);
    });

    test('reaches its four corners, which are the corners of squares that are turned and not of squares that are only moved', async ({
      page,
    }) => {
      const view = await show(page, kind, TURN);
      const map = await mapColour(page);
      // Half a unit inside each corner of the 30 by 20 lattice, along its own axes. A box that is moved to where a turned cell is and is not
      // turned itself (which the blocks' shader does for each box) stops about two units short of such a corner.
      for (const [x, y] of [
        [0.5, 0.5],
        [29.5, 0.5],
        [29.5, 19.5],
        [0.5, 19.5],
      ] as const) {
        expect(
          distance(await colourAt(page, view, onTheMap(x, y)), map),
          `${String(x)}, ${String(y)}`,
        ).toBeGreaterThan(30);
      }
    });

    test('has no gap between its cells, and meets the map along a straight edge', async ({
      page,
    }) => {
      const view = await show(page, kind, TURN);
      const map = await mapColour(page);
      // The middle of each edge between two cells, along the turned axes: it is one cell's colour or the other's, and never the map's.
      for (const [x, y] of [
        [10, 5],
        [20, 5],
        [10, 15],
        [20, 15],
        [5, 10],
        [15, 10],
        [25, 10],
      ] as const) {
        const colour = await colourAt(page, view, onTheMap(x, y));
        expect(distance(colour, map), `${String(x)}, ${String(y)}`).toBeGreaterThan(30);
      }
      // A little outside the outer edge is the map, the whole way round.
      for (const [x, y] of [
        [-1.5, 10],
        [31.5, 10],
        [15, -1.5],
        [15, 21.5],
      ] as const) {
        expect(await colourAt(page, view, onTheMap(x, y)), `${String(x)}, ${String(y)}`).toEqual(
          map,
        );
      }
    });

    test('is the same as one that is not turned when the turn is 0, and a whole turn', async ({
      page,
    }) => {
      for (const rotation of [0, 360]) {
        const view = await show(page, kind, rotation);
        expect(
          distance(await colourAt(page, view, middleOf(0, 0, 0)), FIRST),
          `turned ${String(rotation)}`,
        ).toBeLessThanOrEqual(2);
        expect(distance(await colourAt(page, view, middleOf(2, 1, 0)), LAST)).toBeLessThanOrEqual(
          2,
        );
        // Square to the map: the point (28, 18) is in the last cell.
        expect(
          distance(await colourAt(page, view, [ORIGIN[0] + 28, ORIGIN[1] + 18]), LAST),
        ).toBeLessThanOrEqual(2);
      }
    });

    test('turns by a quarter exactly: the first row is on the left of the map', async ({
      page,
    }) => {
      const view = await show(page, kind, 90);
      // Turned a quarter anticlockwise, the lattice's x runs north and its y runs west: the cell (2, 1) is at the north-west.
      expect(distance(await colourAt(page, view, middleOf(0, 0, 90)), FIRST)).toBeLessThanOrEqual(
        2,
      );
      expect(distance(await colourAt(page, view, middleOf(2, 1, 90)), LAST)).toBeLessThanOrEqual(2);
      const [east, north] = middleOf(2, 1, 90);
      expect(east).toBeLessThan(ORIGIN[0]);
      expect(north).toBeGreaterThan(ORIGIN[1]);
    });
  });
}
