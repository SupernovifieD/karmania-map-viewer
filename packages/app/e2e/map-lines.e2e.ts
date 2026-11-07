import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
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

/** The two lines of `lines.csv`, in map units (EPSG:32640): A has three vertices, B two. */
const A = [
  [500000, 2765000],
  [500050, 2765040],
  [500100, 2765100],
] as const;
const B = [
  [500200, 2765000],
  [500260, 2765060],
] as const;

async function loadLines(page: Page, query = 'theme=light'): Promise<void> {
  await page.goto(`/?${query}`);
  await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
  await drawn(page);
  await expect.poll(async () => layerStatuses(page)).toEqual([['layer-1', 'drawn']]);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

/** The colour of the map, as bytes. */
async function mapColour(page: Page): Promise<number[]> {
  return page.locator('karmania-map-area canvas').evaluate((element) => {
    const text = getComputedStyle(element).backgroundColor;
    return [...(text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number), 255];
  });
}

/** Looks at the map point `at` (east, north), at `scale` and `heading`, with it in the middle. */
async function lookAt(
  page: Page,
  at: readonly [number, number],
  scale = 1,
  heading = 0,
): Promise<{ width: number; height: number; ratio: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [at[0], at[1]], unitsPerPixel: scale, heading } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - scale))
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio };
}

/**
 * The direction of a map direction on the screen (right, up) at `heading`: right along (cos, -sin) of the map and up along (sin, cos).
 */
function onScreen(east: number, north: number, heading: number): [number, number] {
  const turn = (heading * Math.PI) / 180;
  return [
    east * Math.cos(turn) - north * Math.sin(turn),
    east * Math.sin(turn) + north * Math.cos(turn),
  ];
}

/**
 * Looks at the pixels round the middle of the map, where a line of direction (`right`, `up`) on the screen goes through the middle,
 * and checks them against the geometry: every pixel whose middle is within `sure` of the line is the colour of the line (or the
 * given blend of it), and every pixel whose middle is `gone` or more from it is the map.
 */
async function expectLine(
  page: Page,
  view: { width: number; height: number },
  direction: readonly [number, number],
  halfWidth: number,
  colour: readonly number[],
  map: readonly number[],
  alpha = 1,
): Promise<void> {
  const half = 8;
  const [cx, cy] = [Math.floor(view.width / 2), Math.floor(view.height / 2)];
  const block = await around(page, cx, cy, half);
  const length = Math.hypot(direction[0], direction[1]);
  const [ux, uy] = [direction[0] / length, direction[1] / length];
  const blend = colour.slice(0, 3).map((c, i) => c * alpha + (map[i] ?? 0) * (1 - alpha));
  let exact = 0;
  for (const [dx, dy, pixel] of block.all()) {
    // The middle of this pixel from the point where the line goes through (the middle of the buffer, which is a pixel corner or centre).
    const [px, py] = [cx + dx + 0.5 - view.width / 2, cy + dy + 0.5 - view.height / 2];
    const away = Math.abs(px * uy - py * ux);
    if (away <= halfWidth - 0.55) {
      expect(
        distance(pixel, blend),
        `pixel ${String(dx)},${String(dy)} at ${away.toFixed(2)}`,
      ).toBeLessThanOrEqual(2);
      exact += 1;
    } else if (away >= halfWidth + 0.8) {
      expect(
        distance(pixel, map),
        `pixel ${String(dx)},${String(dy)} at ${away.toFixed(2)}`,
      ).toBeLessThanOrEqual(1);
    }
  }
  expect(exact).toBeGreaterThan(2);
}

