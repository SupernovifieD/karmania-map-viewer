import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { THEMES } from './support/layouts.js';

test.describe('the app', () => {
  test('loads, registers <karmania-app> and shows the map area and the panel, with no errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    await page.goto('/');
    await expect(page).toHaveTitle('Karmania');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('karmania-app')).toHaveCount(1);
    expect(await page.evaluate(() => customElements.get('karmania-app') !== undefined)).toBe(true);
    await expect(page.locator('karmania-app h1')).toHaveText('Karmania');
    await expect(page.locator('karmania-app karmania-map-area')).toHaveCount(1);
    await expect(page.locator('karmania-app karmania-panel')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  for (const theme of THEMES) {
    test(`follows ?theme=${theme} and has no serious accessibility violations`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoSeriousViolations(page);
    });
  }

  test('leaves the theme to the system when the address names none, or a wrong one', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    await page.goto('/?theme=sepia');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });
});
