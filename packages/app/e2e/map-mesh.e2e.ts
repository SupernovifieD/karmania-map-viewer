import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { projectionFor } from './support/fixtures.js';
import {
  around,
  bytes,
  camera,
  dispatch,
  distance,
  drawn,
  layerColour,
  layerStatuses,
  stats,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/** Where the meshes are, in UTM zone 40 north (the projection file of the fixtures): the middle of what they are is in `CENTRE`. */
const EAST = 500_000;
const NORTH = 2_765_000;
const CENTRE = [EAST + 200, NORTH + 50] as const;

/** How much of the colour a triangle that faces away from the light keeps (`MESH_AMBIENT` of the renderer). */
const AMBIENT = 0.25;

/** The shade of a triangle that slopes by `rise` over `run`: the light is straight above, so the part of it that a triangle takes is how much it faces up. */
const shadeOf = (rise: number, run: number): number =>
  AMBIENT + (1 - AMBIENT) * (run / Math.hypot(rise, run));

type Vertex = readonly [east: number, north: number, up: number];

/** An OBJ file of triangles (vertices as metres from the corner, in the order given) named `name`, with the projection file it is to be paired with. */
function objectFile(name: string, vertices: readonly Vertex[], faces: readonly number[][]) {
  const text = [
    ...vertices.map(([e, n, u]) => `v ${String(EAST + e)} ${String(NORTH + n)} ${String(u)}`),
    ...faces.map((face) => `f ${face.map((index) => String(index + 1)).join(' ')}`),
  ].join('\n');
  return {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(`${text}\n`),
  };
}

/**
 * A square plate at height 0 (two triangles, wound opposite ways), and two pyramids of a base of 100 m, one of a height of 40 m and
 * one of 100 m: the faces of a pyramid have the slope of the height over 50 m, whichever way they face.
 */
const HILLS: [readonly Vertex[], number[][]] = [
  [
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
    [0, 100, 0],
    // The low pyramid, with its apex last of its five.
    [150, 0, 0],
    [250, 0, 0],
    [250, 100, 0],
    [150, 100, 0],
    [200, 50, 40],
    // The high one.
    [300, 0, 0],
    [400, 0, 0],
    [400, 100, 0],
    [300, 100, 0],
    [350, 50, 100],
  ],
  [
    [0, 1, 2],
    [0, 3, 2],
    [4, 5, 8],
    [5, 6, 8],
    [6, 7, 8],
    [7, 4, 8],
    [9, 10, 13],
    [10, 11, 13],
    [11, 12, 13],
    [12, 9, 13],
  ],
];

async function loadMesh(
  page: Page,
  model: readonly [readonly Vertex[], number[][]] = HILLS,
): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(
    page,
    objectFile('hills.obj', model[0], model[1]),
    projectionFor('hills.prj'),
  );
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

/** Looks at the middle of the meshes at 1 unit a pixel, turned by `heading` degrees. */
async function look(page: Page, heading = 0): Promise<{ width: number; height: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: CENTRE, unitsPerPixel: 1, heading } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height };
}

/** The pixel of the point `(east, north)` metres from the corner of the meshes, for a view turned by `heading` (0 or 180 here). */
function pixelOf(
  view: { width: number; height: number },
  east: number,
  north: number,
  heading = 0,
): { x: number; y: number } {
  const sign = heading === 180 ? -1 : 1;
  return {
    x: Math.floor(view.width / 2 + sign * (east - 200)),
    y: Math.floor(view.height / 2 + sign * (north - 50)),
  };
}

/** `colour` darkened to `shade` of itself: what a triangle lit so much is, in an opaque layer. */
const shaded = (colour: readonly number[], shade: number): number[] =>
  colour.slice(0, 3).map((c) => c * shade);

/** What the pixel at `(east, north)` is, in bytes. */
async function pixelAt(
  page: Page,
  view: { width: number; height: number },
  east: number,
  north: number,
  heading = 0,
): Promise<number[]> {
  const p = pixelOf(view, east, north, heading);
  return (await around(page, p.x, p.y, 0)).at(0, 0);
}

/** A point inside each face of each pyramid, away from its edges, and the slope of the face. */
const FACES: readonly { name: string; east: number; north: number; rise: number }[] = [
  { name: 'low, south', east: 200, north: 20, rise: 40 },
  { name: 'low, east', east: 230, north: 50, rise: 40 },
  { name: 'low, north', east: 200, north: 80, rise: 40 },
  { name: 'low, west', east: 170, north: 50, rise: 40 },
  { name: 'high, south', east: 350, north: 20, rise: 100 },
  { name: 'high, east', east: 380, north: 50, rise: 100 },
  { name: 'high, north', east: 350, north: 80, rise: 100 },
  { name: 'high, west', east: 320, north: 50, rise: 100 },
];

