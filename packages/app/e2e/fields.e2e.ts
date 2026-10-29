import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { contrastBetween } from './support/color.js';
import { assertNoOverflow } from './support/layout.js';

const demo = (page: Page, id: string): Locator => page.locator(`#${id}`);
const select = (page: Page, id: string): Locator => demo(page, id).locator('select');
const input = (page: Page, id: string): Locator => demo(page, id).locator('input');

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

/** The colour of the page's surface, as the browser writes it. */
function surfaceOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--k-surface)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
}

/** Keeps the events a field sends: each one's value (or whether it is ticked), in `window.heard`. */
async function listen(page: Page, id: string, name: string): Promise<void> {
  await demo(page, id)
    .locator(name)
    .evaluate(
      (element, event) => {
        const holder = window as unknown as { heard: unknown[] };
        holder.heard = [];
        element.addEventListener(event, (heard) => {
          const detail = (heard as CustomEvent<{ value?: string; checked?: boolean }>).detail;
          holder.heard.push(detail.value ?? detail.checked);
        });
      },
      {
        'k-select': 'k-select-change',
        'k-input': 'k-input-change',
        'k-checkbox': 'k-checkbox-change',
      }[name] ?? '',
    );
}

const heard = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => (window as unknown as { heard: unknown[] }).heard);

