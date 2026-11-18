/**
 * How the 2D view performs with the large files of `scripts/generate-fixtures` (section 9.6 of the phase 2 brief), in a real browser:
 *
 *   - 1,000,000 points: from loading to the first frame under 1.5 s; the frame time of a scripted pan, zoom and rotate keeping up with the
 *     display (the median at the beat of the display, which is 16.7 ms at 60 Hz: the owner's reading of the brief's "under 16.7 ms") and the
 *     95th percentile under 33 ms;
 *   - a grid of 4,000,000 cells: from loading to the first frame under 1.5 s; new classes visible under 300 ms;
 *   - a model of 1,000,000 blocks: from loading to the first frame under 3 s; and, in 3D, the 95th percentile of the frame time of a scripted
 *     orbit under 50 ms (step 18.9b);
 *   - the same grid with 20 levels of contour lines turned on: the lines made in the worker (the engine's answer) under 2 s, and drawn, with no task
 *     of the main thread over 50 ms (step 20.7);
 *   - a picture of A4 landscape at 300 dpi (3,508 by 2,480) of the million points, with a legend: made and encoded as a PNG file in under 3 s, with no task of
 *     the main thread over 50 ms while it is made (step 22.11);
 *   - the same grid and the million points are switched to 3D and back to 2D after the rest, the blocks are switched to 3D, and the longest task of the main thread
 *     in each switch is held to 50 ms by itself (step 24.3a), as is the longest in the time from pressing Load to the first frame, which is where the data is
 *     prepared and uploaded to the card in chunks (section 8 of the brief: "preparing, uploading, restyling, contouring or switching views");
 *   - the start of the page: five fresh pages, the longest task of the main thread of each from the navigation to two seconds after the map area is there, held to
 *     50 ms (step 24.3d; the owner asked for it after the measurement of step 17.10);
 *   - no task on the main thread over 50 ms in any of them, which for the blocks includes the switch to 3D.
 *
 * Known, not met, and for the owner (step 24.3d, 2026-11-19): **the start of the page is a task of 80 to 150 ms on the development laptop** (a 1.1 GHz CPU; five fresh pages, two
 * runs: 107 to 150), one task made of the evaluation of the modules (about 23 ms), the first draw of the shell (55 to 75) and the first draw of the three dialogs that nobody has
 * opened (about 50, of which the first number of the export dialog's caption starts the browser's number formatting: 15 ms). Option (b) of 17.10 was tried and **not kept**:
 * the three dialogs made in later tasks and `<karmania-app>` defined a task after the modules brought the longest task to 49 to 67 ms (53 to 77 with one dialog in each task),
 * which is under 50 in some pages and not in all, because the shell's own first draw is 55 to 75 ms and cannot be split without leaving out something that is on the screen at
 * the start; and it broke three tests of the embedded viewer that look for the dialogs at once. What would bring it under is (a) of 17.10: not drawing at the start what is not seen
 * (the tab of the panel that is not open, among others), which changes what the first draw makes. The patch of the attempt is in the notes. This test is not made easier.
 *
 * Known, and left as it is by the owner's decision (M22, 2026-11-17): the first run after the machine has been left alone (the graphics driver's cache is cold) can have
 * a task over 50 ms, which these tests then report as a failure: in the gate of M22 a callback of 197 ms in the export and one of 1,195 ms in the first draw of the
 * million points, none of them in the runs after (and 55 ms in one of nine warm runs of the export). Its cause was not shown. The first draw of a layer is not made
 * smaller for it and the targets are not changed; the owner will decide with more testing on real machines (`docs/perf.md`, M22).
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
  /** The frames that took over 50 ms (where the Long Animation Frames API starts to report), with the scripts that ran in them: what a long task was made of. */
  const slow = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        
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
    /** How many of the gaps were over one and a half beats (a frame that was late: the 95th percentile is what is held to), for the record. */
    readonly late: number;
    /** The beat of the display: the median gap between animation frames of the same page with nothing happening, in ms. */
    readonly displayMs: number;
    /** How many frames the renderer drew meanwhile, which is what makes the gaps those of drawing and not of an idle page. */
    readonly drawn: number;
  };
  /** From switching to 3D (and fitting) to the first frame that has the layer in it, in 3D, ms. */
  readonly switchMs?: number;
  /** The longest task of the main thread while the view was switched (to 3D, and for `switchView` back to 2D as well), ms. */
  readonly switchLongestTaskMs?: number;
  /** From switching back to 2D to the first frame that has the layer in it, in 2D, ms (`switchView` only). */
  readonly switchBackMs?: number;
  /** The longest task of the main thread from pressing Load to the first frame: the data is prepared and uploaded to the card in that time, ms. */
  readonly loadLongestTaskMs: number;
  /** From asking for new classes to the picture having them. */
  readonly restyleMs?: number;
  /** Twenty levels of contour lines: from turning them on to the engine's answer (the lines made and listed), and to the lines being drawn, in ms, with how many lines and vertices. */
  readonly contours?: {
    readonly madeMs: number;
    readonly drawnMs: number;
    readonly lines: number;
    readonly vertices: number;
  };
  /** A picture of A4 landscape at 300 dpi made and encoded: how long it took, the size of the file, and the longest task of the main thread while it was made. */
  readonly export?: { readonly ms: number; readonly bytes: number; readonly longestTaskMs: number };
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
  /** After the first frame (and the restyle), 20 levels of contour lines are made, from an interval of 5 on the values 0 to 99.9 of the grid. */
  readonly contours?: boolean;
  /** After the first frame, the view is switched to 3D, fitted, and a scripted orbit is drawn: 300 frames of the camera going round and up and down. */
  readonly orbit?: boolean;
  /** After the rest, the view is switched to 3D (fitted) and back to 2D, and the longest task in the switches is noted. */
  readonly switchView?: boolean;
  /** After the first frame, a picture of A4 landscape at 300 dpi with the legend is made and encoded as a PNG file (`viewer.exportPng`). */
  readonly export?: boolean;
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
  // The first mouse event that a page gets makes macOS set up the renderer's connection to the window server, once: a frame of 100 ms or more that is the browser's
  // and not the page's (step 17.10 of the notes). It is given here, before anything is timed.
  await page.mouse.move(1, 1);
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
  let switchMs: number | undefined;
  let switchWindow: { from: number; to: number } | undefined;
  if (options.orbit === true) {
    // To 3D: the view is switched (the camera is made from the 2D one) and fitted to the model, and the time is from the command to the first frame
    // that has the layer in it in 3D (its programs for that view are compiled meanwhile, a layer is not drawn before).
    const orbitSwitch = await inPage<{ at: number; done: number }>(
      page,
      `const v = perf.viewer();
       const framesBefore = v.renderStats().frames;
       const at = performance.now();
       v.setViewMode('3d');
       v.fit();
       const done = await perf.until(() => {
         const stats = v.renderStats();
         return stats && stats.viewMode === '3d' && stats.frames > framesBefore && stats.layersDrawn > 0;
       }, 120000);
       return { at, done };`,
    );
    switchMs = orbitSwitch.done - orbitSwitch.at;
    switchWindow = { from: orbitSwitch.at, to: orbitSwitch.done };
  }
  if (options.path || options.orbit === true) {
    // The path: 100 frames of pan, 100 of zoom in and out, 100 of rotate, the camera given a new place each frame, and the time between
    // the frames that the browser gave, which is what a person sees as smooth or not.
    const { gaps, drawn, idle } = await inPage<{ gaps: number[]; drawn: number; idle: number[] }>(
      page,
      `const v = perf.viewer();
       const doc = v.scene();
       const start = doc.camera2d;
       const orbit = ${options.orbit === true ? 'true' : 'false'};
       const start3d = doc.camera3d;
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
         if (orbit) {
           // The camera goes round the model a turn and a quarter (1.5 degrees a frame, 450 degrees in the 300) while it rises and falls between 25 and 65 degrees above the horizon.
           v.dispatch({
             type: 'setCamera',
             patch: { camera3d: { heading: (start3d.heading + i * 1.5) % 360, elevation: 45 + 20 * Math.sin((i / 100) * Math.PI) } },
           });
           await wait();
           const at = performance.now();
           gaps.push(at - last);
           last = at;
           continue;
         }
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
      late: gaps.filter((gap) => gap > (idleSorted[Math.floor(idleSorted.length / 2)] ?? 0) * 1.5)
        .length,
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

  let contours: Measured['contours'];
  // With `KARMANIA_CPUPROFILE=1` the main thread is profiled while the contours are made, and the functions with the most time of their own are printed.
  const cpu = process.env['KARMANIA_CPUPROFILE'] !== undefined && options.contours === true;
  const session = cpu ? await page.context().newCDPSession(page) : undefined;
  if (session !== undefined) {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 200 });
    await session.send('Profiler.start');
  }
  if (options.contours === true) {
    // Twenty levels (an interval of 5 over the values 0 to 99.9), every fifth an index line: the settings are put in the scene, as the style editor does, and the
    // time is to the engine's answer (the lines are a dataset of the list) and then to the lines being on the card and a frame having drawn them.
    contours = await inPage<NonNullable<Measured['contours']>>(
      page,
      `const v = perf.viewer();
       const column = v.datasets[0].columns.find((c) => c.type === 'float' || c.type === 'int').name;
       const at = performance.now();
       v.dispatch({ type: 'setContours', layerId: 'layer-1', contours: { column, interval: 5, base: 0, indexEvery: 5, visible: true } });
       const made = await perf.until(() => v.datasets.length === 2, 120000);
       const drawn = await perf.until(() => {
         const states = v.layerStates();
         const stats = v.renderStats();
         return states.length === 2 && states.every(([, s]) => s.status === 'drawn') && stats && stats.layersDrawn >= 2;
       }, 120000);
       return { madeMs: Math.round(made - at), drawnMs: Math.round(drawn - at), lines: v.datasets[1].elementCount, vertices: v.datasets[1].vertexCount ?? 0 };`,
    );
  }

  if (session !== undefined) {
    const { profile } = (await session.send('Profiler.stop')) as {
      profile: {
        nodes: {
          id: number;
          callFrame: { functionName: string; url: string; lineNumber: number };
        }[];
        samples: number[];
        timeDeltas: number[];
      };
    };
    const own = new Map<number, number>();
    profile.samples.forEach((node, i) => {
      own.set(node, (own.get(node) ?? 0) + (profile.timeDeltas[i] ?? 0));
    });
    // The time of each function with what it called, too: the callers of what is heavy.
    const parent = new Map<number, number>();
    for (const node of profile.nodes as { id: number; children?: number[] }[]) {
      for (const child of node.children ?? []) parent.set(child, node.id);
    }
    const inclusive = new Map<number, number>();
    for (const [id, micro] of own) {
      for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
        inclusive.set(at, (inclusive.get(at) ?? 0) + micro);
      }
    }
    const heaviest = [...inclusive.entries()]
      .map(([id, micro]) => {
        const frame = profile.nodes.find((node) => node.id === id)?.callFrame;
        return `${String(Math.round(micro / 1000))}ms ${frame?.functionName ?? ''}@${(frame?.url ?? '').split('/').pop() ?? ''}:${String(frame?.lineNumber ?? 0)}`;
      })
      .filter(
        (line) =>
          !line.includes('(idle)') && !line.includes('(root)') && !line.includes('(program)'),
      )
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
      .slice(0, 24);
    console.info(`CPUTREE ${JSON.stringify(heaviest)}`);
    const top = [...own.entries()]
      .map(([id, micro]) => {
        const frame = profile.nodes.find((node) => node.id === id)?.callFrame;
        return `${String(Math.round(micro / 1000))}ms ${frame?.functionName ?? ''} ${(frame?.url ?? '').split('/').pop() ?? ''}:${String(frame?.lineNumber ?? 0)}`;
      })
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
      .slice(0, 16);
    console.info(`CPU ${JSON.stringify(top)}`);
  }

  let switchBackMs: number | undefined;
  if (options.switchView === true) {
    // To 3D, fitted, and back to 2D: each time to the first frame that has the layer in it in that view (the programs for a view are compiled when it is first
    // shown, and a layer is not drawn before), and the window is the whole of both.
    const both = await inPage<{ from: number; to: number; toMs: number; backMs: number }>(
      page,
      `const v = perf.viewer();
       const from = performance.now();
       const before3d = v.renderStats().frames;
       v.setViewMode('3d');
       v.fit();
       const in3d = await perf.until(() => {
         const stats = v.renderStats();
         return stats && stats.viewMode === '3d' && stats.frames > before3d && stats.layersDrawn > 0;
       }, 120000);
       const before2d = v.renderStats().frames;
       v.setViewMode('2d');
       const in2d = await perf.until(() => {
         const stats = v.renderStats();
         return stats && stats.viewMode === '2d' && stats.frames > before2d && stats.layersDrawn > 0;
       }, 120000);
       return { from, to: in2d, toMs: in3d - from, backMs: in2d - in3d };`,
    );
    switchMs = both.toMs;
    switchBackMs = both.backMs;
    switchWindow = { from: both.from, to: both.to };
  }

  let exportRun: { ms: number; bytes: number; start: number } | undefined;
  if (options.export === true) {
    // The picture and the file, through the viewer's own `exportPng` (brief 9.6: A4 landscape at 300 dpi, 3,508 by 2,480, under 3 s): the time is from asking to the Blob.
    exportRun = await inPage<{ ms: number; bytes: number; start: number }>(
      page,
      `const v = perf.viewer();
       const start = performance.now();
       const blob = await v.exportPng({ widthPx: 3508, heightPx: 2480, dpi: 300, legend: true });
       return { ms: performance.now() - start, bytes: blob.size, start };`,
    );
  }
  const tasks = await inPage<{ start: number; duration: number }[]>(page, 'return perf.long;');
  // The frames over 50 ms and the scripts in them, for what a long task was made of (printed, not asserted).
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
  const switched = switchWindow;
  return {
    file: options.data,
    renderer,
    firstFrameMs: Math.round(first - started),
    ...(frames === undefined ? {} : { frames }),
    ...(switchMs === undefined ? {} : { switchMs: Math.round(switchMs) }),
    ...(switchBackMs === undefined ? {} : { switchBackMs: Math.round(switchBackMs) }),
    ...(switched === undefined
      ? {}
      : {
          switchLongestTaskMs: Math.round(
            Math.max(
              0,
              ...tasks
                .filter(
                  (task) =>
                    task.start + task.duration >= switched.from && task.start <= switched.to,
                )
                .map((task) => task.duration),
            ),
          ),
        }),
    loadLongestTaskMs: Math.round(
      Math.max(
        0,
        ...tasks
          .filter((task) => task.start >= started && task.start <= first)
          .map((task) => task.duration),
      ),
    ),
    ...(restyleMs === undefined ? {} : { restyleMs: Math.round(restyleMs) }),
    ...(contours === undefined ? {} : { contours }),
    ...(exportRun === undefined
      ? {}
      : (() => {
          const run = exportRun;
          return {
            export: {
              ms: Math.round(run.ms),
              bytes: run.bytes,
              longestTaskMs: Math.round(
                Math.max(
                  0,
                  ...tasks.filter((task) => task.start >= run.start).map((task) => task.duration),
                ),
              ),
            },
          };
        })()),
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

  test('the start of the page: the first render, in tasks of the main thread of at most 50 ms', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    // Five fresh pages (a new context each, so the engine has compiled nothing of the page yet): the longest task of each from the start of the navigation to two
    // seconds of quiet after the map area is there. No mouse is moved: the first mouse event of a page is the browser's own cost (step 17.10), not the page's.
    const longest: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(WATCH);
      await page.goto('/?theme=light');
      await inPage(
        page,
        `await perf.until(() => document.querySelector('karmania-app')?.shadowRoot?.querySelector('karmania-viewer')?.shadowRoot?.querySelector('karmania-map-area'), 30000);`,
      );
      await page.waitForTimeout(2000);
      const tasks = await inPage<{ start: number; duration: number }[]>(page, 'return perf.long;');
      longest.push(Math.round(Math.max(0, ...tasks.map((task) => task.duration))));
      const slow = await inPage<{ start: number }[]>(page, 'return perf.slow;');
      if (slow.length > 0) {
        console.info(`SLOW start-up ${JSON.stringify(slow)}`);
      }
      await context.close();
    }
    console.info(`PERF-START ${JSON.stringify(longest)}`);
    expect(
      Math.max(...longest),
      'longest task of the start of the page, of five',
    ).toBeLessThanOrEqual(50);
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
      switchView: true,
    });
    RESULTS.push(result);
    expect(result.firstFrameMs, 'loaded to first frame').toBeLessThan(1500);
    expect(
      result.loadLongestTaskMs,
      'longest task while it is prepared and uploaded',
    ).toBeLessThanOrEqual(50);
    expect(
      result.switchLongestTaskMs,
      'longest task while switching to 3D and back',
    ).toBeLessThanOrEqual(50);
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

  test('1,000,000 points: a picture of A4 landscape at 300 dpi, made and encoded', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'points-1m.csv',
      sidecar: 'points-1m.prj',
      path: false,
      restyle: false,
      export: true,
    });
    RESULTS.push(result);
    // Brief 9.6: the export at A4 landscape, 300 dpi, under 3 s, and no task of the main thread over 50 ms (the picture is read off the card in bands and the file is made in
    // slices, with the page given a turn between them).
    expect(result.export?.ms, 'A4 at 300 dpi made and encoded').toBeLessThan(3000);
    expect(
      result.export?.longestTaskMs,
      'longest task of the main thread while it is made',
    ).toBeLessThanOrEqual(50);
  });

  test('4,000,000 cells: the first frame, and new classes', async ({ browser }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'grid-4m.asc',
      sidecar: 'grid-4m.prj',
      path: false,
      restyle: true,
      switchView: true,
    });
    RESULTS.push(result);
    expect(result.firstFrameMs, 'loaded to first frame').toBeLessThan(1500);
    expect(
      result.loadLongestTaskMs,
      'longest task while it is prepared and uploaded',
    ).toBeLessThanOrEqual(50);
    expect(result.restyleMs, 'new classes visible').toBeLessThan(300);
    expect(
      result.switchLongestTaskMs,
      'longest task while switching to 3D and back',
    ).toBeLessThanOrEqual(50);
    expect(result.longestTaskMs, 'longest task of the main thread').toBeLessThanOrEqual(50);
  });

  test('4,000,000 cells: 20 levels of contour lines, made in the worker and drawn', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'grid-4m.asc',
      sidecar: 'grid-4m.prj',
      path: false,
      restyle: false,
      contours: true,
    });
    RESULTS.push(result);
    // The engine's answer: 20 levels of the 4,000,000 cells in steps in the worker, without blocking the page.
    expect(result.contours?.madeMs, '20 contour levels made').toBeLessThan(2000);
    // From loading to the lines drawn, no task of the main thread over 50 ms.
    expect(result.longestTaskMs, 'longest task of the main thread').toBeLessThanOrEqual(50);
  });

  test('1,000,000 blocks: the first frame, and the frames of an orbit in 3D', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const result = await measure(browser, {
      data: 'blocks-1m.csv',
      sidecar: 'blocks-1m.prj',
      blockSize: 10,
      path: false,
      restyle: false,
      orbit: true,
    });
    RESULTS.push(result);
    expect(result.firstFrameMs, 'loaded to first frame').toBeLessThan(3000);
    expect(
      result.loadLongestTaskMs,
      'longest task while it is prepared and uploaded',
    ).toBeLessThanOrEqual(50);
    expect(result.switchLongestTaskMs, 'longest task while switching to 3D').toBeLessThanOrEqual(
      50,
    );
    // The renderer drew a frame for each of the 300 changes of the camera: the gaps are those of a page that draws, not of one that is idle.
    expect(result.frames?.drawn, 'frames the renderer drew').toBeGreaterThanOrEqual(290);
    expect(result.frames?.p95, '95th percentile frame time of the orbit').toBeLessThan(50);
    // The switch to 3D, the fit and the orbit together: no task of the main thread over 50 ms.
    expect(result.longestTaskMs, 'longest task of the main thread').toBeLessThanOrEqual(50);
  });
});
