import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { sizeMap } from './support/golden.js';
import { loadLegendScene } from './support/legend.js';
import { dispatch, drawn, stats } from './support/render.js';

/**
 * The Export PNG button and the export dialog (steps 22.7 to 22.9): the button is disabled with a tooltip while nothing is drawn; the dialog has the size, width and height, the
 * resolution, the legend and the file name; the preview is made a moment after the last change and says the size and dpi; what cannot be made is said in words and cannot be exported;
 * Export gives the file to the browser as a download with the name that was typed, and Cancel and Esc stop a picture that is being made.
 */

const toolbar = (page: Page) => page.locator('karmania-app header.toolbar');
const exportButton = (page: Page) => toolbar(page).locator(':scope > k-tooltip > k-button');
const dialog = (page: Page) =>
  page.locator('karmania-app').locator('karmania-viewer').locator('karmania-export-dialog');
const heading = (page: Page) => dialog(page).getByRole('heading', { name: 'Export PNG' });
const sizeSelect = (page: Page) => dialog(page).locator('k-select[label="Size"] select');
const dpiSelect = (page: Page) => dialog(page).locator('k-select[label="Resolution"] select');
const widthInput = (page: Page) => dialog(page).locator('k-input[label="Width (px)"] input');
const heightInput = (page: Page) => dialog(page).locator('k-input[label="Height (px)"] input');
const nameInput = (page: Page) => dialog(page).locator('k-input[label="File name"] input');
const legendBox = (page: Page) => dialog(page).locator('k-checkbox input');
const notes = (page: Page) => dialog(page).locator('.notes');
const caption = (page: Page) => dialog(page).locator('.caption');
const status = (page: Page) => dialog(page).locator('.status');
const exportAction = (page: Page) => dialog(page).locator('k-button[slot="footer-end"]');
const cancelAction = (page: Page) => dialog(page).locator('k-button[slot="footer-start"]');
const previewCanvas = (page: Page) => dialog(page).locator('.frame canvas');

/** What a test does to the dialog's element in the page: gives it other `work` (the functions it makes pictures with) built on the real ones. */
type Work = { plan: unknown; preview: unknown; run: unknown };
const withWork = (page: Page, change: string) =>
  page.evaluate(`(() => {
    const dialog = document.querySelector('karmania-app').shadowRoot.querySelector('karmania-viewer').shadowRoot.querySelector('karmania-export-dialog');
    const real = dialog.work;
    const make = ${change};
    dialog.work = make(real);
  })()`);
export type { Work };

async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await sizeMap(page);
  await drawn(page);
  await expect.poll(async () => (await stats(page))?.cssWidth).toBe(800);
  await expect(exportButton(page)).not.toHaveAttribute('disabled', '');
}

async function openDialog(page: Page): Promise<void> {
  await exportButton(page).click();
  await expect(heading(page)).toBeVisible();
  await expect(previewCanvas(page)).toBeVisible();
}

/** Chooses a size by its words. */
async function chooseSize(page: Page, label: string): Promise<void> {
  await sizeSelect(page).selectOption({ label });
}

