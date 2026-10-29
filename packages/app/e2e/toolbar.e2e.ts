import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { inEveryLayout } from './support/layouts.js';
import { assertAligned, assertNoOverflow, assertNoOverlap, boxOf } from './support/layout.js';

const toolbar = (page: Page) => page.locator('karmania-app header');
const wordmark = (page: Page) => toolbar(page).getByRole('heading', { name: 'Karmania' });
const importButton = (page: Page) => toolbar(page).locator('k-button');

test.describe('the toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('has the name and then the Import button, and nothing on the right', async ({ page }) => {
    await page.goto('/');
    const order = await toolbar(page).evaluate((element) =>
      [...element.children].map((child) => [child.tagName.toLowerCase(), child.textContent.trim()]),
    );
    expect(order).toEqual([
      ['h1', 'Karmania'],
      ['k-button', 'Import'],
    ]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('sets the name in 16/24 medium, and the button as a secondary one with the upload icon', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    const name = await wordmark(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.lineHeight, style.fontWeight, style.color, style.margin];
    });
    expect(name).toEqual(['16px', '24px', '500', 'rgb(26, 29, 33)', '0px']);

    const button = importButton(page);
    await expect(button).toHaveAttribute('variant', 'secondary');
    await expect(button.locator('k-icon')).toHaveAttribute('name', 'upload');
    expect(await button.locator('k-icon').evaluate((e) => e.getBoundingClientRect().width)).toBe(
      16,
    );
    await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(1);
  });

  test('is 48 high with 16 at the sides and a border under it, and centres what is in it', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async ({ viewport }) => {
      const bar = await boxOf(toolbar(page), 'the toolbar');
      const name = await boxOf(wordmark(page), 'the name');
      const button = await boxOf(importButton(page), 'the Import button');
      expect(bar).toEqual({ x: 0, y: 0, width: viewport.width, height: 48 });

      // 16 from the left edge, then 16 between the name and the button.
      expect(name.x).toBe(16);
      expect(button.x - (name.x + name.width)).toBe(16);
      // On the middle of the 48, and the middle of each other, on whole pixels.
      expect([name.y, name.height]).toEqual([12, 24]);
      expect([button.y, button.height]).toEqual([8, 32]);
      await assertAligned([wordmark(page), importButton(page)], 'vertical-centre');

      await assertNoOverlap(wordmark(page), importButton(page));
      await assertNoOverflow(toolbar(page));
    });
  });

  test('draws a border of 1 pixel under itself, in the divider color', async ({ page }) => {
    await page.goto('/?theme=dark');
    const border = await toolbar(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.borderBottomWidth,
        style.borderBottomColor,
        style.paddingLeft,
        style.paddingRight,
      ];
    });
    // --k-border in the dark theme is #2d333c.
    expect(border).toEqual(['1px', 'rgb(45, 51, 60)', '16px', '16px']);
  });

  test('is the first thing the keyboard reaches, and the button shows a focus ring', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Import' })).toBeFocused();
    const ring = await importButton(page)
      .locator('button')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth];
      });
    expect(ring).toEqual(['solid', '2px']);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations in the ${theme} theme`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await expectNoSeriousViolations(page);
    });
  }
});
