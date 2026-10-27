import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * What the browser makes of a token: the token is put on a probe element as the value of
 * `property`, and the computed value is read back. That way the test does not depend on
 * how the build wrote the CSS (the production build shortens `#ffffff` to `#fff`).
 */
function resolved(
  page: Page,
  property: 'color' | 'transitionDuration',
  token: string,
): Promise<string> {
  return page.evaluate(
    ([cssProperty, name]) => {
      const probe = document.createElement('div');
      probe.style.setProperty(cssProperty, `var(${name})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(cssProperty);
      probe.remove();
      return value;
    },
    [property === 'color' ? 'color' : 'transition-duration', token] as const,
  );
}

/** The `rgb()` text for a `#rrggbb` color, which is how a computed color reads. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

const LIGHT = { surface: '#ffffff', text: '#1a1d21' };
const DARK = { surface: '#14171c', text: '#e6e9ee' };

test.describe('the color tokens in a browser', () => {
  for (const [system, systemColors] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    test(`follow the system when it prefers ${system}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: system });
      await page.goto('/gallery.html');
      expect(await resolved(page, 'color', '--k-surface')).toBe(rgb(systemColors.surface));
      expect(await resolved(page, 'color', '--k-text')).toBe(rgb(systemColors.text));
    });
  }

  for (const [system, forced, forcedColors] of [
    ['dark', 'light', LIGHT],
    ['light', 'dark', DARK],
  ] as const) {
    test(`can be forced to ${forced} when the system prefers ${system}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: system });
      await page.goto('/gallery.html');
      await page.evaluate((theme) => {
        document.documentElement.dataset['theme'] = theme;
      }, forced);
      expect(await resolved(page, 'color', '--k-surface')).toBe(rgb(forcedColors.surface));
      expect(await resolved(page, 'color', '--k-text')).toBe(rgb(forcedColors.text));
    });
  }

  test('tell the browser which color scheme the page is in, so its own controls match', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/gallery.html');
    const scheme = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    expect(await scheme()).toBe('light dark');
    await page.evaluate(() => {
      document.documentElement.dataset['theme'] = 'light';
    });
    expect(await scheme()).toBe('light');
  });
});

test.describe('the motion tokens in a browser', () => {
  test('are 150ms, and 0ms when the user asks for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/gallery.html');
    expect(await resolved(page, 'transitionDuration', '--k-motion-duration')).toBe('0.15s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await resolved(page, 'transitionDuration', '--k-motion-duration')).toBe('0s');
  });
});
