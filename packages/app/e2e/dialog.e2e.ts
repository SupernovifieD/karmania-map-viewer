import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';

/** The parts of the dialog in the demo `id`. */
function parts(page: Page, id: string) {
  const demo = page.locator(`#${id}`);
  return {
    trigger: demo.locator(':scope > k-button'),
    host: demo.locator('k-dialog'),
    dialog: demo.locator('dialog'),
    header: demo.locator('dialog header'),
    title: demo.locator('dialog h2'),
    close: demo.locator('dialog header k-button'),
    steps: demo.locator('dialog .steps'),
    body: demo.locator('dialog .body'),
    footer: demo.locator('dialog footer'),
    start: demo.locator('k-button[slot="footer-start"]'),
    end: demo.locator('k-button[slot="footer-end"]'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Opens the dialog of a demo with the keyboard, as a person using one would. */
async function openByKeyboard(page: Page, id: string): Promise<void> {
  const { trigger, dialog } = parts(page, id);
  await page.keyboard.press('Shift');
  await trigger.locator('button').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
}

/** Counts the `k-dialog-close` events the dialog of a demo sends. */
function countCloses(page: Page, id: string): Promise<void> {
  return page.locator(`#${id} k-dialog`).evaluate((element) => {
    const holder = window as unknown as { closes: number };
    holder.closes = 0;
    element.addEventListener('k-dialog-close', () => {
      holder.closes += 1;
    });
  });
}

/**
 * How many times the dialog has said it was closed. A dialog is hidden before the browser sends its
 * `close` event, so a moment is left for that to be heard first.
 */
const closes = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        setTimeout(() => {
          resolve((window as unknown as { closes: number }).closes);
        }, 50);
      }),
  );