test.describe('the lines layer', () => {
  test('draws a segment of the width of the style, in the colour of the layer, with round smoothing and no outline', async ({
    page,
  }) => {
    await loadLines(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    // The middle of the first segment of A: its direction is (50, 40) on the map, and on the screen the same at heading 0.
    const view = await lookAt(page, [(A[0][0] + A[1][0]) / 2, (A[0][1] + A[1][1]) / 2]);
    // The default width is 2 pixels.
    await expectLine(page, view, [50, 40], 1, colour, map);
  });

  test('has the width of the style, whatever the width, and turns with the heading', async ({
    page,
  }) => {
    await loadLines(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { lineWidth: 6 } });
    const middle: [number, number] = [(A[0][0] + A[1][0]) / 2, (A[0][1] + A[1][1]) / 2];
    const view = await lookAt(page, middle);
    await expect
      .poll(async () => {
        const block = await around(
          page,
          Math.floor(view.width / 2),
          Math.floor(view.height / 2),
          0,
        );
        return distance(block.at(0, 0), [...colour, 255]);
      })
      .toBeLessThanOrEqual(1);
    await expectLine(page, view, [50, 40], 3, colour, map);
    // With the top of the screen facing east the same segment goes (-40, 50) on the screen: right is south then, and up east.
    const turned = await lookAt(page, middle, 1, 90);
    const [right, up] = onScreen(50, 40, 90);
    expect([Math.round(right), Math.round(up)]).toEqual([-40, 50]);
    await expectLine(page, turned, [right, up], 3, colour, map);
  });

  test('has round ends: past the end of the line it is a circle of half its width, and not a square', async ({
    page,
  }) => {
    await loadLines(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { lineWidth: 8 } });
    // The end of B: a segment of direction (60, 60), so 45 degrees on the screen, ending in the middle of the map.
    const view = await lookAt(page, [B[1][0], B[1][1]]);
    const [cx, cy] = [Math.floor(view.width / 2), Math.floor(view.height / 2)];
    await expect
      .poll(async () => distance((await around(page, cx, cy, 0)).at(0, 0), [...colour, 255]))
      .toBeLessThanOrEqual(2);
    const block = await around(page, cx, cy, 10);
    const [ux, uy] = [Math.SQRT1_2, Math.SQRT1_2];
    let checked = 0;
    for (const [dx, dy, pixel] of block.all()) {
      const [px, py] = [cx + dx + 0.5 - view.width / 2, cy + dy + 0.5 - view.height / 2];
      // How far along the line, past the end, and how far from the end.
      if (px * ux + py * uy > 0) {
        const away = Math.hypot(px, py);
        if (away <= 3.4) {
          expect(
            distance(pixel, [...colour, 255]),
            `${String(dx)},${String(dy)} at ${away.toFixed(2)}`,
          ).toBeLessThanOrEqual(2);
        } else if (away >= 4.9) {
          // A square end would have the corners of its box, as far as 5.66 from the end, here.
          expect(
            distance(pixel, map),
            `${String(dx)},${String(dy)} at ${away.toFixed(2)}`,
          ).toBeLessThanOrEqual(1);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  test('draws a pixel that two segments cover once: a line that is half opaque is not darker at a joint', async ({
    page,
  }) => {
    await loadLines(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { opacity: 0.5, lineWidth: 8 },
    });
    // The vertex between the two segments of A.
    const view = await lookAt(page, [A[1][0], A[1][1]]);
    const blend = colour.map((c, i) => (c + (map[i] ?? 0)) / 2);
    await expect
      .poll(async () => {
        const block = await around(
          page,
          Math.floor(view.width / 2),
          Math.floor(view.height / 2),
          0,
        );
        return distance(block.at(0, 0), blend);
      })
      .toBeLessThanOrEqual(2);
    // And at the joint's neighbours inside the two segments, the same.
    const block = await around(page, Math.floor(view.width / 2), Math.floor(view.height / 2), 3);
    for (const [dx, dy] of [
      [1, 1],
      [-1, -1],
      [0, 1],
      [1, 0],
    ] as const) {
      expect(distance(block.at(dx, dy), blend), `${String(dx)},${String(dy)}`).toBeLessThanOrEqual(
        2,
      );
    }
  });

  test('puts the layer on the card as one geometry and frees it when the dataset is removed', async ({
    page,
  }) => {
    await loadLines(page);
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

test.describe('the lines layer on a screen of twice the density', () => {
  test.use({ deviceScaleFactor: 2 });

  test('is 2 CSS pixels wide, so 4 pixels', async ({ page }) => {
    await loadLines(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    const view = await lookAt(page, [(A[0][0] + A[1][0]) / 2, (A[0][1] + A[1][1]) / 2]);
    expect(view.ratio).toBe(2);
    await expectLine(page, view, [50, 40], 2, colour, map);
  });
});
