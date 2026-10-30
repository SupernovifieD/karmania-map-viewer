import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import {
  columnWidth,
  isCut,
  rowNumberWidth,
  SAMPLE_ROWS,
  scrollLeftToReveal,
} from './table-columns.js';
import { formatCell, isNull, isNumeric } from './table-format.js';
import { createMeasurer, loadFonts } from './table-measure.js';
import type { Measurer } from './table-measure.js';
import {
  maxTop,
  pageRows,
  scrollForTop,
  scrollRatio,
  topToReveal,
  windowFor,
} from './table-window.js';
import './button.js';
import './icon.js';

/** What a column of rows holds: the kinds of array the engine returns. */
export type TableValues = Float64Array | Int32Array | Uint8Array | readonly string[];

/** One column of a run of rows. */
export interface TableColumn {
  readonly name: string;
  readonly values: TableValues;
  /** A byte for each row: 1 for a null, 0 otherwise. */
  readonly nulls: Uint8Array;
}

/** A run of rows, column by column. */
export interface TableRows {
  /** The first row, counting from 0. */
  readonly start: number;
  /** How many rows came back: fewer than asked for at the end. */
  readonly count: number;
  readonly columns: readonly TableColumn[];
}

/** Gets `count` rows, from row `start` (counting from 0). */
export type TableFetch = (start: number, count: number) => Promise<TableRows>;

/** How many rows are asked for at a time. */
export const TABLE_PAGE_SIZE = 256;

/** How many rows beyond those in view are drawn at each end. */
const OVERSCAN = 4;

/**
 * How many pages are kept, the ones that are in view and the nearest to them: a table that has
 * been scrolled through a million rows does not hold them all. A page that is let go of is asked for
 * again if it is needed, and the source can have it ready.
 */
const MAX_PAGES = 16;

/** How wide a column of values is, and the row numbers' digits, when there is no way to measure. */
const UNMEASURED_COLUMN_WIDTH = 120;
const UNMEASURED_DIGIT_WIDTH = 8;

/** The `id` of a cell, which the table names as the one the keyboard is on. */
function cellId(row: number, column: number): string {
  return `cell-${String(row)}-${String(column)}`;
}

/** How wide the columns are, once they have been measured. */
interface ColumnLayout {
  /** The column of row numbers. */
  readonly rowNumber: number;
  /** Each column of values. */
  readonly widths: readonly number[];
}

