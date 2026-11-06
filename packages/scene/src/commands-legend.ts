/**
 * Commands on the order of the legend and on its groups. The legend is a list of layers and groups, and a group
 * holds layers: one level, so a group is never in a group. Like every command, each is a pure function, and a
 * command that would change nothing, or that names what is not there, gives back the document it was given.
 */
import type { GroupId, LegendNode, SceneDocument } from './types.js';

/** Where a node goes: the top of the legend (`parent` is `null`) or a group, at a place in that list. */
export interface LegendPlace {
  readonly parent: GroupId | null;
  /**
   * The place in the list that the node is put into, counted once the node has been taken out of it (so that
   * moving a row down by one is `index + 1` whichever list it is in); from 0, and one past the end or more is the end.
   */
  readonly index: number;
}

function without(legend: readonly LegendNode[], id: string): LegendNode[] {
  return legend.flatMap((node): LegendNode[] => {
    if (node.type === 'layer') {
      return node.id === id ? [] : [node];
    }
    return node.id === id
      ? []
      : [{ ...node, children: node.children.filter((child) => child !== id) }];
  });
}

function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  // `slice` keeps a place past the end at the end and drops the fraction of one, so only "before the start" is left.
  const at = Math.max(index, 0);
  return [...list.slice(0, at), item, ...list.slice(at)];
}

function sameLegend(a: readonly LegendNode[], b: readonly LegendNode[]): boolean {
  return (
    a.length === b.length &&
    a.every((node, i) => {
      const other = b[i];
      if (other === undefined || node.type !== other.type || node.id !== other.id) {
        return false;
      }
      if (node.type === 'group' && other.type === 'group') {
        return (
          node.children.length === other.children.length &&
          node.children.every((c, j) => c === other.children[j])
        );
      }
      return true;
    })
  );
}

/** The node with this id (a layer, or a group) as it is in the legend, wherever it is. */
function findNode(legend: readonly LegendNode[], id: string): LegendNode | undefined {
  for (const node of legend) {
    if (node.id === id) {
      return node;
    }
    if (node.type === 'group' && node.children.includes(id)) {
      return { type: 'layer', id };
    }
  }
  return undefined;
}

/**
 * Moves a layer or a group to `to`. A layer can go to the top of the legend or into a group; a group can only go to
 * the top (groups do not nest). The rest of the legend keeps its order, and a group that is left empty stays. A node
 * or a group that is not there, a group sent into a group, a place that is `NaN`, and a move to where the node
 * already is, are all the same document.
 */
export function moveNode(doc: SceneDocument, id: string, to: LegendPlace): SceneDocument {
  const node = findNode(doc.legend, id);
  if (node === undefined || Number.isNaN(to.index)) {
    return doc;
  }
  if (node.type === 'group' && to.parent !== null) {
    return doc;
  }
  const rest = without(doc.legend, id);
  let legend: LegendNode[];
  if (to.parent === null) {
    legend = insertAt(rest, to.index, node);
  } else {
    const parent = rest.find((n) => n.type === 'group' && n.id === to.parent);
    if (parent?.type !== 'group') {
      return doc;
    }
    const moved = { ...parent, children: insertAt(parent.children, to.index, id) };
    legend = rest.map((n) => (n === parent ? moved : n));
  }
  return sameLegend(legend, doc.legend) ? doc : { ...doc, legend };
}
