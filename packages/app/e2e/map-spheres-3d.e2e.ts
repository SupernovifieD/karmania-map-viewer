import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixturePath } from './support/picker.js';
import { pixelOf3d } from './support/project.js';
import {
  around,
  bytes,
  dispatch,
  drawn,
  layerColour,
  ROUND_AMBIENT,
  sceneFrame,
  stats,
  withData,
} from './support/render.js';

/**
 * Points are spheres in 3D (step 22.R1): the markers keep the size in pixels that the person chose, and are lit like a sphere by the light of the world
 * (from the north-west, 45 degrees up, as for meshes), so the side that faces the light is brighter than the side that does not. The view from above draws the same
 * markers as flat discs. The outline is not shaded, and the colour of the layer is never made brighter.
 */

/** The first point of `points.csv`: easting, northing and height in the file's own coordinates (EPSG:32640). */
const FIRST = readFileSync(fixturePath('points.csv'), 'utf8')
  .split('\n')[1]
  ?.split(',')
  .slice(0, 3)
  .map(Number) as [number, number, number];

/** The light, to the north-west and 45 degrees up. */
const LIGHT = [-0.5, 0.5, Math.SQRT1_2] as const;
/** The size of the marker the pictures are taken of, in pixels: big enough to sample the sides of it. */
const SIZE = 24;
/** How far from the middle the marker is sampled, in pixels: inside the 12 pixels of its radius and clear of the outline. */
const REACH = 8;

/** Where the light is on the screen of a camera that looks along `heading` from `elevation` degrees above the horizon: right and up, as the buffer counts. */
function lightOnScreen(heading: number, elevation: number): { x: number; y: number } {
  const [h, e] = [(heading * Math.PI) / 180, (elevation * Math.PI) / 180];
  const right = [Math.cos(h), -Math.sin(h), 0] as const;
  const up = [Math.sin(e) * Math.sin(h), Math.sin(e) * Math.cos(h), Math.cos(e)] as const;
  const along = (axis: readonly [number, number, number]): number =>
    axis[0] * LIGHT[0] + axis[1] * LIGHT[1] + axis[2] * LIGHT[2];
  return { x: along(right), y: along(up) };
}

/** Looks at the first point from a heading and an elevation, in 3D, and says where it is in the buffer (from the bottom left). */
async function lookAtFirst(
  page: Page,
  heading: number,
  elevation: number,
): Promise<{ x: number; y: number }> {
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: { camera3d: { target: FIRST, distance: 150, heading, elevation, fov: 45 } },
    },
    { type: 'setViewMode', mode: '3d' },
  );
  await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
  const frame = await sceneFrame(page);
  const now = await drawn(page);
  const at = pixelOf3d(now, frame?.origin ?? [0, 0, 0], FIRST);
  if (at === undefined) {
    throw new Error('The point is behind the camera.');
  }
  return at;
}

/** How bright a pixel is: the sum of its channels. */
const brightness = (pixel: readonly number[]): number =>
  (pixel[0] ?? 0) + (pixel[1] ?? 0) + (pixel[2] ?? 0);

test.describe('points as spheres in 3D', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { pointSize: SIZE, opacity: 1 },
    });
  });

  for (const [heading, elevation] of [
    [0, 45],
    [200, 30],
    [95, 60],
  ] as const) {
    test(`are brighter on the side of the light, from heading ${String(heading)} and elevation ${String(elevation)}`, async ({
      page,
    }) => {
      const at = await lookAtFirst(page, heading, elevation);
      const light = lightOnScreen(heading, elevation);
      const length = Math.hypot(light.x, light.y);
      const [ux, uy] = [light.x / length, light.y / length];
      const block = await around(page, at.x, at.y, REACH + 1);
      const toward = block.at(Math.round(ux * REACH), Math.round(uy * REACH));
      const away = block.at(-Math.round(ux * REACH), -Math.round(uy * REACH));
      expect(
        brightness(toward) - brightness(away),
        'the side that faces the light against the side that does not',
      ).toBeGreaterThan(60);
    });
  }

  test('never make the colour of the layer brighter, and keep some of it where the light does not reach', async ({
    page,
  }) => {
    const colour = bytes(await layerColour(page));
    const at = await lookAtFirst(page, 0, 45);
    const block = await around(page, at.x, at.y, REACH + 1);
    for (const [dx, dy, pixel] of block.all()) {
      if (Math.hypot(dx, dy) > REACH) {
        continue;
      }
      colour.forEach((channel, k) => {
        const value = pixel[k] ?? 0;
        expect(value, `channel ${String(k)} at ${String(dx)}, ${String(dy)}`).toBeLessThanOrEqual(
          channel + 2,
        );
        expect(
          value,
          `channel ${String(k)} at ${String(dx)}, ${String(dy)}`,
        ).toBeGreaterThanOrEqual(Math.floor(channel * ROUND_AMBIENT) - 2);
      });
    }
  });

  test('are flat discs from above: the middle and the sides are the colour of the layer', async ({
    page,
  }) => {
    const colour = bytes(await layerColour(page));
    const now = await drawn(page);
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [FIRST[0], FIRST[1]], unitsPerPixel: 1, heading: 0 } },
    });
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('2d');
    const spot = { x: Math.floor(now.width / 2), y: Math.floor(now.height / 2) };
    await expect
      .poll(async () => {
        const block = await around(page, spot.x, spot.y, REACH + 1);
        return Math.max(
          ...[
            block.at(0, 0),
            block.at(REACH, 0),
            block.at(-REACH, 0),
            block.at(0, REACH),
            block.at(0, -REACH),
          ].map((pixel) =>
            Math.max(...colour.map((channel, k) => Math.abs((pixel[k] ?? 0) - channel))),
          ),
        );
      })
      .toBeLessThanOrEqual(2);
  });
});
