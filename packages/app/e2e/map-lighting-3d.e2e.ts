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
  loadLattice,
  sceneFrame,
  stats,
} from './support/render.js';
import { fixture } from './support/fixtures.js';
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

/** A block of 100 metres a side, from `(EAST, NORTH, 0)`, turned about that corner. */
const SIDE = 100;

/** A point of the block's own axes (metres from its corner), as a point of the map, for a block that is turned `turn` degrees about its corner. */
function onTheBlock(local: Vertex, turn: number): Vertex {
  const angle = (turn * Math.PI) / 180;
  return [
    local[0] * Math.cos(angle) - local[1] * Math.sin(angle),
    local[0] * Math.sin(angle) + local[1] * Math.cos(angle),
    local[2],
  ];
}

/** The six faces of the block: the middle of each along the block's own axes, and the normal of each. */
const BLOCK_FACES: readonly { name: string; at: Vertex; normal: Vertex }[] = [
  { name: 'top', at: [SIDE / 2, SIDE / 2, SIDE], normal: [0, 0, 1] },
  { name: 'bottom', at: [SIDE / 2, SIDE / 2, 0], normal: [0, 0, -1] },
  { name: 'its -x face', at: [0, SIDE / 2, SIDE / 2], normal: [-1, 0, 0] },
  { name: 'its +x face', at: [SIDE, SIDE / 2, SIDE / 2], normal: [1, 0, 0] },
  { name: 'its -y face', at: [SIDE / 2, 0, SIDE / 2], normal: [0, -1, 0] },
  { name: 'its +y face', at: [SIDE / 2, SIDE, SIDE / 2], normal: [0, 1, 0] },
];

async function loadBlock(page: Page, rotation: number): Promise<void> {
  await page.goto('/?theme=light');
  await loadLattice(page, 'blocks', {
    name: 'cube',
    crs: { kind: 'epsg', code: 32640 },
    origin: [EAST, NORTH, 0],
    spacing: [SIDE, SIDE, SIDE],
    dims: [1, 1, 1],
    rotation,
    values: [5],
  });
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await dispatch(page, {
    type: 'setStyle',
    layerId: 'layer-1',
    patch: { colour: { mode: 'single', value: '#56b4e9' } },
  });
  await drawn(page);
}

/** Looks at the middle of the cube, 300 metres away, from `heading` and `elevation`, in 3D. */
async function lookAtBlock(page: Page, turn: number, heading: number, elevation: number) {
  const middle = onTheBlock([SIDE / 2, SIDE / 2, 0], turn);
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [EAST + middle[0], NORTH + middle[1], SIDE / 2],
          distance: 350,
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
  return { now: await drawn(page), origin: frame.origin };
}

