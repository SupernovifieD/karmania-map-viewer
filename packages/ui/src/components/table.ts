import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
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

/** How wide a column of values is. */
const COLUMN_WIDTH = 120;

/** The size a token gives, in pixels, or `fallback` if the page has no such token. */
function tokenPixels(element: Element, name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** Whether a column holds numbers, which are set on the right. */
function isNumeric(values: TableValues): boolean {
  return values instanceof Float64Array || values instanceof Int32Array;
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
 * The first page also gives the names of the columns, so nothing is drawn until it has arrived.
 */
export class KTable extends LitElement {
  static override properties = {
    rowCount: { type: Number },
    fetch: { attribute: false },
    label: { type: String },
    columns: { state: true },
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

      .cell {
        align-items: center;
        border-bottom: var(--k-border-width) solid var(--k-border);
        display: flex;
        min-width: 0;
        overflow: hidden;
        padding: 0 var(--k-space-8);
        white-space: nowrap;
      }

      .cell.numeric {
        justify-content: flex-end;
      }

      .head {
        font-weight: var(--k-weight-medium);
      }

      /* The row numbers stay at the left as the values go by under them. */
      .cell.number {
        background: var(--k-surface);
        border-right: var(--k-border-width) solid var(--k-border);
        color: var(--k-text-muted);
        justify-content: flex-end;
        left: 0;
        position: sticky;
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
  private rowHeight = 28;
  private headerHeight = 32;
  private observer: ResizeObserver | undefined;

  constructor() {
    super();
    this.rowCount = 0;
    this.fetch = undefined;
    this.label = 'Table';
    this.columns = [];
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
          this.columns = rows.columns;
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

  /** The text of a cell, or nothing if its page has not come. */
  private text(row: number, column: number): string {
    const rows = this.pages.get(Math.floor(row / TABLE_PAGE_SIZE));
    const values = rows?.columns[column];
    if (rows === undefined || values === undefined) {
      return '';
    }
    const at = row - rows.start;
    if (values.nulls[at] === 1) {
      return '';
    }
    const value = values.values[at];
    return value === undefined ? '' : String(value);
  }

  private renderRow(row: number) {
    return html`
      <div class="row" role="row" aria-rowindex=${row + 2}>
        <div class="cell number" role="rowheader">${row + 1}</div>
        ${this.columns.map(
          (column, index) => html`
            <div
              class="cell ${isNumeric(column.values) ? 'numeric' : ''}"
              role="gridcell"
              aria-colindex=${index + 2}
            >
              ${this.text(row, index)}
            </div>
          `,
        )}
      </div>
    `;
  }

  override render() {
    const ready = this.columns.length > 0;
    const { scrollHeight, firstRow, endRow } = this.currentWindow();
    const digits = Math.max(3, String(this.rowCount).length);
    const columns = `calc(${String(digits)}ch + var(--k-space-16)) repeat(${String(this.columns.length)}, ${String(COLUMN_WIDTH)}px)`;
    const rows = Array.from({ length: endRow - firstRow }, (_, index) => firstRow + index);
    return html`
      <div
        class="viewport"
        role="grid"
        tabindex="0"
        aria-label=${this.label}
        aria-rowcount=${this.rowCount + 1}
        aria-colcount=${this.columns.length + 1}
        aria-busy=${ready ? 'false' : 'true'}
        @scroll=${this.onScroll}
      >
        ${
          ready
            ? html`
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
                      (column, index) => html`
                        <div
                          class="cell head ${isNumeric(column.values) ? 'numeric' : ''}"
                          role="columnheader"
                          aria-colindex=${index + 2}
                        >
                          ${column.name}
                        </div>
                      `,
                    )}
                  </div>
                  <div class="rows" style="top: ${this.headerHeight + firstRow * this.rowHeight}px">
                    ${repeat(
                      rows,
                      (row) => row,
                      (row) => this.renderRow(row),
                    )}
                  </div>
                </div>
              `
            : nothing
        }
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
