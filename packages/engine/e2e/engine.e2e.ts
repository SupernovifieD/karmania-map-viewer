import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Scenarios } from './page/main.js';

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
