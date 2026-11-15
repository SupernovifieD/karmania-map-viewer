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
  /** The groups that are folded: their layers are not shown. */
  readonly folded: ReadonlySet<string>;
}

function listsOf(model: LegendModel): Lists {
  const groups = new Map<string, readonly string[]>();
  const names = new Map<string, string>();
  const folded = new Set<string>();
  for (const entry of model.entries) {
    names.set(entry.id, entry.name);
    if (entry.type === 'group') {
      if (entry.collapsed) {
        folded.add(entry.id);
      }
      groups.set(
        entry.id,
        entry.layers.map((layer) => layer.id),
      );
      for (const layer of entry.layers) {
        names.set(layer.id, layer.name);
      }
    }
  }
  return { top: model.entries.map((entry) => entry.id), groups, names, folded };
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
 * What is said when `id` has been moved to `to`, worked out from the legend as it is before the move: into a group (and that it is folded, if it is), or out of
 * the one it was in, or, within its list, above the one that is under it now, or below the one that is over it (`Moved Assays above Topography`). A node that is the only one
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
    if (to.parent === null) {
      return `Moved ${name} out of ${lists.names.get(from.parent ?? '') ?? 'its group'}`;
    }
    // A layer that goes into a folded group is not shown any more, and that is what a person who cannot see the list has to be told.
    return `Moved ${name} into ${lists.names.get(to.parent) ?? 'a group'}${lists.folded.has(to.parent) ? ', which is folded' : ''}`;
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

/**
 * What Alt with Right or Left does to a layer: Right takes a layer of the top into the group right above it (as the last of its layers, so that it stays
 * where it is in the list), Left takes a layer out of its group to just under the group. A group is never in a group, a layer of the top with no group right
 * above it has none to go into, and a layer that is not in a group has none to leave: each says so.
 */
export function nestMove(
  model: LegendModel,
  id: string,
  direction: 'in' | 'out',
): { readonly move?: Move; readonly say: string } {
  const lists = listsOf(model);
  const place = placeOf(model, id);
  const name = lists.names.get(id) ?? id;
  if (place === undefined) {
    return { say: `${name} cannot be moved.` };
  }
  const isGroup = lists.groups.has(id);
  if (direction === 'in') {
    if (isGroup) {
      return { say: `${name} is a group, and a group cannot be in a group` };
    }
    if (place.parent !== null) {
      return { say: `${name} is in ${lists.names.get(place.parent) ?? 'a group'} already` };
    }
    const above = lists.top[place.index - 1];
    if (above === undefined || !lists.groups.has(above)) {
      return { say: `${name} has no group right above it to go into` };
    }
    const to: Place = { parent: above, index: listOf(lists, above).length };
    return { move: { id, to }, say: announceMove(model, id, to) };
  }
  if (place.parent === null) {
    return { say: `${name} is not in a group` };
  }
  const group = placeOf(model, place.parent);
  if (group === undefined) {
    return { say: `${name} cannot be moved.` };
  }
  const to: Place = { parent: null, index: group.index + 1 };
  return { move: { id, to }, say: announceMove(model, id, to) };
}

/** What is said when a group has been deleted: its layers are in the legend where it was. */
export function announceDelete(model: LegendModel, groupId: string): string {
  const lists = listsOf(model);
  const name = lists.names.get(groupId) ?? groupId;
  const count = listOf(lists, groupId).length;
  if (count === 0) {
    return `Deleted group ${name}`;
  }
  return `Deleted group ${name}; its ${String(count)} ${count === 1 ? 'layer is' : 'layers are'} in the legend`;
}

/** The id of the group that is in `after` and was not in `before`: the one that was made. `undefined` if there is none. */
export function newGroup(before: LegendModel, after: LegendModel): string | undefined {
  const known = new Set(before.entries.map((entry) => entry.id));
  return after.entries.find((entry) => entry.type === 'group' && !known.has(entry.id))?.id;
}
