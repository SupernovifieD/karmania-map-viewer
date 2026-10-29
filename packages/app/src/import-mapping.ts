import type { Kind, Role, TablePreview } from '@karmania/engine';

/** What a person has decided about one column of the file. */
export interface ColumnDraft {
  /** The column's name in the file. */
  readonly source: string;
  readonly role: Role;
  /** Whether the role is what the kernel suggested and nobody has changed since. */
  readonly suggested: boolean;
}

/** What each role is called in a column's selector: short, because the room in a header is. */
export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
  line_id: 'Line ID',
  attribute: 'Attribute',
  ignore: 'Ignore',
};

/**
 * The roles a column can have in a file that is imported as each kind. Only a file with columns
 * (CSV) is mapped, so only the kinds a CSV file can be have any. The line identifier is for lines.
 */
export const ROLES_BY_KIND: Readonly<Record<Kind, readonly Role[]>> = {
  points: ['x', 'y', 'z', 'attribute', 'ignore'],
  lines: ['x', 'y', 'z', 'line_id', 'attribute', 'ignore'],
  blocks: ['x', 'y', 'z', 'attribute', 'ignore'],
  polygons: [],
  mesh: [],
  grid: [],
};

/** The roles a column can have, for what the file is imported as. */
export function rolesFor(kind: Kind | undefined): readonly Role[] {
  return kind === undefined ? [] : ROLES_BY_KIND[kind];
}

/**
 * The columns of a file as the kernel suggests them: each with the role it suggested, if a person can
 * give that role to a column of this kind, and an attribute otherwise. A role that is not an
 * attribute is marked as suggested.
 */
export function columnsFromPreview(
  table: TablePreview,
  kind: Kind | undefined,
): readonly ColumnDraft[] {
  const allowed = rolesFor(kind);
  return table.header.map((source, index) => {
    const suggestion = table.roles[index]?.role;
    const role =
      suggestion !== undefined && allowed.includes(suggestion) ? suggestion : 'attribute';
    return { source, role, suggested: role !== 'attribute' };
  });
}

/** The columns with the role of one of them changed by a person: it is no longer a suggestion. */
export function withRole(
  columns: readonly ColumnDraft[],
  index: number,
  role: Role,
): readonly ColumnDraft[] {
  return columns.map((column, at) =>
    at === index ? { source: column.source, role, suggested: false } : column,
  );
}

/**
 * The columns after what the file is imported as has changed: a column with a role that the new kind
 * does not have (a line identifier, once the lines are points) becomes an attribute.
 */
export function withKind(
  columns: readonly ColumnDraft[],
  kind: Kind | undefined,
): readonly ColumnDraft[] {
  const allowed = rolesFor(kind);
  return columns.map((column) =>
    allowed.includes(column.role)
      ? column
      : { source: column.source, role: 'attribute', suggested: false },
  );
}
