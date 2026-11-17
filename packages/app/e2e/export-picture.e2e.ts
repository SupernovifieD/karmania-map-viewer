import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  composePicture,
  pictureAgainstScreen,
  pictureNotWhite,
  pictureRegion,
} from './support/export.js';
import type { Box, PictureOutcome } from './support/export.js';
import { sizeMap } from './support/golden.js';
import { loadLegendScene } from './support/legend.js';
import { dispatch, drawn, stats } from './support/render.js';

/**
 * The exported picture put together (step 22.4), in the browser with the real canvas and the real font: the map is where the layout puts it, inside its line, and is what
 * the screen shows byte for byte; the legend starts level with the top of the map and keeps the margins; the north arrow and the scale bar are inside the map; text has no
 * coloured fringes; and a legend that leaves no room for the map is refused. The map itself is checked in `export-render.e2e.ts`.
 */

/** The light theme's colours of the picture, as bytes (`EXPORT_COLOURS` of the scene package: a test reads the stylesheet for them). */
const BORDER = [125, 135, 148] as const;
const MAP = [233, 236, 240] as const;
const TEXT = [26, 29, 33] as const;
const MUTED = [85, 94, 107] as const;
const ACCENT = [26, 86, 196] as const;

/** The map area at 800 by 600 and five layers in two groups, the Legend tab chosen. */
async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await sizeMap(page);
  await drawn(page);
  await expect.poll(async () => (await stats(page))?.cssWidth).toBe(800);
}

