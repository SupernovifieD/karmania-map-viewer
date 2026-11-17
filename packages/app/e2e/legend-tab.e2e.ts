import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertAligned, assertNoOverflow, boxOf, textStartOf } from './support/layout.js';
import {
  groupRow,
  layerRow,
  legend,
  loadGrid,
  loadLegendScene,
  showLegend,
} from './support/legend.js';
import { dispatch } from './support/render.js';

/**
 * The Legend tab (step 19.1): the legend model as a tree of rows, with one level of groups. What is proved here is what 10.3 of the brief says of the rows
 * and what the tab does with the scene: the rows are 32 high, the layers of a group are 24 in, the names of one level start at one place, a swatch is a
 * colour of 16 by 16 or the classes of 24 by 12, a long name is cut with an ellipsis and says all of itself, and the tab follows the scene.
 */

/** The ends of viridis, which a grid's default style is coloured from. */
const FIRST = '#440154';
const LAST = '#fde725';

/** `#rrggbb` as the browser gives a colour it has parsed: `rgb(r, g, b)`. */
const rgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${String(value >> 16)}, ${String((value >> 8) & 255)}, ${String(value & 255)})`;
};

/**
 * The background of a ramp swatch as the browser computed it. The stripes are set through the element's style (what a strict policy allows) and not written as
 * the text of an attribute, so the colours are the ones the browser parsed (`rgb()`, not the hex that the code wrote), and each stripe is two stops: its colour at
 * both of its ends.
 */
const stripesOf = (ramp: Locator): Promise<string> =>
  ramp.evaluate((element) => getComputedStyle(element).backgroundImage);

/** How many stripes a computed background has: two stops of one colour for each. */
const stripeCount = (image: string): number => (image.match(/rgb\(/g)?.length ?? 0) / 2;

const layerName = (page: Page, id: string): Locator => layerRow(page, id).locator('.name');
const groupName = (page: Page, id: string): Locator => groupRow(page, id).locator('.name');

/** The number of the dataset that a layer is of, from the scene (the engine numbers them, and the first need not be 0). */
const datasetOf = (page: Page, layerId: string): Promise<number | undefined> =>
  page.evaluate((id) => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): { layers: Record<string, { datasetId: number } | undefined> };
    };
    return viewer.scene().layers[id]?.datasetId;
  }, layerId);

/** The page, with the five layers and two groups of `loadLegendScene`. */
async function loadLegend(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await loadLegendScene(page);
  await expect(layerRow(page, 'layer-5')).toBeVisible();
}

test.describe('the Legend tab', () => {
  test('keeps the empty state of phase 1 while there are no layers, with no tree', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await expect(
      legend(page).getByText('Layers will appear here once maps are rendered.'),
    ).toBeVisible();
    await expect(legend(page).locator('[role="tree"]')).toHaveCount(0);
  });

  test('is a tree with a name: groups at level 1 that say whether they are open, layers at level 1 or 2, and how many layers there are', async ({
    page,
  }) => {
    await loadLegend(page);
    await expect(legend(page).getByText('5 layers', { exact: true })).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Layers' })).toHaveCount(1);
    for (const [id, name] of [
      ['group-1', 'Samples'],
      ['group-2', 'Surveys'],
    ] as const) {
      const item = groupRow(page, id);
      await expect(item).toHaveAttribute('role', 'treeitem');
      await expect(item).toHaveAttribute('aria-level', '1');
      await expect(item).toHaveAttribute('aria-expanded', 'true');
      await expect(item.locator('.name')).toHaveText(name);
      // Its name is its own words (its name and how many layers it has), and not those of its layers.
      await expect(page.getByRole('treeitem', { name: new RegExp(`^${name} \\d$`) })).toHaveCount(
        1,
      );
    }
    for (const [id, level] of [
      ['layer-1', '1'],
      ['layer-2', '1'],
      ['layer-3', '2'],
      ['layer-4', '2'],
      ['layer-5', '2'],
    ] as const) {
      const item = layerRow(page, id);
      await expect(item).toHaveAttribute('role', 'treeitem');
      await expect(item).toHaveAttribute('aria-level', level);
    }
    // A group says how many layers it has, at its right.
    await expect(groupRow(page, 'group-1').locator('.count')).toHaveText('2');
    await expect(groupRow(page, 'group-2').locator('.count')).toHaveText('1');
  });

  test('has rows of 32, the layers of a group 24 in, and the names of every row at one level, groups and layers, starting at one place', async ({
    page,
  }) => {
    await loadLegend(page);
    for (const id of ['layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5']) {
      expect((await layerRow(page, id).boundingBox())?.height, `the row of ${id}`).toBe(32);
    }
    for (const id of ['group-1', 'group-2']) {
      expect((await groupRow(page, id).boundingBox())?.height, `the row of ${id}`).toBe(32);
    }
    // The layers of a group are 24 in from the edge of its row, and so much narrower.
    const top = await layerRow(page, 'layer-2').boundingBox();
    const inside = await layerRow(page, 'layer-3').boundingBox();
    const group = await groupRow(page, 'group-1').boundingBox();
    expect(top?.x).toBe(group?.x);
    expect((inside?.x ?? 0) - (top?.x ?? 0)).toBe(24);
    expect((top?.width ?? 0) - (inside?.width ?? 0)).toBe(24);
    // Names: the layers at the top (one in a colour, one by classes), the layers in groups, and the groups, each at one place.
    await assertAligned([layerName(page, 'layer-1'), layerName(page, 'layer-2')], 'text-left');
    await assertAligned(
      [layerName(page, 'layer-3'), layerName(page, 'layer-4'), layerName(page, 'layer-5')],
      'text-left',
    );
    await assertAligned([groupName(page, 'group-1'), groupName(page, 'group-2')], 'text-left');
    // The text of every row at the same level starts at the same x (10.3): the groups and the layers at the top are at one level, whatever they have at their left,
    // and the layers of a group are 24 in from them.
    await assertAligned(
      [
        groupName(page, 'group-1'),
        groupName(page, 'group-2'),
        layerName(page, 'layer-1'),
        layerName(page, 'layer-2'),
      ],
      'text-left',
    );
    expect(
      (await textStartOf(layerName(page, 'layer-3'))) -
        (await textStartOf(groupName(page, 'group-1'))),
    ).toBe(24);
    expect(
      (await textStartOf(layerName(page, 'layer-3'))) -
        (await textStartOf(layerName(page, 'layer-1'))),
    ).toBe(24);
    // The counts of the groups are at the right edge, together.
    await assertAligned(
      [groupRow(page, 'group-1').locator('.count'), groupRow(page, 'group-2').locator('.count')],
      'right',
    );
  });

  /** What `token` is in the colours of the page, as the browser writes a colour: found by painting a probe with it, so that no value is copied into a test. */
  const tokenColour = (page: Page, token: string): Promise<string> =>
    legend(page).evaluate((tab, name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      tab.shadowRoot?.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, token);

  test('has the parts of 10.3 as it says them: padding 16, the caption muted, a ghost button with the folder-plus icon, a group name of weight 500 with its count muted, a swatch with a radius of 4, and a polite live region', async ({
    page,
  }) => {
    await loadLegend(page);
    const area = page.locator('karmania-panel [data-scroll-region][slot="legend"]');
    await expect(area).toHaveCSS('padding', '16px');
    const muted = await tokenColour(page, '--k-text-muted');
    const text = await tokenColour(page, '--k-text');
    expect(muted).not.toBe(text);
    // The caption, at the left of the top row, is muted.
    await expect(legend(page).locator('.top span').first()).toHaveCSS('color', muted);
    await expect(legend(page).locator('.top span').first()).toHaveText('5 layers');
    // The button, at its right, is a ghost button with the folder-plus icon, and says what it does.
    const button = legend(page).locator('.top k-button');
    await expect(button).toHaveAttribute('variant', 'ghost');
    await expect(button.locator('k-icon')).toHaveAttribute('name', 'folder-plus');
    await expect(legend(page).getByRole('button', { name: 'New group' })).toBeVisible();
    // A group's name is of weight 500 and its count is muted; a layer's name is not of that weight.
    await expect(groupName(page, 'group-1')).toHaveCSS('font-weight', '500');
    await expect(groupRow(page, 'group-1').locator('.count')).toHaveCSS('color', muted);
    await expect(layerName(page, 'layer-1')).not.toHaveCSS('font-weight', '500');
    // A swatch has a radius of 4.
    await expect(layerRow(page, 'layer-1').locator('.swatch')).toHaveCSS('border-radius', '4px');
    // The announcements are in a region that is polite, whole, and not seen.
    const region = legend(page).locator('[role="status"]');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  test("has the folder of a group in the room of a swatch in its row: open when the group is open, shut when it is folded, 16 by 16 at the swatch's place, in the muted colour", async ({
    page,
  }) => {
    await loadLegend(page);
    const folder = (id: string): Locator => groupRow(page, id).locator('.swatch-room k-icon');
    await expect(folder('group-1')).toHaveAttribute('name', 'folder-open');
    await expect(folder('group-2')).toHaveAttribute('name', 'folder-open');
    const icon = await boxOf(folder('group-1'), 'the folder of Samples');
    const swatch = await boxOf(layerRow(page, 'layer-1').locator('.swatch'), 'a swatch');
    const room = await boxOf(groupRow(page, 'group-1').locator('.swatch-room'), 'the room');
    expect([icon.width, icon.height]).toEqual([16, 16]);
    expect(icon.x).toBe(swatch.x);
    expect(room.width).toBe(24);
    // In the middle of the row, as the swatch of a layer is.
    const row = await boxOf(groupRow(page, 'group-1'), 'the row');
    expect(Math.abs(icon.y + icon.height / 2 - (row.y + row.height / 2))).toBeLessThanOrEqual(1);
    await expect(groupRow(page, 'group-1').locator('.swatch-room')).toHaveCSS(
      'color',
      await tokenColour(page, '--k-text-muted'),
    );
    // It is for the eye: the row says whether the group is folded, to those who cannot see.
    await expect(groupRow(page, 'group-1').locator('.swatch-room')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await dispatch(page, { type: 'setGroupCollapsed', groupId: 'group-1', collapsed: true });
    await expect(folder('group-1')).toHaveAttribute('name', 'folder');
    await expect(folder('group-2')).toHaveAttribute('name', 'folder-open');
    await dispatch(page, { type: 'setGroupCollapsed', groupId: 'group-1', collapsed: false });
    await expect(folder('group-1')).toHaveAttribute('name', 'folder-open');
  });

  test("has the lines of a layer's classes in the type of 10.3: 13 on 20, with numbers of one width, the count muted", async ({
    page,
  }) => {
    await loadLegend(page);
    await layerRow(page, 'layer-2').locator('.open').click();
    const line = legend(page).locator('#legend-classes-layer-2 .entry').first();
    await expect(line).toBeVisible();
    await expect(line).toHaveCSS('font-size', '13px');
    await expect(line).toHaveCSS('line-height', '20px');
    expect(await line.evaluate((one) => getComputedStyle(one).fontVariantNumeric)).toContain(
      'tabular-nums',
    );
    await expect(line.locator('.figure')).toHaveCSS(
      'color',
      await tokenColour(page, '--k-text-muted'),
    );
  });

  test('shows a layer in one colour as a swatch of 16 by 16 in that colour, and a layer by classes as its classes side by side, 24 by 12, in a room of 24', async ({
    page,
  }) => {
    await loadLegend(page);
    const swatch = layerRow(page, 'layer-1').locator('.swatch');
    const box = await swatch.boundingBox();
    expect([box?.width, box?.height]).toEqual([16, 16]);
    await expect(swatch).toHaveCSS('background-color', 'rgb(230, 159, 0)');
    const ramp = layerRow(page, 'layer-2').locator('.swatch.ramp');
    const rampBox = await ramp.boundingBox();
    expect([rampBox?.width, rampBox?.height]).toEqual([24, 12]);
    // Seven classes of equal intervals, from the first colour of the ramp to its last, in stripes with hard edges.
    const image = await stripesOf(ramp);
    expect(stripeCount(image)).toBe(7);
    expect(image.startsWith(`linear-gradient(to right, ${rgb(FIRST)} 0%`)).toBe(true);
    expect(image.endsWith(`${rgb(LAST)} 100%)`)).toBe(true);
    // Both rooms are 24 wide, so the names are where they are whichever the layer has (the alignment test above); the swatches are left-aligned in them.
    expect(rampBox?.x).toBe(box?.x);
    // The swatches are in the middle of the row, and decorative.
    await expect(swatch).toHaveAttribute('aria-hidden', 'true');
    await expect(ramp).toHaveAttribute('aria-hidden', 'true');
  });

  test('cuts a long name with an ellipsis, says all of it when it is pointed at, and overflows nothing', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    const long =
      `Cross section of the northern pit, drill holes and trenches, ${'seen from the west '.repeat(4)}`.slice(
        0,
        120,
      );
    await loadGrid(page, long, 1);
    await dispatch(page, { type: 'createGroup', name: long });
    await showLegend(page);
    const name = layerName(page, 'layer-1');
    await expect(name).toHaveAttribute('title', long);
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(groupName(page, 'group-1')).toHaveAttribute('title', long);
    await assertNoOverflow(legend(page));
  });

  test('follows the scene: a folded group has no rows and says so, a name changes, a layer that is removed goes, and the classes of a style are the stripes', async ({
    page,
  }) => {
    await loadLegend(page);
    await dispatch(page, { type: 'setGroupCollapsed', groupId: 'group-1', collapsed: true });
    await expect(layerRow(page, 'layer-3')).toHaveCount(0);
    await expect(groupRow(page, 'group-1')).toHaveAttribute('aria-expanded', 'false');
    // The chevron of a folded group is turned; the count is still how many layers it has.
    expect(
      await groupRow(page, 'group-1')
        .locator('.chevron')
        .evaluate((element) => getComputedStyle(element).transform),
    ).not.toBe('none');
    await expect(groupRow(page, 'group-1').locator('.count')).toHaveText('2');
    await dispatch(page, { type: 'setGroupCollapsed', groupId: 'group-1', collapsed: false });
    await expect(layerRow(page, 'layer-3')).toBeVisible();
    await dispatch(page, { type: 'renameGroup', groupId: 'group-2', name: 'Seismic' });
    await expect(groupName(page, 'group-2')).toHaveText('Seismic');
    // The stripes are the classes the engine gives for the style: 3 of them when the style asks for 3.
    const ramp = layerRow(page, 'layer-2').locator('.swatch.ramp');
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-2',
      patch: {
        colour: {
          mode: 'classes',
          column: 'value',
          method: 'equal',
          classes: 3,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    await expect.poll(async () => stripeCount(await stripesOf(ramp))).toBe(3);
    const datasetId = await datasetOf(page, 'layer-1');
    expect(datasetId).toBeDefined();
    await dispatch(page, { type: 'removeLayersOfDataset', datasetId });
    await expect(layerRow(page, 'layer-1')).toHaveCount(0);
    await expect(legend(page).getByText('4 layers', { exact: true })).toBeVisible();
  });

  test('says "1 layer" for one, and has no serious accessibility violation with the rows in it', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadGrid(page, 'Topography', 1);
    await showLegend(page);
    await expect(legend(page).getByText('1 layer', { exact: true })).toBeVisible();
    await expectNoSeriousViolations(page);
    await loadGrid(page, 'Assays', 2);
    await dispatch(page, { type: 'createGroup', name: 'Samples' });
    await dispatch(page, { type: 'moveNode', id: 'layer-2', to: { parent: 'group-1', index: 0 } });
    await showLegend(page);
    await expect(layerRow(page, 'layer-2')).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});
