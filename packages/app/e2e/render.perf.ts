/**
 * How the 2D view performs with the large files of `scripts/generate-fixtures` (section 9.6 of the phase 2 brief), in a real browser:
 *
 *   - 1,000,000 points: from loading to the first frame under 1.5 s; the frame time of a scripted pan, zoom and rotate keeping up with the
 *     display (the median at the beat of the display, which is 16.7 ms at 60 Hz: the owner's reading of the brief's "under 16.7 ms") and the
 *     95th percentile under 33 ms;
 *   - a grid of 4,000,000 cells: from loading to the first frame under 1.5 s; new classes visible under 300 ms;
 *   - a model of 1,000,000 blocks: from loading to the first frame under 3 s (its 3D orbit is a later milestone's);
 *   - no task on the main thread over 50 ms in any of them.
 *
 * It needs a quiet machine, so it is a project of its own, like `performance.perf.ts`: `pnpm perf` runs both. The numbers are for
 * `docs/perf.md`. The browser draws with the software driver of the Playwright image unless the machine gives it a card (the
 * brief's figures are for the real GPU): the number that the page reports as its renderer is printed with them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { warmTheGraphicsProcess } from './support/warm.js';
import { goTo, wizard } from './support/wizard.js';

const GENERATED = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/generated/${name}`, import.meta.url));

/** What the page needs to watch and wait with, in the page's own clock. */
const WATCH = `(() => {
  const long = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) long.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
  /** The frames that took over 45 ms, with the scripts that ran in them (the Long Animation Frames API): what a long task was made of. */
  const slow = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 45) continue;
        slow.push({
          start: Math.round(entry.startTime), duration: Math.round(entry.duration), blocking: Math.round(entry.blockingDuration),
          renderStart: Math.round(entry.renderStart - entry.startTime), layoutStart: Math.round(entry.styleAndLayoutStart - entry.startTime),
          scripts: entry.scripts.map((s) => ({
            type: s.invokerType, invoker: s.invoker, url: s.sourceURL.split('/').pop(), fn: s.sourceFunctionName, at: s.sourceCharPosition,
            ms: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration), pause: Math.round(s.pauseDuration),
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (error) { /* a browser without the API: the long tasks are still counted */ }
  const viewer = () => document.querySelector('karmania-app').shadowRoot.querySelector('karmania-viewer');
  const frames = () => (viewer().renderStats() ?? { frames: 0 }).frames;
  /** Waits a frame at a time until \`check\` says yes; says when. */
  function until(check, timeout) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const tick = () => {
        const now = performance.now();
        const got = check();
        if (got) return resolve(now);
        if (now - started > timeout) return reject(new Error('timed out'));
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  window.perf = { long, slow, viewer, frames, until };
})()`;

const inPage = <T>(page: Page, body: string): Promise<T> =>
  page.evaluate<T>(`(async () => { const perf = window.perf; ${body} })()`);

interface Measured {
  readonly file: string;
  readonly renderer: string;
  /** From pressing Load to the first frame that has the layer in it. */
  readonly firstFrameMs: number;
  /** The frames of a scripted pan, zoom and rotate, as the time between two of them, in ms. */
  readonly frames?: {
    readonly median: number;
    readonly p95: number;
    readonly count: number;
    /** The beat of the display: the median gap between animation frames of the same page with nothing happening, in ms. */
    readonly displayMs: number;
    /** How many frames the renderer drew meanwhile, which is what makes the gaps those of drawing and not of an idle page. */
    readonly drawn: number;
  };
  /** From asking for new classes to the picture having them. */
  readonly restyleMs?: number;
  /** The longest task of the main thread, from pressing Load to the end. */
  readonly longestTaskMs: number;
}

const RESULTS: Measured[] = [];

interface Options {
  readonly data: string;
  readonly sidecar: string;
  /** Blocks are told how big they are. */
  readonly blockSize?: number;
  readonly path: boolean;
  readonly restyle: boolean;
}

