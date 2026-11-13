import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';
import { assertNoOverflow } from './support/layout.js';

const demo = (page: Page, id: string): Locator => page.locator(`#${id}`);
const radios = (page: Page, id: string): Locator => demo(page, id).locator('[role="radio"]');
const radio = (page: Page, id: string, value: string): Locator =>
  demo(page, id).locator(`[role="radio"][data-value="${value}"]`);

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** The computed style properties of an element, by name. */
function styleOf(locator: Locator, ...names: string[]): Promise<Record<string, string>> {
  return locator.evaluate((element, wanted) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(wanted.map((name) => [name, style.getPropertyValue(name)]));
  }, names);
}

/** Keeps the values the control of the demo sends, in `window.heard`. */
async function listen(page: Page, id: string): Promise<void> {
  await demo(page, id)
    .locator('k-segmented')
    .evaluate((element) => {
      const holder = window as unknown as { heard: string[] };
      holder.heard = [];
      element.addEventListener('k-segmented-change', (heard) => {
        holder.heard.push((heard as CustomEvent<{ value: string }>).detail.value);
      });
    });
}

const heard = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { heard: string[] }).heard);

test.describe('the segmented control', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is a radio group with a name, and radios that name themselves, the chosen one checked', async ({
    page,
  }) => {
    await expect(page.getByRole('radiogroup', { name: 'View', exact: true })).toHaveCount(1);
    const box = demo(page, 'segmented-default');
    await expect(box.getByRole('radio', { name: '2D' })).toHaveAttribute('aria-checked', 'true');
    await expect(box.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'false');
    await expect(demo(page, 'segmented-second').getByRole('radio', { name: '3D' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radios(page, 'segmented-three')).toHaveText(['Day', 'Week', 'Month']);
  });

  test('is 32 high, each choice 48 wide or as wide as its words need, and the choices touch', async ({
    page,
  }) => {
    const group = await rect(demo(page, 'segmented-default').locator('[role="radiogroup"]'));
    expect(group.height).toBe(32);
    const [first, second] = await Promise.all([
      rect(radio(page, 'segmented-default', '2d')),
      rect(radio(page, 'segmented-default', '3d')),
    ]);
    expect([first.width, second.width]).toEqual([48, 48]);
    // The border takes a pixel on each side, and the choices fill what is inside it.
    expect(first.height).toBe(30);
    expect(second.x).toBe(first.x + first.width);
    expect(group.width).toBe(first.width + second.width + 2);
    // A choice with more words than 48 has room for is as wide as they need.
    expect((await rect(radio(page, 'segmented-three', 'month'))).width).toBeGreaterThanOrEqual(48);
  });

  test('is set in the body type, with the chosen choice filled and its words readable on the fill', async ({
    page,
  }) => {
    expect(
      await styleOf(radio(page, 'segmented-default', '2d'), 'font-size', 'font-weight'),
    ).toEqual({ 'font-size': '14px', 'font-weight': '500' });
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/gallery.html?theme=${theme}`);
      const chosen = radio(page, 'segmented-default', '2d');
      const other = radio(page, 'segmented-default', '3d');
      const [on, off, box] = await Promise.all([
        styleOf(chosen, 'background-color', 'color'),
        styleOf(other, 'background-color', 'color'),
        styleOf(demo(page, 'segmented-default').locator('[role="radiogroup"]'), 'background-color'),
      ]);
      // The choice that is not chosen has no fill of its own: its words are on the box's.
      expect(off['background-color']).toBe('rgba(0, 0, 0, 0)');
      expect(on['background-color']).not.toBe(box['background-color']);
      expect(
        contrastBetween(on['color'] ?? '', on['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastBetween(off['color'] ?? '', box['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(4.5);
      // And the fill is not all that marks it: it is as far from the box's color as a boundary has to be (3:1).
      expect(
        contrastBetween(on['background-color'] ?? '', box['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test('puts only the chosen choice in the Tab order', async ({ page }) => {
    expect(
      await radios(page, 'segmented-default').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('tabindex')),
      ),
    ).toEqual(['0', '-1']);
    expect(
      await radios(page, 'segmented-second').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('tabindex')),
      ),
    ).toEqual(['-1', '0']);
  });

  test('tells the page what a person chose by click, and not when the chosen one is clicked again', async ({
    page,
  }) => {
    await listen(page, 'segmented-default');
    await radio(page, 'segmented-default', '3d').click();
    expect(await heard(page)).toEqual(['3d']);
    await expect(radio(page, 'segmented-default', '3d')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, 'segmented-default', '2d')).toHaveAttribute('aria-checked', 'false');
    await radio(page, 'segmented-default', '3d').click();
    expect(await heard(page)).toEqual(['3d']);
  });

  test('moves and chooses with the arrow keys, wrapping round, and Home and End', async ({
    page,
  }) => {
    await listen(page, 'segmented-three');
    await page.keyboard.press('Shift');
    await radio(page, 'segmented-three', 'week').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'segmented-three', 'month')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'segmented-three', 'day')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(radio(page, 'segmented-three', 'month')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(radio(page, 'segmented-three', 'day')).toBeFocused();
    await page.keyboard.press('End');
    await expect(radio(page, 'segmented-three', 'month')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(radio(page, 'segmented-three', 'week')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, 'segmented-three', 'month')).toBeFocused();
    expect(await heard(page)).toEqual(['month', 'day', 'month', 'day', 'month', 'week', 'month']);
    await expect(radio(page, 'segmented-three', 'month')).toHaveAttribute('aria-checked', 'true');
  });

  test('shows a focus ring that is inside the choice, where nothing clips it, and that shows on the fill', async ({
    page,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/gallery.html?theme=${theme}`);
      await page.keyboard.press('Shift');
      const chosen = radio(page, 'segmented-default', '2d');
      await chosen.focus();
      const ring = await styleOf(
        chosen,
        'outline-style',
        'outline-width',
        'outline-offset',
        'outline-color',
        'background-color',
      );
      expect([ring['outline-style'], ring['outline-width'], ring['outline-offset']]).toEqual([
        'solid',
        '2px',
        '-2px',
      ]);
      // The ring is drawn on the choice's own fill, so it has to be seen against it (3:1, as a boundary has to be).
      expect(
        contrastBetween(ring['outline-color'] ?? '', ring['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(3);
      // And the ring of a choice that is not chosen, which has no fill, is the page's own accent, seen on the box.
      const other = radio(page, 'segmented-default', '3d');
      await other.focus();
      const plain = await styleOf(other, 'outline-color');
      const box = await styleOf(
        demo(page, 'segmented-default').locator('[role="radiogroup"]'),
        'background-color',
      );
      expect(
        contrastBetween(plain['outline-color'] ?? '', box['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test('enters at the chosen choice when it is focused', async ({ page }) => {
    await demo(page, 'segmented-second')
      .locator('k-segmented')
      .evaluate((element) => {
        (element as HTMLElement).focus();
      });
    await expect(radio(page, 'segmented-second', '3d')).toBeFocused();
  });

  test('can be disabled: nothing is chosen by it, and it looks it', async ({ page }) => {
    await listen(page, 'segmented-disabled');
    for (const choice of await radios(page, 'segmented-disabled').all()) {
      await expect(choice).toBeDisabled();
    }
    await radio(page, 'segmented-disabled', '3d').click({ force: true });
    expect(await heard(page)).toEqual([]);
    expect(await styleOf(radio(page, 'segmented-disabled', '3d'), 'cursor')).toEqual({
      cursor: 'not-allowed',
    });
  });

  test('refuses to be made without a name or with a value twice, which is a mistake of the page', async ({
    page,
  }) => {
    const outcome = await page.evaluate(async () => {
      const attempt = async (setUp: (control: HTMLElementTagNameMap['k-segmented']) => void) => {
        const control = document.createElement('k-segmented');
        setUp(control);
        document.body.append(control);
        try {
          await control.updateComplete;
          return 'fine';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        } finally {
          control.remove();
        }
      };
      return {
        unnamed: await attempt((control) => {
          control.options = [{ value: 'a', label: 'A' }];
        }),
        repeated: await attempt((control) => {
          control.label = 'Letters';
          control.options = [
            { value: 'a', label: 'A' },
            { value: 'a', label: 'Again' },
          ];
        }),
        none: await attempt((control) => {
          control.label = 'No choices';
        }),
      };
    });
    expect(outcome.unnamed).toMatch(/needs a label/);
    expect(outcome.repeated).toMatch(/must each have a different value/);
    expect(outcome.none).toBe('fine');
  });

  test('has no overflow, and nothing in it that a person using a screen reader or a keyboard cannot reach', async ({
    page,
  }) => {
    await assertNoOverflow(page.locator('[data-section="segmented"]'), { window: 'horizontal' });
    await expectNoSeriousViolations(page);
  });
});
