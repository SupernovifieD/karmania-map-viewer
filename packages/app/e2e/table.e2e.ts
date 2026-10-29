import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';

const ROW = 28;
const HEADER = 32;

/** The parts of the table in a gallery demo. */
function parts(page: Page, id: string) {
  const demo = page.locator(`#${id}`);
  return {
    demo,
    host: demo.locator('k-table'),
    viewport: demo.locator('.viewport'),
    header: demo.locator('.header'),
    headings: demo.locator('.header [role="columnheader"]'),
    rows: demo.locator('.rows [role="row"]'),
    numbers: demo.locator('.rows [role="rowheader"]'),
  };
}

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('not shown');
  }
  return box;
}

/** Scrolls the table's viewport, and waits for the rows to be drawn for it. */
async function scrollTo(viewport: Locator, left: number, top: number): Promise<void> {
  await viewport.evaluate(
    (element, [x, y]) => {
      element.scrollTo(x ?? 0, y ?? 0);
    },
    [left, top],
  );
}

/** The row numbers drawn, as numbers. */
async function drawn(rows: Locator): Promise<number[]> {
  return (await rows.allTextContents()).map((text) => Number(text.trim()));
}

test.describe('the table', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
  });

  test('draws the header and every row of a table with few rows, and has nothing to scroll down', async ({
    page,
  }) => {
    const p = parts(page, 'table-few');
    await expect(p.rows).toHaveCount(5);
    expect(await drawn(p.numbers)).toEqual([1, 2, 3, 4, 5]);
    await expect(p.headings).toHaveText([
      '# Row',
      'id',
      'easting',
      'label',
      'inside',
      'a column further along the table',
      'and another',
    ]);
    const scrolls = await p.viewport.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    );
    expect(scrolls).toBe(0);
  });

  test('draws only the rows in view, and a few beyond, of a table of a hundred thousand', async ({
    page,
  }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    const count = await p.rows.count();
    // The room is 6 x 48 = 288 high, less the header: about nine rows, one more, and four beyond.
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThan(25);
    const numbers = await drawn(p.numbers);
    expect(numbers[0]).toBe(1);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    // The scroll bar is for all of them.
    const height = await p.viewport.evaluate((element) => element.scrollHeight);
    expect(height).toBe(HEADER + 100_000 * ROW);
  });

  test('sets the header 32 high and the rows 28 high', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    expect((await rect(p.header)).height).toBe(HEADER);
    const first = await rect(p.rows.nth(0));
    const second = await rect(p.rows.nth(1));
    expect(first.height).toBe(ROW);
    expect(second.y - first.y).toBe(ROW);
    // The first row is just under the header.
    expect(first.y).toBe((await rect(p.header)).y + HEADER);
  });

  test('draws the rows that are in view, wherever it is scrolled to', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    for (const row of [1000, 50_000, 99_000, 12_345, 0]) {
      await scrollTo(p.viewport, 0, row * ROW);
      await expect.poll(async () => (await drawn(p.numbers))[0] !== undefined).toBe(true);
      await expect
        .poll(async () => {
          const numbers = await drawn(p.numbers);
          return numbers.includes(row + 1);
        })
        .toBe(true);
      // Every row drawn says what row it is, in its row number and in its cells.
      const cells = await p.rows.evaluateAll((all) =>
        all.map((element) => {
          const texts = [...element.querySelectorAll('[role="gridcell"], [role="rowheader"]')].map(
            (cell) => cell.textContent.trim(),
          );
          return texts;
        }),
      );
      for (const texts of cells) {
        const [number, id, , label] = texts;
        expect(id).toBe(number);
        expect(label).toBe(`Feature ${number ?? ''}`);
      }
      // The row at the top is the first row under the header.
      const top = await rect(p.rows.filter({ hasText: new RegExp(`^\\s*${String(row + 1)}\\s`) }));
      expect(top.y).toBe((await rect(p.viewport)).y + HEADER);
    }
  });

  test('ends with the last row at the bottom of the table', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    await scrollTo(p.viewport, 0, 1e9);
    await expect.poll(async () => (await drawn(p.numbers)).at(-1)).toBe(100_000);
    const rows = await p.rows.count();
    const last = await rect(p.rows.nth(rows - 1));
    const viewport = await p.viewport.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.y + element.clientHeight;
    });
    expect(last.y + last.height).toBe(viewport);
  });

  test('keeps the header at the top while the rows go by', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    const top = (await rect(p.viewport)).y;
    for (const row of [0, 40, 5000]) {
      await scrollTo(p.viewport, 0, row * ROW);
      expect((await rect(p.header)).y).toBe(top);
    }
  });

  test('keeps the row numbers at the left while the columns go by, and scrolls only inside itself', async ({
    page,
  }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    const sideways = await p.viewport.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(sideways).toBeGreaterThan(100);
    const left = (await rect(p.viewport)).x;
    await scrollTo(p.viewport, sideways, 28 * 500);
    await expect.poll(async () => (await drawn(p.numbers)).includes(501)).toBe(true);
    // The row numbers and the corner of the header are where they were, and the last column is in view.
    expect((await rect(p.numbers.first())).x).toBe(left);
    expect((await rect(p.headings.first())).x).toBe(left);
    const lastHeading = await rect(p.headings.last());
    const viewport = await rect(p.viewport);
    // The widths are not whole pixels, so the edge may be a fraction past the last whole one.
    expect(lastHeading.x + lastHeading.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    // The page itself did not move.
    const page_ = await page.evaluate(() => [window.scrollX, document.documentElement.scrollLeft]);
    expect(page_).toEqual([0, 0]);
  });

  test('sets numbers on the right and text on the left, and the row numbers muted', async ({
    page,
  }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    const row = p.rows.first();
    const cell = (index: number) => row.locator('[role="gridcell"]').nth(index);
    const align = async (locator: Locator): Promise<string> => {
      const box = await rect(locator);
      const textBox = await locator.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        return [text.left, text.right];
      });
      const left = (textBox[0] ?? 0) - box.x;
      const right = box.x + box.width - (textBox[1] ?? 0);
      // The padding is 8; a row number has a line down its right side as well.
      return left < 9.5 ? 'left' : right < 9.5 ? 'right' : `${String(left)}/${String(right)}`;
    };
    expect(await align(cell(0))).toBe('right'); // id, whole numbers
    expect(await align(cell(1))).toBe('right'); // easting, decimals
    expect(await align(cell(2))).toBe('left'); // label, text
    expect(await align(p.numbers.first())).toBe('right');
    const colors = await page.evaluate(() => {
      const color = (selector: string): string => {
        const element = document
          .querySelector('karmania-gallery')
          ?.shadowRoot?.querySelector('#table-many k-table')
          ?.shadowRoot?.querySelector(selector);
        return element === null || element === undefined ? '' : getComputedStyle(element).color;
      };
      return [color('.rows [role="rowheader"]'), color('.rows [role="gridcell"]')];
    });
    expect(colors[0]).not.toBe(colors[1]);
  });

  test('says what it is to assistive technology: a grid of rows and columns, with the numbers of all of them', async ({
    page,
  }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    await expect(p.viewport).toHaveAttribute('role', 'grid');
    await expect(p.viewport).toHaveAccessibleName('Many rows');
    await expect(p.viewport).toHaveAttribute('aria-rowcount', '100001');
    await expect(p.viewport).toHaveAttribute('aria-colcount', '7');
    await expect(p.header).toHaveAttribute('aria-rowindex', '1');
    await expect(p.rows.first()).toHaveAttribute('aria-rowindex', '2');
    await scrollTo(p.viewport, 0, 28 * 70_000);
    await expect.poll(async () => (await drawn(p.numbers)).includes(70_001)).toBe(true);
    const indexes = await p.rows.evaluateAll((all) =>
      all.map((row) => [row.getAttribute('aria-rowindex'), row.textContent.trim().split(/\s/)[0]]),
    );
    for (const [index, number] of indexes) {
      expect(Number(index)).toBe(Number(number) + 1);
    }
  });

  test('can be scrolled with the keyboard, and shows where the keyboard is', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    await page.keyboard.press('Shift');
    await p.viewport.focus();
    const ring = await p.viewport.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth];
    });
    expect(ring).toEqual(['solid', '2px']);
    await page.keyboard.press('PageDown');
    await expect
      .poll(async () => p.viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  });

  test('starts again at the first row when it is given other rows', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    await scrollTo(p.viewport, 300, 28 * 5000);
    await expect.poll(async () => (await drawn(p.numbers)).includes(5001)).toBe(true);
    await p.host.evaluate((element) => {
      (element as unknown as { rowCount: number }).rowCount = 300;
    });
    await expect.poll(async () => (await drawn(p.numbers))[0]).toBe(1);
    expect(await p.viewport.evaluate((element) => [element.scrollTop, element.scrollLeft])).toEqual(
      [0, 0],
    );
    await expect(p.viewport).toHaveAttribute('aria-rowcount', '301');
  });

  test('draws more rows when it is made taller', async ({ page }) => {
    const p = parts(page, 'table-many');
    await expect(p.rows.first()).toBeVisible();
    const before = await p.rows.count();
    await p.demo.evaluate((element) => {
      element.style.height = '700px';
    });
    await expect.poll(async () => p.rows.count()).toBeGreaterThan(before + 10);
  });

  test('asks for pages of 256 rows, only for those in view, and each only once', async ({
    page,
  }) => {
    const asked = await page.evaluate(async () => {
      const calls: [number, number][] = [];
      const holder = document.createElement('div');
      holder.style.cssText = 'height: 300px; width: 400px;';
      const table = document.createElement('k-table') as HTMLElement & {
        rowCount: number;
        fetch: (start: number, count: number) => Promise<unknown>;
      };
      table.rowCount = 1000;
      table.fetch = (start, count) => {
        calls.push([start, count]);
        return Promise.resolve({
          start,
          count,
          columns: [
            {
              name: 'n',
              values: Int32Array.from({ length: count }, (_, index) => start + index),
              nulls: new Uint8Array(count),
            },
          ],
        });
      };
      holder.append(table);
      document.body.append(holder);
      const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));
      await settle();
      const atTop = calls.map((call) => [...call]);
      const viewport = table.shadowRoot?.querySelector('.viewport');
      viewport?.scrollTo(0, 28 * 600);
      await settle();
      viewport?.scrollTo(0, 28 * 600 + 5);
      await settle();
      const result = { atTop, after: calls.map((call) => [...call]) };
      holder.remove();
      return result;
    });
    expect(asked.atTop).toEqual([[0, 256]]);
    // Row 600 is in the third page (512 to 767), and the rows round it are in it too.
    expect(asked.after).toEqual([
      [0, 256],
      [512, 256],
    ]);
  });

  test('ignores an answer that comes after the table has started again', async ({ page }) => {
    const shown = await page.evaluate(async () => {
      const table = document.createElement('k-table') as HTMLElement & {
        rowCount: number;
        fetch: (start: number, count: number) => Promise<unknown>;
        updateComplete: Promise<boolean>;
      };
      const holder = document.createElement('div');
      holder.style.cssText = 'height: 300px; width: 400px;';
      const rows = (name: string, start: number, count: number) => ({
        start,
        count,
        columns: [
          {
            name,
            values: Array.from({ length: count }, () => name),
            nulls: new Uint8Array(count),
          },
        ],
      });
      let release: (() => void) | undefined;
      table.rowCount = 10;
      table.fetch = (start, count) =>
        new Promise((resolve) => {
          release = () => {
            resolve(rows('slow', start, count));
          };
        });
      holder.append(table);
      document.body.append(holder);
      await table.updateComplete;
      table.rowCount = 20;
      table.fetch = (start, count) => Promise.resolve(rows('quick', start, count));
      await new Promise((resolve) => setTimeout(resolve, 100));
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const names = [
        ...(table.shadowRoot?.querySelectorAll('.header [role="columnheader"]') ?? []),
      ].map((heading) => heading.textContent.replace(/\s+/g, ' ').trim());
      holder.remove();
      return names;
    });
    expect(shown).toEqual(['# Row', 'quick']);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expect(parts(page, 'table-many').rows.first()).toBeVisible();
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="table"]']);
    });
  }
});
