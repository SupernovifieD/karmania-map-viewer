/**
 * Where a row that is dragged over the Legend tab lands, as functions of where the rows are (measured by the tab when the drag starts) and of the
 * pointer, so that it is tried without a browser. A row can land in any gap between the rows of its list: the top of the legend, or a group. The line that
 * shows it is at the gap; two gaps can be at one height (the end of a group and the next row of the top), and the pointer's place across tells which.
 */
import type { Place } from './legend-order.js';

/** A row that is shown, as it is measured: from the top of the window, in pixels. */
export interface DropRow {
  readonly id: string;
  readonly kind: 'group' | 'layer';
  /** The group a layer is in, or `null` for a row of the top of the legend (a group is always there). */
  readonly parent: string | null;
  /** Where it is in its list. */
  readonly index: number;
  /** A group whose layers are folded away has none of them as rows. */
  readonly collapsed?: boolean;
  readonly top: number;
  /** The bottom of the row itself. */
  readonly bottom: number;
  /** The bottom of all that is its own: for a layer, its row and its lines if it is open, and for a group, its row and its layers. */
  readonly blockBottom: number;
  /** Where its row starts across. */
  readonly left: number;
}

/** A gap that a row can land in, and where to draw the line that shows it. */
export interface DropCandidate {
  /** Where `moveNode` is to put the row: the list, and the index counted once the row is out of it. */
  readonly place: Place;
  readonly y: number;
  /** Where the line starts across: at the left of the rows of the list. */
  readonly left: number;
  /** 1 for a gap in the top of the legend, 2 for one in a group. */
  readonly level: 1 | 2;
}

/** How near in height two gaps are to be one place that the pointer's place across has to tell apart, in pixels. */
const SAME_HEIGHT = 2;

/** The index `moveNode` is given for a gap of `gap` in a list, for a row that is in `from` of the same list (or in another). */
function indexFor(gap: number, from: number | undefined): number {
  return from !== undefined && gap > from ? gap - 1 : gap;
}

/**
 * The gaps that the row `dragging` can land in, from the top: before each row of the top of the legend and after the last, and in each group before
 * each of its layers and after the last (or right under the group, if it has none that are shown). A layer can land anywhere; a group only in the top
 * of the legend. Where the row would not move (the gap before it and the gap after it) there is none. `indent` is how far in the layers of a group are, for
 * the line of a group that has none that are shown.
 */
export function dropCandidates(
  rows: readonly DropRow[],
  dragging: { readonly id: string; readonly kind: 'group' | 'layer' },
  indent: number,
): readonly DropCandidate[] {
  const found: DropCandidate[] = [];
  const own = rows.find((row) => row.id === dragging.id);
  const add = (parent: string | null, gap: number, y: number, left: number, level: 1 | 2): void => {
    const from = own !== undefined && own.parent === parent ? own.index : undefined;
    // The gap right before the row, and right after it: it would stay where it is.
    if (from !== undefined && (gap === from || gap === from + 1)) {
      return;
    }
    found.push({ place: { parent, index: indexFor(gap, from) }, y, left, level });
  };

  const top = rows.filter((row) => row.parent === null);
  for (const row of top) {
    add(null, row.index, row.top, row.left, 1);
  }
  const last = top.at(-1);
  if (last !== undefined) {
    add(null, last.index + 1, last.blockBottom, last.left, 1);
  }

  if (dragging.kind === 'layer') {
    for (const group of top.filter((row) => row.kind === 'group')) {
      const inside = rows.filter((row) => row.parent === group.id);
      if (inside.length === 0) {
        // Folded away, or empty: right under the group, as its first layer.
        add(group.id, 0, group.bottom, group.left + indent, 2);
        continue;
      }
      for (const row of inside) {
        add(group.id, row.index, row.top, row.left, 2);
      }
      const end = inside.at(-1);
      if (end !== undefined) {
        add(group.id, end.index + 1, end.blockBottom, end.left, 2);
      }
    }
  }
  return found;
}

/**
 * The gap that the pointer is at: the nearest in height, and, where two are at one height (the end of a group and the row after it), the one in the
 * group if the pointer is at or past `nestAt` across (where the rows of a group start), and the one in the top of the legend if it is not.
 * `undefined` when there is no gap.
 */
export function pickDrop(
  candidates: readonly DropCandidate[],
  pointer: { readonly x: number; readonly y: number },
  nestAt: number,
): DropCandidate | undefined {
  let best = Infinity;
  for (const candidate of candidates) {
    best = Math.min(best, Math.abs(candidate.y - pointer.y));
  }
  const near = candidates.filter(
    (candidate) => Math.abs(candidate.y - pointer.y) <= best + SAME_HEIGHT,
  );
  const wanted = pointer.x >= nestAt ? 2 : 1;
  return near.find((candidate) => candidate.level === wanted) ?? near[0];
}
