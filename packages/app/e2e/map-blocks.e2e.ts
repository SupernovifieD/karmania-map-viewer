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
import { goTo, startWizard, wizard } from './support/wizard.js';

/** The last colour of viridis, which the default style of a block model is coloured from: the class of the highest densities. */
const LAST = [0xfd, 0xe7, 0x25];
const FIRST = [0x44, 0x01, 0x54];

/** `blocks.csv`: 3 by 3 blocks of 10 m from (500000, 2765000), in two layers, at 95 and at 105 (10 m thick). */
const CORNER = [500_000, 2_765_000] as const;
const BLOCK = 10;

type View = { width: number; height: number; ratio: number; centre: readonly [number, number] };

/** A block model has to be told how big its blocks are, which the other files do not. `csv` is a file made on the spot, or `blocks.csv`. */
async function loadBlocks(
  page: Page,
  csv?: string,
  size: readonly [number, number, number] = [BLOCK, BLOCK, BLOCK],
): Promise<void> {
  await page.goto('/?theme=light');
  const w = wizard(page);
  await startWizard(
    page,
    csv === undefined
      ? fixture('blocks.csv')
      : { name: 'stack.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
    projectionFor(csv === undefined ? 'blocks.prj' : 'stack.prj'),
  );
  await goTo(page, 'mapping');
  const sizes = w.host.locator('karmania-mapping-step .block-size input');
  for (let axis = 0; axis < 3; axis += 1) {
    await sizes.nth(axis).fill(String(size[axis] ?? BLOCK));
  }
  for (const step of ['nodata', 'crs', 'review']) {
    await goTo(page, step);
  }
  await expect(w.host.locator('karmania-review-step .verdict')).toHaveText('Ready to load');
  await w.next.click();
  await expect(w.dialog).toBeHidden();
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

/** Looks at the middle of the model at 1 unit a pixel: a block is 10 pixels across. */
async function lookAtModel(page: Page): Promise<View> {
  const centre = [CORNER[0] + 1.5 * BLOCK, CORNER[1] + 1.5 * BLOCK] as const;
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre, unitsPerPixel: 1, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio, centre };
}

const pixelOf = (view: View, east: number, north: number) => ({
  x: Math.floor(view.width / 2 + (east - view.centre[0]) * view.ratio),
  y: Math.floor(view.height / 2 + (north - view.centre[1]) * view.ratio),
});

async function colourAt(page: Page, view: View, east: number, north: number): Promise<number[]> {
  const p = pixelOf(view, east, north);
  return (await around(page, p.x, p.y, 0)).at(0, 0);
}

/** The middle of the block `(i, j)` of a layer, `j` counted from the south. */
const middleOf = (i: number, j: number): [number, number] => [
  CORNER[0] + (i + 0.5) * BLOCK,
  CORNER[1] + (j + 0.5) * BLOCK,
];

/** How bright a colour is, which for viridis goes up with the class. */
const brightness = (colour: readonly number[]): number =>
  0.2126 * (colour[0] ?? 0) + 0.7152 * (colour[1] ?? 0) + 0.0722 * (colour[2] ?? 0);

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

/** How many pixels of the row through the middle of the model are not the map, looking 40 either side. */
async function modelWidthOnRow(page: Page, view: View): Promise<number> {
  const map = await mapColour(page);
  const middle = pixelOf(view, CORNER[0] + 1.5 * BLOCK, CORNER[1] + 1.5 * BLOCK);
  const row = (await around(page, middle.x, middle.y, 40 * view.ratio))
    .all()
    .filter(([, dy]) => dy === 0);
  return row.filter(([, , px]) => distance(px, map) > 2).length;
}

test.describe('the block layer', () => {
  test('colours each block by the class of its density, and where blocks are over each other the top one shows', async ({
    page,
  }) => {
    await loadBlocks(page);
    const view = await lookAtModel(page);
    // The densities of the top layer (at 105), from the south: 3.4 3.5 3.6 / 3.7 3.8 3.9 / 4.0 4.1 4.2. Of 7 classes of equal intervals from
    // 2.5 to 4.2 (every block of both layers) they are in classes 3 / 4 4 4 / 5 5 6 6 6, in rows: the south row 3 4 4, the middle 4 5 5, the
    // north 6 6 6.
    const at = async (i: number, j: number) => colourAt(page, view, ...middleOf(i, j));
    const top = await Promise.all([at(0, 2), at(1, 2), at(2, 2)]);
    for (const colour of top) {
      expect(distance(colour, LAST)).toBeLessThanOrEqual(2);
    }
    const [c00, c10, c20, c01, c11, c21] = await Promise.all([
      at(0, 0),
      at(1, 0),
      at(2, 0),
      at(0, 1),
      at(1, 1),
      at(2, 1),
    ]);
    // Blocks of one class are one colour, and the classes that are higher are brighter.
    expect(distance(c10, c20)).toBeLessThanOrEqual(1);
    expect(distance(c10, c01)).toBeLessThanOrEqual(1);
    expect(distance(c11, c21)).toBeLessThanOrEqual(1);
    expect(brightness(c00)).toBeLessThan(brightness(c10) - 5);
    expect(brightness(c10)).toBeLessThan(brightness(c11) - 5);
    expect(brightness(c11)).toBeLessThan(brightness(LAST) - 5);
    // The blocks under them, at 95, are of lower classes (2.5 to 3.3 are classes 0 to 3) and none of them shows: nothing is darker than the
    // darkest of the top layer, which is class 3.
    for (const colour of [c00, c10, c20, c01, c11, c21, ...top]) {
      expect(brightness(colour)).toBeGreaterThanOrEqual(brightness(c00) - 1);
    }
    expect(distance(c00, FIRST)).toBeGreaterThan(40);
  });

  for (const [order, pair] of [
    ['the upper block first in the file', ['500005,2765005,105,10,a', '500005,2765005,95,100,b']],
    ['the lower block first in the file', ['500005,2765005,95,100,b', '500005,2765005,105,10,a']],
  ] as const) {
    test(`shows the top of a stack of two blocks with ${order}, drawn once at the opacity of the layer`, async ({
      page,
    }) => {
      // The block at 105 is on top and the one at 95, a higher density, under it, in either order in the file: if the one drawn last were on top
      // it would be the last colour in one of them.
      // A block beside them, at 95, has a density in the middle.
      await loadBlocks(
        page,
        [
          'XC,YC,ZC,Density,Domain',
          ...pair,
          '500015,2765005,95,55,c',
          '500025,2765005,105,,n',
          '500025,2765005,95,55,m',
          '',
        ].join('\n'),
      );
      const centre = [CORNER[0] + 1.5 * BLOCK, CORNER[1] + BLOCK / 2] as const;
      await dispatch(page, {
        type: 'setCamera',
        patch: { camera2d: { centre, unitsPerPixel: 1, heading: 0 } },
      });
      const now = await drawn(page);
      const view: View = { width: now.width, height: now.height, ratio: now.pixelRatio, centre };
      const map = await mapColour(page);
      const stack = middleOf(0, 0);
      const beside = middleOf(1, 0);
      const empty = middleOf(2, 0);
      await expect
        .poll(async () => distance(await colourAt(page, view, ...stack), FIRST))
        .toBeLessThanOrEqual(2);
      expect(distance(await colourAt(page, view, ...beside), FIRST)).toBeGreaterThan(40);
      expect(distance(await colourAt(page, view, ...beside), LAST)).toBeGreaterThan(40);
      // The block with no value, which is over one that has, is not drawn and hides nothing: what is seen is the one under it, the colour of
      // the block beside, which has the same density.
      expect(
        distance(await colourAt(page, view, ...empty), await colourAt(page, view, ...beside)),
      ).toBeLessThanOrEqual(1);
      // Half opaque: the top block over the map and nothing of the one under it.
      await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
      const blended = FIRST.map((c, i) => c * 0.5 + (map[i] ?? 0) * 0.5);
      await expect
        .poll(async () => distance(await colourAt(page, view, ...stack), blended))
        .toBeLessThanOrEqual(3);
      // And the one with no value over the other is still not in the way: the lower block is seen, blended once, as the one beside it is.
      const lower = await colourAt(page, view, ...beside);
      expect(distance(await colourAt(page, view, ...empty), lower)).toBeLessThanOrEqual(1);
    });
  }

  test('draws the blocks that have a value in the one colour of the style, and a block with no value hides nothing', async ({
    page,
  }) => {
    await loadBlocks(
      page,
      [
        'XC,YC,ZC,Density,Domain',
        '500005,2765005,105,10,a',
        '500015,2765005,95,55,c',
        '500025,2765005,105,,n',
        '500025,2765005,95,55,m',
        '',
      ].join('\n'),
    );
    const centre = [CORNER[0] + 1.5 * BLOCK, CORNER[1] + BLOCK / 2] as const;
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre, unitsPerPixel: 1, heading: 0 } },
    });
    const now = await drawn(page);
    const view: View = { width: now.width, height: now.height, ratio: now.pixelRatio, centre };
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    for (const [i, j] of [
      [0, 0],
      [1, 0],
      [2, 0],
    ] as const) {
      await expect
        .poll(async () => distance(await colourAt(page, view, ...middleOf(i, j)), [0, 114, 178]), {
          message: `${String(i)},${String(j)}`,
        })
        .toBeLessThanOrEqual(2);
    }
  });

  test('is as wide as its blocks are along x and as long as they are along y: 10 by 20 metres', async ({
    page,
  }) => {
    // A row of three blocks, each 10 m along x and 20 m along y, 5 m thick: 30 pixels by 20 at a metre to a pixel.
    await loadBlocks(
      page,
      [
        'XC,YC,ZC,Density,Domain',
        '500005,2765010,100,1,a',
        '500015,2765010,100,2,b',
        '500025,2765010,100,3,c',
        '',
      ].join('\n'),
      [10, 20, 5],
    );
    const centre = [CORNER[0] + 15, CORNER[1] + 10] as const;
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre, unitsPerPixel: 1, heading: 0 } },
    });
    const now = await drawn(page);
    const view: View = { width: now.width, height: now.height, ratio: now.pixelRatio, centre };
    const map = await mapColour(page);
    const middle = pixelOf(view, centre[0], centre[1]);
    const block = await around(page, middle.x, middle.y, 40);
    const marked = block.all().filter(([, , px]) => distance(px, map) > 2);
    const across = marked.filter(([, dy]) => dy === 0).length;
    const up = marked.filter(([dx]) => dx === 0).length;
    expect([across, up]).toEqual([30, 20]);
  });

  test('has no gap between the tops of blocks that meet, and the map around the model and nowhere in it', async ({
    page,
  }) => {
    await loadBlocks(page);
    const view = await lookAtModel(page);
    const map = await mapColour(page);
    const middle = pixelOf(view, CORNER[0] + 1.5 * BLOCK, CORNER[1] + 1.5 * BLOCK);
    // The model is 30 pixels square: every pixel of the 27 by 27 inside it is a block.
    const inside = await around(page, middle.x, middle.y, 13);
    expect(inside.all().filter(([, , px]) => distance(px, map) <= 2)).toEqual([]);
    // Outside it, on each side, the map.
    for (const [east, north] of [
      [CORNER[0] - 3, CORNER[1] + 15],
      [CORNER[0] + 33, CORNER[1] + 15],
      [CORNER[0] + 15, CORNER[1] - 3],
      [CORNER[0] + 15, CORNER[1] + 33],
    ] as const) {
      expect(await colourAt(page, view, east, north)).toEqual(map);
    }
  });

  test('is the size of the blocks: three blocks of 10 m are 30 pixels across at a metre a pixel', async ({
    page,
  }) => {
    await loadBlocks(page);
    const view = await lookAtModel(page);
    expect(await modelWidthOnRow(page, view)).toBe(30 * view.ratio);
  });

  test('changes the colours with the ramp, and the classes with their number, as a grid does', async ({
    page,
  }) => {
    await loadBlocks(page);
    const view = await lookAtModel(page);
    const before = await stats(page);
    const style = await styleOf(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, reverse: true } },
    });
    // The highest class is the first colour of the ramp, now.
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(1, 2)), FIRST))
      .toBeLessThanOrEqual(2);
    const after = await drawn(page);
    expect([after.layers, after.geometries]).toEqual([before?.layers, before?.geometries]);
    // Two classes, from 2.5 to 4.2: the middle is 3.35, and every block of the top layer is above it.
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, classes: 2 } },
    });
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(0, 0)), LAST))
      .toBeLessThanOrEqual(2);
  });

  test('takes the opacity of the layer, over the map, once for a block that has another under it', async ({
    page,
  }) => {
    await loadBlocks(page);
    const view = await lookAtModel(page);
    const map = await mapColour(page);
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    // The tops at 105 are blended over the map and the ones at 95 under them are not drawn, so that it is not blended twice.
    const expected = LAST.map((c, i) => c * 0.5 + (map[i] ?? 0) * 0.5);
    await expect
      .poll(async () => distance(await colourAt(page, view, ...middleOf(1, 2)), expected))
      .toBeLessThanOrEqual(3);
  });

  test('is one geometry on the card, and nothing left when the dataset is removed', async ({
    page,
  }) => {
    await loadBlocks(page);
    const now = await drawn(page);
    expect([now.layers, now.geometries, now.textures]).toEqual([1, 1, 0]);
    await page
      .locator('karmania-dataset-list li')
      .first()
      .locator('.remove k-button button')
      .click();
    await page.locator('karmania-dataset-list k-button[slot="footer-end"]').click();
    await expect.poll(async () => (await stats(page))?.layers).toBe(0);
    expect((await stats(page))?.geometries).toBe(0);
  });
});

test.describe('the block layer on a screen of twice the density', () => {
  test.use({ deviceScaleFactor: 2 });

  test('is the same size in CSS pixels: the model is twice the pixels across', async ({ page }) => {
    await loadBlocks(page);
    const view = await lookAtModel(page);
    expect(view.ratio).toBe(2);
    expect(await modelWidthOnRow(page, view)).toBe(60);
  });
});