test.describe('the mesh layer', () => {
  test('is the colour of the layer where the mesh lies flat, from either side of the triangle, and the map where there is none', async ({
    page,
  }) => {
    await loadMesh(page);
    const view = await look(page);
    const colour = bytes(await layerColour(page));
    const map = await mapColour(page);
    // One point in each of the two triangles of the plate, which are wound opposite ways.
    for (const [east, north] of [
      [70, 25],
      [25, 70],
    ] as const) {
      expect(
        distance(await pixelAt(page, view, east, north), colour),
        `${String(east)},${String(north)}`,
      ).toBeLessThanOrEqual(2);
    }
    // Between the plate and the pyramids, and above everything.
    for (const [east, north] of [
      [125, 50],
      [275, 50],
      [200, 130],
    ] as const) {
      expect(await pixelAt(page, view, east, north), `${String(east)},${String(north)}`).toEqual(
        map,
      );
    }
  });

  test('darkens a slope by how steep it is, the same for every way it faces', async ({ page }) => {
    await loadMesh(page);
    const view = await look(page);
    const colour = bytes(await layerColour(page));
    for (const face of FACES) {
      expect(
        distance(
          await pixelAt(page, view, face.east, face.north),
          shaded(colour, shadeOf(face.rise, 50)),
        ),
        face.name,
      ).toBeLessThanOrEqual(3);
    }
    // The steeper one is darker than the gentler, which is darker than the flat.
    const flat = await pixelAt(page, view, 70, 25);
    const gentle = await pixelAt(page, view, 200, 20);
    const steep = await pixelAt(page, view, 350, 20);
    for (const channel of [0, 1, 2]) {
      const [f = 0, g = 0, s = 0] = [flat[channel], gentle[channel], steep[channel]];
      if (colour[channel] !== 0) {
        expect(f).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(s);
      }
    }
  });

  test('lights from straight above whichever way the map is turned: the slopes do not change with the heading', async ({
    page,
  }) => {
    await loadMesh(page);
    const view = await look(page, 180);
    const colour = bytes(await layerColour(page));
    for (const face of FACES) {
      expect(
        distance(
          await pixelAt(page, view, face.east, face.north, 180),
          shaded(colour, shadeOf(face.rise, 50)),
        ),
        face.name,
      ).toBeLessThanOrEqual(3);
    }
  });

  test('shows the highest part where triangles lie over each other, whichever is first in the file', async ({
    page,
  }) => {
    // A flat square at 0, and over it a steep triangle that is higher everywhere: the flat one is the colour of the layer, and the steep one
    // (it rises 170 over 60 across its middle) is darker. Each is first in the file in one of the two runs, and so is drawn after the other once.
    const flat: Vertex[] = [
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
    ];
    const steep: Vertex[] = [
      [20, 20, 30],
      [80, 20, 30],
      [50, 80, 200],
    ];
    // Its normal is (0, -10200, 3600): it faces up by 3600 of the 10817 that it is long.
    const darker = AMBIENT + (1 - AMBIENT) * (3600 / Math.hypot(10_200, 3600));
    for (const order of ['flat first', 'steep first'] as const) {
      const vertices = [...flat, ...steep];
      const faces =
        order === 'flat first'
          ? [
              [0, 1, 2],
              [0, 3, 2],
              [4, 5, 6],
            ]
          : [
              [4, 5, 6],
              [0, 1, 2],
              [0, 3, 2],
            ];
      await loadMesh(page, [vertices, faces]);
      await dispatch(page, {
        type: 'setCamera',
        patch: { camera2d: { centre: [EAST + 50, NORTH + 50], unitsPerPixel: 1, heading: 0 } },
      });
      const now = await drawn(page);
      const view = { width: now.width, height: now.height };
      const colour = bytes(await layerColour(page));
      const at = async (east: number, north: number) => {
        const p = {
          x: Math.floor(view.width / 2 + (east - 50)),
          y: Math.floor(view.height / 2 + (north - 50)),
        };
        return (await around(page, p.x, p.y, 0)).at(0, 0);
      };
      await expect
        .poll(async () => distance(await at(50, 40), shaded(colour, darker)), { message: order })
        .toBeLessThanOrEqual(3);
      // Where the steep triangle is not, the flat one is seen.
      expect(distance(await at(10, 10), colour), order).toBeLessThanOrEqual(2);
      expect(distance(await at(90, 90), colour), order).toBeLessThanOrEqual(2);
    }
  });

  test('changes with the opacity of the layer, over the map, and with its colour, without a new mesh', async ({
    page,
  }) => {
    await loadMesh(page);
    const view = await look(page);
    const map = await mapColour(page);
    const before = await drawn(page);
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    const own = bytes(await layerColour(page));
    // On the plate (shade 1): half the colour and half the map.
    await expect
      .poll(async () =>
        distance(
          await pixelAt(page, view, 70, 25),
          own.map((c, i) => c * 0.5 + (map[i] ?? 0) * 0.5),
        ),
      )
      .toBeLessThanOrEqual(3);
    // On a face of the low pyramid: the shaded colour at half.
    expect(
      distance(
        await pixelAt(page, view, 200, 20),
        shaded(own, shadeOf(40, 50)).map((c, i) => c * 0.5 + (map[i] ?? 0) * 0.5),
      ),
    ).toBeLessThanOrEqual(3);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { opacity: 1, colour: { mode: 'single', value: '#0072b2' } },
    });
    await expect
      .poll(async () => distance(await pixelAt(page, view, 70, 25), [0, 114, 178]))
      .toBeLessThanOrEqual(2);
    expect(
      distance(await pixelAt(page, view, 350, 20), shaded([0, 114, 178], shadeOf(100, 50))),
    ).toBeLessThanOrEqual(3);
    const after = await drawn(page);
    expect([after.layers, after.geometries]).toEqual([before.layers, before.geometries]);
  });

  test('is one geometry on the card, with the vertices once, and nothing left when the dataset is removed', async ({
    page,
  }) => {
    await loadMesh(page);
    const now = await drawn(page);
    expect([now.layers, now.geometries]).toEqual([1, 1]);
    await page
      .locator('karmania-dataset-list li')
      .first()
      .locator('.remove k-button button')
      .click();
    await page.locator('karmania-dataset-list k-button[slot="footer-end"]').click();
    await expect.poll(async () => (await stats(page))?.layers).toBe(0);
    expect((await stats(page))?.geometries).toBe(0);
    expect((await stats(page))?.textures).toBe(0);
  });
});
