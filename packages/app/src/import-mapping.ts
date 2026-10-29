import type { Finding, Kind, Role, TablePreview } from '@karmania/engine';

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

/** The size of a block along each axis, as a person typed it: text, since a number can be half typed. */
export interface BlockSizeDraft {
  readonly x: string;
  readonly y: string;
  readonly z: string;
}

/** No block size yet. */
export const EMPTY_BLOCK_SIZE: BlockSizeDraft = { x: '', y: '', z: '' };

/** What a block's size is, as a number above 0: `10`, `2.5` or `2,5`; anything else is not one. */
export function parseSize(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return undefined;
  }
  const size = Number(trimmed);
  return Number.isFinite(size) && size > 0 ? size : undefined;
}

/** The block size as numbers, if all three are given and usable. */
export function blockSizeOf(size: BlockSizeDraft): readonly [number, number, number] | undefined {
  const [x, y, z] = [parseSize(size.x), parseSize(size.y), parseSize(size.z)];
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
}

/** The roles a mapping needs, for what the file is imported as. */
export const REQUIRED_ROLES: Readonly<Record<Kind, readonly Role[]>> = {
  points: ['x', 'y'],
  lines: ['x', 'y', 'line_id'],
  blocks: ['x', 'y', 'z'],
  polygons: [],
  mesh: [],
  grid: [],
};

/** What each role is called in a sentence. The words are the kernel's, so that both say the same. */
export const ROLE_WORDS: Readonly<Record<Role, string>> = {
  x: 'X (easting or longitude)',
  y: 'Y (northing or latitude)',
  z: 'Z (elevation)',
  line_id: 'the line identifier',
  attribute: 'an attribute',
  ignore: 'ignored',
};

/** What the Mapping step tells a person a kind needs, before anything is wrong. */
export const REQUIREMENTS_NOTE: Readonly<Record<Kind, string>> = {
  points: 'Points need a column for X and one for Y.',
  lines:
    'Lines need a column for X, one for Y and a line identifier: the column that says which line a row belongs to.',
  blocks:
    'A block model needs a column for X, Y and Z, which give the centre of each block, and the size of a block.',
  polygons: '',
  mesh: '',
  grid: '',
};

/** A problem with the mapping that stops it being used, worded as the kernel words it. */
function problem(code: string, message: string, hint: string): Finding {
  return { code, severity: 'error', message, hint, count: 1, examples: [], step: 'mapping' };
}

/**
 * What is wrong with the mapping so far, in the kernel's words (`mapping.*` in
 * docs/validation-codes.md; a test keeps the two the same): a role that is needed and no column has,
 * a role several columns have, and a block size that is missing or cannot be used. The kernel checks
 * the same when the file is imported; this tells a person before.
 */
export function mappingProblems(
  kind: Kind | undefined,
  columns: readonly ColumnDraft[],
  blockSize: BlockSizeDraft,
): readonly Finding[] {
  if (kind === undefined) {
    return [];
  }
  const found: Finding[] = [];
  const needed = REQUIRED_ROLES[kind];
  for (const role of ['x', 'y', 'z', 'line_id'] as const) {
    const holders = columns.filter((column) => column.role === role).length;
    if (holders > 1) {
      found.push(
        problem(
          'mapping.role.duplicate',
          `More than one column is set as ${ROLE_WORDS[role]}.`,
          'Keep one column for this role and set the others to attribute or ignore.',
        ),
      );
    }
    if (holders === 0 && needed.includes(role)) {
      found.push(
        role === 'line_id'
          ? problem(
              'mapping.line_id.missing',
              'No column is set as the line identifier, so rows cannot be grouped into lines.',
              'Choose the column that says which line each row belongs to.',
            )
          : problem(
              'mapping.coordinate.missing',
              `No column is set as ${ROLE_WORDS[role]}.`,
              'Choose the column that holds this coordinate.',
            ),
      );
    }
  }
  if (kind === 'blocks' && blockSizeOf(blockSize) === undefined) {
    const given = [blockSize.x, blockSize.y, blockSize.z].some((text) => text.trim() !== '');
    found.push(
      given
        ? problem(
            'mapping.block_size.invalid',
            `The block size must be greater than 0 in all three directions, but it is ${[blockSize.x, blockSize.y, blockSize.z].map((text) => (text.trim() === '' ? 'empty' : text.trim())).join(' x ')}.`,
            'Use positive numbers, such as 10 for 10-metre blocks.',
          )
        : problem(
            'mapping.block_size.missing',
            'The block size is missing.',
            'Enter the size of a block along X, Y and Z.',
          ),
    );
  }
  return found;
}
