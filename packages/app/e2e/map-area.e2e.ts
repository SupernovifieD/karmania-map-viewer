import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { inEveryLayout } from './support/layouts.js';
import { assertNoOverflow, boxOf } from './support/layout.js';

const map = (page: Page) => page.locator('karmania-map-area');
const state = (page: Page) => map(page).locator('k-empty-state');
const part = (page: Page, selector: string) => state(page).locator(selector);

/** What the line under the title says: the text that was put in the empty state's default slot. */
function line(page: Page): Promise<string> {
  return part(page, '.message').evaluate(
    (element) =>
      element
        .querySelector('slot')
        ?.assignedNodes()
        .map((node) => (node.textContent ?? '').trim())
        .filter((text) => text !== '')
        .join(' ') ?? '',
  );
}

/** Puts a number of datasets in the map area, and waits for it to be drawn. */
async function load(page: Page, datasets: number): Promise<void> {
  await map(page).evaluate(async (element, count) => {
    (element as unknown as { datasets: number }).datasets = count;
    await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
  }, datasets);
}

/** A few computed style values of an element. */
function styleOf(locator: Locator, ...properties: string[]): Promise<string[]> {
  return locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return names.map((name) => style.getPropertyValue(name));
  }, properties);
}

test.describe('the map area', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('says there is no data yet, and what to do about it', async ({ page }) => {
    await page.goto('/?theme=light');
    await expect(part(page, '.heading')).toHaveText('No data yet');
    await expect.poll(() => line(page)).toBe('Drop files here or use Import');
    const button = part(page, 'k-button');
    await expect(button).toHaveText('Import');
    await expect(button).toHaveAttribute('variant', 'secondary');
    await expect(button.locator('k-icon')).toHaveAttribute('name', 'upload');
    await expect(part(page, 'k-icon.icon')).toHaveAttribute('name', 'map');

    // 16/24 and the text color; 14/20 and the muted color; the icon is muted and 32.
    expect(
      await styleOf(part(page, '.heading'), 'font-size', 'line-height', 'font-weight', 'color'),
    ).toEqual(['16px', '24px', '500', 'rgb(26, 29, 33)']);
    expect(
      await styleOf(part(page, '.message'), 'font-size', 'line-height', 'font-weight', 'color'),
    ).toEqual(['14px', '20px', '400', 'rgb(85, 94, 107)']);
    expect(await styleOf(part(page, 'k-icon.icon'), 'color')).toEqual(['rgb(85, 94, 107)']);
    const icon = await boxOf(part(page, 'k-icon.icon'), 'the icon');
    expect([icon.width, icon.height]).toEqual([32, 32]);
  });

  test('has the map color for its background in both themes', async ({ page }) => {
    await page.goto('/?theme=light');
    expect(await styleOf(map(page), 'background-color')).toEqual(['rgb(233, 236, 240)']);
    await page.goto('/?theme=dark');
    expect(await styleOf(map(page), 'background-color')).toEqual(['rgb(14, 16, 19)']);
  });

  test('puts 8 between the icon, the title and the line, and 16 before the button, in the middle both ways', async ({
    page,
  }) => {
    await inEveryLayout(page, '/', async () => {
      const [icon, heading, message, button] = [
        await boxOf(part(page, 'k-icon.icon'), 'the icon'),
        await boxOf(part(page, '.heading'), 'the title'),
        await boxOf(part(page, '.message'), 'the line'),
        await boxOf(part(page, 'k-button'), 'the button'),
      ];
      expect(heading.y - (icon.y + icon.height)).toBe(8);
      expect(message.y - (heading.y + heading.height)).toBe(8);
      expect(button.y - (message.y + message.height)).toBe(16);

      // The group is centred in the map area, to within half a pixel.
      const group = await boxOf(part(page, '.group'), 'the group');
      const area = await boxOf(map(page), 'the map area');
      expect(Math.abs(group.x + group.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(
        0.5,
      );
      expect(Math.abs(group.y + group.height / 2 - (area.y + area.height / 2))).toBeLessThanOrEqual(
        0.5,
      );

      await assertNoOverflow(map(page));
    });
  });

  test('says that the map comes in phase 2 once there is data, and how many datasets there are', async ({
    page,
  }) => {
    await page.goto('/');
    await load(page, 1);
    await expect(part(page, '.heading')).toHaveText('Map rendering arrives in phase 2');
    await expect.poll(() => line(page)).toBe('1 dataset loaded');
    await expect(part(page, 'k-button')).toHaveCount(0);
    await load(page, 3);
    await expect.poll(() => line(page)).toBe('3 datasets loaded');
    // A long count wraps; it does not overflow.
    await load(page, 10_000_000);
    await expect.poll(() => line(page)).toBe('10000000 datasets loaded');
    await assertNoOverflow(map(page));
    await load(page, 0);
    await expect(part(page, '.heading')).toHaveText('No data yet');
    await expect(part(page, 'k-button')).toHaveCount(1);
  });

  test('keeps the same icon, and stays in the middle, once there is data', async ({ page }) => {
    await inEveryLayout(page, '/', async () => {
      await load(page, 2);
      await expect(part(page, 'k-icon.icon')).toHaveAttribute('name', 'map');
      const group = await boxOf(part(page, '.group'), 'the group');
      const area = await boxOf(map(page), 'the map area');
      expect(Math.abs(group.x + group.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(
        0.5,
      );
      expect(Math.abs(group.y + group.height / 2 - (area.y + area.height / 2))).toBeLessThanOrEqual(
        0.5,
      );
      await assertNoOverflow(map(page));
    });
  });

  test('is the page’s main area, called Map, and the button in it reaches the keyboard second', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'Map' })).toHaveCount(1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(part(page, 'k-button').getByRole('button', { name: 'Import' })).toBeFocused();
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const datasets of [0, 2]) {
      test(`has no serious accessibility violations in the ${theme} theme with ${String(datasets)} datasets`, async ({
        page,
      }) => {
        await page.goto(`/?theme=${theme}`);
        await load(page, datasets);
        await expectNoSeriousViolations(page);
      });
    }
  }
});