async function measure(browser: Browser, options: Options): Promise<Measured> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/__generated/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    await route.fulfill({
      body: readFileSync(GENERATED(name)),
      contentType: 'application/octet-stream',
    });
  });
  await page.addInitScript(WATCH);
  await page.goto('/?theme=light');
  const w = wizard(page);
  await inPage(
    page,
    `const bring = async (name) => new File([await (await fetch('/__generated/' + name)).blob()], name);
     window.files = [await bring(${JSON.stringify(options.data)}), await bring(${JSON.stringify(options.sidecar)})];
     perf.viewer().shadowRoot.querySelector('karmania-map-area').dispatchEvent(
       new CustomEvent('karmania-files-dropped', { detail: { files: window.files }, bubbles: true, composed: true }));`,
  );
  await inPage(
    page,
    `await perf.until(() => perf.viewer().shadowRoot.querySelector('karmania-import-dialog').shadowRoot.querySelector('karmania-file-step'), 120000);`,
  );
  await goTo(page, 'mapping');
  if (options.blockSize !== undefined) {
    const sizes = w.host.locator('karmania-mapping-step .block-size input');
    for (let axis = 0; axis < 3; axis += 1) {
      await sizes.nth(axis).fill(String(options.blockSize));
    }
  }
  for (const step of ['nodata', 'crs', 'review']) {
    await goTo(page, step);
  }
  await expect(w.host.locator('karmania-review-step .verdict')).toHaveText('Ready to load', {
    timeout: 180_000,
  });

  // With `KARMANIA_PROFILE=1` the browser is traced from pressing Load to the end, and the tasks of the main thread over 50 ms are printed
  // with the heaviest things that ran inside them: what to look at when a task is over 50 ms.
  const profiled = process.env['KARMANIA_PROFILE'] !== undefined;
  if (profiled) {
    await browser.startTracing(page, {
      categories: ['toplevel', 'devtools.timeline', 'v8.execute', 'blink', 'gpu'],
    });
  }
  // Loading, to the first frame with the layer in it: the layer is drawn (on the card, its first part) and a frame came after.
  const started = await inPage<number>(page, 'return performance.now();');
  await w.next.click();
  const first = await inPage<number>(
    page,
    `return await perf.until(() => {
       const v = perf.viewer();
       const states = v.layerStates();
       const stats = v.renderStats();
       // The layer is drawn, and a frame has drawn it (a layer is not drawn until its shader programs are compiled).
       return states.length > 0 && states.every(([, s]) => s.status === 'drawn') && stats && stats.layersDrawn > 0;
     }, 180000);`,
  );

  let frames: Measured['frames'];
  if (options.path) {
    // The path: 100 frames of pan, 100 of zoom in and out, 100 of rotate, the camera given a new place each frame, and the time between
    // the frames that the browser gave, which is what a person sees as smooth or not.
    const { gaps, drawn, idle } = await inPage<{ gaps: number[]; drawn: number; idle: number[] }>(
      page,
      `const v = perf.viewer();
       const doc = v.scene();
       const start = doc.camera2d;
       const wait = () => new Promise((resolve) => requestAnimationFrame(resolve));
       // The beat of the display: 60 frames of the page with nothing happening in it (the rest of the layer is on the card by now: a part comes
       // in each frame, and a million points are ten of them).
       const idle = [];
       await new Promise((resolve) => setTimeout(resolve, 500));
       await wait();
       let before = performance.now();
       for (let i = 0; i < 60; i += 1) {
         await wait();
         const at = performance.now();
         idle.push(at - before);
         before = at;
       }
       const framesBefore = v.renderStats().frames;
       const gaps = [];
       let last = performance.now();
       for (let i = 0; i < 300; i += 1) {
         const t = i % 100;
         const camera2d = i < 100
           ? { centre: [start.centre[0] + t * start.unitsPerPixel * 4, start.centre[1] + t * start.unitsPerPixel * 2], unitsPerPixel: start.unitsPerPixel, heading: 0 }
           : i < 200
             ? { centre: start.centre, unitsPerPixel: start.unitsPerPixel * (1 + 0.5 * Math.sin((t / 100) * Math.PI)), heading: 0 }
             : { centre: start.centre, unitsPerPixel: start.unitsPerPixel, heading: t * 3.6 };
         v.dispatch({ type: 'setCamera', patch: { camera2d } });
         await wait();
         const now = performance.now();
         gaps.push(now - last);
         last = now;
       }
       return { gaps, drawn: v.renderStats().frames - framesBefore, idle };`,
    );
    const sorted = [...gaps].sort((a, b) => a - b);
    const idleSorted = [...idle].sort((a, b) => a - b);
    frames = {
      displayMs: Math.round((idleSorted[Math.floor(idleSorted.length / 2)] ?? 0) * 100) / 100,
      median: Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 100) / 100,
      p95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 100) / 100,
      count: gaps.length,
      drawn,
    };
  }

  let restyleMs: number | undefined;
  if (options.restyle) {
    // New classes: a sample of the picture, then the number of classes changed, then the time until the sample is not the same.
    restyleMs = await inPage<number>(
      page,
      `const v = perf.viewer();
       const stats = v.renderStats();
       const read = () => Array.from(v.renderPixels(Math.floor(stats.width / 2) - 32, Math.floor(stats.height / 2), 64, 1) ?? []).join(',');
       const before = read();
       const style = v.scene().layers['layer-1'].style.colour;
       const at = performance.now();
       v.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { colour: { ...style, classes: 12 } } });
       const done = await perf.until(() => read() !== before, 60000);
       return done - at;`,
    );
  }

  const tasks = await inPage<{ start: number; duration: number }[]>(page, 'return perf.long;');
  // The frames over 45 ms and the scripts in them, for what a long task was made of (printed, not asserted).
  const slow = await inPage<{ start: number }[]>(page, 'return perf.slow;');
  const slowAfter = slow.filter((frame) => frame.start >= started);
  if (slowAfter.length > 0) {
    console.info(`SLOW ${options.data} ${JSON.stringify(slowAfter)}`);
  }
  if (profiled) {
    const trace = JSON.parse((await browser.stopTracing()).toString()) as {
      traceEvents: {
        name: string;
        ph: string;
        ts: number;
        dur?: number;
        tid: number;
        pid: number;
        args?: Record<string, unknown>;
      }[];
    };
    // The main thread of the renderer process is the one that has the `RunTask` events of the longest tasks.
    const events = trace.traceEvents.filter((event) => event.ph === 'X' && event.dur !== undefined);
    // Whatever ran for over 40 ms on any thread: its name, how long, and the thread.
    const lines = events
      .filter((event) => (event.dur ?? 0) > 40_000)
      .sort((x, y) => (y.dur ?? 0) - (x.dur ?? 0))
      .slice(0, 14)
      .map(
        (event) =>
          `${event.name} ${String(Math.round((event.dur ?? 0) / 1000))}ms tid=${String(event.tid)} at ${String(Math.round(event.ts / 1000) % 100000)}`,
      );
    console.info(`TRACE ${options.data} ${JSON.stringify(lines)}`);
  }
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl !== null && info !== null && info !== undefined
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : 'unknown';
  });
  await context.close();
  return {
    file: options.data,
    renderer,
    firstFrameMs: Math.round(first - started),
    ...(frames === undefined ? {} : { frames }),
    ...(restyleMs === undefined ? {} : { restyleMs: Math.round(restyleMs) }),
    longestTaskMs: Math.round(
      Math.max(0, ...tasks.filter((task) => task.start >= started).map((task) => task.duration)),
    ),
  };
}

