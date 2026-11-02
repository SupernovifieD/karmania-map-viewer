import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';
import { textsOf } from './support/wizard.js';
import { fixturePath, pickFiles } from './support/picker.js';
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
    select: step.locator('.choice k-select').first().locator('select'),
    code: step.locator('.choice k-input'),
    codeInput: step.locator('.choice k-input input'),
    box: step.locator('.matches'),
    hint: step.locator('.matches-note'),
    rows: step.locator('.match'),
    names: step.locator('.match-name'),
    details: step.locator('.match-detail'),
    radios: step.locator('.match input'),
    units: step.locator('.choice k-select').nth(1),
    unitsSelect: step.locator('.choice k-select').nth(1).locator('select'),
    summary: step.locator('.summary-text'),
    summaryIcon: step.locator('.summary k-icon'),
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
      (
        element as unknown as {
          draft: { crs: { mode: string | undefined; epsg: string; query: string } };
        }
      ).draft.crs,
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
    await expect(p.found).toHaveText(
      'Found EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres), from the .prj file points.prj.',
    );
    expect(await p.select.inputValue()).toBe('detected');
    expect(await optionsOf(p.select)).toEqual([
      'The one found: EPSG 32640',
      'An EPSG code',
      'A local grid',
    ]);
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
  });

  test('keeps what it says in its box when the file it names has 120 characters and nowhere to break', async ({
    page,
  }) => {
    const p = parts(page);
    const name = 'a_file_name_'.repeat(10).slice(0, 120);
    await crsOf(
      page,
      {
        name: `${name}.csv`,
        mimeType: 'text/csv',
        buffer: readFileSync(fixturePath('points.csv')),
      },
      {
        name: `${name}.prj`,
        mimeType: 'text/plain',
        buffer: readFileSync(fixturePath('points.prj')),
      },
    );
    await expect(p.found).toContainText(`${name}.prj`);
    await expect(p.summary).toContainText(`${name}.prj`);
    await assertNoOverflow(p.dialog);
    // The line is as wide as its room, which breaks it, and no wider.
    const [line, dialog] = [await rect(p.found), await rect(p.dialog)];
    expect(line.x + line.width).toBeLessThanOrEqual(dialog.x + dialog.width);
  });

  test('says that the default of GeoJSON is assumed, since the file names none', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'mixed.geojson');
    await expect(p.found).toHaveText(
      'Found EPSG 4326, WGS 84 (longitude and latitude, in degrees), from the GeoJSON default, which is assumed because the file names none.',
    );
    expect(await p.select.inputValue()).toBe('detected');
    await expect(p.next.locator('button')).toBeEnabled();
  });

  test("says that a GeoJSON file's own crs member was used", async ({ page }) => {
    const p = parts(page);
    await crsOf(page, GEOJSON_WITH_CRS);
    await expect(p.found).toHaveText(
      "Found EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres), from the file's own crs member.",
    );
  });

  test('says that nothing was found, and that a system has to be chosen before going on', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await expect(p.found).toHaveText('No coordinate system was found in or beside the file.');
    expect(await optionsOf(p.select)).toEqual(['Choose one…', 'An EPSG code', 'A local grid']);
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
    await expect(p.note).toHaveText('Enter an EPSG code, or choose one of the matches.');
    await p.codeInput.fill('32640');
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
    expect(await draftCrs(page)).toEqual({
      mode: 'epsg',
      epsg: '32640',
      query: '32640',
      units: 'm',
    });
    // What the code stands for is said, from the engine's definitions of the EPSG codes.
    await expect(p.summary).toHaveText(
      'Chosen: EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres), as you entered it.',
    );
  });

  test('says what is wrong with digits that are not a code, and does not go on', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    for (const text of ['0', '000', '1234567']) {
      await p.codeInput.fill(text);
      await expect(p.code.locator('.error'), text).toHaveText(
        'An EPSG code is 1 to 999999, such as 32640.',
      );
      await expect(p.codeInput, text).toHaveAttribute('aria-invalid', 'true');
      await expect(p.next.locator('button'), text).toBeDisabled();
    }
    // Text that is not digits is not wrong, since a name is a thing to search for, but it is no code.
    for (const text of ['32640x', 'EPSG:32640', '3264.5']) {
      await p.codeInput.fill(text);
      await expect(p.code.locator('.error'), text).toHaveCount(0);
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

  test('offers a local grid, with its units, for coordinates that are not tied to a place', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('local');
    await expect(p.unitsSelect).toBeVisible();
    await expect(p.units.locator('label')).toHaveText('Units of the grid');
    expect(await optionsOf(p.unitsSelect)).toEqual(['Metres', 'Feet', 'US survey feet']);
    expect(await p.unitsSelect.inputValue()).toBe('m');
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
    expect(await draftCrs(page)).toMatchObject({ mode: 'local', units: 'm' });
    await p.unitsSelect.selectOption('us_ft');
    expect(await draftCrs(page)).toMatchObject({ mode: 'local', units: 'us_ft' });
  });

  test('lets a local grid be chosen over a coordinate system that was found: it is a choice', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv', 'points.prj');
    await p.select.selectOption('local');
    await expect(p.unitsSelect).toBeVisible();
    await expect(p.next.locator('button')).toBeEnabled();
    // And the one that was found is still there to go back to.
    await p.select.selectOption('detected');
    await expect(p.unitsSelect).toHaveCount(0);
    await expect(p.summary).toContainText('EPSG 32640');
  });

  test('sums up what is chosen and where it came from, as the choice changes', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv', 'points.prj');
    await expect(p.summary).toHaveText(
      'Chosen: EPSG 32640, WGS 84 / UTM zone 40N (projected, in metres), from the .prj file points.prj.',
    );
    await p.select.selectOption('epsg');
    await expect(p.summary).toHaveText('Chosen: No coordinate system is chosen yet.');
    await p.codeInput.fill('28350');
    await expect(p.summary).toHaveText(
      'Chosen: EPSG 28350, GDA94 / MGA zone 50 (projected, in metres), as you entered it.',
    );
    await p.select.selectOption('local');
    await expect(p.summary).toContainText('Chosen: a local grid, in metres');
    await p.unitsSelect.selectOption('us_ft');
    await expect(p.summary).toContainText('a local grid, in US survey feet');
    await expect(p.summary).toContainText('not tied to a place on the Earth');
  });

  test('says so when a code is not one of the coordinate systems that are known, and still goes on', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('99999');
    await expect(p.summary).toHaveText(
      'Chosen: EPSG 99999, which is not one of the coordinate systems Karmania knows, as you entered it.',
    );
    // The data can still be loaded under it: the review says what that means.
    await expect(p.next.locator('button')).toBeEnabled();
    await expect(p.note).toHaveCount(0);
    expect(await draftCrs(page)).toEqual({
      mode: 'epsg',
      epsg: '99999',
      query: '99999',
      units: 'm',
    });
  });

  test('shows the systems that match a name, with their code, kind and unit, and chooses the one that is picked', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await expect(p.hint).toContainText('Type a code, or part of a name');
    await p.codeInput.fill('WGS 84 / UTM zone 40');
    await expect(p.rows).toHaveCount(2);
    // Under the box, which keeps that line free, how many there are.
    await expect(p.code.locator('.help')).toHaveText('2 matches.');
    expect(await textsOf(p.names)).toEqual(['WGS 84 / UTM zone 40N', 'WGS 84 / UTM zone 40S']);
    expect(await textsOf(p.details)).toEqual([
      'EPSG 32640 · projected, in metres',
      'EPSG 32740 · projected, in metres',
    ]);
    // A name is not a code: nothing is chosen until one is picked.
    await expect(p.summary).toHaveText('Chosen: No coordinate system is chosen yet.');
    await expect(p.next.locator('button')).toBeDisabled();
    await p.rows.nth(1).click();
    await expect(p.summary).toHaveText(
      'Chosen: EPSG 32740, WGS 84 / UTM zone 40S (projected, in metres), as you entered it.',
    );
    await expect(p.next.locator('button')).toBeEnabled();
    expect(await draftCrs(page)).toEqual({
      mode: 'epsg',
      epsg: '32740',
      query: 'WGS 84 / UTM zone 40',
      units: 'm',
    });
    // The matches stay as they were, with the one that was picked marked.
    await expect(p.rows).toHaveCount(2);
    await expect(p.radios.nth(1)).toBeChecked();
    await expect(p.radios.nth(0)).not.toBeChecked();
    await expect(p.rows.nth(1)).toHaveAttribute('data-selected', '');
  });

  test('puts the system whose code is typed first, and has it chosen', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('4326');
    await expect(p.names.first()).toHaveText('WGS 84');
    await expect(p.details.first()).toHaveText('EPSG 4326 · longitude and latitude, in degrees');
    await expect(p.radios.first()).toBeChecked();
    await expect(p.summary).toHaveText(
      'Chosen: EPSG 4326, WGS 84 (longitude and latitude, in degrees), as you entered it.',
    );
  });

  test('shows twenty matches at most, which scroll in their box', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('a');
    await expect(p.rows).toHaveCount(20);
    await expect(p.code.locator('.help')).toHaveText(
      'The first 20 matches; type more to narrow them.',
    );
    const room = await p.box.evaluate((box) => [box.clientHeight, box.scrollHeight]);
    expect(room[1]).toBeGreaterThan(room[0] ?? 0);
  });

  test('says what to do when nothing is typed, and when nothing matches', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await expect(p.hint).toHaveText(
      'Type a code, or part of a name such as UTM zone 40, to see the coordinate systems that match.',
    );
    await p.codeInput.fill('zzzzqq');
    await expect(p.hint).toHaveText('No coordinate system matches zzzzqq.');
    await expect(p.rows).toHaveCount(0);
    await expect(p.next.locator('button')).toBeDisabled();
    await p.codeInput.fill('');
    await expect(p.hint).toContainText('Type a code');
  });

  test('moves nothing when matches come and go', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    const place = async () => {
      const [summary, box] = await Promise.all([rect(p.summary), rect(p.box)]);
      return [summary.y, box.y, box.height, box.width];
    };
    const empty = await place();
    await p.codeInput.fill('WGS 84 / UTM zone 40');
    await expect(p.rows).toHaveCount(2);
    expect(await place()).toEqual(empty);
    await p.codeInput.fill('a');
    await expect(p.rows).toHaveCount(20);
    expect(await place()).toEqual(empty);
    await p.codeInput.fill('zzzzqq');
    await expect(p.hint).toContainText('No coordinate system matches');
    expect(await place()).toEqual(empty);
  });

  test('is used from the keyboard alone: type, Tab to the matches, and the arrows choose', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.focus();
    await page.keyboard.type('WGS 84 / UTM zone 40');
    await expect(p.rows).toHaveCount(2);
    await page.keyboard.press('Tab');
    await expect(p.radios.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(p.radios.nth(1)).toBeFocused();
    await expect(p.radios.nth(1)).toBeChecked();
    await expect(p.summary).toContainText('EPSG 32740');
    await page.keyboard.press('ArrowUp');
    await expect(p.summary).toContainText('EPSG 32640');
  });

  test('keeps a code that was chosen while another is looked for, and searches again for each change', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('32640');
    await expect(p.summary).toContainText('EPSG 32640');
    await p.codeInput.fill('OSGB 1936 / British National Grid');
    await expect(p.names.first()).toContainText('British National Grid');
    // Still the one chosen, though it is not among the matches now.
    await expect(p.summary).toContainText('EPSG 32640');
    await expect(p.radios.first()).not.toBeChecked();
    await p.rows.filter({ hasText: 'EPSG 27700' }).click();
    await expect(p.summary).toContainText('EPSG 27700');
    // Emptying the box takes the choice away, as a code that is not there.
    await p.codeInput.fill('');
    await expect(p.summary).toHaveText('Chosen: No coordinate system is chosen yet.');
  });

  test('cuts a name that is too long for its row with an ellipsis, and has the whole of it in its title', async ({
    page,
  }) => {
    const p = parts(page);
    await page.setViewportSize({ width: 1024, height: 640 });
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    await p.codeInput.fill('WISCRS Calumet');
    await expect(p.rows.first()).toBeVisible();
    const cut = await p.rows.evaluateAll((rows) =>
      rows
        .map((row) => {
          const name = row.querySelector('.match-name');
          return name === null
            ? undefined
            : {
                cut: name.scrollWidth > name.clientWidth,
                title: row.getAttribute('title'),
                text: name.textContent,
              };
        })
        .filter((row) => row?.cut === true),
    );
    expect(cut.length).toBeGreaterThan(0);
    for (const row of cut) {
      expect(row?.title).toBe(row?.text);
    }
    await assertNoOverflow(p.dialog);
  });

  test('says when nothing is chosen, with a different mark from when something is', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await expect(p.summary).toHaveText('Chosen: No coordinate system is chosen yet.');
    await expect(p.summaryIcon).toHaveAttribute('name', 'circle-alert');
    await p.select.selectOption('local');
    await expect(p.summaryIcon).toHaveAttribute('name', 'check');
  });

  test('tells screen readers when the choice changes, in a status region', async ({ page }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await expect(p.step.getByRole('status')).toContainText('No coordinate system is chosen yet.');
    await p.select.selectOption('local');
    await expect(p.step.getByRole('status')).toContainText('a local grid');
  });

  test('moves nothing when the units take the place of the code, or the other way about', async ({
    page,
  }) => {
    const p = parts(page);
    await crsOf(page, 'points.csv');
    await p.select.selectOption('epsg');
    const withCode = [await rect(p.choice), await rect(p.select), await rect(p.code)];
    await p.select.selectOption('local');
    const withUnits = [await rect(p.choice), await rect(p.select), await rect(p.units)];
    expect(withUnits[0]).toEqual(withCode[0]);
    expect(withUnits[1]).toEqual(withCode[1]);
    // The units are where the code was.
    expect(withUnits[2]).toEqual(withCode[2]);
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
    await p.codeInput.fill('utm zone 40');
    await expect(p.rows.first()).toBeVisible();
    await assertNoOverflow(p.dialog);
    // Twenty matches scroll inside their box, and the dialog still has nothing overflowing.
    await p.codeInput.fill('a');
    await expect(p.rows).toHaveCount(20);
    await assertNoOverflow(p.dialog);
  });

  for (const theme of ['light', 'dark']) {
    test(`is readable and has no serious accessibility violations (${theme} theme)`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await crsOf(page, 'points.csv');
      await p(page).select.selectOption('epsg');
      await p(page).codeInput.fill('utm zone 40');
      await expect(p(page).rows.first()).toBeVisible();
      await p(page).radios.first().check();
      await expectNoSeriousViolations(page);
    });
  }
});

const p = parts;
