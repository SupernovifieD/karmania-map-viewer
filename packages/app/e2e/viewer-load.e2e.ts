import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { layerStatuses, loadLattice } from './support/render.js';

/** The viewer's `load`, the first part of its API (section 11.8 of the brief): a dataset made with a builder, handed to the viewer by a script. */

const viewer = (page: Page) =>
  page.evaluateHandle(
    () =>
      document.querySelector('karmania-app')?.shadowRoot?.querySelector('karmania-viewer') ?? null,
  );

/** Loads two points made in the page. */
function loadPoints(
  page: Page,
): Promise<{ status: string; summaries?: { id: number; name: string }[] }> {
  return page.evaluate(() => {
    const element = document
      .querySelector('karmania-app')
      ?.shadowRoot?.querySelector('karmania-viewer') as unknown as {
      load(input: unknown): Promise<{ status: string; summaries?: { id: number; name: string }[] }>;
    };
    return element.load({
      kind: 'points',
      name: 'Collars',
      crs: { kind: 'epsg', code: 32640 },
      x: new Float64Array([500_000, 500_100]),
      y: new Float64Array([2_765_000, 2_765_100]),
    });
  });
}

test.describe('the viewer’s load', () => {
  test('lists a dataset that a script hands over, selects it and draws it, as an import does', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('karmania-map-area k-empty-state')).toBeVisible();
    const result = await loadPoints(page);
    expect(result.status).toBe('loaded');
    expect(result.summaries?.map((summary) => summary.name)).toEqual(['Collars']);
    await expect(page.locator('karmania-dataset-list li[data-dataset="Collars"]')).toBeVisible();
    await expect(page.locator('karmania-dataset-summary dl')).toContainText('2 points');
    // The panel shows the Data tab, as it does after an import.
    await expect(page.locator('karmania-panel [role="tab"][aria-selected="true"]')).toHaveText(
      'Data',
    );
    await expect
      .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
      .toEqual(['drawn']);
    await expect(page.locator('karmania-map-area k-empty-state')).toHaveCount(0);
  });

  test('adds a second dataset to the first, and selects the new one', async ({ page }) => {
    await page.goto('/');
    await loadPoints(page);
    await loadLattice(page, 'grid', {
      name: 'Surface',
      crs: { kind: 'epsg', code: 32640 },
      origin: [500_000, 2_765_000, 0],
      spacing: [10, 10, 1],
      dims: [2, 2, 1],
      values: [1, 2, 3, 4],
    });
    await expect(page.locator('karmania-dataset-list li')).toHaveCount(2);
    // The one that was loaded last is the one that is selected, as after an import.
    await expect(page.locator('karmania-dataset-list li[data-selected]')).toHaveAttribute(
      'data-dataset',
      'Surface',
    );
    await expect
      .poll(async () => (await layerStatuses(page)).map(([, status]) => status))
      .toEqual(['drawn', 'drawn']);
  });

  test('says that a dataset that cannot be loaded is blocked, and adds nothing', async ({
    page,
  }) => {
    await page.goto('/');
    const result = await loadLattice(page, 'grid', {
      name: 'Nothing',
      crs: { kind: 'epsg', code: 32640 },
      origin: [500_000, 2_765_000, 0],
      spacing: [10, 10, 1],
      // A cell count of 0 along x: there is no grid to make.
      dims: [0, 2, 1],
      values: [],
    });
    expect(result.status).toBe('blocked');
    await expect(page.locator('karmania-dataset-list li')).toHaveCount(0);
    await expect(page.locator('karmania-map-area k-empty-state')).toBeVisible();
    expect(await layerStatuses(page)).toEqual([]);
    // The panel is as it was (on the Legend, which is where it starts): nothing was loaded for it to show.
    await expect(page.locator('karmania-panel [role="tab"][aria-selected="true"]')).toHaveText(
      'Legend',
    );
  });

  test('starts the engine itself: nothing is loaded before it is called', async ({ page }) => {
    await page.goto('/');
    const handle = await viewer(page);
    const engineBefore = await handle.evaluate(
      (element) => (element as unknown as { engine?: unknown }).engine,
    );
    expect(engineBefore).toBeUndefined();
    await loadPoints(page);
    const engineAfter = await handle.evaluate(
      (element) => typeof (element as unknown as { engine?: unknown }).engine,
    );
    expect(engineAfter).toBe('object');
  });

  test('rejects when the viewer is out of a page, and does not make an engine that nothing would let go', async ({
    page,
  }) => {
    await page.goto('/');
    const outcome = await page.evaluate(async () => {
      const element = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer') as unknown as HTMLElement & {
        engine?: unknown;
        load(input: unknown): Promise<unknown>;
      };
      element.remove();
      let message = '';
      try {
        await element.load({
          kind: 'points',
          name: 'Collars',
          crs: { kind: 'epsg', code: 32640 },
          x: new Float64Array([500_000]),
          y: new Float64Array([2_765_000]),
        });
      } catch (error) {
        message = (error as Error).message;
      }
      return { message, engine: typeof element.engine };
    });
    expect(outcome.message).toBe(
      'The viewer is not in a page: put it in one before loading a dataset.',
    );
    expect(outcome.engine).toBe('undefined');
  });
});
