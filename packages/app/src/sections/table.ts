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

/** A source of `rowCount` made-up rows. */
export const fetchSynthetic: TableFetch = (start, count) =>
  Promise.resolve(syntheticRows(start, count));

/** The table with few rows and with a hundred thousand, in the room the Data tab gives it. */
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
    </section>
  `;
}
