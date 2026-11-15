/**
 * The contour lines of a layer end to end in a real browser (brief 10.3, 11.5): the scene says a layer has contours, the engine makes them in the worker, the
 * lines are listed under their layer in the Data tab, have a layer of their own above it in the legend, and are drawn, the index lines wider. The settings are
 * given as commands here (the controls of the style editor have their own tests).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  camera,
  dispatch,
  drawn,
  expectLayersDrawn,
  layerStatuses,
  loadLattice,
  mapColour,
  pause,
  pixels,
} from './support/render.js';

const LINE = [0xa0, 0x71, 0x3f];

/** A grid of 21 columns by 5 rows of cells of 10 m, whose value is its column: vertical lines at every whole value, 10 m apart. */
const BANDS = {
  name: 'Bands',
  crs: { kind: 'epsg', code: 32640 },
  origin: [500_000, 4_000_000, 0],
  spacing: [10, 10, 1],
  dims: [21, 5, 1],
  values: Array.from({ length: 105 }, (_, k) => k % 21),
} as const;

const contours = (over: Record<string, unknown> = {}) => ({
  type: 'setContours',
  layerId: 'layer-1',
  contours: { column: 'value', interval: 1, base: 0, indexEvery: 5, visible: true, ...over },
});

interface Held {
  readonly datasets: {
    id: number;
    name: string;
    kind: string;
    derivedFrom?: { id: number; params: Record<string, unknown> };
  }[];
  readonly engine: string[];
  readonly layers: {
    id: string;
    name: string;
    visible: boolean;
    datasetId: number;
    derived: boolean;
  }[];
  readonly legend: string[];
  readonly state: { status: string; findings?: { code: string }[] };
  readonly selected: number | undefined;
}

/** What the viewer holds: its datasets, the engine's, the layers of the scene in the order of the legend, and where the contours of the first layer are. */
function held(page: Page): Promise<Held> {
  return page.locator('karmania-viewer').evaluate((element) => {
    const viewer = element as unknown as {
      datasets: Held['datasets'];
      engine: { datasets: () => { name: string }[] };
      scene: () => {
        layers: Record<
          string,
          { id: string; name: string; visible: boolean; datasetId: number; derived?: unknown }
        >;
        legend: { type: string; id: string }[];
      };
      contoursState: (id: string) => Held['state'];
      selected: number | undefined;
    };
    const scene = viewer.scene();
    return {
      datasets: viewer.datasets,
      engine: viewer.engine.datasets().map((d) => d.name),
      layers: Object.values(scene.layers).map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        datasetId: l.datasetId,
        derived: l.derived !== undefined,
      })),
      legend: scene.legend.map((node) => node.id),
      state: viewer.contoursState('layer-1'),
      selected: viewer.selected,
    };
  });
}

