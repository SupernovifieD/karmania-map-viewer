import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Scenarios } from './page/main.js';
import { FIXTURE_CASES, runFixture } from './scenarios.js';
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