test.describe('the 2D view with the large files', () => {
  test.beforeAll(async ({ browser }) => {
    await warmTheGraphicsProcess(browser);
  });

  test.beforeAll(() => {
    for (const name of [
      'points-1m.csv',
      'points-1m.prj',
      'grid-4m.asc',
      'grid-4m.prj',
      'blocks-1m.csv',
      'blocks-1m.prj',
    ]) {
      if (!existsSync(GENERATED(name))) {
        throw new Error(`fixtures/generated/${name} is missing: run scripts/generate-fixtures`);
      }
    }
  });

  test.afterAll(() => {
    const folder = fileURLToPath(new URL('../test-results/', import.meta.url));
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${folder}render-performance.json`, JSON.stringify(RESULTS, null, 2));
    console.info(`PERF-RENDER ${JSON.stringify(RESULTS)}`);
  });

  test('1,000,000 points: the first frame, and the frames of a pan, a zoom and a rotation', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'points-1m.csv',
      sidecar: 'points-1m.prj',
      path: true,
      restyle: false,
    });
    RESULTS.push(result);
    expect(result.firstFrameMs, 'loaded to first frame').toBeLessThan(1500);
    // The renderer drew a frame for each of the 300 changes of the camera: the gaps below are those of a page that draws, not of one that is idle.
    expect(result.frames?.drawn, 'frames the renderer drew').toBeGreaterThanOrEqual(290);
    // Keeping up with the display, which is what the owner says the brief's "under 16.7 ms" means at 60 Hz (decision 16.F13): the median gap
    // between the frames of the scripted camera is the beat of the display, which the same page measures with nothing happening in it, to
    // within 5% (the clock reads 0.1 ms, and the beat that is read varies by that much from run to run: 16.5 to 16.7 were seen). A frame missed
    // at every other beat would be a median of twice the beat.
    expect(
      result.frames?.median,
      'median frame time, at the beat of the display',
    ).toBeLessThanOrEqual((result.frames?.displayMs ?? 0) * 1.05);
    expect(result.frames?.p95, '95th percentile frame time').toBeLessThan(33);
    expect(result.longestTaskMs, 'longest task of the main thread').toBeLessThanOrEqual(50);
  });

  test('4,000,000 cells: the first frame, and new classes', async ({ browser }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'grid-4m.asc',
      sidecar: 'grid-4m.prj',
      path: false,
      restyle: true,
    });
    RESULTS.push(result);
    expect(result.firstFrameMs, 'loaded to first frame').toBeLessThan(1500);
    expect(result.restyleMs, 'new classes visible').toBeLessThan(300);
    expect(result.longestTaskMs, 'longest task of the main thread').toBeLessThanOrEqual(50);
  });

  test('1,000,000 blocks: the first frame', async ({ browser }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'blocks-1m.csv',
      sidecar: 'blocks-1m.prj',
      blockSize: 10,
      path: false,
      restyle: false,
    });
    RESULTS.push(result);
    expect(result.firstFrameMs, 'loaded to first frame').toBeLessThan(3000);
    expect(result.longestTaskMs, 'longest task of the main thread').toBeLessThanOrEqual(50);
  });
});
