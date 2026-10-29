import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';

function tooltip(page: Page, id: string): Locator {
  return page.locator(`#${id}`);
}

function tip(page: Page, id: string): Locator {
  return page.locator(`#${id} .tip`);
}

/** Whether the tooltip is showing, and the box it is in. */
function shown(page: Page, id: string) {
  return tip(page, id).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      open: element.matches(':popover-open'),
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      placement: (element as HTMLElement).dataset['placement'],
    };
  });
}

async function isOpen(page: Page, id: string): Promise<boolean> {
  return (await shown(page, id)).open;
}

test.describe('the tooltip', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('shows over the control when the pointer is on it', async ({ page }) => {
    expect(await isOpen(page, 'tip-icon')).toBe(false);
    await tooltip(page, 'tip-icon').hover();
    const state = await shown(page, 'tip-icon');
    expect(state.open).toBe(true);
    expect(state.placement).toBe('top');
    await expect(tip(page, 'tip-icon')).toHaveText('Collapse panel');
  });

  test('is above the control, centred on it, a gap of 4 away, when the control is in the middle of the window', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const holder = document.createElement('div');
      holder.style.cssText = 'position: fixed; left: 500px; top: 300px;';
      holder.innerHTML =
        '<k-tooltip id="middle" text="Collapse panel"><k-button icon="x" label="Close"></k-button></k-tooltip>';
      document.body.append(holder);
      await document.querySelector<HTMLElementTagNameMap['k-tooltip']>('#middle')?.updateComplete;
    });
    await tooltip(page, 'middle').hover();
    const state = await shown(page, 'middle');
    const trigger = await tooltip(page, 'middle').locator('k-button').boundingBox();
    if (trigger === null) {
      throw new Error('no trigger');
    }
    expect(state.placement).toBe('top');
    expect(state.top + state.height + 4).toBeCloseTo(trigger.y, 0);
    expect(state.left + state.width / 2).toBeCloseTo(trigger.x + trigger.width / 2, 0);
  });

  test('is slid in, not centred, when the control is too near the edge for that', async ({
    page,
  }) => {
    await tooltip(page, 'tip-icon').hover();
    const state = await shown(page, 'tip-icon');
    expect(state.left).toBe(8);
  });

  test('goes when the pointer does', async ({ page }) => {
    await tooltip(page, 'tip-icon').hover();
    expect(await isOpen(page, 'tip-icon')).toBe(true);
    await page.mouse.move(0, 0);
    expect(await isOpen(page, 'tip-icon')).toBe(false);
  });

  test('shows for keyboard focus, and goes when focus does', async ({ page }) => {
    await page.keyboard.press('Shift');
    await tooltip(page, 'tip-icon').locator('button').focus();
    expect(await isOpen(page, 'tip-icon')).toBe(true);
    await tooltip(page, 'tip-describes').locator('button').focus();
    expect(await isOpen(page, 'tip-icon')).toBe(false);
    expect(await isOpen(page, 'tip-describes')).toBe(true);
  });

  test('is not kept showing by the focus a click leaves behind', async ({ page }) => {
    await tooltip(page, 'tip-icon').click();
    await page.mouse.move(0, 0);
    await expect(tooltip(page, 'tip-icon').locator('button')).toBeFocused();
    expect(await isOpen(page, 'tip-icon')).toBe(false);
  });

  test('is put away by Escape, and comes back when the pointer returns', async ({ page }) => {
    await tooltip(page, 'tip-icon').hover();
    expect(await isOpen(page, 'tip-icon')).toBe(true);
    await page.keyboard.press('Escape');
    expect(await isOpen(page, 'tip-icon')).toBe(false);
    await page.mouse.move(1, 1);
    await tooltip(page, 'tip-icon').hover();
    expect(await isOpen(page, 'tip-icon')).toBe(true);
  });

  test('stays when the pointer moves from the control onto the tooltip itself', async ({
    page,
  }) => {
    await tooltip(page, 'tip-icon').hover();
    const state = await shown(page, 'tip-icon');
    await page.mouse.move(state.left + state.width / 2, state.top + state.height / 2, { steps: 4 });
    expect(await isOpen(page, 'tip-icon')).toBe(true);
  });

  test('prefers the side it is asked to, and flips when there is no room there', async ({
    page,
  }) => {
    await tooltip(page, 'tip-below').hover();
    expect((await shown(page, 'tip-below')).placement).toBe('bottom');
    const flipped = await page.evaluate(async () => {
      const holder = document.createElement('div');
      holder.style.cssText = 'position: fixed; left: 400px; top: 2px;';
      holder.innerHTML =
        '<k-tooltip id="at-top" text="Near the top"><k-button icon="x" label="Close"></k-button></k-tooltip>';
      document.body.append(holder);
      await document.querySelector<HTMLElementTagNameMap['k-tooltip']>('#at-top')?.updateComplete;
      return true;
    });
    expect(flipped).toBe(true);
    await tooltip(page, 'at-top').hover();
    expect((await shown(page, 'at-top')).placement).toBe('bottom');
  });

  test('sits beside the control when asked to: a gap of 4 away, centred on it from top to bottom', async ({
    page,
  }) => {
    await tooltip(page, 'tip-left').hover();
    const state = await shown(page, 'tip-left');
    const trigger = await tooltip(page, 'tip-left').locator('k-button').boundingBox();
    if (trigger === null) {
      throw new Error('no trigger');
    }
    expect(state.placement).toBe('left');
    expect(state.left + state.width + 4).toBeCloseTo(trigger.x, 0);
    expect(state.top + state.height / 2).toBeCloseTo(trigger.y + trigger.height / 2, 0);
  });

  test('goes to the other side of the control when there is no room beside it, and stays inside the window', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const place = async (id: string, style: string, side: string) => {
        const holder = document.createElement('div');
        holder.style.cssText = `position: fixed; ${style}`;
        holder.innerHTML = `<k-tooltip id="${id}" text="Beside the control" placement="${side}"><k-button icon="x" label="Close"></k-button></k-tooltip>`;
        document.body.append(holder);
        await document.querySelector<HTMLElementTagNameMap['k-tooltip']>(`#${id}`)?.updateComplete;
      };
      await place('near-left', 'left: 10px; top: 300px;', 'left');
      await place('near-right', 'right: 10px; top: 300px;', 'right');
      await place('near-top', 'left: 500px; top: 0;', 'left');
    });
    await tooltip(page, 'near-left').hover();
    expect((await shown(page, 'near-left')).placement).toBe('right');
    await tooltip(page, 'near-right').hover();
    expect((await shown(page, 'near-right')).placement).toBe('left');
    // At the top edge it is slid down to be whole, and is still beside the control.
    await tooltip(page, 'near-top').hover();
    const slid = await shown(page, 'near-top');
    expect(slid.placement).toBe('left');
    expect(slid.top).toBeGreaterThanOrEqual(8);
  });

  for (const [name, style] of [
    ['top left corner', 'left: 0; top: 0;'],
    ['top right corner', 'right: 0; top: 0;'],
    ['bottom left corner', 'left: 0; bottom: 0;'],
    ['bottom right corner', 'right: 0; bottom: 0;'],
    ['middle of the right edge', 'right: 0; top: 50%;'],
  ] as const) {
    for (const size of [
      { width: 1024, height: 640 },
      { width: 1920, height: 1080 },
    ]) {
      test(`stays inside the window at the ${name} (${String(size.width)}x${String(size.height)})`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await page.evaluate(async (css) => {
          const holder = document.createElement('div');
          holder.style.cssText = `position: fixed; ${css}`;
          holder.innerHTML =
            '<k-tooltip id="edge" text="A tooltip with a fair bit to say about this control, so it is wide"><k-button icon="x" label="Close"></k-button></k-tooltip>';
          document.body.append(holder);
          await document.querySelector<HTMLElementTagNameMap['k-tooltip']>('#edge')?.updateComplete;
        }, style);
        await tooltip(page, 'edge').hover();
        const state = await shown(page, 'edge');
        expect(state.open).toBe(true);
        expect(state.left).toBeGreaterThanOrEqual(8);
        expect(state.top).toBeGreaterThanOrEqual(8);
        expect(state.left + state.width).toBeLessThanOrEqual(size.width - 8);
        expect(state.top + state.height).toBeLessThanOrEqual(size.height - 8);
      });
    }
  }

  test('is not cut off by a container that hides its overflow and has a transform', async ({
    page,
  }) => {
    await tooltip(page, 'tip-clipped').scrollIntoViewIfNeeded();
    await tooltip(page, 'tip-clipped').hover();
    const state = await shown(page, 'tip-clipped');
    const box = await page.locator('#clipping-box').boundingBox();
    if (box === null) {
      throw new Error('no box');
    }
    expect(state.open).toBe(true);
    // It sticks out of the box that would clip anything else.
    expect(state.width).toBeGreaterThan(box.width);
    expect(state.left + state.width).toBeGreaterThan(box.x + box.width);
    // And what is at its centre is the tooltip, not whatever is underneath.
    // (Asked of the gallery's own shadow root: the document would name the gallery itself.)
    const hit = await page.evaluate(
      ([x, y]) =>
        document
          .querySelector('karmania-gallery')
          ?.shadowRoot?.elementsFromPoint(x, y)
          .map((element) => element.id),
      [state.left + state.width - 4, state.top + state.height / 2] as const,
    );
    expect(hit?.[0]).toBe('tip-clipped');
  });

  test('wraps a long text, and is never wider than 240 pixels', async ({ page }) => {
    await tooltip(page, 'tip-long').hover();
    const state = await shown(page, 'tip-long');
    expect(state.width).toBeLessThanOrEqual(240);
    expect(state.height).toBeGreaterThan(40);
  });

  test('tells the control what it says, when that is more than the control is called', async ({
    page,
  }) => {
    const description = (id: string) =>
      tooltip(page, id).locator('k-button').getAttribute('aria-description');
    expect(await description('tip-describes')).toBe('Opens the import wizard');
    // The same as the control's own name: nothing to add.
    expect(await description('tip-icon')).toBeNull();
    await tooltip(page, 'tip-icon').evaluate((element) => {
      element.setAttribute('text', 'Hide the side panel');
    });
    await expect.poll(() => description('tip-icon')).toBe('Hide the side panel');
    await tooltip(page, 'tip-icon').evaluate((element) => {
      element.setAttribute('text', 'Collapse panel');
    });
    await expect.poll(() => description('tip-icon')).toBeNull();
    await expect(tip(page, 'tip-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  test('shows nothing when it has no text', async ({ page }) => {
    await tooltip(page, 'tip-icon').evaluate((element) => {
      element.setAttribute('text', '');
    });
    await tooltip(page, 'tip-icon').hover();
    expect(await isOpen(page, 'tip-icon')).toBe(false);
  });

  test('does not fade for people who ask for less motion', async ({ page }) => {
    const duration = await tip(page, 'tip-icon').evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    );
    expect(duration).toBe('0s');
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await tooltip(page, 'tip-icon').hover();
      const colors = await tip(page, 'tip-icon').evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      });
      expect(contrastBetween(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
    });

    test(`has no serious accessibility violations, open or not (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="tooltips"]']);
      await tooltip(page, 'tip-describes').hover();
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="tooltips"]']);
    });
  }
});
