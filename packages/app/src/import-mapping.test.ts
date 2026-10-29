import type { Role, TablePreview } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  blockSizeOf,
  columnsFromPreview,
  EMPTY_BLOCK_SIZE,
  mappingProblems,
  parseSize,
  ROLE_NAMES,
  ROLES_BY_KIND,
  rolesFor,
  withKind,
  withRole,
} from './import-mapping.js';

const table = (header: string[], roles: Role[]): TablePreview => ({
  delimiter: 'comma',
  hasHeader: true,
  header,
  rows: [],
  estimatedRows: 0,
  decimalSeparator: '.',
  columnTypes: header.map(() => 'float'),
  roles: roles.map((role) => ({ role, confidence: role === 'attribute' ? 0.5 : 0.95 })),
  nodata: { tokens: [], numbers: [] },
});

describe('the roles a column can have', () => {
  it('are X, Y, Z, attribute and ignore for points and blocks, and a line identifier too for lines', () => {
    expect(rolesFor('points')).toEqual(['x', 'y', 'z', 'attribute', 'ignore']);
    expect(rolesFor('blocks')).toEqual(['x', 'y', 'z', 'attribute', 'ignore']);
    expect(rolesFor('lines')).toEqual(['x', 'y', 'z', 'line_id', 'attribute', 'ignore']);
  });

  it('are none for what has no columns to map, and when nothing is chosen', () => {
    expect(rolesFor('grid')).toEqual([]);
    expect(rolesFor('mesh')).toEqual([]);
    expect(rolesFor(undefined)).toEqual([]);
  });

  it('are all named, in words short enough for a column header', () => {
    for (const roles of Object.values(ROLES_BY_KIND)) {
      for (const role of roles) {
        expect(ROLE_NAMES[role].length).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('the columns a file starts with', () => {
  it('have the roles the kernel suggested, the coordinates marked as suggestions', () => {
    const columns = columnsFromPreview(
      table(['E', 'N', 'RL', 'Hole'], ['x', 'y', 'z', 'attribute']),
      'points',
    );
    expect(columns).toEqual([
      { source: 'E', role: 'x', suggested: true },
      { source: 'N', role: 'y', suggested: true },
      { source: 'RL', role: 'z', suggested: true },
      { source: 'Hole', role: 'attribute', suggested: false },
    ]);
  });

  it('turn a suggested line identifier into an attribute when the file is not imported as lines', () => {
    const header = ['Line', 'X', 'Y'];
    const roles: Role[] = ['line_id', 'x', 'y'];
    expect(columnsFromPreview(table(header, roles), 'points')[0]).toEqual({
      source: 'Line',
      role: 'attribute',
      suggested: false,
    });
    expect(columnsFromPreview(table(header, roles), 'lines')[0]).toEqual({
      source: 'Line',
      role: 'line_id',
      suggested: true,
    });
  });

  it('are attributes where the kernel had no suggestion for a column', () => {
    expect(columnsFromPreview(table(['A', 'B'], []), 'points').map((c) => c.role)).toEqual([
      'attribute',
      'attribute',
    ]);
  });
});

describe('changing a role', () => {
  it('changes that column only, and it is no longer a suggestion', () => {
    const columns = columnsFromPreview(table(['X', 'Y'], ['x', 'y']), 'points');
    const changed = withRole(columns, 0, 'ignore');
    expect(changed).toEqual([
      { source: 'X', role: 'ignore', suggested: false },
      { source: 'Y', role: 'y', suggested: true },
    ]);
    expect(columns[0]?.role).toBe('x');
  });
});

describe('changing what the file is imported as', () => {
  it('turns a role the new kind has not into an attribute, and leaves the rest alone', () => {
    const columns = columnsFromPreview(table(['Line', 'X', 'Y'], ['line_id', 'x', 'y']), 'lines');
    expect(withKind(columns, 'points')).toEqual([
      { source: 'Line', role: 'attribute', suggested: false },
      { source: 'X', role: 'x', suggested: true },
      { source: 'Y', role: 'y', suggested: true },
    ]);
    expect(withKind(columns, 'blocks')[0]?.role).toBe('attribute');
    expect(withKind(columns, 'lines')).toEqual(columns);
  });
});

describe('a block size as a person types it', () => {
  it('is a number above 0, with a point or a comma for the decimals', () => {
    expect(parseSize('10')).toBe(10);
    expect(parseSize(' 2.5 ')).toBe(2.5);
    expect(parseSize('2,5')).toBe(2.5);
    expect(parseSize('.5')).toBe(0.5);
    expect(parseSize('10.')).toBe(10);
  });

  it('is not nothing, zero, negative, or anything that is not a plain number', () => {
    for (const text of [
      '',
      ' ',
      '0',
      '0.0',
      '-5',
      '1e3',
      '10 m',
      'ten',
      '1,000.5',
      '1.2.3',
      'NaN',
      'Infinity',
    ]) {
      expect(parseSize(text), text).toBeUndefined();
    }
  });

  it('is all three sizes, or none', () => {
    expect(blockSizeOf({ x: '10', y: '10', z: '5' })).toEqual([10, 10, 5]);
    expect(blockSizeOf({ x: '10', y: '10', z: '' })).toBeUndefined();
    expect(blockSizeOf(EMPTY_BLOCK_SIZE)).toBeUndefined();
  });
});

const columnsOf = (...roles: Role[]) =>
  roles.map((role, index) => ({ source: `C${String(index)}`, role, suggested: false }));

const codes = (problems: readonly { code: string }[]): string[] => problems.map((p) => p.code);

describe('what is wrong with a mapping', () => {
  it('is nothing for points that have an X and a Y, whatever else they have', () => {
    expect(
      mappingProblems('points', columnsOf('x', 'y', 'attribute', 'ignore'), EMPTY_BLOCK_SIZE),
    ).toEqual([]);
    expect(mappingProblems('points', columnsOf('x', 'y', 'z'), EMPTY_BLOCK_SIZE)).toEqual([]);
  });

  it('says which coordinate no column is set as', () => {
    const found = mappingProblems('points', columnsOf('attribute', 'y'), EMPTY_BLOCK_SIZE);
    expect(codes(found)).toEqual(['mapping.coordinate.missing']);
    expect(found[0]?.message).toBe('No column is set as X (easting or longitude).');
    expect(
      codes(mappingProblems('points', columnsOf('attribute', 'attribute'), EMPTY_BLOCK_SIZE)),
    ).toEqual(['mapping.coordinate.missing', 'mapping.coordinate.missing']);
  });

  it('needs a line identifier for lines, and no Z', () => {
    expect(codes(mappingProblems('lines', columnsOf('x', 'y'), EMPTY_BLOCK_SIZE))).toEqual([
      'mapping.line_id.missing',
    ]);
    expect(mappingProblems('lines', columnsOf('x', 'y', 'line_id'), EMPTY_BLOCK_SIZE)).toEqual([]);
  });

  it('needs a Z for a block model, and a block size', () => {
    expect(
      codes(mappingProblems('blocks', columnsOf('x', 'y'), { x: '10', y: '10', z: '5' })),
    ).toEqual(['mapping.coordinate.missing']);
    expect(codes(mappingProblems('blocks', columnsOf('x', 'y', 'z'), EMPTY_BLOCK_SIZE))).toEqual([
      'mapping.block_size.missing',
    ]);
    expect(
      mappingProblems('blocks', columnsOf('x', 'y', 'z'), { x: '10', y: '10', z: '5' }),
    ).toEqual([]);
  });

  it('says what is wrong with a block size that is given but cannot be used', () => {
    const found = mappingProblems('blocks', columnsOf('x', 'y', 'z'), { x: '10', y: '0', z: '' });
    expect(codes(found)).toEqual(['mapping.block_size.invalid']);
    expect(found[0]?.message).toBe(
      'The block size must be greater than 0 in all three directions, but it is 10 x 0 x empty.',
    );
  });

  it('says when a role has more than one column', () => {
    const found = mappingProblems('points', columnsOf('x', 'x', 'y'), EMPTY_BLOCK_SIZE);
    expect(codes(found)).toEqual(['mapping.role.duplicate']);
    expect(found[0]?.message).toBe('More than one column is set as X (easting or longitude).');
  });

  it('is all errors, for the mapping step, each with a hint', () => {
    const found = mappingProblems('blocks', columnsOf('x', 'x'), EMPTY_BLOCK_SIZE);
    expect(found.length).toBeGreaterThan(2);
    for (const finding of found) {
      expect([finding.severity, finding.step, finding.count]).toEqual(['error', 'mapping', 1]);
      expect(finding.hint).not.toBe('');
    }
  });

  it('is nothing when there is no choice of kind, or nothing to map', () => {
    expect(mappingProblems(undefined, [], EMPTY_BLOCK_SIZE)).toEqual([]);
    expect(mappingProblems('grid', [], EMPTY_BLOCK_SIZE)).toEqual([]);
  });
});
