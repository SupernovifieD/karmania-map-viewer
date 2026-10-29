import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';

/** The parts of the import dialog. */
function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  return {
    host,
    dialog: host.locator('dialog'),
    title: host.locator('dialog h2'),
    steps: host.locator('k-steps li'),
    body: host.locator('.step'),
    status: host.locator('[role="status"]'),
    cancel: host.locator('k-button[slot="footer-start"]'),
    back: host.locator('k-button[slot="footer-end"]').nth(0),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    close: host.locator('dialog header k-button'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Opens the dialog as a person does: Import, and a file in the picker. Waits for the file to be read. */
async function open(page: Page): Promise<void> {
  // With its projection file, so that the coordinate system is known and no step stops a person.
  await pickFiles(page, async () => {
    await page.locator('karmania-app header.toolbar k-button button').click();
  }, ['points.csv', 'points.prj']);
  await expect(parts(page).dialog).toBeVisible();
  await expect(parts(page).host.locator('karmania-file-step')).toBeVisible();
}

/** The steps' states, in order: `done`, `current` or `pending`. */
const states = (page: Page): Promise<(string | undefined)[]> =>
  parts(page).steps.evaluateAll((all) => all.map((item) => item.dataset['state']));

test.describe('the import dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('is closed until it is opened, then is a modal dialog called "Import data"', async ({
    page,
  }) => {
    const p = parts(page);
    await expect(p.dialog).toBeHidden();
    await open(page);
    expect(
      await p.dialog.evaluate((element) => (element as HTMLDialogElement).matches(':modal')),
    ).toBe(true);
    await expect(p.dialog).toHaveAccessibleName('Import data');
    await expect(p.title).toHaveText('Import data');
  });

  test('shows the five steps, starting on File, and says which step it is on', async ({ page }) => {
    const p = parts(page);
    await open(page);
    await expect(p.steps.locator('.name')).toHaveText([
      'File',
      'Mapping',
      'Nodata',
      'CRS',
      'Review',
    ]);
    expect(await states(page)).toEqual(['current', 'pending', 'pending', 'pending', 'pending']);
    await expect(p.body).toHaveAttribute('data-step', 'file');
    await expect(p.status).toHaveText('Step 1 of 5: File');
  });

  test('has Cancel on the left, and Back and Next on the right, with Next last', async ({
    page,
  }) => {
    const p = parts(page);
    await open(page);
    const [dialog, cancel, back, next] = await Promise.all([
      rect(p.dialog),
      rect(p.cancel),
      rect(p.back),
      rect(p.next),
    ]);
    expect(cancel.x + cancel.width).toBeLessThan(back.x);
    expect(back.x + back.width + 8).toBe(next.x);
    expect(dialog.x + dialog.width - 1 - (next.x + next.width)).toBe(24);
    await expect(p.cancel).toHaveText('Cancel');
    await expect(p.back).toHaveText('Back');
    await expect(p.next).toHaveText('Next');
    expect(await p.cancel.getAttribute('variant')).toBe('ghost');
    expect(await p.back.getAttribute('variant')).toBe('secondary');
    expect(await p.next.getAttribute('variant')).toBe('primary');
  });

  test('cannot go back from the first step', async ({ page }) => {
    const p = parts(page);
    await open(page);
    await expect(p.back.locator('button')).toBeDisabled();
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test('goes on with Next and back with Back, through all five steps', async ({ page }) => {
    const p = parts(page);
    await open(page);
    const order = ['file', 'mapping', 'nodata', 'crs', 'review'] as const;
    for (const [index, id] of order.entries()) {
      await expect(p.body).toHaveAttribute('data-step', id);
      expect(await states(page)).toEqual(
        order.map((_, at) => (at < index ? 'done' : at === index ? 'current' : 'pending')),
      );
      if (index < order.length - 1) {
        await p.next.click();
      }
    }
    // On the last step the button that goes on is Load, which has nothing to load yet.
    await expect(p.status).toHaveText('Step 5 of 5: Review');
    await expect(p.next).toHaveText('Load');
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.back.locator('button')).toBeEnabled();
    await p.back.click();
    await expect(p.body).toHaveAttribute('data-step', 'crs');
    await expect(p.next).toHaveText('Next');
    await expect(p.status).toHaveText('Step 4 of 5: CRS');
    expect(await states(page)).toEqual(['done', 'done', 'done', 'current', 'pending']);
  });

  test('keeps the dialog the same size and its buttons where they are, from step to step', async ({
    page,
  }) => {
    const p = parts(page);
    await open(page);
    const first = {
      dialog: await rect(p.dialog),
      back: await rect(p.back),
      next: await rect(p.next),
      cancel: await rect(p.cancel),
    };
    for (let step = 2; step <= 5; step += 1) {
      await p.next.click();
      expect(await rect(p.dialog), `dialog at step ${String(step)}`).toEqual(first.dialog);
      expect(await rect(p.cancel), `Cancel at step ${String(step)}`).toEqual(first.cancel);
      const next = await rect(p.next);
      // The primary button stays at the right; on the last step its words are different ("Load"),
      // and so may be its width, which moves Back by as much.
      expect(next.x + next.width, `right edge of Next at step ${String(step)}`).toBe(
        first.next.x + first.next.width,
      );
      if (step < 5) {
        expect(next).toEqual(first.next);
        expect(await rect(p.back)).toEqual(first.back);
      }
    }
  });

  test('leaves the keyboard on the button that was pressed, so that Enter can go on', async ({
    page,
  }) => {
    const p = parts(page);
    await open(page);
    await page.keyboard.press('Shift');
    await p.next.locator('button').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(p.body).toHaveAttribute('data-step', 'nodata');
    await expect(p.next.locator('button')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(p.back.locator('button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(p.body).toHaveAttribute('data-step', 'mapping');
  });

  test('closes with Cancel, with Esc and with the close button, each telling the page once', async ({
    page,
  }) => {
    const p = parts(page);
    await page.locator('karmania-import-dialog').evaluate((element) => {
      const holder = window as unknown as { closes: number };
      holder.closes = 0;
      element.addEventListener('karmania-import-close', () => {
        holder.closes += 1;
      });
    });
    // A dialog is hidden before the browser sends its `close` event: a moment is left for it.
    const closes = (): Promise<number> =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            setTimeout(() => {
              resolve((window as unknown as { closes: number }).closes);
            }, 50);
          }),
      );

    await open(page);
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
    expect(await closes()).toBe(1);

    await open(page);
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    expect(await closes()).toBe(2);

    await open(page);
    await p.close.click();
    await expect(p.dialog).toBeHidden();
    expect(await closes()).toBe(3);
  });

  test('gives the keyboard back to the control that was focused when it opened', async ({
    page,
  }) => {
    const p = parts(page);
    const importButton = page.locator('karmania-app header.toolbar k-button button');
    await page.keyboard.press('Shift');
    await importButton.focus();
    await open(page);
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await expect(importButton).toBeFocused();
  });

  test('starts at the first step every time it is opened', async ({ page }) => {
    const p = parts(page);
    await open(page);
    await p.next.click();
    await p.next.click();
    await expect(p.body).toHaveAttribute('data-step', 'nodata');
    await p.cancel.click();
    await open(page);
    await expect(p.body).toHaveAttribute('data-step', 'file');
    expect(await states(page)).toEqual(['current', 'pending', 'pending', 'pending', 'pending']);
  });

  test('keeps the keyboard inside while it is open', async ({ page }) => {
    const p = parts(page);
    await open(page);
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');
      const where = await p.host.evaluate((host) => {
        const active = (host.getRootNode() as ShadowRoot).activeElement;
        return active === null ? 'nowhere' : host.contains(active) ? 'dialog' : 'page';
      });
      expect(['dialog', 'nowhere'], `after Tab ${String(press + 1)}`).toContain(where);
    }
  });

  test('fits the smallest window with nothing overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await open(page);
    const dialog = await rect(parts(page).dialog);
    expect(dialog.x).toBeGreaterThanOrEqual(24);
    expect(dialog.y).toBeGreaterThanOrEqual(24);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(1024 - 24);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(640 - 24);
    await assertNoOverflow(parts(page).dialog);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations, open (${theme} theme)`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await open(page);
      await expectNoSeriousViolations(page);
    });
  }
});