test.describe('the select', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is a labelled native select with the choices, and the one chosen showing', async ({
    page,
  }) => {
    const box = demo(page, 'select-default');
    await expect(box.getByRole('combobox', { name: 'Kind' })).toBeVisible();
    await expect(select(page, 'select-default').locator('option')).toHaveText([
      'Points',
      'Lines',
      'Block model',
      'Mesh',
    ]);
    expect(await select(page, 'select-default').inputValue()).toBe('points');
    await expect(select(page, 'select-default').locator('option').nth(3)).toBeDisabled();
  });

  test('is 32 high with its label 4 above it, or 28 high when compact', async ({ page }) => {
    const control = await rect(select(page, 'select-default'));
    expect(control.height).toBe(32);
    const label = demo(page, 'select-default').locator('label');
    const text = await rect(label);
    expect(control.y - (text.y + text.height)).toBe(4);
    expect(await styleOf(label, 'font-size', 'line-height', 'font-weight')).toEqual({
      'font-size': '13px',
      'line-height': '20px',
      'font-weight': '500',
    });
    expect(
      await styleOf(select(page, 'select-default'), 'font-size', 'line-height', 'border-radius'),
    ).toEqual({ 'font-size': '14px', 'line-height': '20px', 'border-radius': '6px' });
    expect((await rect(select(page, 'select-compact'))).height).toBe(28);
  });

  test('takes the width it is given, and the arrow sits 8 from the right, in the middle', async ({
    page,
  }) => {
    const host = await rect(demo(page, 'select-default').locator('k-select'));
    const control = await rect(select(page, 'select-default'));
    expect(control.width).toBe(host.width);
    expect(host.width).toBe(240);
    const arrow = await rect(demo(page, 'select-default').locator('.chevron'));
    expect(control.x + control.width - 1 - (arrow.x + arrow.width)).toBe(8);
    expect(arrow.y + arrow.height / 2).toBeCloseTo(control.y + control.height / 2, 0);
  });

  test('tells the page what a person chose, with the mouse and with the keyboard', async ({
    page,
  }) => {
    await listen(page, 'select-default', 'k-select');
    await select(page, 'select-default').selectOption('blocks');
    expect(await heard(page)).toEqual(['blocks']);
    await page.keyboard.press('Shift');
    await select(page, 'select-default').focus();
    // Typing a letter chooses what starts with it. (The arrow keys open the list on a Mac.)
    await page.keyboard.press('l');
    expect(await heard(page)).toEqual(['blocks', 'lines']);
    expect(await select(page, 'select-default').inputValue()).toBe('lines');
  });

  test('shows the value it is given after a person has chosen another, and after its choices change', async ({
    page,
  }) => {
    const host = demo(page, 'select-default').locator('k-select');
    await select(page, 'select-default').selectOption('lines');
    await host.evaluate(async (element) => {
      const field = element as HTMLElementTagNameMap['k-select'];
      field.value = 'blocks';
      await field.updateComplete;
    });
    expect(await select(page, 'select-default').inputValue()).toBe('blocks');
    // The choices change as well, as when one select serves for the columns of a table in turn.
    await host.evaluate(async (element) => {
      const field = element as HTMLElementTagNameMap['k-select'];
      field.options = [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ];
      field.value = 'b';
      await field.updateComplete;
    });
    expect(await select(page, 'select-default').inputValue()).toBe('b');
  });

  test('is skipped by Tab and looks disabled when it is', async ({ page }) => {
    await expect(select(page, 'select-disabled')).toBeDisabled();
    const colours = await styleOf(select(page, 'select-disabled'), 'cursor');
    expect(colours['cursor']).toBe('not-allowed');
    await page.keyboard.press('Shift');
    await select(page, 'select-default').focus();
    await page.keyboard.press('Tab');
    await expect(select(page, 'select-disabled')).not.toBeFocused();
  });

  test('says its help under it, in muted caption text, and links it to the select', async ({
    page,
  }) => {
    const box = demo(page, 'select-help');
    const help = box.locator('.help');
    await expect(help).toHaveText('A CSV file can hold points, lines or blocks');
    expect(await styleOf(help, 'font-size', 'line-height')).toEqual({
      'font-size': '12px',
      'line-height': '16px',
    });
    const [control, text] = [await rect(select(page, 'select-help')), await rect(help)];
    expect(text.y - (control.y + control.height)).toBe(4);
    await expect(select(page, 'select-help')).toHaveAccessibleDescription(
      'A CSV file can hold points, lines or blocks',
    );
  });

  test('cuts a choice that is too long with an ellipsis, and nothing overflows', async ({
    page,
  }) => {
    const box = demo(page, 'select-long');
    expect((await styleOf(select(page, 'select-long'), 'text-overflow'))['text-overflow']).toBe(
      'ellipsis',
    );
    await assertNoOverflow(box, { window: 'horizontal' });
    const [host, control] = [await rect(box), await rect(select(page, 'select-long'))];
    expect(control.x + control.width).toBeLessThanOrEqual(host.x + host.width + 0.5);
  });

  test('keeps the label of a compact one for screen readers and off the screen', async ({
    page,
  }) => {
    const box = demo(page, 'select-compact');
    await expect(box.getByRole('combobox', { name: 'Role of the column Easting' })).toBeVisible();
    const label = await rect(box.locator('label'));
    expect([label.width, label.height]).toEqual([1, 1]);
    // Without a label there is nothing above it.
    const [host, control] = [
      await rect(box.locator('k-select')),
      await rect(select(page, 'select-compact')),
    ];
    expect(control.y).toBe(host.y);
  });

  test('shows a focus ring of 2 in the accent colour, 2 away, for the keyboard', async ({
    page,
  }) => {
    await page.keyboard.press('Shift');
    await select(page, 'select-default').focus();
    expect(
      await styleOf(
        select(page, 'select-default'),
        'outline-width',
        'outline-style',
        'outline-offset',
      ),
    ).toEqual({ 'outline-width': '2px', 'outline-style': 'solid', 'outline-offset': '2px' });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      const surface = await surfaceOf(page);
      const colours = await styleOf(select(page, 'select-default'), 'color', 'border-top-color');
      expect(contrastBetween(colours['color'] ?? '', surface)).toBeGreaterThanOrEqual(4.5);
      // The boundary of a control is told from the page by 3:1.
      expect(contrastBetween(colours['border-top-color'] ?? '', surface)).toBeGreaterThanOrEqual(3);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="fields"]']);
    });
  }
});

