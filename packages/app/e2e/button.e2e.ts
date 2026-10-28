import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';

const VARIANTS = ['primary', 'secondary', 'ghost'] as const;
const SIZES = ['32', '28'] as const;
const KINDS = ['text', 'icon-text', 'icon-only', 'disabled', 'icon-only-disabled'] as const;

/** A button of the gallery's matrix. */
function cell(page: Page, variant: string, size: string, kind: string): Locator {
  return page.locator(
    `div[data-variant="${variant}"][data-size="${size}"][data-kind="${kind}"] k-button`,
  );
}

/** The computed colors of the native button inside a `k-button`. */
async function colors(
  button: Locator,
): Promise<{ background: string; color: string; border: string }> {
  return button.locator('button').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
    };
  });
}

test.describe('the button', () => {
  test.beforeEach(async ({ page }) => {
    // No transitions, so a color read just after a state change is the final one.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is 32 or 28 pixels high in every variant and kind, and an icon alone is square and at least 32', async ({
    page,
  }) => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        for (const kind of KINDS) {
          const box = await cell(page, variant, size, kind).boundingBox();
          // An icon alone is never smaller than the 32 pixel hit target.
          const expected = kind.startsWith('icon-only') ? Math.max(Number(size), 32) : Number(size);
          expect(box?.height, `${variant} ${size} ${kind}`).toBe(expected);
          if (kind.startsWith('icon-only')) {
            expect(box?.width, `${variant} ${size} ${kind}`).toBe(expected);
          }
        }
      }
    }
  });

  test('puts 8 pixels between its icon and its words', async ({ page }) => {
    const gap = await cell(page, 'primary', '32', 'icon-text').evaluate((element) => {
      const icon = element.shadowRoot?.querySelector('k-icon')?.getBoundingClientRect();
      const text = element.shadowRoot?.querySelector('.text')?.getBoundingClientRect();
      return icon && text ? text.left - icon.right : Number.NaN;
    });
    expect(gap).toBe(8);
  });

  test('draws its variants with the colors of the tokens (light theme)', async ({ page }) => {
    const primary = await colors(cell(page, 'primary', '32', 'text'));
    expect(primary).toEqual({
      background: 'rgb(26, 86, 196)', // --k-accent
      color: 'rgb(255, 255, 255)', // --k-on-accent
      border: 'rgb(26, 86, 196)',
    });
    const secondary = await colors(cell(page, 'secondary', '32', 'text'));
    expect(secondary).toEqual({
      background: 'rgb(255, 255, 255)', // --k-surface
      color: 'rgb(26, 29, 33)', // --k-text
      border: 'rgb(125, 135, 148)', // --k-border-strong
    });
    const ghost = await colors(cell(page, 'ghost', '32', 'text'));
    expect(ghost.background).toBe('rgba(0, 0, 0, 0)');
    expect(ghost.border).toBe('rgba(0, 0, 0, 0)');
    expect(ghost.color).toBe('rgb(26, 29, 33)');
  });

  for (const theme of ['light', 'dark']) {
    test(`keeps its text readable at rest, under the pointer and pressed (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      for (const variant of VARIANTS) {
        const button = cell(page, variant, '32', 'text');
        const rest = await colors(button);
        expect(
          contrastBetween(
            rest.color,
            rest.background === 'rgba(0, 0, 0, 0)'
              ? theme === 'light'
                ? 'rgb(255, 255, 255)'
                : 'rgb(20, 23, 28)'
              : rest.background,
          ),
          `${variant} at rest`,
        ).toBeGreaterThanOrEqual(4.5);
        await button.hover();
        const hover = await colors(button);
        expect(hover.background, `${variant} hover changes the background`).not.toBe(
          rest.background,
        );
        expect(
          contrastBetween(hover.color, hover.background),
          `${variant} hover`,
        ).toBeGreaterThanOrEqual(4.5);
        await page.mouse.down();
        const pressed = await colors(button);
        expect(pressed.background, `${variant} pressed changes it again`).not.toBe(
          hover.background,
        );
        expect(
          contrastBetween(pressed.color, pressed.background),
          `${variant} pressed`,
        ).toBeGreaterThanOrEqual(4.5);
        await page.mouse.up();
        await page.mouse.move(0, 0);
      }
    });
  }

  test('shows the keyboard focus ring and not one for the mouse', async ({ page }) => {
    const first = cell(page, 'primary', '32', 'text');
    await page.keyboard.press('Tab');
    await expect(first.locator('button')).toBeFocused();
    const ring = await first.locator('button').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.outlineColor];
    });
    expect(ring).toEqual(['solid', '2px', '2px', 'rgb(26, 86, 196)']);
    await cell(page, 'secondary', '32', 'text').click();
    const afterClick = await cell(page, 'secondary', '32', 'text')
      .locator('button')
      .evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(afterClick).toBe('none');
  });

  test('is focused when the element is, and clicks, Enter and Space all press it once', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const button = document.createElement('k-button');
      button.id = 'pressed';
      button.textContent = 'Press';
      document.body.append(button);
      (window as unknown as { presses: number }).presses = 0;
      button.addEventListener('click', () => {
        (window as unknown as { presses: number }).presses += 1;
      });
    });
    const presses = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { presses: number }).presses);
    await page.locator('#pressed').evaluate((element) => {
      element.focus();
    });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('pressed');
    await expect(page.locator('#pressed button')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await presses()).toBe(1);
    await page.keyboard.press('Space');
    expect(await presses()).toBe(2);
    await page.locator('#pressed').click();
    expect(await presses()).toBe(3);
  });

  test('does nothing when disabled, is skipped by Tab, and looks disabled', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { presses: number }).presses = 0;
      document.addEventListener('click', () => {
        (window as unknown as { presses: number }).presses += 1;
      });
    });
    const disabled = cell(page, 'primary', '32', 'disabled');
    await expect(disabled.locator('button')).toBeDisabled();
    await disabled.click({ force: true });
    expect(await page.evaluate(() => (window as unknown as { presses: number }).presses)).toBe(0);
    const look = await colors(disabled);
    expect(look.color).toBe('rgb(85, 94, 107)'); // --k-text-muted
    expect(look.background).toBe('rgb(244, 245, 247)'); // --k-surface-raised
    const stops: string[] = [];
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const active = document.querySelector('karmania-gallery')?.shadowRoot?.activeElement;
          return active?.getAttribute('label') ?? active?.textContent.trim() ?? '';
        }),
      );
    }
    expect(stops.filter((stop) => stop.includes('disabled'))).toEqual([]);
  });

  test('has a name: its words, or its label for an icon alone', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: 'Close (primary, 32)', exact: true }),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Import', exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close, disabled (ghost, 28)', exact: true }),
    ).toBeDisabled();
  });

  test('throws, as a mistake in the page that uses it, when it has no name at all', async ({
    page,
  }) => {
    const outcome = await page.evaluate(async () => {
      const attempt = async (html: string): Promise<string> => {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        document.body.append(holder);
        const button = holder.querySelector('k-button');
        try {
          await button?.updateComplete;
          return 'fine';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      return {
        iconAlone: await attempt('<k-button icon="x"></k-button>'),
        nothing: await attempt('<k-button></k-button>'),
        spaces: await attempt('<k-button icon="x" label="  "> </k-button>'),
        words: await attempt('<k-button>Words</k-button>'),
        labelled: await attempt('<k-button icon="x" label="Close"></k-button>'),
      };
    });
    const mistake = /needs text or, for an icon alone, a label/;
    expect(outcome.iconAlone).toMatch(mistake);
    expect(outcome.nothing).toMatch(mistake);
    expect(outcome.spaces).toMatch(mistake);
    expect(outcome.words).toBe('fine');
    expect(outcome.labelled).toBe('fine');
  });

  test('can be pressed anywhere in its 32 by 32 pixels, even when it is the compact size', async ({
    page,
  }) => {
    const button = cell(page, 'ghost', '28', 'icon-only');
    await button.evaluate((element) => {
      (window as unknown as { presses: number }).presses = 0;
      element.addEventListener('click', () => {
        (window as unknown as { presses: number }).presses += 1;
      });
    });
    const box = await button.boundingBox();
    if (box === null) {
      throw new Error('no box');
    }
    expect([box.width, box.height]).toEqual([32, 32]);
    const presses = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { presses: number }).presses);
    let expected = 0;
    for (const [x, y] of [
      [1, 1],
      [box.width - 1, 1],
      [1, box.height - 1],
      [box.width - 1, box.height - 1],
    ] as const) {
      await page.mouse.click(box.x + x, box.y + y);
      expected += 1;
      expect(await presses()).toBe(expected);
    }
    // Just outside is not the button.
    await page.mouse.click(box.x - 2, box.y + box.height / 2);
    expect(await presses()).toBe(expected);
  });

  test('cuts a label that is too long with an ellipsis, and keeps the whole name', async ({
    page,
  }) => {
    const button = page.locator('[data-kind="truncated"] k-button');
    const box = await button.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(192);
    const text = button.locator('.text');
    const [overflowing, ellipsis] = await text.evaluate((element) => [
      element.scrollWidth > element.clientWidth,
      getComputedStyle(element).textOverflow,
    ]);
    expect(overflowing).toBe(true);
    expect(ellipsis).toBe('ellipsis');
    await expect(
      page.getByRole('button', { name: 'Import every file in this long list of drill hole data' }),
    ).toHaveCount(1);
  });

  test('does not animate for people who ask for less motion', async ({ page }) => {
    const duration = await cell(page, 'primary', '32', 'text')
      .locator('button')
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(duration.split(',').every((part) => part.trim() === '0s')).toBe(true);
  });

  for (const theme of ['light', 'dark']) {
    test(`has no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="buttons"]']);
    });
  }
});
