import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

/** The parts of the Nodata step. */
function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  const step = host.locator('karmania-nodata-step');
  return {
    host,
    dialog: host.locator('dialog'),
    step,
    words: step.locator('.words k-checkbox'),
    numbers: step.locator('.numbers k-checkbox'),
    wordBoxes: step.locator('.words input'),
    numberBoxes: step.locator('.numbers input'),
    other: step.locator('k-input'),
    otherInput: step.locator('k-input input'),
    coordinates: step.locator('k-select').nth(0),
    coordinatesSelect: step.locator('k-select').nth(0).locator('select'),
    decimals: step.locator('k-select').nth(1),
    decimalsSelect: step.locator('k-select').nth(1).locator('select'),
    note: step.locator('.note'),
    next: host.locator('k-button[slot="footer-end"]').nth(1),
    back: host.locator('k-button[slot="footer-end"]').nth(0),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Imports files, and goes on through the File and Mapping steps to the Nodata step. */
async function nodataOf(page: Page, ...picks: Pick[]): Promise<void> {
  const p = parts(page);
  await pickFiles(
    page,
    async () => {
      await page.locator('karmania-app header.toolbar k-button button').click();
    },
    picks,
  );
  await expect(p.host.locator('karmania-file-step')).toBeVisible();
  await p.next.click();
  await expect(p.host.locator('karmania-mapping-step')).toBeVisible();
  await p.next.click();
  await expect(p.host.locator('.step[data-step="nodata"]')).toBeVisible();
}

const draftOf = <T>(page: Page, pick: string): Promise<T> =>
  parts(page).host.evaluate(
    (element, path) =>
      path
        .split('.')
        .reduce(
          (value: unknown, key) => (value as Record<string, unknown>)[key],
          (element as unknown as { draft: unknown }).draft,
        ),
    pick,
  ) as Promise<T>;

const textsOf = (locator: Locator): Promise<string[]> =>
  locator.evaluateAll((all) =>
    all.map((element) => element.textContent.trim().replace(/\s+/g, ' ')),
  );

test.describe('the Nodata step', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('offers the words and numbers the kernel found, ticked, with how often the preview had each', async ({
    page,
  }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    await expect(p.words).toHaveCount(1);
    expect(await textsOf(p.words)).toEqual(['(empty cell)']);
    expect(await textsOf(p.words.locator('.detail'))).toEqual(['1 in the preview']);
    await expect(p.wordBoxes.first()).toBeChecked();
    await expect(p.numbers).toHaveCount(1);
    expect(await textsOf(p.numbers)).toEqual(['-999']);
    expect(await textsOf(p.numbers.locator('.detail'))).toEqual(['1 in the preview']);
    await expect(p.numberBoxes.first()).toBeChecked();
  });

  test('keeps what a person unticks and ticks again', async ({ page }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    await p.wordBoxes.first().click();
    await expect(p.wordBoxes.first()).not.toBeChecked();
    expect(await draftOf<boolean>(page, 'nodata.tokens.0.use')).toBe(false);
    expect(await draftOf<boolean>(page, 'nodata.numbers.0.use')).toBe(true);
    await p.numbers.first().locator('.text').click();
    expect(await draftOf<boolean>(page, 'nodata.numbers.0.use')).toBe(false);
    await p.wordBoxes.first().click();
    expect(await draftOf<boolean>(page, 'nodata.tokens.0.use')).toBe(true);
    // And it is as it was left when the step is left and come back to.
    await p.back.click();
    await p.next.click();
    await expect(p.wordBoxes.first()).toBeChecked();
    await expect(p.numberBoxes.first()).not.toBeChecked();
  });

  test('takes other values, and says how they are read', async ({ page }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    await expect(p.other.locator('.help')).toContainText('Separate them with commas.');
    await p.otherInput.fill('-1, none');
    await expect(p.other.locator('.help')).toHaveText('Read as the word "none" and the number -1.');
    expect(await draftOf<string>(page, 'nodata.other')).toBe('-1, none');
    await p.otherInput.fill('');
    await expect(p.other.locator('.help')).toContainText('Separate them with commas.');
  });

  test('stops at an empty coordinate unless a person says to skip the row', async ({ page }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    expect(await p.coordinatesSelect.inputValue()).toBe('error');
    await expect(p.coordinatesSelect.locator('option')).toHaveText([
      'Stop with an error',
      'Skip the row, and count it',
    ]);
    await expect(p.coordinates.locator('.help')).toHaveText(
      'A row that is skipped is counted in a warning.',
    );
    await p.coordinatesSelect.selectOption('skip');
    expect(await draftOf<string>(page, 'emptyCoordinates')).toBe('skip');
  });

  test('starts with the decimal mark the kernel found, and lets it be changed', async ({
    page,
  }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    expect(await p.decimalsSelect.inputValue()).toBe('.');
    await expect(p.decimalsSelect.locator('option')).toHaveText(['A point (1.5)', 'A comma (1,5)']);
    await p.decimalsSelect.selectOption(',');
    expect(await draftOf<string>(page, 'decimalSeparator')).toBe(',');

    // A file that writes its numbers with commas.
    await page.goto('/');
    await nodataOf(page, {
      name: 'comma.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('x;y;v\n1,5;2,5;3,5\n4,5;5,5;6,5\n'),
    });
    expect(await p.decimalsSelect.inputValue()).toBe(',');
  });

  test('says when the preview found nothing that looks like no data', async ({ page }) => {
    const p = parts(page);
    await nodataOf(page, 'lines.csv');
    await expect(p.step.locator('.none')).toHaveCount(2);
    await expect(p.step.locator('.none').first()).toHaveText('None found in the preview.');
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test('says that a file without columns has no such values to set', async ({ page }) => {
    const p = parts(page);
    for (const [file, text] of [
      ['mixed.geojson', /A GeoJSON file has no values that mean "no data"/],
      ['grid.asc', /An ESRI ASCII grid says in its header which value means "no data"/],
      ['mesh.obj', /An OBJ file has no values that mean "no data"/],
    ] as const) {
      await page.goto('/');
      await nodataOf(page, file);
      await expect(p.note, file).toContainText(text);
      await expect(p.words, file).toHaveCount(0);
      await expect(p.next.locator('button'), file).toBeEnabled();
    }
  });

  test('never keeps a person from going on: every choice here is a choice', async ({ page }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    await p.wordBoxes.first().click();
    await p.numberBoxes.first().click();
    await p.otherInput.fill('???');
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test('lays the two lists side by side, the fields under them in a row of two, all in one column of edges', async ({
    page,
  }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    const [words, numbers, other, coordinates, decimals] = await Promise.all([
      rect(p.step.locator('.words')),
      rect(p.step.locator('.numbers')),
      rect(p.other),
      rect(p.coordinates),
      rect(p.decimals),
    ]);
    expect(words.y).toBe(numbers.y);
    expect(words.x + words.width).toBeLessThan(numbers.x);
    expect(other.x).toBe(words.x);
    expect(coordinates.x).toBe(words.x);
    expect(coordinates.y).toBe(decimals.y);
    expect(coordinates.height).toBe(decimals.height);
    expect(decimals.x - (coordinates.x + coordinates.width)).toBe(16);
    expect(decimals.x + decimals.width).toBeCloseTo(other.x + other.width, 0);
  });

  test('moves nothing above what a person types as other values', async ({ page }) => {
    const p = parts(page);
    await nodataOf(page, 'points.csv');
    const before = [
      await rect(p.step.locator('.words')),
      await rect(p.step.locator('.numbers')),
      await rect(p.other),
    ];
    await p.otherInput.fill('-1, none, n/a, null, nil, nothing');
    expect([
      await rect(p.step.locator('.words')),
      await rect(p.step.locator('.numbers')),
      await rect(p.other),
    ]).toEqual(before);
  });

  test('fits the smallest window with nothing overflowing, even with long words typed', async ({
    page,
  }) => {
    const p = parts(page);
    await page.setViewportSize({ width: 1024, height: 640 });
    await nodataOf(page, 'points.csv');
    await p.otherInput.fill(
      'a_very_long_word_that_means_no_data_in_some_files_and_does_not_fit_in_the_field, -1',
    );
    await assertNoOverflow(p.dialog);
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await nodataOf(page, 'points.csv');
      await expectNoSeriousViolations(page);
    });
  }
});
