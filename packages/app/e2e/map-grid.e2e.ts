import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
import {
  around,
  camera,
  dispatch,
  distance,
  drawn,
  layerStatuses,
  stats,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/** The ends of the viridis ramp, which the default style of a grid is coloured from: the first class and the last. */
const FIRST = [0x44, 0x01, 0x54];
const LAST = [0xfd, 0xe7, 0x25];

/** `grid.asc`: 4 by 3 cells of 10 m from (500000, 2765000) in UTM zone 40, the middle one of the middle row with no value. */
const CORNER = [500_000, 2_765_000] as const;
const CELL = 10;

type View = {
  width: number;
  height: number;
  ratio: number;
  centre: readonly [number, number];
  scale: number;
};

async function mapColour(page: Page): Promise<number[]> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const text = getComputedStyle(element).backgroundColor;
    return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
  });
}

/** How the scene colours the layer: by classes of the first column, as a grid is at first. */
async function styleOf(page: Page): Promise<object> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { layers: Record<string, { style: { colour: object } }> };
    };
    return viewer.scene().layers['layer-1']?.style.colour ?? {};
  });
}

/** Loads `grid.asc` and waits for it to be drawn. */
async function loadGrid(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, fixture('grid.asc'), projectionFor('grid.prj'));
  await drawn(page);
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

/** Looks at `centre` at `scale` map units to a pixel, and waits until the camera is there and a frame is drawn. */
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

/** The pixel of the point `(east, north)` in the map's units, with north up and the origin of the buffer at its bottom left. */
const pixelOf = (view: View, east: number, north: number) => ({
  x: Math.floor(view.width / 2 + ((east - view.centre[0]) / view.scale) * view.ratio),
  y: Math.floor(view.height / 2 + ((north - view.centre[1]) / view.scale) * view.ratio),
});

async function colourAt(page: Page, view: View, east: number, north: number): Promise<number[]> {
  const p = pixelOf(view, east, north);
  return (await around(page, p.x, p.y, 0)).at(0, 0);
}

/** The middle of the cell `(i, j)` of `grid.asc`, `j` counted from the south. */
const middleOf = (i: number, j: number): [number, number] => [
  CORNER[0] + (i + 0.5) * CELL,
  CORNER[1] + (j + 0.5) * CELL,
];

/** Looks at the middle of the grid at 1 unit a pixel: a cell is 10 pixels. */
const lookAtGrid = (page: Page) => look(page, [CORNER[0] + 2 * CELL, CORNER[1] + 1.5 * CELL], 1);

