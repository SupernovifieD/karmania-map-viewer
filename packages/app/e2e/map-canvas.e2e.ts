import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { inEveryLayout } from './support/layouts.js';
import { importAndLoad } from './support/wizard.js';

const area = (page: Page) => page.locator('karmania-map-area');
const canvas = (page: Page) => area(page).locator('canvas');

/** What the renderer says of itself (`RenderStats`). */
interface Stats {
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelRatio: number;
  readonly geometries: number;
  readonly textures: number;
}

/** The renderer's account of itself, reached through the viewer; `undefined` while there is no renderer. */
function stats(page: Page): Promise<Stats | undefined> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      renderStats(): Stats | undefined;
    };
    return viewer.renderStats();
  });
}

/** Waits until a frame has been drawn: the renderer is made just after the first render, and draws when its canvas has a size. */
async function drawn(page: Page): Promise<Stats> {
  await expect.poll(async () => (await stats(page))?.frames ?? 0).toBeGreaterThan(0);
  const now = await stats(page);
  if (now === undefined) {
    throw new Error('There is no renderer.');
  }
  return now;
}

/** Loads a file, which gives the scene its first layer, and so the viewer its renderer; waits for the first frame. */
async function withData(page: Page): Promise<Stats> {
  await importAndLoad(page, 'points.csv', 'points.prj');
  return drawn(page);
}

const pause = (page: Page, ms: number): Promise<void> =>
  page.evaluate((time) => new Promise<void>((resolve) => setTimeout(resolve, time)), ms);

test.describe('the map canvas', () => {
  test('has no renderer, and holds no context of the graphics card, until there is something to draw', async ({
    page,
  }) => {
    await page.goto('/');
    expect(await stats(page)).toBeUndefined();
    // The canvas is there and is not drawn on: its buffer is the size that a canvas has before anyone sets one.
    expect(
      await canvas(page).evaluate((element) => [
        (element as HTMLCanvasElement).width,
        (element as HTMLCanvasElement).height,
      ]),
    ).toEqual([300, 150]);
    await withData(page);
    expect(await stats(page)).toBeDefined();
  });

  test('fills the map area exactly, at every window size in both themes', async ({ page }) => {
    await inEveryLayout(page, '/', async ({ name }) => {
      await withData(page);
      const [map, box] = await Promise.all([area(page).boundingBox(), canvas(page).boundingBox()]);
      expect(box, name).toEqual(map);
      const now = await stats(page);
      expect(now?.width, name).toBe(Math.round(map?.width ?? 0));
      expect(now?.height, name).toBe(Math.round(map?.height ?? 0));
    });
  });

  test('is under what is laid over the map area, and takes nothing from the pointer', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    const heading = area(page).locator('k-empty-state');
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    const top = await page.evaluate(
      ([x, y]) => {
        // Through the shadow roots: what is at the middle of the empty state, from the top.
        const find = (root: Document | ShadowRoot): Element | null => {
          const element = root.elementFromPoint(x ?? 0, y ?? 0);
          return element?.shadowRoot ? (find(element.shadowRoot) ?? element) : element;
        };
        return find(document)?.tagName.toLowerCase();
      },
      [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2],
    );
    expect(top).not.toBe('canvas');
  });

  test('draws a frame when it is asked for and not otherwise: an idle page draws none', async ({
    page,
  }) => {
    await page.goto('/');
    const first = await withData(page);
    await pause(page, 600);
    expect((await stats(page))?.frames).toBe(first.frames);
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect.poll(async () => (await stats(page))?.frames ?? 0).toBeGreaterThan(first.frames);
    const resized = await drawn(page);
    await pause(page, 600);
    expect((await stats(page))?.frames).toBe(resized.frames);
  });

  test('follows the size of the window', async ({ page }) => {
    await page.goto('/');
    let before = await withData(page);
    for (const [width, height] of [
      [1300, 800],
      [1024, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      // Until the buffer is the size of the box as it is now, which is not the size it had.
      await expect
        .poll(async () => {
          const [box, now] = await Promise.all([canvas(page).boundingBox(), stats(page)]);
          return (
            box !== null &&
            now !== undefined &&
            now.width === Math.round(box.width) &&
            now.height === Math.round(box.height) &&
            now.cssWidth === box.width &&
            now.width !== before.width
          );
        })
        .toBe(true);
      before = await drawn(page);
    }
  });

  test('gives the context up when the viewer is taken out of the page, and has no renderer then', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    const lost = await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as HTMLElement & {
        renderStats(): unknown;
      };
      const canvas = viewer.shadowRoot
        ?.querySelector('karmania-map-area')
        ?.shadowRoot?.querySelector('canvas');
      viewer.remove();
      return {
        stats: viewer.renderStats() ?? null,
        lost: canvas?.getContext('webgl2')?.isContextLost() ?? null,
      };
    });
    expect(lost).toEqual({ stats: null, lost: true });
  });
});

test.describe('the map canvas on a screen of twice the density', () => {
  test.use({ deviceScaleFactor: 2 });

  test('has a buffer of twice the pixels of its box, which the renderer says', async ({ page }) => {
    await page.goto('/');
    const now = await withData(page);
    const box = await canvas(page).boundingBox();
    expect(now.pixelRatio).toBe(2);
    expect(now.width).toBe(Math.round((box?.width ?? 0) * 2));
    expect(now.height).toBe(Math.round((box?.height ?? 0) * 2));
    expect(
      await canvas(page).evaluate((element) => [
        (element as HTMLCanvasElement).width,
        (element as HTMLCanvasElement).height,
      ]),
    ).toEqual([now.width, now.height]);
  });
});
