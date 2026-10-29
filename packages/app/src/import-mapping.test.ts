import type { Role, TablePreview } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import {
  columnsFromPreview,
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
