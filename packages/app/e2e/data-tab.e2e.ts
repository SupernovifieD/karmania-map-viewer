import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';
import { importAndLoad, wizard } from './support/wizard.js';

function parts(page: Page) {
  const panel = page.locator('karmania-panel');
  return {
    panel,
    tab: page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }),
    body: panel.locator('[slot="data"]'),
    data: panel.locator('karmania-data-tab'),
    empty: panel.locator('karmania-data-tab k-empty-state'),
    importButton: panel.locator('karmania-data-tab k-empty-state k-button button'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

test.describe('the Data tab with nothing loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await parts(page).tab.click();
  });

  test('says there is no data, and offers Import', async ({ page }) => {
    const p = parts(page);
    await expect(p.empty).toBeVisible();
    await expect(p.empty.locator('.heading')).toHaveText('No data loaded');
    await expect(p.importButton).toBeVisible();
    await expect(p.empty.locator('k-button')).toContainText('Import');
  });

  test('puts it in the middle of the tab, both ways, like the empty state of the Legend', async ({
    page,
  }) => {
    const p = parts(page);
    const [body, group] = [await rect(p.body), await rect(p.empty.locator('.group'))];
    expect(group.x + group.width / 2).toBeCloseTo(body.x + body.width / 2, 0);
    // A little above the middle is allowed for an optical centre; not more than the button's height.
    expect(Math.abs(group.y + group.height / 2 - (body.y + body.height / 2))).toBeLessThan(2);
  });

  test('opens the file picker, and the wizard with what was chosen', async ({ page }) => {
    const p = parts(page);
    await pickFiles(page, async () => {
      await p.importButton.click();
    }, ['points.csv', 'points.prj']);
    await expect(wizard(page).dialog).toBeVisible();
    await expect(wizard(page).host.locator('karmania-file-step')).toBeVisible();
  });

  test('can be reached with the keyboard, which then opens the picker with Enter', async ({
    page,
  }) => {
    const p = parts(page);
    await page.keyboard.press('Shift');
    await p.importButton.focus();
    await expect(p.importButton).toBeFocused();
    await pickFiles(page, async () => {
      await page.keyboard.press('Enter');
    }, ['points.csv', 'points.prj']);
    await expect(wizard(page).dialog).toBeVisible();
  });

  test('keeps the panel as it was: the body does not scroll, nothing overflows', async ({
    page,
  }) => {
    const p = parts(page);
    expect(
      await p.body.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(1);
    await assertNoOverflow(p.panel);
  });

  test('goes once something is loaded', async ({ page }) => {
    const p = parts(page);
    await importAndLoad(page, 'points.csv', 'points.prj');
    await expect(p.tab).toHaveAttribute('aria-selected', 'true');
    await expect(p.empty).toHaveCount(0);
  });

  for (const theme of ['light', 'dark']) {
    test(`has no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await parts(page).tab.click();
      await expectNoSeriousViolations(page);
    });
  }
});
