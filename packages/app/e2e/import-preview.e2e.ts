import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

const wizard = (page: Page): Locator => page.locator('karmania-import-dialog');
const dialog = (page: Page): Locator => wizard(page).locator('dialog');
const toolbarImport = (page: Page): Locator =>
  page.locator('karmania-app header.toolbar k-button button');

/** What the wizard has made of the files, as plain data. */
interface Seen {
  readonly entries: readonly {
    readonly file: string;
    readonly sidecars: readonly string[];
    readonly format: string | undefined;
    readonly kind: string | undefined;
    readonly encoding: string | undefined;
    readonly crs: unknown;
    readonly findings: readonly string[];
  }[];
  readonly failure: string | undefined;
}

type Internals = {
  entries:
    undefined | { group: { file: File; sidecars: File[] }; preview: Record<string, unknown> }[];
  failure: string | undefined;
};

/** Waits until the wizard has looked at the files (or failed to), and reports what it found. */
async function seen(page: Page): Promise<Seen> {
  await page.waitForFunction(() => {
    const element = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-import-dialog') as unknown as Internals | null;
    return element !== null && (element.entries !== undefined || element.failure !== undefined);
  });
  return wizard(page).evaluate((element) => {
    const dialogElement = element as unknown as Internals;
    return {
      entries: (dialogElement.entries ?? []).map(({ group, preview }) => ({
        file: group.file.name,
        sidecars: group.sidecars.map((sidecar) => sidecar.name),
        format: preview['format'] as string | undefined,
        kind: preview['suggestedKind'] as string | undefined,
        encoding: preview['encoding'] as string | undefined,
        crs: preview['crs'],
        findings: (preview['findings'] as { code: string }[]).map((finding) => finding.code),
      })),
      failure: dialogElement.failure,
    };
  });
}

async function importFiles(page: Page, ...picks: Pick[]): Promise<void> {
  await pickFiles(
    page,
    async () => {
      await toolbarImport(page).click();
    },
    picks,
  );
  await expect(dialog(page)).toBeVisible();
}

test.describe('the wizard reading the files it was given', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('has the engine look at a CSV file with its projection file, as one', async ({ page }) => {
    await importFiles(page, 'points.csv', 'points.prj');
    const result = await seen(page);
    expect(result.failure).toBeUndefined();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      file: 'points.csv',
      sidecars: ['points.prj'],
      format: 'csv',
      kind: 'points',
      encoding: 'UTF-8',
      crs: { crs: { kind: 'epsg', code: 32640 }, source: 'prj_file' },
    });
  });

  test('tells each format apart, one entry for each file that is not a sidecar, in order', async ({
    page,
  }) => {
    await importFiles(page, 'mixed.geojson', 'grid.asc', 'mesh.obj', 'lines.csv', 'blocks.csv');
    const result = await seen(page);
    expect(result.entries.map((entry) => [entry.file, entry.format, entry.kind])).toEqual([
      ['mixed.geojson', 'geojson', undefined],
      ['grid.asc', 'ascii_grid', 'grid'],
      ['mesh.obj', 'obj', 'mesh'],
      ['lines.csv', 'csv', 'lines'],
      ['blocks.csv', 'csv', 'blocks'],
    ]);
  });

  test('keeps a projection file with no data file as a file of its own, which cannot be imported', async ({
    page,
  }) => {
    await importFiles(page, 'esri.prj');
    const result = await seen(page);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ file: 'esri.prj', format: 'prj' });
  });

  test('says what is wrong with a file the kernel cannot read, as findings and not as a failure', async ({
    page,
  }) => {
    await importFiles(page, {
      name: 'data.shp',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0, 0, 1]),
    });
    const result = await seen(page);
    expect(result.failure).toBeUndefined();
    expect(result.entries[0]).toMatchObject({
      file: 'data.shp',
      format: undefined,
      findings: ['file.format.unrecognized'],
    });
  });

  test('forgets what it read when it is closed, and reads the next files afresh', async ({
    page,
  }) => {
    await importFiles(page, 'points.csv');
    expect((await seen(page)).entries.map((entry) => entry.file)).toEqual(['points.csv']);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    // It forgets when the browser tells it the dialog has closed, a moment after the dialog is hidden.
    await expect
      .poll(() =>
        wizard(page).evaluate((element) => (element as unknown as Internals).entries === undefined),
      )
      .toBe(true);
    await importFiles(page, 'grid.asc');
    expect((await seen(page)).entries.map((entry) => entry.file)).toEqual(['grid.asc']);
  });

  test('says why when the engine fails, and ignores an answer that comes after the files were changed', async ({
    page,
  }) => {
    const outcome = await wizard(page).evaluate(async (element) => {
      const target = element as unknown as {
        engine: unknown;
        show: (files: File[]) => void;
        entries: unknown;
        failure: string | undefined;
        updateComplete: Promise<boolean>;
      };
      const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

      // An engine that fails.
      target.engine = { preview: () => Promise.reject(new Error('The module did not start.')) };
      target.show([new File(['x'], 'a.csv')]);
      await pause();
      const failed = target.failure;

      // An engine that answers the first files only after it has been given others.
      let answerFirst: (value: unknown) => void = () => undefined;
      const answers = [
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
        Promise.resolve([{ fileName: 'second.csv', findings: [] }]),
      ];
      let call = 0;
      target.engine = { preview: () => answers[call++] };
      target.show([new File(['x'], 'first.csv')]);
      target.show([new File(['x'], 'second.csv')]);
      await pause();
      answerFirst([{ fileName: 'first.csv', findings: [] }]);
      await pause();
      const names = (target.entries as { preview: { fileName: string } }[]).map(
        (entry) => entry.preview.fileName,
      );
      return { failed, names };
    });
    expect(outcome.failed).toBe('The module did not start.');
    expect(outcome.names).toEqual(['second.csv']);
  });
});
