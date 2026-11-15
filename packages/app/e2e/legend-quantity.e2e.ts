import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertAligned, assertNoOverflow } from './support/layout.js';
import { layerRow, legend, loadGrid, loadMany, showLegend } from './support/legend.js';
import { dispatch } from './support/render.js';

/**
 * The Legend tab with a lot in it (step 19.10): 50 layers, 12 classes with the long labels of numbers that are not rounded, and counts of ten million. Names of 120
 * characters are in `legend-tab.e2e.ts`.
 */

/** The part of the panel that scrolls, with the tab in it. */
const region = (page: Page): Locator =>
  page.locator('karmania-panel [data-scroll-region][slot="legend"]');

/** The classes of a layer by the values `i / 7`, which are bounds of 15 digits: 12 of them, and the cells with no value. */
const SEVENTHS = [
  ...Array.from({ length: 13 }, (_, i) => (i + 1) / 7),
  Number.NaN,
  Number.NaN,
  Number.NaN,
];

/** Counts as large as those of a model of ten million blocks, in the order of the lines. */
const BIG = [
  10_000_000, 9_876_543, 8_765_432, 7_654_321, 6_543_210, 5_432_109, 4_321_098, 3_210_987,
  2_109_876, 1_098_765, 987_654, 123_456, 123_456_789,
];

/** Sets a layer to 12 classes and opens it, and waits for their lines (and the line of the cells with no value, if it has some). */
async function twelve(page: Page, id: string, lines: number): Promise<void> {
  await dispatch(page, {
    type: 'setStyle',
    layerId: id,
    patch: {
      colour: {
        mode: 'classes',
        column: 'value',
        method: 'equal',
        classes: 12,
        ramp: 'viridis',
        reverse: false,
      },
    },
  });
  await layerRow(page, id).locator('.open').click();
  await expect(legend(page).locator(`#legend-classes-${id} .entry`)).toHaveCount(lines);
}

/** Gives the tab a legend whose lines have the counts of `BIG` (the engine's own counts are those of a grid of 16 cells). */
async function withBigCounts(page: Page): Promise<void> {
  await legend(page).evaluate((tab, big) => {
    type Line = Record<string, unknown>;
    const shown = tab as unknown as {
      model: { entries: { type: string; classes?: Line[] }[] } & Record<string, unknown>;
    };
    shown.model = {
      ...shown.model,
      entries: shown.model.entries.map((entry) =>
        entry.type === 'layer' && entry.classes !== undefined
          ? {
              ...entry,
              classes: entry.classes.map((line, i) => ({
                ...line,
                count: big[i],
                countLabel: (big[i] ?? 0).toLocaleString('en-US'),
              })),
            }
          : entry,
      ),
    };
  }, BIG);
}

test.describe('the Legend tab with a lot in it', () => {
  test('holds 50 layers: a row each, 32 high, in a list that scrolls and a page that does not, and the keyboard reaches the last row and the first', async ({
    page,
  }) => {
    test.slow(true, 'it loads 50 layers');
    await page.goto('/?theme=light');
    await loadMany(page, 50);
    await showLegend(page);
    await expect(legend(page).getByText('50 layers', { exact: true })).toBeVisible();
    const rows = legend(page).locator('.row[data-layer]');
    await expect(rows).toHaveCount(50);
    const heights = await rows.evaluateAll((all) =>
      all.map((row) => row.getBoundingClientRect().height),
    );
    expect(new Set(heights)).toEqual(new Set([32]));
    // The list scrolls inside the panel, and the page and the list do not scroll across.
    const sizes = await region(page).evaluate((element) => ({
      scrolls: element.scrollHeight > element.clientHeight,
      across: element.scrollWidth - element.clientWidth,
      page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(sizes).toEqual({ scrolls: true, across: 0, page: 0 });
    await assertNoOverflow(legend(page));
    // The layer loaded last is at the top. End goes to the first loaded, at the bottom, and shows it; Home goes back.
    await layerRow(page, 'layer-50').focus();
    await page.keyboard.press('End');
    await expect(layerRow(page, 'layer-1')).toBeFocused();
    const inside = async (id: string): Promise<boolean> => {
      const area = await region(page).boundingBox();
      const row = await layerRow(page, id).boundingBox();
      return (
        row !== null &&
        area !== null &&
        row.y >= area.y &&
        row.y + row.height <= area.y + area.height
      );
    };
    await expect.poll(() => inside('layer-1')).toBe(true);
    await page.keyboard.press('Home');
    await expect(layerRow(page, 'layer-50')).toBeFocused();
    await expect.poll(() => inside('layer-50')).toBe(true);
    expect(await region(page).evaluate((element) => element.scrollTop)).toBe(0);
  });

  test('holds 12 classes of numbers that are not rounded: twelve lines of 24 and the cells with no value, the labels cut with an ellipsis, the counts at the right edge, nothing overflowing', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadGrid(page, 'Assays', 1, SEVENTHS);
    await showLegend(page);
    await twelve(page, 'layer-1', 13);
    const lines = legend(page).locator('#legend-classes-layer-1 .entry');
    const heights = await lines.evaluateAll((all) =>
      all.map((line) => line.getBoundingClientRect().height),
    );
    expect(new Set(heights)).toEqual(new Set([24]));
    // The last is the cells with no value; the others are the classes, each with its range.
    await expect(lines.last().locator('.label')).toHaveText('No value');
    const labels = lines.locator('.label');
    expect(
      await labels.evaluateAll((all) => all.map((label) => label.getAttribute('title'))),
    ).toHaveLength(13);
    await expect(labels.first()).toHaveCSS('text-overflow', 'ellipsis');
    // At least one label is longer than its room, and says all of it when it is pointed at.
    expect(
      await labels.evaluateAll((all) => all.some((label) => label.scrollWidth > label.clientWidth)),
    ).toBe(true);
    await assertAligned(await lines.locator('.dot').all(), 'left');
    await assertAligned(await lines.locator('.figure').all(), 'right');
    await assertNoOverflow(legend(page));
  });

  test('holds counts of ten million: written whole, with commas, at the right edge, inside the panel, with the labels keeping room', async ({
    page,
  }) => {
    await page.goto('/?theme=light');
    await loadGrid(page, 'Assays', 1, SEVENTHS);
    await showLegend(page);
    await twelve(page, 'layer-1', 13);
    await withBigCounts(page);
    const figures = legend(page).locator('#legend-classes-layer-1 .figure');
    await expect(figures.first()).toHaveText('10,000,000');
    await expect(figures.nth(12)).toHaveText('123,456,789');
    await assertAligned(await figures.all(), 'right');
    // The widest count is whole (not cut) and inside what scrolls.
    const area = await region(page).boundingBox();
    for (const figure of await figures.all()) {
      const box = await figure.boundingBox();
      expect(await figure.evaluate((one) => one.scrollWidth <= one.clientWidth)).toBe(true);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (area?.x ?? 0) + (area?.width ?? 0),
      );
    }
    // The labels have room left for something: they are cut, and not squeezed to nothing.
    for (const label of await legend(page).locator('#legend-classes-layer-1 .label').all()) {
      expect((await label.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(64);
    }
    await assertNoOverflow(legend(page));
  });

  test('has no serious accessibility violation with 50 layers, one of them open on 12 classes with counts of ten million', async ({
    page,
  }) => {
    test.slow(true, 'it loads 50 layers, and axe reads all of their rows');
    await page.goto('/?theme=light');
    await loadMany(page, 50);
    await showLegend(page);
    await twelve(page, 'layer-50', 12);
    await withBigCounts(page);
    await expectNoSeriousViolations(page);
  });
});