test.describe('the dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is closed until opened, and then is a modal dialog with a name', async ({ page }) => {
    const p = parts(page, 'dialog-short');
    await expect(p.dialog).toBeHidden();
    await p.trigger.click();
    await expect(p.dialog).toBeVisible();
    expect(
      await p.dialog.evaluate((element) => (element as HTMLDialogElement).matches(':modal')),
    ).toBe(true);
    await expect(p.dialog).toHaveAccessibleName('Import data');
  });

  test('is 720 wide, centred in the window, with the header and footer bands of the specification', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-short');
    await p.trigger.click();
    const view = page.viewportSize();
    const dialog = await rect(p.dialog);
    expect(dialog.width).toBe(720);
    expect(dialog.x + dialog.width / 2).toBeCloseTo((view?.width ?? 0) / 2, 0);
    expect(dialog.y + dialog.height / 2).toBeCloseTo((view?.height ?? 0) / 2, 0);

    const header = await rect(p.header);
    expect(header.height).toBe(56);
    const title = await p.title.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.lineHeight, style.fontWeight];
    });
    expect(title).toEqual(['20px', '28px', '500']);
    // The title starts 24 in from the dialog's inner edge; the close button ends 24 short of it.
    const inner = { left: dialog.x + 1, right: dialog.x + dialog.width - 1 };
    expect((await rect(p.title)).x - inner.left).toBe(24);
    const close = await rect(p.close);
    expect(inner.right - (close.x + close.width)).toBe(24);
    expect(close.y + close.height / 2).toBeCloseTo(header.y + header.height / 2, 0);

    const footer = await rect(p.footer);
    expect(footer.height).toBe(64);
    expect(await p.footer.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
      '1px',
    );
  });

  test('has no steps band without steps, and a band with 16 below them with', async ({ page }) => {
    const short = parts(page, 'dialog-short');
    await short.trigger.click();
    expect(await short.steps.evaluate((element) => getComputedStyle(element).display)).toBe('none');
    const header = await rect(short.header);
    const body = await rect(short.body);
    expect(body.y).toBeCloseTo(header.y + header.height, 0);
    await page.keyboard.press('Escape');

    const long = parts(page, 'dialog-long');
    await long.trigger.click();
    const steps = await rect(long.steps);
    const longHeader = await rect(long.header);
    const longBody = await rect(long.body);
    expect(steps.y).toBeCloseTo(longHeader.y + longHeader.height, 0);
    expect(steps.height).toBe(20 + 16);
    expect(longBody.y).toBeCloseTo(steps.y + steps.height, 0);
    expect(
      await long.steps.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.paddingLeft, style.paddingRight, style.paddingBottom];
      }),
    ).toEqual(['24px', '24px', '16px']);
  });

  test('puts the body 24 in from the edges, and Cancel left with Back and Next right', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-short');
    await p.trigger.click();
    expect(
      await p.body.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
      }),
    ).toEqual(['24px', '24px', '24px', '24px']);

    const dialog = await rect(p.dialog);
    const footer = await rect(p.footer);
    const cancel = await rect(p.start);
    expect(cancel.x - (dialog.x + 1)).toBe(24);
    const [back, next] = await Promise.all([rect(p.end.nth(0)), rect(p.end.nth(1))]);
    expect(dialog.x + dialog.width - 1 - (next.x + next.width)).toBe(24);
    expect(next.x - (back.x + back.width)).toBe(8);
    expect(back.x).toBeGreaterThan(cancel.x + cancel.width);
    // Controls in the footer share a height and are centred in it.
    for (const box of [cancel, back, next]) {
      expect(box.height).toBe(32);
      expect(box.y + box.height / 2).toBeCloseTo(footer.y + footer.height / 2, 0);
    }
  });

  test('scrolls its body, and only its body, when it holds more than fits', async ({ page }) => {
    const p = parts(page, 'dialog-long');
    await p.trigger.click();
    const view = page.viewportSize();
    const dialog = await rect(p.dialog);
    expect(dialog.height).toBeLessThanOrEqual(Math.min(720, (view?.height ?? 0) - 48));
    expect(dialog.height).toBeGreaterThan(600);

    const before = { header: await rect(p.header), footer: await rect(p.footer) };
    const pageScroll = await page.evaluate(() => window.scrollY);
    const scroll = await p.body.evaluate((element) => ({
      client: element.clientHeight,
      full: element.scrollHeight,
    }));
    expect(scroll.full).toBeGreaterThan(scroll.client);
    await p.body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await p.body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await rect(p.header)).toEqual(before.header);
    expect(await rect(p.footer)).toEqual(before.footer);
    // The page behind does not scroll.
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  });

  test('keeps a long title to one line with an ellipsis, and the close button in place', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-long');
    await p.trigger.click();
    const title = await p.title.evaluate((element) => ({
      overflowing: element.scrollWidth > element.clientWidth,
      overflow: getComputedStyle(element).textOverflow,
      lines: element.getBoundingClientRect().height,
    }));
    expect(title).toEqual({ overflowing: true, overflow: 'ellipsis', lines: 28 });
    const dialog = await rect(p.dialog);
    const close = await rect(p.close);
    expect(dialog.x + dialog.width - 1 - (close.x + close.width)).toBe(24);
    const titleBox = await rect(p.title);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(close.x);
  });

  test('closes with Esc, tells the page once, and gives the keyboard back to the button', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-short');
    await countCloses(page, 'dialog-short');
    await openByKeyboard(page, 'dialog-short');
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    expect(await closes(page)).toBe(1);
    expect(await p.host.evaluate((element) => (element as unknown as { open: boolean }).open)).toBe(
      false,
    );
    await expect(p.trigger.locator('button')).toBeFocused();
    // It opens again.
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeVisible();
  });

  test('closes with its close button, with the same event', async ({ page }) => {
    const p = parts(page, 'dialog-short');
    await countCloses(page, 'dialog-short');
    await p.trigger.click();
    await p.close.click();
    await expect(p.dialog).toBeHidden();
    expect(await closes(page)).toBe(1);
  });

  test('closes quietly when told to, and does not close for a click outside it', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-short');
    await countCloses(page, 'dialog-short');
    await p.trigger.click();
    await page.mouse.click(4, 4);
    await expect(p.dialog).toBeVisible();
    await p.host.evaluate((element) => {
      (element as unknown as { open: boolean }).open = false;
    });
    await expect(p.dialog).toBeHidden();
    expect(await closes(page)).toBe(0);
  });

  test('keeps the keyboard inside while open', async ({ page }) => {
    const p = parts(page, 'dialog-short');
    await p.trigger.click();
    // The close button, the control in the body and the three in the footer, then out of the page
    // (to the browser's own controls) and round again. Never to the page behind.
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press('Tab');
      const where = await p.host.evaluate((host) => {
        const active = (host.getRootNode() as ShadowRoot).activeElement;
        return active === null ? 'nowhere' : host.contains(active) ? 'dialog' : 'page';
      });
      expect(['dialog', 'nowhere'], `after Tab ${String(press + 1)}`).toContain(where);
    }
  });

  test('fits the smallest window with room round it, and nothing overflows', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    const p = parts(page, 'dialog-long');
    await p.trigger.click();
    const dialog = await rect(p.dialog);
    expect(dialog.x).toBeGreaterThanOrEqual(24);
    expect(dialog.y).toBeGreaterThanOrEqual(24);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(1024 - 24);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(640 - 24);
    await assertNoOverflow(p.dialog);
  });

  test('narrows with the window: 24 clear of each side', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 640 });
    const p = parts(page, 'dialog-short');
    await p.trigger.click();
    const dialog = await rect(p.dialog);
    expect(dialog.width).toBe(600 - 48);
    expect(dialog.x).toBe(24);
  });

  test('has no serious accessibility violations, open', async ({ page }) => {
    const p = parts(page, 'dialog-short');
    await p.trigger.click();
    await expectNoSeriousViolations(page, ['karmania-gallery', '#dialog-short']);
  });
});
