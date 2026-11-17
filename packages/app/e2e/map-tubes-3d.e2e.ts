import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
import { pixelOf3d } from './support/project.js';
import {
  around,
  bytes,
  camera,
  dispatch,
  drawn,
  layerColour,
  layerStatuses,
  ROUND_AMBIENT,
  sceneFrame,
  stats,
} from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/**
 * Lines are tubes in 3D (step 22.R2): they keep the width in pixels that the person chose, and are lit as a tube by the light of the world (from the
 * north-west, 45 degrees up, as for meshes), so the side of a line that faces the light is brighter than the side that does not. The view from above draws
 * the same lines flat. The colour of the layer is never made brighter. The first segment of line A of `lines.csv` is looked at.
 */

const START = [500_000, 2_765_000, 100] as const;
const END = [500_050, 2_765_040, 102] as const;
const MIDDLE = [(START[0] + END[0]) / 2, (START[1] + END[1]) / 2, (START[2] + END[2]) / 2] as const;

/** The light, to the north-west and 45 degrees up. */
const LIGHT = [-0.5, 0.5, Math.SQRT1_2] as const;
/** The width the pictures are taken at, in pixels: the widest there is, so that the two sides of a line are far apart. */
const WIDTH = 8;
/** How far from the middle of the line each side is sampled, in pixels: inside the 4 of its radius and clear of its edge. */
const REACH = 2.5;

type Vector = readonly [number, number, number];

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Where the light is on the screen of a camera that looks along `heading` from `elevation` degrees above the horizon: right and up. */
function lightOnScreen(heading: number, elevation: number): [number, number] {
  const [h, e] = [(heading * Math.PI) / 180, (elevation * Math.PI) / 180];
  const right = [Math.cos(h), -Math.sin(h), 0] as const;
  const up = [Math.sin(e) * Math.sin(h), Math.sin(e) * Math.cos(h), Math.cos(e)] as const;
  return [dot(LIGHT, right), dot(LIGHT, up)];
}

async function loadLines(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
  await drawn(page);
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
  await dispatch(page, {
    type: 'setStyle',
    layerId: 'layer-1',
    patch: { lineWidth: WIDTH, opacity: 1 },
  });
}

/**
 * Looks at the middle of the segment from a heading and an elevation, in 3D, and says where the middle is in the buffer (from the bottom left) and which
 * way the segment goes on the screen (a unit vector, right and up).
 */
async function lookAtSegment(
  page: Page,
  heading: number,
  elevation: number,
): Promise<{ at: { x: number; y: number }; along: [number, number] }> {
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: { camera3d: { target: MIDDLE, distance: 90, heading, elevation, fov: 45 } },
    },
    { type: 'setViewMode', mode: '3d' },
  );
  await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
  const frame = await sceneFrame(page);
  const now = await drawn(page);
  const origin = frame?.origin ?? [0, 0, 0];
  const at = pixelOf3d(now, origin, MIDDLE);
  const end = pixelOf3d(now, origin, END);
  if (at === undefined || end === undefined) {
    throw new Error('The segment is behind the camera.');
  }
  const length = Math.hypot(end.x - at.x, end.y - at.y);
  return { at, along: [(end.x - at.x) / length, (end.y - at.y) / length] };
}

/** How bright a pixel is: the sum of its channels. */
const brightness = (pixel: readonly number[]): number =>
  (pixel[0] ?? 0) + (pixel[1] ?? 0) + (pixel[2] ?? 0);

test.describe('lines as tubes in 3D', () => {
  test.beforeEach(async ({ page }) => {
    await loadLines(page);
  });

  // Headings from which the light falls across the line (the light is not along it, where its two sides would be lit the same).
  for (const heading of [0, 45, 225, 270, 315]) {
    test(`are brighter on the side of the light, from heading ${String(heading)}`, async ({
      page,
    }) => {
      const { at, along } = await lookAtSegment(page, heading, 45);
      const across: [number, number] = [-along[1], along[0]];
      const light = lightOnScreen(heading, 45);
      const faces = light[0] * across[0] + light[1] * across[1];
      expect(Math.abs(faces), 'how much of the light falls across the line').toBeGreaterThan(0.5);
      const block = await around(page, at.x, at.y, 4);
      const near = block.at(Math.round(across[0] * REACH), Math.round(across[1] * REACH));
      const far = block.at(-Math.round(across[0] * REACH), -Math.round(across[1] * REACH));
      expect(
        Math.sign(faces) * (brightness(near) - brightness(far)),
        'the side that faces the light against the side that does not',
      ).toBeGreaterThan(30);
    });
  }

  test('never make the colour of the layer brighter, and keep some of it where the light does not reach', async ({
    page,
  }) => {
    const colour = bytes(await layerColour(page));
    const { at, along } = await lookAtSegment(page, 0, 45);
    const across: [number, number] = [-along[1], along[0]];
    const block = await around(page, at.x, at.y, 4);
    // Within 2 pixels of the middle: the line is 8 wide, and its edge, which is blended with the map, starts at 3.5.
    for (let step = -2; step <= 2; step += 1) {
      const pixel = block.at(Math.round(across[0] * step), Math.round(across[1] * step));
      colour.forEach((channel, k) => {
        const value = pixel[k] ?? 0;
        expect(value, `channel ${String(k)} at ${String(step)} across`).toBeLessThanOrEqual(
          channel + 2,
        );
        expect(value, `channel ${String(k)} at ${String(step)} across`).toBeGreaterThanOrEqual(
          Math.floor(channel * ROUND_AMBIENT) - 2,
        );
      });
    }
  });

  test('are flat from above: the middle and the sides of the line are the colour of the layer', async ({
    page,
  }) => {
    const colour = bytes(await layerColour(page));
    await dispatch(page, {
      type: 'setCamera',
      patch: { camera2d: { centre: [MIDDLE[0], MIDDLE[1]], unitsPerPixel: 1, heading: 0 } },
    });
    const now = await drawn(page);
    const spot = { x: Math.floor(now.width / 2), y: Math.floor(now.height / 2) };
    // The segment goes 50 east and 40 north: on the screen, to the right and up, and across it is to the left and up.
    const length = Math.hypot(50, 40);
    const across: [number, number] = [-40 / length, 50 / length];
    await expect
      .poll(async () => {
        const block = await around(page, spot.x, spot.y, 4);
        return Math.max(
          ...[-REACH, 0, REACH].map((step) => {
            const pixel = block.at(Math.round(across[0] * step), Math.round(across[1] * step));
            return Math.max(...colour.map((channel, k) => Math.abs((pixel[k] ?? 0) - channel)));
          }),
        );
      })
      .toBeLessThanOrEqual(2);
  });
});
