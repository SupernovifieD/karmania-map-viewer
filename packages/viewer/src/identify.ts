/**
 * What the identify popover says of the selected element (brief 10.5, step 21.3b): the name of its dataset, what it is and its number counted from 1 ("Point
 * 1,204"), and up to 8 of its attributes (name and value, as the table has them). It is made from the summary of the dataset, the selection, and the row
 * as the engine gives it, so it is made of facts and has no state: the popover only shows it.
 */
import type { Kind, Page, Summary } from '@karmania/engine/types';
import { formatCell, isNumeric } from '@karmania/ui';
import { formatCount } from './import-files.js';

/** The most attributes the popover shows (brief 10.5): the others are said as a number, and are in the table. */
export const IDENTIFY_ROWS = 8;

/** What an element of each kind of dataset is called. */
const WORDS: { readonly [K in Kind]: string } = {
  points: 'Point',
  lines: 'Line',
  polygons: 'Polygon',
  mesh: 'Triangle',
  grid: 'Cell',
  blocks: 'Block',
};

/** What an element of a dataset of this kind is called, as a person says it. */
export function elementWord(kind: Kind): string {
  return WORDS[kind];
}

/** One attribute of the element. */
export interface IdentifyRow {
  readonly name: string;
  /** The value in words, as the table has it (a null is `null`). */
  readonly value: string;
  readonly isNull: boolean;
  /** Whether it is a number, which is set in a column of its own in tabular figures. */
  readonly numeric: boolean;
}

/** What the popover says. */
export interface IdentifyModel {
  /** The dataset and the element in it, counted from 0: what "Show in table" goes to. */
  readonly datasetId: number;
  readonly element: number;
  readonly name: string;
  /** `Point 1,204`: the kind of element, and its number counted from 1. */
  readonly caption: string;
  /** `loading` until the row is there, `missing` if the dataset has no such row any more, `ready` when it has been read. */
  readonly state: 'loading' | 'ready' | 'missing';
  /** At most `IDENTIFY_ROWS`, in the order of the columns of the dataset. */
  readonly rows: readonly IdentifyRow[];
  /** How many more attributes the element has than are shown. */
  readonly more: number;
}

/**
 * What the popover says of element `element` (from 0) of the dataset `summary`, when `page` is the row of it that the engine gave (`undefined` while
 * it has not). The attributes are the dataset's own columns, in their order: the columns that say what the row is (the position of a point, the
 * number of a cell) are in the caption or in the table, and are not attributes.
 */
export function identifyModel(
  summary: Summary,
  element: number,
  page: Page | undefined,
): IdentifyModel {
  const head = {
    datasetId: summary.id,
    element,
    name: summary.name,
    caption: `${elementWord(summary.kind)} ${formatCount(element + 1)}`,
  };
  if (page === undefined) {
    return { ...head, state: 'loading', rows: [], more: 0 };
  }
  if (page.count < 1) {
    return { ...head, state: 'missing', rows: [], more: 0 };
  }
  // The attributes are the last columns of the page (as many as the dataset has): looked for among those only, as a name may be one of the columns that say
  // what the row is (an attribute called Z, or i), which come first.
  const own = page.columns.slice(Math.max(0, page.columns.length - summary.columns.length));
  const rows = summary.columns.flatMap((column): IdentifyRow[] => {
    const found = own.find((each) => each.name === column.name);
    if (found === undefined) {
      return [];
    }
    const isNull = found.nulls[0] === 1;
    return [
      {
        name: column.name,
        value: formatCell(found, 0),
        isNull,
        numeric: !isNull && isNumeric(found.values),
      },
    ];
  });
  return {
    ...head,
    state: 'ready',
    rows: rows.slice(0, IDENTIFY_ROWS),
    more: Math.max(0, rows.length - IDENTIFY_ROWS),
  };
}
