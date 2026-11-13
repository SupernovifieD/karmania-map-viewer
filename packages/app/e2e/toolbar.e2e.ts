import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { inEveryLayout } from './support/layouts.js';
import { assertAligned, assertNoOverflow, assertNoOverlap, boxOf } from './support/layout.js';

const toolbar = (page: Page) => page.locator('karmania-app header.toolbar');
const wordmark = (page: Page) => toolbar(page).getByRole('heading', { name: 'Karmania' });
const importButton = (page: Page) => toolbar(page).locator('k-button');
const viewControl = (page: Page) => toolbar(page).locator('k-segmented');
const viewChoice = (page: Page, name: string) =>
  toolbar(page).getByRole('radio', { name, exact: true });

/** The view the scene is in, as the viewer says. */
const sceneView = (page: Page) =>
  page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { viewMode: string };
    };
    return viewer.scene().viewMode;
  });

test.describe('the toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('has the name and then the Import button, and the control of the view at the right', async ({
    page,
  }) => {
    await page.goto('/');
    const order = await toolbar(page).evaluate((element) =>
      [...element.children].map((child) => [
        child.tagName.toLowerCase(),
        child.className,
        child.textContent.trim().replace(/\s+/g, ' '),
      ]),
    );
    // The control's choices are in its shadow root, so it has no text of its own.
    expect(order).toEqual([
      ['h1', 'wordmark', 'Karmania'],
      ['k-button', '', 'Import'],
      ['div', 'tools', ''],
    ]);
    expect(
      await toolbar(page)
        .locator('.tools')
        .evaluate((e) => [...e.children].map((c) => c.tagName.toLowerCase())),
    ).toEqual(['k-segmented']);
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
    await expect(toolbar(page).getByRole('button', { name: 'Import' })).toHaveCount(1);
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

      // The control of the view is 16 from the right edge, 32 high and on the middle of the 48.
      const view = await boxOf(viewControl(page), 'the control of the view');
      expect(view.x + view.width).toBe(viewport.width - 16);
      expect([view.y, view.height]).toEqual([8, 32]);
      expect(view.x).toBeGreaterThan(button.x + button.width);
      await assertAligned([importButton(page), viewControl(page)], 'vertical-centre');
      await assertNoOverlap(importButton(page), viewControl(page));
    });
  });

  test('has the control of the view named View, with 2D and 3D, the one the scene is in chosen', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(toolbar(page).getByRole('radiogroup', { name: 'View', exact: true })).toHaveCount(
      1,
    );
    await expect(viewChoice(page, '2D')).toHaveAttribute('aria-checked', 'true');
    await expect(viewChoice(page, '3D')).toHaveAttribute('aria-checked', 'false');
    expect(await sceneView(page)).toBe('2d');
  });

  test('switches the map to 3D and back when a person chooses, with the mouse and with the keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    await viewChoice(page, '3D').click();
    expect(await sceneView(page)).toBe('3d');
    await expect(viewChoice(page, '3D')).toHaveAttribute('aria-checked', 'true');
    await viewChoice(page, '2D').click();
    expect(await sceneView(page)).toBe('2d');
    // From Import, one Tab reaches the control (at the choice that is chosen), and the arrow keys choose.
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(importButton(page).locator('button')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(viewChoice(page, '2D')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(viewChoice(page, '3D')).toBeFocused();
    expect(await sceneView(page)).toBe('3d');
    await page.keyboard.press('ArrowLeft');
    expect(await sceneView(page)).toBe('2d');
  });

  test('follows the scene when the view changes by other means', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        dispatch(command: unknown): unknown;
      };
      viewer.dispatch({ type: 'setViewMode', mode: '3d' });
    });
    await expect(viewChoice(page, '3D')).toHaveAttribute('aria-checked', 'true');
    await expect(viewChoice(page, '2D')).toHaveAttribute('aria-checked', 'false');
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
    await expect(toolbar(page).getByRole('button', { name: 'Import' })).toBeFocused();
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