test.describe('the text input', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is a labelled native input with its value, 32 high, or 28 when compact', async ({
    page,
  }) => {
    await expect(
      demo(page, 'input-default').getByRole('textbox', { name: 'Dataset name' }),
    ).toHaveValue('Collars');
    const control = await rect(input(page, 'input-default'));
    expect(control.height).toBe(32);
    const label = await rect(demo(page, 'input-default').locator('label'));
    expect(control.y - (label.y + label.height)).toBe(4);
    expect((await rect(input(page, 'input-compact'))).height).toBe(28);
    expect(
      await styleOf(
        input(page, 'input-default'),
        'font-size',
        'line-height',
        'border-radius',
        'padding-left',
      ),
    ).toEqual({
      'font-size': '14px',
      'line-height': '20px',
      'border-radius': '6px',
      'padding-left': '8px',
    });
  });

  test('tells the page every change as it is made', async ({ page }) => {
    await listen(page, 'input-placeholder', 'k-input');
    await input(page, 'input-placeholder').pressSequentially('Pit');
    expect(await heard(page)).toEqual(['P', 'Pi', 'Pit']);
    await input(page, 'input-placeholder').fill('Pit 2');
    expect((await heard(page)).at(-1)).toBe('Pit 2');
  });

  test('shows a placeholder that can be read, and offers a numeric keyboard when asked', async ({
    page,
  }) => {
    await expect(input(page, 'input-placeholder')).toHaveAttribute(
      'placeholder',
      'Name the dataset',
    );
    expect(await input(page, 'input-help').getAttribute('inputmode')).toBe('numeric');
    const surface = await surfaceOf(page);
    const placeholder = await input(page, 'input-placeholder').evaluate(
      (element) => getComputedStyle(element, '::placeholder').color,
    );
    expect(contrastBetween(placeholder, surface)).toBeGreaterThanOrEqual(4.5);
  });

  test('says what is wrong in words with an icon, and marks itself invalid', async ({ page }) => {
    const box = demo(page, 'input-error');
    await expect(input(page, 'input-error')).toHaveAttribute('aria-invalid', 'true');
    await expect(box.locator('.error')).toHaveText('Enter a whole number, such as 32640');
    await expect(box.locator('.error k-icon')).toHaveCount(1);
    await expect(input(page, 'input-error')).toHaveAccessibleDescription(
      'Enter a whole number, such as 32640',
    );
    const border = await styleOf(input(page, 'input-error'), 'border-top-color');
    const normal = await styleOf(input(page, 'input-default'), 'border-top-color');
    expect(border['border-top-color']).not.toBe(normal['border-top-color']);
    const [control, text] = [
      await rect(input(page, 'input-error')),
      await rect(box.locator('.error')),
    ];
    expect(text.y - (control.y + control.height)).toBe(4);
    // No error, no mark.
    expect(await input(page, 'input-default').getAttribute('aria-invalid')).toBeNull();
  });

  test("says its help under it, and an error takes the help line's place", async ({ page }) => {
    await expect(demo(page, 'input-help').locator('.help')).toHaveText(
      'A whole number, such as 32640',
    );
    await demo(page, 'input-help')
      .locator('k-input')
      .evaluate(async (element) => {
        const field = element as HTMLElementTagNameMap['k-input'];
        field.error = 'Not a number';
        await field.updateComplete;
      });
    await expect(demo(page, 'input-help').locator('.help')).toHaveCount(0);
    await expect(demo(page, 'input-help').locator('.error')).toHaveText('Not a number');
  });

  test('moves nothing when a message appears in a field that keeps room for one', async ({
    page,
  }) => {
    const host = demo(page, 'input-reserve').locator('k-input');
    const before = await rect(host);
    await host.evaluate(async (element) => {
      const field = element as HTMLElementTagNameMap['k-input'];
      field.error = 'Enter a name';
      await field.updateComplete;
    });
    expect(await rect(host)).toEqual(before);
    // A field that does not keep room grows by the line, which is what the room is for.
    const plain = demo(page, 'input-default').locator('k-input');
    const plainBefore = await rect(plain);
    await plain.evaluate(async (element) => {
      const field = element as HTMLElementTagNameMap['k-input'];
      field.error = 'Enter a name';
      await field.updateComplete;
    });
    expect((await rect(plain)).height).toBe(plainBefore.height + 4 + 16);
  });

  test('keeps a long value and a long message inside a narrow field', async ({ page }) => {
    const box = demo(page, 'input-long');
    await assertNoOverflow(box, { window: 'horizontal' });
    const [host, control, message] = [
      await rect(box),
      await rect(input(page, 'input-long')),
      await rect(box.locator('.error')),
    ];
    expect(control.width).toBe(host.width);
    expect(message.x + message.width).toBeLessThanOrEqual(host.x + host.width + 0.5);
    expect(message.height).toBeGreaterThanOrEqual(32);
  });

  test('is skipped by Tab and looks disabled when it is', async ({ page }) => {
    await expect(input(page, 'input-disabled')).toBeDisabled();
    await page.keyboard.press('Shift');
    await input(page, 'input-reserve').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(input(page, 'input-disabled')).not.toBeFocused();
  });

  test('shows a focus ring of 2 in the accent colour, 2 away, for the keyboard', async ({
    page,
  }) => {
    await page.keyboard.press('Shift');
    await input(page, 'input-default').focus();
    expect(
      await styleOf(
        input(page, 'input-default'),
        'outline-width',
        'outline-style',
        'outline-offset',
      ),
    ).toEqual({ 'outline-width': '2px', 'outline-style': 'solid', 'outline-offset': '2px' });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      const surface = await surfaceOf(page);
      const colours = await styleOf(input(page, 'input-default'), 'color', 'border-top-color');
      expect(contrastBetween(colours['color'] ?? '', surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastBetween(colours['border-top-color'] ?? '', surface)).toBeGreaterThanOrEqual(3);
      const error = await demo(page, 'input-error')
        .locator('.error')
        .evaluate((element) => getComputedStyle(element).color);
      expect(contrastBetween(error, surface)).toBeGreaterThanOrEqual(4.5);
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="fields"]']);
    });
  }
});

