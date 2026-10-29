import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';
import { assertAligned, assertNoOverflow } from './support/layout.js';

const IDS = ['file', 'mapping', 'nodata', 'crs', 'review'];

const demo = (page: Page, id: string): Locator => page.locator(`#${id}`);
const items = (box: Locator): Locator => box.locator('li');

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** What a step looks like, apart from its colours: the glyph in its marker, and its label's weight. */
function lookOf(step: Locator) {
  return step.evaluate((item) => {
    const marker = item.shadowRoot?.querySelector('.marker') ?? item.querySelector('.marker');
    const name = item.querySelector('.name');
    return {
      state: item.getAttribute('data-state'),
      current: item.getAttribute('aria-current'),
      markerText: marker?.textContent.trim() ?? '',
      hasTick: marker?.querySelector('k-icon') !== null,
      weight: name === null ? '' : getComputedStyle(name).fontWeight,
      filled: marker === null ? '' : getComputedStyle(marker).backgroundColor,
    };
  });
}

test.describe('the steps', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('are a list with a name: five steps, numbered and labelled in order', async ({ page }) => {
    const box = demo(page, 'steps-first');
    await expect(box.getByRole('list', { name: 'Import steps' })).toBeVisible();
    await expect(items(box)).toHaveCount(5);
    await expect(items(box).locator('.name')).toHaveText([
      'File',
      'Mapping',
      'Nodata',
      'CRS',
      'Review',
    ]);
    const ids = await items(box).evaluateAll((all) => all.map((item) => item.dataset['step']));
    expect(ids).toEqual(IDS);
  });

  test('mark the current step, the ones before it as done and the rest as to do', async ({
    page,
  }) => {
    const box = demo(page, 'steps-middle');
    const states = await items(box).evaluateAll((all) => all.map((item) => item.dataset['state']));
    expect(states).toEqual(['done', 'done', 'current', 'pending', 'pending']);
    const current = await items(box).evaluateAll((all) =>
      all.map((item) => item.getAttribute('aria-current')),
    );
    expect(current).toEqual([null, null, 'step', null, null]);
  });

  test('tell done, current and to do apart by more than their colour', async ({ page }) => {
    const box = demo(page, 'steps-middle');
    const [done, current, pending] = [
      await lookOf(items(box).nth(0)),
      await lookOf(items(box).nth(2)),
      await lookOf(items(box).nth(3)),
    ];
    // A tick, or a number.
    expect(done.hasTick).toBe(true);
    expect(done.markerText).toBe('');
    expect([current.markerText, pending.markerText]).toEqual(['3', '4']);
    expect([current.hasTick, pending.hasTick]).toEqual([false, false]);
    // Only the current step is bold, and only its circle is filled.
    expect([done.weight, current.weight, pending.weight]).toEqual(['400', '500', '400']);
    expect(current.filled).not.toBe('rgba(0, 0, 0, 0)');
    expect([done.filled, pending.filled]).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
  });

  test('say done and to do in words to those who cannot see, and current with aria-current', async ({
    page,
  }) => {
    const box = demo(page, 'steps-middle');
    await expect(box.getByRole('list', { name: 'Import steps' })).toMatchAriaSnapshot(`
      - list "Import steps":
        - listitem: /File\\s*, done/
        - listitem: /Mapping\\s*, done/
        - listitem: Nodata
        - listitem: /CRS\\s*, to do/
        - listitem: /Review\\s*, to do/
    `);
    await expect(items(box).nth(2)).toHaveAttribute('aria-current', 'step');
  });

  test('have circles of 24, with the labels beside them, in a row of that height', async ({
    page,
  }) => {
    const box = demo(page, 'steps-middle');
    const markers = box.locator('.marker');
    for (let index = 0; index < 5; index += 1) {
      const marker = await rect(markers.nth(index));
      expect([marker.width, marker.height]).toEqual([24, 24]);
      // 8 between a circle and its label.
      const name = await rect(items(box).nth(index).locator('.name'));
      expect(name.x - (marker.x + marker.width)).toBe(8);
    }
    expect((await rect(box.locator('ol'))).height).toBe(24);
    await assertAligned(
      [markers.nth(0), markers.nth(1), markers.nth(2), markers.nth(3), markers.nth(4)],
      'vertical-centre',
    );
    await assertAligned([markers.nth(0), items(box).nth(0).locator('.name')], 'vertical-centre');
  });

  test('are spread over the whole width, the first at the left edge and the last at the right', async ({
    page,
  }) => {
    const box = demo(page, 'steps-first');
    const outer = await rect(box);
    const first = await rect(items(box).first());
    const last = await rect(items(box).last());
    expect(first.x).toBe(outer.x);
    expect(last.x + last.width).toBeCloseTo(outer.x + outer.width, 0);
    // In order, left to right, without overlapping.
    let end = outer.x;
    for (let index = 0; index < 5; index += 1) {
      const step = await rect(items(box).nth(index));
      expect(step.x).toBeGreaterThanOrEqual(end - 0.5);
      end = step.x + step.width;
    }
  });

  test('cut a label that has too little room, with an ellipsis, and nothing overflows', async ({
    page,
  }) => {
    const box = demo(page, 'steps-crowded');
    const names = await box.locator('.name').evaluateAll((all) =>
      all.map((name) => ({
        cut: name.scrollWidth > name.clientWidth,
        overflow: getComputedStyle(name).textOverflow,
      })),
    );
    expect(names.some((name) => name.cut)).toBe(true);
    expect(names.every((name) => name.overflow === 'ellipsis')).toBe(true);
    await assertNoOverflow(box, { window: 'horizontal' });
    const outer = await rect(box);
    const last = await rect(items(box).last());
    expect(last.x + last.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
  });

  test('take no focus: a row to read, not to press', async ({ page }) => {
    const box = demo(page, 'steps-first');
    const focusable = await box.evaluate((element) => {
      const root = element.querySelector('k-steps')?.shadowRoot;
      return root?.querySelectorAll('a, button, [tabindex]').length ?? -1;
    });
    expect(focusable).toBe(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`are readable and have no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      const box = demo(page, 'steps-middle');
      const colours = await box.evaluate((element) => {
        const root = element.querySelector('k-steps')?.shadowRoot;
        // The page's background, as the browser writes a colour it has worked out.
        const probe = document.createElement('div');
        probe.style.color = 'var(--k-surface)';
        document.body.append(probe);
        const surface = getComputedStyle(probe).color;
        probe.remove();
        const colour = (selector: string, property: 'color' | 'backgroundColor') => {
          const found = root?.querySelector(selector);
          return found === null || found === undefined ? '' : getComputedStyle(found)[property];
        };
        return {
          page: surface,
          currentMarker: colour('li[data-state="current"] .marker', 'color'),
          currentFill: colour('li[data-state="current"] .marker', 'backgroundColor'),
          pendingNumber: colour('li[data-state="pending"] .marker', 'color'),
          pendingName: colour('li[data-state="pending"] .name', 'color'),
          doneName: colour('li[data-state="done"] .name', 'color'),
          doneTick: colour('li[data-state="done"] .marker', 'color'),
        };
      });
      // The number on the filled circle, and the words and numbers on the page.
      expect(contrastBetween(colours.currentMarker, colours.currentFill)).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const text of [colours.pendingNumber, colours.pendingName, colours.doneName]) {
        expect(contrastBetween(text, colours.page)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastBetween(colours.doneTick, colours.page)).toBeGreaterThanOrEqual(4.5);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="steps"]']);
    });
  }
});
