import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Engine } from '@karmania/viewer';
import { buildLibrary, libraryPages } from './support/library';
import type { BuiltLibrary } from './support/library';
import { trackLeaks } from './support/leaks';
import type { Leaks } from './support/leaks';
import { serveSite } from './support/site';
import type { Site } from './support/site';

declare global {
  interface Window {
    /** The engine that a test made and gave to a viewer. */
    engine?: Engine;
  }
}

/**
 * Taking a viewer out of a page (brief 23.4): `dispose` ends what the viewer made, so that a page that makes viewers and drops them (a single-page app, a dialog that has one in
 * it) does not collect workers, WebGL contexts (a browser keeps about sixteen alive and loses the oldest), animation frames, observers or listeners. The page is the build's, as an
 * embedder would have it; `support/leaks.ts` counts what the page makes and what it lets go of, from before the first script runs.
 */
let library: BuiltLibrary;
let site: Site;

test.beforeAll(async () => {
  library = await buildLibrary();
  site = await serveSite({ pages: libraryPages('/lib/'), folders: { '/lib/': library.folder } });
});

test.afterAll(async () => {
  await site.close();
  library.remove();
});

/** Opens the page, and says what it has made before any viewer. */
async function open(page: Page): Promise<{ read: () => Promise<Leaks>; before: Leaks }> {
  const read = await trackLeaks(page);
  await page.goto(`${site.origin}/`);
  await page.waitForFunction(() => 'library' in window);
  return { read, before: await read() };
}

/** Makes a viewer in `#first` (as `window.first`), with data to draw unless `empty`, and waits until it has drawn. */
async function make(page: Page, empty = false): Promise<void> {
  await page.evaluate(async (without) => {
    const { createViewer, points, grid } = window.library;
    const place = document.querySelector<HTMLElement>('#first');
    if (place === null) {
      throw new Error('The page has no place for a viewer.');
    }
    const viewer = createViewer(place, {});
    window.first = viewer;
    if (!without) {
      const crs = { kind: 'local', units: 'm' } as const;
      const x = Array.from({ length: 20 }, (_, i) => 10 * i);
      await viewer.load(points({ name: 'Wells', x, y: x.map((value) => value * 2), crs }));
      await viewer.load(
        grid({
          name: 'Topography',
          origin: [0, 0, 0],
          spacing: [10, 10, 1],
          dims: [4, 4, 1],
          values: { z: Array.from({ length: 16 }, (_, i) => i) },
          crs,
        }),
      );
    }
  }, empty);
  if (!empty) {
    await expect.poll(() => page.evaluate(() => window.first?.exportable())).toBe(true);
  }
}

/**
 * Takes the viewer out while the map is changing (the view is switched, so a frame is asked for), and lets what it set going (an observer's callback) come. It gives the
 * animation frames that were asked for just before the disposal and those that still are in the same breath as it, when no frame can have come yet: a frame that is left
 * asking and then comes and does nothing is not seen a moment later, and is not what a viewer that is taken out should leave.
 */
async function dispose(page: Page): Promise<{ asked: number; left: number }> {
  const frames = await page.evaluate(() => {
    window.first?.setViewMode('3d');
    const asked = window.__leaks.frames.size;
    window.first?.dispose();
    return { asked, left: window.__leaks.frames.size };
  });
  await page.waitForTimeout(300);
  return frames;
}

/** What a page has that a page that never made a viewer has not. */
const over = (now: Leaks, before: Leaks) => ({
  workers: now.workers.started - now.workers.terminated,
  contexts: now.contexts.live - before.contexts.live,
  frames: now.frames - before.frames,
  observers: now.observers - before.observers,
  listeners: now.listeners - before.listeners,
});

