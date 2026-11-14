import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { projectionFor } from './support/fixtures.js';
import { depthOf3d, pixelOf3d } from './support/project.js';
import {
  around,
  camera,
  dispatch,
  distance,
  drawn,
  layerStatuses,
  loadLattice,
  mapColour,
  sceneFrame,
  stats,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/**
 * Block models in 3D (step 18.6): every face of every block that is not hidden by another is drawn, in the colour of its class lit by the light
 * of 3D; the blocks and another layer share one depth test; a block model that is less than opaque shows what is nearest of it once; and fitting
 * the view takes in the whole of the model, with nothing of it cut off by the planes in front of and behind the camera.
 */

const EAST = 500_000;
const NORTH = 2_765_000;
const CELL = 20;
const SIZE = 4;
/** The ends of viridis, which the default style of a block model is coloured from: the first class (low values) and the last. */
const FIRST = [0x44, 0x01, 0x54];
const LAST = [0xfd, 0xe7, 0x25];
const AMBIENT = 0.25;
const LIGHT = [-0.5, 0.5, Math.SQRT1_2] as const;

/** The shade of a face with the unit normal `n`, in the light of 3D. */
const shadeOf = (n: readonly [number, number, number]): number =>
  AMBIENT + (1 - AMBIENT) * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);

const TOP = shadeOf([0, 0, 1]);
const SOUTH = shadeOf([0, -1, 0]);

const scaled = (colour: readonly number[], by: number): number[] => colour.map((c) => c * by);

/**
 * Four by four blocks of 20 m in two layers: the low layer has low values, the high layer high values. The model is 80 m by 80 m by 40 m. With
 * `frontOnly` the high layer has no value in the two rows at the back (north), so the model is 40 m high in front and 20 m behind.
 */
