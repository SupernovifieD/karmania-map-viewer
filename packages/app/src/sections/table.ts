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

/** A row of the kinds of value: a note on what is in it, and one value for each kind of column. */
interface ValueRow {
  readonly note: string;
  readonly decimal: number | null;
  readonly whole: number | null;
  readonly flag: boolean | null;
  readonly text: string | null;
}

/** What a table does with the values a person might meet. */
const VALUE_ROWS: readonly ValueRow[] = [
  { note: 'plain', decimal: 42, whole: -2000, flag: true, text: 'plain' },
  {
    note: 'a decimal',
    decimal: 1_234_567.5,
    whole: 2_147_483_647,
    flag: false,
    text: '  spaced  ',
  },
  { note: 'noise', decimal: 0.1 + 0.2, whole: 0, flag: true, text: 'Ünï "quoted" & <tagged>' },
  { note: 'minus zero', decimal: -0, whole: -1, flag: false, text: '' },
  { note: 'large', decimal: 1.5e25, whole: 1, flag: true, text: 'null' },
  { note: 'small', decimal: 1.5e-7, whole: 10, flag: false, text: 'x' },
  { note: 'not a number', decimal: Number.NaN, whole: 100, flag: true, text: 'x' },
  { note: 'infinite', decimal: Number.POSITIVE_INFINITY, whole: 1000, flag: false, text: 'x' },
  {
    note: 'minus infinite',
    decimal: Number.NEGATIVE_INFINITY,
    whole: 10_000,
    flag: true,
    text: 'x',
  },
  { note: 'null', decimal: null, whole: null, flag: null, text: null },
];

/** Rows of the kinds of value: a column of decimals, of whole numbers, of flags and of text. */
export function valueRows(start: number, count: number): TableRows {
  const rows = VALUE_ROWS.slice(start, start + count);
  const nulls = (pick: (row: ValueRow) => unknown): Uint8Array =>
    Uint8Array.from(rows, (row) => (pick(row) === null ? 1 : 0));
  return {
    start,
    count: rows.length,
    columns: [
      {
        name: 'note',
        values: rows.map((row) => row.note),
        nulls: new Uint8Array(rows.length),
      },
      {
        name: 'decimal',
        values: Float64Array.from(rows, (row) => row.decimal ?? 0),
        nulls: nulls((row) => row.decimal),
      },
      {
        name: 'whole',
        values: Int32Array.from(rows, (row) => row.whole ?? 0),
        nulls: nulls((row) => row.whole),
      },
      {
        name: 'flag',
        values: Uint8Array.from(rows, (row) => (row.flag === true ? 1 : 0)),
        nulls: nulls((row) => row.flag),
      },
      {
        name: 'text',
        values: rows.map((row) => row.text ?? ''),
        nulls: nulls((row) => row.text),
      },
    ],
  };
}

/** A source of the rows of each kind of value. */
export const fetchValues: TableFetch = (start, count) => Promise.resolve(valueRows(start, count));

/** A source that has the first page, and fails for every other. */
export const fetchFailingLater: TableFetch = (start, count) =>
  start === 0
    ? Promise.resolve(syntheticRows(start, count))
    : Promise.reject(new Error('The rows are gone.'));

/** A source that fails for every page. */
export const fetchFailing: TableFetch = () => Promise.reject(new Error('The rows are gone.'));

/** A source of `rowCount` made-up rows. */
export const fetchSynthetic: TableFetch = (start, count) =>
  Promise.resolve(syntheticRows(start, count));

/** The table with few rows, with a hundred thousand and two million, and with the widest and narrowest columns. */
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
      <div class="table-demo wide tall" id="table-values">
        <k-table label="Kinds of value" .rowCount=${10} .fetch=${fetchValues}></k-table>
      </div>
      <div class="table-demo" id="table-huge">
        <k-table label="Two million rows" .rowCount=${2_000_000} .fetch=${fetchSynthetic}></k-table>
      </div>
      <div class="table-demo" id="table-failing">
        <k-table label="Rows that go" .rowCount=${1000} .fetch=${fetchFailingLater}></k-table>
      </div>
      <div class="table-demo" id="table-failed">
        <k-table label="Rows that never come" .rowCount=${1000} .fetch=${fetchFailing}></k-table>
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
