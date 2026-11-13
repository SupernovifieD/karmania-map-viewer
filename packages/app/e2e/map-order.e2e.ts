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
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

const EAST = 500_000;
const NORTH = 2_765_000;

/** A flat square of 100 m, from `(east, north)` metres from the corner, at height `up`, as an OBJ file made on the spot. */
function square(name: string, east: number, north: number, up: number) {
  const corners = [
    [east, north],
    [east + 100, north],
    [east + 100, north + 100],
    [east, north + 100],
  ];
  const text = [
    ...corners.map(([e = 0, n = 0]) => `v ${String(EAST + e)} ${String(NORTH + n)} ${String(up)}`),
    'f 1 2 3',
    'f 1 3 4',
    '',
  ].join('\n');
  return { name, mimeType: 'text/plain', buffer: Buffer.from(text) };
}

/**
 * Two squares that overlap: A (the first loaded) from (0, 0) at 100 m high, and B from (50, 50) at 0, 100 m lower. The overlap is
 * (50, 50) to (100, 100). B is loaded last and so is on top in the legend.
 */
async function loadBoth(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, square('a.obj', 0, 0, 100), projectionFor('a.prj'));
  await drawn(page);
  await importAndLoad(page, square('b.obj', 50, 50, 0), projectionFor('b.prj'));
  await expect
    .poll(async () => layerStatuses(page))
    .toEqual([
      ['layer-1', 'drawn'],
      ['layer-2', 'drawn'],
    ]);
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [EAST + 75, NORTH + 75], unitsPerPixel: 1, heading: 0 } },
  });
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
}

/** The colour of the pixel of the point `(east, north)` metres from the corner, with the middle of the squares in the middle of the map. */
async function colourAt(page: Page, east: number, north: number): Promise<number[]> {
  const now = await drawn(page);
  const x = Math.floor(now.width / 2 + (east - 75) * now.pixelRatio);
  const y = Math.floor(now.height / 2 + (north - 75) * now.pixelRatio);
  return (await around(page, x, y, 0)).at(0, 0);
}

test.describe('the order the layers are drawn in', () => {
  test('puts the layer that is higher in the legend on top, whatever the heights: the one loaded last is, though it is 100 m lower', async ({
    page,
  }) => {
    await loadBoth(page);
    const a = bytes(await layerColour(page, 'layer-1'));
    const b = bytes(await layerColour(page, 'layer-2'));
    expect(distance(a, b)).toBeGreaterThan(40);
    // Where only one of them is, its own colour; where they overlap, B's, which is on top and lower.
    await expect.poll(async () => distance(await colourAt(page, 25, 25), a)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, 125, 125), b)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, 75, 75), b)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, 60, 90), b)).toBeLessThanOrEqual(2);
  });

  test('follows the legend when a layer is moved: the other is on top, and moving it back puts it on top again', async ({
    page,
  }) => {
    await loadBoth(page);
    const a = bytes(await layerColour(page, 'layer-1'));
    const b = bytes(await layerColour(page, 'layer-2'));
    await expect.poll(async () => distance(await colourAt(page, 75, 75), b)).toBeLessThanOrEqual(2);
    // B to the bottom of the legend: A is on top now, in the overlap.
    await dispatch(page, { type: 'moveNode', id: 'layer-2', to: { parent: null, index: 1 } });
    await expect.poll(async () => distance(await colourAt(page, 75, 75), a)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, 25, 25), a)).toBeLessThanOrEqual(2);
    expect(distance(await colourAt(page, 125, 125), b)).toBeLessThanOrEqual(2);
    // And back to the top.
    await dispatch(page, { type: 'moveNode', id: 'layer-2', to: { parent: null, index: 0 } });
    await expect.poll(async () => distance(await colourAt(page, 75, 75), b)).toBeLessThanOrEqual(2);
  });

  test('shares one depth test between layers in 3D, so the higher square stays visible when the legend moves', async ({
    page,
  }) => {
    await loadBoth(page);
    // Seen from above in 3D, a square that lies flat has the colour of its layer lit by the light of the world (from the north-west, 45 degrees
    // up: 0.25 + 0.75 * sqrt(1/2) of it, step 18.4a), and not all of it as in the view from above.
    const lit = 0.25 + 0.75 * Math.SQRT1_2;
    const a = bytes(await layerColour(page, 'layer-1')).map((channel) => channel * lit);
    await dispatch(
      page,
      {
        type: 'setCamera',
        patch: {
          camera3d: {
            target: [EAST + 75, NORTH + 75, 50],
            distance: 500,
            heading: 0,
            elevation: 89,
            fov: 45,
          },
        },
      },
      { type: 'setViewMode', mode: '3d' },
    );
    await expect.poll(async () => distance(await colourAt(page, 75, 75), a)).toBeLessThanOrEqual(2);
    await dispatch(page, { type: 'moveNode', id: 'layer-2', to: { parent: null, index: 1 } });
    await expect.poll(async () => distance(await colourAt(page, 75, 75), a)).toBeLessThanOrEqual(2);
  });

  test('draws the layers that are in a group where the group is in the legend', async ({
    page,
  }) => {
    await loadBoth(page);
    const a = bytes(await layerColour(page, 'layer-1'));
    const b = bytes(await layerColour(page, 'layer-2'));
    // The legend is B, A (top to bottom); the group goes under both.
    await dispatch(page, { type: 'createGroup', name: 'Bottom', index: 2 });
    const group = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { legend: { type: string; id: string }[] };
      };
      return viewer.scene().legend.find((node) => node.type === 'group')?.id;
    });
    expect(group).toBeDefined();
    // The layer that is on top goes into a group at the bottom of the legend, under the other: the other is on top.
    await dispatch(page, { type: 'moveNode', id: 'layer-2', to: { parent: group, index: 0 } });
    await expect.poll(async () => distance(await colourAt(page, 75, 75), a)).toBeLessThanOrEqual(2);
    // The layer in the group is still drawn, under the other: where only it is, its own colour (A is on top at the overlap whether or not B is
    // drawn, so that alone would pass if it were not).
    expect(distance(await colourAt(page, 125, 125), b)).toBeLessThanOrEqual(2);
    const held = await page.evaluate((id) => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { legend: { type: string; id: string; children?: string[] }[] };
      };
      return viewer.scene().legend.find((node) => node.id === id)?.children;
    }, group);
    expect(held).toEqual(['layer-2']);
  });

  test('does not draw a layer that is hidden, and shows what was under it', async ({ page }) => {
    await loadBoth(page);
    const a = bytes(await layerColour(page, 'layer-1'));
    await dispatch(page, { type: 'setVisible', layerId: 'layer-2', visible: false });
    await expect.poll(async () => distance(await colourAt(page, 75, 75), a)).toBeLessThanOrEqual(2);
  });
});
