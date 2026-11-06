import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pickFiles } from './support/picker.js';

/** What the viewer element offers a page, reached as the tests reach it: through the app's shadow root. */
interface ViewerElement {
  openImport(files?: readonly File[]): void;
}

const dialog = (page: Page) => page.locator('karmania-import-dialog');

/** Calls `openImport` on the viewer, with these arguments (a list of file names to make files of, or none at all). */
async function openImport(page: Page, files?: readonly string[]): Promise<void> {
  await page.evaluate((names) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as ViewerElement;
    viewer.openImport(names?.map((name) => new File(['x,y\n1,2\n'], name)));
  }, files);
}

test.describe('what the viewer offers a page', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('has one viewer in an app that was taken out of the page before it first showed, and put back', async ({
    page,
  }) => {
    const count = await page.evaluate(async () => {
      const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
      const app = document.createElement('karmania-app');
      document.body.append(app);
      // Out again at once: its first render still happens, with the app out of the page.
      app.remove();
      await later();
      document.body.append(app);
      await later();
      return app.shadowRoot?.querySelectorAll('karmania-viewer').length;
    });
    expect(count).toBe(1);
  });

  test('opens the wizard on the files it is given', async ({ page }) => {
    await openImport(page, ['a.csv']);
    await expect(dialog(page).locator('karmania-file-step')).toBeVisible();
    await expect(dialog(page).locator('karmania-file-step .file[data-file="a.csv"]')).toBeVisible();
  });

  for (const [what, files] of [
    ['no files', undefined],
    ['an empty list of files', []],
  ] as const) {
    test(`opens the file picker, and then the wizard on what is chosen, when it is given ${what}`, async ({
      page,
    }) => {
      await pickFiles(page, () => openImport(page, files), ['points.csv', 'points.prj']);
      await expect(dialog(page).locator('karmania-file-step')).toBeVisible();
      await expect(
        dialog(page).locator('karmania-file-step .file[data-file="points.csv"]'),
      ).toBeVisible();
    });
  }
});
