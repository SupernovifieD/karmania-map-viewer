import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { importAndLoad, kept } from './support/wizard.js';

/** What a layer of the scene says of itself, from the top of the legend down: its dataset, its name, whether it is shown. */
interface Seen {
  readonly datasetId: number | undefined;
  readonly name: string | undefined;
  readonly visible: boolean | undefined;
}

/** The layers of the scene that the viewer holds, in the order of the legend. */
function layers(page: Page): Promise<Seen[]> {
  return page.evaluate(() => {
    const viewer = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      scene(): {
        legend: { id: string }[];
        layers: Record<string, { datasetId: number; name: string; visible: boolean }>;
      };
    };
    const scene = viewer.scene();
    return scene.legend.map((node) => ({
      datasetId: scene.layers[node.id]?.datasetId,
      name: scene.layers[node.id]?.name,
      visible: scene.layers[node.id]?.visible,
    }));
  });
}

test.describe('the scene of the viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('has no layers until something is loaded', async ({ page }) => {
    expect(await layers(page)).toEqual([]);
  });

  test('gets a layer, shown and named for it, for a dataset that is loaded', async ({ page }) => {
    await importAndLoad(page, 'points.csv', 'points.prj');
    const { datasets } = await kept(page);
    expect(datasets).toHaveLength(1);
    expect(await layers(page)).toEqual([
      { datasetId: datasets[0]?.id, name: datasets[0]?.name, visible: true },
    ]);
  });

  test('has a layer for each dataset of a file that holds three, the one loaded last on top, and loses the one of a dataset that is removed', async ({
    page,
  }) => {
    await importAndLoad(page, 'mixed.geojson');
    const { datasets } = await kept(page);
    expect(datasets).toHaveLength(3);
    const ids = datasets.map((dataset) => dataset.id);
    expect((await layers(page)).map((layer) => layer.datasetId)).toEqual([...ids].reverse());
    expect((await layers(page)).map((layer) => layer.name)).toEqual(
      datasets.map((dataset) => dataset.name).reverse(),
    );

    const list = page.locator('karmania-dataset-list');
    await list.locator('li').nth(1).locator('.remove k-button button').click();
    await list.locator('k-button[slot="footer-end"]').click();
    await expect(list.locator('li')).toHaveCount(2);
    expect((await layers(page)).map((layer) => layer.datasetId)).toEqual([ids[2], ids[0]]);
  });
});
