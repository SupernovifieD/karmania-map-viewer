import { expect, test } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { inEveryLayout } from './support/layouts.js';
import {
  assertAdjacent,
  assertAligned,
  assertNoOverflow,
  assertNoOverlap,
  boxOf,
} from './support/layout.js';

/** The width the panel starts at (`--k-panel-width-default`), and the toolbar's height. */
const PANEL_WIDTH = 360;
const TOOLBAR_HEIGHT = 48;

test.describe('the shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('is a toolbar over a map and a panel that fill the window, at every size in both themes', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async ({ viewport }) => {
      const app = page.locator('karmania-app');
      const toolbar = app.locator('header');
      const map = page.locator('karmania-map-area');
      const panel = page.locator('karmania-panel');
      const { width, height } = viewport;

      expect(await boxOf(app, 'the app')).toEqual({ x: 0, y: 0, width, height });
      expect(await boxOf(toolbar, 'the toolbar')).toEqual({
        x: 0,
        y: 0,
        width,
        height: TOOLBAR_HEIGHT,
      });
      // Under the toolbar the map and the panel share the rest of the height, and the width.
      expect(await boxOf(map, 'the map area')).toEqual({
        x: 0,
        y: TOOLBAR_HEIGHT,
        width: width - PANEL_WIDTH,
        height: height - TOOLBAR_HEIGHT,
      });
      expect(await boxOf(panel, 'the panel')).toEqual({
        x: width - PANEL_WIDTH,
        y: TOOLBAR_HEIGHT,
        width: PANEL_WIDTH,
        height: height - TOOLBAR_HEIGHT,
      });

      await assertAdjacent(toolbar, map, 'vertical');
      await assertAdjacent(toolbar, panel, 'vertical');
      await assertAdjacent(map, panel, 'horizontal');
      await assertNoOverlap(map, panel);
      await assertNoOverlap(toolbar, map);
      await assertNoOverlap(toolbar, panel);
      await assertAligned([map, panel], 'top');
      await assertAligned([map, panel], 'bottom');
      await assertNoOverflow(app);
    });
  });

  test('never scrolls the page', async ({ page }) => {
    await inEveryLayout(page, '/', async () => {
      const scrolling = await page.evaluate(() => {
        window.scrollTo(0, 100);
        const root = document.documentElement;
        return {
          scrolled: [window.scrollX, window.scrollY],
          overflow: [root.scrollWidth - root.clientWidth, root.scrollHeight - root.clientHeight],
        };
      });
      expect(scrolling).toEqual({ scrolled: [0, 0], overflow: [0, 0] });
    });
  });

  test('gives the map what the panel leaves, whatever is in it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('/');
    // Something wide in the map area must not push the panel out of the window.
    await page.locator('karmania-map-area').evaluate((element) => {
      const wide = document.createElement('div');
      wide.style.width = '5000px';
      wide.style.height = '10px';
      element.shadowRoot?.querySelector('main')?.append(wide);
    });
    const panel = await boxOf(page.locator('karmania-panel'), 'the panel');
    expect([panel.x, panel.width]).toEqual([1024 - PANEL_WIDTH, PANEL_WIDTH]);
  });

  test('draws the toolbar and the panel apart from the map with a border', async ({ page }) => {
    await page.goto('/?theme=light');
    const borders = await page.evaluate(() => {
      const app = document.querySelector('karmania-app');
      const toolbar = app?.shadowRoot?.querySelector('header');
      const panel = app?.shadowRoot?.querySelector('karmania-panel');
      const style = (element: Element | null | undefined) =>
        element === null || element === undefined ? undefined : getComputedStyle(element);
      return {
        toolbar: [style(toolbar)?.borderBottomWidth, style(toolbar)?.borderBottomColor],
        panel: [style(panel)?.borderLeftWidth, style(panel)?.borderLeftColor],
      };
    });
    // --k-border in the light theme is #dfe3e8.
    expect(borders).toEqual({
      toolbar: ['1px', 'rgb(223, 227, 232)'],
      panel: ['1px', 'rgb(223, 227, 232)'],
    });
  });

  test('has the regions of a page: a banner, the main area and a labelled complementary', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: 'Side panel' })).toHaveCount(1);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations in the ${theme} theme`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await expectNoSeriousViolations(page);
    });
  }
});
