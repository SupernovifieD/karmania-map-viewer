/**
 * What the Legend tab does with its rows, as functions of the legend model, so that it is tried without a browser: which rows a person can reach, where
 * the arrow keys go, and what a switch asks of the scene.
 */
import type { Command, GroupVisibility, LegendModel } from '@karmania/scene';

/** A row of the tree that is shown (a layer of a group that is folded away is not). */
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
      readonly visible: boolean;
    };

/** What names a row among the others: a layer and a group are told apart by their kind, whatever their ids. */
export function itemKey(item: Pick<TreeItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

/** The rows that are shown, from the top: each group, and under it its layers if it is open. */
export function treeItems(model: LegendModel): readonly TreeItem[] {
  return model.entries.flatMap((entry): TreeItem[] => {
    if (entry.type === 'layer') {
      return [{ kind: 'layer', id: entry.id, level: 1, visible: entry.visible }];
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
      : [
          group,
          ...entry.layers.map((layer): TreeItem => ({
            kind: 'layer',
            id: layer.id,
            level: 2,
            visible: layer.visible,
          })),
        ];
  });
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
