import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { inEveryLayout } from './support/layouts.js';
import { camera, dispatch, drawn, pause, stats, withData } from './support/render.js';
import { importAndLoad } from './support/wizard.js';

const area = (page: Page) => page.locator('karmania-map-area');
const canvas = (page: Page) => area(page).locator('canvas');

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

  test('says that the map cannot be drawn when the browser gives no WebGL 2, and says nothing of layers being prepared', async ({
    page,
  }) => {
    // A browser that has no WebGL 2: the page asks for it and is told there is none, and the asks are counted.
    await page.addInitScript(() => {
      const original = Reflect.get(HTMLCanvasElement.prototype, 'getContext') as (
        this: HTMLCanvasElement,
        ...args: unknown[]
      ) => unknown;
      const holder = window as unknown as { asks: number };
      holder.asks = 0;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]): unknown {
          if (kind === 'webgl2') {
            holder.asks += 1;
            return null;
          }
          return original.call(this, kind, ...rest);
        },
      });
    });
    await page.goto('/');
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(area(page).getByText('The map cannot be drawn')).toBeVisible();
    await expect(area(page).getByText('WebGL 2')).toBeVisible();
    expect(await stats(page)).toBeUndefined();
    // The layers are prepared and waiting, and the chip that says they are being prepared is not there for ever.
    await expect(area(page).locator('.chip')).toHaveCount(0);
    // And it is not asked again for every change of the scene.
    const asks = () => page.evaluate(() => (window as unknown as { asks: number }).asks);
    const before = await asks();
    expect(before).toBeGreaterThan(0);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false });
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: true });
    await pause(page, 200);
    expect(await asks()).toBe(before);
  });

  test('is made all the same when the card takes the context away while the renderer is being made, and gives it back', async ({
    page,
  }) => {
    // The first context that the page asks for is lost at once, and given back 30 ms later: a reset of the card in the middle of the start.
    await page.addInitScript(() => {
      const original = Reflect.get(HTMLCanvasElement.prototype, 'getContext') as (
        this: HTMLCanvasElement,
        ...args: unknown[]
      ) => unknown;
      let first = true;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value(this: HTMLCanvasElement, kind: string, ...rest: unknown[]): unknown {
          const context = original.call(this, kind, ...rest);
          if (kind === 'webgl2' && first && context !== null) {
            first = false;
            const lose = (context as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
            lose?.loseContext();
            window.setTimeout(() => {
              lose?.restoreContext();
            }, 30);
          }
          return context;
        },
      });
    });
    await page.goto('/');
    await withData(page);
    expect((await stats(page))?.contextLost).toBe(false);
    await expect(area(page).getByText('The map cannot be drawn')).toHaveCount(0);
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

  test('is under what is laid over the map area, which lets the pointer through to it', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    // What is laid over the map: the words of the area when none of it can be drawn (told here, as the viewer would).
    await area(page).evaluate(async (element) => {
      const held = element as unknown as { reasons: string[]; updateComplete: Promise<boolean> };
      held.reasons = ['Not drawn.'];
      await held.updateComplete;
    });
    const heading = area(page).locator('k-empty-state');
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    const middle = [
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    ] as const;
    /** What is at the middle of the empty state, from the top, through the shadow roots. */
    const topmost = (): Promise<string | undefined> =>
      page.evaluate(([x, y]) => {
        const find = (root: Document | ShadowRoot): Element | null => {
          const element = root.elementFromPoint(x, y);
          return element?.shadowRoot ? (find(element.shadowRoot) ?? element) : element;
        };
        return find(document)?.tagName.toLowerCase();
      }, middle);
    // The empty state fills the area and does not take the pointer, so the map is what the pointer is on...
    expect(await topmost()).toBe('canvas');
    // ...and it is over the map: with the pointer given back to it, it is what is on top there.
    await heading.evaluate((element) => {
      element.style.pointerEvents = 'auto';
    });
    expect(await topmost()).not.toBe('canvas');
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
          const [box, now, view] = await Promise.all([
            canvas(page).boundingBox(),
            stats(page),
            camera(page),
          ]);
          return (
            box !== null &&
            now !== undefined &&
            now.width === Math.round(box.width) &&
            now.height === Math.round(box.height) &&
            now.cssWidth === box.width &&
            // The camera shows the new box too: half of it on each side, at the scale of the camera of the scene.
            Math.abs(now.frame.right - (box.width * view.unitsPerPixel) / 2) < 1e-6 &&
            Math.abs(now.frame.top - (box.height * view.unitsPerPixel) / 2) < 1e-6 &&
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

  test('draws nothing after the viewer is taken out of the page, though a frame was waiting when a picture was read', async ({
    page,
  }) => {
    await page.goto('/');
    await withData(page);
    const drawnAfter = await page.evaluate(async () => {
      // Every clear of the buffer is a frame drawn (or a picture read), which is counted from here.
      const proto = WebGL2RenderingContext.prototype;
      const clear = Reflect.get(proto, 'clear');
      let clears = 0;
      proto.clear = function (this: WebGL2RenderingContext, mask: number): void {
        clears += 1;
        clear.call(this, mask);
      };
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as HTMLElement & {
        dispatch(command: unknown): unknown;
        renderPixels(x: number, y: number, width: number, height: number): unknown;
      };
      // A frame is asked for (the camera turns), a picture is read (it draws now, and the frame that was asked for is still to come), and the viewer goes.
      viewer.dispatch({ type: 'setCamera', patch: { camera2d: { heading: 10 } } });
      viewer.renderPixels(0, 0, 1, 1);
      const before = clears;
      viewer.remove();
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      proto.clear = clear;
      return clears - before;
    });
    expect(drawnAfter).toBe(0);
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
