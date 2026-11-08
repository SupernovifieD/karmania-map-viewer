/**
 * The render golden images of the 2D view (section 10.8 of the phase 2 brief): a map canvas of 800 by 600 pixels in the browser of the Docker
 * image, light and dark, one picture for each case: each kind of layer, class colours, rotation, draw order and precision. The data is
 * the sample files of the repository and a few small files made here. Run with `pnpm test:visual`; `pnpm test:visual:update` takes
 * them again, and every new picture has to be looked at before it is committed. A difference is a failure, however small.
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectGolden, lookAt, settled, sizeMap, THEMES } from './support/golden.js';
import { fixture, projectionFor } from './support/fixtures.js';
import { dispatch, loadLattice } from './support/render.js';
import { goTo, importAndLoad, startWizard, wizard } from './support/wizard.js';
import type { Theme } from './support/golden.js';

test.use({ reducedMotion: 'reduce' });

const EAST = 500_000;
const NORTH = 2_765_000;
const CRS = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } };

/** A file made here. */
const made = (name: string, mimeType: string, text: string) => ({
  name,
  mimeType,
  buffer: Buffer.from(text),
});

const geojson = (name: string, features: readonly object[]) =>
  made(
    name,
    'application/geo+json',
    JSON.stringify({ type: 'FeatureCollection', crs: CRS, features }),
  );

/** A square of `size` metres from `(east, north)`, with a square hole of `hole` metres in the middle of it if there is one. */
function polygon(east: number, north: number, size: number, grade: number | null, hole = 0) {
  const ring = (e: number, n: number, s: number, clockwise: boolean) => {
    const corners = [
      [e, n],
      [e + s, n],
      [e + s, n + s],
      [e, n + s],
      [e, n],
    ];
    return clockwise ? corners.reverse() : corners;
  };
  const rings = [ring(east, north, size, false)];
  if (hole > 0) {
    rings.push(ring(east + (size - hole) / 2, north + (size - hole) / 2, hole, true));
  }
  return {
    type: 'Feature',
    properties: { grade },
    geometry: { type: 'Polygon', coordinates: rings },
  };
}

/** A flat square of 100 m as an OBJ at `up` metres. */
function flat(name: string, east: number, north: number, up: number) {
  const corners = [
    [east, north],
    [east + 100, north],
    [east + 100, north + 100],
    [east, north + 100],
  ];
  const lines = [
    ...corners.map(([e = 0, n = 0]) => `v ${String(EAST + e)} ${String(NORTH + n)} ${String(up)}`),
    'f 1 2 3',
    'f 1 3 4',
    '',
  ];
  return made(name, 'text/plain', lines.join('\n'));
}

/** A plate and two pyramids of 100 m, 40 and 100 m high, as an OBJ: the faces are as dark as their slopes are steep. */
function hills() {
  const vertices: [number, number, number][] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
    [0, 100, 0],
    [150, 0, 0],
    [250, 0, 0],
    [250, 100, 0],
    [150, 100, 0],
    [200, 50, 40],
    [300, 0, 0],
    [400, 0, 0],
    [400, 100, 0],
    [300, 100, 0],
    [350, 50, 100],
  ];
  const faces = [
    [1, 2, 3],
    [1, 4, 3],
    [5, 6, 9],
    [6, 7, 9],
    [7, 8, 9],
    [8, 5, 9],
    [10, 11, 14],
    [11, 12, 14],
    [12, 13, 14],
    [13, 10, 14],
  ];
  const lines = [
    ...vertices.map(([e, n, u]) => `v ${String(EAST + e)} ${String(NORTH + n)} ${String(u)}`),
    ...faces.map((face) => `f ${face.join(' ')}`),
    '',
  ];
  return made('hills.obj', 'text/plain', lines.join('\n'));
}

/** A model of blocks has to be told how big its blocks are. */
async function importBlocks(page: Page): Promise<void> {
  const w = wizard(page);
  await startWizard(page, fixture('blocks.csv'), projectionFor('blocks.prj'));
  await goTo(page, 'mapping');
  const sizes = w.host.locator('karmania-mapping-step .block-size input');
  for (let axis = 0; axis < 3; axis += 1) {
    await sizes.nth(axis).fill('10');
  }
  for (const step of ['nodata', 'crs', 'review']) {
    await goTo(page, step);
  }
  await w.next.click();
}

/** A lattice of 5 by 4 cells of 10 metres, turned 30 degrees anticlockwise about its corner, with the values 1 to 20 (X fastest). */
const turned = (name: string) => ({
  name,
  crs: { kind: 'epsg', code: 32640 } as const,
  origin: [EAST, NORTH, 0] as const,
  spacing: [10, 10, 5] as const,
  dims: [5, 4, 1] as const,
  rotation: 30,
  values: Array.from({ length: 20 }, (_, index) => index + 1),
});

/** The middle of that lattice on the map: its own (25, 20) turned 30 degrees about the corner. */
const turnedMiddle = [
  EAST + 25 * Math.cos(Math.PI / 6) - 20 * Math.sin(Math.PI / 6),
  NORTH + 25 * Math.sin(Math.PI / 6) + 20 * Math.cos(Math.PI / 6),
] as const;

const BY = (column: string, method: string, classes: number) => ({
  mode: 'classes',
  column,
  method,
  classes,
  ramp: 'viridis',
  reverse: false,
});