test.describe('blocks in 3D', () => {
  for (const [turn, heading, elevation] of [
    [0, 45, 35],
    [0, 225, 50],
    [30, 100, 40],
    [30, 310, 25],
  ] as const) {
    test(`light each side of a block that is turned ${String(turn)} degrees by the face it has, seen from heading ${String(heading)} at ${String(elevation)} degrees up`, async ({
      page,
    }) => {
      await loadBlock(page, turn);
      const colour = bytes(await layerColour(page));
      const view = await lookAtBlock(page, turn, heading, elevation);
      const camera3d = view.now.perspective;
      expect(camera3d).not.toBeNull();
      let seen = 0;
      for (const face of BLOCK_FACES) {
        const turned = onTheBlock(face.at, turn);
        const normal = onTheBlock(face.normal, turn);
        const at: Vertex = [turned[0], turned[1], face.at[2]];
        const here = pixelOf3d(view.now, view.origin, [EAST + at[0], NORTH + at[1], at[2]]);
        // A face is looked at if the camera is clearly on the side that it faces.
        const eye = camera3d?.position ?? [0, 0, 0];
        const toEye: Vertex = [
          eye[0] - (EAST + at[0] - view.origin[0]),
          eye[1] - (NORTH + at[1] - view.origin[1]),
          eye[2] - (at[2] - view.origin[2]),
        ];
        const facing =
          (toEye[0] * normal[0] + toEye[1] * normal[1] + toEye[2] * face.normal[2]) /
          Math.hypot(...toEye);
        if (here === undefined || facing < 0.25) {
          continue;
        }
        seen += 1;
        const wanted = colour.map(
          (channel) => channel * shadeOf([normal[0], normal[1], face.normal[2]]),
        );
        expect(
          distance((await around(page, here.x, here.y, 0)).at(0, 0), wanted),
          face.name,
        ).toBeLessThanOrEqual(3);
      }
      // Three faces of a cube show from a corner, and at least two from anywhere that is not along an axis.
      expect(seen).toBeGreaterThanOrEqual(2);
    });
  }

  test('lights the top of a block as the plate of a mesh is lit, and a side that faces away from the light as the ambient only', async ({
    page,
  }) => {
    await loadBlock(page, 0);
    const colour = bytes(await layerColour(page));
    // From the south-west, 35 degrees up: the top, the south side (which faces away from the light) and the west side (which faces it a little).
    const view = await lookAtBlock(page, 0, 45, 35);
    const top = (await around(page, ...pixelCoordinates(view, [SIDE / 2, SIDE / 2, SIDE]), 0)).at(
      0,
      0,
    );
    const south = (await around(page, ...pixelCoordinates(view, [SIDE / 2, 0, SIDE / 2]), 0)).at(
      0,
      0,
    );
    expect(
      distance(
        top,
        colour.map((c) => c * (AMBIENT + (1 - AMBIENT) * Math.SQRT1_2)),
      ),
    ).toBeLessThanOrEqual(3);
    expect(
      distance(
        south,
        colour.map((c) => c * AMBIENT),
      ),
    ).toBeLessThanOrEqual(3);
  });
});

/** The pixel of a point `local` of the block that is not turned, as the two numbers `around` takes. */
function pixelCoordinates(
  view: Awaited<ReturnType<typeof lookAtBlock>>,
  local: Vertex,
): [number, number] {
  const pixel = pixelOf3d(view.now, view.origin, [EAST + local[0], NORTH + local[1], local[2]]);
  if (pixel === undefined) {
    throw new Error('The point is behind the camera.');
  }
  return [pixel.x, pixel.y];
}