test.describe('the grid layer', () => {
  test('colours each cell by its class: the north row, which has the lowest values, is the first of the ramp and the south row, with the highest, the last', async ({
    page,
  }) => {
    await loadGrid(page);
    const view = await lookAtGrid(page);
    for (let i = 0; i < 4; i += 1) {
      // The south row (j = 0) is 30 to 33 and the north row (j = 2) is 10 to 13.
      expect(
        distance(await colourAt(page, view, ...middleOf(i, 2)), FIRST),
        `north ${String(i)}`,
      ).toBeLessThanOrEqual(2);
      expect(
        distance(await colourAt(page, view, ...middleOf(i, 0)), LAST),
        `south ${String(i)}`,
      ).toBeLessThanOrEqual(2);
    }
    // The middle row is 20, 21, no value, 23: the same class for the three that have one, which is neither the first nor the last.
    const middle = [
      await colourAt(page, view, ...middleOf(0, 1)),
      await colourAt(page, view, ...middleOf(1, 1)),
      await colourAt(page, view, ...middleOf(3, 1)),
    ];
    expect(distance(middle[0] ?? [], middle[1] ?? [])).toBeLessThanOrEqual(1);
    expect(distance(middle[0] ?? [], middle[2] ?? [])).toBeLessThanOrEqual(1);
    expect(distance(middle[0] ?? [], FIRST)).toBeGreaterThan(40);
    expect(distance(middle[0] ?? [], LAST)).toBeGreaterThan(40);
  });

  test('leaves the cell with no value, and the outside of the grid, to the map, exactly', async ({
    page,
  }) => {
    await loadGrid(page);
    const view = await lookAtGrid(page);
    const map = await mapColour(page);
    expect(await colourAt(page, view, ...middleOf(2, 1))).toEqual(map);
    for (const [east, north] of [
      [CORNER[0] - 5, CORNER[1] + 15],
      [CORNER[0] + 45, CORNER[1] + 15],
      [CORNER[0] + 20, CORNER[1] - 5],
      [CORNER[0] + 20, CORNER[1] + 35],
    ] as const) {
      expect(await colourAt(page, view, east, north), `${String(east)},${String(north)}`).toEqual(
        map,
      );
    }
  });

  test('shows the cell and nothing between cells: across the edge of two cells every pixel is one cell colour or the other', async ({
    page,
  }) => {
    await loadGrid(page);
    // 10 cells to the pixel's worth of zoom: a cell is 200 pixels across, so that there are pixels enough to be between.
    const view = await look(page, [CORNER[0] + 2 * CELL, CORNER[1] + 2 * CELL], 0.05);
    const above = await colourAt(page, view, ...middleOf(0, 2));
    const below = await colourAt(page, view, ...middleOf(0, 1));
    expect(distance(above, below)).toBeGreaterThan(40);
    // A column of pixels across the edge between the north row and the middle row, 60 pixels either side of it.
    const x = pixelOf(view, CORNER[0] + 5, 0).x;
    const edge = pixelOf(view, 0, CORNER[1] + 2 * CELL).y;
    const column = await around(page, x, edge, 60);
    const seen = new Set(
      column
        .all()
        .filter(([dx]) => dx === 0)
        .map(([, , px]) =>
          distance(px, above) <= 1 ? 'above' : distance(px, below) <= 1 ? 'below' : 'between',
        ),
    );
    expect([...seen].sort()).toEqual(['above', 'below']);
  });

  test('changes the colours with the ramp, without the engine: reversing it swaps the north row and the south', async ({
    page,
  }) => {
    await loadGrid(page);
    const view = await lookAtGrid(page);
    const before = await stats(page);
    const style = await styleOf(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, reverse: true } },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(0, 2)), LAST))
      .toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, view, ...middleOf(0, 0)), FIRST)).toBeLessThanOrEqual(2);
    // The same layer, the same one texture, nothing made again.
    const after = await drawn(page);
    expect([after.layers, after.geometries, after.textures]).toEqual([
      before?.layers,
      before?.geometries,
      before?.textures,
    ]);
  });

  test('changes the classes with the number of them: two classes put the cells at 23 with those at 30 and over, and 20 and 21 with the lowest', async ({
    page,
  }) => {
    await loadGrid(page);
    const view = await lookAtGrid(page);
    const style = await styleOf(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, classes: 2 } },
    });
    // The bounds are 10, 21.5 and 33: 20 and 21 are in the first class, 23 in the second.
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(3, 1)), LAST))
      .toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, view, ...middleOf(0, 1)), FIRST)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, view, ...middleOf(1, 1)), FIRST)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, view, ...middleOf(0, 2)), FIRST)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, view, ...middleOf(0, 0)), LAST)).toBeLessThanOrEqual(2);
  });

  test('keeps the rows apart when a row is not a multiple of 4 cells: 5 cells across, a row of one class each', async ({
    page,
  }) => {
    // A card unpacks rows to 4 bytes unless it is told otherwise, and a row of 5 would be sheared into the next.
    const row = (value: number) => Array.from({ length: 5 }, () => String(value)).join(' ');
    const asc = [
      'ncols 5',
      'nrows 3',
      'xllcorner 500000',
      'yllcorner 2765000',
      'cellsize 10',
      'NODATA_value -9999',
      row(1),
      row(50),
      row(100),
    ].join('\n');
    await page.goto('/?theme=light');
    await importAndLoad(
      page,
      { name: 'five.asc', mimeType: 'text/plain', buffer: Buffer.from(`${asc}\n`) },
      projectionFor('five.prj'),
    );
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    const view = await look(page, [CORNER[0] + 25, CORNER[1] + 15], 1);
    const middle = await colourAt(page, view, ...middleOf(0, 1));
    for (let i = 0; i < 5; i += 1) {
      expect(
        distance(await colourAt(page, view, ...middleOf(i, 2)), FIRST),
        `north ${String(i)}`,
      ).toBeLessThanOrEqual(2);
      expect(
        distance(await colourAt(page, view, ...middleOf(i, 0)), LAST),
        `south ${String(i)}`,
      ).toBeLessThanOrEqual(2);
      expect(
        distance(await colourAt(page, view, ...middleOf(i, 1)), middle),
        `middle ${String(i)}`,
      ).toBeLessThanOrEqual(1);
    }
    expect(distance(middle, FIRST)).toBeGreaterThan(40);
    expect(distance(middle, LAST)).toBeGreaterThan(40);
  });

  test('draws the cells that have a value in the one colour of the style, and leaves the cell with no value to the map', async ({
    page,
  }) => {
    await loadGrid(page);
    const view = await lookAtGrid(page);
    const map = await mapColour(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(0, 0)), [0, 114, 178]))
      .toBeLessThanOrEqual(2);
    for (let i = 0; i < 4; i += 1) {
      for (const j of [0, 2]) {
        expect(
          distance(await colourAt(page, view, ...middleOf(i, j)), [0, 114, 178]),
          `${String(i)},${String(j)}`,
        ).toBeLessThanOrEqual(2);
      }
    }
    expect(
      distance(await colourAt(page, view, ...middleOf(0, 1)), [0, 114, 178]),
    ).toBeLessThanOrEqual(2);
    expect(await colourAt(page, view, ...middleOf(2, 1))).toEqual(map);
    // A new colour is a new palette and nothing else: the same texture.
    const before = await drawn(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#d55e00' } },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(0, 0)), [213, 94, 0]))
      .toBeLessThanOrEqual(2);
    expect((await drawn(page)).textures).toBe(before.textures);
  });

  test('takes the opacity of the layer, over the map', async ({ page }) => {
    await loadGrid(page);
    const view = await lookAtGrid(page);
    const map = await mapColour(page);
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    const expected = LAST.map((c, i) => c * 0.5 + (map[i] ?? 0) * 0.5);
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(0, 0)), expected))
      .toBeLessThanOrEqual(3);
  });

  test('is one geometry and one texture on the card, and nothing left when the dataset is removed', async ({
    page,
  }) => {
    await loadGrid(page);
    const now = await drawn(page);
    expect([now.layers, now.geometries, now.textures]).toEqual([1, 1, 1]);
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

  test('is a grid that is a mesh of its tiles when it is in another coordinate system, with no gap between cells and north at the top', async ({
    page,
  }) => {
    // 4 by 3 cells of a thousandth of a degree, from 57 east (the middle of UTM zone 40) and 25 north: about 400 m by 330 m.
    const rows = ['10 11 12 13', '20 21 22 23', '30 31 32 33'];
    const asc = [
      'ncols 4',
      'nrows 3',
      'xllcorner 57',
      'yllcorner 25',
      'cellsize 0.001',
      'NODATA_value -9999',
      ...rows,
    ].join('\n');
    const wgs84 =
      'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
    await page.goto('/?theme=light');
    await importAndLoad(
      page,
      { name: 'geo.asc', mimeType: 'text/plain', buffer: Buffer.from(`${asc}\n`) },
      { name: 'geo.prj', mimeType: 'text/plain', buffer: Buffer.from(wgs84) },
    );
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    // The map is UTM zone 40, and the grid is warped into it: look at its middle at a metre to the pixel.
    const frame = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { frame: { mapCrs: { code: number } } };
      };
      return viewer.scene().frame.mapCrs.code;
    });
    expect(frame).toBe(32640);
    const where = await camera(page);
    const view = await look(page, where.centre, 1);
    const map = await mapColour(page);
    const [first, second, third, fourth] = [
      await colourAt(page, view, where.centre[0], where.centre[1] + 120),
      await colourAt(page, view, where.centre[0], where.centre[1]),
      await colourAt(page, view, where.centre[0], where.centre[1] - 120),
      await colourAt(page, view, where.centre[0] + 150, where.centre[1] - 120),
    ];
    // The north row is the lowest class and the south row the highest, as in the grid that is not warped.
    expect(distance(first, FIRST)).toBeLessThanOrEqual(2);
    expect(distance(third, LAST)).toBeLessThanOrEqual(2);
    expect(distance(second, map)).toBeGreaterThan(40);
    expect(distance(fourth, map)).toBeGreaterThan(40);
    // No gap inside it: every pixel of a block well inside the grid has a colour of a class.
    const block = await around(
      page,
      pixelOf(view, ...where.centre).x,
      pixelOf(view, ...where.centre).y,
      60,
    );
    expect(block.all().filter(([, , px]) => distance(px, map) <= 2)).toEqual([]);
    expect((await drawn(page)).geometries).toBe(1);
  });
});

