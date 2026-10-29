import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertAligned, assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

/** The parts of the File step. */
function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  const step = host.locator('karmania-file-step');
  return {
    host,
    dialog: host.locator('dialog'),
    step,
    rows: step.locator('.file'),
    row: (name: string) => step.locator(`.file[data-file="${name}"]`),
    settings: step.locator('.settings'),
    kind: step.locator('k-select'),
    kindSelect: step.locator('k-select select'),
    name: step.locator('k-input'),
    nameInput: step.locator('k-input input'),
    findings: step.locator('.about karmania-findings'),
    reading: host.locator('.reading'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    note: host.locator('span[slot="footer-note"]'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Imports files the way a person does, and waits for the wizard to have read them. */
async function importFiles(page: Page, ...picks: Pick[]): Promise<void> {
  await pickFiles(
    page,
    async () => {
      await page.locator('karmania-app header.toolbar k-button button').click();
    },
    picks,
  );
  await expect(parts(page).dialog).toBeVisible();
  await expect(parts(page).step).toBeVisible();
}

/** Opens the wizard on files that a fake engine answers for, or never answers for. */
async function importWithFakeEngine(page: Page, mode: 'never' | 'fails'): Promise<void> {
  await page.locator('karmania-import-dialog').evaluate((element, how) => {
    const target = element as unknown as {
      engine: unknown;
      show: (files: File[]) => void;
    };
    target.engine = {
      preview: () =>
        how === 'never'
          ? new Promise(() => undefined)
          : Promise.reject(new Error('The module did not start.')),
    };
    target.show([new File(['x'], 'a.csv')]);
  }, mode);
  await expect(parts(page).dialog).toBeVisible();
}

const texts = (locator: Locator): Promise<string[]> =>
  locator.evaluateAll((all) =>
    all.map((element) => element.textContent.trim().replace(/\s+/g, ' ')),
  );

test.describe('the File step', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('lists a CSV file with what the kernel found in it, and has its settings under it', async ({
    page,
  }) => {
    const p = parts(page);
    await importFiles(page, 'points.csv');
    await expect(p.step.locator('h3').first()).toHaveText('File');
    await expect(p.rows).toHaveCount(1);
    await expect(p.row('points.csv').locator('.name')).toHaveText('points.csv');
    await expect(p.row('points.csv').locator('.detail')).toHaveText(
      'CSV · UTF-8 · comma-separated · about 8 rows',
    );
    // One file needs no "importing now".
    await expect(p.row('points.csv').locator('.status')).toHaveCount(0);
    await expect(p.step.locator('.about h3')).toHaveText('Settings for points.csv');
    await expect(p.nameInput).toHaveValue('points');
    expect(await p.kindSelect.inputValue()).toBe('points');
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
  });

  test('says which projection file goes with a data file', async ({ page }) => {
    const p = parts(page);
    await importFiles(page, 'points.csv', 'points.prj');
    await expect(p.rows).toHaveCount(1);
    await expect(p.row('points.csv').locator('.detail')).toHaveText(
      'CSV · UTF-8 · comma-separated · about 8 rows · with points.prj',
    );
  });

  test('offers a CSV file points, lines and a block model, and starts at what the kernel suggested', async ({
    page,
  }) => {
    const p = parts(page);
    for (const [file, kind] of [
      ['points.csv', 'points'],
      ['lines.csv', 'lines'],
      ['blocks.csv', 'blocks'],
    ] as const) {
      await page.goto('/');
      await importFiles(page, file);
      await expect(p.kindSelect.locator('option')).toHaveText(['Points', 'Lines', 'Block model']);
      expect(await p.kindSelect.inputValue(), file).toBe(kind);
      await expect(p.kindSelect).toBeEnabled();
    }
  });

  test('offers only what the format can be: a grid, a mesh, and for GeoJSON no choice at all', async ({
    page,
  }) => {
    const p = parts(page);
    for (const [file, option, help] of [
      ['grid.asc', 'Grid', /always imported as a grid/],
      ['mesh.obj', 'Mesh', /always imported as a mesh/],
      ['mixed.geojson', 'Decided by the shapes in the file', /several kinds of shape/],
    ] as const) {
      await page.goto('/');
      await importFiles(page, file);
      await expect(p.kindSelect.locator('option'), file).toHaveText([option]);
      await expect(p.kindSelect, file).toBeDisabled();
      await expect(p.kind.locator('.help'), file).toHaveText(help);
    }
  });

  test('keeps the name a person types, and cannot go on without one, saying why', async ({
    page,
  }) => {
    const p = parts(page);
    await importFiles(page, 'points.csv');
    await p.nameInput.fill('Collars 2024');
    await expect(p.next.locator('button')).toBeEnabled();
    expect(
      await p.host.evaluate(
        (element) => (element as unknown as { draft: { datasetName: string } }).draft.datasetName,
      ),
    ).toBe('Collars 2024');

    await p.nameInput.fill('   ');
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('Give the dataset a name.');
    await expect(p.name.locator('.error')).toHaveText('Give the dataset a name.');
    await expect(p.nameInput).toHaveAttribute('aria-invalid', 'true');

    await p.nameInput.fill('Collars');
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
    await expect(p.name.locator('.error')).toHaveCount(0);
  });

  test('keeps the kind a person chooses', async ({ page }) => {
    const p = parts(page);
    await importFiles(page, 'points.csv');
    await p.kindSelect.selectOption('blocks');
    expect(
      await p.host.evaluate(
        (element) => (element as unknown as { draft: { kind: string } }).draft.kind,
      ),
    ).toBe('blocks');
    expect(await p.kindSelect.inputValue()).toBe('blocks');
  });

  test('lists several files in order, the first that can be imported first, and says what is to become of each', async ({
    page,
  }) => {
    const p = parts(page);
    await importFiles(page, 'esri.prj', 'points.csv', 'lines.csv', {
      name: 'data.shp',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0, 0, 1]),
    });
    await expect(p.step.locator('h3').first()).toHaveText('Files');
    await expect(p.rows).toHaveCount(4);
    expect(await texts(p.rows.locator('.name'))).toEqual([
      'esri.prj',
      'points.csv',
      'lines.csv',
      'data.shp',
    ]);
    expect(await texts(p.rows.locator('.status'))).toEqual([
      'Cannot be imported',
      'Importing now',
      'Waiting',
      'Cannot be imported',
    ]);
    // The ones that cannot be imported say why.
    await expect(p.row('esri.prj').locator('karmania-findings li')).toHaveCount(1);
    await expect(
      p.row('data.shp').locator('karmania-findings li[data-severity="error"]'),
    ).toHaveCount(1);
    // And the settings are for the first that can be.
    await expect(p.step.locator('.about h3')).toHaveText('Settings for points.csv');
    await expect(p.nameInput).toHaveValue('points');
  });

  test('cannot go on when no file can be imported, and says so', async ({ page }) => {
    const p = parts(page);
    await importFiles(page, 'esri.prj');
    await expect(p.settings).toHaveCount(0);
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('None of these files can be imported.');
  });

  test('shows what the kernel found out about the file that a person ought to know', async ({
    page,
  }) => {
    const p = parts(page);
    // Written in Windows-1252, not UTF-8: the kernel reads it, and says so.
    await importFiles(page, {
      name: 'cafe.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([0x78, 0x2c, 0x79, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x2c, 0x31, 0x0a]),
    });
    await expect(p.row('cafe.csv').locator('.detail')).toContainText('Windows-1252');
    await expect(p.findings.locator('li[data-severity="warning"]')).toHaveCount(1);
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test('says that it is reading while the engine has not answered, and cannot go on', async ({
    page,
  }) => {
    const p = parts(page);
    await importWithFakeEngine(page, 'never');
    await expect(p.reading).toHaveText('Reading the files…');
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('Reading the files…');
  });

  test('says why when the engine could not read the files, and cannot go on', async ({ page }) => {
    const p = parts(page);
    await importWithFakeEngine(page, 'fails');
    await expect(p.host.locator('.step karmania-findings li[data-severity="error"]')).toContainText(
      'The module did not start.',
    );
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('The files could not be read.');
  });

  test('lines the list up with the settings, and sets the two fields side by side, of one height', async ({
    page,
  }) => {
    const p = parts(page);
    await importFiles(page, 'points.csv');
    await assertAligned(
      [p.step.locator('.files ul'), p.settings, p.step.locator('h3').first()],
      'left',
    );
    const [kind, name] = [await rect(p.kind), await rect(p.name)];
    expect(kind.y).toBe(name.y);
    expect(kind.height).toBe(name.height);
    expect(kind.x + kind.width).toBeLessThan(name.x);
    expect(name.x - (kind.x + kind.width)).toBe(16);
  });

  test('keeps a very long file name and a very long dataset name inside, cut with an ellipsis', async ({
    page,
  }) => {
    const p = parts(page);
    const long = `${'a-very-long-name-'.repeat(7)}.csv`;
    await page.setViewportSize({ width: 1024, height: 640 });
    await importFiles(page, {
      name: long,
      mimeType: 'text/csv',
      buffer: Buffer.from('x,y\n1,2\n'),
    });
    await expect(p.row(long).locator('.name')).toHaveAttribute('title', long);
    expect(
      await p
        .row(long)
        .locator('.name')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    await assertNoOverflow(p.dialog);
    // The same for the heading over the settings.
    await assertNoOverflow(p.step);
  });

  test('has no serious accessibility violations (light and dark)', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
      await page.goto(`/?theme=${theme}`);
      await importFiles(page, 'points.csv', 'esri.prj');
      await expectNoSeriousViolations(page);
    }
  });
});
