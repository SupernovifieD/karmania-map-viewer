import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { inEveryLayout } from './support/layouts.js';
import {
  assertAdjacent,
  assertAligned,
  assertNoOverflow,
  assertNoOverlap,
  boxOf,
  textStartOf,
} from './support/layout.js';

const panel = (page: Page) => page.locator('karmania-panel');
const tabs = (page: Page) => panel(page).locator('k-tabs');
const header = (page: Page) => tabs(page).locator('.header');
const tab = (page: Page, name: string) => panel(page).getByRole('tab', { name });
const body = (page: Page, id: 'legend' | 'data') => panel(page).locator(`.body[slot="${id}"]`);
const legendState = (page: Page) => body(page, 'legend').locator('k-empty-state');

/** A few computed style values of an element. */
function styleOf(locator: Locator, ...properties: string[]): Promise<string[]> {
  return locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return names.map((name) => style.getPropertyValue(name));
  }, properties);
}

test.describe('the panel: its tabs and its body', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('is a labelled region with a row of two tabs, Legend and then Data, and Legend is chosen', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('complementary', { name: 'Side panel' })).toHaveCount(1);
    await expect(panel(page).getByRole('tablist', { name: 'Panel tabs' })).toHaveCount(1);
    expect((await panel(page).getByRole('tab').allTextContents()).map((t) => t.trim())).toEqual([
      'Legend',
      'Data',
    ]);
    await expect(tab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'false');
    // Both panels are in the page, and only the chosen one is shown.
    await expect(body(page, 'legend')).toBeVisible();
    await expect(body(page, 'data')).toBeHidden();
    await expect(body(page, 'data')).toHaveCount(1);
  });

  test('has a row 40 high that starts its first label 16 in, and a body under it that fills the rest', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async () => {
      const outer = await boxOf(panel(page), 'the panel');
      const row = await boxOf(header(page), 'the row');
      const content = await boxOf(body(page, 'legend'), 'the body');
      // Inside the border of 1 pixel.
      expect([row.x, row.y, row.width, row.height]).toEqual([
        outer.x + 1,
        outer.y,
        outer.width - 1,
        40,
      ]);
      expect([content.x, content.y, content.width, content.height]).toEqual([
        outer.x + 1,
        outer.y + 40,
        outer.width - 1,
        outer.height - 40,
      ]);
      await assertAdjacent(header(page), body(page, 'legend'), 'vertical');
      await assertNoOverlap(header(page), body(page, 'legend'));
      await assertNoOverflow(panel(page));

      // The first label starts 16 inside the panel, where the text of the body will.
      const first = await boxOf(tab(page, 'Legend'), 'the first tab');
      expect(first.x - (outer.x + 1)).toBe(4);
      const start = await textStartOf(tab(page, 'Legend'));
      expect(start - (outer.x + 1)).toBe(16);
    });
  });

  test('has a body with 16 around what is in it, that scrolls down and never across', async ({
    page,
  }) => {
    await page.goto('/');
    expect(
      await styleOf(
        body(page, 'legend'),
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'overflow-x',
        'overflow-y',
      ),
    ).toEqual(['16px', '16px', '16px', '16px', 'hidden', 'auto']);

    // Too much to fit: the body scrolls, and nothing else does.
    await body(page, 'legend').evaluate((element) => {
      for (let line = 0; line < 100; line += 1) {
        const paragraph = document.createElement('p');
        paragraph.textContent = `Layer ${String(line)}`;
        element.append(paragraph);
      }
      const wide = document.createElement('div');
      wide.style.width = '2000px';
      wide.style.height = '4px';
      element.append(wide);
    });
    // A person scrolling with the wheel moves it down, and not across.
    await body(page, 'legend').hover();
    await page.mouse.wheel(0, 200);
    await page.mouse.wheel(200, 0);
    await expect
      .poll(() => body(page, 'legend').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const after = await body(page, 'legend').evaluate((element) => {
      const root = document.documentElement;
      return {
        across: element.scrollLeft,
        // The room a horizontal scrollbar would take: none.
        scrollbar: element.getBoundingClientRect().height - element.clientHeight,
        page: [root.scrollWidth - root.clientWidth, root.scrollHeight - root.clientHeight],
      };
    });
    expect(after).toEqual({ across: 0, scrollbar: 0, page: [0, 0] });
    // The row is not scrolled out of sight with it.
    const row = await boxOf(header(page), 'the row');
    expect(row.y).toBe(48);
  });

  test('says in the Legend that layers will appear once maps are rendered, and nothing else', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await expect(legendState(page)).toHaveText(
      /^\s*Layers will appear here once maps are rendered\.\s*$/,
    );
    await expect(legendState(page).locator('k-icon')).toHaveCount(0);
    await expect(legendState(page).locator('.heading')).toHaveCount(0);
    await expect(legendState(page).locator('k-button')).toHaveCount(0);
    // 14/20 in the muted color.
    expect(
      await styleOf(legendState(page).locator('.message'), 'font-size', 'line-height', 'color'),
    ).toEqual(['14px', '20px', 'rgb(85, 94, 107)']);
  });

  test('centres the Legend message in the body, both ways, at every size in both themes', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async () => {
      const group = await boxOf(legendState(page).locator('.group'), 'the message');
      const area = await boxOf(body(page, 'legend'), 'the body');
      // The padding is the same on every side, so the middle of the body is the middle of the room.
      expect(Math.abs(group.x + group.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(
        0.5,
      );
      expect(Math.abs(group.y + group.height / 2 - (area.y + area.height / 2))).toBeLessThanOrEqual(
        0.5,
      );
      await assertNoOverflow(body(page, 'legend'));
    });
  });

  test('shows the Data body, empty for now, when Data is chosen, and the Legend again after', async ({
    page,
  }) => {
    await page.goto('/');
    await tab(page, 'Data').click();
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');
    await expect(body(page, 'data')).toBeVisible();
    await expect(body(page, 'legend')).toBeHidden();
    const [legendBox, dataBox] = [
      await boxOf(body(page, 'data'), 'the Data body'),
      // The Legend body keeps its place: it is only not shown.
      await header(page).boundingBox(),
    ];
    expect(dataBox?.height).toBe(40);
    expect(legendBox.height).toBeGreaterThan(300);
    await assertNoOverflow(panel(page));
    await tab(page, 'Legend').click();
    await expect(body(page, 'legend')).toBeVisible();
  });

  test('is reached by the keyboard: Tab goes into the row, and the arrows choose a tab', async ({
    page,
  }) => {
    await page.goto('/');
    await panel(page).getByRole('tab', { name: 'Legend' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Data')).toBeFocused();
    await expect(tab(page, 'Data')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
  });

  test('puts a thin divider under the row, inside it, so it takes no room', async ({ page }) => {
    await page.goto('/?theme=light');
    const shadow = await styleOf(header(page), 'box-shadow');
    // --k-border in the light theme, drawn 1 pixel up from the bottom edge, with no blur.
    expect(shadow[0]).toBe('rgb(223, 227, 232) 0px -1px 0px 0px inset');
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const chosen of ['Legend', 'Data'] as const) {
      test(`has no serious accessibility violations in the ${theme} theme with ${chosen} chosen`, async ({
        page,
      }) => {
        await page.goto(`/?theme=${theme}`);
        await tab(page, chosen).click();
        await expectNoSeriousViolations(page);
      });
    }
  }

  test('lines the labels of the tabs up with each other on one baseline', async ({ page }) => {
    await page.goto('/');
    await assertAligned([tab(page, 'Legend'), tab(page, 'Data')], 'baseline');
    await assertAligned([tab(page, 'Legend'), tab(page, 'Data')], 'top');
  });
});
