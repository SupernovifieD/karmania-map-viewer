import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { exportPngFile } from './support/export.js';
import { sizeMap } from './support/golden.js';
import { loadLegendScene } from './support/legend.js';
import { dispatch, drawn, stats, withData } from './support/render.js';

/**
 * The golden images of the exported picture (step 22.10, brief 10.8): the PNG file that `exportPng` makes, shown one pixel to a pixel and compared with the picture that was reviewed, with
 * no colour tolerance and no pixel that may differ. What is compared is the decoded picture (the browser's own decoder draws the file) and never the bytes of the file, which are the
 * compressor's own and are not promised across machines. The picture is always the light theme's, so the same picture is expected with the page in the dark theme.
 *
 * Four cases: the map from above with its legend in one column, the map turned and at 150 dpi (everything scaled by 1.5625), the map in 3D, and a legend in two columns.
 */

/** A4 landscape at 96 and 150 dpi, in pixels. */
const A4_96 = { widthPx: 1123, heightPx: 794 } as const;
const A4_150 = { widthPx: 1754, heightPx: 1240 } as const;

interface Case {
  readonly name: string;
  /** Puts the scene in the page that is open at `/?theme=...`. */
  readonly load: (page: Page) => Promise<void>;
  readonly size: { readonly widthPx: number; readonly heightPx: number };
  readonly dpi: number;
}

const CASES: readonly Case[] = [
  {
    name: 'points',
    load: async (page) => {
      await withData(page);
    },
    size: A4_96,
    dpi: 96,
  },
  {
    name: 'points-turned',
    load: async (page) => {
      await withData(page);
      await dispatch(page, { type: 'setCamera', patch: { camera2d: { heading: 30 } } });
      await expect.poll(async () => (await stats(page))?.frame.rotation).not.toBe(0);
    },
    size: A4_150,
    dpi: 150,
  },
  {
    name: '3d',
    load: async (page) => {
      await loadLegendScene(page);
      // Switched as the toolbar does it, which makes the 3D camera from the 2D one (a bare scene command would leave it looking at the origin, away from the data).
      await page.locator('karmania-app header.toolbar').getByRole('radio', { name: '3D' }).click();
      await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
      await dispatch(page, {
        type: 'setCamera',
        patch: { camera3d: { heading: 20, elevation: 40 } },
      });
      await drawn(page);
    },
    size: A4_96,
    dpi: 96,
  },
  {
    name: 'legend-columns',
    load: async (page) => {
      await loadLegendScene(page);
    },
    size: A4_96,
    dpi: 96,
  },
];

/** Makes the file and shows it one pixel to a pixel in place of the page, and gives the picture. */
async function showExport(page: Page, item: Case) {
  const out = await exportPngFile(page, { ...item.size, dpi: item.dpi, legend: true });
  expect(out.ok, JSON.stringify(out)).toBe(true);
  await page.evaluate(() => {
    const blob = (window as unknown as { __png: Blob }).__png;
    const img = new Image();
    img.id = 'export-golden';
    img.style.cssText = 'display:block;image-rendering:pixelated;margin:0;';
    img.src = URL.createObjectURL(blob);
    document.documentElement.style.background = '#ffffff';
    document.body.replaceChildren(img);
    document.body.style.margin = '0';
  });
  const img = page.locator('#export-golden');
  await expect.poll(async () => img.evaluate((e) => (e as HTMLImageElement).complete)).toBe(true);
  return img;
}

for (const item of CASES) {
  test(`the export golden image "${item.name}"`, async ({ page }) => {
    await page.goto('/?theme=light');
    await item.load(page);
    await sizeMap(page);
    await drawn(page);
    const img = await showExport(page, item);
    await expect(img).toHaveScreenshot(`export-${item.name}.png`, {
      // A difference is a failure, however small (10.8): no colour tolerance and no pixel that may differ.
      threshold: 0,
      maxDiffPixels: 0,
    });
  });
}

test('the exported picture is the light theme whatever the theme of the page is: the same picture with the page dark', async ({
  page,
}) => {
  const item = CASES[0];
  if (item === undefined) {
    throw new Error('There is no case.');
  }
  await page.goto('/?theme=dark');
  await item.load(page);
  await sizeMap(page);
  await drawn(page);
  const img = await showExport(page, item);
  await expect(img).toHaveScreenshot(`export-${item.name}.png`, { threshold: 0, maxDiffPixels: 0 });
});
