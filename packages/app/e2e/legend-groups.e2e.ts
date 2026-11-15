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

/** The legend of the scene as the ids of its top, with a group's layers after a colon. */
const order = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): {
        legend: (
          { type: 'layer'; id: string } | { type: 'group'; id: string; children: string[] }
        )[];
      };
    };
    return viewer
      .scene()
      .legend.map((node) =>
        node.type === 'layer' ? node.id : `${node.id}:${node.children.join(',')}`,
      );
  });

const START = ['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-2', 'layer-1'];

test.describe('folding, deleting and moving layers in and out of groups in the Legend tab', () => {
  test('folds and unfolds a group with its chevron, keeping its count and the keyboard on its row', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-1').locator('.fold').click();
    await expect(layerRow(page, 'layer-3')).toHaveCount(0);
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-expanded', 'false');
    await expect(groupRow(page, 'group-1').locator('.count')).toHaveText('2');
    await expect(groupRow(page, 'group-1')).toBeFocused();
    expect(
      await groupRow(page, 'group-1')
        .locator('.chevron')
        .evaluate((element) => getComputedStyle(element).transform),
    ).not.toBe('none');
    await groupRow(page, 'group-1').locator('.fold').click();
    await expect(layerRow(page, 'layer-3')).toBeVisible();
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-expanded', 'true');
  });

  test('has Right and Left do what they do in a tree: fold, unfold, go to the first layer, go back to the group', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-expanded', 'false');
    await expect(groupRow(page, 'group-1')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowRight');
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(layerRow(page, 'layer-3')).toBeFocused();
    // Left on a layer that is closed goes to its group; on a layer of the top it does nothing.
    await page.keyboard.press('ArrowLeft');
    await expect(groupRow(page, 'group-1')).toBeFocused();
    await layerRow(page, 'layer-2').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(layerRow(page, 'layer-2')).toBeFocused();
    // Left on a layer that is open closes it first, and does not leave it.
    await layerRow(page, 'layer-3').focus();
    await page.keyboard.press('ArrowRight');
    await expect(layerRow(page, 'layer-3')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(layerRow(page, 'layer-3')).toHaveAttribute('aria-expanded', 'false');
    await expect(layerRow(page, 'layer-3')).toBeFocused();
  });

  test('deletes a group with the button that its row shows when pointed at, and leaves its layers where it was, saying so', async ({
    page,
  }) => {
    await open(page);
    const remove = groupRow(page, 'group-1').locator('.remove');
    expect((await remove.boundingBox())?.width).toBe(28);
    await page.mouse.move(0, 0);
    await expect(remove).toHaveCSS('opacity', '0');
    await groupRow(page, 'group-1').hover();
    await expect(remove).toHaveCSS('opacity', '1');
    await remove.click();
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'layer-3', 'layer-4', 'layer-2', 'layer-1']);
    expect(await said(page)).toBe('Deleted group Samples; its 2 layers are in the legend');
    await expect(groupRow(page, 'group-1')).toHaveCount(0);
    // The keyboard is on the first of its layers.
    await expect(layerRow(page, 'layer-3')).toBeFocused();
  });

  test('deletes the group that has the keyboard with Delete or Backspace, and does nothing on a layer', async ({
    page,
  }) => {
    await open(page);
    await layerRow(page, 'layer-2').focus();
    await page.keyboard.press('Delete');
    expect(await order(page)).toEqual(START);
    await groupRow(page, 'group-2').focus();
    await page.keyboard.press('Delete');
    await expect
      .poll(() => order(page))
      .toEqual(['layer-5', 'group-1:layer-3,layer-4', 'layer-2', 'layer-1']);
    expect(await said(page)).toBe('Deleted group Surveys; its 1 layer is in the legend');
    await expect(layerRow(page, 'layer-5')).toBeFocused();
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('Backspace');
    await expect
      .poll(() => order(page))
      .toEqual(['layer-5', 'layer-3', 'layer-4', 'layer-2', 'layer-1']);
    // An empty group goes, and the keyboard is on the row under it.
    await newGroup(page).click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Enter');
    // (The scene numbers a group one more than the highest there is, and there is none now: it is `group-1` again.)
    await expect(groupRow(page, 'group-1')).toBeFocused();
    await page.keyboard.press('Delete');
    await expect
      .poll(() => order(page))
      .toEqual(['layer-5', 'layer-3', 'layer-4', 'layer-2', 'layer-1']);
    expect(await said(page)).toBe('Deleted group New group');
    await expect(layerRow(page, 'layer-5')).toBeFocused();
  });

  test('takes a layer into the group right above it with Alt and Right, and out of its group with Alt and Left, saying where it went', async ({
    page,
  }) => {
    await open(page);
    await layerRow(page, 'layer-2').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-4,layer-2', 'layer-1']);
    expect(await said(page)).toBe('Moved Assays into Samples');
    await expect(layerRow(page, 'layer-2')).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-3,layer-4', 'layer-2', 'layer-1']);
    expect(await said(page)).toBe('Moved Assays out of Samples');
    await expect(layerRow(page, 'layer-2')).toBeFocused();
    // A layer out of the middle of its group goes to just under the group.
    await layerRow(page, 'layer-3').focus();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect
      .poll(() => order(page))
      .toEqual(['group-2:layer-5', 'group-1:layer-4', 'layer-3', 'layer-2', 'layer-1']);
    expect(await said(page)).toBe('Moved Geology out of Samples');
  });

  test('says why a layer does not go in or out, and moves nothing: no group above, in a group already, a group, not in a group', async ({
    page,
  }) => {
    await open(page);
    await layerRow(page, 'layer-1').focus();
    await page.keyboard.press('Alt+ArrowRight');
    expect(await said(page)).toBe('Topography has no group right above it to go into');
    await layerRow(page, 'layer-3').focus();
    await page.keyboard.press('Alt+ArrowRight');
    expect(await said(page)).toBe('Geology is in Samples already');
    await groupRow(page, 'group-1').focus();
    await page.keyboard.press('Alt+ArrowRight');
    expect(await said(page)).toBe('Samples is a group, and a group cannot be in a group');
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await said(page)).toBe('Samples is not in a group');
    await layerRow(page, 'layer-2').focus();
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await said(page)).toBe('Assays is not in a group');
    expect(await order(page)).toEqual(START);
  });

  test('has no serious accessibility violation with a group folded, a group that is being renamed and a row that has the keyboard', async ({
    page,
  }) => {
    await open(page);
    await groupRow(page, 'group-2').locator('.fold').click();
    await groupRow(page, 'group-1').focus();
    await expectNoSeriousViolations(page);
  });
});