const checkbox = (page: Page, id: string, nth = 0): Locator =>
  demo(page, id).locator('k-checkbox').nth(nth);
const box = (page: Page, id: string, nth = 0): Locator => checkbox(page, id, nth).locator('input');

test.describe('the checkbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is a labelled native checkbox, ticked or not', async ({ page }) => {
    await expect(demo(page, 'check-off').getByRole('checkbox', { name: 'NA' })).not.toBeChecked();
    await expect(demo(page, 'check-on').getByRole('checkbox', { name: /N\/A/ })).toBeChecked();
    expect(
      await checkbox(page, 'check-on').evaluate(
        (element) => (element as HTMLElement & { checked: boolean }).checked,
      ),
    ).toBe(true);
  });

  test('has a box of 16, 8 from its label, in a row at least as high as a hit target', async ({
    page,
  }) => {
    const [row, square, text] = [
      await rect(checkbox(page, 'check-off')),
      await rect(box(page, 'check-off')),
      await rect(checkbox(page, 'check-off').locator('.text')),
    ];
    expect([square.width, square.height]).toEqual([16, 16]);
    expect(text.x - (square.x + square.width)).toBe(8);
    expect(row.height).toBeGreaterThanOrEqual(32);
    // Single line: the box is in the middle of the row's height.
    expect(square.y + square.height / 2).toBeCloseTo(row.y + row.height / 2, 0);
  });

  test('is ticked by pressing its label as well as its box, and says what the person chose', async ({
    page,
  }) => {
    await listen(page, 'check-off', 'k-checkbox');
    await checkbox(page, 'check-off').locator('.text').click();
    await expect(box(page, 'check-off')).toBeChecked();
    expect(
      await checkbox(page, 'check-off').evaluate(
        (element) => (element as HTMLElement & { checked: boolean }).checked,
      ),
    ).toBe(true);
    await box(page, 'check-off').click();
    await expect(box(page, 'check-off')).not.toBeChecked();
    expect(await page.evaluate(() => (window as unknown as { heard: unknown[] }).heard)).toEqual([
      true,
      false,
    ]);
  });

  test('is ticked with the Space key when it has the keyboard', async ({ page }) => {
    await page.keyboard.press('Shift');
    await box(page, 'check-off').focus();
    await page.keyboard.press('Space');
    await expect(box(page, 'check-off')).toBeChecked();
    await page.keyboard.press('Space');
    await expect(box(page, 'check-off')).not.toBeChecked();
  });

  test('shows the state it is given after a person has changed it', async ({ page }) => {
    await box(page, 'check-off').click();
    await checkbox(page, 'check-off').evaluate(async (element) => {
      const field = element as HTMLElementTagNameMap['k-checkbox'];
      field.checked = false;
      await field.updateComplete;
    });
    await expect(box(page, 'check-off')).not.toBeChecked();
  });

  test('draws the tick only when it is ticked', async ({ page }) => {
    const opacity = (id: string) =>
      checkbox(page, id)
        .locator('k-icon')
        .evaluate((element) => getComputedStyle(element).opacity);
    expect(await opacity('check-off')).toBe('0');
    expect(await opacity('check-on')).toBe('1');
  });

  test('is skipped by Tab and cannot be changed when it is disabled, whether it is ticked or not', async ({
    page,
  }) => {
    await expect(box(page, 'check-disabled', 0)).toBeDisabled();
    await expect(box(page, 'check-disabled', 1)).toBeDisabled();
    await checkbox(page, 'check-disabled', 0).locator('.text').click({ force: true });
    await expect(box(page, 'check-disabled', 0)).not.toBeChecked();
    await expect(box(page, 'check-disabled', 1)).toBeChecked();
  });

  test('puts its detail at the end of the row, muted, with the digits in line', async ({
    page,
  }) => {
    const detail = checkbox(page, 'check-on').locator('.detail');
    await expect(detail).toHaveText('12 times');
    const [row, tail] = [await rect(checkbox(page, 'check-on')), await rect(detail)];
    expect(tail.x + tail.width).toBeCloseTo(row.x + row.width, 0);
    expect(await styleOf(detail, 'font-size', 'font-variant-numeric')).toEqual({
      'font-size': '13px',
      'font-variant-numeric': 'tabular-nums',
    });
  });

  test('wraps a long label, and breaks a word that does not fit, and nothing overflows', async ({
    page,
  }) => {
    const long = demo(page, 'check-long');
    await assertNoOverflow(long, { window: 'horizontal' });
    const text = await rect(checkbox(page, 'check-long').locator('.text'));
    expect(text.height).toBeGreaterThan(40);
    const [host, row] = [await rect(long), await rect(checkbox(page, 'check-long'))];
    expect(row.x + row.width).toBeLessThanOrEqual(host.x + host.width + 0.5);
  });

  test('shows a focus ring of 2 in the accent colour, 2 away, round the box, for the keyboard', async ({
    page,
  }) => {
    await page.keyboard.press('Shift');
    await box(page, 'check-on').focus();
    expect(
      await styleOf(box(page, 'check-on'), 'outline-width', 'outline-style', 'outline-offset'),
    ).toEqual({ 'outline-width': '2px', 'outline-style': 'solid', 'outline-offset': '2px' });
  });

  test('lists one under another with nothing between them but the rows', async ({ page }) => {
    const [first, second, third] = [
      await rect(checkbox(page, 'check-list', 0)),
      await rect(checkbox(page, 'check-list', 1)),
      await rect(checkbox(page, 'check-list', 2)),
    ];
    expect(second.y).toBeCloseTo(first.y + first.height, 0);
    expect(third.y).toBeCloseTo(second.y + second.height, 0);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      const surface = await surfaceOf(page);
      const unticked = await styleOf(box(page, 'check-off'), 'border-top-color');
      expect(contrastBetween(unticked['border-top-color'] ?? '', surface)).toBeGreaterThanOrEqual(
        3,
      );
      const label = await styleOf(checkbox(page, 'check-off').locator('.text'), 'color');
      expect(contrastBetween(label['color'] ?? '', surface)).toBeGreaterThanOrEqual(4.5);
      const detail = await styleOf(checkbox(page, 'check-on').locator('.detail'), 'color');
      expect(contrastBetween(detail['color'] ?? '', surface)).toBeGreaterThanOrEqual(4.5);
      const ticked = await styleOf(box(page, 'check-on'), 'background-color');
      const tick = await styleOf(checkbox(page, 'check-on').locator('k-icon'), 'color');
      expect(
        contrastBetween(tick['color'] ?? '', ticked['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(3);
      await expectNoSeriousViolations(page, ['karmania-gallery', '#fields-checkbox']);
    });
  }
});

