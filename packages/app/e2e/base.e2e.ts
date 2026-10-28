import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The width of some text set in the given style, in the page. */
function widthOf(page: Page, text: string, style: string): Promise<number> {
  return page.evaluate(
    ([content, css]) => {
      const span = document.createElement('span');
      span.style.cssText = `position: absolute; white-space: nowrap; ${css}`;
      span.textContent = content;
      document.body.append(span);
      const width = span.getBoundingClientRect().width;
      span.remove();
      return width;
    },
    [text, style] as const,
  );
}

test.describe('the base styles', () => {
  test('serve Inter from the page itself, and fetch nothing from anywhere else', async ({
    page,
  }) => {
    const origins = new Set<string>();
    page.on('request', (request) => origins.add(new URL(request.url()).origin));
    await page.goto('/gallery.html');
    await page.evaluate(() => document.fonts.load('14px Inter', 'Karmania'));
    await page.evaluate(() => document.fonts.load('14px Inter', 'Łódź'));
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    );
    expect(loaded.filter((family) => family.replaceAll('"', '') === 'Inter')).toHaveLength(2);
    expect([...origins]).toEqual(['http://localhost:4174']);
  });

  test('set the page in Inter, in the body size, in the theme colors', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/gallery.html');
    const style = await page.evaluate(() => {
      const computed = getComputedStyle(document.documentElement);
      return {
        family: computed.fontFamily,
        size: computed.fontSize,
        line: computed.lineHeight,
        weight: computed.fontWeight,
        background: computed.backgroundColor,
        color: computed.color,
        margin: getComputedStyle(document.body).margin,
      };
    });
    expect(style.family).toMatch(/^Inter, /);
    expect([style.size, style.line, style.weight]).toEqual(['14px', '20px', '400']);
    expect(style.background).toBe('rgb(20, 23, 28)'); // --k-surface, dark
    expect(style.color).toBe('rgb(230, 233, 238)'); // --k-text, dark
    expect(style.margin).toBe('0px');
  });

  test('make digits the same width, which is what lines columns of numbers up', async ({
    page,
  }) => {
    await page.goto('/gallery.html');
    await page.evaluate(() => document.fonts.load('14px Inter', '0123456789'));
    const inherited = 'font-family: Inter';
    // The page's own setting: every digit is as wide as every other.
    expect(await widthOf(page, '1111111', inherited)).toBeCloseTo(
      await widthOf(page, '0000000', inherited),
      3,
    );
    // Without it the digits differ, so the equality above is the font feature at work.
    const proportional = `${inherited}; font-variant-numeric: proportional-nums`;
    expect(await widthOf(page, '1111111', proportional)).toBeLessThan(
      (await widthOf(page, '0000000', proportional)) - 1,
    );
  });

  test('get the regular and the medium weight from the one variable file', async ({ page }) => {
    await page.goto('/gallery.html');
    await page.evaluate(() => document.fonts.load('500 14px Inter', 'Karmania'));
    const regular = await widthOf(page, 'Karmania map data', 'font-weight: 400');
    const medium = await widthOf(page, 'Karmania map data', 'font-weight: 500');
    expect(medium).toBeGreaterThan(regular);
  });

  test('size boxes by their border, in the page and inside a component', async ({ page }) => {
    await page.goto('/gallery.html');
    const sizing = await page.evaluate(() => {
      const inPage = document.createElement('div');
      document.body.append(inPage);
      const inside = document.createElement('div');
      document.querySelector('karmania-gallery')?.shadowRoot?.append(inside);
      return [getComputedStyle(inPage).boxSizing, getComputedStyle(inside).boxSizing];
    });
    expect(sizing).toEqual(['border-box', 'border-box']);
  });

  test('draw a focus ring on keyboard focus, in the page and inside a component', async ({
    page,
  }) => {
    await page.goto('/gallery.html');
    await page.evaluate(() => {
      const inPage = document.createElement('button');
      inPage.id = 'in-page';
      inPage.textContent = 'In the page';
      document.body.append(inPage);
      const inside = document.createElement('button');
      inside.id = 'inside';
      inside.textContent = 'Inside';
      document.querySelector('karmania-gallery')?.shadowRoot?.append(inside);
    });
    const ring = (selector: string): Promise<string[]> =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.outlineColor];
      });
    // --k-accent in the light theme, the system default here.
    const expected = ['solid', '2px', '2px', 'rgb(26, 86, 196)'];
    // Focus comes by the keyboard: a key is pressed, then the control is focused.
    await page.keyboard.press('Shift');
    await page.locator('karmania-gallery #inside').focus();
    await expect(page.locator('karmania-gallery #inside')).toBeFocused();
    expect(await ring('karmania-gallery #inside')).toEqual(expected);
    await page.locator('#in-page').focus();
    await expect(page.locator('#in-page')).toBeFocused();
    expect(await ring('#in-page')).toEqual(expected);
  });

  test('do not draw the focus ring for a mouse click', async ({ page }) => {
    await page.goto('/gallery.html');
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'clicked';
      button.textContent = 'Click me';
      document.body.append(button);
    });
    await page.locator('#clicked').click();
    const style = await page
      .locator('#clicked')
      .evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(style).toBe('none');
  });

  test('make controls follow the page font, not the system one', async ({ page }) => {
    await page.goto('/gallery.html');
    const family = await page.evaluate(() => {
      const button = document.createElement('button');
      document.body.append(button);
      return getComputedStyle(button).fontFamily;
    });
    expect(family).toMatch(/^Inter, /);
  });

  test('keep scrollbars thin and in the theme colors', async ({ page }) => {
    await page.goto('/gallery.html');
    const scrollbar = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [style.scrollbarWidth, style.scrollbarColor];
    });
    expect(scrollbar[0]).toBe('thin');
    expect(scrollbar[1]).toMatch(/^rgb\(125, 135, 148\)/); // --k-border-strong, light
  });
});
