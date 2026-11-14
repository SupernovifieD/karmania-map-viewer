/**
 * What the tests of the Legend tab and its screenshots have in common: a scene of layers and groups made in the page, and the tab chosen.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { dispatch, layerStatuses, loadLattice } from './render.js';

const EAST = 500_000;
const NORTH = 2_765_000;

/** The Legend tab of the page. */
export const legend = (page: Page): Locator => page.locator('karmania-legend-tab');

/** The row of a layer, which is its tree item. */
export const layerRow = (page: Page, id: string): Locator =>
  legend(page).locator(`.row[data-layer="${id}"]`);
/** The row of a group, which is its tree item. */
export const groupRow = (page: Page, id: string): Locator =>
  legend(page).locator(`.row[data-group="${id}"]`);

/** Loading data opens the Data tab; the Legend tab is chosen again. */
export const showLegend = (page: Page): Promise<void> =>
  page.getByRole('tab', { name: 'Legend', exact: true }).click();

/** A grid of 4 by 4 cells with the values 1 to 16: its layer is coloured by classes of them, as a grid's is at first. Waits until `count` layers are drawn. */
export async function loadGrid(page: Page, name: string, count: number): Promise<void> {
  await loadLattice(page, 'grid', {
    name,
    crs: { kind: 'epsg', code: 32640 },
    origin: [EAST, NORTH, 0],
    spacing: [10, 10, 1],
    dims: [4, 4, 1],
    values: Array.from({ length: 16 }, (_, i) => i + 1),
  });
  await expect.poll(async () => (await layerStatuses(page)).length).toBe(count);
  await expect
    .poll(async () => (await layerStatuses(page)).every(([, status]) => status === 'drawn'))
    .toBe(true);
}

/** The names of the five layers of `loadLegendScene`, in the order they are loaded. */
export const LAYER_NAMES = ['Topography', 'Assays', 'Geology', 'Drillholes', 'Seismic lines'];

/**
 * Five layers on the page that is open: `layer-1` in one colour (`#e69f00`) and `layer-2` by classes, both at the top; two groups, `group-1` (named
 * `groups[0]`) with `layer-3` and `layer-4`, and `group-2` (`groups[1]`) with `layer-5`. The Legend tab is chosen.
 */
export async function loadLegendScene(
  page: Page,
  names: readonly string[] = LAYER_NAMES,
  groups: readonly [string, string] = ['Samples', 'Surveys'],
): Promise<void> {
  for (const [i, name] of names.entries()) {
    await loadGrid(page, name, i + 1);
  }
  await dispatch(
    page,
    {
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#e69f00' } },
    },
    { type: 'createGroup', name: groups[0] },
    { type: 'createGroup', name: groups[1] },
    { type: 'moveNode', id: 'layer-3', to: { parent: 'group-1', index: 0 } },
    { type: 'moveNode', id: 'layer-4', to: { parent: 'group-1', index: 1 } },
    { type: 'moveNode', id: 'layer-5', to: { parent: 'group-2', index: 0 } },
  );
  await showLegend(page);
}
