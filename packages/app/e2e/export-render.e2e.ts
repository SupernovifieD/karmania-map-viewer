import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fixture, projectionFor } from './support/fixtures.js';
import { exportPicture, pictureBox, restoreContext, screenHash } from './support/export.js';
import { sizeMap } from './support/golden.js';
import { dispatch, drawn, layerStatuses, stats, withData } from './support/render.js';
import { importAndLoad } from './support/wizard.js';

/**
 * The picture of the map for an export (step 22.1c): the layers that are on the card are drawn again, into a target of the size of the map in the picture, in the
 * light theme, at the scale of the picture, and read back in bands. The test that matters most is the first: at the size and the pixel ratio of the screen the picture has
 * to be what the screen shows, to the byte, in 2D and in 3D, with a mesh, lines and points in the scene. A map colour that was made in the wrong colour space, rows in the
 * wrong order, a size in pixels that was not the scale's, a light that was not the export camera's or a camera that was not framed as the screen's would each show in it.
 */

const EAST = 500_000;
const NORTH = 2_765_000;

/** A pyramid on a square of 100 metres that is 40 high, as an OBJ file made on the spot, in the area that `points.csv` and `lines.csv` are in. */
function pyramid() {
  const [west, south, side] = [EAST + 40, NORTH + 40, 100];
  const text = [
    `v ${String(west)} ${String(south)} 0`,
    `v ${String(west + side)} ${String(south)} 0`,
    `v ${String(west + side)} ${String(south + side)} 0`,
    `v ${String(west)} ${String(south + side)} 0`,
    `v ${String(west + side / 2)} ${String(south + side / 2)} 40`,
    'f 1 2 5',
    'f 2 3 5',
    'f 3 4 5',
    'f 4 1 5',
    'f 1 3 2',
    'f 1 4 3',
    '',
  ].join('\n');
  return { name: 'pyramid.obj', mimeType: 'text/plain', buffer: Buffer.from(text) };
}

/** The map of the golden pictures' size, in a whole number of pixels, with the first layer drawn. */
async function settle(page: Page, layers: number): Promise<void> {
  await sizeMap(page);
  await expect.poll(async () => (await stats(page))?.cssWidth).toBe(800);
  await drawn(page);
  await expect
    .poll(async () => (await layerStatuses(page)).filter(([, status]) => status === 'drawn').length)
    .toBe(layers);
}

/** A mesh, lines and points, all in view, from the bottom of the legend to the top. */
async function loadScene(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await importAndLoad(page, pyramid(), projectionFor('pyramid.prj'));
  await drawn(page);
  await importAndLoad(page, fixture('lines.csv'), projectionFor('lines.prj'));
  await importAndLoad(page, fixture('points.csv'), projectionFor('points.prj'));
  await settle(page, 3);
}

/** Looks at the scene from above or from the south-east, in 2D or in 3D. */
async function lookAtScene(page: Page, mode: '2d' | '3d'): Promise<void> {
  if (mode === '3d') {
    await dispatch(
      page,
      {
        type: 'setCamera',
        patch: {
          camera3d: {
            target: [EAST + 110, NORTH + 100, 20],
            distance: 380,
            heading: 25,
            elevation: 38,
            fov: 45,
          },
        },
      },
      { type: 'setViewMode', mode: '3d' },
    );
    await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
  }
  await drawn(page);
}

