import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

/** A square of 100 m with a square hole of 40 m, in UTM zone 40 north: the outer ring is anticlockwise and the hole clockwise. */
const SQUARE_WITH_A_HOLE = JSON.stringify({
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
  features: [
    {
      type: 'Feature',
      properties: { name: 'Lease' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [500000, 2765000],
            [500100, 2765000],
            [500100, 2765100],
            [500000, 2765100],
            [500000, 2765000],
          ],
          [
            [500030, 2765030],
            [500030, 2765070],
            [500070, 2765070],
            [500070, 2765030],
            [500030, 2765030],
          ],
        ],
      },
    },
  ],
});

async function loadSquare(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, {
    name: 'lease.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(SQUARE_WITH_A_HOLE),
  });
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

/** Looks at the middle of the square at 1 unit a pixel, so that the 100 m square is 100 pixels (200 on a screen of twice the density). */
async function lookAtSquare(page: Page): Promise<{ width: number; height: number; ratio: number }> {
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [500050, 2765050], unitsPerPixel: 1, heading: 0 } },
  });
  const now = await drawn(page);
  await expect
    .poll(async () => Math.abs((await camera(page)).unitsPerPixel - 1))
    .toBeLessThan(1e-9);
  return { width: now.width, height: now.height, ratio: now.pixelRatio };
}

/** The pixel at `(east, north)` metres from the middle of the square, in the buffer. */
const at = (
  view: { width: number; height: number; ratio: number },
  east: number,
  north: number,
) => ({
  x: Math.floor(view.width / 2 + east * view.ratio),
  y: Math.floor(view.height / 2 + north * view.ratio),
});

/** `layer` at `alpha` over `under`. */
const over = (layer: readonly number[], alpha: number, under: readonly number[]): number[] =>
  layer.slice(0, 3).map((c, i) => c * alpha + (under[i] ?? 0) * (1 - alpha));

test.describe('the polygons layer', () => {
  test('fills the polygon at the opacity of the layer, leaves its hole and its outside the map, and puts nothing else on it', async ({
    page,
  }) => {
    await loadSquare(page);
    const view = await lookAtSquare(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    // The default opacity of a polygon is 0.6.
    const filled = over(colour, 0.6, map);
    const pixel = async (east: number, north: number) => {
      const p = at(view, east, north);
      return (await around(page, p.x, p.y, 0)).at(0, 0);
    };
    // Inside the square and outside the hole: on the left, on the right, above, below.
    for (const [east, north] of [
      [-35, 0],
      [35, 0],
      [0, 35],
      [0, -35],
      [-45, 45],
      [44, -44],
    ] as const) {
      expect(
        distance(await pixel(east, north), filled),
        `${String(east)},${String(north)}`,
      ).toBeLessThanOrEqual(2);
    }
    // In the hole, and outside the square: the map, exactly.
    for (const [east, north] of [
      [0, 0],
      [10, -12],
      [-60, 0],
      [0, 70],
      [80, 80],
    ] as const) {
      expect(await pixel(east, north), `${String(east)},${String(north)}`).toEqual(map);
    }
  });

  test('outlines the square and the hole, 1 pixel wide, in the colour of the layer and not transparent, over the fill', async ({
    page,
  }) => {
    await loadSquare(page);
    const view = await lookAtSquare(page);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    // Across the left edge of the square (50 m west of the middle) and across the left edge of the hole (20 m west of it): the pixel
    // whose middle is `across` pixels from the edge is covered by `max(0, 1 - |across|)` of the outline, over the fill or the map.
    const filled = over(colour, 0.6, map);
    for (const [edge, inner, outer] of [
      [-50, filled, map],
      [-20, map, filled],
    ] as const) {
      for (const across of [-3, -2, -1, 0, 1, 2, 3]) {
        const p = at(view, edge + across, 5);
        const px = (await around(page, p.x, p.y, 0)).at(0, 0);
        // The middle of this pixel from the edge, in pixels (the edge is at a boundary or at a middle of the buffer's pixels).
        const middle = p.x + 0.5 - (view.width / 2 + edge);
        const cover = Math.max(0, 1 - Math.abs(middle));
        const under = middle < 0 ? outer : inner;
        // (Outside the edge is `outer`, inside is `inner`; for the hole, "outside the edge" is the fill.)
        const expected = over(colour, cover, under);
        expect(
          distance(px, expected),
          `edge ${String(edge)} across ${String(across)}`,
        ).toBeLessThanOrEqual(3);
      }
    }
  });

  test('changes the fill with the opacity and not the outline, and the colour of both with the colour', async ({
    page,
  }) => {
    await loadSquare(page);
    const view = await lookAtSquare(page);
    const map = await mapColour(page);
    const own = bytes(await layerColour(page));
    await dispatch(page, { type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.2 } });
    const inside = at(view, -35, 0);
    await expect
      .poll(async () =>
        distance(
          (await around(page, inside.x, inside.y, 0)).at(0, 0),
          over(bytes(await layerColour(page)), 0.2, map),
        ),
      )
      .toBeLessThanOrEqual(2);
    // The outline is as strong as it was, by the model of the test above: across the left edge of the square a pixel is covered by
    // `max(0, 1 - |the distance of its middle from the edge|)` of the colour of the layer, over the fill (at 0.2 now) or the map. An outline
    // that took the opacity too would be a fifth of that.
    const filled = over(own, 0.2, map);
    for (const across of [-2, -1, 0, 1, 2]) {
      const p = at(view, -50 + across, 5);
      const px = (await around(page, p.x, p.y, 0)).at(0, 0);
      const middle = p.x + 0.5 - (view.width / 2 - 50);
      const expected = over(own, Math.max(0, 1 - Math.abs(middle)), middle < 0 ? map : filled);
      expect(distance(px, expected), `across ${String(across)}`).toBeLessThanOrEqual(3);
    }
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await expect
      .poll(async () =>
        distance(
          (await around(page, inside.x, inside.y, 0)).at(0, 0),
          over([0, 114, 178], 0.2, map),
        ),
      )
      .toBeLessThanOrEqual(2);
  });

  test('is a fill and an outline on the card, one geometry each, and nothing left when the dataset is removed', async ({
    page,
  }) => {
    await loadSquare(page);
    const now = await drawn(page);
    expect([now.layers, now.geometries]).toEqual([1, 2]);
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

test.describe('the polygons layer on a screen of twice the density', () => {
  test.use({ deviceScaleFactor: 2 });

  test('has an outline of 2 device pixels, the same 1 CSS pixel, and the fill where it was', async ({
    page,
  }) => {
    await loadSquare(page);
    const view = await lookAtSquare(page);
    expect(view.ratio).toBe(2);
    const map = await mapColour(page);
    const colour = bytes(await layerColour(page));
    const filled = over(colour, 0.6, map);
    const inside = at(view, -35, 0);
    expect(
      distance((await around(page, inside.x, inside.y, 0)).at(0, 0), filled),
    ).toBeLessThanOrEqual(2);
    // The outline across the bottom edge is 2 device pixels thick: count the pixels that are most of the way to the line colour.
    const p = at(view, 0, -50);
    const column = await around(page, p.x, p.y, 4);
    const strong = column
      .all()
      .filter(([dx, , px]) => dx === 0 && distance(px, colour) <= 45).length;
    expect(strong).toBeGreaterThanOrEqual(2);
    expect(strong).toBeLessThanOrEqual(3);
  });
});