function made(outcome: PictureOutcome) {
  if (!outcome.ok) {
    throw new Error(`The picture was not made: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

const near = (pixel: readonly number[], colour: readonly number[], within = 2): boolean =>
  colour.every((channel, k) => Math.abs((pixel[k] ?? 0) - channel) <= within);

/** The pixel at `(x, y)` of the picture as `[r, g, b, a]`. */
async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return pictureRegion(page, { x, y, width: 1, height: 1 });
}

/** The picture the size of the map on screen with the margins and the line round the map, and no legend: the inside of the line is as large as the screen is. */
const AS_SCREEN = { width: 800 + 2 * 24 + 2, height: 600 + 2 * 24 + 2, legend: false } as const;

test.describe('the picture put together', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('has the map of the screen, byte for byte, inside its line, when the picture is the size of the screen and its margins', async ({
    page,
  }) => {
    const out = made(await composePicture(page, AS_SCREEN));
    expect([out.width, out.height]).toEqual([850, 650]);
    expect(out.layout.map).toEqual({ x: 24, y: 24, width: 802, height: 602 });
    expect(out.inner).toEqual({ x: 25, y: 25, width: 800, height: 600 });
    // Everything of the screen's canvas but under the north arrow and the scale bar, which the picture draws over its map (on the screen they are DOM over the canvas).
    const furniture = [out.layout.northArrow, out.layout.scaleBar].filter(
      (box): box is Box => box !== null,
    );
    const same = await pictureAgainstScreen(page, { x: 25, y: 25 }, furniture);
    expect(
      same.first,
      'the first pixel that is not the screen’s: x, y, picture, screen',
    ).toBeNull();
    expect(same.differences).toBe(0);
  });

  test('draws the line round the map in the border colour, just outside the map, and the margins white', async ({
    page,
  }) => {
    const out = made(await composePicture(page, AS_SCREEN));
    const { map } = out.layout;
    // The four sides of the line, in the middle of each.
    for (const [x, y] of [
      [map.x + 300, map.y],
      [map.x + 300, map.y + map.height - 1],
      [map.x, map.y + 300],
      [map.x + map.width - 1, map.y + 300],
    ] as const) {
      expect(
        near(await pixelAt(page, x, y), BORDER),
        `the line at ${String(x)}, ${String(y)}`,
      ).toBe(true);
    }
    // Inside it is the map; outside it is the page.
    expect(near(await pixelAt(page, map.x + 1, map.y + 1), MAP)).toBe(true);
    expect(await pixelAt(page, 5, 5)).toEqual([255, 255, 255, 255]);
    expect(await pixelAt(page, out.width - 5, out.height - 5)).toEqual([255, 255, 255, 255]);
    // The whole picture: the margins are the same on the top, the left and the bottom (the map's line touches them), and the right one is the same.
    const drawnBox = await pictureNotWhite(page, {
      x: 0,
      y: 0,
      width: out.width,
      height: out.height,
    });
    expect(drawnBox).toEqual(
      expect.objectContaining({ minX: 24, minY: 24, maxX: out.width - 25, maxY: out.height - 25 }),
    );
  });

  test('puts the legend to the right of the map, level with its top, inside the margins, with the map taking what is left', async ({
    page,
  }) => {
    const out = made(await composePicture(page, { width: 1100, height: 700 }));
    const { map, legend, columns, lines } = out.layout;
    expect(legend).not.toBeNull();
    expect(map.y).toBe(24);
    expect(legend?.y).toBe(map.y);
    // 24 between them, and the picture's right margin after the legend.
    expect((legend?.x ?? 0) - (map.x + map.width)).toBe(24);
    expect((legend?.x ?? 0) + (legend?.width ?? 0)).toBeLessThanOrEqual(1100 - 24);
    expect(columns.length).toBeGreaterThanOrEqual(1);
    // Five layers, two groups and the lines of the classes of the ones that have them.
    expect(lines.filter((l) => l.kind === 'layer')).toHaveLength(5);
    // The groups come in the order of the legend of the scene, which is the Legend tab's.
    const inScene = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        scene(): { legend: { type: string; name?: string }[] };
      };
      return viewer
        .scene()
        .legend.filter((node) => node.type === 'group')
        .map((node) => node.name);
    });
    expect(inScene).toHaveLength(2);
    expect(lines.filter((l) => l.kind === 'group').map((l) => l.text)).toEqual(inScene);
    expect(lines.some((l) => l.kind === 'class')).toBe(true);
    // The first thing drawn in the legend is in its first row: level with the top of the map and not above it.
    const first = await pictureNotWhite(page, {
      x: legend?.x ?? 0,
      y: 0,
      width: legend?.width ?? 1,
      height: 700,
    });
    expect(first?.minY).toBeGreaterThanOrEqual(map.y);
    expect(first?.minY).toBeLessThan(map.y + 32);
    // Nothing of it is outside the margins or in the map.
    expect(first?.maxX).toBeLessThanOrEqual(1100 - 24);
    expect(first?.minX).toBeGreaterThanOrEqual(legend?.x ?? 0);
    // The line of the map's bottom is the lowest thing in the picture, 24 from the bottom.
    const everything = await pictureNotWhite(page, { x: 0, y: 0, width: 1100, height: 700 });
    expect(everything?.maxY).toBe(700 - 25);
    expect(everything?.minY).toBe(24);
    expect(everything?.minX).toBe(24);
  });

  test('sets the text with no coloured fringes: every pixel of a group’s name is white, the text colour, or a mix of the two', async ({
    page,
  }) => {
    const out = made(await composePicture(page, { width: 1100, height: 700 }));
    const group = out.layout.lines.find((l) => l.kind === 'group');
    expect(group).toBeDefined();
    const rect = group?.rect as Box;
    const data = await pictureRegion(page, rect);
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) {
      const pixel = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      // How much of the text colour the red channel says, and then the other channels have to say the same.
      const t = (255 - (pixel[0] ?? 0)) / (255 - TEXT[0]);
      const mix = TEXT.map((channel) => 255 * (1 - t) + channel * t);
      expect(
        pixel.every((v, k) => Math.abs(v - (mix[k] ?? 0)) <= 3),
        `pixel ${String(i / 4)} is ${pixel.join(',')}`,
      ).toBe(true);
      if (t > 0.5) {
        inked += 1;
      }
    }
    // The name was drawn: "Samples" is several pixels of ink.
    expect(inked).toBeGreaterThan(30);
  });

  test('draws the counts in the muted colour, right-aligned at the edge of the column', async ({
    page,
  }) => {
    const out = made(await composePicture(page, { width: 1100, height: 700 }));
    const line = out.layout.lines.find((l) => l.kind === 'class');
    expect(line).toBeDefined();
    const rect = line?.rect as Box;
    // The right-hand 40 pixels of the row hold the count: ink of the muted colour, ending at the column's right edge to within the side of a letter.
    const counts = await pictureNotWhite(page, {
      x: rect.x + rect.width - 40,
      y: rect.y,
      width: 40,
      height: rect.height,
    });
    expect(counts).not.toBeNull();
    expect(counts?.maxX).toBeGreaterThanOrEqual(rect.x + rect.width - 3);
    expect(counts?.maxX).toBeLessThan(rect.x + rect.width);
    const data = await pictureRegion(page, {
      x: rect.x + rect.width - 40,
      y: rect.y,
      width: 40,
      height: rect.height,
    });
    let darkest = 255;
    for (let i = 0; i < data.length; i += 4) {
      darkest = Math.min(darkest, data[i] ?? 255);
    }
    // The darkest pixel of the count is the muted colour (85) and not the text colour (26).
    expect(darkest).toBeGreaterThanOrEqual(MUTED[0] - 3);
  });

  test('has the north arrow at the top right of the map, inset 16, with the accent head of its needle, and the scale bar at the bottom left', async ({
    page,
  }) => {
    const out = made(await composePicture(page, { width: 1100, height: 700 }));
    const { map, northArrow, scaleBar } = out.layout;
    expect(northArrow).toEqual({
      x: map.x + map.width - 16 - 40,
      y: map.y + 16,
      width: 40,
      height: 40,
    });
    expect(northArrow).not.toBeNull();
    const arrow = await pictureRegion(page, northArrow as Box);
    let head = 0;
    for (let i = 0; i < arrow.length; i += 4) {
      if (near([arrow[i] ?? 0, arrow[i + 1] ?? 0, arrow[i + 2] ?? 0], ACCENT, 6)) {
        head += 1;
      }
    }
    // (The head is about 60 square pixels at 96 dpi, with an anti-aliased edge: some 35 of them are the colour itself.)
    expect(head, 'pixels of the head of the needle').toBeGreaterThan(25);
    // The scale bar, in 2D: a box at the bottom left, 16 in from the edges, with its label.
    expect(scaleBar).not.toBeNull();
    expect(scaleBar?.x).toBe(map.x + 16);
    expect((scaleBar?.y ?? 0) + (scaleBar?.height ?? 0)).toBe(map.y + map.height - 16);
    expect(out.scaleBarLabel).toMatch(/^[\d.,]+ (m|km)$/);
    expect(await pictureNotWhite(page, scaleBar as Box, 4)).not.toBeNull();
  });

  test('has no scale bar in 3D, but the north arrow, which turns with the heading', async ({
    page,
  }) => {
    await dispatch(
      page,
      { type: 'setViewMode', mode: '3d' },
      { type: 'setCamera', patch: { camera3d: { heading: 90 } } },
    );
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
    const out = made(await composePicture(page, { width: 1100, height: 700 }));
    expect(out.layout.scaleBar).toBeNull();
    expect(out.scaleBarLabel).toBeNull();
    expect(out.layout.northArrow).not.toBeNull();
    const arrow = await pictureNotWhite(page, out.layout.northArrow as Box, 4);
    expect(arrow).not.toBeNull();
  });

  test('leaves out the north arrow and the scale bar when the map is too narrow to hold them, and nothing spills out of the map into the gap before the legend', async ({
    page,
  }) => {
    // A width at which the map is a strip of less than 72 pixels (what a north arrow and its inset need), found by asking the viewer for the plan of pictures 1,000 high, narrower
    // and narrower: the case that showed the furniture over the legend's column in the dialog's preview.
    const strip = await page.evaluate(async () => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        planPicture(o: object): Promise<{ layout: { map: { width: number } } }>;
      };
      for (let width = 900; width >= 300; width -= 4) {
        const plan = await viewer
          .planPicture({ size: { width, height: 1000 }, dpi: 96, legend: true })
          .catch(() => undefined);
        if (plan !== undefined && plan.layout.map.width >= 8 && plan.layout.map.width < 72) {
          return width;
        }
      }
      return undefined;
    });
    expect(strip, 'a width at which the map is a strip').toBeDefined();
    const out = made(await composePicture(page, { width: strip ?? 0, height: 1000, legend: true }));
    expect(out.layout.warnings).toContain('map_narrow');
    expect(out.layout.northArrow).toBeNull();
    expect(out.layout.scaleBar).toBeNull();
    const { map, legend } = out.layout;
    expect(legend).not.toBeNull();
    const gap = {
      x: map.x + map.width,
      y: 0,
      width: (legend?.x ?? 0) - (map.x + map.width),
      height: 400,
    };
    expect(gap.width).toBe(24);
    expect(await pictureNotWhite(page, gap, 4)).toBeNull();
  });

  test('is A4 landscape at 300 dpi when asked: 3,508 by 2,480, with the margins, line and rows at 3.125 times the size', async ({
    page,
  }) => {
    const out = made(await composePicture(page, { width: 3508, height: 2480, dpi: 300 }));
    expect([out.width, out.height]).toEqual([3508, 2480]);
    expect(out.layout.map.x).toBe(75);
    expect(out.layout.map.y).toBe(75);
    // A line of 3 pixels, and the map inside it from the colour of the map.
    expect(near(await pixelAt(page, out.layout.map.x + 400, out.layout.map.y + 1), BORDER)).toBe(
      true,
    );
    expect(near(await pixelAt(page, out.inner.x + 4, out.inner.y + 4), MAP, 20)).toBe(true);
    expect(out.inner.x).toBe(out.layout.map.x + 3);
    // The map of this picture is read in several bands (a band is about four megabytes): the bottom of it, which only the last band reaches, is the map too, and not the white of the
    // page that is under a band that was put in the wrong place. The rows at the seams of the bands are the map's colour as well, which a band put one row off would show.
    const bottom = out.inner.y + out.inner.height - 5;
    expect(near(await pixelAt(page, out.inner.x + 4, bottom), MAP, 20)).toBe(true);
    expect(
      near(
        await pixelAt(page, out.inner.x + 4, out.inner.y + Math.floor(out.inner.height / 2)),
        MAP,
        20,
      ),
    ).toBe(true);
    // The first row of the legend is 100 high (32 at 96 dpi).
    expect(out.layout.lines[0]?.rect.height).toBe(100);
  });

  test('says there is no room for the map, and draws nothing, when the legend takes the width', async ({
    page,
  }) => {
    const out = await composePicture(page, { width: 300, height: 600 });
    expect(out).toMatchObject({ ok: false, name: 'ComposeError', code: 'no_room_for_map' });
  });
});
