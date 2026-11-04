import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Scenarios } from './page/main.js';
import { FIXTURE_CASES, runCrs, runDisplay, runFixture } from './scenarios.js';
import { fixtureFile } from '../src/test-support/kernel.js';
import { engineOverChannel } from '../src/test-support/ports.js';

/** Errors the page reported while a test ran. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

test.describe('the engine in a browser, with its real worker', () => {
  test('starts the worker and the WebAssembly module, and loads a dataset made in the page', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => window.karmaniaTest !== undefined);
    const report = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.loadPoints();
    });
    expect(report).toEqual({
      status: 'loaded',
      kind: 'points',
      elementCount: 4,
      x: [500_010, 500_020, 500_030],
    });
    expect(errors).toEqual([]);
  });

  test('passes the address of the module to the worker, which fails to start without it', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.karmaniaTest !== undefined);
    const report = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.startWithModuleAt('/there-is-no-module-here.wasm');
    });
    expect(report.started).toBe(false);
    expect(report.error).toMatch(/^EngineError: .*(WebAssembly|wasm)/i);
  });
});

/** Opens the test page, and gives the scenarios it offers. */
async function openScenarios(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.karmaniaTest !== undefined);
}

test.describe('every sample file, through the real worker', () => {
  for (const fixture of FIXTURE_CASES) {
    test(`imports ${fixture.file} and reports the same as Node does`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await openScenarios(page);
      const inBrowser = await page.evaluate(async (fixtureCase) => {
        const scenarios: Scenarios | undefined = window.karmaniaTest;
        if (scenarios === undefined) {
          throw new Error('The test page did not set up its scenarios.');
        }
        return scenarios.runFixture(fixtureCase);
      }, fixture);

      // What the sample file should come to.
      expect(inBrowser.status).toBe('loaded');
      expect(inBrowser.previews).toBe(1);
      expect(inBrowser.datasets.map((d) => [d.kind, d.elementCount])).toEqual(fixture.expected);
      expect(inBrowser.phases[0]).toBe('reading');
      expect(inBrowser.phases).toContain('validating');
      for (const dataset of inBrowser.datasets) {
        expect(dataset.findings.filter(([, severity]) => severity === 'error')).toEqual([]);
        expect(dataset.crs).toBeDefined();
        expect(dataset.firstRows.every(([, values]) => values.length > 0)).toBe(true);
      }

      // The same data must give the same result everywhere: Node, through the in-process
      // channel, and the browser, through the real worker, agree on every detail.
      const engine = engineOverChannel();
      try {
        const inNode = await runFixture(
          engine,
          (name) => Promise.resolve(fixtureFile(name)),
          fixture,
        );
        expect(inBrowser).toEqual(inNode);
      } finally {
        engine.dispose();
      }
      expect(errors).toEqual([]);
    });
  }

  test('previews a data file together with its .prj, and takes the coordinate system from it', async ({
    page,
  }) => {
    await openScenarios(page);
    const report = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.runFixture({
        file: 'points.csv',
        sidecars: ['points.prj'],
        kind: 'points',
        crs: null,
        expected: [],
      });
    });
    expect(report.previews).toBe(1);
    expect(report.detectedCrs).toBe('EPSG:32640');
    expect(report.datasets[0]?.crs).toBe('EPSG:32640');
  });
});

test.describe('what only a real worker can show', () => {
  test('stops a big import when asked, loads nothing of it, and goes on working', async ({
    page,
  }) => {
    await openScenarios(page);
    const report = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.stopBigImport();
    });
    expect(report).toEqual({
      outcome: 'AbortError',
      datasetsAfterStopping: 0,
      datasetsAfterImportingAgain: 1,
    });
  });

  test('keeps engines apart, one worker each', async ({ page }) => {
    await openScenarios(page);
    const report = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.twoEngines();
    });
    expect(report).toEqual({
      first: ['in the first'],
      second: ['in the second'],
      rowsOfSecondAfterDisposingFirst: 3,
    });
  });

  test('refuses everything once disposed', async ({ page }) => {
    await openScenarios(page);
    const report = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.afterDispose();
    });
    expect(report).toEqual({ datasets: 'EngineDisposedError', rows: 'EngineDisposedError' });
  });
});

