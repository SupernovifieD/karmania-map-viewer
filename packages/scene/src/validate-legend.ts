/** `validateScene`, the legend and the selection: their own shape, and that they refer to layers that are there. */
import {
  field,
  isRecord,
  place,
  readBoolean,
  readChoice,
  readList,
  readNumber,
  readRecord,
  readString,
  show,
  type Problems,
} from './problems.js';

/**
 * Checks the legend: layers and groups, with every layer in it once (directly or in a group), and a group's id
 * different from every layer's. `layerIds` are the layers of the document, or `undefined` if they could not be
 * read, and then what the legend refers to is not checked.
 */
export function checkLegend(
  problems: Problems,
  path: string,
  value: unknown,
  layerIds: ReadonlySet<string> | undefined,
): void {
  const nodes = readList(problems, path, value);
  if (nodes === undefined) {
    return;
  }
  const placed = new Set<string>();
  const groups = new Set<string>();
  const put = (where: string, id: string): void => {
    if (layerIds !== undefined && !layerIds.has(id)) {
      problems.add(where, 'reference', `${where} is ${show(id)}, and there is no such layer.`);
    } else if (placed.has(id)) {
      problems.add(where, 'duplicate', `${where} is ${show(id)}, which is already in the legend.`);
    } else {
      placed.add(id);
    }
  };
  nodes.forEach((node, index) => {
    const at = place(path, index);
    const type = isRecord(node) ? node['type'] : undefined;
    const fields =
      type === 'group' ? ['type', 'id', 'name', 'collapsed', 'children'] : ['type', 'id'];
    const entry = readRecord(problems, at, node, fields);
    if (entry === undefined) {
      return;
    }
    const kind = readChoice(problems, field(at, 'type'), entry['type'], ['layer', 'group']);
    const id =
      kind === undefined ? undefined : readString(problems, field(at, 'id'), entry['id'], true);
    if (kind === 'layer' && id !== undefined) {
      put(field(at, 'id'), id);
    } else if (kind === 'group') {
      if (id !== undefined && groups.has(id)) {
        problems.add(
          field(at, 'id'),
          'duplicate',
          `${field(at, 'id')} is ${show(id)}, which is already the id of a group.`,
        );
      } else if (id !== undefined && layerIds?.has(id) === true) {
        problems.add(
          field(at, 'id'),
          'consistency',
          `${field(at, 'id')} is ${show(id)}, which is the id of a layer: a group has an id of its own.`,
        );
      } else if (id !== undefined) {
        groups.add(id);
      }
      readString(problems, field(at, 'name'), entry['name']);
      readBoolean(problems, field(at, 'collapsed'), entry['collapsed']);
      const children = readList(problems, field(at, 'children'), entry['children']);
      children?.forEach((child, i) => {
        const where = place(field(at, 'children'), i);
        const childId = readString(problems, where, child, true);
        if (childId !== undefined) {
          put(where, childId);
        }
      });
    }
  });
  for (const id of layerIds ?? []) {
    if (!placed.has(id)) {
      problems.add(
        field('layers', id),
        'consistency',
        `${field('layers', id)} is a layer that is not in the legend.`,
      );
    }
  }
}

/** Checks the selection: none, or a layer that is there and a whole element number from 0. */
export function checkSelection(
  problems: Problems,
  path: string,
  value: unknown,
  layerIds: ReadonlySet<string> | undefined,
): void {
  if (value === null) {
    return;
  }
  const selection = readRecord(problems, path, value, ['layerId', 'element']);
  if (selection === undefined) {
    return;
  }
  const id = readString(problems, field(path, 'layerId'), selection['layerId'], true);
  if (id !== undefined && layerIds !== undefined && !layerIds.has(id)) {
    const where = field(path, 'layerId');
    problems.add(where, 'reference', `${where} is ${show(id)}, and there is no such layer.`);
  }
  readNumber(problems, field(path, 'element'), selection['element'], { integer: true, min: 0 });
}