test.describe('taking a viewer out of a page', () => {
  test('twice over, leaves behind no worker, no WebGL context, no animation frame, no observer and no listener', async ({
    page,
  }) => {
    const { read, before } = await open(page);
    expect(before.workers).toEqual({ started: 0, terminated: 0 });
    for (const round of [1, 2]) {
      await make(page);
      // The control: while the viewer is there, the counts see it (a count that cannot see a viewer proves nothing when it sees none).
      const during = over(await read(), before);
      expect(during.workers, `round ${String(round)}: a worker`).toBe(1);
      expect(during.contexts, `round ${String(round)}: a WebGL context`).toBeGreaterThanOrEqual(1);
      expect(during.observers, `round ${String(round)}: observers`).toBeGreaterThanOrEqual(1);

      const frames = await dispose(page);
      // The control: a frame was asked for as the viewer was taken out, and none is left asking.
      expect(frames.asked, `round ${String(round)}: a frame was asked for`).toBeGreaterThan(
        before.frames,
      );
      expect(frames.left, `round ${String(round)}: frames left asking`).toBe(before.frames);
      const after = await read();
      expect(after.workers, `round ${String(round)}: workers`).toEqual({
        started: round,
        terminated: round,
      });
      expect(over(after, before), `round ${String(round)}`).toEqual({
        workers: 0,
        contexts: 0,
        frames: 0,
        observers: 0,
        listeners: 0,
      });
      expect(await page.locator('karmania-viewer').count()).toBe(0);
    }
    // Every context that was made is lost, not only the ones that the count above is made of.
    const last = await read();
    expect(last.contexts.created).toBeGreaterThanOrEqual(2);
    expect(last.contexts.live).toBe(0);
  });

  test('a viewer that was taken out before it drew anything, or as soon as it was made, leaves nothing behind either', async ({
    page,
  }) => {
    const { read, before } = await open(page);
    await make(page, true);
    await dispose(page);
    expect(over(await read(), before)).toEqual({
      workers: 0,
      contexts: 0,
      frames: 0,
      observers: 0,
      listeners: 0,
    });
    // Made and taken out in the same breath.
    await page.evaluate(() => {
      const place = document.querySelector<HTMLElement>('#first');
      if (place === null) {
        throw new Error('The page has no place for a viewer.');
      }
      window.library.createViewer(place, {}).dispose();
    });
    await page.waitForTimeout(300);
    expect(over(await read(), before)).toEqual({
      workers: 0,
      contexts: 0,
      frames: 0,
      observers: 0,
      listeners: 0,
    });
  });

  test('can be done twice to the same viewer, and does nothing the second time', async ({
    page,
  }) => {
    const { read, before } = await open(page);
    await make(page);
    await dispose(page);
    const once = await read();
    // Again, and nothing else: no other call may be made on a viewer that is gone.
    await page.evaluate(() => window.first?.dispose());
    await page.waitForTimeout(300);
    expect(await read()).toEqual(once);
    expect(over(once, before)).toEqual({
      workers: 0,
      contexts: 0,
      frames: 0,
      observers: 0,
      listeners: 0,
    });
  });

  test('leaves the engine that the page gave it to the page, which ends it when it likes', async ({
    page,
  }) => {
    const { read, before } = await open(page);
    await page.evaluate(async () => {
      const { createEngine, createViewer, points } = window.library;
      const place = document.querySelector<HTMLElement>('#first');
      if (place === null) {
        throw new Error('The page has no place for a viewer.');
      }
      const engine = createEngine();
      await engine.load(
        points({ name: 'Wells', x: [1, 2], y: [3, 4], crs: { kind: 'local', units: 'm' } }),
      );
      window.first = createViewer(place, { engine });
      window.engine = engine;
    });
    await expect.poll(() => page.evaluate(() => window.first?.exportable())).toBe(true);
    await dispose(page);
    // The viewer's things are gone and the engine's worker is not.
    let after = await read();
    expect(after.workers).toEqual({ started: 1, terminated: 0 });
    expect(after.contexts.live - before.contexts.live).toBe(0);
    expect(await page.evaluate(() => window.engine?.datasets().length)).toBe(1);
    await page.evaluate(() => window.engine?.dispose());
    after = await read();
    expect(after.workers).toEqual({ started: 1, terminated: 1 });
  });
});