/** The width and height of a PNG file, from its header. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test.describe('the Export PNG button', () => {
  test('is disabled, with a tooltip that says why, while nothing is drawn, and is enabled when something is', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(exportButton(page)).toHaveAttribute('disabled', '');
    await exportButton(page).hover({ force: true });
    await expect(toolbar(page).locator(':scope > k-tooltip')).toHaveAttribute(
      'text',
      'There is nothing drawn on the map to export',
    );
    // And the words are shown, not only held: the tooltip's own box is visible with them.
    await expect(toolbar(page).locator(':scope > k-tooltip .tip')).toBeVisible();
    await expect(toolbar(page).locator(':scope > k-tooltip .tip')).toHaveText(
      'There is nothing drawn on the map to export',
    );
    await open(page);
    await expect(toolbar(page).locator(':scope > k-tooltip')).toHaveAttribute('text', '');
  });

  test('is a secondary button with the download icon, 32 high, after the exaggeration select', async ({
    page,
  }) => {
    await open(page);
    await expect(exportButton(page)).toHaveAttribute('variant', 'secondary');
    await expect(exportButton(page).locator('k-icon')).toHaveAttribute('name', 'download');
    expect((await exportButton(page).boundingBox())?.height).toBe(32);
    await expect(exportButton(page)).toContainText('Export PNG');
  });

  test('is disabled again when every layer is hidden', async ({ page }) => {
    await open(page);
    for (const id of ['layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5']) {
      await dispatch(page, { type: 'setVisible', layerId: id, visible: false });
    }
    await expect(exportButton(page)).toHaveAttribute('disabled', '');
  });
});

test.describe('the export dialog', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await openDialog(page);
  });

  test('starts with the size of the map on screen, at the screen’s resolution, with the legend and a name, and its preview and caption', async ({
    page,
  }) => {
    await expect(sizeSelect(page)).toHaveValue('screen');
    await expect(widthInput(page)).toHaveValue('800');
    await expect(heightInput(page)).toHaveValue('600');
    await expect(widthInput(page)).toBeDisabled();
    await expect(heightInput(page)).toBeDisabled();
    await expect(dpiSelect(page)).toHaveValue('96');
    await expect(legendBox(page)).toBeChecked();
    await expect(nameInput(page)).toHaveValue('karmania-map');
    await expect(dialog(page).locator('.suffix')).toHaveText('.png');
    await expect(caption(page)).toHaveText('800 × 600 px · 96 dpi');
    // The preview is a picture of the map: a canvas with something in it.
    const drawnPixels = await previewCanvas(page).evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const data =
        canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
          inked += 1;
        }
      }
      return inked;
    });
    expect(drawnPixels).toBeGreaterThan(1000);
    await expect(exportAction(page)).not.toHaveAttribute('disabled', '');
  });

  test('has the size’s own numbers in width and height, and lets them be typed only for Custom', async ({
    page,
  }) => {
    await chooseSize(page, 'A4 landscape');
    await dpiSelect(page).selectOption('300');
    await expect(widthInput(page)).toHaveValue('3508');
    await expect(heightInput(page)).toHaveValue('2480');
    await expect(widthInput(page)).toBeDisabled();
    await expect(caption(page)).toHaveText('3,508 × 2,480 px · 300 dpi');
    await chooseSize(page, 'A4 portrait');
    await expect(widthInput(page)).toHaveValue('2480');
    await expect(heightInput(page)).toHaveValue('3508');
    await chooseSize(page, 'Custom');
    await expect(widthInput(page)).toBeEnabled();
    await widthInput(page).fill('1000');
    await heightInput(page).fill('700');
    await expect(caption(page)).toHaveText('1,000 × 700 px · 300 dpi');
  });

  test('makes the preview again after the options change, and the caption follows at once', async ({
    page,
  }) => {
    await chooseSize(page, 'A4 portrait');
    await expect(caption(page)).toHaveText('794 × 1,123 px · 96 dpi');
    // The preview is the shape of the picture: tall.
    await expect
      .poll(async () =>
        previewCanvas(page).evaluate(
          (e) => (e as HTMLCanvasElement).height > (e as HTMLCanvasElement).width,
        ),
      )
      .toBe(true);
    await chooseSize(page, 'A4 landscape');
    await expect
      .poll(async () =>
        previewCanvas(page).evaluate(
          (e) => (e as HTMLCanvasElement).width > (e as HTMLCanvasElement).height,
        ),
      )
      .toBe(true);
  });

  test('says in words, and does not export, a size that is too large for this computer, with the limit named', async ({
    page,
  }) => {
    await chooseSize(page, 'Custom');
    await widthInput(page).fill('20000');
    await expect(notes(page)).toContainText('The width can be at most');
    await expect(notes(page)).toContainText('pixels on this computer');
    await expect(exportAction(page)).toHaveAttribute('disabled', '');
    await expect(caption(page)).toHaveText('');
    await widthInput(page).fill('40');
    await expect(notes(page)).toContainText('The width has to be at least 64 pixels.');
    await widthInput(page).fill('12.5');
    await expect(notes(page)).toContainText('whole numbers');
    await widthInput(page).fill('1000');
    await expect(notes(page)).not.toContainText('whole numbers');
    await expect(exportAction(page)).not.toHaveAttribute('disabled', '');
  });

  test('makes a preview of a picture whose short side is the least there is, the preview being smaller than that least', async ({
    page,
  }) => {
    // 1,000 by 64 without a legend: the preview is 560 by 36, under the 64 pixel least that a PICTURE has to be, which does not apply to a preview.
    await chooseSize(page, 'Custom');
    await legendBox(page).uncheck();
    await widthInput(page).fill('1000');
    await heightInput(page).fill('64');
    await expect(caption(page)).toHaveText('1,000 × 64 px · 96 dpi');
    // The preview is made again after a moment: wait for the one that is of this size (the one before it, of the map's own shape, stays until then).
    await expect
      .poll(() =>
        previewCanvas(page).evaluate((e) => [
          (e as HTMLCanvasElement).width,
          (e as HTMLCanvasElement).height,
        ]),
      )
      .toEqual([560, 36]);
    await expect(dialog(page).locator('.frame')).toHaveAttribute('aria-busy', 'false');
    await expect(dialog(page).locator('.frame .hint')).toHaveCount(0);
  });

  test('says there is no room for the map, and does not export, when the legend takes the width; and that the map is narrow when it takes more than half', async ({
    page,
  }) => {
    await chooseSize(page, 'Custom');
    await widthInput(page).fill('300');
    await heightInput(page).fill('600');
    await expect(notes(page)).toContainText('leaves no room for the map');
    await expect(exportAction(page)).toHaveAttribute('disabled', '');
    // Without the legend the map has the width.
    await legendBox(page).uncheck();
    await expect(notes(page)).not.toContainText('no room');
    await expect(exportAction(page)).not.toHaveAttribute('disabled', '');
    await legendBox(page).check();
    // A width at which the legend is more than half of it: found by asking the viewer for the plan of pictures 1,000 high, narrower and narrower. The map is narrow, and the
    // picture can still be made.
    const narrow = await page.evaluate(async () => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        planPicture(o: object): Promise<{ layout: { warnings: string[] } }>;
      };
      for (let width = 900; width >= 400; width -= 10) {
        const plan = await viewer
          .planPicture({ size: { width, height: 1000 }, dpi: 96, legend: true })
          .catch(() => undefined);
        if (plan?.layout.warnings.join() === 'map_narrow') {
          return width;
        }
      }
      return undefined;
    });
    expect(narrow, 'a width at which the map is narrow').toBeDefined();
    await widthInput(page).fill(String(narrow));
    await heightInput(page).fill('1000');
    await expect(notes(page)).toContainText('takes more than half of the width');
    await expect(notes(page)).not.toContainText('no room');
    await expect(exportAction(page)).not.toHaveAttribute('disabled', '');
  });

  test('keeps the legend checkbox and Export disabled, with the reason, when every layer is hidden while it is open', async ({
    page,
  }) => {
    for (const id of ['layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5']) {
      await dispatch(page, { type: 'setVisible', layerId: id, visible: false });
    }
    await expect(legendBox(page)).toBeDisabled();
    await expect(dialog(page).locator('k-checkbox')).toHaveAttribute(
      'detail',
      'No layer is on the map.',
    );
    await expect(exportAction(page)).toHaveAttribute('disabled', '');
  });

  test('gives the file to the browser as a download, named as typed with ".png" after it, of the size asked for, and closes', async ({
    page,
  }) => {
    await chooseSize(page, 'A4 landscape');
    await nameInput(page).fill('Geology of the north.png');
    const download = page.waitForEvent('download');
    await exportAction(page).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Geology of the north.png');
    expect(pngSize(await file.path())).toEqual([1123, 794]);
    await expect(heading(page)).toBeHidden();
  });

  test('gives a file whose size, dpi and colour space are in it, and whose legend starts level with the top of the map, as the pixels of the file say', async ({
    page,
  }) => {
    await chooseSize(page, 'A4 landscape');
    await dpiSelect(page).selectOption('150');
    const download = page.waitForEvent('download');
    await exportAction(page).click();
    const file = await download;
    const bytes = readFileSync(await file.path());
    // The chunks: IHDR with the size, sRGB, pHYs at 150 dpi (5,906 pixels to the metre, in metres), IDAT, IEND.
    const chunks: { type: string; data: Buffer }[] = [];
    for (let at = 8; at < bytes.length;) {
      const length = bytes.readUInt32BE(at);
      chunks.push({
        type: bytes.toString('latin1', at + 4, at + 8),
        data: bytes.subarray(at + 8, at + 8 + length),
      });
      at += 12 + length;
    }
    expect(
      chunks.map((c) => c.type).filter((type, k, all) => k === 0 || type !== all[k - 1]),
    ).toEqual(['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
    expect([chunks[0]?.data.readUInt32BE(0), chunks[0]?.data.readUInt32BE(4)]).toEqual([
      1754, 1240,
    ]);
    const phys = chunks.find((c) => c.type === 'pHYs');
    expect([phys?.data.readUInt32BE(0), phys?.data.readUInt32BE(4), phys?.data[8]]).toEqual([
      5906, 5906, 1,
    ]);
    // The pixels of the file, decoded by the browser: the top of the map's line is the first row of the border colour in the middle of the left part, and the first mark of the
    // legend (in the right fifth, where only the legend is) is in the legend's first row, which is level with it: from that row to the end of one row of 32 pixels at 96 dpi (50 at 150).
    const rows = await page.evaluate(async (base64) => {
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }), {
        colorSpaceConversion: 'none',
      });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx?.drawImage(bitmap, 0, 0);
      const data =
        ctx?.getImageData(0, 0, bitmap.width, bitmap.height).data ?? new Uint8ClampedArray();
      const at = (x: number, y: number): number[] => [
        ...data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 3),
      ];
      let frame = -1;
      for (let y = 0; y < bitmap.height && frame < 0; y += 1) {
        const [r, g, b] = at(Math.floor(bitmap.width / 4), y);
        if (
          Math.abs((r ?? 0) - 125) <= 2 &&
          Math.abs((g ?? 0) - 135) <= 2 &&
          Math.abs((b ?? 0) - 148) <= 2
        ) {
          frame = y;
        }
      }
      let legend = -1;
      for (let y = 0; y < bitmap.height && legend < 0; y += 1) {
        for (let x = Math.floor(bitmap.width * 0.8); x < bitmap.width && legend < 0; x += 1) {
          const [r, g, b] = at(x, y);
          if ((r ?? 255) < 235 || (g ?? 255) < 235 || (b ?? 255) < 235) {
            legend = y;
          }
        }
      }
      return { frame, legend };
    }, bytes.toString('base64'));
    // The margin is 24 at 96 dpi: 38 at 150 (37.5 rounded).
    expect(rows.frame).toBe(38);
    expect(rows.legend).toBeGreaterThanOrEqual(rows.frame);
    expect(rows.legend).toBeLessThan(rows.frame + 50);
  });

  test('makes a name with no forbidden characters, and the default for none', async ({ page }) => {
    await chooseSize(page, 'Custom');
    await widthInput(page).fill('1000');
    await heightInput(page).fill('700');
    await nameInput(page).fill('../a:b');
    const first = page.waitForEvent('download');
    await exportAction(page).click();
    expect((await first).suggestedFilename()).toBe('a-b.png');
    await exportButton(page).click();
    await expect(previewCanvas(page)).toBeVisible();
    await nameInput(page).fill('   ');
    const second = page.waitForEvent('download');
    await exportAction(page).click();
    expect((await second).suggestedFilename()).toBe('karmania-map.png');
  });

  test('says how far it is while it works, in a status that keeps its room, and Cancel stops it with no download', async ({
    page,
  }) => {
    test.slow();
    await chooseSize(page, 'A4 landscape');
    await dpiSelect(page).selectOption('300');
    const before = await status(page).boundingBox();
    const exportBefore = await exportAction(page).boundingBox();
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    // The end of the picture that is made is noted in the page, so that "no download" is asserted once it has really ended and not after a wait.
    await withWork(
      page,
      `(real) => ({ ...real, run: async (o, r) => { window.__ended = false; try { return await real.run(o, r); } finally { window.__ended = true; } } })`,
    );
    await exportAction(page).click();
    await expect(status(page)).toContainText(/Rendering… \d+ %|Writing the file… \d+ %/);
    // Nothing moved: the status is as wide as it was and Export is where it was.
    expect((await status(page).boundingBox())?.width).toBe(before?.width);
    expect((await exportAction(page).boundingBox())?.x).toBe(exportBefore?.x);
    await expect(exportAction(page)).toHaveAttribute('disabled', '');
    await cancelAction(page).click();
    await expect(heading(page)).toBeHidden();
    await page.waitForFunction(() => (window as unknown as { __ended?: boolean }).__ended === true);
    expect(downloaded).toBe(false);
    // The next picture is made: nothing was left held.
    await openDialog(page);
    const again = page.waitForEvent('download');
    await exportAction(page).click();
    expect((await again).suggestedFilename()).toBe('karmania-map.png');
  });

  test('keeps Export disabled, and says the last picture is being stopped, when the dialog is opened again while a cancelled picture is still winding down; Export is enabled when it has ended', async ({
    page,
  }) => {
    // A picture that does not stop when it is told to (it ends when the test lets it): what a run that is slow to wind down is.
    await withWork(
      page,
      `(real) => ({ ...real, run: () => new Promise((_resolve, reject) => { window.__release = () => reject(new DOMException('Stopped', 'AbortError')); }) })`,
    );
    await exportAction(page).click();
    await expect(status(page)).toContainText('Rendering…');
    await cancelAction(page).click();
    await expect(heading(page)).toBeHidden();
    await exportButton(page).click();
    await expect(heading(page)).toBeVisible();
    // It would be enabled if opening the dialog forgot the picture that is still ending, and Export pressed then would meet a busy renderer.
    await expect(exportAction(page)).toHaveAttribute('disabled', '');
    await expect(status(page)).toHaveText('Stopping the last picture…');
    await page.evaluate(() => {
      (window as unknown as { __release: () => void }).__release();
    });
    await expect(exportAction(page)).not.toHaveAttribute('disabled', '');
    await expect(status(page)).toHaveText('');
    const download = page.waitForEvent('download');
    await exportAction(page).click();
    expect((await download).suggestedFilename()).toBe('karmania-map.png');
  });

  test('keeps the picture of the preview while the next one is made, so that the frame does not jump to its empty size and back at each change', async ({
    page,
  }) => {
    await withWork(page, `(real) => ({ ...real, preview: () => new Promise(() => undefined) })`);
    await chooseSize(page, 'A4 portrait');
    await expect(dialog(page).locator('.frame')).toHaveAttribute('aria-busy', 'true');
    await expect(previewCanvas(page)).toBeVisible();
    await expect(dialog(page).locator('.frame .hint')).toHaveCount(0);
  });

  test('says why Export cannot be pressed, in words in the footer', async ({ page }) => {
    await chooseSize(page, 'Custom');
    await widthInput(page).fill('20000');
    await expect(status(page)).toHaveText('The size is not one that can be made.');
    await widthInput(page).fill('1000');
    await expect(status(page)).toHaveText('');
  });

  test('names its controls for assistive technology, says a failure as an alert and lets the person try again, and gives the focus back to the button that opened it', async ({
    page,
  }) => {
    const d = dialog(page);
    for (const name of ['Size', 'Resolution']) {
      await expect(d.getByRole('combobox', { name, exact: true })).toBeVisible();
    }
    for (const name of ['Width (px)', 'Height (px)', 'File name']) {
      await expect(d.getByRole('textbox', { name, exact: true })).toBeVisible();
    }
    await expect(
      d.getByRole('checkbox', { name: 'Put the legend to the right of the map' }),
    ).toBeChecked();
    await expect(d.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await expect(d.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    // A failure is an alert, with words, and Export can be pressed again.
    await withWork(
      page,
      `(real) => ({ ...real, run: () => Promise.reject(Object.assign(new Error('x'), { name: 'ExportError', code: 'context_lost' })) })`,
    );
    await exportAction(page).click();
    await expect(d.getByRole('alert')).toContainText('The graphics card stopped drawing the map');
    await expect(exportAction(page)).not.toHaveAttribute('disabled', '');
    // Escape closes it, and the keyboard is on the button that opened it.
    await page.keyboard.press('Escape');
    await expect(heading(page)).toBeHidden();
    const focused = await page.evaluate(() => {
      let active: Element | null = document.activeElement;
      while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      // The native button inside the k-button that has it: the text is the k-button's.
      const root = active?.getRootNode();
      const host = root instanceof ShadowRoot ? root.host : null;
      return {
        tag: active?.tagName.toLowerCase(),
        host: host?.tagName.toLowerCase(),
        text: host?.textContent.trim(),
      };
    });
    expect(focused).toEqual({ tag: 'button', host: 'k-button', text: 'Export PNG' });
  });

  test('closes with Escape, and with the close button, and makes nothing', async ({ page }) => {
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await page.keyboard.press('Escape');
    await expect(heading(page)).toBeHidden();
    await openDialog(page);
    await dialog(page).getByRole('button', { name: /close/i }).click();
    await expect(heading(page)).toBeHidden();
    expect(downloaded).toBe(false);
  });
});
