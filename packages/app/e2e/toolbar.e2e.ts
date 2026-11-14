import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { inEveryLayout } from './support/layouts.js';
import { assertAligned, assertNoOverflow, assertNoOverlap, boxOf } from './support/layout.js';

const toolbar = (page: Page) => page.locator('karmania-app header.toolbar');
const wordmark = (page: Page) => toolbar(page).getByRole('heading', { name: 'Karmania' });
const importButton = (page: Page) => toolbar(page).locator('k-button');
const viewControl = (page: Page) => toolbar(page).locator('k-segmented');
const exaggeration = (page: Page) => toolbar(page).locator('k-select');
const exaggerationSelect = (page: Page) => exaggeration(page).locator('select');
const viewChoice = (page: Page, name: string) =>
  toolbar(page).getByRole('radio', { name, exact: true });

/** What the scene multiplies heights by, as the viewer says. */
const sceneExaggeration = (page: Page) =>
  page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { verticalExaggeration: number };
    };
    return viewer.scene().verticalExaggeration;
  });

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
    ).toEqual(['k-segmented', 'k-tooltip']);
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

      // At the right: the control of the view, 8 from the select of the exaggeration, which is 72 wide and 16 from the right edge; each 32 high
      // and on the middle of the 48.
      const view = await boxOf(viewControl(page), 'the control of the view');
      const select = await boxOf(exaggeration(page), 'the select of the exaggeration');
      expect(select.x + select.width).toBe(viewport.width - 16);
      expect([select.width, select.height]).toEqual([72, 32]);
      expect(select.x - (view.x + view.width)).toBe(8);
      expect([view.y, view.height]).toEqual([8, 32]);
      expect(select.y).toBe(8);
      expect(view.x).toBeGreaterThan(button.x + button.width);
      await assertAligned(
        [importButton(page), viewControl(page), exaggeration(page)],
        'vertical-centre',
      );
      await assertNoOverlap(importButton(page), viewControl(page));
      await assertNoOverlap(viewControl(page), exaggeration(page));
    });
  });

  test('has the select of the exaggeration named for it, with ×1 to ×10 and ×1 chosen, which is there and disabled in 2D', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      toolbar(page).getByRole('combobox', { name: 'Vertical exaggeration', exact: true }),
    ).toHaveCount(1);
    await expect(exaggerationSelect(page).locator('option')).toHaveText([
      '×1',
      '×2',
      '×3',
      '×5',
      '×10',
    ]);
    expect(await exaggerationSelect(page).inputValue()).toBe('1');
    await expect(exaggerationSelect(page)).toBeDisabled();
  });

  test('describes why the select is disabled to a screen reader, on the select that it reaches, in 2D, and describes nothing in 3D', async ({
    page,
  }) => {
    await page.goto('/');
    // The description is of the native select inside the control, which is what a screen reader meets.
    await expect(exaggerationSelect(page)).toHaveAccessibleDescription('Only in the 3D view');
    await viewChoice(page, '3D').click();
    await expect(exaggerationSelect(page)).toHaveAccessibleDescription('');
    await viewChoice(page, '2D').click();
    await expect(exaggerationSelect(page)).toHaveAccessibleDescription('Only in the 3D view');
  });

  test('says why the select is disabled in 2D, when the pointer is over it, and says nothing in 3D', async ({
    page,
  }) => {
    await page.goto('/');
    await exaggeration(page).hover();
    await expect(page.getByText('Only in the 3D view')).toBeVisible();
    await page.mouse.move(400, 300);
    await expect(page.getByText('Only in the 3D view')).toBeHidden();
    await viewChoice(page, '3D').click();
    await expect(exaggerationSelect(page)).toBeEnabled();
    await exaggeration(page).hover();
    await page.waitForTimeout(300);
    await expect(page.getByText('Only in the 3D view')).toBeHidden();
  });

  test('is enabled in 3D and gives the scene what is chosen, and follows the scene when it changes by other means', async ({
    page,
  }) => {
    await page.goto('/');
    await viewChoice(page, '3D').click();
    await exaggerationSelect(page).selectOption('5');
    expect(await sceneExaggeration(page)).toBe(5);
    await exaggerationSelect(page).selectOption('2');
    expect(await sceneExaggeration(page)).toBe(2);
    await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        dispatch(command: unknown): unknown;
      };
      viewer.dispatch({ type: 'setVerticalExaggeration', factor: 10 });
    });
    await expect.poll(() => exaggerationSelect(page).inputValue()).toBe('10');
  });

  test('moves nothing when the view is switched: the select and the control are where they were', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async () => {
      const before = [
        await boxOf(viewControl(page), 'the control of the view'),
        await boxOf(exaggeration(page), 'the select of the exaggeration'),
        await boxOf(importButton(page), 'the Import button'),
      ];
      await viewChoice(page, '3D').click();
      await expect(exaggerationSelect(page)).toBeEnabled();
      const after = [
        await boxOf(viewControl(page), 'the control of the view'),
        await boxOf(exaggeration(page), 'the select of the exaggeration'),
        await boxOf(importButton(page), 'the Import button'),
      ];
      expect(after).toEqual(before);
    });
  });

  test('is reached after the control of the view, in 3D, and skipped in 2D, where it cannot be used', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(viewChoice(page, '2D')).toBeFocused();
    // In 2D the select is disabled and not a stop: the next is the map's Import.
    await page.keyboard.press('Tab');
    await expect(exaggerationSelect(page)).not.toBeFocused();
    await expect(page.locator('karmania-map-area k-button button')).toBeFocused();
    await viewChoice(page, '3D').click();
    await viewChoice(page, '3D').focus();
    await page.keyboard.press('Tab');
    await expect(exaggerationSelect(page)).toBeFocused();
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

  test('shows what the scene has, and not what was chosen, when the scene did not take it', async ({
    page,
  }) => {
    await page.goto('/');
    // The viewer is made to refuse: its way to switch the view and its commands do nothing.
    await page.evaluate(() => {
      const viewer = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
        setViewMode: (mode: string) => void;
        dispatch: (command: unknown) => unknown;
      };
      viewer.setViewMode = () => undefined;
      viewer.dispatch = () => undefined;
    });
    await viewChoice(page, '3D').click();
    expect(await sceneView(page)).toBe('2d');
    await expect(viewChoice(page, '2D')).toHaveAttribute('aria-checked', 'true');
    await expect(viewChoice(page, '3D')).toHaveAttribute('aria-checked', 'false');
    // The select, made to be enabled, shows the factor the scene has too.
    await exaggerationSelect(page).evaluate((element) => {
      (element as HTMLSelectElement).disabled = false;
    });
    await exaggerationSelect(page).selectOption('5');
    await expect.poll(() => exaggerationSelect(page).inputValue()).toBe('1');
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