/** One case: how to load its data (and style it), how many layers that makes, and where the camera is. */
interface Case {
  readonly name: string;
  readonly layers: number;
  readonly load: (page: Page) => Promise<void>;
  readonly view: (page: Page) => Promise<void>;
}

const CASES: readonly Case[] = [
  {
    name: 'points',
    layers: 1,
    load: (page) => importAndLoad(page, fixture('points.csv'), projectionFor('points.prj')),
    view: (page) => lookAt(page, [500_098, 2_765_113], 0.5),
  },
  {
    name: 'points-classes',
    layers: 1,
    load: async (page) => {
      await importAndLoad(page, fixture('points.csv'), projectionFor('points.prj'));
      await settled(page, 1);
      await dispatch(page, {
        type: 'setStyle',
        layerId: 'layer-1',
        patch: { colour: BY('Rock', 'categories', 3), pointSize: 12 },
      });
    },
    view: (page) => lookAt(page, [500_098, 2_765_113], 0.5),
  },
  {
    name: 'lines',
    layers: 1,
    load: async (page) => {
      await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
      await settled(page, 1);
      await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { lineWidth: 6 } });
    },
    view: (page) => lookAt(page, [500_130, 2_765_050], 0.5),
  },
  {
    name: 'polygons',
    layers: 1,
    load: (page) =>
      importAndLoad(page, geojson('lease.geojson', [polygon(EAST, NORTH, 100, null, 40)])),
    view: (page) => lookAt(page, [EAST + 50, NORTH + 50], 0.25),
  },
  {
    name: 'polygons-classes',
    layers: 1,
    load: async (page) => {
      await importAndLoad(
        page,
        geojson('graded.geojson', [
          polygon(EAST, NORTH, 40, 1),
          polygon(EAST + 60, NORTH, 40, 5),
          polygon(EAST + 120, NORTH, 40, null),
          polygon(EAST + 180, NORTH, 40, 3),
        ]),
      );
      await settled(page, 1);
      await dispatch(page, {
        type: 'setStyle',
        layerId: 'layer-1',
        patch: { colour: BY('grade', 'equal', 5) },
      });
    },
    view: (page) => lookAt(page, [EAST + 110, NORTH + 20], 0.4),
  },
  {
    name: 'mesh',
    layers: 1,
    load: (page) => importAndLoad(page, hills(), projectionFor('hills.prj')),
    view: (page) => lookAt(page, [EAST + 200, NORTH + 50], 0.6),
  },
  {
    name: 'grid',
    layers: 1,
    load: (page) => importAndLoad(page, fixture('grid.asc'), projectionFor('grid.prj')),
    view: (page) => lookAt(page, [EAST + 20, NORTH + 15], 0.1),
  },
  {
    name: 'blocks',
    layers: 1,
    load: importBlocks,
    view: (page) => lookAt(page, [EAST + 15, NORTH + 15], 0.2),
  },
  {
    name: 'rotation',
    layers: 1,
    load: (page) =>
      importAndLoad(page, geojson('lease.geojson', [polygon(EAST, NORTH, 100, null, 40)])),
    view: (page) => lookAt(page, [EAST + 50, NORTH + 50], 0.25, 30),
  },
  {
    // A grid turned 30 degrees (a lattice's rotation comes from no file: the viewer's `load` is the way in), 5 by 4 cells of 10 m with the values 1 to 20.
    name: 'grid-turned',
    layers: 1,
    load: async (page) => {
      await loadLattice(page, 'grid', turned('grid'));
    },
    view: (page) => lookAt(page, turnedMiddle, 0.2),
  },
  {
    // The same as blocks: the boxes are turned about their own centres, so that the model is one turned rectangle of squares.
    name: 'blocks-turned',
    layers: 1,
    load: async (page) => {
      await loadLattice(page, 'blocks', turned('blocks'));
    },
    view: (page) => lookAt(page, turnedMiddle, 0.2),
  },
  {
    name: 'order',
    layers: 2,
    load: async (page) => {
      await importAndLoad(page, flat('a.obj', 0, 0, 100), projectionFor('a.prj'));
      await settled(page, 1);
      await importAndLoad(page, flat('b.obj', 50, 50, 0), projectionFor('b.prj'));
    },
    view: (page) => lookAt(page, [EAST + 75, NORTH + 75], 0.4),
  },
  {
    name: 'precision',
    layers: 1,
    load: async (page) => {
      await importAndLoad(
        page,
        geojson(
          'precise.geojson',
          [
            [500_123.45, 2_765_432.1],
            [500_123.46, 2_765_432.1],
            [500_000, 2_765_000],
            [500_200, 2_765_500],
          ].map((coordinates) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates },
          })),
        ),
      );
      await settled(page, 1);
      await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { pointSize: 4 } });
    },
    view: (page) => lookAt(page, [500_123.455, 2_765_432.1], 0.001),
  },
];

for (const item of CASES) {
  test(`the render golden image "${item.name}", light and dark`, async ({ page }) => {
    for (const theme of THEMES satisfies readonly Theme[]) {
      await page.goto(`/?theme=${theme}`);
      await sizeMap(page);
      await item.load(page);
      await settled(page, item.layers);
      await item.view(page);
      await expectGolden(page, item.name, theme);
    }
  });
}
