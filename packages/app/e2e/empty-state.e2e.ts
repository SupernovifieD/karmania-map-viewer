import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';
import { assertAligned, assertNoOverflow } from './support/layout.js';

function demo(page: Page, id: string): Locator {
  return page.locator(`#${id}`);
}

/** The parts of an empty state, as boxes. */
function parts(box: Locator) {
  return {
    host: box.locator('k-empty-state'),
    group: box.locator('.group'),
    icon: box.locator('k-icon.icon'),
    heading: box.locator('.heading'),
    message: box.locator('.message'),
    action: box.locator('.action'),
    button: box.locator('k-button'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

test.describe('the empty state', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('sets an icon of 32 pixels, a heading of 16/24, and a line of 14/20, muted', async ({
    page,
  }) => {
    const p = parts(demo(page, 'empty-full'));
    const icon = await rect(p.icon);
    expect([icon.width, icon.height]).toEqual([32, 32]);
    const heading = await p.heading.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.lineHeight, style.fontWeight, style.color];
    });
    expect(heading).toEqual(['16px', '24px', '500', 'rgb(26, 29, 33)']);
    const message = await p.message.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.lineHeight, style.fontWeight, style.color];
    });
    expect(message).toEqual(['14px', '20px', '400', 'rgb(85, 94, 107)']);
    const iconColor = await p.icon.evaluate((element) => getComputedStyle(element).color);
    expect(iconColor).toBe('rgb(85, 94, 107)');
  });

  test('puts 8 pixels between its parts, and 16 before the action', async ({ page }) => {
    const p = parts(demo(page, 'empty-full'));
    const [icon, heading, message, button] = [
      await rect(p.icon),
      await rect(p.heading),
      await rect(p.message),
      await rect(p.button),
    ];
    expect(heading.y - (icon.y + icon.height)).toBe(8);
    expect(message.y - (heading.y + heading.height)).toBe(8);
    expect(button.y - (message.y + message.height)).toBe(16);
  });

  test('puts every part on the same centre line', async ({ page }) => {
    const p = parts(demo(page, 'empty-full'));
    await assertAligned([p.icon, p.heading, p.message, p.button], 'horizontal-centre');
  });

  // (Not the one with long text in little room: that scrolls from the top instead, see below.)
  for (const id of ['empty-full', 'empty-message']) {
    test(`is centred in its space, both ways (${id})`, async ({ page }) => {
      const box = demo(page, id);
      const container = await rect(box);
      const group = await rect(parts(box).group);
      expect(group.x + group.width / 2).toBeCloseTo(container.x + container.width / 2, 0);
      expect(group.y + group.height / 2).toBeCloseTo(container.y + container.height / 2, 0);
    });
  }

  test('is centred in a space of any size', async ({ page }) => {
    for (const [width, height] of [
      [260, 220],
      [500, 300],
      [900, 600],
    ] as const) {
      await page.evaluate(
        ([w, h]) => {
          const box = document
            .querySelector('karmania-gallery')
            ?.shadowRoot?.querySelector<HTMLElement>('#empty-full');
          if (box) {
            box.style.width = `${String(w)}px`;
            box.style.height = `${String(h)}px`;
          }
        },
        [width, height] as const,
      );
      const box = demo(page, 'empty-full');
      const container = await rect(box);
      const group = await rect(parts(box).group);
      expect(group.x + group.width / 2, `${String(width)}x${String(height)}`).toBeCloseTo(
        container.x + container.width / 2,
        0,
      );
      expect(group.y + group.height / 2).toBeCloseTo(container.y + container.height / 2, 0);
    }
  });

  test('keeps its text in a column no wider than 288 pixels, however much room there is', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const box = document
        .querySelector('karmania-gallery')
        ?.shadowRoot?.querySelector<HTMLElement>('#empty-message');
      if (box) {
        box.style.width = '900px';
        box.style.height = '200px';
      }
    });
    const group = await rect(parts(demo(page, 'empty-message')).group);
    expect(group.width).toBeLessThanOrEqual(288);
  });

  test('wraps a long heading and an unbroken word instead of overflowing, in little room', async ({
    page,
  }) => {
    const box = demo(page, 'empty-small');
    const [container, group] = [await rect(box), await rect(parts(box).group)];
    expect(group.width).toBeLessThanOrEqual(container.width);
    const heading = await rect(parts(box).heading);
    expect(heading.height).toBeGreaterThan(24);
    await assertNoOverflow(box, { window: 'horizontal' });
  });

  test('scrolls, from the top, when even wrapped text does not fit', async ({ page }) => {
    await page.evaluate(() => {
      const box = document
        .querySelector('karmania-gallery')
        ?.shadowRoot?.querySelector<HTMLElement>('#empty-small');
      if (box) {
        box.style.width = '160px';
        box.style.height = '60px';
      }
    });
    const host = parts(demo(page, 'empty-small')).host;
    const state = await host.evaluate((element) => {
      const group = element.shadowRoot?.querySelector('.group');
      const top = element.getBoundingClientRect().top;
      const before = group?.getBoundingClientRect().top ?? Number.NaN;
      element.scrollTop = element.scrollHeight;
      const message = element.shadowRoot?.querySelector('.message')?.getBoundingClientRect();
      return {
        scrolls: element.scrollHeight > element.clientHeight,
        startsAtTop: before >= top,
        lastLineReachable:
          (message?.bottom ?? Number.NaN) <= element.getBoundingClientRect().bottom,
      };
    });
    expect(state).toEqual({ scrolls: true, startsAtTop: true, lastLineReachable: true });
    await assertNoOverflow(demo(page, 'empty-small'), { window: 'horizontal' });
  });

  test('has no gap for an action or a line that is not there', async ({ page }) => {
    const message = parts(demo(page, 'empty-message'));
    const [group, line] = [await rect(message.group), await rect(message.message)];
    expect(group.height).toBe(line.height);
    await expect(message.action).toBeHidden();
    const full = parts(demo(page, 'empty-full'));
    const [fullGroup, icon, heading, text, button] = [
      await rect(full.group),
      await rect(full.icon),
      await rect(full.heading),
      await rect(full.message),
      await rect(full.button),
    ];
    expect(fullGroup.height).toBe(
      icon.height + heading.height + text.height + button.height + 8 + 8 + 16,
    );
  });

  test('shows an action, a heading and an icon when they are added later, and drops them when removed', async ({
    page,
  }) => {
    const state = await page.evaluate(async () => {
      const empty = document.createElement('k-empty-state');
      empty.textContent = 'Nothing here';
      document.body.append(empty);
      await empty.updateComplete;
      const action = () => empty.shadowRoot?.querySelector<HTMLElement>('.action')?.hidden;
      const before = [action(), empty.shadowRoot?.querySelectorAll('k-icon, .heading').length];
      const button = document.createElement('k-button');
      button.slot = 'action';
      button.textContent = 'Add';
      empty.append(button);
      empty.heading = 'Empty';
      empty.icon = 'map';
      await empty.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await empty.updateComplete;
      const during = [action(), empty.shadowRoot?.querySelectorAll('k-icon, .heading').length];
      button.remove();
      await empty.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await empty.updateComplete;
      return { before, during, after: action() };
    });
    expect(state.before).toEqual([true, 0]);
    expect(state.during).toEqual([false, 2]);
    expect(state.after).toBe(true);
  });

  test('draws nothing, and does no harm, when it has nothing to show', async ({ page }) => {
    const size = await page.evaluate(async () => {
      const empty = document.createElement('k-empty-state');
      empty.style.cssText = 'width: 200px; height: 100px';
      document.body.append(empty);
      await empty.updateComplete;
      const group = empty.shadowRoot?.querySelector('.group')?.getBoundingClientRect();
      return [group?.width, group?.height];
    });
    expect(size).toEqual([0, 0]);
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable on the map surface (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      const box = demo(page, 'empty-full');
      const background = await box.evaluate((element) => getComputedStyle(element).backgroundColor);
      const p = parts(box);
      for (const text of [p.heading, p.message]) {
        const color = await text.evaluate((element) => getComputedStyle(element).color);
        expect(contrastBetween(color, background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`has no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="empty-state"]']);
    });
  }

  test('hides its icon from assistive technology', async ({ page }) => {
    await expect(parts(demo(page, 'empty-full')).icon.locator('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
