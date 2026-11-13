import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { projectionFor } from './support/fixtures.js';
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
  sceneFrame,
  stats,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/**
 * The light of a mesh in the 3D view (step 18.4a). In 3D the light is fixed in the world, from the north-west and 45 degrees above the horizon, so
 * a face has the same shade whichever way the camera goes round it; in the view from above it is straight up and a slope is as dark as it is steep
 * whichever way it faces (map-mesh.e2e.ts). A plate that lies flat and a pyramid whose four faces slope 45 degrees (a rise of 50 over a run of 50) are
 * seen from four headings, and the pixel at the middle of each face is the colour of the layer at the shade that face has.
 */

const EAST = 500_000;
const NORTH = 2_765_000;
const AMBIENT = 0.25;

/** The light, to the north-west and 45 degrees up: `[-0.5, 0.5, sqrt(1/2)]`. */
const LIGHT = [-0.5, 0.5, Math.SQRT1_2] as const;

/** The shade of a face whose unit normal is `normal`: the ambient, and the rest in proportion to how much the face turns to the light. */
const shadeOf = (normal: readonly [number, number, number]): number =>
  AMBIENT +
  (1 - AMBIENT) * Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);

type Vertex = readonly [east: number, north: number, up: number];

const VERTICES: readonly Vertex[] = [
  // The plate, flat at 0.
  [0, 0, 0],
  [100, 0, 0],
  [100, 100, 0],
  [0, 100, 0],
  // The pyramid, with its apex last of its five.
  [150, 0, 0],
  [250, 0, 0],
  [250, 100, 0],
  [150, 100, 0],
  [200, 50, 50],
];
const FACES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [0, 3, 2],
  [4, 5, 8],
  [5, 6, 8],
  [6, 7, 8],
  [7, 4, 8],
];

/** The faces to look at: a point at the middle of each triangle, and the normal that face has (pointing up and out). */
const SPOTS: readonly { name: string; at: Vertex; normal: readonly [number, number, number] }[] = [
  { name: 'the plate', at: [25, 70, 0], normal: [0, 0, 1] },
  { name: 'the plate, its other triangle', at: [70, 25, 0], normal: [0, 0, 1] },
  { name: 'the south face', at: [200, 100 / 6, 50 / 3], normal: [0, -Math.SQRT1_2, Math.SQRT1_2] },
  {
    name: 'the east face',
    at: [250 - 50 / 3, 50, 50 / 3],
    normal: [Math.SQRT1_2, 0, Math.SQRT1_2],
  },
  {
    name: 'the north face',
    at: [200, 100 - 100 / 6, 50 / 3],
    normal: [0, Math.SQRT1_2, Math.SQRT1_2],
  },
  {
    name: 'the west face',
    at: [150 + 50 / 3, 50, 50 / 3],
    normal: [-Math.SQRT1_2, 0, Math.SQRT1_2],
  },
];