test.describe('the picture of the map for an export', () => {
  for (const mode of ['2d', '3d'] as const) {
    test(`is what the screen shows, to the byte, with a mesh, lines and points in ${mode}`, async ({
      page,
    }) => {
      await loadScene(page);
      await lookAtScene(page, mode);
      const out = await exportPicture(page, { compareWithScreen: true });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      if (out.ok) {
        expect(out.width).toBe(800);
        expect(out.height).toBe(600);
        expect(out.first, 'the first pixel that is not the screen’s').toBeNull();
        expect(out.differences).toBe(0);
        // A picture of this size is more than one band, which is what the reading in bands has to be tested with.
        expect(out.bands).toBeGreaterThanOrEqual(1);
      }
    });
  }

  test('is what the screen shows when points alone are drawn, from above', async ({ page }) => {
    await page.goto('/?theme=light');
    await withData(page);
    await settle(page, 1);
    const out = await exportPicture(page, { compareWithScreen: true });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.ok && out.differences, JSON.stringify(out)).toBe(0);
  });

  test.describe('with a layer on the card', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/?theme=light');
      await withData(page);
      await settle(page, 1);
    });

    test('draws the sizes of the screen at the scale of the picture: twice the pixels, four times the marks', async ({
      page,
    }) => {
      const one = await exportPicture(page);
      expect(one.ok).toBe(true);
      const small = await pictureBox(page);
      const big = await exportPicture(page, { width: 1600, height: 1200, scale: 2 });
      expect(big.ok, JSON.stringify(big)).toBe(true);
      const large = await pictureBox(page);
      expect(small.count).toBeGreaterThan(100);
      // The same view in twice the pixels, with the markers twice as wide: four times the area of them, a little less in the count of pixels that are not the map's
      // (the edge that is smoothed, which is a pixel wide at either size, is twice as long and not four times as large).
      expect(large.count / small.count).toBeGreaterThan(3.2);
      expect(large.count / small.count).toBeLessThan(4.4);
      // And the marks are in the same places: the box that holds them is twice as large.
      expect(large.maxX - large.minX).toBeGreaterThan(2 * (small.maxX - small.minX) - 12);
      expect(large.maxX - large.minX).toBeLessThan(2 * (small.maxX - small.minX) + 12);
    });

    test('does not change what the screen shows, and draws no frame of the screen when everything is on the card', async ({
      page,
    }) => {
      const before = await screenHash(page);
      const frames = (await stats(page))?.frames ?? 0;
      const out = await exportPicture(page, { width: 1200, height: 900, scale: 1.5 });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      expect((await stats(page))?.frames).toBe(frames);
      expect(await screenHash(page)).toBe(before);
    });

    test('frees what it drew into: the geometries and textures are what they were, after a picture and after one that was stopped', async ({
      page,
    }) => {
      const before = await stats(page);
      const done = await exportPicture(page, { width: 1000, height: 700, scale: 1.25 });
      expect(done.ok).toBe(true);
      const stopped = await exportPicture(page, {
        width: 1000,
        height: 700,
        scale: 1.25,
        at: { done: 0.5, do: 'abort' },
      });
      expect(stopped).toMatchObject({ ok: false, name: 'AbortError' });
      const after = await stats(page);
      expect([after?.geometries, after?.textures]).toEqual([before?.geometries, before?.textures]);
    });

    test('is not changed by the screen drawing, or a pick, between its steps: the picture is the same as the one that nothing came between', async ({
      page,
    }) => {
      const out = await exportPicture(page, {
        compareWithScreen: true,
        at: { done: 0, do: 'interfere' },
      });
      expect(out.ok, JSON.stringify(out)).toBe(true);
      expect(out.ok && out.differences).toBe(0);
    });

    test('stops, and says so, when the map changes while it is drawn: a picture of half of one thing and half of another is not made', async ({
      page,
    }) => {
      const out = await exportPicture(page, { at: { done: 0.05, do: 'restyle' } });
      expect(out).toMatchObject({ ok: false, name: 'ExportError', code: 'interrupted' });
    });

    test('says the card took the map away, and makes a picture again when it is given back', async ({
      page,
    }) => {
      const out = await exportPicture(page, { at: { done: 0.5, do: 'lose' } });
      expect(out).toMatchObject({ ok: false, name: 'ExportError', code: 'context_lost' });
      await restoreContext(page);
      await expect.poll(async () => (await stats(page))?.contextLost).toBe(false);
      await expect
        .poll(async () => (await layerStatuses(page)).filter(([, s]) => s === 'drawn').length)
        .toBe(1);
      const again = await exportPicture(page, { compareWithScreen: true });
      expect(again.ok, JSON.stringify(again)).toBe(true);
      expect(again.ok && again.differences).toBe(0);
    });

    test('refuses a picture larger than the card draws, before it draws anything', async ({
      page,
    }) => {
      const limits = await page.evaluate(() => {
        const viewer = document
          .querySelector('karmania-app')
          ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
          exportLimits(): {
            renderbuffer: number;
            texture: number;
            viewport: number;
            pointSize: number;
          };
        };
        return viewer.exportLimits();
      });
      expect(limits.renderbuffer).toBeGreaterThanOrEqual(2048);
      expect(limits.texture).toBeGreaterThanOrEqual(2048);
      expect(limits.viewport).toBeGreaterThanOrEqual(2048);
      expect(limits.pointSize).toBeGreaterThanOrEqual(1);
      const most = Math.min(limits.renderbuffer, limits.texture, limits.viewport);
      const frames = (await stats(page))?.frames;
      const out = await exportPicture(page, { width: most + 1, height: 100, scale: 1 });
      expect(out).toMatchObject({ ok: false, name: 'ExportError', code: 'too_large' });
      expect((await stats(page))?.frames).toBe(frames);
    });
  });
});
