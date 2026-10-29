import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

/** The parts of the Review step. */
function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  const step = host.locator('karmania-review-step');
  return {
    host,
    dialog: host.locator('dialog'),
    step,
    verdict: step.locator('.verdict'),
    progress: step.locator('k-progress'),
    bar: step.getByRole('progressbar'),
    cancelImport: step.getByRole('button', { name: 'Cancel import' }),
    importAgain: step.getByRole('button', { name: 'Import again' }),
    tryAgain: step.getByRole('button', { name: 'Try again' }),
    datasets: step.locator('.dataset'),
    groups: step.locator('.group'),
    errors: step.locator('.group[data-severity="error"] li'),
    warnings: step.locator('.group[data-severity="warning"] li'),
    notes: step.locator('.group[data-severity="info"] li'),
    links: step.getByRole('button', { name: /^Fix in the/ }),
    note: host.locator('span[slot="footer-note"]'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    back: host.locator('k-button[slot="footer-end"]').nth(0),
    cancel: host.locator('k-button[slot="footer-start"]'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Imports files and goes on to the last step, with the real engine, and waits for the import to be done. */
async function reviewOf(page: Page, ...picks: Pick[]): Promise<void> {
  const p = parts(page);
  await pickFiles(
    page,
    async () => {
      await page.locator('karmania-app header.toolbar k-button button').click();
    },
    picks,
  );
  await expect(p.host.locator('karmania-file-step')).toBeVisible();
  for (const step of ['mapping', 'nodata', 'crs', 'review']) {
    await p.next.click();
    await expect(p.host.locator(`.step[data-step="${step}"]`)).toBeVisible();
  }
  await expect(p.verdict).toBeVisible();
}

/** A projection file that names a coordinate system by its code. */
const PRJ = (name: string): Pick => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('PROJCS["x",AUTHORITY["EPSG","32640"]]'),
});

/** Points with a point twice: the kernel loads them, and warns. */
const TWICE: Pick[] = [
  { name: 'twice.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n1,2\n3,4\n') },
  PRJ('twice.prj'),
];

/** Points with a coordinate missing: the kernel stops, with an error that the Nodata step can fix. */
const GAP: Pick[] = [
  { name: 'gap.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n,3\n4,5\n') },
  PRJ('gap.prj'),
];

/** How many datasets the app's engine holds. */
const loadedInEngine = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const app = document.querySelector('karmania-app') as unknown as {
      engine: { datasets: () => unknown[] } | undefined;
    };
    return app.engine?.datasets().length ?? 0;
  });

const textsOf = (locator: Locator): Promise<string[]> =>
  locator.evaluateAll((all) =>
    all.map((element) => element.textContent.trim().replace(/\s+/g, ' ')),
  );

/** A fake engine that the test controls: imports that hang until told otherwise, and progress it reports. */
const FAKE = `(() => {
  const control = { calls: 0, report: undefined, finish: undefined, fail: undefined, signal: undefined };
  const engine = {
    preview: async (files) => files.map((file) => ({
      fileName: file.name, format: 'csv', suggestedKind: 'points', encoding: 'UTF-8',
      crs: { crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' },
      table: { delimiter: 'comma', hasHeader: true, header: ['x', 'y'], rows: [['1', '2']], estimatedRows: 1,
        decimalSeparator: '.', columnTypes: ['float', 'float'], roles: [{ role: 'x', confidence: 0.9 }, { role: 'y', confidence: 0.9 }],
        nodata: { tokens: [], numbers: [] } },
      findings: [],
    })),
    importFiles: (files, mapping, options) => new Promise((resolve, reject) => {
      control.calls += 1;
      control.report = options.onProgress;
      control.signal = options.signal;
      control.finish = resolve;
      control.fail = (message) => reject(new Error(message));
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    }),
    remove: async () => undefined,
    datasets: () => [],
    dispose: () => undefined,
  };
  window.fake = control;
  return engine;
})()`;

/** Opens the wizard on a fake engine, and goes on to the last step. */
async function reviewWithFakeEngine(page: Page): Promise<void> {
  const p = parts(page);
  await p.host.evaluate((element, source) => {
    const target = element as unknown as { engine: unknown; show: (files: File[]) => void };
    target.engine = (0, eval)(source);
    target.show([new File(['x,y\n1,2\n'], 'a.csv')]);
  }, FAKE);
  await expect(p.host.locator('karmania-file-step')).toBeVisible();
  for (const step of ['mapping', 'nodata', 'crs', 'review']) {
    await p.next.click();
    await expect(p.host.locator(`.step[data-step="${step}"]`)).toBeVisible();
  }
}