async function loadModel(page: Page, frontOnly = false): Promise<void> {
  await page.goto('/?theme=light');
  await loadLattice(page, 'blocks', {
    name: 'stack',
    crs: { kind: 'epsg', code: 32640 },
    origin: [EAST, NORTH, 0],
    spacing: [CELL, CELL, CELL],
    dims: [SIZE, SIZE, 2],
    values: [
      ...Array.from({ length: SIZE * SIZE }, () => 1),
      ...Array.from({ length: SIZE * SIZE }, (_, n) =>
        frontOnly && Math.floor(n / SIZE) >= SIZE / 2 ? NaN : 10,
      ),
    ],
  });
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

async function look3d(page: Page, heading: number, elevation: number, away = 350) {
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [EAST + 40, NORTH + 40, 20],
          distance: away,
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

async function colourAt(
  page: Page,
  view: Awaited<ReturnType<typeof look3d>>,
  east: number,
  north: number,
  up: number,
): Promise<number[]> {
  const at = pixelOf3d(view.now, view.origin, [EAST + east, NORTH + north, up]);
  if (at === undefined) {
    throw new Error('The point is behind the camera.');
  }
  return (await around(page, at.x, at.y, 0)).at(0, 0);
}

test.describe('block models in 3D', () => {
  test('show the side of each layer and the top of the highest, each in the colour of its class at the shade of its face', async ({
    page,
  }) => {
    await loadModel(page);
    // From the south, 35 degrees up: the south side of both layers and the top of the upper one.
    const view = await look3d(page, 0, 35);
    expect(
      distance(await colourAt(page, view, 40, 0, 10), scaled(FIRST, SOUTH)),
      'the south side of the low layer',
    ).toBeLessThanOrEqual(3);
    expect(
      distance(await colourAt(page, view, 40, 0, 30), scaled(LAST, SOUTH)),
      'the south side of the high layer',
    ).toBeLessThanOrEqual(3);
    for (const [east, north] of [
      [10, 10],
      [40, 40],
      [70, 70],
      [10, 70],
    ] as const) {
      expect(
        distance(await colourAt(page, view, east, north, 40), scaled(LAST, TOP)),
        `the top of the high layer at ${String(east)},${String(north)}`,
      ).toBeLessThanOrEqual(3);
    }
    // From the north-east: the north and east sides, which have other shades.
    const other = await look3d(page, 225, 35);
    expect(
      distance(await colourAt(page, other, 40, 80, 10), scaled(FIRST, shadeOf([0, 1, 0]))),
      'the north side of the low layer',
    ).toBeLessThanOrEqual(3);
    expect(
      distance(await colourAt(page, other, 80, 40, 30), scaled(LAST, shadeOf([1, 0, 0]))),
      'the east side of the high layer',
    ).toBeLessThanOrEqual(3);
  });

  test('hide what is behind them: the front of the model, which is taller, is seen and not the top of the back, which is behind it at a low angle and in front of it at a steep one', async ({
    page,
  }) => {
    await loadModel(page, true);
    // The point is the top of the low layer at the back (north), 20 m up. From the south at 15 degrees up the ray to it passes through the
    // front half of the model (which is 40 m high): what is seen there is the south side of the front half, and not that top.
    const low = await look3d(page, 0, 15, 400);
    expect(
      distance(await colourAt(page, low, 40, 60, 20), scaled(LAST, SOUTH)),
      'hidden behind the front half',
    ).toBeLessThanOrEqual(3);
    // From 70 degrees up nothing is in front of it: it is its own top, in the colour of the low class.
    const steep = await look3d(page, 0, 70, 400);
    expect(
      distance(await colourAt(page, steep, 40, 60, 20), scaled(FIRST, TOP)),
      'seen from above',
    ).toBeLessThanOrEqual(3);
    // And the top of the front half is above it, as it is in front: its colour is the high class.
    expect(
      distance(await colourAt(page, steep, 40, 20, 40), scaled(LAST, TOP)),
    ).toBeLessThanOrEqual(3);
  });

  test('share one depth test with another layer: a plane through the model hides the part of it that is below the plane, in front of it', async ({
    page,
  }) => {
    await loadModel(page);
    // A square plane of 500 m at 20 m, the height between the two layers, as an OBJ made on the spot.
    const corners = [
      [-200, -200],
      [300, -200],
      [300, 300],
      [-200, 300],
    ];
    const text = [
      ...corners.map(([e = 0, n = 0]) => `v ${String(EAST + e)} ${String(NORTH + n)} 20`),
      'f 1 2 3',
      'f 1 3 4',
      '',
    ].join('\n');
    await importAndLoad(
      page,
      { name: 'plane.obj', mimeType: 'text/plain', buffer: Buffer.from(text) },
      projectionFor('plane.prj'),
    );
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    const plane = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { layers: Record<string, { style: { colour: { value?: string } } }> };
      };
      return viewer.scene().layers['layer-2']?.style.colour.value ?? '';
    });
    const planeColour = [1, 3, 5].map((at) => Number.parseInt(plane.slice(at, at + 2), 16));
    const lit = scaled(planeColour, TOP);
    const view = await look3d(page, 0, 30, 400);
    // Above the plane, the wall of the high layer is seen; below it, the plane is in front of the wall, and is what is seen.
    expect(
      distance(await colourAt(page, view, 30, 0, 35), scaled(LAST, SOUTH)),
    ).toBeLessThanOrEqual(3);
    expect(distance(await colourAt(page, view, 30, 0, 10), lit)).toBeLessThanOrEqual(3);
    // The same in the other order of the legend: the plane is in front of the part of the model below it either way.
    await dispatch(page, { type: 'moveNode', id: 'layer-2', to: { parent: null, index: 1 } });
    await drawn(page);
    expect(distance(await colourAt(page, view, 30, 0, 10), lit)).toBeLessThanOrEqual(3);
    expect(
      distance(await colourAt(page, view, 30, 0, 35), scaled(LAST, SOUTH)),
    ).toBeLessThanOrEqual(3);
  });

  test('that are less than opaque show what is nearest of them, once: a face seen through the nearer one is not blended in', async ({
    page,
  }) => {
    await loadModel(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { opacity: 0.5 },
    });
    await drawn(page);
    const map = await mapColour(page);
    const view = await look3d(page, 0, 35);
    const blend = (colour: readonly number[], by: number) =>
      colour.map((c, i) => 0.5 * c * by + 0.5 * (map[i] ?? 0));
    // The top of the model: one blend of the top face of the high layer and the map, not of all the blocks that are under it as well.
    expect(
      distance(await colourAt(page, view, 40, 40, 40), blend(LAST, TOP)),
      'the top, half opaque',
    ).toBeLessThanOrEqual(4);
    // The south side of the high layer: a blend of that face and the map.
    expect(
      distance(await colourAt(page, view, 40, 0, 30), blend(LAST, SOUTH)),
      'the south side of the high layer',
    ).toBeLessThanOrEqual(4);
    // Seen through the south side the low layer's blocks, and the high layer's, are not added to it: where the south side of the low layer is seen it
    // is its own blend with the map.
    expect(
      distance(await colourAt(page, view, 40, 0, 10), blend(FIRST, SOUTH)),
      'the south side of the low layer',
    ).toBeLessThanOrEqual(4);
  });

  test('that are less than opaque have no seams: the pixels every 2 metres along the joins between blocks are the one blend, and not darker where the faces inside meet', async ({
    page,
  }) => {
    await loadModel(page);
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    await drawn(page);
    const map = await mapColour(page);
    const view = await look3d(page, 20, 55, 400);
    const blend = (colour: readonly number[], by: number) =>
      colour.map((c, i) => 0.5 * c * by + 0.5 * (map[i] ?? 0));
    const wanted = blend(LAST, TOP);
    // The joins between the blocks of the top: along x = 20, 40, 60 and along y = 20, 40, 60, with a pixel for every 2 metres.
    const bad: string[] = [];
    for (const join of [20, 40, 60]) {
      for (let along = 6; along <= 74; along += 2) {
        for (const [east, north] of [
          [join, along],
          [along, join],
        ] as const) {
          const seen = await colourAt(page, view, east, north, 40);
          if (distance(seen, wanted) > 4) {
            bad.push(`${String(east)},${String(north)}`);
          }
        }
      }
    }
    expect(bad, 'the places along the joins that are not the blend of the top').toEqual([]);
  });

  test('are all in the picture when the view is fitted to them: the top is the model, and the eight corners of its box are in the picture and between the planes in front of and behind the camera', async ({
    page,
  }) => {
    await loadModel(page);
    await dispatch(page, { type: 'setViewMode', mode: '3d' });
    await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as { fit(): void };
      viewer.fit();
    });
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    const frame = await sceneFrame(page);
    const now = await drawn(page);
    const view = { now, origin: frame?.origin ?? [0, 0, 0] };
    const map = await mapColour(page);
    // The four corners of the top of the model, a little inside (the elevation of a fit is 45 degrees, so the top is seen): in the picture,
    // and the colour of the top.
    for (const [east, north] of [
      [4, 4],
      [76, 4],
      [76, 76],
      [4, 76],
    ] as const) {
      const at = pixelOf3d(now, view.origin, [EAST + east, NORTH + north, 40]);
      expect(at).toBeDefined();
      expect(at?.x ?? -1).toBeGreaterThan(0);
      expect(at?.x ?? Infinity).toBeLessThan(now.width);
      expect(at?.y ?? -1).toBeGreaterThan(0);
      expect(at?.y ?? Infinity).toBeLessThan(now.height);
      const colour = await colourAt(page, view, east, north, 40);
      expect(
        distance(colour, map),
        `${String(east)},${String(north)} is the model`,
      ).toBeGreaterThan(30);
      expect(distance(colour, scaled(LAST, TOP))).toBeLessThanOrEqual(3);
    }
    // The whole box of the model, the corners that are not seen too (the bottom ones, which are behind the model, and the far ones): each is in the picture,
    // and between the planes in front of and behind the camera, so that nothing of the model is cut off by either.
    const perspective = now.perspective;
    expect(perspective).not.toBeNull();
    const near = perspective?.near ?? Infinity;
    const far = perspective?.far ?? 0;
    for (const east of [0, 80]) {
      for (const north of [0, 80]) {
        for (const up of [0, 40]) {
          const corner = `the corner ${String(east)},${String(north)},${String(up)}`;
          const depth = depthOf3d(now, view.origin, [EAST + east, NORTH + north, up]);
          expect(depth, `${corner} is in front of the far plane`).toBeLessThan(far);
          expect(depth, `${corner} is behind the near plane`).toBeGreaterThan(near);
          const at = pixelOf3d(now, view.origin, [EAST + east, NORTH + north, up]);
          expect(at, `${corner} is in front of the camera`).toBeDefined();
          expect(at?.x ?? -1, `${corner} is not left of the picture`).toBeGreaterThanOrEqual(0);
          expect(at?.x ?? Infinity, `${corner} is not right of it`).toBeLessThan(now.width);
          expect(at?.y ?? -1, `${corner} is not below it`).toBeGreaterThanOrEqual(0);
          expect(at?.y ?? Infinity, `${corner} is not above it`).toBeLessThan(now.height);
        }
      }
    }
  });
});
