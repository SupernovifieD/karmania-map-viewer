import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { pickFiles } from './support/picker.js';
import type { Pick } from './support/picker.js';

/** The parts of the coordinate system step. */
function parts(page: Page) {
  const host = page.locator('karmania-import-dialog');
  const step = host.locator('karmania-crs-step');
  return {
    host,
    dialog: host.locator('dialog'),
    step,
    found: step.locator('.found-text'),
    findings: step.locator('karmania-findings li'),
    choice: step.locator('.choice'),
    select: step.locator('.choice k-select select'),
    code: step.locator('.choice k-input'),
    codeInput: step.locator('.choice k-input input'),
    note: host.locator('span[slot="footer-note"]'),
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

/** Imports files, and goes on through the File, Mapping and Nodata steps to the coordinate system step. */
async function crsOf(page: Page, ...picks: Pick[]): Promise<void> {
  const p = parts(page);
  await pickFiles(
    page,
    async () => {
      await page.locator('karmania-app header.toolbar k-button button').click();
    },
    picks,
  );
  await expect(p.host.locator('karmania-file-step')).toBeVisible();
  for (const step of ['mapping', 'nodata', 'crs']) {
    await p.next.click();
    await expect(p.host.locator(`.step[data-step="${step}"]`)).toBeVisible();
  }
}

const draftCrs = (page: Page) =>
  parts(page).host.evaluate(
    (element) =>
      (element as unknown as { draft: { crs: { mode: string | undefined; epsg: string } } }).draft
        .crs,
  );

const optionsOf = (select: Locator): Promise<string[]> =>
  select.locator('option').evaluateAll((all) => all.map((option) => option.textContent.trim()));

/** A GeoJSON file that names its own coordinate system, the old way. */
const GEOJSON_WITH_CRS: Pick = {
  name: 'named.geojson',
  mimeType: 'application/geo+json',
  buffer: Buffer.from(
    JSON.stringify({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32640' } },
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [500000, 2765000] },
        },
      ],
    }),
  ),
};

test.describe('the coordinate system step', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('says which system was found beside the file, and where from, and has it chosen', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv', 'points.prj');
    await expect(p.found).toHaveText('Found EPSG 32640, from the .prj file points.prj.');
    expect(await p.select.inputValue()).toBe('detected');
    expect(await optionsOf(p.select)).toEqual(['The one found: EPSG 32640', 'An EPSG code']);
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
  });

  test('says that the default of GeoJSON is assumed, since the file names none', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'mixed.geojson');
    await expect(p.found).toHaveText(
      'Found EPSG 4326, from the GeoJSON default, which is assumed because the file names none.',
    );
    expect(await p.select.inputValue()).toBe('detected');
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test("says that a GeoJSON file's own crs member was used", async ({ page }) => {
    const p = parts(page);
    await crsOf(page, GEOJSON_WITH_CRS);
    await expect(p.found).toHaveText("Found EPSG 32640, from the file's own crs member.");
  });

  test('says that nothing was found, and that a system has to be chosen before going on', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await expect(p.found).toHaveText('No coordinate system was found in or beside the file.');
    expect(await optionsOf(p.select)).toEqual(['Choose one…', 'An EPSG code']);
    expect(await p.select.inputValue()).toBe('');
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('Choose a coordinate system: an EPSG code, or a local grid.');
    expect(await draftCrs(page)).toMatchObject({ mode: undefined });
  });

  test('says what the kernel found out about a projection file that could not be used', async ({
    page,
  }) => {
    const p = parts(page);
    // A data file with a projection file of the same name that describes a system but gives no code.
    await crsOf(
      page,
      { name: 'esri.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n3,4\n') },
      'esri.prj',
    );
    await expect(p.found).toHaveText('No coordinate system was found in or beside the file.');
    await expect(p.findings.first()).toContainText('does not give an EPSG code');
    await expect(p.next.locator('button')).toBeDisabled();
  });

  test('takes an EPSG code that a person types, as it is given, and cannot go on without one', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await expect(p.codeInput).toBeVisible();
    await expect(p.next.locator('button')).toBeDisabled();
    await expect(p.note).toHaveText('Enter the EPSG code of the coordinate system.');
    await p.codeInput.fill('32640');
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
    expect(await draftCrs(page)).toEqual({ mode: 'epsg', epsg: '32640', units: 'm' });
    // Nothing is said about what the code stands for: the kernel has no list to look it up in.
    await expect(p.step).not.toContainText(/UTM|WGS|zone|projected|geographic/i);
  });

  test('says what is wrong with a code that is not a whole number, and does not go on', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    for (const text of ['32640x', 'EPSG:32640', '3264.5', '0', '1234567']) {
      await p.codeInput.fill(text);
      await expect(p.code.locator('.error'), text).toHaveText(
        'An EPSG code is a whole number, such as 32640.',
      );
      await expect(p.codeInput, text).toHaveAttribute('aria-invalid', 'true');
      await expect(p.next.locator('button'), text).toBeDisabled();
    }
    // An empty field is only missing, not wrong.
    await p.codeInput.fill('');
    await expect(p.code.locator('.error')).toHaveCount(0);
  });

  test('keeps the code that was typed when another choice is made and then this one again', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv', 'points.prj');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('28350');
    await p.select.selectOption('detected');
    await expect(p.codeInput).toHaveCount(0);
    await expect(p.next.locator('button')).toBeEnabled();
    await p.select.selectOption('epsg');
    await expect(p.codeInput).toHaveValue('28350');
  });

  test('moves nothing when the field for a code appears or goes', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    const before = await rect(p.choice);
    const selectBefore = await rect(p.select);
    await p.select.selectOption('epsg');
    await expect(p.codeInput).toBeVisible();
    expect(await rect(p.choice)).toEqual(before);
    expect(await rect(p.select)).toEqual(selectBefore);
    // The field is beside the select, level with it, and of the same height.
    const [select, code] = [await rect(p.step.locator('.choice k-select')), await rect(p.code)];
    expect(code.y).toBe(select.y);
    expect(code.height).toBe(select.height);
  });

  test('goes back to the step before and on again with what was chosen kept', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('32640');
    await p.back.click();
    await p.next.click();
    expect(await p.select.inputValue()).toBe('epsg');
    await expect(p.codeInput).toHaveValue('32640');
  });

  test('fits the smallest window with nothing overflowing', async ({ page }) => {
    const p = parts(page);
    await page.setViewportSize({ width: 1024, height: 640 });
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('3264x');
    await assertNoOverflow(p.dialog);
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await crsOf(page, 'points.csv');
      await p(page).select.selectOption('epsg');
      await p(page).codeInput.fill('3264x');
      await expectNoSeriousViolations(page);
    });
  }
});

const p = parts;
