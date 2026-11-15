import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { groupRow, layerRow, legend, loadLegendScene } from './support/legend.js';
import { dispatch } from './support/render.js';

/**
 * Groups in the Legend tab (step 19.5): a button that makes one, and renaming it in place (F2 or a double click on its name; Enter, Escape or leaving the
 * field), then folding, deleting and moving layers in and out of it.
 */

/** The names of the groups of the scene, from the top. */
const groups = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { legend: ({ type: 'layer' } | { type: 'group'; name: string })[] };
    };
    return viewer.scene().legend.flatMap((node) => (node.type === 'group' ? [node.name] : []));
  });

/** What the live region says now. */
const said = (page: Page): Promise<string> =>
  legend(page)
    .locator('[role="status"]')
    .evaluate((region) => region.textContent.replace(/\s+/g, ' ').trim());

const field = (page: Page): Locator => legend(page).locator('input.rename');
const newGroup = (page: Page): Locator => legend(page).getByRole('button', { name: 'New group' });

async function open(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await expect(layerRow(page, 'layer-5')).toBeVisible();
  expect(await groups(page)).toEqual(['Surveys', 'Samples']);
}

test.describe('making and renaming groups in the Legend tab', () => {
  test('has a New group button at the right of the top row, which makes a group at the top and puts its name in a field, selected', async ({
    page,
  }) => {
    await open(page);
    // The button is in the top row, 32 high, with its right edge at the right edge of the rows.
    const button = await newGroup(page).boundingBox();
    const tree = await legend(page).locator('.tree').boundingBox();
    const top = await legend(page).locator('.top').boundingBox();
    expect(top?.height).toBe(32);
    expect(
      Math.abs((button?.x ?? 0) + (button?.width ?? 0) - ((tree?.x ?? 0) + (tree?.width ?? 0))),
    ).toBeLessThanOrEqual(1);
    await newGroup(page).click();
    await expect.poll(() => groups(page)).toEqual(['New group', 'Surveys', 'Samples']);
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('New group');
    // The whole of the name is selected, so that typing is naming it.
    expect(
      await field(page).evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    ).toEqual([0, 'New group'.length]);
    // Groups are not layers: the caption still counts five.
    await expect(legend(page).getByText('5 layers', { exact: true })).toBeVisible();
  });

  test('keeps the name that is typed with Enter, says so, and gives the keyboard back to the row of the group', async ({
    page,
  }) => {
    await open(page);
    await newGroup(page).click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.type('Core');
    await page.keyboard.press('Enter');
    await expect.poll(() => groups(page)).toEqual(['Core', 'Surveys', 'Samples']);
    expect(await said(page)).toBe('Renamed group to Core');
    await expect(field(page)).toHaveCount(0);
    await expect(groupRow(page, 'group-3')).toBeFocused();
    await expect(groupRow(page, 'group-3').locator('.name')).toHaveText('Core');
  });

  test('puts the old name back with Escape, and says nothing', async ({ page }) => {
    await open(page);
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('F2');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('Samples');
    await page.keyboard.type('Something else');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
    expect(await groups(page)).toEqual(['Surveys', 'Samples']);
    expect(await said(page)).toBe('');
    await expect(groupRow(page, 'group-1')).toBeFocused();
  });

  test('keeps the name when the field is left, as Enter does', async ({ page }) => {
    await open(page);
    await groupRow(page, 'group-2').focus();
    await page.keyboard.press('F2');
    await page.keyboard.type('Boreholes');
    await legend(page).locator('.top span').first().click();
    await expect.poll(() => groups(page)).toEqual(['Boreholes', 'Samples']);
    await expect(field(page)).toHaveCount(0);
  });

  test('keeps the old name when the new one is only space, as the scene does', async ({ page }) => {
    await open(page);
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('F2');
    // The name is selected when the field opens, so what is typed replaces it: the field has only space.
    await page.keyboard.type('   ');
    await expect(field(page)).toHaveValue('   ');
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveCount(0);
    expect(await groups(page)).toEqual(['Surveys', 'Samples']);
    expect(await said(page)).toBe('');
  });

  test('starts with F2 or a double click on the name of a group, and not with one click, and not on a layer', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-1').locator('.name').click();
    await expect(field(page)).toHaveCount(0);
    await groupRow(page, 'group-1').locator('.name').dblclick();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await layerRow(page, 'layer-2').focus();
    await page.keyboard.press('F2');
    await expect(field(page)).toHaveCount(0);
  });

  test('leaves what is typed in the field to the field: Space and the arrows do not switch or move the row', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('F2');
    await page.keyboard.type('A B');
    await expect(field(page)).toHaveValue('A B');
    // (Home is not the start of a field on every system, so the arrows go there.)
    for (let step = 0; step < 3; step += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.type('x');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => groups(page)).toEqual(['Surveys', 'xA B']);
    // The group's layers are all still on: Space in the field did not switch the group.
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-checked', 'true');
  });

  test('closes the field when its group is deleted meanwhile, and has no serious accessibility violation with the field open', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('F2');
    await expect(field(page)).toBeFocused();
    await expectNoSeriousViolations(page);
    await dispatch(page, { type: 'deleteGroup', groupId: 'group-1' });
    await expect(field(page)).toHaveCount(0);
    expect(await groups(page)).toEqual(['Surveys']);
  });
});
