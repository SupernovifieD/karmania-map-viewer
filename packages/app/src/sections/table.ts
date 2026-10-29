import type { TableFetch, TableRows } from '@karmania/ui';
import { html } from 'lit';

/**
 * Rows made up on the spot, for as many as are asked for: the row's own number, a decimal, some
 * text and a flag. Nothing is stored, so there can be any number of them.
 */
export function syntheticRows(start: number, count: number): TableRows {
  const rows = Array.from({ length: count }, (_, index) => start + index);
  return {
    start,
    count,
    columns: [
      {
        name: 'id',
        values: Int32Array.from(rows, (row) => row + 1),
        nulls: new Uint8Array(count),
      },
      {
        name: 'easting',
        values: Float64Array.from(rows, (row) => 500_000 + row * 0.5),
        nulls: new Uint8Array(count),
      },
      {
        name: 'label',
        values: rows.map((row) => `Feature ${String(row + 1)}`),
        nulls: new Uint8Array(count),
      },
      {
        name: 'inside',
        values: Uint8Array.from(rows, (row) => row % 2),
        nulls: new Uint8Array(count),
      },
      {
        name: 'a column further along the table',
        values: rows.map((row) => `r${String(row + 1)}c5`),
        nulls: new Uint8Array(count),
      },
      {
        name: 'and another',
        values: rows.map((row) => `r${String(row + 1)}c6`),
        nulls: new Uint8Array(count),
      },
    ],
  };
}

const LONG_TEXT =
  'A description that goes on and on, far past what any column of a table is wide enough to show';

/**
 * Rows for the widest and narrowest columns a table makes: a column of one digit, a column of long
 * text, a header longer than anything under it, and a column that is short for the first 200 rows,
 * which are what the widths come from, and long after them.
 */
export function clampedRows(start: number, count: number): TableRows {
  const rows = Array.from({ length: count }, (_, index) => start + index);
  return {
    start,
    count,
    columns: [
      {
        name: 'n',
        values: Int32Array.from(rows, (row) => (row % 9) + 1),
        nulls: new Uint8Array(count),
      },
      {
        name: 'description',
        values: rows.map((row) => `${LONG_TEXT}, row ${String(row + 1)}`),
        nulls: new Uint8Array(count),
      },
      {
        name: 'A header that is far longer than anything under it, and than a column can be',
        values: rows.map(() => 'x'),
        nulls: new Uint8Array(count),
      },
      {
        name: 'amount',
        values: Float64Array.from(rows, (row) => 1_234_567.891 + row),
        nulls: new Uint8Array(count),
      },
      {
        name: 'later',
        values: rows.map((row) =>
          row < 200 ? 'short' : 'much longer than the first two hundred rows were',
        ),
        nulls: new Uint8Array(count),
      },
    ],
  };
}

/** A source of made-up rows for the widest and narrowest columns. */
export const fetchClamped: TableFetch = (start, count) =>
  Promise.resolve(clampedRows(start, count));

/** A source of `rowCount` made-up rows. */
export const fetchSynthetic: TableFetch = (start, count) =>
  Promise.resolve(syntheticRows(start, count));

/** The table with few rows, with a hundred thousand, and with the widest and narrowest columns. */
export function tableSection() {
  return html`
    <section data-section="table">
      <h2>Table</h2>
      <div class="table-demo" id="table-few">
        <k-table label="Few rows" .rowCount=${5} .fetch=${fetchSynthetic}></k-table>
      </div>
      <div class="table-demo" id="table-many">
        <k-table label="Many rows" .rowCount=${100_000} .fetch=${fetchSynthetic}></k-table>
      </div>
      <div class="table-demo wide" id="table-clamped">
        <k-table
          label="Widest and narrowest columns"
          .rowCount=${1000}
          .fetch=${fetchClamped}
        ></k-table>
      </div>
    </section>
  `;
}
