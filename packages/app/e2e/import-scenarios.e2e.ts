/**
 * The import wizard from start to finish, as a person uses it: one journey for each kind of thing a
 * person brings. Each goes through the real steps with the real engine and kernel, and ends by
 * looking at what was loaded.
 */
import { expect, test } from '@playwright/test';
import type { Pick } from './support/picker.js';
import { goTo, kept, startWizard, textsOf, wizard } from './support/wizard.js';

test.describe('importing', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('a CSV of points, with its projection file: edited on the way, loaded, and shown', async ({
    page,
  }) => {
    const w = wizard(page);
    await expect(w.map).toContainText('No data yet');

    // File: the kernel found points, and a person names the dataset.
    await startWizard(page, 'points.csv', 'points.prj');
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText(
      'CSV · UTF-8 · comma-separated · about 8 rows · with points.prj',
    );
    await expect(w.host.locator('karmania-file-step k-select select')).toHaveValue('points');
    await w.host.locator('karmania-file-step k-input input').fill('Drill collars');
    await goTo(page, 'mapping');

    // Mapping: the coordinates were found; the rock is not wanted, and the grade gets a better name.
    const mapping = w.host.locator('karmania-mapping-step');
    const roles = mapping.locator('thead select');
    expect(
      await roles.evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value)),
    ).toEqual(['x', 'y', 'z', 'attribute', 'attribute', 'attribute']);
    await roles.nth(5).selectOption('ignore');
    await mapping.locator('thead .column-name').nth(4).click();
    await mapping.locator('.details k-input input').fill('Gold');
    await goTo(page, 'nodata');

    // Nodata: what the kernel suggested stays as it was.
    await expect(w.host.locator('karmania-nodata-step .words input')).toBeChecked();
    await expect(w.host.locator('karmania-nodata-step .numbers input')).toBeChecked();
    await goTo(page, 'crs');

    // CRS: from the projection file.
    await expect(w.host.locator('karmania-crs-step .found-text')).toHaveText(
      'Found EPSG 32640, from the .prj file points.prj.',
    );
    await goTo(page, 'review');

    // Review: it works, and nothing is wrong.
    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    expect(await textsOf(review.locator('.dataset'))).toEqual(['Drill collars 8 points']);
    await expect(w.next).toHaveText('Load');
    await w.next.click();

    // Loaded: the dialog has gone, the Data tab is open, the map area has been told.
    await expect(w.dialog).toBeHidden();
    await expect(w.map).toContainText('1 dataset loaded');
    await expect(w.tabs.filter({ hasText: 'Data' })).toHaveAttribute('aria-selected', 'true');
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'Drill collars',
      kind: 'points',
      elementCount: 8,
      hasZ: true,
      crs: { kind: 'epsg', code: 32640 },
      findings: [],
    });
    expect(result.selected).toBe(dataset?.id);
    expect(result.inEngine).toEqual([dataset?.id]);
    // The rock is not there, and the grade has the name that was given; its -999 and its empty cell
    // are the two nulls.
    expect(dataset?.columns.map((column) => column.name)).toEqual(['Hole', 'Gold']);
    expect(dataset?.columns.find((column) => column.name === 'Gold')).toMatchObject({
      type: 'float',
      nullCount: 2,
    });
    expect(dataset?.bbox).toEqual({
      min: [500010.5, 2765020.25, 109.3],
      max: [500185.5, 2765205.25, 120.4],
    });
  });

  test('a CSV with a coordinate missing: stopped by the kernel, fixed in the wizard, checked again, loaded', async ({
    page,
  }) => {
    const w = wizard(page);
    // Semicolons, decimal commas; the second row has no northing, and the third an NA for its grade.
    const survey: Pick = {
      name: 'survey.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Easting;Northing;Level;Grade',
          '500000,5;2765000,25;100,5;1,2',
          '500010,5;;101,5;1,4',
          '500020,5;2765020,25;102,5;NA',
          '500030,5;2765030,25;103,5;2,1',
          '',
        ].join('\n'),
      ),
    };
    const projection: Pick = {
      name: 'survey.prj',
      mimeType: 'text/plain',
      buffer: Buffer.from('PROJCS["GDA94 / MGA zone 50",AUTHORITY["EPSG","28350"]]'),
    };

    await startWizard(page, survey, projection);
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText(
      'CSV · UTF-8 · semicolon-separated · about 4 rows · with survey.prj',
    );
    await goTo(page, 'mapping');

    // Mapping: the kernel knows the easting and northing; the level is said to be the height.
    const mapping = w.host.locator('karmania-mapping-step');
    const roles = mapping.locator('thead select');
    const values = () =>
      roles.evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value));
    expect((await values()).slice(0, 2)).toEqual(['x', 'y']);
    await roles.nth(2).selectOption('z');
    expect(await values()).toEqual(['x', 'y', 'z', 'attribute']);
    await goTo(page, 'nodata');

    // Nodata: the kernel read the numbers with commas, and found the NA.
    const nodata = w.host.locator('karmania-nodata-step');
    await expect(nodata.locator('k-select').nth(1).locator('select')).toHaveValue(',');
    await expect(nodata.locator('.words')).toContainText('NA');
    await goTo(page, 'crs');
    await goTo(page, 'review');

    // Review: stopped. Nothing is loaded, and the error says which step can fix it.
    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Nothing was loaded');
    await expect(review.locator('.group[data-severity="error"] li')).toHaveCount(1);
    await expect(review.locator('.group[data-severity="error"] li')).toContainText('Northing');
    await expect(w.next).toHaveText('Load');
    await expect(w.next.locator('button')).toBeDisabled();
    expect((await kept(page)).inEngine).toEqual([]);

    // Fix: go to the step the error names, say to skip rows with an empty coordinate, and check again.
    await review.getByRole('button', { name: 'Fix in the Nodata step' }).click();
    await expect(w.step).toHaveAttribute('data-step', 'nodata');
    await expect(w.next).toHaveText('Check again');
    await nodata.locator('k-select').first().locator('select').selectOption('skip');
    await w.next.click();
    await expect(w.step).toHaveAttribute('data-step', 'review');

    // Now it works, with a warning that a row was left out.
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    await expect(review.locator('.group[data-severity="warning"] li').first()).toBeVisible();
    await expect(w.next).toHaveText(/^\s*Load with \d+ warnings?\s*$/);
    expect(await textsOf(review.locator('.dataset'))).toEqual(['survey 3 points']);
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'survey',
      kind: 'points',
      elementCount: 3,
      hasZ: true,
      crs: { kind: 'epsg', code: 28350 },
    });
    // The NA is a null, and the numbers with commas were read as numbers.
    expect(dataset?.columns).toEqual([{ name: 'Grade', type: 'float', nullCount: 1 }]);
    expect(dataset?.bbox).toEqual({
      min: [500000.5, 2765000.25, 100.5],
      max: [500030.5, 2765030.25, 103.5],
    });
    expect(result.inEngine).toEqual([dataset?.id]);
  });

  test('a GeoJSON file with three kinds of shape: a dataset for each, in the coordinate system it assumes', async ({
    page,
  }) => {
    const w = wizard(page);
    await startWizard(page, 'mixed.geojson');
    // File: nothing to choose, since the shapes in the file decide.
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText('GeoJSON · UTF-8');
    await expect(w.host.locator('karmania-file-step k-select select')).toBeDisabled();
    await goTo(page, 'mapping');
    await expect(w.host.locator('karmania-mapping-step .note')).toContainText(
      'no columns to set up',
    );
    await goTo(page, 'nodata');
    await expect(w.host.locator('karmania-nodata-step .note')).toContainText('a null is a null');
    await goTo(page, 'crs');
    // CRS: the default of GeoJSON, which the step says is assumed, and a person keeps.
    await expect(w.host.locator('karmania-crs-step .found-text')).toHaveText(
      'Found EPSG 4326, from the GeoJSON default, which is assumed because the file names none.',
    );
    await goTo(page, 'review');

    // Review: three datasets, one of each kind of shape, and notes about how they were made.
    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    await expect(review.locator('.dataset')).toHaveCount(3);
    await expect(review.locator('.group[data-severity="info"]')).toBeVisible();
    await expect(review.locator('.group[data-severity="error"]')).toHaveCount(0);
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    await expect(w.map).toContainText('3 datasets loaded');
    const result = await kept(page);
    expect(result.datasets.map((dataset) => dataset.kind).sort()).toEqual([
      'lines',
      'points',
      'polygons',
    ]);
    const byKind = (kind: string) => result.datasets.find((dataset) => dataset.kind === kind);
    // One of the two points has a height and the other does not, so the dataset has none.
    expect(byKind('points')).toMatchObject({ elementCount: 2, hasZ: false });
    expect(byKind('lines')).toMatchObject({ elementCount: 1 });
    expect(byKind('polygons')).toMatchObject({ elementCount: 1 });
    for (const dataset of result.datasets) {
      expect(dataset.crs).toEqual({ kind: 'epsg', code: 4326 });
      expect(dataset.name).toContain('mixed');
      // Each says that the coordinate system was assumed.
      expect(dataset.findings).toContain('geojson.crs.assumed');
    }
    // The first one made is the one selected, and all three are in the engine.
    expect(result.selected).toBe(result.datasets[0]?.id);
    expect(result.inEngine).toEqual(result.datasets.map((dataset) => dataset.id));
  });

  test('an ESRI ASCII grid with no coordinate system: one is typed, the cell with no data is a null, and a grid is loaded', async ({
    page,
  }) => {
    const w = wizard(page);
    await startWizard(page, 'grid.asc');
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText(
      'ESRI ASCII grid · UTF-8',
    );
    // A grid is a grid: the kind cannot be changed.
    await expect(w.host.locator('karmania-file-step k-select select')).toBeDisabled();
    await expect(w.host.locator('karmania-file-step k-select .help')).toContainText(
      'always imported as a grid',
    );
    await goTo(page, 'mapping');
    await expect(w.host.locator('karmania-mapping-step .note')).toContainText(
      'its cells are the values of the grid',
    );
    await goTo(page, 'nodata');
    await expect(w.host.locator('karmania-nodata-step .note')).toContainText(
      'says in its header which value means "no data"',
    );
    await goTo(page, 'crs');

    // CRS: nothing was found, so Next waits until a person says what the coordinates are in.
    const crs = w.host.locator('karmania-crs-step');
    await expect(crs.locator('.found-text')).toHaveText(
      'No coordinate system was found in or beside the file.',
    );
    await expect(w.next.locator('button')).toBeDisabled();
    await crs.locator('.choice k-select').first().locator('select').selectOption('epsg');
    await crs.locator('k-input input').fill('32640');
    await goTo(page, 'review');

    // Review: it loads, and says that the cell with no data became a null.
    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    expect(await textsOf(review.locator('.dataset'))).toEqual(['grid 12 cells']);
    await expect(review.locator('.group[data-severity="warning"] li')).toContainText('no data');
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'grid',
      kind: 'grid',
      elementCount: 12,
      crs: { kind: 'epsg', code: 32640 },
    });
    // The grid's one column is its values, with the cell that had -9999 left empty.
    expect(dataset?.columns).toHaveLength(1);
    expect(dataset?.columns[0]?.nullCount).toBe(1);
    // 4 by 3 cells of 10, from the corner given: the box is the grid's outer edge.
    expect(dataset?.bbox).toEqual({
      min: [500000, 2765000, 0],
      max: [500040, 2765030, 0],
    });
  });

  test('an OBJ mesh: a local grid in metres is chosen, the square base is split into triangles, and a mesh is loaded', async ({
    page,
  }) => {
    const w = wizard(page);
    await startWizard(page, 'mesh.obj');
    await expect(w.host.locator('karmania-file-step .detail')).toHaveText('OBJ mesh · UTF-8');
    await expect(w.host.locator('karmania-file-step k-select select')).toBeDisabled();
    await expect(w.host.locator('karmania-file-step k-select .help')).toContainText(
      'always imported as a mesh',
    );
    await goTo(page, 'mapping');
    await expect(w.host.locator('karmania-mapping-step .note')).toContainText(
      'vertices and faces of a mesh',
    );
    await goTo(page, 'nodata');
    await goTo(page, 'crs');

    // CRS: a model like this one has no place on the Earth, so it is a local grid, in metres.
    const crs = w.host.locator('karmania-crs-step');
    await expect(w.next.locator('button')).toBeDisabled();
    await expect(w.note).toHaveText('Choose a coordinate system: an EPSG code, or a local grid.');
    await crs.locator('.choice k-select').first().locator('select').selectOption('local');
    await expect(crs.locator('.summary-text')).toContainText('a local grid, in metres');
    await goTo(page, 'review');

    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    // Five vertices; four triangles and a square, which is two more.
    expect(await textsOf(review.locator('.dataset'))).toEqual(['mesh 6 triangles']);
    await expect(review.locator('.group[data-severity="info"] li').first()).toBeVisible();
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'mesh',
      kind: 'mesh',
      elementCount: 6,
      vertexCount: 5,
      hasZ: true,
      crs: { kind: 'local', units: 'm' },
    });
    expect(dataset?.bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 8] });
    expect(result.selected).toBe(dataset?.id);
  });

  test('a block model: the size of a block is asked for, the centres become a lattice, and blocks are loaded', async ({
    page,
  }) => {
    const w = wizard(page);
    await startWizard(page, 'blocks.csv');
    // File: the kernel saw block centres, and suggests a block model.
    await expect(w.host.locator('karmania-file-step k-select select')).toHaveValue('blocks');
    await goTo(page, 'mapping');

    // Mapping: the centres were found, and nothing can go on without the size of a block.
    const mapping = w.host.locator('karmania-mapping-step');
    expect(
      await mapping
        .locator('thead select')
        .evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value)),
    ).toEqual(['x', 'y', 'z', 'attribute', 'attribute']);
    await expect(mapping.locator('.problems li')).toContainText('The block size is missing.');
    await expect(w.next.locator('button')).toBeDisabled();
    await expect(w.note).toHaveText('The block size is missing.');
    const sizes = mapping.locator('.block-size input');
    await sizes.nth(0).fill('10');
    await sizes.nth(1).fill('ten');
    await expect(mapping.locator('.block-size .error')).toHaveText('Enter a number above 0.');
    await expect(w.next.locator('button')).toBeDisabled();
    await sizes.nth(1).fill('10');
    await sizes.nth(2).fill('10');
    await expect(mapping.locator('.problems li')).toHaveCount(0);
    await goTo(page, 'nodata');
    await goTo(page, 'crs');

    // CRS: nothing was found; the code is typed.
    const crs = w.host.locator('karmania-crs-step');
    await crs.locator('.choice k-select').first().locator('select').selectOption('epsg');
    await crs.locator('k-input input').fill('32640');
    await goTo(page, 'review');

    const review = w.host.locator('karmania-review-step');
    await expect(review.locator('.verdict')).toHaveText('Ready to load');
    expect(await textsOf(review.locator('.dataset'))).toEqual(['blocks 18 blocks']);
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    const [dataset] = result.datasets;
    expect(dataset).toMatchObject({
      name: 'blocks',
      kind: 'blocks',
      elementCount: 18,
      hasZ: true,
      crs: { kind: 'epsg', code: 32640 },
    });
    expect(dataset?.columns.map((column) => column.name)).toEqual(['Density', 'Domain']);
    expect(dataset?.columns.find((column) => column.name === 'Density')).toMatchObject({
      type: 'float',
      nullCount: 0,
    });
    // 3 by 3 by 2 blocks of 10: the box is the outer edge of the lattice, half a block beyond the centres.
    expect(dataset?.bbox).toEqual({
      min: [500000, 2765000, 90],
      max: [500030, 2765030, 110],
    });
    expect(result.selected).toBe(dataset?.id);
  });

  test('a file with no coordinate system: the wizard will not go on until one is chosen, and the kernel would not load it', async ({
    page,
  }) => {
    const w = wizard(page);
    await startWizard(page, 'points.csv');
    await goTo(page, 'mapping');
    await goTo(page, 'nodata');
    await goTo(page, 'crs');

    const crs = w.host.locator('karmania-crs-step');
    const choice = crs.locator('.choice k-select').first().locator('select');
    // Nothing found, nothing chosen: the way on is closed, and the footer says why.
    await expect(crs.locator('.found-text')).toHaveText(
      'No coordinate system was found in or beside the file.',
    );
    await expect(crs.locator('.summary-text')).toContainText('No coordinate system is chosen yet.');
    await expect(w.next.locator('button')).toBeDisabled();
    await expect(w.note).toHaveText('Choose a coordinate system: an EPSG code, or a local grid.');

    // An EPSG code, but none given yet, and then one that is not a code.
    await choice.selectOption('epsg');
    await expect(w.next.locator('button')).toBeDisabled();
    await expect(w.note).toHaveText('Enter the EPSG code of the coordinate system.');
    await crs.locator('k-input input').fill('WGS84');
    await expect(crs.locator('k-input .error')).toHaveText(
      'An EPSG code is a whole number, such as 32640.',
    );
    await expect(w.next.locator('button')).toBeDisabled();

    // The kernel's own rule, which the wizard keeps a person from reaching: with no coordinate
    // system an import is stopped, and the finding says that the coordinate system step can fix it.
    const refused = await page.evaluate(async () => {
      const app = document.querySelector('karmania-app') as unknown as {
        engine: {
          importFiles: (
            files: File[],
            mapping: unknown,
          ) => Promise<{ status: string; findings?: { code: string; step?: string }[] }>;
        };
      };
      const result = await app.engine.importFiles([new File(['x,y\n1,2\n3,4\n'], 'bare.csv')], {
        datasetName: 'bare',
        kind: 'points',
        columns: [
          { source: 'x', role: 'x' },
          { source: 'y', role: 'y' },
        ],
        nodata: { tokens: [], numbers: [] },
        emptyCoordinates: 'error',
        decimalSeparator: '.',
        crs: null,
      });
      return {
        status: result.status,
        found: (result.findings ?? []).map((finding) => `${finding.code}:${finding.step ?? ''}`),
      };
    });
    expect(refused.status).toBe('blocked');
    expect(refused.found).toContain('crs.missing:crs');
    expect((await kept(page)).inEngine).toEqual([]);

    // A local grid is a choice, and a person can make it: the way on opens.
    await choice.selectOption('local');
    await crs.locator('.choice k-select').nth(1).locator('select').selectOption('ft');
    await expect(w.next.locator('button')).toBeEnabled();
    await expect(w.note).toHaveCount(0);
    await expect(crs.locator('.summary-text')).toContainText('a local grid, in feet');
    await goTo(page, 'review');
    await expect(w.host.locator('karmania-review-step .verdict')).toHaveText('Ready to load');
    await w.next.click();

    await expect(w.dialog).toBeHidden();
    const result = await kept(page);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0]).toMatchObject({
      name: 'points',
      kind: 'points',
      crs: { kind: 'local', units: 'ft' },
    });
  });

  test('cancelling a large import: the wizard answers at once, nothing is loaded, and the import can be run again', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const w = wizard(page);
    // Three million rows, built from a chunk of a few thousand so that the page does not hold the whole
    // text in a string, and given to the wizard as the app does when files are dropped on it.
    const rows = 3_000_000;
    await page.evaluate((total) => {
      const chunkRows = 10_000;
      const chunk = Array.from(
        { length: chunkRows },
        (_, i) =>
          `${String(500000 + (i % 1000) + 0.5)},${String(2765000 + Math.floor(i / 1000) + 0.25)},${String(100 + (i % 7))},${String((i % 97) / 10)}\n`,
      ).join('');
      const parts: BlobPart[] = ['x,y,z,grade\n'];
      for (let i = 0; i < total / chunkRows; i += 1) {
        parts.push(chunk);
      }
      const file = new File(parts, 'large.csv', { type: 'text/csv' });
      const prj = new File(['PROJCS["x",AUTHORITY["EPSG","32640"]]'], 'large.prj');
      (
        document.querySelector('karmania-app') as unknown as {
          importFiles: (files: File[]) => void;
        }
      ).importFiles([file, prj]);
    }, rows);
    await expect(w.host.locator('karmania-file-step')).toBeVisible({ timeout: 60_000 });
    await expect(w.host.locator('karmania-file-step .detail')).toContainText(
      'about 3,000,000 rows',
    );
    await goTo(page, 'mapping');
    await goTo(page, 'nodata');
    await goTo(page, 'crs');

    // Frames of the page are watched from here on: while the import goes on in the worker, the page
    // must go on drawing, or a person could not press Cancel.
    await page.evaluate(() => {
      const watch = window as unknown as { longestFrame: number };
      watch.longestFrame = 0;
      let last = performance.now();
      const tick = (now: number) => {
        watch.longestFrame = Math.max(watch.longestFrame, now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const review = w.host.locator('karmania-review-step');
    await w.next.click();
    await expect(w.step).toHaveAttribute('data-step', 'review');
    // The bar is there, with what is being done, and a button to stop it.
    await expect(review.locator('k-progress')).toBeVisible();
    await expect(review.getByRole('button', { name: 'Cancel import' })).toBeVisible();
    await expect(review.locator('k-progress').locator('.percent')).toBeVisible({ timeout: 30_000 });
    await expect(w.next.locator('button')).toBeDisabled();
    await expect(w.note).toHaveText('Importing…');

    const stoppedAt = Date.now();
    await review.getByRole('button', { name: 'Cancel import' }).click();
    await expect(review).toContainText('The import was cancelled. Nothing was loaded.', {
      timeout: 5_000,
    });
    // Stopped within a moment, not after the rest of the file was read.
    expect(Date.now() - stoppedAt).toBeLessThan(5_000);
    await expect(w.next.locator('button')).toBeDisabled();
    await expect(w.note).toContainText('cancelled');
    expect((await kept(page)).inEngine).toEqual([]);
    // A moment later nothing has been loaded by an import that was thought to be stopped.
    await page.waitForTimeout(1_500);
    expect((await kept(page)).inEngine).toEqual([]);

    // It can be run again, and this time it is let finish.
    await review.getByRole('button', { name: 'Import again' }).click();
    await expect(review.locator('.verdict')).toHaveText('Ready to load', { timeout: 90_000 });
    expect(await textsOf(review.locator('.dataset'))).toEqual(['large 3,000,000 points']);
    expect((await kept(page)).inEngine).toHaveLength(1);

    // The page went on drawing through all of it.
    const longest = await page.evaluate(
      () => (window as unknown as { longestFrame: number }).longestFrame,
    );
    expect(longest).toBeLessThan(1_000);

    // And cancelling the wizard now takes the three million points out of the engine again.
    await w.cancel.click();
    await expect(w.dialog).toBeHidden();
    await expect.poll(async () => (await kept(page)).inEngine.length).toBe(0);
    await expect(w.map).toContainText('No data yet');
  });
});