const progress = (page: Page, id: string): Locator => demo(page, id).locator('k-progress');
const bar = (page: Page, id: string): Locator => progress(page, id).locator('.bar');

test.describe('the progress bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('is a progress bar to screen readers, with its name and, when it has one, its value', async ({
    page,
  }) => {
    const named = demo(page, 'progress-half').getByRole('progressbar', {
      name: 'Reading the file',
    });
    await expect(named).toHaveAttribute('aria-valuenow', '42');
    await expect(named).toHaveAttribute('aria-valuemin', '0');
    await expect(named).toHaveAttribute('aria-valuemax', '100');
    await expect(demo(page, 'progress-start').getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await expect(demo(page, 'progress-done').getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    // Not knowing how far is not saying 0.
    await expect(demo(page, 'progress-unknown').getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow',
    );
  });

  test('says the percentage at the end of the label line, and none when it does not know', async ({
    page,
  }) => {
    await expect(progress(page, 'progress-half').locator('.percent')).toHaveText('42%');
    await expect(progress(page, 'progress-unknown').locator('.percent')).toHaveCount(0);
    const [host, percent] = [
      await rect(progress(page, 'progress-half')),
      await rect(progress(page, 'progress-half').locator('.percent')),
    ];
    expect(percent.x + percent.width).toBeCloseTo(host.x + host.width, 0);
  });

  test('draws the bar by scaling it, as long as what has been done, on a track of 8', async ({
    page,
  }) => {
    const track = await rect(progress(page, 'progress-half').locator('.track'));
    expect(track.height).toBe(8);
    const scale = await bar(page, 'progress-half').evaluate(
      (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
    );
    expect(scale).toBeCloseTo(0.42, 2);
    // Its box is the track's whole width; it is the drawing that is as long as the progress.
    expect((await rect(bar(page, 'progress-half'))).width).toBeCloseTo(track.width * 0.42, 0);
    expect((await rect(bar(page, 'progress-done'))).width).toBeCloseTo(
      (await rect(progress(page, 'progress-done').locator('.track'))).width,
      0,
    );
    expect((await rect(bar(page, 'progress-start'))).width).toBeLessThan(1);
  });

  test('keeps a value that is out of range to the track', async ({ page }) => {
    for (const [value, valuenow] of [
      [2, '100'],
      [-1, '0'],
    ] as const) {
      await progress(page, 'progress-half').evaluate(async (element, set) => {
        const field = element as HTMLElementTagNameMap['k-progress'];
        field.value = set;
        await field.updateComplete;
      }, value);
      await expect(
        demo(page, 'progress-half').getByRole('progressbar'),
        String(value),
      ).toHaveAttribute('aria-valuenow', valuenow);
    }
  });

  test('shows a short bar when it does not know how far, which travels unless motion is not wanted', async ({
    page,
  }) => {
    const track = await rect(progress(page, 'progress-unknown').locator('.track'));
    const unknown = bar(page, 'progress-unknown');
    expect((await rect(unknown)).width).toBeCloseTo(track.width * 0.3, 0);
    expect(await unknown.evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'none',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await unknown.evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'travel',
    );
    // It stays inside the track as it travels.
    await page.waitForTimeout(300);
    const moved = await rect(unknown);
    expect(moved.x + moved.width).toBeLessThanOrEqual(track.x + track.width + 1);
  });

  test('wraps a long label, and nothing overflows', async ({ page }) => {
    const long = demo(page, 'progress-long');
    await assertNoOverflow(long, { window: 'horizontal' });
    expect((await rect(progress(page, 'progress-long').locator('.label'))).height).toBeGreaterThan(
      40,
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`can be told from its track and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      const fill = await styleOf(bar(page, 'progress-half'), 'background-color');
      const track = await styleOf(
        progress(page, 'progress-half').locator('.track'),
        'background-color',
      );
      expect(
        contrastBetween(fill['background-color'] ?? '', track['background-color'] ?? ''),
      ).toBeGreaterThanOrEqual(3);
      const surface = await surfaceOf(page);
      const percent = await styleOf(progress(page, 'progress-half').locator('.percent'), 'color');
      expect(contrastBetween(percent['color'] ?? '', surface)).toBeGreaterThanOrEqual(4.5);
      await expectNoSeriousViolations(page, ['karmania-gallery', '#fields-progress']);
    });
  }
});