test.describe('a grid wider than the card has a texture for', () => {
  test('is in tiles that meet with no gap and no overlap', async ({ page }) => {
    // What the card takes is only known once there is a card: a small grid, drawn, tells.
    await page.goto('/?theme=light');
    await importAndLoad(page, fixture('grid.asc'), projectionFor('grid.prj'));
    const limit = (await drawn(page)).maxTextureSize;
    // A row of `limit + 20` cells of a metre: the first `limit` have a low value and the last 20 a high one.
    const columns = limit + 20;
    const values = Array.from({ length: columns }, (_, i) => (i < limit ? '1' : '100')).join(' ');
    const asc = [
      `ncols ${String(columns)}`,
      'nrows 12',
      'xllcorner 500000',
      'yllcorner 2765000',
      'cellsize 1',
      'NODATA_value -9999',
      ...Array.from({ length: 12 }, () => values),
    ].join('\n');
    await page.goto('/?theme=light');
    await importAndLoad(
      page,
      { name: 'wide.asc', mimeType: 'text/plain', buffer: Buffer.from(`${asc}\n`) },
      projectionFor('wide.prj'),
    );
    await drawn(page);
    await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
    // Two tiles, so two textures and two geometries.
    expect([(await drawn(page)).textures, (await drawn(page)).geometries]).toEqual([2, 2]);
    // The seam is `limit` metres from the corner: a metre to a pixel, 10 pixels each side of it, along the row.
    const view = await look(page, [500_000 + limit, 2_765_006], 1);
    const seam = pixelOf(view, 500_000 + limit, 2_765_006);
    const strip = await around(page, seam.x, seam.y, 10);
    const row = strip.all().filter(([, dy]) => dy === 0);
    expect(row).toHaveLength(21);
    const map = await mapColour(page);
    for (const [dx, , px] of row) {
      // Left of the seam is the low class and right of it the high one; nothing is the map, and nothing is in between. (The pixel the seam
      // is in, if it is in the middle of one, is one or the other.)
      const expected = dx < 0 ? [FIRST] : dx > 0 ? [LAST] : [FIRST, LAST];
      expect(
        Math.min(...expected.map((colour) => distance(px, colour))),
        `${String(dx)} from the seam`,
      ).toBeLessThanOrEqual(2);
      expect(distance(px, map)).toBeGreaterThan(40);
    }
    // Four cells to a pixel, the card has to pick one of them for each: the class of one cell, never a mix of the two sides and never
    // nothing (a texture that is not made for being shrunk is drawn black).
    const far = await look(page, [500_000 + limit, 2_765_006], 4);
    const farSeam = pixelOf(far, 500_000 + limit, 2_765_006);
    const farRow = (await around(page, farSeam.x, farSeam.y, 3)).all().filter(([, dy]) => dy === 0);
    for (const [dx, , px] of farRow) {
      if (dx === 0) {
        continue;
      }
      expect(
        distance(px, dx < 0 ? FIRST : LAST),
        `${String(dx)} from the seam, shrunk`,
      ).toBeLessThanOrEqual(2);
    }
  });
});