test.describe('points and lines in 3D', () => {
  /** True if one of the nine pixels round `(x, y)` is the colour, to within 2 of a byte: the thing is a pixel or two wide, and the projection rounds. */
  async function isThere(page: Page, at: { x: number; y: number }, colour: number[]) {
    const block = await around(page, at.x, at.y, 1);
    return block.all().some(([, , pixel]) => distance(pixel, colour) <= 2);
  }

  test('are not lit: a point and a line are the colour of their layer from two different sides, as a lit face would not be', async ({
    page,
  }) => {
    for (const [file, spot] of [
      ['points', [500010.5, 2765020.25, 120.4]],
      ['lines', [500025, 2765020, 101]],
    ] as const) {
      await page.goto('/?theme=light');
      await importAndLoad(page, fixture(`${file}.csv`), fixture('points.prj', `${file}.prj`));
      await drawn(page);
      await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
      await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
      const colour = bytes(await layerColour(page));
      for (const [heading, elevation] of [
        [0, 60],
        [130, 30],
      ] as const) {
        await dispatch(
          page,
          {
            type: 'setCamera',
            patch: {
              camera3d: {
                target: [spot[0], spot[1], spot[2]],
                distance: 120,
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
        const now = await drawn(page);
        const at = pixelOf3d(now, frame?.origin ?? [0, 0, 0], spot);
        expect(at, `${file} at ${String(heading)}`).toBeDefined();
        expect(
          await isThere(page, at ?? { x: 0, y: 0 }, colour),
          `${file} from heading ${String(heading)}, ${String(elevation)} degrees up`,
        ).toBe(true);
      }
    }
  });
});

/**
 * The vertical exaggeration (step 18.7a): the heights of every layer are multiplied about the origin, in 3D, and the camera looks at the same
 * place in the data. The pyramid of the mesh above has a rise of 50 over a run of 50, so under an exaggeration of 3 its faces have a rise of 150 over
 * a run of 50, and are seen and lit as slopes of that steepness.
 */
test.describe('the vertical exaggeration', () => {
  /** The shade of the west face (`[-1, 0, s]` with `s` the rise over the run, as a unit vector) under the light of 3D. */
  const westShade = (rise: number): number => {
    const length = Math.hypot(rise, 1);
    return shadeOf([-rise / length, 0, 1 / length]);
  };

  async function lookExaggerated(page: Page, factor: number, heading = 0) {
    await dispatch(page, { type: 'setVerticalExaggeration', factor });
    const view = await lookFrom(page, heading, 55);
    return view;
  }

  /** The colour of the picture at a point of the model, whose heights are multiplied by `factor` in the picture. */
  async function atExaggerated(
    page: Page,
    view: Awaited<ReturnType<typeof lookFrom>>,
    at: Vertex,
    factor: number,
  ): Promise<number[]> {
    const pixel = pixelOf3d(view.now, view.origin, [EAST + at[0], NORTH + at[1], at[2]], factor);
    if (pixel === undefined) {
      throw new Error('The point is behind the camera.');
    }
    return (await around(page, pixel.x, pixel.y, 0)).at(0, 0);
  }

  const WEST_FACE = SPOTS.find((spot) => spot.name === 'the west face');
  const PLATE = SPOTS.find((spot) => spot.name === 'the plate');

  for (const factor of [1, 2, 3, 5, 10]) {
    test(`multiplies the heights by ${String(factor)} about the origin: the slope is as steep as that, in the shade it has and at the pixel it lands on`, async ({
      page,
    }) => {
      await loadMesh(page);
      const colour = bytes(await layerColour(page));
      const view = await lookExaggerated(page, factor);
      const face = WEST_FACE;
      const plate = PLATE;
      expect(face).toBeDefined();
      expect(plate).toBeDefined();
      // The middle of the west face is at a third of the height of the apex, 50 / 3 m: at `factor` times that in the picture.
      const seen = await atExaggerated(page, view, face?.at ?? [0, 0, 0], factor);
      expect(
        distance(
          seen,
          colour.map((c) => c * westShade(factor)),
        ),
      ).toBeLessThanOrEqual(3);
      // The plate lies at the height of the origin, and is where it is, with the shade of a plate, whatever the factor.
      const flat = await atExaggerated(page, view, plate?.at ?? [0, 0, 0], factor);
      expect(
        distance(
          flat,
          colour.map((c) => c * shadeOf([0, 0, 1])),
        ),
      ).toBeLessThanOrEqual(3);
    });
  }

  test('is not applied in the view from above: the picture of the slopes there is the same under any factor', async ({
    page,
  }) => {
    await loadMesh(page);
    const colour = bytes(await layerColour(page));
    const now2d = await camera(page);
    // From above, the shade of a slope is that of its own steepness, 50 over 50, whatever the exaggeration that 3D has is.
    await dispatch(page, { type: 'setVerticalExaggeration', factor: 10 });
    const buffer = await drawn(page);
    const west = FACES_WEST_2D;
    const x = Math.floor(
      buffer.width / 2 +
        ((EAST + west[0] - now2d.centre[0]) / now2d.unitsPerPixel) * buffer.pixelRatio,
    );
    const y = Math.floor(
      buffer.height / 2 +
        ((NORTH + west[1] - now2d.centre[1]) / now2d.unitsPerPixel) * buffer.pixelRatio,
    );
    const seen = (await around(page, x, y, 0)).at(0, 0);
    // The light from above: 0.25 + 0.75 of the part of the slope that faces up, for a rise of 50 over a run of 50.
    const wanted = AMBIENT + (1 - AMBIENT) * Math.SQRT1_2;
    expect(
      distance(
        seen,
        colour.map((c) => c * wanted),
      ),
    ).toBeLessThanOrEqual(3);
  });
});

/** A point on the west face of the pyramid, east and north of the corner of the model, as the view from above sees it. */
const FACES_WEST_2D = [150 + 50 / 3, 50] as const;
