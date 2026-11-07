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

/** What the map area is told, as the viewer tells it. */
interface Told {
  datasets?: number;
  preparing?: number;
  progress?: number;
  reasons?: string[];
}

/** Tells the map area how things are, and waits for it to be drawn. */
async function tell(page: Page, told: Told): Promise<void> {
  await map(page).evaluate(async (element, properties) => {
    Object.assign(element, properties);
    await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
  }, told);
}

/** Puts a number of datasets in the map area, and waits for it to be drawn. */
const load = (page: Page, datasets: number): Promise<void> => tell(page, { datasets });

/** The chip at the top while layers are being prepared. */
const chip = (page: Page) => map(page).locator('.chip');

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

  test('has no empty state once there is data, which is the map, and has it again with none', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(state(page)).toHaveCount(1);
    await load(page, 1);
    await expect(state(page)).toHaveCount(0);
    await expect(map(page).locator('canvas')).toHaveCount(1);
    await load(page, 10_000_000);
    await expect(state(page)).toHaveCount(0);
    await load(page, 0);
    await expect(part(page, '.heading')).toHaveText('No data yet');
    await expect(part(page, 'k-button')).toHaveCount(1);
  });

  test.describe('while layers are being prepared', () => {
    test('says how many, in a chip at the top in the middle, 16 from the edge, over the map, and moves nothing', async ({
      page,
    }) => {
      await page.goto('/');
      await load(page, 2);
      await expect(chip(page)).toHaveCount(0);
      const canvas = await boxOf(map(page).locator('canvas'), 'the canvas');
      await tell(page, { preparing: 2, progress: 0.4 });
      await expect(chip(page)).toHaveText('Preparing 2 layers…');
      await expect(chip(page)).toHaveAttribute('role', 'status');
      const area = await boxOf(map(page), 'the map area');
      const box = await boxOf(chip(page), 'the chip');
      expect(box.y - area.y).toBeCloseTo(16, 1);
      expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(0.5);
      expect(box.height).toBeCloseTo(24, 1);
      // Over the map and moving nothing.
      expect(await boxOf(map(page).locator('canvas'), 'the canvas')).toEqual(canvas);
      expect(await styleOf(chip(page), 'position', 'background-color')).toEqual([
        'absolute',
        expect.stringMatching(/^rgb/) as unknown as string,
      ]);
      await tell(page, { preparing: 1 });
      await expect(chip(page)).toHaveText('Preparing 1 layer…');
      await tell(page, { preparing: 1234 });
      await expect(chip(page)).toHaveText('Preparing 1,234 layers…');
      await assertNoOverflow(map(page));
      await tell(page, { preparing: 0 });
      await expect(chip(page)).toHaveCount(0);
    });

    test('has a thin bar along its foot that is as full as the layers are ready', async ({
      page,
    }) => {
      await page.goto('/');
      await tell(page, { datasets: 1, preparing: 1, progress: 0.25 });
      const filled = () =>
        chip(page).evaluate((element) => {
          const bar = element.querySelector('.bar');
          if (bar === null) {
            return [];
          }
          const after = getComputedStyle(bar, '::after');
          return [
            Number.parseFloat(after.width),
            Number.parseFloat(getComputedStyle(bar).width),
            Number.parseFloat(getComputedStyle(bar).height),
          ];
        });
      const [full = 0, track = 0, height = 0] = await filled();
      expect(track).toBeGreaterThan(100);
      expect(full).toBeCloseTo(track * 0.25, 0);
      expect(height).toBe(2);
      await tell(page, { progress: 1 });
      await expect.poll(async () => (await filled())[0] ?? -1).toBeCloseTo(track, 0);
      // Out of range is held to it.
      await tell(page, { progress: 7 });
      await expect.poll(async () => (await filled())[0] ?? -1).toBeCloseTo(track, 0);
      await tell(page, { progress: -3 });
      await expect.poll(async () => (await filled())[0] ?? -1).toBe(0);
    });

    test('gives way to the notice that the map is being drawn again, which is in the same place', async ({
      page,
    }) => {
      await page.goto('/');
      await tell(page, { datasets: 1, preparing: 2, progress: 0.5 });
      await expect(chip(page)).toHaveCount(1);
      await map(page).evaluate(async (element) => {
        (element as unknown as { redrawing: boolean }).redrawing = true;
        await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
      });
      await expect(chip(page)).toHaveCount(0);
      await expect(map(page).locator('.notice')).toHaveText('Redrawing the map…');
    });
  });

  test.describe('when there is data and none of it can be drawn', () => {
    test('says so, with the reason, and a button to the Legend', async ({ page }) => {
      await page.goto('/');
      await tell(page, {
        datasets: 1,
        reasons: ['The code EPSG:99999 is not known. Change the map’s coordinate system.'],
      });
      await expect(part(page, '.heading')).toHaveText('Nothing can be drawn yet');
      await expect
        .poll(() => line(page))
        .toBe('The code EPSG:99999 is not known. Change the map’s coordinate system.');
      await expect(part(page, 'k-icon.icon')).toHaveAttribute('name', 'map');
      const button = part(page, 'k-button');
      await expect(button).toHaveText('Show the Legend');
      await expect(button).toHaveAttribute('variant', 'secondary');
      await expect(button.locator('k-icon')).toHaveAttribute('name', 'layers');
      // Several layers: how many, and the first reason.
      await tell(page, {
        datasets: 3,
        reasons: ['First reason.', 'Second reason.', 'Third reason.'],
      });
      await expect.poll(() => line(page)).toBe('3 layers cannot be drawn. First reason.');
    });

    test('opens the Legend tab when the button is pressed, whichever tab was open', async ({
      page,
    }) => {
      await page.goto('/');
      const tab = (name: string) =>
        page.locator('karmania-panel k-tabs').getByRole('tab', { name });
      await tab('Data').click();
      await expect(tab('Data')).toHaveAttribute('aria-selected', 'true');
      await tell(page, { datasets: 1, reasons: ['Not drawn.'] });
      await part(page, 'k-button').getByRole('button', { name: 'Show the Legend' }).click();
      await expect(tab('Legend')).toHaveAttribute('aria-selected', 'true');
    });

    test('stays in the middle of the map area, and does not overflow, at every window size', async ({
      page,
    }) => {
      await inEveryLayout(page, '/', async () => {
        await tell(page, { datasets: 2, reasons: ['A reason. '.repeat(40)] });
        const group = await boxOf(part(page, '.group'), 'the group');
        const area = await boxOf(map(page), 'the map area');
        expect(Math.abs(group.x + group.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(
          0.5,
        );
        expect(
          Math.abs(group.y + group.height / 2 - (area.y + area.height / 2)),
        ).toBeLessThanOrEqual(0.5);
        await assertNoOverflow(map(page));
      });
    });

    test('is not said while a layer is being prepared, which is said instead, or once nothing is the matter', async ({
      page,
    }) => {
      await page.goto('/');
      await tell(page, { datasets: 1, preparing: 1, progress: 0.1, reasons: [] });
      await expect(state(page)).toHaveCount(0);
      await expect(chip(page)).toHaveCount(1);
      await tell(page, { preparing: 0 });
      await expect(chip(page)).toHaveCount(0);
      await expect(state(page)).toHaveCount(0);
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

  const STATES: readonly { name: string; told: Told }[] = [
    { name: 'no data', told: { datasets: 0 } },
    { name: 'data', told: { datasets: 2 } },
    { name: 'layers being prepared', told: { datasets: 2, preparing: 2, progress: 0.4 } },
    { name: 'nothing that can be drawn', told: { datasets: 2, reasons: ['Not drawn.'] } },
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const item of STATES) {
      test(`has no serious accessibility violations in the ${theme} theme with ${item.name}`, async ({
        page,
      }) => {
        await page.goto(`/?theme=${theme}`);
        await tell(page, item.told);
        await expectNoSeriousViolations(page);
      });
    }
  }
});
