import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  const step = host.locator('karmania-review-step');
  return {
    host,
    dialog: host.locator('dialog'),
    body: host.locator('.step'),
    verdict: step.locator('.verdict'),
    errors: step.locator('.group[data-severity="error"] li'),
    link: step.getByRole('button', { name: /^Fix in the/ }),
    problems: host.locator('karmania-mapping-step .problems li'),
    kind: host.locator('karmania-file-step k-select select'),
    skip: host.locator('karmania-nodata-step k-select').first().locator('select'),
    steps: host.locator('k-steps li'),
    note: host.locator('span[slot="footer-note"]'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    back: host.locator('k-button[slot="footer-end"]').nth(0),
  };
}

/** A projection file that names a coordinate system by its code. */
const PRJ = (name: string): Pick => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('PROJCS["x",AUTHORITY["EPSG","32640"]]'),
});

/** Points with a coordinate missing: the kernel stops, with an error that the Nodata step can fix. */
const GAP: Pick[] = [
  { name: 'gap.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n,3\n4,5\n') },
  PRJ('gap.prj'),
];

const loadedInEngine = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const app = document.querySelector('karmania-app') as unknown as {
      engine: { datasets: () => { elementCount: number }[] } | undefined;
    };
    return app.engine?.datasets().reduce((total, each) => total + each.elementCount, 0) ?? 0;
  });

/** Goes to the last step with the files, and waits for the import to say what it came to. */
async function blocked(page: Page): Promise<void> {
  const p = parts(page);
  await pickFiles(
    page,
    async () => {
      await page.locator('karmania-app header.toolbar k-button button').click();
    },
    GAP,
  );
  await expect(p.host.locator('karmania-file-step')).toBeVisible();
  for (const step of ['mapping', 'nodata', 'crs', 'review']) {
    await p.next.click();
    await expect(p.host.locator(`.step[data-step="${step}"]`)).toBeVisible();
  }
  await expect(p.verdict).toHaveText('Nothing was loaded');
}

test.describe('fixing what the Review step found, and checking again', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('cannot load while there are errors, and says so', async ({ page }) => {
    const p = parts(page);
    await blocked(page);
    await expect(p.next).toHaveText('Load');
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toContainText('1 error to fix before anything can be loaded.');
    expect(await loadedInEngine(page)).toBe(0);
  });

  test('offers to check again from the step an error sent a person to, and goes straight to Review', async ({
    page,
  }) => {
    const p = parts(page);
    await blocked(page);
    await p.link.click();
    await expect(p.body).toHaveAttribute('data-step', 'nodata');
    await expect(p.next).toHaveText('Check again');
    await p.skip.selectOption('skip');
    await p.next.click();
    // The step between (the coordinate system) was not gone through again: Review is next.
    await expect(p.body).toHaveAttribute('data-step', 'review');
    await expect(p.verdict).toHaveText('Ready to load');
    const states = await p.steps.evaluateAll((all) => all.map((item) => item.dataset['state']));
    expect(states).toEqual(['done', 'done', 'done', 'done', 'current']);
  });

  test('loads what the second try made once, with the warning that it left rows out', async ({
    page,
  }) => {
    const p = parts(page);
    await blocked(page);
    await p.link.click();
    await p.skip.selectOption('skip');
    await p.next.click();
    await expect(p.verdict).toHaveText('Ready to load');
    await expect(p.next).toHaveText(/^\s*Load with \d+ warnings?\s*$/);
    await expect(p.next.locator('button')).toBeEnabled();
    // Two points: the row with the missing coordinate was left out, not loaded twice or at all.
    expect(await loadedInEngine(page)).toBe(2);
  });

  test('goes back to saying Next once the last step has been reached', async ({ page }) => {
    const p = parts(page);
    await blocked(page);
    await p.link.click();
    await p.skip.selectOption('skip');
    await p.next.click();
    await expect(p.verdict).toHaveText('Ready to load');
    await p.back.click();
    await expect(p.body).toHaveAttribute('data-step', 'crs');
    await expect(p.next).toHaveText('Next');
  });

  test('stops at a step between that has something wrong now, instead of going to Review', async ({
    page,
  }) => {
    const p = parts(page);
    await blocked(page);
    await p.link.click();
    // Back to the first step, and the file is to be lines: they need a line identifier, which it has not.
    await p.back.click();
    await p.back.click();
    await expect(p.body).toHaveAttribute('data-step', 'file');
    await p.kind.selectOption('lines');
    await expect(p.next).toHaveText('Check again');
    await p.next.click();
    await expect(p.body).toHaveAttribute('data-step', 'mapping');
    await expect(p.problems.first()).toContainText('No column is set as the line identifier');
    await expect(p.next.locator('button')).toBeDisabled();
  });

  test('forgets that a person was fixing something when the wizard is opened again', async ({
    page,
  }) => {
    const p = parts(page);
    await blocked(page);
    await p.link.click();
    await expect(p.next).toHaveText('Check again');
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await pickFiles(
      page,
      async () => {
        await page.locator('karmania-app header.toolbar k-button button').click();
      },
      GAP,
    );
    await expect(p.host.locator('karmania-file-step')).toBeVisible();
    await expect(p.next).toHaveText('Next');
  });

  test('takes nothing it has loaded along when the person goes to fix what it found', async ({
    page,
  }) => {
    const p = parts(page);
    await blocked(page);
    await p.link.click();
    expect(await loadedInEngine(page)).toBe(0);
    await p.skip.selectOption('skip');
    await p.next.click();
    await expect(p.verdict).toHaveText('Ready to load');
    // Going to fix a warning's step would take the loaded points out again, to be made afresh.
    await p.back.click();
    await expect.poll(() => loadedInEngine(page)).toBe(0);
  });
});