async function loadMesh(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  const text = [
    ...VERTICES.map(([e, n, u]) => `v ${String(EAST + e)} ${String(NORTH + n)} ${String(u)}`),
    ...FACES.map((face) => `f ${face.map((index) => String(index + 1)).join(' ')}`),
  ].join('\n');
  await importAndLoad(
    page,
    { name: 'plate.obj', mimeType: 'text/plain', buffer: Buffer.from(`${text}\n`) },
    projectionFor('plate.prj'),
  );
  await drawn(page);
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

/** Looks at the middle of the pyramid, from `distance` away, at `elevation` degrees, towards `heading`, in 3D, and says what the renderer has. */
async function lookFrom(page: Page, heading: number, elevation = 60) {
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [EAST + 125, NORTH + 50, 15],
          distance: 450,
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
  if (frame === null) {
    throw new Error('The scene has no frame.');
  }
  const now = await drawn(page);
  return { now, origin: frame.origin };
}

/** The colour of the picture where `at` is, read back. */
async function colourAt(
  page: Page,
  view: Awaited<ReturnType<typeof lookFrom>>,
  at: Vertex,
): Promise<number[]> {
  const pixel = pixelOf3d(view.now, view.origin, [EAST + at[0], NORTH + at[1], at[2]]);
  if (pixel === undefined) {
    throw new Error('The point is behind the camera.');
  }
  return (await around(page, pixel.x, pixel.y, 0)).at(0, 0);
}

test.describe('the mesh layer in 3D', () => {
  for (const heading of [0, 110, 200, 290]) {
    test(`is lit from the north-west whichever way the camera goes round it (heading ${String(heading)})`, async ({
      page,
    }) => {
      await loadMesh(page);
      const colour = bytes(await layerColour(page));
      const view = await lookFrom(page, heading);
      for (const spot of SPOTS) {
        const wanted = colour.map((channel) => channel * shadeOf(spot.normal));
        expect(
          distance(await colourAt(page, view, spot.at), wanted),
          spot.name,
        ).toBeLessThanOrEqual(3);
      }
    });
  }

  test('shows the slopes that face the light lighter than those that face away, which the view from above does not', async ({
    page,
  }) => {
    await loadMesh(page);
    const colour = bytes(await layerColour(page));
    const view = await lookFrom(page, 20);
    const [west, north, south, east] = await Promise.all(
      ['the west face', 'the north face', 'the south face', 'the east face'].map((name) => {
        const spot = SPOTS.find((s) => s.name === name);
        if (spot === undefined) {
          throw new Error(name);
        }
        return colourAt(page, view, spot.at);
      }),
    );
    for (const channel of [0, 1, 2]) {
      if (colour[channel] === 0) {
        continue;
      }
      // West and north face the light by the same amount, and so do south and east face away from it by the same amount.
      expect(Math.abs((west?.[channel] ?? 0) - (north?.[channel] ?? 0))).toBeLessThanOrEqual(3);
      expect(Math.abs((south?.[channel] ?? 0) - (east?.[channel] ?? 0))).toBeLessThanOrEqual(3);
      expect(west?.[channel] ?? 0).toBeGreaterThan((south?.[channel] ?? 0) + 40);
    }
  });

  test('lights a flat plate by 0.25 + 0.75 * sqrt(1/2) of its colour in 3D, where the view from above lights it whole', async ({
    page,
  }) => {
    await loadMesh(page);
    const colour = bytes(await layerColour(page));
    // From above (the view the page starts in): the plate is the colour of the layer.
    const now2d = await camera(page);
    const flat2d = await dispatchAndRead2d(page, now2d);
    expect(distance(flat2d, colour)).toBeLessThanOrEqual(2);
    const view = await lookFrom(page, 0);
    const flat3d = await colourAt(page, view, [25, 70, 0]);
    const wanted = colour.map((channel) => channel * (AMBIENT + (1 - AMBIENT) * Math.SQRT1_2));
    expect(distance(flat3d, wanted)).toBeLessThanOrEqual(3);
    // And it is a different colour from the view from above, by more than what the rounding of a byte could make.
    expect(distance(flat3d, flat2d)).toBeGreaterThan(20);
  });
});

/** The colour of the plate (at 25 east and 70 north of its corner) in the view from above, at the camera the scene has: north up, as the page starts. */
async function dispatchAndRead2d(
  page: Page,
  now: { centre: readonly [number, number]; unitsPerPixel: number; heading: number },
): Promise<number[]> {
  const buffer = await drawn(page);
  const x = Math.floor(
    buffer.width / 2 + ((EAST + 25 - now.centre[0]) / now.unitsPerPixel) * buffer.pixelRatio,
  );
  const y = Math.floor(
    buffer.height / 2 + ((NORTH + 70 - now.centre[1]) / now.unitsPerPixel) * buffer.pixelRatio,
  );
  return (await around(page, x, y, 0)).at(0, 0);
}
