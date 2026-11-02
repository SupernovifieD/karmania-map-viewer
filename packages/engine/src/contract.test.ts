import { describe, expect, it } from 'vitest';
import {
  ContractError,
  checkedCrsInfo,
  checkedCrsInfoList,
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

describe('checkedCrsInfo rejects what is not the contract', () => {
  const utm = {
    code: 32640,
    name: 'WGS 84 / UTM zone 40N',
    kind: 'projected',
    units: 'm',
    metresPerUnit: 1,
  };
  const wgs84 = { code: 4326, name: 'WGS 84', kind: 'geographic', units: 'degree' };

  it('accepts a system with its metres and one without', () => {
    expect(checkedCrsInfo(utm, 'c').code).toBe(32640);
    expect(checkedCrsInfo(wgs84, 'c').units).toBe('degree');
    expect(
      checkedCrsInfo({ code: 3993, name: 'EPSG:3993', kind: 'other', units: 'other' }, 'c').kind,
    ).toBe('other');
    expect(checkedCrsInfo({ ...utm, units: 'us_ft', metresPerUnit: 1200 / 3937 }, 'c').units).toBe(
      'us_ft',
    );
  });

  it('rejects a field Rust added without a TypeScript type, and one that is undefined', () => {
    expect(() => checkedCrsInfo({ ...utm, extra: 1 }, 'c')).toThrow('unexpected "extra"');
    expect(() => checkedCrsInfo({ ...wgs84, metresPerUnit: undefined }, 'c')).toThrow(
      '"metresPerUnit" is undefined',
    );
  });

  it('rejects wrong values, naming where they are', () => {
    const cases: [object, string][] = [
      [{ ...utm, code: -1 }, 'c.code'],
      [{ ...utm, code: 4326.5 }, 'c.code'],
      [{ ...utm, name: ' ' }, 'c.name'],
      [{ ...utm, name: 7 }, 'c.name'],
      [{ ...utm, kind: 'cartesian' }, 'c.kind'],
      [{ ...utm, units: 'km' }, 'c.units'],
      [{ ...utm, metresPerUnit: 0 }, 'c.metresPerUnit'],
      [{ ...utm, metresPerUnit: -1 }, 'c.metresPerUnit'],
      [{ ...utm, metresPerUnit: Number.NaN }, 'c.metresPerUnit'],
    ];
    for (const [bad, where] of cases) {
      expect(() => checkedCrsInfo(bad, 'c')).toThrow(where);
    }
    const withoutName = Object.fromEntries(Object.entries(utm).filter(([key]) => key !== 'name'));
    expect(() => checkedCrsInfo(withoutName, 'c')).toThrow('missing "name"');
    expect(() => checkedCrsInfo(null, 'c')).toThrow('expected an object');
  });

  it('holds to what the definitions keep true about metres and degrees', () => {
    // Metres and feet have their metres, and nothing else has.
    const withoutMetres = Object.fromEntries(
      Object.entries(utm).filter(([key]) => key !== 'metresPerUnit'),
    );
    expect(() => checkedCrsInfo(withoutMetres, 'c')).toThrow('has its metresPerUnit');
    expect(() => checkedCrsInfo({ ...wgs84, metresPerUnit: 111_000 }, 'c')).toThrow(
      'has no metresPerUnit',
    );
    expect(() => checkedCrsInfo({ ...utm, units: 'other' }, 'c')).toThrow('has no metresPerUnit');
    // Degrees belong to a geographic system.
    expect(() => checkedCrsInfo({ ...wgs84, kind: 'projected' }, 'c')).toThrow(
      'degrees belong to a geographic system',
    );
  });

  it('checks every entry of a list, and says which one is wrong', () => {
    expect(checkedCrsInfoList([utm, wgs84], 'l')).toHaveLength(2);
    expect(checkedCrsInfoList([], 'l')).toEqual([]);
    expect(() => checkedCrsInfoList([utm, { ...wgs84, kind: 'x' }], 'l')).toThrow('l[1].kind');
    expect(() => checkedCrsInfoList({}, 'l')).toThrow('expected an array');
  });
});
