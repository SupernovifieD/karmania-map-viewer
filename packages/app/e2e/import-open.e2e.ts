import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const POINTS = { name: 'points.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n') };
const PROJECTION = { name: 'points.prj', mimeType: 'text/plain', buffer: Buffer.from('PROJCS[]') };

const wizard = (page: Page): Locator => page.locator('karmania-import-dialog');
const dialog = (page: Page): Locator => wizard(page).locator('dialog');
const toolbarImport = (page: Page): Locator =>
  page.locator('karmania-app header.toolbar k-button button');
const mapImport = (page: Page): Locator =>
  page.locator('karmania-map-area k-empty-state k-button button');

/** The names of the files the wizard holds. */
const heldFiles = (page: Page): Promise<string[]> =>
  wizard(page).evaluate((element) =>
    (element as unknown as { files: File[] }).files.map((file) => file.name),
  );

/** Fires a drag event carrying files, or text, on an element, and says whether the page took it. */
function drop(target: Locator, kind: 'files' | 'text' = 'files'): Promise<boolean> {
  return target.evaluate((element, dragKind) => {
    const dataTransfer = new DataTransfer();
    if (dragKind === 'files') {
      dataTransfer.items.add(new File(['x,y\n1,2\n'], 'dropped.csv', { type: 'text/csv' }));
      dataTransfer.items.add(new File(['PROJCS[]'], 'dropped.prj', { type: 'text/plain' }));
    } else {
      dataTransfer.setData('text/plain', 'some text');
    }
    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, kind);
}

/** Presses a button and chooses files in the picker that opens. */
async function chooseWith(
  page: Page,
  button: Locator,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    button.click(),
  ]);
  await chooser.setFiles(files);
}

test.describe('opening the import wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('is shut until files are chosen', async ({ page }) => {
    await expect(dialog(page)).toBeHidden();
    expect(await heldFiles(page)).toEqual([]);
  });

  test("opens when files are chosen with the toolbar's Import button, with the files", async ({
    page,
  }) => {
    await chooseWith(page, toolbarImport(page), [POINTS, PROJECTION]);
    await expect(dialog(page)).toBeVisible();
    expect(await heldFiles(page)).toEqual(['points.csv', 'points.prj']);
    await expect(wizard(page).locator('.step')).toHaveAttribute('data-step', 'file');
  });

  test("opens when files are chosen with the map area's Import button, with the files", async ({
    page,
  }) => {
    await chooseWith(page, mapImport(page), [POINTS]);
    await expect(dialog(page)).toBeVisible();
    expect(await heldFiles(page)).toEqual(['points.csv']);
  });

  test('offers the picker the kinds of file it reads, and lets several be chosen', async ({
    page,
  }) => {
    const input = page.locator(
      'karmania-app > input[type="file"], karmania-app input[type="file"]',
    );
    await expect(input).toHaveAttribute('multiple', '');
    const accept = (await input.getAttribute('accept')) ?? '';
    for (const extension of ['.csv', '.geojson', '.asc', '.obj', '.prj']) {
      expect(accept.split(',')).toContain(extension);
    }
  });

  test('does not open when the picker is closed without a file', async ({ page }) => {
    await chooseWith(page, toolbarImport(page), []);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await expect(dialog(page)).toBeHidden();
  });

  test('opens again for the same file chosen twice, and forgets the files when closed', async ({
    page,
  }) => {
    await chooseWith(page, toolbarImport(page), [POINTS]);
    await expect(dialog(page)).toBeVisible();
    // The input is emptied once its files have been taken: a browser sends no `change` for a file
    // chosen again while it is still the input's value, and then nothing would open.
    expect(
      await page
        .locator('karmania-app input[type="file"]')
        .evaluate((input) => (input as HTMLInputElement).value),
    ).toBe('');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    expect(await heldFiles(page)).toEqual([]);
    await chooseWith(page, toolbarImport(page), [POINTS]);
    await expect(dialog(page)).toBeVisible();
    expect(await heldFiles(page)).toEqual(['points.csv']);
  });

  test('keeps the input out of the way: it is not shown and the keyboard never stops at it', async ({
    page,
  }) => {
    const input = page.locator('karmania-app input[type="file"]');
    await expect(input).toBeHidden();
    // Tab goes from the toolbar's button on, past the map area's, without stopping at the input.
    await page.keyboard.press('Tab');
    const stops: string[] = [];
    for (let press = 0; press < 6; press += 1) {
      stops.push(
        await page.evaluate(() => {
          let active: Element | null = document.activeElement;
          while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement;
          }
          return active?.tagName.toLowerCase() ?? 'none';
        }),
      );
      await page.keyboard.press('Tab');
    }
    expect(stops).not.toContain('input');
  });

  test('gives the keyboard back to the Import button when closed with Esc', async ({ page }) => {
    await page.keyboard.press('Shift');
    await toolbarImport(page).focus();
    // Pressing Enter does nothing useful if the button does not have the keyboard, and a test that
    // waited for a picker that never came would only say that it timed out.
    await expect(toolbarImport(page)).toBeFocused();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10_000 }),
      page.keyboard.press('Enter'),
    ]);
    await chooser.setFiles([POINTS]);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(toolbarImport(page)).toBeFocused();
  });

  test('opens when files are dropped on the map area, with the files', async ({ page }) => {
    expect(await drop(page.locator('karmania-map-area main'))).toBe(true);
    await expect(dialog(page)).toBeVisible();
    expect(await heldFiles(page)).toEqual(['dropped.csv', 'dropped.prj']);
    await expect(wizard(page).locator('.step')).toHaveAttribute('data-step', 'file');
  });

  test("opens for a drop on the map area's empty state too, which is inside it", async ({
    page,
  }) => {
    await drop(page.locator('karmania-map-area k-empty-state'));
    await expect(dialog(page)).toBeVisible();
    expect(await heldFiles(page)).toEqual(['dropped.csv', 'dropped.prj']);
  });

  test('does not open for files dropped anywhere else, or for a drop of text', async ({ page }) => {
    await drop(page.locator('karmania-app header.toolbar'));
    await drop(page.locator('karmania-panel'));
    await drop(page.locator('karmania-map-area main'), 'text');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await expect(dialog(page)).toBeHidden();
    expect(await heldFiles(page)).toEqual([]);
  });

  test('takes the drop outline away when the files are dropped', async ({ page }) => {
    await page.locator('karmania-map-area main').evaluate((element) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['x'], 'a.csv'));
      element.dispatchEvent(
        new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer,
        }),
      );
    });
    await expect(page.locator('karmania-map-area .drop-zone')).toHaveAttribute('data-active', '');
    await drop(page.locator('karmania-map-area main'));
    await expect(page.locator('karmania-map-area .drop-zone')).not.toHaveAttribute(
      'data-active',
      '',
    );
  });
});