test.describe('the EPSG definitions, through the real worker', () => {
  test('answer, search and take part in loading, the same in the browser as in Node', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openScenarios(page);
    const inBrowser = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.crs();
    });

    expect(inBrowser.utm40).toEqual({
      code: 32640,
      name: 'WGS 84 / UTM zone 40N',
      kind: 'projected',
      units: 'm',
      metresPerUnit: 1,
    });
    expect(inBrowser.unknown).toBeUndefined();
    expect(inBrowser.byName).toEqual([32640, 32740]);
    expect(inBrowser.byCode[0]).toBe(4326);
    expect(inBrowser.misuse).toMatch(/^EngineError: The EPSG code must be a whole number/);
    // What loading made of the same UTM-looking points under three codes.
    expect(inBrowser.loaded).toEqual({
      '32640': [],
      '99999': ['crs.code.unknown'],
      '4269': ['crs.geographic.out_of_range'],
    });

    const engine = engineOverChannel();
    try {
      expect(inBrowser).toEqual(await runCrs(engine));
    } finally {
      engine.dispose();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('display preparation, through the real worker', () => {
  test('prepares, warps and classifies, stops a prepare, and gives the same as Node in every detail', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openScenarios(page);
    const inBrowser = await page.evaluate(async () => {
      const scenarios: Scenarios | undefined = window.karmaniaTest;
      if (scenarios === undefined) {
        throw new Error('The test page did not set up its scenarios.');
      }
      return scenarios.display();
    });

    // The map is drawn in the UTM zone of the data, and the person was told which and why.
    expect(JSON.parse(inBrowser.frame.crs)).toEqual({ kind: 'epsg', code: 32640 });
    expect(inBrowser.frame.source).toBe('auto');
    expect(inBrowser.frameFindings).toEqual(['display.frame.utm_chosen']);
    // Positions arrive as Float32Array (the typed arrays crossed the worker boundary by transfer), one
    // position is off the Earth, and it is counted.
    expect(inBrowser.points.isFloat32).toBe(true);
    expect(inBrowser.points.length).toBe(3_000 * 3);
    expect(inBrowser.points.notPlaced).toBe(1);
    expect(inBrowser.points.findings).toEqual(['crs.transform.not_finite x1']);
    // Three squares, two triangles each.
    expect([
      inBrowser.polygons.triangles,
      inBrowser.polygons.outline,
      inBrowser.polygons.findings,
    ]).toEqual([6, 12, []]);
    // 90 by 40 cells in textures of 32: three columns, two rows; each tile has a mesh, no placement.
    expect(inBrowser.warpedGrid.tiles).toBe(6);
    expect(inBrowser.warpedGrid.tileTriangles).toHaveLength(6);
    expect(inBrowser.warpedGrid.placement).toBe(false);
    // The legend's counts are the picture's, for every method.
    expect(inBrowser.classes.map((c) => [c.method, c.indexAgrees])).toEqual([
      ['equal', true],
      ['quantile', true],
      ['jenks', true],
      ['categories', true],
    ]);
    // A prepare that is stopped rejects as aborted, drops what it made, and the next one works.
    expect(inBrowser.stopped).toEqual({ outcome: 'AbortError', nextWorks: true });
    expect(inBrowser.progress).toEqual({ reports: true, ascending: true });

    // The same data gives the same result everywhere: the browser, through the real worker, and Node, through
    // the in-process channel, agree on every number, and on every byte of the positions of the points, of the polygons and
    // of the meshes of the warped grid (a hash of each, so that one bit that differs fails).
    for (const hash of [
      inBrowser.points.hash,
      ...inBrowser.polygons.hashes,
      ...inBrowser.warpedGrid.hashes,
    ]) {
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    }
    const engine = engineOverChannel();
    try {
      expect(inBrowser).toEqual(await runDisplay(engine));
    } finally {
      engine.dispose();
    }
    expect(errors).toEqual([]);
  });
});
