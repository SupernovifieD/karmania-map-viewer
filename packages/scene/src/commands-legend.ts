/**
 * Commands on the order of the legend and on its groups. The legend is a list of layers and groups, and a group
 * holds layers: one level, so a group is never in a group. Like every command, each is a pure function, and a
 * command that would change nothing, or that names what is not there, gives back the document it was given.
 */
import { nextId } from './ids.js';
import type { GroupId, LegendGroupNode, LegendNode, SceneDocument } from './types.js';

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

function groupsOf(legend: readonly LegendNode[]): LegendGroupNode[] {
  return legend.filter((node): node is LegendGroupNode => node.type === 'group');
}

/** The document with the group `id` made into what `change` says: the same document if there is no such group, or if its name and whether it is folded are as they were. */
function changeGroup(
  doc: SceneDocument,
  id: string,
  change: (group: LegendGroupNode) => LegendGroupNode,
): SceneDocument {
  const group = groupsOf(doc.legend).find((candidate) => candidate.id === id);
  if (group === undefined) {
    return doc;
  }
  const changed = change(group);
  if (changed.name === group.name && changed.collapsed === group.collapsed) {
    return doc;
  }
  return { ...doc, legend: doc.legend.map((node) => (node === group ? changed : node)) };
}

/**
 * Makes an empty group, called `name` without the space around it, as `group-N` with N one more than the highest,
 * at a place at the top of the legend (the top by default; the place is as for {@link moveNode}). A name that is
 * nothing but space is no name, and gives the same document.
 */
export function createGroup(doc: SceneDocument, name: string, index = 0): SceneDocument {
  const trimmed = name.trim();
  if (trimmed === '' || Number.isNaN(index)) {
    return doc;
  }
  // Every id there is: a group never has the id of a layer, also of one that is in a group.
  const id = nextId('group', [...Object.keys(doc.layers), ...doc.legend.map((node) => node.id)]);
  const group: LegendGroupNode = {
    type: 'group',
    id,
    name: trimmed,
    collapsed: false,
    children: [],
  };
  return { ...doc, legend: insertAt(doc.legend, index, group) };
}

/** Names a group `name` without the space around it. A name that is nothing but space, or the one it has, is the same document. */
export function renameGroup(doc: SceneDocument, groupId: string, name: string): SceneDocument {
  const trimmed = name.trim();
  return trimmed === '' ? doc : changeGroup(doc, groupId, (group) => ({ ...group, name: trimmed }));
}

/** Folds a group up so that its layers are not listed, or opens it. */
export function setGroupCollapsed(
  doc: SceneDocument,
  groupId: string,
  collapsed: boolean,
): SceneDocument {
  return changeGroup(doc, groupId, (group) => ({ ...group, collapsed }));
}

/** Takes a group away and puts its layers where it was, in the order they had: no layer is lost or moved. */
export function deleteGroup(doc: SceneDocument, groupId: string): SceneDocument {
  const group = groupsOf(doc.legend).find((candidate) => candidate.id === groupId);
  if (group === undefined) {
    return doc;
  }
  const legend = doc.legend.flatMap((node): LegendNode[] =>
    node === group ? group.children.map((id): LegendNode => ({ type: 'layer', id })) : [node],
  );
  return { ...doc, legend };
}
