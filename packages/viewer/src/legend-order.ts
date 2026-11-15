/**
 * Moving rows of the Legend tab, as functions of the legend model: where a row is, where Alt with Up or Down takes it, and what is said when a row has
 * been moved (a polite live region says it, as section 10.3 of the brief asks: `Moved Assays above Topography`). A place is where `moveNode` puts a node:
 * the top of the legend (`parent` is `null`) or a group, at an index of that list that counts once the node is out of it.
 */
import type { LegendModel } from '@karmania/scene';

/** Where a node goes, as the scene's `moveNode` says it. */
export interface Place {
  readonly parent: string | null;
  readonly index: number;
}

/** A node (a layer or a group) is moved to a place. */
export interface Move {
  readonly id: string;
  readonly to: Place;
}

/** The ids of the lists of the legend: the top of it, and each group's layers, with their names. */
interface Lists {
  readonly top: readonly string[];
  readonly groups: ReadonlyMap<string, readonly string[]>;
  readonly names: ReadonlyMap<string, string>;
}

function listsOf(model: LegendModel): Lists {
  const groups = new Map<string, readonly string[]>();
  const names = new Map<string, string>();
  for (const entry of model.entries) {
    names.set(entry.id, entry.name);
    if (entry.type === 'group') {
      groups.set(
        entry.id,
        entry.layers.map((layer) => layer.id),
      );
      for (const layer of entry.layers) {
        names.set(layer.id, layer.name);
      }
    }
  }
  return { top: model.entries.map((entry) => entry.id), groups, names };
}

/** The ids of the list that `parent` names. */
function listOf(lists: Lists, parent: string | null): readonly string[] {
  return parent === null ? lists.top : (lists.groups.get(parent) ?? []);
}

/** Where a node is now: the list it is in and its index, and how many there are in that list. `undefined` if there is no such node. */
export function placeOf(
  model: LegendModel,
  id: string,
): (Place & { readonly size: number }) | undefined {
  const lists = listsOf(model);
  const index = lists.top.indexOf(id);
  if (index >= 0) {
    return { parent: null, index, size: lists.top.length };
  }
  for (const [parent, ids] of lists.groups) {
    const at = ids.indexOf(id);
    if (at >= 0) {
      return { parent, index: at, size: ids.length };
    }
  }
  return undefined;
}

/**
 * What is said when `id` has been moved to `to`, worked out from the legend as it is before the move: into a group, or out of the one it was in, or,
 * within its list, above the one that is under it now, or below the one that is over it (`Moved Assays above Topography`). A node that is the only one
 * of its list is not moved, and that is what is said.
 */
export function announceMove(model: LegendModel, id: string, to: Place): string {
  const lists = listsOf(model);
  const from = placeOf(model, id);
  const name = lists.names.get(id) ?? id;
  if (from === undefined) {
    return `${name} cannot be moved.`;
  }
  if (from.parent !== to.parent) {
    return to.parent === null
      ? `Moved ${name} out of ${lists.names.get(from.parent ?? '') ?? 'its group'}`
      : `Moved ${name} into ${lists.names.get(to.parent) ?? 'a group'}`;
  }
  const after = listOf(lists, to.parent).filter((other) => other !== id);
  const at = Math.min(Math.max(to.index, 0), after.length);
  const under = after[at];
  const over = after[at - 1];
  if (under !== undefined) {
    return `Moved ${name} above ${lists.names.get(under) ?? under}`;
  }
  if (over !== undefined) {
    return `Moved ${name} below ${lists.names.get(over) ?? over}`;
  }
  return `${name} is the only one in its list`;
}

/** The place that the row `id` goes to with Alt and Up or Down, and what is said: the move, or, at the end of its list, that it cannot go further. */
export function stepMove(
  model: LegendModel,
  id: string,
  direction: 'up' | 'down',
): { readonly move?: Move; readonly say: string } {
  const lists = listsOf(model);
  const place = placeOf(model, id);
  const name = lists.names.get(id) ?? id;
  if (place === undefined) {
    return { say: `${name} cannot be moved.` };
  }
  const to: Place = {
    parent: place.parent,
    index: direction === 'up' ? place.index - 1 : place.index + 1,
  };
  if (to.index < 0 || to.index >= place.size) {
    const where =
      place.parent === null ? 'the legend' : (lists.names.get(place.parent) ?? 'its group');
    return {
      say: `${name} is already ${direction === 'up' ? 'at the top' : 'at the bottom'} of ${where}`,
    };
  }
  return { move: { id, to }, say: announceMove(model, id, to) };
}
