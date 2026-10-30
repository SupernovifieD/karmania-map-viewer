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

  test.describe('its body, when it scrolls', () => {
    /** Makes a dialog in the page with `body` in it, opens it, and says what its body is to the keyboard. */
    async function bodyOf(
      page: Page,
      body: string,
    ): Promise<{ tabindex: string | null; role: string | null; name: string | null }> {
      await page.evaluate((html) => {
        document.querySelector('#made')?.remove();
        const dialog = document.createElement('k-dialog') as HTMLElement & { open: boolean };
        dialog.id = 'made';
        dialog.setAttribute('heading', 'A made dialog');
        dialog.innerHTML = `${html}<k-button slot="footer-end" variant="primary">Load</k-button>`;
        document.body.append(dialog);
        dialog.open = true;
      }, body);
      const dialog = page.locator('#made dialog');
      await expect(dialog).toBeVisible();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => {
              requestAnimationFrame(resolve);
            }),
          ),
      );
      return page.locator('#made .body').evaluate((element) => ({
        tabindex: element.getAttribute('tabindex'),
        role: element.getAttribute('role'),
        name: element.getAttribute('aria-labelledby'),
      }));
    }

    const TALL = Array.from(
      { length: 60 },
      (_, index) => `<p>Line ${String(index + 1)} of a long text.</p>`,
    ).join('');

    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/gallery.html');
    });

    test('is a stop for the keyboard, with the dialog name, when it holds only text', async ({
      page,
    }) => {
      const p = parts(page, 'dialog-long');
      await p.trigger.click();
      await expect(p.body).toHaveAttribute('tabindex', '0');
      await expect(p.body).toHaveAttribute('role', 'region');
      await expect(p.body).toHaveAccessibleName(/^A title that is a good deal longer/);
      // Tab goes from the close button to it, and the arrow keys scroll it.
      await page.keyboard.press('Shift');
      await p.close.locator('button').focus();
      await page.keyboard.press('Tab');
      await expect(p.body).toBeFocused();
      await page.keyboard.press('PageDown');
      await expect.poll(() => p.body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      // The ring is drawn inside the body: the dialog clips what is outside it.
      const ring = await p.body.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth, style.outlineOffset];
      });
      expect(ring).toEqual(['solid', '2px', '-2px']);
      await page.keyboard.press('Tab');
      await expect(p.start.locator('button')).toBeFocused();
    });

    test('is left as it is when it holds a control, though it scrolls', async ({ page }) => {
      const found = await bodyOf(page, `<k-button>A control</k-button>${TALL}`);
      expect(found).toEqual({ tabindex: null, role: null, name: null });
    });

    test('is left as it is when the control is in an element that has a tree of its own', async ({
      page,
    }) => {
      await page.evaluate(() => {
        if (!customElements.get('x-holder')) {
          customElements.define(
            'x-holder',
            class extends HTMLElement {
              constructor() {
                super();
                this.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Inside">';
              }
            },
          );
        }
      });
      const found = await bodyOf(page, `<x-holder></x-holder>${TALL}`);
      expect(found).toEqual({ tabindex: null, role: null, name: null });
    });

    test('is not a stop for the keyboard because of the controls in the footer', async ({
      page,
    }) => {
      // The footer has a button (the one `bodyOf` makes), and the body has only text: the body is the stop.
      const found = await bodyOf(page, TALL);
      expect(found).toEqual({ tabindex: '0', role: 'region', name: 'title' });
    });

    test('is left as it is when it holds only text and does not scroll', async ({ page }) => {
      const found = await bodyOf(page, '<p>Not much.</p>');
      expect(found).toEqual({ tabindex: null, role: null, name: null });
    });

    test('becomes a stop when what is in it grows past its room, and stops being one when it shrinks', async ({
      page,
    }) => {
      await bodyOf(page, '<p>Not much.</p>');
      const body = page.locator('#made .body');
      await expect(body).not.toHaveAttribute('tabindex', /.*/);
      await page.locator('#made').evaluate((dialog, html) => {
        dialog.insertAdjacentHTML('afterbegin', html);
      }, TALL);
      await expect(body).toHaveAttribute('tabindex', '0');
      await page.evaluate(() => {
        for (const paragraph of document.querySelectorAll('#made > p:nth-child(n+3)')) {
          paragraph.remove();
        }
      });
      await expect(body).not.toHaveAttribute('tabindex', /.*/);
    });
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

  test('puts the keyboard on the dialog when it opens, and the first Tab goes to its first control', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-short');
    await page.keyboard.press('Shift');
    await p.trigger.locator('button').focus();
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeVisible();
    // The dialog has it: not the close button, whose tooltip would have opened with it.
    expect(
      await p.host.evaluate((host) => host.shadowRoot?.activeElement?.localName ?? 'none'),
    ).toBe('dialog');
    expect(
      await p.host.evaluate(
        (host) =>
          host.shadowRoot?.querySelector('k-tooltip .tip')?.matches(':popover-open') ?? false,
      ),
    ).toBe(false);
    // No ring is drawn round the whole dialog.
    expect(await p.dialog.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      'none',
    );
    await page.keyboard.press('Tab');
    await expect(p.close.locator('button')).toBeFocused();
  });

  test('stays open when it is opened again straight after being closed, and says nothing', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-short');
    await countCloses(page, 'dialog-short');
    await p.trigger.click();
    await expect(p.dialog).toBeVisible();
    // Closed and opened again in one go, so that the browser's `close` event for the first is only
    // sent afterwards, when the dialog is open once more: it must not be taken for a person closing it.
    await p.host.evaluate(async (element) => {
      const dialog = element as unknown as { open: boolean; updateComplete: Promise<boolean> };
      dialog.open = false;
      await dialog.updateComplete;
      dialog.open = true;
      await dialog.updateComplete;
    });
    expect(await closes(page)).toBe(0);
    await expect(p.dialog).toBeVisible();
    expect(await p.host.evaluate((element) => (element as unknown as { open: boolean }).open)).toBe(
      true,
    );
    // And a person can still close it.
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    expect(await closes(page)).toBe(1);
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

  test('has room for a note between Cancel and the buttons, of two lines at most, over nothing', async ({
    page,
  }) => {
    const p = parts(page, 'dialog-note');
    await p.trigger.click();
    const note = p.host.locator('.note');
    const [cancel, box, back, footer] = [
      await rect(p.start),
      await rect(note),
      await rect(p.end.nth(0)),
      await rect(p.footer),
    ];
    expect(box.x).toBeGreaterThanOrEqual(cancel.x + cancel.width);
    expect(box.x + box.width).toBeLessThanOrEqual(back.x);
    expect(footer.height).toBe(64);
    // The note is long, so it fills two lines of 20 and is cut after them.
    expect(box.height).toBe(40);
    expect(
      await note.evaluate((element) => ({
        cut: element.scrollHeight > element.clientHeight,
        clamp: getComputedStyle(element).webkitLineClamp,
        size: getComputedStyle(element).fontSize,
        line: getComputedStyle(element).lineHeight,
      })),
    ).toEqual({ cut: true, clamp: '2', size: '13px', line: '20px' });
    // The whole of it is there for whoever points at it.
    await expect(p.host.locator('span[slot="footer-note"]')).toHaveAttribute(
      'title',
      /A note that is a good deal longer/,
    );
    // The buttons are where they were, and the note is in the middle of the footer's height.
    expect(box.y + box.height / 2).toBeCloseTo(footer.y + footer.height / 2, 0);
  });

  test('sets a short note on one line, in the middle of the footer', async ({ page }) => {
    const p = parts(page, 'dialog-note');
    await p.trigger.click();
    await p.host.locator('span[slot="footer-note"]').evaluate((element) => {
      element.textContent = 'Choose a column for X.';
    });
    const [box, footer] = [await rect(p.host.locator('.note')), await rect(p.footer)];
    expect(box.height).toBe(20);
    expect(box.y + box.height / 2).toBeCloseTo(footer.y + footer.height / 2, 0);
  });

  test('is as tall as it can be, whatever is in it, when it is asked to fill', async ({ page }) => {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 640 },
    ]) {
      await page.setViewportSize(size);
      const p = parts(page, 'dialog-fill');
      await p.trigger.click();
      const dialog = await rect(p.dialog);
      expect(dialog.height).toBe(Math.min(720, size.height - 48));
      // The buttons are at the bottom, as far down as the dialog goes.
      const footer = await rect(p.footer);
      expect(footer.y + footer.height).toBeCloseTo(dialog.y + dialog.height - 1, 0);
      await page.keyboard.press('Escape');
    }
    // One that does not fill is as tall as its content.
    const short = parts(page, 'dialog-short');
    await short.trigger.click();
    expect((await rect(short.dialog)).height).toBeLessThan(300);
  });

  test('has no serious accessibility violations, open', async ({ page }) => {
    const p = parts(page, 'dialog-short');
    await p.trigger.click();
    await expectNoSeriousViolations(page, ['karmania-gallery', '#dialog-short']);
    await page.keyboard.press('Escape');
    const withNote = parts(page, 'dialog-note');
    await withNote.trigger.click();
    await expectNoSeriousViolations(page, ['karmania-gallery', '#dialog-note']);
  });
});
