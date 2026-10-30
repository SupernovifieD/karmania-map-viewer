import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe.js';
import { assertNoOverflow } from './support/layout.js';

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
    const ringOf = (locator: Locator) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth];
      });
    // The cell the keyboard is on has the ring, while it is in view, and the table has none, so that
    // there is one and not a half of one under the header.
    expect(await ringOf(p.demo.locator('.cell.active'))).toEqual(['solid', '2px']);
    expect((await ringOf(p.viewport))[0]).toBe('none');
    await page.keyboard.press('PageDown');
    await expect
      .poll(async () => p.viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    // Scrolled away from that cell with the mouse, the table has the ring, so that the keyboard is
    // still somewhere that can be seen.
    await p.viewport.evaluate((element) => {
      element.scrollTo(0, 28 * 60_000);
    });
    await expect.poll(async () => (await drawn(p.numbers)).includes(60_001)).toBe(true);
    expect(await ringOf(p.viewport)).toEqual(['solid', '2px']);
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

  test('asks for pages of 256 rows, for those in view and the one on either side, and each only once', async ({
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
    // The rows in view are in the first page, and the page after it is on its way.
    expect(asked.atTop).toEqual([
      [0, 256],
      [256, 256],
    ]);
    // Row 600 is in the third page (512 to 767): that, and the one after it (the last, which is short).
    expect(asked.after).toEqual([
      [0, 256],
      [256, 256],
      [512, 256],
      [768, 232],
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

  test.describe('its columns', () => {
    /** The widths of the columns of values, from the header. */
    const widths = (p: ReturnType<typeof parts>): Promise<number[]> =>
      p.headings.evaluateAll((all) =>
        all.slice(1).map((heading) => heading.getBoundingClientRect().width),
      );

    /** Whether the words in a cell are cut off, which is when they are wider than the cell. */
    const isCut = (locator: Locator): Promise<boolean> =>
      locator.evaluate((element) => element.scrollWidth > element.clientWidth);

    test('are as wide as the widest words in the first rows and the room round them, to a whole pixel', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await expect(p.rows.first()).toBeVisible();
      const found = await p.viewport.evaluate((viewport) => {
        // The words of the first 200 rows of a column, set as the table sets them, in a box of their own.
        const natural = (texts: string[], weight: string): number => {
          const probe = document.createElement('span');
          probe.style.cssText = `position: absolute; visibility: hidden; white-space: nowrap; font-weight: ${weight}`;
          viewport.append(probe);
          let widest = 0;
          for (const text of texts) {
            probe.textContent = text;
            widest = Math.max(widest, probe.getBoundingClientRect().width);
          }
          probe.remove();
          return widest;
        };
        const rows = Array.from({ length: 200 }, (_, index) => index + 1);
        const regular = getComputedStyle(viewport).fontWeight;
        const columns = [
          { header: 'id', texts: rows.map(String) },
          { header: 'easting', texts: rows.map((row) => String(500_000 + (row - 1) * 0.5)) },
          { header: 'label', texts: rows.map((row) => `Feature ${String(row)}`) },
          { header: 'inside', texts: rows.map((row) => String((row - 1) % 2)) },
        ];
        return columns.map(({ header, texts }) => {
          const widest = Math.max(natural([header], '500'), natural(texts, regular));
          return Math.min(320, Math.max(72, Math.ceil(widest) + 16));
        });
      });
      const actual = (await widths(p)).slice(0, 4);
      // A pixel either way, for the difference between measuring words one by one and drawing them.
      actual.forEach((width, index) => {
        expect(
          Math.abs(width - (found[index] ?? 0)),
          `column ${String(index + 1)}`,
        ).toBeLessThanOrEqual(1);
        expect(Number.isInteger(width)).toBe(true);
      });
    });

    test('do not cut off any of the words they were measured from', async ({ page }) => {
      const p = parts(page, 'table-many');
      await expect(p.rows.first()).toBeVisible();
      const cells = p.demo.locator(
        '.rows [role="gridcell"], .rows [role="rowheader"], .header .cell',
      );
      const total = await cells.count();
      for (let index = 0; index < total; index += 1) {
        expect(await isCut(cells.nth(index)), `cell ${String(index)}`).toBe(false);
      }
      await expect(p.demo.locator('[title]')).toHaveCount(0);
    });

    test('are between 72 and 320 wide, however little or much is in them', async ({ page }) => {
      const p = parts(page, 'table-clamped');
      await expect(p.rows.first()).toBeVisible();
      const [n, description, header, amount, later] = await widths(p);
      expect(n).toBe(72);
      expect(description).toBe(320);
      expect(header).toBe(320);
      expect(amount).toBeGreaterThan(72);
      expect(amount).toBeLessThan(320);
      // Short for the first 200 rows, which are all that is looked at.
      expect(later).toBeLessThan(120);
    });

    test('mark the words they cut as cut on purpose, so that an ellipsis is not taken for an overflow', async ({
      page,
    }) => {
      const p = parts(page, 'table-clamped');
      await expect(p.rows.first()).toBeVisible();
      // Cells that are cut, in the body and in the header, which is what the layout check looks at.
      expect(await isCut(p.rows.first().locator('[role="gridcell"]').nth(1))).toBe(true);
      expect(await isCut(p.headings.nth(3))).toBe(true);
      const unmarked = await p.demo
        .locator('.rows [role="gridcell"], .header [role="columnheader"]:not(.number)')
        .evaluateAll((all) => all.filter((cell) => !cell.hasAttribute('data-truncate')).length);
      expect(unmarked).toBe(0);
      // The gallery scrolls down, so only across is held to the window.
      await assertNoOverflow(p.demo, { window: 'horizontal' });
    });

    test('end words that do not fit in an ellipsis, and say them in full in the title', async ({
      page,
    }) => {
      const p = parts(page, 'table-clamped');
      await expect(p.rows.first()).toBeVisible();
      const row = p.rows.first();
      const description = row.locator('[role="gridcell"]').nth(1);
      const style = await description.evaluate((element) => {
        const computed = getComputedStyle(element);
        return [computed.textOverflow, computed.whiteSpace, computed.overflow];
      });
      expect(style).toEqual(['ellipsis', 'nowrap', 'hidden']);
      expect(await isCut(description)).toBe(true);
      await expect(description).toHaveAttribute(
        'title',
        /^A description that goes on and on.*, row 1$/,
      );
      // The words are all in the page for a screen reader, and the title says them again in full.
      await expect(description).toHaveText(/row 1$/);
      // The header that is too long says its name in full too.
      const heading = p.headings.nth(3);
      expect(await isCut(heading)).toBe(true);
      await expect(heading).toHaveAttribute(
        'title',
        /^A header that is far longer than anything under it/,
      );
    });

    test('give no title to words that fit, and a title to those that do not, past the first 200 rows', async ({
      page,
    }) => {
      const p = parts(page, 'table-clamped');
      await expect(p.rows.first()).toBeVisible();
      const later = (row: number) =>
        p.rows
          .filter({
            has: page.locator(`[role="rowheader"]`, {
              hasText: new RegExp(`^\\s*${String(row)}\\s*$`),
            }),
          })
          .locator('[role="gridcell"]')
          .nth(4);
      await expect(later(1)).not.toHaveAttribute('title', /.*/);
      await scrollTo(p.viewport, 0, 28 * 500);
      await expect(later(501)).toHaveAttribute(
        'title',
        'much longer than the first two hundred rows were',
      );
      expect(await isCut(later(501))).toBe(true);
    });

    test('keep their widths while the table is scrolled', async ({ page }) => {
      const p = parts(page, 'table-many');
      await expect(p.rows.first()).toBeVisible();
      const before = await widths(p);
      await scrollTo(p.viewport, 0, 28 * 99_000);
      await expect.poll(async () => (await drawn(p.numbers)).includes(99_001)).toBe(true);
      expect(await widths(p)).toEqual(before);
      // The rows are as wide as the header, so that the columns line up.
      const lefts = await p.demo.evaluate((demo) => {
        const header = [...demo.querySelectorAll('.header .cell')].map(
          (cell) => cell.getBoundingClientRect().left,
        );
        const row = [...(demo.querySelector('.rows .row')?.children ?? [])].map(
          (cell) => cell.getBoundingClientRect().left,
        );
        return { header, row };
      });
      expect(lefts.row).toEqual(lefts.header);
    });

    test('have room in the row numbers for the number of the last row', async ({ page }) => {
      const p = parts(page, 'table-many');
      await expect(p.rows.first()).toBeVisible();
      await scrollTo(p.viewport, 0, 1e9);
      await expect.poll(async () => (await drawn(p.numbers)).at(-1)).toBe(100_000);
      expect(await isCut(p.numbers.last())).toBe(false);
      const width = (await rect(p.numbers.last())).width;
      // Six digits, the room round them and the line at the right: no wider than that by much.
      expect(width).toBeGreaterThan(6 * 6 + 17);
      expect(width).toBeLessThan(6 * 10 + 18);
    });

    test('scroll sideways inside the table when they are wider than the room', async ({ page }) => {
      const p = parts(page, 'table-clamped');
      await expect(p.rows.first()).toBeVisible();
      const sizes = await p.viewport.evaluate((element) => [
        element.clientWidth,
        element.scrollWidth,
      ]);
      expect(sizes[1]).toBeGreaterThan((sizes[0] ?? 0) + 100);
      // The widths are the same however wide the table's room is.
      const before = await widths(p);
      await p.demo.evaluate((element) => {
        element.style.width = '300px';
      });
      expect(await widths(p)).toEqual(before);
    });

    test('are laid out again for other rows', async ({ page }) => {
      const p = parts(page, 'table-clamped');
      await expect(p.rows.first()).toBeVisible();
      await p.host.evaluate((element) => {
        const table = element as unknown as { fetch: unknown; rowCount: number };
        table.fetch = (start: number, count: number) =>
          Promise.resolve({
            start,
            count,
            columns: [
              {
                name: 'only',
                values: Array.from(
                  { length: count },
                  () => 'a considerably longer value than any before it',
                ),
                nulls: new Uint8Array(count),
              },
            ],
          });
      });
      await expect(p.headings).toHaveText(['# Row', 'only']);
      const [only] = await widths(p);
      expect(only).toBeGreaterThan(200);
    });
  });

  test.describe('its cells', () => {
    const EXPECTED = [
      ['plain', '42', '-2000', 'true', 'plain'],
      ['a decimal', '1234567.5', '2147483647', 'false', '  spaced  '],
      ['noise', '0.3', '0', 'true', 'Ünï "quoted" & <tagged>'],
      ['minus zero', '0', '-1', 'false', ''],
      ['large', '1.5e+25', '1', 'true', 'null'],
      ['small', '1.5e-7', '10', 'false', 'x'],
      ['not a number', 'NaN', '100', 'true', 'x'],
      ['infinite', 'Infinity', '1000', 'false', 'x'],
      ['minus infinite', '-Infinity', '10000', 'true', 'x'],
      ['null', 'null', 'null', 'null', 'null'],
    ];

    const cell = (p: ReturnType<typeof parts>, row: number, column: number): Locator =>
      p.rows.nth(row).locator('[role="gridcell"]').nth(column);

    test('say each kind of value as it is: numbers plain, flags in words, text as it is, null as "null"', async ({
      page,
    }) => {
      const p = parts(page, 'table-values');
      await expect(p.rows).toHaveCount(10);
      const texts = await p.rows.evaluateAll((all) =>
        all.map((row) =>
          [...row.querySelectorAll('[role="gridcell"]')].map((element) => element.textContent),
        ),
      );
      expect(texts).toEqual(EXPECTED);
    });

    test('show text as text, and not as what it looks like', async ({ page }) => {
      const p = parts(page, 'table-values');
      await expect(p.rows).toHaveCount(10);
      const target = cell(p, 2, 4);
      await expect(target).toHaveText('Ünï "quoted" & <tagged>');
      expect(await target.evaluate((element) => element.children.length)).toBe(0);
    });

    test('mark the nulls, and only those: the word "null" is a value like any other', async ({
      page,
    }) => {
      const p = parts(page, 'table-values');
      await expect(p.rows).toHaveCount(10);
      const marked = await p.rows.evaluateAll((all) =>
        all.map((row) =>
          [...row.querySelectorAll('[role="gridcell"]')].map((element) =>
            element.classList.contains('null'),
          ),
        ),
      );
      marked.forEach((row, index) => {
        expect(row, `row ${String(index + 1)}`).toEqual(
          index === 9 ? [false, true, true, true, true] : [false, false, false, false, false],
        );
      });
    });

    test('show a null in a muted colour, upright, and in the same column as the numbers round it', async ({
      page,
    }) => {
      const p = parts(page, 'table-values');
      await expect(p.rows).toHaveCount(10);
      const style = (locator: Locator) =>
        locator.evaluate((element) => {
          const computed = getComputedStyle(element);
          return {
            color: computed.color,
            italic: computed.fontStyle,
            align: computed.textAlign,
            weight: computed.fontWeight,
          };
        });
      const muted = await style(p.numbers.first());
      const plain = await style(cell(p, 0, 1));
      const nullNumber = await style(cell(p, 9, 1));
      const nullText = await style(cell(p, 9, 4));
      expect(nullNumber.color).toBe(muted.color);
      expect(nullText.color).toBe(muted.color);
      expect(plain.color).not.toBe(muted.color);
      expect([nullNumber.italic, nullText.italic]).toEqual(['normal', 'normal']);
      expect(nullNumber.weight).toBe(plain.weight);
      // A null is on the side its column's numbers are on.
      expect(nullNumber.align).toBe(plain.align);
      expect(nullNumber.align).toBe('right');
      expect(nullText.align).not.toBe('right');
    });

    test('set numbers on the right with digits in line, and flags and text on the left', async ({
      page,
    }) => {
      const p = parts(page, 'table-values');
      await expect(p.rows).toHaveCount(10);
      const kinds = await p.rows
        .first()
        .locator('[role="gridcell"]')
        .evaluateAll((all) =>
          all.map((element) => [
            element.classList.contains('numeric'),
            getComputedStyle(element).fontVariantNumeric,
          ]),
        );
      expect(kinds.map(([numeric]) => numeric)).toEqual([false, true, true, false, false]);
      for (const [, numerals] of kinds) {
        expect(numerals).toContain('tabular-nums');
      }
    });

    test('are wide enough for all of them', async ({ page }) => {
      const p = parts(page, 'table-values');
      await expect(p.rows).toHaveCount(10);
      const cells = p.demo.locator('.rows [role="gridcell"], .header .cell');
      const total = await cells.count();
      for (let index = 0; index < total; index += 1) {
        const cut = await cells
          .nth(index)
          .evaluate((element) => element.scrollWidth > element.clientWidth);
        expect(cut, `cell ${String(index)}`).toBe(false);
      }
    });

    test('are empty, and not null, until their rows have come', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const holder = document.createElement('div');
        holder.style.cssText = 'height: 300px; width: 400px;';
        const table = document.createElement('k-table') as HTMLElement & {
          rowCount: number;
          fetch: (start: number, count: number) => Promise<unknown>;
        };
        table.rowCount = 1000;
        // The first page comes at once, and no other ever does.
        table.fetch = (start, count) =>
          start === 0
            ? Promise.resolve({
                start,
                count,
                columns: [
                  {
                    name: 'n',
                    values: Int32Array.from({ length: count }, (_, index) => index),
                    nulls: new Uint8Array(count),
                  },
                ],
              })
            : new Promise(() => undefined);
        holder.append(table);
        document.body.append(holder);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const viewport = table.shadowRoot?.querySelector('.viewport');
        viewport?.scrollTo(0, 28 * 600);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const cells = [...(table.shadowRoot?.querySelectorAll('.rows [role="gridcell"]') ?? [])];
        const found = {
          count: cells.length,
          texts: [...new Set(cells.map((element) => element.textContent))],
          marked: cells.filter((element) => element.classList.contains('null')).length,
        };
        holder.remove();
        return found;
      });
      expect(result.count).toBeGreaterThan(5);
      expect(result.texts).toEqual(['']);
      expect(result.marked).toBe(0);
    });
  });

  test.describe('with more rows than a browser can scroll through', () => {
    const ROWS = 2_000_000;

    /** The row at the top of the rows, from where the rows are. */
    const topRow = (p: ReturnType<typeof parts>): Promise<number> =>
      p.viewport.evaluate((viewport) => {
        const top = viewport.getBoundingClientRect().top + 32;
        const rows = [...viewport.querySelectorAll('.rows [role="row"]')];
        const at = rows.find((row) => {
          const box = row.getBoundingClientRect();
          return box.top <= top + 0.5 && box.bottom > top + 0.5;
        });
        return Number(at?.querySelector('[role="rowheader"]')?.textContent ?? Number.NaN);
      });

    /** How much of the rows one pixel of scrolling is. */
    const ratio = (p: ReturnType<typeof parts>): Promise<number> =>
      p.viewport.evaluate((viewport) => {
        const body = viewport.clientHeight - 32;
        return (2_000_000 * 28 - body) / (viewport.scrollHeight - 32 - body);
      });

    /** Goes to a place in the box that scrolls, as far down as `fraction` of the way. */
    const goTo = (p: ReturnType<typeof parts>, fraction: number): Promise<void> =>
      p.viewport.evaluate((viewport, f) => {
        viewport.scrollTo(0, f * (viewport.scrollHeight - viewport.clientHeight));
      }, fraction);

    test('are in a box that is no taller than a browser allows, and the scroll bar is for all of them', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      const height = await p.viewport.evaluate((element) => element.scrollHeight);
      // Eight million for the rows, and the header: not 56 million, which would not work.
      expect(height).toBe(32 + 8_000_000);
      await expect(p.viewport).toHaveAttribute('aria-rowcount', String(ROWS + 1));
      expect(await p.rows.count()).toBeLessThan(25);
    });

    test('begin at the first row, and end at the last, at the bottom of the table', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      expect(await topRow(p)).toBe(1);
      await goTo(p, 1);
      await expect.poll(async () => (await drawn(p.numbers)).at(-1)).toBe(ROWS);
      const last = await rect(p.rows.last());
      const bottom = await p.viewport.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.y + element.clientHeight;
      });
      expect(last.y + last.height).toBe(bottom);
      // Further than that is not further.
      await p.viewport.evaluate((element) => {
        element.scrollTo(0, 1e12);
      });
      expect((await drawn(p.numbers)).at(-1)).toBe(ROWS);
    });

    test('stay the box they were from the last pixels of scrolling, which draw rows past its foot', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      for (const back of [3, 2, 1, 0]) {
        await p.viewport.evaluate((element, pixels) => {
          element.scrollTo(0, element.scrollHeight - element.clientHeight - pixels);
        }, back);
        await expect
          .poll(async () => (await drawn(p.numbers)).at(-1), {
            message: `${String(back)} from the end`,
          })
          .toBe(ROWS);
        // The rows at the foot are cut off at the box's, and do not make it taller, so that there is
        // no more to scroll than the table says.
        expect(await p.viewport.evaluate((element) => element.scrollHeight)).toBe(32 + 8_000_000);
      }
      // However far it is asked to go, it goes to the same place: the last row at the foot of the table.
      await p.viewport.evaluate((element) => {
        element.scrollTo(0, 1e12);
      });
      const last = await rect(p.rows.last());
      const bottom = await p.viewport.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.y + element.clientHeight;
      });
      expect((await drawn(p.numbers)).at(-1)).toBe(ROWS);
      expect(last.y + last.height).toBe(bottom);
    });

    test('are the rows that the scroll bar says, a share of the way down for the same share of the rows', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
        await goTo(p, fraction);
        const wanted = Math.floor((fraction * (ROWS * 28 - 256)) / 28) + 1;
        await expect
          .poll(async () => Math.abs((await topRow(p)) - wanted), {
            message: `at ${String(fraction)}`,
          })
          .toBeLessThanOrEqual(1);
      }
    });

    test('are each in its own place, one under the other, with the cells of the row they belong to', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      for (const fraction of [0, 0.37, 0.8, 1]) {
        await goTo(p, fraction);
        await expect.poll(async () => (await drawn(p.numbers)).length).toBeGreaterThan(10);
        const numbers = await drawn(p.numbers);
        numbers.forEach((number, index) => {
          expect(number, `at ${String(fraction)}`).toBe((numbers[0] ?? 0) + index);
        });
        await expect
          .poll(async () =>
            p.rows.evaluateAll((all) =>
              all.every((row) => {
                const [number, id, , label] = [...row.children].map((cell) => cell.textContent);
                return id === number && label === `Feature ${number ?? ''}`;
              }),
            ),
          )
          .toBe(true);
        const tops = await p.rows.evaluateAll((all) =>
          all.map((row) => row.getBoundingClientRect().top),
        );
        tops.slice(1).forEach((top, index) => {
          expect(top - (tops[index] ?? 0)).toBe(28);
        });
      }
    });

    test('can be scrolled to any row, to within one', async ({ page }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      const scale = await ratio(p);
      // A pixel of scrolling is a few pixels of rows, which is less than a row.
      expect(scale).toBeGreaterThan(6.9);
      expect(scale).toBeLessThan(7.1);
      for (const row of [0, 1, 255, 256, 99_999, 1_000_000, 1_234_567, 1_999_000]) {
        await p.viewport.evaluate(
          (viewport, [r, scaleBy]) => {
            viewport.scrollTo(0, ((r ?? 0) * 28) / (scaleBy ?? 1));
          },
          [row, scale],
        );
        await expect
          .poll(async () => Math.abs((await topRow(p)) - (row + 1)), {
            message: `row ${String(row)}`,
          })
          .toBeLessThanOrEqual(1);
      }
    });

    test('move by no more than a row for a pixel of scrolling, and never back', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      await goTo(p, 0.5);
      await expect.poll(async () => topRow(p)).toBeGreaterThan(1_000_000 - 100);
      const tops = await p.viewport.evaluate(async (viewport) => {
        const frame = (): Promise<void> =>
          new Promise((resolve) =>
            requestAnimationFrame(() => {
              resolve();
            }),
          );
        const found: number[] = [];
        const start = viewport.scrollTop;
        for (let step = 0; step < 60; step += 1) {
          viewport.scrollTo(0, start + step);
          await frame();
          await frame();
          const top = viewport.getBoundingClientRect().top + 32;
          const row = [...viewport.querySelectorAll('.rows [role="row"]')].find((element) => {
            const box = element.getBoundingClientRect();
            return box.top <= top + 0.5 && box.bottom > top + 0.5;
          });
          found.push(Number(row?.querySelector('[role="rowheader"]')?.textContent ?? Number.NaN));
        }
        return found;
      });
      tops.slice(1).forEach((row, index) => {
        const change = row - (tops[index] ?? 0);
        expect(change, `step ${String(index + 1)}`).toBeGreaterThanOrEqual(0);
        expect(change, `step ${String(index + 1)}`).toBeLessThanOrEqual(1);
      });
      expect(tops.at(-1)).toBeGreaterThan(tops[0] ?? Number.POSITIVE_INFINITY);
    });

    test('keep the header at the top, and the row numbers at the left, as when there are fewer', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await expect(p.rows.first()).toBeVisible();
      await goTo(p, 0.6);
      await expect.poll(async () => (await topRow(p)) > 1_000_000).toBe(true);
      const viewport = await rect(p.viewport);
      expect((await rect(p.header)).y).toBe(viewport.y);
      await p.viewport.evaluate((element) => {
        element.scrollTo(element.scrollWidth, element.scrollTop);
      });
      expect((await rect(p.numbers.first())).x).toBe(viewport.x);
    });

    test('are asked for only where they are in view, and not for all the pages between', async ({
      page,
    }) => {
      const found = await page.evaluate(async () => {
        const calls: number[] = [];
        const holder = document.createElement('div');
        holder.style.cssText = 'height: 300px; width: 400px;';
        const table = document.createElement('k-table') as HTMLElement & {
          rowCount: number;
          fetch: (start: number, count: number) => Promise<unknown>;
        };
        table.rowCount = 2_000_000;
        table.fetch = (start, count) => {
          calls.push(start);
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
        const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));
        await settle();
        const viewport = table.shadowRoot?.querySelector<HTMLElement>('.viewport');
        viewport?.scrollTo(0, ((viewport.scrollHeight - viewport.clientHeight) * 3) / 4);
        await settle();
        holder.remove();
        return calls;
      });
      // The first page, the page after it, and the pages round row 1,500,000: nothing else.
      const near = (start: number): boolean => start >= 1_499_000 && start <= 1_500_500;
      expect(found.filter((start) => start > 512 && !near(start))).toEqual([]);
      expect(found.length).toBeLessThan(10);
      expect(found.some(near)).toBe(true);
    });
  });

  test('draws the line under the header and under each row the whole width of the table, though the columns are not', async ({
    page,
  }) => {
    const found = await page.evaluate(async () => {
      const holder = document.createElement('div');
      holder.style.cssText = 'height: 300px; width: 600px;';
      const table = document.createElement('k-table') as HTMLElement & {
        rowCount: number;
        fetch: (start: number, count: number) => Promise<unknown>;
        updateComplete: Promise<boolean>;
      };
      table.rowCount = 5;
      table.fetch = (start, count) =>
        Promise.resolve({
          start,
          count,
          columns: [{ name: 'n', values: Int32Array.of(1, 2, 3, 4, 5), nulls: new Uint8Array(5) }],
        });
      holder.append(table);
      document.body.append(holder);
      await table.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const root = table.shadowRoot;
      const viewport = root?.querySelector('.viewport');
      const lines = [root?.querySelector('.header'), ...(root?.querySelectorAll('.row') ?? [])].map(
        (element) => {
          const style = element ? getComputedStyle(element) : undefined;
          return [element?.getBoundingClientRect().width, style?.borderBottomWidth];
        },
      );
      const cells = [...(root?.querySelectorAll('.cell') ?? [])].map(
        (element) => getComputedStyle(element).borderBottomWidth,
      );
      const result = { room: viewport?.clientWidth, lines, cells };
      holder.remove();
      return result;
    });
    // A column or two, in a table that is a good deal wider: the header and the five rows are as wide
    // as the table, each with its line, and no cell has a line of its own.
    expect(found.room).toBeGreaterThan(500);
    expect(found.lines).toHaveLength(6);
    for (const [width, line] of found.lines) {
      expect(width).toBe(found.room);
      expect(line).toBe('1px');
    }
    expect(new Set(found.cells)).toEqual(new Set(['0px']));
  });

  test.describe('its keyboard', () => {
    /** Where the keyboard is, and where that is in the table, from the cell the table names. */
    interface Where {
      readonly text: string;
      readonly row: number;
      readonly column: number;
      readonly wholeInView: boolean;
      readonly clearOfRowNumbers: boolean;
    }

    const where = (viewport: Locator): Promise<Where | null> =>
      viewport.evaluate((element) => {
        const id = element.getAttribute('aria-activedescendant');
        const cell = id === null ? null : element.querySelector(`#${id}`);
        if (cell === null) {
          return null;
        }
        const box = cell.getBoundingClientRect();
        const view = element.getBoundingClientRect();
        const header = element.querySelector('.header')?.getBoundingClientRect().height ?? 0;
        const stuck =
          element.querySelector('.rows [role="rowheader"]')?.getBoundingClientRect().width ?? 0;
        return {
          text: cell.textContent,
          row: Number(cell.parentElement?.getAttribute('aria-rowindex')) - 2,
          column: Number(cell.getAttribute('aria-colindex')) - 2,
          wholeInView:
            box.top >= view.top + header - 0.5 &&
            box.bottom <= view.top + element.clientHeight + 0.5,
          clearOfRowNumbers:
            box.left >= view.left + stuck - 0.5 &&
            box.right <= view.left + element.clientWidth + 0.5,
        };
      });

    /** Puts the keyboard on the table, as a person does who tabs to it. */
    async function focusTable(page: Page, p: ReturnType<typeof parts>): Promise<void> {
      await expect(p.rows.first()).toBeVisible();
      await page.keyboard.press('Shift');
      await p.viewport.focus();
    }

    test('is on the first cell when the table is entered, which says so, in a ring of its own', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      await expect(p.viewport).toHaveAttribute('aria-activedescendant', 'cell-0-0');
      expect(await where(p.viewport)).toMatchObject({ text: '1', row: 0, column: 0 });
      const ring = await p.demo.locator('.cell.active').evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.outlineStyle, style.outlineWidth];
      });
      expect(ring).toEqual(['solid', '2px']);
      // Only the one cell has it.
      await expect(p.demo.locator('.cell.active')).toHaveCount(1);
    });

    test('moves a cell with the arrow keys, and stops at the edges', async ({ page }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await where(p.viewport)).toMatchObject({ row: 1, column: 2, text: 'Feature 2' });
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowLeft');
      expect(await where(p.viewport)).toMatchObject({ row: 0, column: 1 });
      // At the first row and the first column there is nowhere to go.
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      expect(await where(p.viewport)).toMatchObject({ row: 0, column: 0 });
    });

    test('scrolls as far as shows the cell, and no further, going down and up', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      const before = await p.viewport.evaluate((element) => element.scrollTop);
      // A few rows are in view: the first moves leave the table where it is.
      for (let step = 0; step < 4; step += 1) {
        await page.keyboard.press('ArrowDown');
      }
      expect(await p.viewport.evaluate((element) => element.scrollTop)).toBe(before);
      for (let step = 0; step < 30; step += 1) {
        await page.keyboard.press('ArrowDown');
        const at = await where(p.viewport);
        expect(at?.wholeInView, `row ${String(at?.row)}`).toBe(true);
      }
      expect(await where(p.viewport)).toMatchObject({ row: 34, text: '35' });
      expect(await p.viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      for (let step = 0; step < 34; step += 1) {
        await page.keyboard.press('ArrowUp');
        expect((await where(p.viewport))?.wholeInView).toBe(true);
      }
      // Back at the top, the table is too.
      expect(await p.viewport.evaluate((element) => element.scrollTop)).toBe(0);
    });

    test('moves a page with Page Down and Page Up, and the rows with it', async ({ page }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      const rowsPerPage = await p.viewport.evaluate((element) =>
        Math.floor((element.clientHeight - 32) / 28),
      );
      expect(rowsPerPage).toBeGreaterThanOrEqual(8);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('PageDown');
      expect(await where(p.viewport)).toMatchObject({ row: 1 + rowsPerPage, wholeInView: true });
      const topAfter = await p.viewport.evaluate((element) => element.scrollTop);
      // The rows moved by a page: what was at the top is a page further on, not just far enough to show it.
      expect(topAfter).toBe(rowsPerPage * 28);
      await page.keyboard.press('PageDown');
      await page.keyboard.press('PageDown');
      expect(await where(p.viewport)).toMatchObject({
        row: 1 + 3 * rowsPerPage,
        wholeInView: true,
      });
      await page.keyboard.press('PageUp');
      expect(await where(p.viewport)).toMatchObject({
        row: 1 + 2 * rowsPerPage,
        wholeInView: true,
      });
      for (let step = 0; step < 5; step += 1) {
        await page.keyboard.press('PageUp');
      }
      expect(await where(p.viewport)).toMatchObject({ row: 0, wholeInView: true });
      expect(await p.viewport.evaluate((element) => element.scrollTop)).toBe(0);
    });

    test('goes to the first and last column with Home and End, and to the first and last cell with Control', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('End');
      expect(await where(p.viewport)).toMatchObject({
        row: 2,
        column: 5,
        text: 'r3c6',
        wholeInView: true,
        clearOfRowNumbers: true,
      });
      expect(await p.viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
      await page.keyboard.press('Home');
      expect(await where(p.viewport)).toMatchObject({
        row: 2,
        column: 0,
        text: '3',
        clearOfRowNumbers: true,
      });
      expect(await p.viewport.evaluate((element) => element.scrollLeft)).toBe(0);
      await page.keyboard.press('Control+End');
      expect(await where(p.viewport)).toMatchObject({
        row: 99_999,
        column: 5,
        text: 'r100000c6',
        wholeInView: true,
        clearOfRowNumbers: true,
      });
      await page.keyboard.press('Control+Home');
      expect(await where(p.viewport)).toMatchObject({
        row: 0,
        column: 0,
        text: '1',
        wholeInView: true,
      });
      expect(
        await p.viewport.evaluate((element) => [element.scrollTop, element.scrollLeft]),
      ).toEqual([0, 0]);
    });

    test('keeps the cell clear of the row numbers when a column to its left has to be shown', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      await page.keyboard.press('End');
      for (let step = 0; step < 5; step += 1) {
        await page.keyboard.press('ArrowLeft');
        const at = await where(p.viewport);
        expect(at?.clearOfRowNumbers, `column ${String(at?.column)}`).toBe(true);
      }
      expect((await where(p.viewport))?.column).toBe(0);
    });

    test('does not scroll the page, and leaves the keys that are not its own alone', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      const scrolled = await page.evaluate(() => window.scrollY);
      for (const key of ['PageDown', 'End', 'ArrowDown', 'Control+End']) {
        await page.keyboard.press(key);
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
      await page.keyboard.press('Control+Home');
      // A key with Alt is the browser's (back, forward), and a letter is nothing to a table.
      await page.keyboard.press('Alt+ArrowDown');
      await page.keyboard.press('a');
      await page.keyboard.press('Escape');
      expect(await where(p.viewport)).toMatchObject({ row: 0, column: 0 });
    });

    test('puts the keyboard on the cell that is clicked, which shows no ring until a key is pressed', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await expect(p.rows.first()).toBeVisible();
      await p.rows.nth(3).locator('[role="gridcell"]').nth(2).click();
      await expect(p.viewport).toHaveAttribute('aria-activedescendant', 'cell-3-2');
      expect(await where(p.viewport)).toMatchObject({ text: 'Feature 4' });
      await page.keyboard.press('ArrowDown');
      expect(await where(p.viewport)).toMatchObject({ row: 4, column: 2, text: 'Feature 5' });
    });

    test('names no cell that is not there: not one that was scrolled away from, and not before the rows are in', async ({
      page,
    }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      await expect(p.viewport).toHaveAttribute('aria-activedescendant', 'cell-0-0');
      await p.viewport.evaluate((element) => {
        element.scrollTo(0, 28 * 50_000);
      });
      await expect.poll(async () => (await drawn(p.numbers)).includes(50_001)).toBe(true);
      await expect(p.viewport).not.toHaveAttribute('aria-activedescendant', /.*/);
      // The keyboard is still on the cell it was on, and scrolling back finds it.
      await p.viewport.evaluate((element) => {
        element.scrollTo(0, 0);
      });
      await expect(p.viewport).toHaveAttribute('aria-activedescendant', 'cell-0-0');
    });

    test('starts again at the first cell when it is given other rows', async ({ page }) => {
      const p = parts(page, 'table-many');
      await focusTable(page, p);
      await page.keyboard.press('Control+End');
      expect(await where(p.viewport)).toMatchObject({ row: 99_999 });
      await p.host.evaluate((element) => {
        (element as unknown as { rowCount: number }).rowCount = 50;
      });
      await expect(p.viewport).toHaveAttribute('aria-activedescendant', 'cell-0-0');
    });

    test('reaches the last row of two million, and each row on the way back, whole in view', async ({
      page,
    }) => {
      const p = parts(page, 'table-huge');
      await focusTable(page, p);
      await page.keyboard.press('Control+End');
      expect(await where(p.viewport)).toMatchObject({
        row: 1_999_999,
        text: 'r2000000c6',
        wholeInView: true,
      });
      for (let step = 1; step <= 40; step += 1) {
        await page.keyboard.press('ArrowUp');
        expect(await where(p.viewport), `step ${String(step)}`).toMatchObject({
          row: 1_999_999 - step,
          wholeInView: true,
        });
      }
      await page.keyboard.press('Control+Home');
      expect(await where(p.viewport)).toMatchObject({ row: 0, wholeInView: true });
    });

    test('stays on its cell when the browser does not scroll to exactly what it is asked', async ({
      page,
    }) => {
      // A browser that holds a scroll position only to a multiple of 8 pixels, a good deal coarser than
      // Chromium's every other pixel in a box taller than 8.4 million, asked for places it cannot be at.
      await page.evaluate(async () => {
        const holder = document.createElement('div');
        holder.id = 'rounding';
        holder.style.cssText = 'height: 300px; width: 400px;';
        const table = document.createElement('k-table') as HTMLElement & {
          rowCount: number;
          fetch: (start: number, count: number) => Promise<unknown>;
        };
        table.rowCount = 50_000_000;
        table.fetch = (start, count) =>
          Promise.resolve({
            start,
            count,
            columns: [
              {
                name: 'n',
                values: Int32Array.from({ length: count }, (_, index) => start + index + 1),
                nulls: new Uint8Array(count),
              },
            ],
          });
        holder.append(table);
        document.body.append(holder);
        // The scroll area is there once the table has drawn itself for the first time.
        await (table as unknown as { updateComplete: Promise<boolean> }).updateComplete;
        const viewport = table.shadowRoot?.querySelector('.viewport');
        if (viewport) {
          Object.defineProperty(viewport, 'scrollTop', {
            configurable: true,
            get() {
              const value: unknown = Reflect.get(Element.prototype, 'scrollTop', viewport);
              return typeof value === 'number' ? value : 0;
            },
            set(value: number) {
              Reflect.set(Element.prototype, 'scrollTop', Math.round(value / 8) * 8, viewport);
            },
          });
        }
      });
      const viewport = page.locator('#rounding .viewport');
      await expect(viewport.locator('.rows [role="row"]').first()).toBeVisible();
      await page.keyboard.press('Shift');
      await viewport.focus();
      const perPage = await viewport.evaluate((element) =>
        Math.floor((element.clientHeight - 32) / 28),
      );
      await page.keyboard.press('Control+End');
      for (let step = 1; step <= 30; step += 1) {
        await page.keyboard.press('PageUp');
        expect(await where(viewport), `page ${String(step)}`).toMatchObject({
          row: 49_999_999 - step * perPage,
          wholeInView: true,
        });
      }
    });

    test('reaches every row of fifty million, though a pixel of the scroll bar is six rows and more', async ({
      page,
    }) => {
      await page.evaluate(() => {
        const holder = document.createElement('div');
        holder.id = 'giant';
        holder.style.cssText = 'height: 300px; width: 400px;';
        const table = document.createElement('k-table') as HTMLElement & {
          rowCount: number;
          fetch: (start: number, count: number) => Promise<unknown>;
        };
        table.rowCount = 50_000_000;
        table.fetch = (start, count) =>
          Promise.resolve({
            start,
            count,
            columns: [
              {
                name: 'n',
                values: Int32Array.from({ length: count }, (_, index) => start + index + 1),
                nulls: new Uint8Array(count),
              },
            ],
          });
        holder.append(table);
        document.body.append(holder);
      });
      const viewport = page.locator('#giant .viewport');
      await expect(viewport.locator('.rows [role="row"]').first()).toBeVisible();
      await page.keyboard.press('Shift');
      await viewport.focus();
      const perPage = await viewport.evaluate((element) =>
        Math.floor((element.clientHeight - 32) / 28),
      );
      await page.keyboard.press('Control+End');
      expect(await where(viewport)).toMatchObject({
        row: 49_999_999,
        text: '50000000',
        wholeInView: true,
      });
      // A page at a time, from the end: each is where it is counted to be, and in view.
      for (let step = 1; step <= 25; step += 1) {
        await page.keyboard.press('PageUp');
        expect(await where(viewport), `page ${String(step)}`).toMatchObject({
          row: 49_999_999 - step * perPage,
          wholeInView: true,
        });
      }
      // Rows drawn past the foot of the table, near its end, are cut off: they do not make the box taller.
      expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(32 + 8_000_000);
      // And a row at a time, which the scroll bar could never be set to: each is one further.
      let row = 49_999_999 - 25 * perPage;
      for (let step = 0; step < 25; step += 1) {
        await page.keyboard.press('ArrowDown');
        row += 1;
        const at = await where(viewport);
        expect(at, `row ${String(row)}`).toMatchObject({
          row,
          text: String(row + 1),
          wholeInView: true,
        });
      }
      // A person's own scroll takes over from where the scroll bar is, and not from what the keys took
      // up: a pixel of it, after the keys, puts the top exactly where the scroll bar's sum says,
      // whatever the keys had added. They add up to half a pixel of the scroll bar, which is 87 pixels
      // of rows (a pixel is 175), so that over a dozen places some of them add a good deal.
      for (let presses = 1; presses <= 12; presses += 1) {
        await viewport.focus();
        await page.keyboard.press('Control+End');
        for (let press = 0; press < presses; press += 1) {
          await page.keyboard.press('PageUp');
        }
        const expected = await viewport.evaluate((element) => {
          const body = element.clientHeight - 32;
          const ratio = (50_000_000 * 28 - body) / (element.scrollHeight - 32 - body);
          element.scrollTo(0, element.scrollTop + 1);
          // Where the browser took it, which is the place that counts.
          return Math.floor((element.scrollTop * ratio) / 28) + 1;
        });
        await expect
          .poll(
            async () =>
              viewport.evaluate((element) => {
                const top = element.getBoundingClientRect().top + 32;
                const first = [...element.querySelectorAll('.rows [role="rowheader"]')].find(
                  (cell) => {
                    const box = cell.getBoundingClientRect();
                    return box.top <= top + 0.5 && box.bottom > top + 0.5;
                  },
                );
                return Number(first?.textContent);
              }),
            { message: `after ${String(presses)} pages up` },
          )
          .toBe(expected);
      }
    });
  });

  test.describe('its pages', () => {
    /** What a table made in the page, and the source it is given, let the test do and see. */
    interface Probe {
      /** The starts of the pages that were asked for, in order. */
      calls: number[];
      /** The pages (from 0) that fail when asked for. */
      failing: Set<number>;
      /** Whether the source throws at once, without a promise. */
      throws: boolean;
      table: HTMLElement;
      holder: HTMLElement;
    }

    /**
     * Makes a table of `rowCount` rows, in a box 300 high, with a source the test can break. The
     * pages in `failing` (from 0) fail from the start: the table asks for pages as soon as it is made.
     */
    async function mount(page: Page, rowCount: number, failing: number[] = []): Promise<void> {
      await page.evaluate(
        ({ count, broken }) => {
          const holder = document.createElement('div');
          holder.id = 'probe';
          holder.style.cssText = 'height: 300px; width: 400px; position: relative;';
          const table = document.createElement('k-table') as HTMLElement & {
            rowCount: number;
            fetch: (start: number, count: number) => unknown;
          };
          const probe: Probe = {
            calls: [],
            failing: new Set(broken),
            throws: false,
            table,
            holder,
          };
          (window as unknown as { probe: Probe }).probe = probe;
          table.rowCount = count;
          table.fetch = (start, size) => {
            probe.calls.push(start);
            if (probe.throws) {
              throw new Error('The source threw.');
            }
            if (probe.failing.has(start / 256)) {
              return Promise.reject(new Error('The page failed.'));
            }
            return Promise.resolve({
              start,
              count: size,
              columns: [
                {
                  name: 'n',
                  values: Int32Array.from({ length: size }, (_, index) => start + index + 1),
                  nulls: new Uint8Array(size),
                },
              ],
            });
          };
          holder.append(table);
          document.body.append(holder);
        },
        { count: rowCount, broken: failing },
      );
    }

    const probeOf = (page: Page) => ({
      calls: () => page.evaluate(() => (window as unknown as { probe: Probe }).probe.calls.slice()),
      fail: (...pages: number[]) =>
        page.evaluate((list) => {
          const { failing } = (window as unknown as { probe: Probe }).probe;
          failing.clear();
          list.forEach((item) => failing.add(item));
        }, pages),
      scrollToRow: (row: number) =>
        page.evaluate((target) => {
          (window as unknown as { probe: Probe }).probe.table.shadowRoot
            ?.querySelector('.viewport')
            ?.scrollTo(0, target * 28);
        }, row),
      // A moment, for what was asked for to come, and to be drawn.
      settle: () => page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 80))),
      problem: () =>
        page.evaluate(() => {
          const root = (window as unknown as { probe: Probe }).probe.table.shadowRoot;
          const bar = root?.querySelector('.problem');
          return bar === null || bar === undefined
            ? null
            : {
                role: bar.getAttribute('role'),
                text: (bar.querySelector('.message')?.textContent ?? '').trim(),
                alone: bar.classList.contains('alone'),
                button: (bar.querySelector('k-button')?.textContent ?? '').trim(),
              };
        }),
      retry: () => page.locator('#probe .problem k-button button').click(),
      texts: () =>
        page.evaluate(() => {
          const root = (window as unknown as { probe: Probe }).probe.table.shadowRoot;
          return [...(root?.querySelectorAll('.rows [role="rowheader"]') ?? [])].map(
            (cell) => cell.textContent,
          );
        }),
      cells: () =>
        page.evaluate(() => {
          const root = (window as unknown as { probe: Probe }).probe.table.shadowRoot;
          return [...(root?.querySelectorAll('.rows [role="gridcell"]') ?? [])].map(
            (cell) => cell.textContent,
          );
        }),
      focusIsOnViewport: () =>
        page.evaluate(() => {
          const root = (window as unknown as { probe: Probe }).probe.table.shadowRoot;
          return root?.activeElement?.classList.contains('viewport') === true;
        }),
    });

    test('lets go of the pages that are far from view, and asks again if one is needed', async ({
      page,
    }) => {
      await mount(page, 25_600);
      const probe = probeOf(page);
      await probe.settle();
      // Down through forty pages, a page at a time.
      for (let step = 1; step <= 40; step += 1) {
        await probe.scrollToRow(step * 256);
        await probe.settle();
      }
      const before = await probe.calls();
      expect(before.filter((start) => start === 3 * 256)).toHaveLength(1);
      // Back where it was long ago: the page has been let go of, and is asked for again.
      await probe.scrollToRow(3 * 256 + 5);
      await probe.settle();
      const after = await probe.calls();
      expect(after.filter((start) => start === 3 * 256)).toHaveLength(2);
      expect((await probe.cells()).length).toBeGreaterThan(5);
      // The page it is on, and its neighbours, are not asked for again when it moves a little.
      const asked = after.length;
      await probe.scrollToRow(3 * 256 + 40);
      await probe.settle();
      expect(await probe.calls()).toHaveLength(asked);
    });

    test('says nothing of a page that failed and is not in view, which is only one that was asked for ahead', async ({
      page,
    }) => {
      await mount(page, 1000, [1]);
      const probe = probeOf(page);
      await probe.settle();
      // The page after the first is asked for, and fails; the rows in view are in the first.
      expect(await probe.calls()).toEqual([0, 256]);
      expect(await probe.problem()).toBeNull();
      expect((await probe.texts())[0]).toBe('1');
    });

    test('says so when rows in view could not be loaded, once, and not again until asked', async ({
      page,
    }) => {
      await mount(page, 1000, [1]);
      const probe = probeOf(page);
      await probe.settle();
      await probe.scrollToRow(300);
      await probe.settle();
      expect(await probe.problem()).toEqual({
        role: 'alert',
        text: 'Could not load the rows.',
        alone: false,
        button: 'Try again',
      });
      // The page is not asked for over and over: once, however the table is moved about.
      for (const row of [301, 305, 299, 310]) {
        await probe.scrollToRow(row);
        await probe.settle();
      }
      const calls = await probe.calls();
      expect(calls.filter((start) => start === 256)).toHaveLength(1);
      // The rows of the page that came are drawn, and those that did not are empty.
      expect((await probe.cells()).every((text) => text === '')).toBe(true);
      // Away from the page that failed, there is nothing to say.
      await probe.scrollToRow(600);
      await probe.settle();
      expect(await probe.problem()).toBeNull();
    });

    test('asks again when told to, and goes on from there, with the keyboard on the table', async ({
      page,
    }) => {
      await mount(page, 1000, [1]);
      const probe = probeOf(page);
      await probe.scrollToRow(300);
      await probe.settle();
      expect((await probe.problem())?.button).toBe('Try again');
      await probe.fail();
      await probe.retry();
      await expect.poll(probe.problem).toBeNull();
      await expect.poll(async () => (await probe.cells()).includes('301')).toBe(true);
      await expect.poll(probe.focusIsOnViewport).toBe(true);
      expect((await probe.calls()).filter((start) => start === 256)).toHaveLength(2);
    });

    test('says so, alone, when the first page could not be loaded, and shows the table once it can', async ({
      page,
    }) => {
      await mount(page, 1000, [0]);
      const probe = probeOf(page);
      await probe.settle();
      // Nothing is drawn but the problem, at the top.
      expect(await probe.problem()).toEqual({
        role: 'alert',
        text: 'Could not load the rows.',
        alone: true,
        button: 'Try again',
      });
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { probe: Probe }).probe.table.shadowRoot?.querySelectorAll(
              '.header',
            ).length,
        ),
      ).toBe(0);
      await probe.fail();
      await probe.retry();
      await expect.poll(probe.problem).toBeNull();
      await expect.poll(async () => (await probe.texts())[0]).toBe('1');
    });

    test('treats a source that throws, without a promise, as one that failed', async ({ page }) => {
      await mount(page, 1000);
      await page.evaluate(() => {
        const { probe } = window as unknown as { probe: Probe };
        probe.throws = true;
        // Start again, with the source throwing.
        (probe.table as unknown as { rowCount: number }).rowCount = 999;
      });
      const probe = probeOf(page);
      await probe.settle();
      expect((await probe.problem())?.alone).toBe(true);
    });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations (${theme} theme)`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}`);
      await expect(parts(page, 'table-many').rows.first()).toBeVisible();
      await expectNoSeriousViolations(page, ['karmania-gallery', '[data-section="table"]']);
    });
  }
});
