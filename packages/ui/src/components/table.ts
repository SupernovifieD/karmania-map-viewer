import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import { columnWidth, isCut, rowNumberWidth, SAMPLE_ROWS } from './table-columns.js';
import { formatCell, isNull, isNumeric } from './table-format.js';
import { createMeasurer, loadFonts } from './table-measure.js';
import type { Measurer } from './table-measure.js';
import { windowFor } from './table-window.js';

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

/** How wide a column of values is, and the row numbers' digits, when there is no way to measure. */
const UNMEASURED_COLUMN_WIDTH = 120;
const UNMEASURED_DIGIT_WIDTH = 8;

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
 * gets some, and it asks for them in pages of 256 as they come into view. Only the rows in view,
 * and a few beyond, are in the page at any time. The table is as tall as the room it is given.
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
        overflow: auto;
        position: absolute;
      }

      /* The scroll bar is for all the rows, and the columns are as wide as they are, but never
         narrower than the room, so that the lines run to its edge. */
      .sizer {
        min-width: 100%;
        position: relative;
        width: max-content;
      }

      /* A run of columns: the row numbers, then each column of values. */
      .header,
      .row {
        display: grid;
        grid-template-columns: var(--columns);
      }

      .header {
        background: var(--k-surface-raised);
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
        height: var(--k-table-row-height);
      }

      /* The line is as tall as the cell, which sets the words on its middle. */
      .cell {
        border-bottom: var(--k-border-width) solid var(--k-border);
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

      /* The scroll area is a control: the keyboard can scroll it. Its ring is drawn inside. */
      .viewport:focus-visible {
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
  /** How high the room for rows is: the table's height less its header. */
  declare private bodyHeight: number;

  /** The pages that have arrived, by number. */
  private readonly pages = new Map<number, TableRows>();
  /** The pages that have been asked for and not yet arrived, or have arrived. */
  private readonly asked = new Set<number>();
  /** Counts the times the table has started again, so that a late answer to an earlier ask is known. */
  private generation = 0;
  private startedAgain = false;
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
      this.columns = [];
      this.layout = undefined;
      this.measurer = undefined;
      this.scrolled = 0;
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
  }

  private readonly onScroll = (event: Event): void => {
    this.scrolled = (event.currentTarget as HTMLElement).scrollTop;
  };

  /** The rows that are drawn now. */
  private currentWindow() {
    return windowFor({
      rowCount: this.rowCount,
      rowHeight: this.rowHeight,
      viewportHeight: this.bodyHeight,
      scrollTop: this.scrolled,
      overscan: OVERSCAN,
    });
  }

  /** Asks for the pages that the rows drawn are in, and the first, which has the names of the columns. */
  private askForPages(): void {
    if (this.fetch === undefined || this.rowCount === 0) {
      return;
    }
    const { firstRow, endRow } = this.currentWindow();
    this.ask(0);
    for (
      let page = Math.floor(firstRow / TABLE_PAGE_SIZE);
      page * TABLE_PAGE_SIZE < endRow;
      page += 1
    ) {
      this.ask(page);
    }
  }

  private ask(page: number): void {
    const fetch = this.fetch;
    if (fetch === undefined || this.asked.has(page)) {
      return;
    }
    const start = page * TABLE_PAGE_SIZE;
    if (start >= this.rowCount) {
      return;
    }
    this.asked.add(page);
    const generation = this.generation;
    fetch(start, Math.min(TABLE_PAGE_SIZE, this.rowCount - start)).then(
      (rows) => {
        if (generation !== this.generation) {
          return;
        }
        this.pages.set(page, rows);
        if (page === 0) {
          void this.layOut(rows, generation);
        }
        this.requestUpdate();
      },
      () => {
        // Forgotten, so that scrolling to the page asks again.
        if (generation === this.generation) {
          this.asked.delete(page);
        }
      },
    );
  }

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
            class=${classMap({ cell: true, numeric: isNumeric(column.values), null: cell.isNull })}
            role="gridcell"
            aria-colindex=${index + 2}
            title=${ifDefined(this.fullText(cell.text, widths[index] ?? 0, false))}
            .textContent=${cell.text}
          ></div>`;
        })}
      </div>
    `;
  }

  private renderTable(layout: ColumnLayout) {
    const { scrollHeight, firstRow, endRow } = this.currentWindow();
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
                aria-colindex=${index + 2}
                title=${ifDefined(this.fullText(column.name, layout.widths[index] ?? 0, true))}
                .textContent=${column.name}
              ></div>`,
          )}
        </div>
        <div class="rows" style="top: ${this.headerHeight + firstRow * this.rowHeight}px">
          ${repeat(
            rows,
            (row) => row,
            (row) => this.renderRow(row, layout.widths),
          )}
        </div>
      </div>
    `;
  }

  override render() {
    const layout = this.layout;
    return html`
      <div
        class="viewport"
        role="grid"
        tabindex="0"
        aria-label=${this.label}
        aria-rowcount=${this.rowCount + 1}
        aria-colcount=${this.columns.length + 1}
        aria-busy=${layout === undefined ? 'true' : 'false'}
        @scroll=${this.onScroll}
      >
        ${layout === undefined ? nothing : this.renderTable(layout)}
      </div>
    `;
  }
}

defineOnce('k-table', KTable);

declare global {
  interface HTMLElementTagNameMap {
    'k-table': KTable;
  }
}