/** The size a token gives, in pixels, or `fallback` if the page has no such token. */
function tokenPixels(element: Element, name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * A table of as many rows as there are, however many that is: a header over the rows, and the row
 * numbers down the left, both of which stay in view as the rest is scrolled, in either direction,
 * inside the table.
 *
 * ```html
 * <k-table label="Points" .rowCount=${1_000_000} .fetch=${fetchRows}></k-table>
 * ```
 *
 * It knows nothing of where its rows come from. It is given how many there are and a function that
 * gets some, and it asks for them in pages of 256 as they come into view, with the page on either
 * side so that it is there when the table is scrolled on. Only the rows in view, and a few beyond,
 * are in the page at any time, and only 16 pages are kept: the others are let go of, and asked for
 * again if they are needed. The table is as tall as the room it is given.
 *
 * Up to about 285,000 rows the scroll bar is for the rows as they are, and the browser scrolls them.
 * Past that a browser cannot make a box tall enough, and the scroll bar is for all the rows drawn
 * smaller: a pixel of it is several pixels of rows, which is less than a row up to about eight
 * million, so every row can still be scrolled to. Past eight million rows a pixel is more than a row,
 * and the scroll bar can no longer stop at each.
 *
 * The table is one stop for the keyboard, and has a cell that the keyboard is on, which it names to
 * assistive technology (`aria-activedescendant`) and rings. The arrow keys move it a cell, Page Up and
 * Page Down a page, Home and End to the first and last column, and with Control to the first and last
 * row as well. A click on a cell puts it there. The table scrolls as far as shows the cell, and no
 * further. Past eight million rows the scroll bar cannot stop at every row, and the keyboard takes up
 * what its whole pixels leave out, so that it still reaches each.
 *
 * A page that cannot be fetched is not asked for again until a person says to: when rows in view
 * are in it, the table says so, and offers to try again. A page that nothing in view needs is
 * left alone, and says nothing.
 *
 * The first page also gives the names of the columns, and the first 200 rows of it are measured to
 * see how wide each column has to be, between 72 and 320 pixels. Nothing is drawn until that is
 * done, so that nothing moves afterwards. Words that do not fit end in an ellipsis, and are in the
 * cell's `title` in full. The columns that do not fit in the room are scrolled to sideways, in the
 * table.
 */
export class KTable extends LitElement {
  static override properties = {
    rowCount: { type: Number },
    fetch: { attribute: false },
    label: { type: String },
    columns: { state: true },
    layout: { state: true },
    scrolled: { state: true },
    fine: { state: true },
    activeRow: { state: true },
    activeColumn: { state: true },
    bodyHeight: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      /* As tall as the room it is in. The scroll area fills it without being part of its size,
         so that all the rows together, which can be taller than anything, never are. */
      :host {
        display: block;
        font-size: var(--k-font-size-secondary);
        height: 100%;
        line-height: var(--k-line-height-secondary);
        min-height: 0;
        min-width: 0;
        position: relative;
      }

      .viewport {
        inset: 0;
        /* The rows are put where the table says. The browser is not to move the scroll bar to keep
           what it was looking at where it was, which is what it would do when the rows are moved. */
        overflow-anchor: none;
        overflow: auto;
        /* The end of the rows is not a reason for the panel round the table to start scrolling. */
        overscroll-behavior: contain;
        position: absolute;
      }

      /* What could not be loaded, over the foot of the rows, so that it moving them is not one more
         thing that changes; or at the top, where there are no rows. */
      .problem {
        align-items: center;
        background: var(--k-surface-raised);
        border-top: var(--k-border-width) solid var(--k-border);
        bottom: 0;
        display: flex;
        gap: var(--k-space-8);
        left: 0;
        padding: var(--k-space-8) var(--k-space-16);
        position: absolute;
        right: 0;
        z-index: calc(var(--k-z-sticky) + 1);
      }

      .problem.alone {
        border-bottom: var(--k-border-width) solid var(--k-border);
        border-top: none;
        bottom: auto;
        top: 0;
      }

      .problem .message {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* The scroll bar is for all the rows, and the columns are as wide as they are, but never
         narrower than the room, so that the lines run to its edge. */
      .sizer {
        /* Rows are drawn past its foot when the table is near the end, and are not to make it taller:
           the scroll bar goes by its height. Clipped, not hidden, so that it does not scroll itself,
           and the header and the row numbers still stick to the table. */
        min-width: 100%;
        overflow: clip;
        position: relative;
        width: max-content;
      }

      /* A run of columns: the row numbers, then each column of values. */
      .header,
      .row {
        display: grid;
        grid-template-columns: var(--columns);
      }

      /* The line under a row, and under the header, is the row's own, so that it runs to the edge of
         the table when the columns do not (a dataset of two, in a panel that is wide). */
      .header {
        background: var(--k-surface-raised);
        border-bottom: var(--k-border-width) solid var(--k-border);
        height: var(--k-table-header-height);
        position: sticky;
        top: 0;
        z-index: var(--k-z-sticky);
      }

      /* The rows in the page, laid out where they would be if all the rows were, so that the
         browser scrolls them. */
      .rows {
        left: 0;
        position: absolute;
        right: 0;
      }

      .row {
        border-bottom: var(--k-border-width) solid var(--k-border);
        height: var(--k-table-row-height);
      }

      /* The line is as tall as the cell, which sets the words on its middle. */
      .cell {
        line-height: calc(var(--k-table-row-height) - var(--k-border-width));
        min-width: 0;
        overflow: hidden;
        padding: 0 var(--k-space-8);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cell.numeric {
        text-align: right;
      }

      /* A null is not a value, and is told apart by its colour, not by slanting it. */
      .cell.null {
        color: var(--k-text-muted);
      }

      .head {
        font-weight: var(--k-weight-medium);
        line-height: calc(var(--k-table-header-height) - var(--k-border-width));
      }

      /* The row numbers stay at the left as the values go by under them. */
      .cell.number {
        background: var(--k-surface);
        border-right: var(--k-border-width) solid var(--k-border);
        color: var(--k-text-muted);
        left: 0;
        position: sticky;
        text-align: right;
        z-index: 1;
      }

      .head.number {
        background: var(--k-surface-raised);
      }

      /* The scroll area is a control, and has the keyboard: its ring is drawn inside, and the cell the
         keyboard is on has one of its own, which is what says where it is. */
      .viewport:focus-visible {
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      /* While that cell is in view, its ring is the one: the table's own would be half hidden by the
         header and the row numbers. When it is not (the table has been scrolled away from it), the
         table's is. */
      .viewport[data-active-cell]:focus-visible {
        outline: none;
      }

      .viewport:focus-visible .cell.active {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: calc(var(--k-focus-width) * -1);
      }
    `,
  ];

  /** How many rows the table has. */
  declare rowCount: number;
  /** Gets rows. When it is replaced the table starts again, at the first row. */
  declare fetch: TableFetch | undefined;
  /** What the table is called, for people who cannot see it. */
  declare label: string;
  /** The names of the columns, once the first page is in. */
  declare private columns: readonly TableColumn[];
  /** How wide the columns are, once they have been measured. */
  declare private layout: ColumnLayout | undefined;
  /** How far the rows have been scrolled. */
  declare private scrolled: number;
  /** Pixels of rows that the keyboard has added to what the scroll bar says, which are not whole pixels of it. */
  declare private fine: number;
  /** The row the keyboard is on, counting from 0, and the column of values (not the row numbers). */
  declare private activeRow: number;
  declare private activeColumn: number;
  /** How high the room for rows is: the table's height less its header. */
  declare private bodyHeight: number;

  /** The pages that have arrived, by number. */
  private readonly pages = new Map<number, TableRows>();
  /** The pages that have been asked for and not yet arrived, or have arrived. */
  private readonly asked = new Set<number>();
  /** Counts the times the table has started again, so that a late answer to an earlier ask is known. */
  private generation = 0;
  private startedAgain = false;
  /** The pages that could not be fetched, which are not asked for again until a person says so. */
  private readonly failedPages = new Set<number>();
  /** Whether the columns have been laid out, or are being, so that the first page is not used twice. */
  private layoutStarted = false;
  /** Whether a person asked to try again, and the keyboard has to be found a place when that is done. */
  private retrying = false;
  /** Measures words as the table sets them, once the columns have been laid out. */
  private measurer: Measurer | undefined;
  private rowHeight = 28;
  private headerHeight = 32;
  private observer: ResizeObserver | undefined;

  constructor() {
    super();
    this.rowCount = 0;
    this.fetch = undefined;
    this.label = 'Table';
    this.columns = [];
    this.layout = undefined;
    this.scrolled = 0;
    this.fine = 0;
    this.activeRow = 0;
    this.activeColumn = 0;
    this.bodyHeight = 0;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.rowHeight = tokenPixels(this, '--k-table-row-height', this.rowHeight);
    this.headerHeight = tokenPixels(this, '--k-table-header-height', this.headerHeight);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private get viewport(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.viewport');
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('rowCount') || changed.has('fetch')) {
      this.generation += 1;
      this.pages.clear();
      this.asked.clear();
      this.failedPages.clear();
      this.layoutStarted = false;
      this.retrying = false;
      this.columns = [];
      this.layout = undefined;
      this.measurer = undefined;
      this.scrolled = 0;
      this.fine = 0;
      this.activeRow = 0;
      this.activeColumn = 0;
      this.startedAgain = true;
    }
  }

  protected override firstUpdated(): void {
    const viewport = this.viewport;
    if (viewport === null) {
      return;
    }
    const measure = (): void => {
      this.bodyHeight = Math.max(0, viewport.clientHeight - this.headerHeight);
    };
    measure();
    this.observer = new ResizeObserver(measure);
    this.observer.observe(viewport);
  }

  protected override updated(): void {
    if (this.startedAgain) {
      this.startedAgain = false;
      const viewport = this.viewport;
      if (viewport !== null) {
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
      }
    }
    this.askForPages();
    this.forgetFarPages();
    if (this.retrying && !this.hasProblem()) {
      this.retrying = false;
      this.viewport?.focus();
    }
  }

  private readonly onScroll = (event: Event): void => {
    const top = (event.currentTarget as HTMLElement).scrollTop;
    // The keyboard's own scroll is where `scrolled` says already, and keeps what it took up that the
    // scroll bar could not. Any other is a person's, and starts from the scroll bar.
    if (Math.abs(top - this.scrolled) >= 1) {
      this.fine = 0;
    }
    this.scrolled = top;
  };

  /** Puts the keyboard on a cell, and scrolls as far as shows it, which is not at all if it is in view. */
  private moveTo(row: number, column: number, pages: number): void {
    const viewport = this.viewport;
    const layout = this.layout;
    if (viewport === null || layout === undefined) {
      return;
    }
    const sizes = {
      rowCount: this.rowCount,
      rowHeight: this.rowHeight,
      viewportHeight: this.bodyHeight,
    };
    // A page up or down moves the rows by a page, and the keyboard with them.
    const shifted =
      this.currentWindow().top + pages * pageRows(this.bodyHeight, this.rowHeight) * this.rowHeight;
    const { scrollTop, fine } = scrollForTop(
      sizes,
      topToReveal(sizes, Math.min(Math.max(0, shifted), maxTop(sizes)), row),
    );
    this.activeRow = row;
    this.activeColumn = column;
    viewport.scrollTop = scrollTop;
    // A browser does not always scroll to exactly what it is asked, a long way down: the table goes
    // by where it did scroll to, and what is left over is for `fine`, so that the keyboard's row is
    // where it was meant to be whatever the browser did.
    const actual = viewport.scrollTop;
    this.scrolled = actual;
    this.fine = fine + (scrollTop - actual) * scrollRatio(sizes);
    const left = layout.widths
      .slice(0, column)
      .reduce((sum, width) => sum + width, layout.rowNumber);
    viewport.scrollLeft = scrollLeftToReveal(
      { left, width: layout.widths[column] ?? 0 },
      viewport.scrollLeft,
      viewport.clientWidth,
      layout.rowNumber,
    );
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey || event.metaKey || this.layout === undefined || this.rowCount === 0) {
      return;
    }
    const lastRow = this.rowCount - 1;
    const lastColumn = this.columns.length - 1;
    const page = pageRows(this.bodyHeight, this.rowHeight);
    let row = this.activeRow;
    let column = this.activeColumn;
    let pages = 0;
    switch (event.key) {
      case 'ArrowDown':
        row += 1;
        break;
      case 'ArrowUp':
        row -= 1;
        break;
      case 'ArrowRight':
        column += 1;
        break;
      case 'ArrowLeft':
        column -= 1;
        break;
      case 'PageDown':
        row += page;
        pages = 1;
        break;
      case 'PageUp':
        row -= page;
        pages = -1;
        break;
      case 'Home':
        column = 0;
        row = event.ctrlKey ? 0 : row;
        break;
      case 'End':
        column = lastColumn;
        row = event.ctrlKey ? lastRow : row;
        break;
      default:
        return;
    }
    // The keys that move the keyboard do not also scroll the page.
    event.preventDefault();
    this.moveTo(
      Math.min(Math.max(0, row), lastRow),
      Math.min(Math.max(0, column), lastColumn),
      pages,
    );
  };

  /** A click on a cell puts the keyboard there. */
  private readonly onClick = (event: MouseEvent): void => {
    const cell = event.target instanceof Element ? event.target.closest('[role="gridcell"]') : null;
    const row = Number(cell?.parentElement?.getAttribute('aria-rowindex'));
    const column = Number(cell?.getAttribute('aria-colindex'));
    if (cell !== null && Number.isInteger(row) && Number.isInteger(column)) {
      this.moveTo(row - 2, column - 2, 0);
    }
  };

  /** The rows that are drawn now. */
  private currentWindow() {
    return windowFor({
      rowCount: this.rowCount,
      rowHeight: this.rowHeight,
      viewportHeight: this.bodyHeight,
      scrollTop: this.scrolled,
      fine: this.fine,
      overscan: OVERSCAN,
    });
  }

  /** The numbers of the first and the last page that the rows drawn are in. */
  private pagesInView(): { first: number; last: number } {
    const { firstRow, endRow } = this.currentWindow();
    return {
      first: Math.floor(firstRow / TABLE_PAGE_SIZE),
      last: Math.floor(Math.max(firstRow, endRow - 1) / TABLE_PAGE_SIZE),
    };
  }

  /**
   * Asks for the pages that the rows drawn are in, and the first, which has the names of the
   * columns. The page on either side is asked for as well, so that it is there when the table is
   * scrolled on, and the rows are not empty for a moment.
   */
  private askForPages(): void {
    if (this.fetch === undefined || this.rowCount === 0) {
      return;
    }
    const { first, last } = this.pagesInView();
    this.ask(0);
    for (let page = first; page <= last; page += 1) {
      this.ask(page);
    }
    this.ask(last + 1);
    this.ask(first - 1);
  }

  private ask(page: number): void {
    const fetch = this.fetch;
    if (fetch === undefined || page < 0 || this.asked.has(page) || this.failedPages.has(page)) {
      return;
    }
    const start = page * TABLE_PAGE_SIZE;
    if (start >= this.rowCount) {
      return;
    }
    this.asked.add(page);
    const generation = this.generation;
    // A source that fails at once, without a promise, is a source that failed.
    new Promise<TableRows>((resolve) => {
      resolve(fetch(start, Math.min(TABLE_PAGE_SIZE, this.rowCount - start)));
    }).then(
      (rows) => {
        if (generation !== this.generation) {
          return;
        }
        this.pages.set(page, rows);
        if (page === 0 && !this.layoutStarted) {
          this.layoutStarted = true;
          void this.layOut(rows, generation);
        }
        this.requestUpdate();
      },
      () => {
        if (generation === this.generation) {
          this.asked.delete(page);
          this.failedPages.add(page);
          this.requestUpdate();
        }
      },
    );
  }

  /** Lets go of the pages furthest from those in view, when there are more than are kept. */
  private forgetFarPages(): void {
    if (this.pages.size <= MAX_PAGES) {
      return;
    }
    const { first, last } = this.pagesInView();
    const centre = (first + last) / 2;
    const far = [...this.pages.keys()]
      .filter((page) => page < first - 1 || page > last + 1)
      .sort((a, b) => Math.abs(b - centre) - Math.abs(a - centre))
      .slice(0, this.pages.size - MAX_PAGES);
    for (const page of far) {
      this.pages.delete(page);
      this.asked.delete(page);
    }
  }

  /**
   * Whether rows that are in view could not be fetched: the first page, if nothing can be drawn
   * without it, or a page that some of the rows drawn are in.
   */
  private hasProblem(): boolean {
    if (this.failedPages.size === 0) {
      return false;
    }
    if (this.layout === undefined) {
      return this.failedPages.has(0);
    }
    const { first, last } = this.pagesInView();
    return [...this.failedPages].some((page) => page >= first && page <= last);
  }

  /** Asks again for the pages that could not be fetched. */
  private readonly retry = (): void => {
    this.retrying = true;
    this.failedPages.clear();
    this.requestUpdate();
  };

  /**
   * Works out how wide each column is, from its name and the first rows of it, once the fonts the
   * words are in have arrived, and then lets the table be drawn.
   */
  private async layOut(rows: TableRows, generation: number): Promise<void> {
    const viewport = this.viewport;
    if (viewport === null) {
      return;
    }
    const heavy = tokenPixels(this, '--k-weight-medium', 500);
    const sample = rows.columns.map((column) =>
      Array.from({ length: Math.min(SAMPLE_ROWS, rows.count) }, (_, at) => formatCell(column, at)),
    );
    const letters = new Set(
      rows.columns.flatMap((column, index) => [column.name, ...(sample[index] ?? [])]).join(''),
    );
    try {
      await loadFonts(viewport, heavy, [...letters].join(''));
    } catch {
      // The words are measured in whatever font there is.
    }
    if (generation !== this.generation) {
      return;
    }
    const measurer = createMeasurer(viewport, heavy);
    this.measurer = measurer;
    const widths = rows.columns.map((column, index) => {
      if (measurer === undefined) {
        return UNMEASURED_COLUMN_WIDTH;
      }
      const words = sample[index] ?? [];
      const longest = words.reduce(
        (most, word) => Math.max(most, measurer.width(word, false)),
        measurer.width(column.name, true),
      );
      return columnWidth(longest);
    });
    this.layout = {
      rowNumber: rowNumberWidth(this.rowCount, measurer?.digitWidth ?? UNMEASURED_DIGIT_WIDTH),
      widths,
    };
    this.columns = rows.columns;
  }

  /** The words in a cell, and whether it is a null: nothing, and not, if its page has not come. */
  private cell(row: number, column: number): { text: string; isNull: boolean } {
    const rows = this.pages.get(Math.floor(row / TABLE_PAGE_SIZE));
    const values = rows?.columns[column];
    if (rows === undefined || values === undefined) {
      return { text: '', isNull: false };
    }
    const at = row - rows.start;
    return { text: formatCell(values, at), isNull: isNull(values, at) };
  }

  /** The words in full, for a cell that cuts them off, and nothing for one that does not. */
  private fullText(text: string, width: number, header: boolean): string | undefined {
    const measurer = this.measurer;
    return measurer !== undefined && isCut(measurer.width(text, header), width) ? text : undefined;
  }

  private renderRow(row: number, widths: readonly number[]) {
    return html`
      <div class="row" role="row" aria-rowindex=${row + 2}>
        <div class="cell number" role="rowheader">${row + 1}</div>
        ${this.columns.map((column, index) => {
          const cell = this.cell(row, index);
          return html`<div
            id=${cellId(row, index)}
            class=${classMap({
              cell: true,
              numeric: isNumeric(column.values),
              null: cell.isNull,
              active: row === this.activeRow && index === this.activeColumn,
            })}
            role="gridcell"
            data-truncate
            aria-colindex=${index + 2}
            title=${ifDefined(this.fullText(cell.text, widths[index] ?? 0, false))}
            .textContent=${cell.text}
          ></div>`;
        })}
      </div>
    `;
  }

  private renderTable(layout: ColumnLayout) {
    const { scrollHeight, firstRow, endRow, layerTop } = this.currentWindow();
    const columns = [layout.rowNumber, ...layout.widths]
      .map((width) => `${String(width)}px`)
      .join(' ');
    const rows = Array.from({ length: endRow - firstRow }, (_, index) => firstRow + index);
    return html`
      <div
        class="sizer"
        style="--columns: ${columns}; height: ${this.headerHeight + scrollHeight}px"
      >
        <div class="header" role="row" aria-rowindex="1">
          <div class="cell head number" role="columnheader">
            <span aria-hidden="true">#</span>
            <span class="visually-hidden">Row</span>
          </div>
          ${this.columns.map(
            (column, index) =>
              html`<div
                class="cell head ${isNumeric(column.values) ? 'numeric' : ''}"
                role="columnheader"
                data-truncate
                aria-colindex=${index + 2}
                title=${ifDefined(this.fullText(column.name, layout.widths[index] ?? 0, true))}
                .textContent=${column.name}
              ></div>`,
          )}
        </div>
        <div class="rows" style="top: ${this.headerHeight + layerTop}px">
          ${repeat(
            rows,
            (row) => row,
            (row) => this.renderRow(row, layout.widths),
          )}
        </div>
      </div>
    `;
  }

  /** Says that rows could not be loaded, and offers to try again: at the foot of the table, or alone. */
  private renderProblem(alone: boolean) {
    return html`
      <div class=${classMap({ problem: true, alone })} role="alert">
        <k-icon name="triangle-alert" size="16"></k-icon>
        <span class="message">Could not load the rows.</span>
        <k-button variant="secondary" size="28" @click=${this.retry}>Try again</k-button>
      </div>
    `;
  }

  override render() {
    const layout = this.layout;
    const { firstRow, endRow } = this.currentWindow();
    // The cell the keyboard is on is only named while it is drawn: a name must be of something there.
    const active =
      layout !== undefined && this.activeRow >= firstRow && this.activeRow < endRow
        ? cellId(this.activeRow, this.activeColumn)
        : undefined;
    return html`
      <div
        class="viewport"
        data-scroll-region
        role="grid"
        tabindex="0"
        aria-label=${this.label}
        aria-rowcount=${this.rowCount + 1}
        aria-colcount=${this.columns.length + 1}
        aria-busy=${layout === undefined ? 'true' : 'false'}
        aria-activedescendant=${ifDefined(active)}
        ?data-active-cell=${active !== undefined}
        @scroll=${this.onScroll}
        @keydown=${this.onKeyDown}
        @click=${this.onClick}
      >
        ${layout === undefined ? nothing : this.renderTable(layout)}
      </div>
      ${this.hasProblem() ? this.renderProblem(layout === undefined) : nothing}
    `;
  }
}

defineOnce('k-table', KTable);

declare global {
  interface HTMLElementTagNameMap {
    'k-table': KTable;
  }
}
