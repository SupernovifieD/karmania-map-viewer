/**
 * What the Legend tab does with its rows, as functions of the legend model, so that it is tried without a browser: which rows a person can reach, where
 * the arrow keys go, and what a switch asks of the scene.
 */
import type { Command, GroupVisibility, LegendLayerEntry, LegendModel } from '@karmania/scene';

/** A row of the tree that is shown (a layer of a group that is folded away is not). A layer can be opened (it has its style behind its row), and `expanded` says it is. */
export type TreeItem =
  | {
      readonly kind: 'group';
      readonly id: string;
      readonly level: 1;
      readonly collapsed: boolean;
      readonly visibility: GroupVisibility;
    }
  | {
      readonly kind: 'layer';
      readonly id: string;
      readonly level: 1 | 2;
      /** The group the layer is in, or `null` for a layer of the top of the legend. */
      readonly parent: string | null;
      readonly visible: boolean;
      readonly expanded: boolean;
    };

/** What names a row among the others: a layer and a group are told apart by their kind, whatever their ids. */
export function itemKey(item: Pick<TreeItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

/**
 * The rows that are shown, from the top: each group, and under it its layers if it is open. `open` is the ids of the layers that a person has opened (every
 * layer can be: behind its row are its style, and its classes if it has them).
 */
export function treeItems(
  model: LegendModel,
  open: ReadonlySet<string> = new Set(),
): readonly TreeItem[] {
  const layerItem = (layer: LegendLayerEntry, level: 1 | 2, parent: string | null): TreeItem => {
    return {
      kind: 'layer',
      id: layer.id,
      level,
      parent,
      visible: layer.visible,
      expanded: open.has(layer.id),
    };
  };
  return model.entries.flatMap((entry): TreeItem[] => {
    if (entry.type === 'layer') {
      return [layerItem(entry, 1, null)];
    }
    const group: TreeItem = {
      kind: 'group',
      id: entry.id,
      level: 1,
      collapsed: entry.collapsed,
      visibility: entry.visibility,
    };
    return entry.collapsed
      ? [group]
      : [group, ...entry.layers.map((layer) => layerItem(layer, 2, entry.id))];
  });
}

/** The ids of the layers that are open, with `id` opened or closed: the same set if it already is so. */
export function withExpansion(
  open: ReadonlySet<string>,
  id: string,
  expanded: boolean,
): ReadonlySet<string> {
  if (open.has(id) === expanded) {
    return open;
  }
  const next = new Set(open);
  if (expanded) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

/** The ids of `open` that are still layers of the legend: a layer that has gone is not kept open for another that is given its id. */
export function stillThere(open: ReadonlySet<string>, model: LegendModel): ReadonlySet<string> {
  const ids = new Set(
    model.entries.flatMap((entry) =>
      entry.type === 'layer' ? [entry.id] : entry.layers.map((layer) => layer.id),
    ),
  );
  const kept = [...open].filter((id) => ids.has(id));
  return kept.length === open.size ? open : new Set(kept);
}

/**
 * What a key does to whether a row is open: Right opens a layer that is closed (every layer opens: its style is behind its row), Left closes one that is
 * open. `undefined` when the key does nothing to this row (any other key, a group, or a layer that is so already).
 */
export function expansionFor(item: TreeItem, key: string): boolean | undefined {
  if (item.kind !== 'layer') {
    return undefined;
  }
  if (key === 'ArrowRight' && !item.expanded) {
    return true;
  }
  if (key === 'ArrowLeft' && item.expanded) {
    return false;
  }
  return undefined;
}

/** The keys that move between rows. */
export type MoveKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/**
 * The key of the row that a move key goes to from the row `current`: the next or the one before (and none further than the ends), the first or the
 * last. With no row that is `current` (nothing has the keyboard yet, or its row has gone), down and Home go to the first row, and up and End to the last.
 * `undefined` when there are no rows.
 */
export function moveFrom(
  items: readonly TreeItem[],
  current: string | undefined,
  key: MoveKey,
): string | undefined {
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const at = items.findIndex((item) => itemKey(item) === current);
  const target =
    key === 'Home'
      ? first
      : key === 'End'
        ? last
        : at < 0
          ? key === 'ArrowDown'
            ? first
            : last
          : (items[Math.min(Math.max(at + (key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)] ??
            first);
  return itemKey(target);
}

/**
 * What switching a row asks of the scene: a layer is shown if it is hidden and hidden if it is shown; a group that has all its layers on has them all
 * turned off, and a group that has some or none on has them all turned on (the way a box that is neither ticked nor not goes when it is pressed).
 */
export function toggleCommand(item: TreeItem): Command {
  return item.kind === 'layer'
    ? { type: 'setVisible', layerId: item.id, visible: !item.visible }
    : { type: 'setGroupVisible', groupId: item.id, visible: item.visibility !== 'all' };
}

/** What a key asks of the tree beyond moving between rows: to open or close a layer, to fold or unfold a group, or to put the keyboard on another row. */
export type KeyAction =
  | { readonly kind: 'open'; readonly id: string; readonly open: boolean }
  | { readonly kind: 'fold'; readonly groupId: string; readonly collapsed: boolean }
  | { readonly kind: 'focus'; readonly key: string };

/**
 * What Right and Left do on a row, as they do in a tree: on a group that is folded, Right unfolds it; on one that is open, Right goes to its first layer
 * and Left folds it. On a layer, Right opens it and Left closes it; on a layer that is not open, in a group, Left goes to the group.
 * `undefined` when the key does nothing there (any other key, a group with nothing under it, a layer of the top that is closed).
 */
export function keyAction(
  items: readonly TreeItem[],
  item: TreeItem,
  key: string,
): KeyAction | undefined {
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') {
    return undefined;
  }
  if (item.kind === 'group') {
    if (key === 'ArrowRight' && item.collapsed) {
      return { kind: 'fold', groupId: item.id, collapsed: false };
    }
    if (key === 'ArrowRight') {
      const at = items.findIndex((other) => itemKey(other) === itemKey(item));
      const first = items[at + 1];
      return first?.kind === 'layer' && first.parent === item.id
        ? { kind: 'focus', key: itemKey(first) }
        : undefined;
    }
    return item.collapsed ? undefined : { kind: 'fold', groupId: item.id, collapsed: true };
  }
  const expanded = expansionFor(item, key);
  if (expanded !== undefined) {
    return { kind: 'open', id: item.id, open: expanded };
  }
  return key === 'ArrowLeft' && item.parent !== null
    ? { kind: 'focus', key: `group:${item.parent}` }
    : undefined;
}