async function start(page: Page): Promise<void> {
  await page.goto('/?theme=light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadLattice(page, 'grid', BANDS);
  await drawn(page);
  await expectLayersDrawn(page, 1);
  await expect.poll(async () => (await camera(page)).unitsPerPixel).not.toBe(1);
}

/** The width in pixels of each line that crosses the middle row of the map, from the left: the sum of how much of the line's colour each pixel has. */
async function widths(page: Page): Promise<number[]> {
  const background = await mapColour(page);
  const { width, height } = await page.locator('karmania-map-area canvas').evaluate((canvas) => ({
    width: (canvas as HTMLCanvasElement).width,
    height: (canvas as HTMLCanvasElement).height,
  }));
  const row = await pixels(page, [0, Math.floor(height / 2), width, 1]);
  const toLine = LINE.map((channel, i) => channel - (background[i] ?? 0));
  const span = toLine.reduce((sum, d) => sum + d * d, 0);
  const found: number[] = [];
  let run = 0;
  for (let x = 0; x < width; x += 1) {
    const here = [0, 1, 2].map((i) => (row[x * 4 + i] ?? 0) - (background[i] ?? 0));
    const share = Math.min(
      1,
      Math.max(0, here.reduce((sum, d, i) => sum + d * (toLine[i] ?? 0), 0) / span),
    );
    if (share > 0.02) {
      run += share;
    } else if (run > 0) {
      found.push(run);
      run = 0;
    }
  }
  return found;
}

/** Waits for the lines to be there and drawn: two layers, both drawn. */
const linesDrawn = (page: Page) => expectLayersDrawn(page, 2);

test.describe('the contours of a layer', () => {
  test('are made when the scene says so: listed under the layer in the Data tab, a layer above it in the legend, and drawn', async ({
    page,
  }) => {
    await start(page);
    await dispatch(page, contours());
    await linesDrawn(page);
    const state = await held(page);
    expect(state.datasets.map((d) => d.name)).toEqual(['Bands', 'Contours of Bands (every 1)']);
    expect(state.engine).toEqual(state.datasets.map((d) => d.name));
    expect(state.datasets[1]?.derivedFrom).toMatchObject({
      id: state.datasets[0]?.id,
      params: { column: 'value', interval: 1, base: 0, indexEvery: 5 },
    });
    // The layer of the lines is directly above its source in the legend, which is the draw order: over it, in the colour of contours, and the viewer gave the lines no other layer.
    expect(state.legend).toEqual(['layer-2', 'layer-1']);
    expect(state.layers.map((l) => [l.id, l.name, l.derived, l.visible])).toEqual([
      ['layer-1', 'Bands', false, true],
      ['layer-2', 'Contours of Bands (every 1)', true, true],
    ]);
    // The Data tab lists them under their source, indented, with the icon of contours.
    await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
    const rows = page.locator('karmania-dataset-list li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveAttribute('data-derived', '');
    await expect(rows.nth(1).locator('.icon')).toHaveAttribute('name', 'mountain');
  });

  test('are drawn over their layer, which is opaque: the lines are seen on the grid and not under it', async ({
    page,
  }) => {
    await start(page);
    await dispatch(page, contours());
    await linesDrawn(page);
    const { width, height } = await page.locator('karmania-map-area canvas').evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    const middleRow = (): Promise<number[]> => pixels(page, [0, Math.floor(height / 2), width, 1]);
    // The middle row of the map with the layer of the lines hidden, and shown: the grid is visible and solid in both, and the lines make the difference.
    await dispatch(page, { type: 'setVisible', layerId: 'layer-2', visible: false });
    await pause(page, 300);
    const without = await middleRow();
    await dispatch(page, { type: 'setVisible', layerId: 'layer-2', visible: true });
    await pause(page, 300);
    const withLines = await middleRow();
    let different = 0;
    for (let x = 0; x < width; x += 1) {
      const change = Math.max(
        ...[0, 1, 2].map((i) => Math.abs((withLines[x * 4 + i] ?? 0) - (without[x * 4 + i] ?? 0))),
      );
      if (change > 30) different += 1;
    }
    // 20 lines cross the middle row; each changes a pixel or two.
    expect(different).toBeGreaterThan(14);
  });

  test('draw the index lines as wide as lines of twice the layer’s width, and the others as the layer’s: every 5th line, from the base', async ({
    page,
  }) => {
    await start(page);
    await dispatch(page, { type: 'setVisible', layerId: 'layer-1', visible: false }, contours());
    await linesDrawn(page);
    await expect.poll(async () => (await widths(page)).length).toBeGreaterThanOrEqual(15);
    const found = await widths(page);
    const mean = (list: number[]): number => list.reduce((sum, w) => sum + w, 0) / list.length;
    // Lines at 1, 2, 3, ... across the grid: the 5th, 10th and 15th are index lines (every 5th from the base 0).
    const ordinary = mean(found.filter((_, i) => (i + 1) % 5 !== 0).slice(0, 12));
    const heavy = mean(found.filter((_, i) => (i + 1) % 5 === 0).slice(0, 3));
    expect(heavy / ordinary).toBeGreaterThan(1.5);
    // By the renderer's own measure: lines with no index lines (one every 1,000), of the layer's width and of twice it.
    const onlyOrdinary = async (lineWidth: number): Promise<number> => {
      await dispatch(
        page,
        { type: 'setStyle', layerId: 'layer-2', patch: { lineWidth } },
        contours({ indexEvery: 1000 }),
      );
      await expect
        .poll(async () => (await held(page)).datasets[1]?.derivedFrom?.params['indexEvery'])
        .toBe(1000);
      await linesDrawn(page);
      await expect.poll(async () => (await widths(page)).length).toBeGreaterThanOrEqual(15);
      return mean((await widths(page)).slice(0, 15));
    };
    const once = await onlyOrdinary(1);
    const twice = await onlyOrdinary(2);
    expect(Math.abs(ordinary - once) / once).toBeLessThan(0.2);
    expect(Math.abs(heavy - twice) / twice).toBeLessThan(0.2);
  });

  test('are made again when the interval changes: the new lines replace the old in the same layer, with the style the person gave it, in one list', async ({
    page,
  }) => {
    await start(page);
    await dispatch(page, contours());
    await linesDrawn(page);
    // The lines are selected in the Data tab: when they are made again, the new lines are.
    await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
    await page.locator('karmania-dataset-list li[data-derived] .choose').click();
    const first = (await held(page)).selected;
    expect(first).toBe((await held(page)).datasets[1]?.id);
    await dispatch(page, {
      type: 'setStyle',
      layerId: 'layer-2',
      patch: { opacity: 0.5, colour: { mode: 'single', value: '#112233' } },
    });
    await dispatch(page, contours({ interval: 2 }));
    await expect
      .poll(async () => (await held(page)).datasets.map((d) => d.name))
      .toEqual(['Bands', 'Contours of Bands (every 2)']);
    await expect
      .poll(async () => layerStatuses(page))
      .toEqual([
        ['layer-1', 'drawn'],
        ['layer-2', 'drawn'],
      ]);
    const state = await held(page);
    expect(state.selected).toBe(state.datasets[1]?.id);
    expect(state.selected).not.toBe(first);
    await expect(page.locator('karmania-dataset-summary dt:text-is("Contours") + dd')).toHaveText(
      'every 2, counted from 0',
    );
    expect(state.engine).toEqual(['Bands', 'Contours of Bands (every 2)']);
    expect(state.layers.map((l) => [l.id, l.name])).toEqual([
      ['layer-1', 'Bands'],
      ['layer-2', 'Contours of Bands (every 2)'],
    ]);
    const style = await page.locator('karmania-viewer').evaluate((element) => {
      const viewer = element as unknown as {
        scene: () => { layers: Record<string, { style: unknown }> };
      };
      return viewer.scene().layers['layer-2']?.style;
    });
    expect(style).toEqual({
      colour: { mode: 'single', value: '#112233' },
      opacity: 0.5,
      lineWidth: 1,
    });
  });

  test('go with their layer and their dataset when the scene has no contours, and are hidden and shown with the contours', async ({
    page,
  }) => {
    await start(page);
    await dispatch(page, contours());
    await linesDrawn(page);
    await dispatch(page, contours({ visible: false }));
    await expect
      .poll(async () => (await held(page)).layers.find((l) => l.derived)?.visible)
      .toBe(false);
    expect((await held(page)).datasets).toHaveLength(2);
    await dispatch(page, contours({ visible: true }));
    await expect
      .poll(async () => (await held(page)).layers.find((l) => l.derived)?.visible)
      .toBe(true);
    // With the lines selected in the Data tab, the dataset they were made from is selected when they are gone.
    await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
    await page.locator('karmania-dataset-list li[data-derived] .choose').click();
    await dispatch(page, { type: 'setContours', layerId: 'layer-1', contours: null });
    await expect.poll(async () => (await held(page)).datasets.length).toBe(1);
    const state = await held(page);
    expect(state.selected).toBe(state.datasets[0]?.id);
    expect(state.engine).toEqual(['Bands']);
    expect(state.layers.map((l) => l.id)).toEqual(['layer-1']);
    expect(state.legend).toEqual(['layer-1']);
    await expectLayersDrawn(page, 1);
  });

  test('say why they were not made, with no lines left: more than 1,000 levels is a finding', async ({
    page,
  }) => {
    await start(page);
    await dispatch(page, contours());
    await linesDrawn(page);
    await dispatch(page, contours({ interval: 0.001 }));
    await expect.poll(async () => (await held(page)).state.status).toBe('failed');
    const state = await held(page);
    expect(state.state.findings?.map((f) => f.code)).toEqual(['contours.levels.too_many']);
    expect(state.datasets.map((d) => d.name)).toEqual(['Bands']);
    expect(state.layers.map((l) => l.id)).toEqual(['layer-1']);
    // Other settings are made, and the reason is gone.
    await dispatch(page, contours({ interval: 2 }));
    await linesDrawn(page);
    expect((await held(page)).state.status).toBe('idle');
  });

  test('go with their source when it is removed in the Data tab', async ({ page }) => {
    await start(page);
    await dispatch(page, contours());
    await linesDrawn(page);
    await page.locator('karmania-panel k-tabs [role="tab"]').filter({ hasText: 'Data' }).click();
    await page
      .locator('karmania-dataset-list li[data-dataset="Bands"] .remove k-button button')
      .click();
    await expect(page.locator('karmania-dataset-list .confirm .made')).toContainText(
      'Contours of Bands (every 1)',
    );
    await page.locator('karmania-dataset-list k-button[slot="footer-end"]').click();
    await expect(page.locator('karmania-dataset-list li')).toHaveCount(0);
    const state = await held(page);
    expect(state.layers).toEqual([]);
    expect(state.engine).toEqual([]);
  });
});
