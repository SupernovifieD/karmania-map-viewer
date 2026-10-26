import { describe, expect, it } from 'vitest';
import {
  ContractError,
  checkedFinding,
  checkedLocation,
  checkedValidationReport,
} from './contract-check.js';
// The reports Rust wrote for the validation snapshot tests: real kernel output.
import blocks from '../../../crates/karmania-core/src/validate/snapshots/blocks.json';
import clean from '../../../crates/karmania-core/src/validate/snapshots/clean.json';
import grid from '../../../crates/karmania-core/src/validate/snapshots/grid.json';
import lines from '../../../crates/karmania-core/src/validate/snapshots/lines.json';
import mesh from '../../../crates/karmania-core/src/validate/snapshots/mesh.json';
import points from '../../../crates/karmania-core/src/validate/snapshots/points.json';
import polygons from '../../../crates/karmania-core/src/validate/snapshots/polygons.json';

const SNAPSHOTS: Readonly<Record<string, unknown>> = {
  blocks,
  clean,
  grid,
  lines,
  mesh,
  points,
  polygons,
};

describe('reports written by the Rust kernel', () => {
  for (const [name, report] of Object.entries(SNAPSHOTS)) {
    it(`the ${name} report has the shape of ValidationReport`, () => {
      const checked = checkedValidationReport(report, name);
      expect(checked.groups.map((g) => g.name)).toEqual(['structure', 'values', 'crs']);
    });
  }

  it('together they use every optional field and every severity', () => {
    const findings = Object.entries(SNAPSHOTS).flatMap(([name, report]) =>
      checkedValidationReport(report, name).groups.flatMap((g) => g.findings),
    );
    expect(new Set(findings.map((f) => f.severity))).toEqual(new Set(['error', 'warning', 'info']));
    expect(findings.some((f) => f.hint !== undefined)).toBe(true);
    expect(findings.some((f) => f.step !== undefined)).toBe(true);
    const keys = new Set(findings.flatMap((f) => f.examples.flatMap((e) => Object.keys(e))));
    expect(keys.has('element') && keys.has('vertex') && keys.has('cell')).toBe(true);
  });
});

describe('the checks reject what is not the contract', () => {
  const finding = {
    code: 'crs.missing',
    severity: 'error',
    message: 'The coordinate reference system is missing.',
    count: 1,
    examples: [],
  };

  it('accepts a minimal finding and one with every field', () => {
    expect(checkedFinding(finding, 'f').code).toBe('crs.missing');
    const full = {
      ...finding,
      hint: 'Choose one.',
      step: 'crs',
      examples: [{ line: 3, row: 2, element: 1, vertex: 0, column: 'X', cell: [1, 2, 3] }],
    };
    expect(checkedFinding(full, 'f').examples).toHaveLength(1);
  });

  it('rejects a field Rust added without a TypeScript type', () => {
    expect(() => checkedFinding({ ...finding, extra: 1 }, 'f')).toThrow('unexpected "extra"');
    expect(() => checkedLocation({ nope: 1 }, 'l')).toThrow(ContractError);
  });

  it('rejects wrong values, naming where they are', () => {
    const cases: [object, string][] = [
      [{ ...finding, severity: 'fatal' }, 'f.severity'],
      [{ ...finding, step: 'review' }, 'f.step'],
      [{ ...finding, count: 0 }, 'f.count'],
      [{ ...finding, count: 1.5 }, 'f.count'],
      [{ ...finding, message: '  ' }, 'f.message'],
      [{ ...finding, code: 'Crs Missing' }, 'f.code'],
      [{ ...finding, code: 'nodots' }, 'f.code'],
      [{ ...finding, hint: undefined }, 'f'],
      [{ ...finding, examples: Array.from({ length: 21 }, () => ({})) }, 'f.examples'],
      [{ ...finding, examples: [{ cell: [1, 2] }] }, 'f.examples[0].cell'],
      [{ ...finding, examples: [{ line: -1 }] }, 'f.examples[0].line'],
    ];
    for (const [bad, where] of cases) {
      expect(() => checkedFinding(bad, 'f')).toThrow(where);
    }
    const withoutCount = Object.fromEntries(
      Object.entries(finding).filter(([key]) => key !== 'count'),
    );
    expect(() => checkedFinding(withoutCount, 'f')).toThrow('missing "count"');
  });

  it('rejects a report with the wrong groups', () => {
    expect(() => checkedValidationReport({ groups: [] })).toThrow('three groups');
    const swapped = {
      groups: [
        { name: 'values', findings: [] },
        { name: 'structure', findings: [] },
        { name: 'crs', findings: [] },
      ],
    };
    expect(() => checkedValidationReport(swapped)).toThrow('expected structure');
  });
});