async function fakeCall<T>(page: Page, body: string): Promise<T> {
  return page.evaluate<T>(`(() => { const c = window.fake; ${body} })()`);
}

test.describe('the Review step', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('runs the import and says what will be loaded, with how much of it', async ({ page }) => {
    const p = parts(page);
    await reviewOf(page, 'points.csv', 'points.prj');
    await expect(p.verdict).toHaveText('Ready to load');
    await expect(p.datasets).toHaveCount(1);
    expect(await textsOf(p.datasets)).toEqual(['points 8 points']);
    expect(await loadedInEngine(page)).toBe(1);
  });

  test('groups what was found into errors, warnings and notes, with how many in each', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewOf(page, ...TWICE);
    await expect(p.verdict).toHaveText('Ready to load');
    await expect(p.warnings).toHaveCount(1);
    await expect(p.step.locator('.group[data-severity="warning"] h4')).toHaveText('Warnings (1)');
    await expect(p.warnings.first()).toContainText('repeated at exactly the same position');
    await expect(p.errors).toHaveCount(0);
    await expect(p.groups).toHaveCount(1);
  });

  test('says Load with the number of warnings, and can be gone on from when the import worked', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewOf(page, ...TWICE);
    await expect(p.next).toHaveText('Load with 1 warning');
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
  });

  test('says Load alone when there is nothing to warn about, and says so', async ({ page }) => {
    const p = parts(page);
    await reviewOf(page, 'points.csv', 'points.prj');
    await expect(p.verdict).toHaveText('Ready to load');
    await expect(p.step).toContainText('Nothing to warn about.');
    await expect(p.groups).toHaveCount(0);
    await expect(p.next).toHaveText('Load');
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test('blocks when the kernel finds errors, loads nothing, and links each to the step that can fix it', async ({
    page,
  }) => {
    const p = parts(page);
    // An empty coordinate, which the first choice (stop with an error) does not allow.
    await reviewOf(page, ...GAP);
    await expect(p.verdict).toHaveText('Nothing was loaded');
    await expect(p.errors.first()).toBeVisible();
    await expect(p.datasets).toHaveCount(0);
    expect(await loadedInEngine(page)).toBe(0);
    await expect(p.next).toHaveText('Load');
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toContainText('to fix before anything can be loaded.');
    // Each error that a step can fix says which.
    await expect(p.links.first()).toBeVisible();
  });

  test('goes to the step an error links to, and says nothing is loaded while there', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewOf(page, ...GAP);
    // The error is about an empty coordinate, which the Nodata step has a choice for.
    await expect(p.links.first()).toHaveAccessibleName('Fix in the Nodata step');
    await p.links.first().click();
    await expect(p.host.locator('.step')).toHaveAttribute('data-step', 'nodata');
    expect(await loadedInEngine(page)).toBe(0);
  });

  test('takes the datasets out of the engine again when a person goes back, so that going on makes them once', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewOf(page, 'points.csv', 'points.prj');
    expect(await loadedInEngine(page)).toBe(1);
    await p.back.click();
    await expect.poll(() => loadedInEngine(page)).toBe(0);
    await p.next.click();
    await expect(p.verdict).toHaveText('Ready to load');
    expect(await loadedInEngine(page)).toBe(1);
  });

  test('takes them out when the wizard is cancelled, or closed with Esc', async ({ page }) => {
    const p = parts(page);
    await reviewOf(page, 'points.csv', 'points.prj');
    expect(await loadedInEngine(page)).toBe(1);
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
    await expect.poll(() => loadedInEngine(page)).toBe(0);

    await page.keyboard.press('Shift');
    await reviewOf(page, 'points.csv', 'points.prj');
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await expect.poll(() => loadedInEngine(page)).toBe(0);
  });

  test('keeps them when Load is pressed, closes, and says what was loaded', async ({ page }) => {
    const p = parts(page);
    await page.locator('karmania-import-dialog').evaluate((element) => {
      const holder = window as unknown as { loadedEvents: unknown[] };
      holder.loadedEvents = [];
      element.addEventListener('karmania-import-loaded', (event) => {
        holder.loadedEvents.push((event as CustomEvent).detail);
      });
    });
    await reviewOf(page, 'points.csv', 'points.prj');
    await expect(p.next.locator('button')).toBeEnabled();
    await p.next.click();
    await expect(p.dialog).toBeHidden();
    expect(await loadedInEngine(page)).toBe(1);
    const heard = await page.evaluate(
      () =>
        (
          window as unknown as {
            loadedEvents: { summaries: { name: string; elementCount: number }[] }[];
          }
        ).loadedEvents,
    );
    expect(heard).toHaveLength(1);
    expect(heard[0]?.summaries.map((summary) => [summary.name, summary.elementCount])).toEqual([
      ['points', 8],
    ]);
  });

  test('shows a bar with what is being done and how far, while the import goes on, and can be stopped', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewWithFakeEngine(page);
    await expect(p.progress).toBeVisible();
    // Before anything has been said, the bar does not know how far it is.
    await expect(p.bar).not.toHaveAttribute('aria-valuenow');
    await expect(p.progress.locator('.label')).toHaveText('Starting');
    await fakeCall(page, "c.report({ phase: 'reading', fraction: 0.25 });");
    await expect(p.progress.locator('.label')).toHaveText('Reading the file');
    await expect(p.bar).toHaveAttribute('aria-valuenow', '25');
    await fakeCall(page, "c.report({ phase: 'parsing', fraction: 0.5 });");
    await expect(p.progress.locator('.label')).toHaveText('Reading the values');
    await fakeCall(page, "c.report({ phase: 'validating', fraction: 0.9 });");
    await expect(p.progress.locator('.label')).toHaveText('Checking the data');
    await expect(p.bar).toHaveAttribute('aria-valuenow', '90');
    await expect(p.cancelImport).toBeVisible();
    // Load waits, and says why.
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('Importing…');
  });

  test('stops the import when asked, says that nothing was loaded, and can be run again', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewWithFakeEngine(page);
    await p.cancelImport.click();
    expect(await fakeCall<boolean>(page, 'return c.signal.aborted;')).toBe(true);
    await expect(p.step).toContainText('The import was cancelled. Nothing was loaded.');
    await expect(p.note).toContainText('cancelled');
    await expect(p.next.locator('button')).toBeDisabled();
    await p.importAgain.click();
    await expect(p.progress).toBeVisible();
    expect(await fakeCall<number>(page, 'return c.calls;')).toBe(2);
  });

  test('says why when the import could not be done, and can be tried again', async ({ page }) => {
    const p = parts(page);
    await reviewWithFakeEngine(page);
    // The engine failing for a reason of its own is a failure, not a cancellation.
    await fakeCall(page, "c.fail('The worker stopped.');");
    await expect(p.step.locator('karmania-findings li[data-severity="error"]')).toContainText(
      'The import could not be done: The worker stopped.',
    );
    await expect(p.tryAgain).toBeVisible();
    await expect(p.note).toContainText('could not be done');
    await p.tryAgain.click();
    await expect(p.progress).toBeVisible();
  });

  test('ignores what an import that was left says, and does not load for it', async ({ page }) => {
    const p = parts(page);
    await reviewWithFakeEngine(page);
    await p.back.click();
    await expect(p.host.locator('.step[data-step="crs"]')).toBeVisible();
    // The import that was left finishes now: nobody is waiting for it.
    await fakeCall(page, "c.finish({ status: 'blocked', findings: [] });");
    await p.next.click();
    await expect(p.progress).toBeVisible();
  });

  test('moves nothing between the bar, the answer and an error: the buttons stay where they are', async ({
    page,
  }) => {
    const p = parts(page);
    await reviewOf(page, 'points.csv', 'points.prj');
    const dialog = await rect(p.dialog);
    expect(dialog.height).toBeGreaterThan(300);
    await expect(p.next).toBeVisible();
    await assertNoOverflow(p.dialog);
  });

  test('fits the smallest window with many findings, and scrolls its body, nothing else', async ({
    page,
  }) => {
    const p = parts(page);
    await page.setViewportSize({ width: 1024, height: 640 });
    await reviewOf(page, 'points.csv', 'points.prj');
    await assertNoOverflow(p.dialog);
  });

  for (const theme of ['light', 'dark']) {
    test(`has no serious accessibility violations, done and blocked (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await reviewOf(page, 'points.csv', 'points.prj');
      await expectNoSeriousViolations(page);
      await page.goto(`/?theme=${theme}`);
      await reviewOf(page, ...GAP);
      await expectNoSeriousViolations(page);
    });
  }
});
