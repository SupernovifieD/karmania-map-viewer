/**
 * Strict runtime checks that a value from the kernel has the shape of a public
 * type. They exist for tests: they reject unknown keys, so a field added on the
 * Rust side without a matching TypeScript type fails a test instead of passing
 * unnoticed. Each function returns the value with its type, or throws an error
 * that says where the mismatch is.
 */

import {
  CHECK_GROUPS,
  COLUMN_TYPES,
  CRS_SOURCES,
  DELIMITERS,
  FORMATS,
  KINDS,
  ROLES,
  SEVERITIES,
  WIZARD_STEPS,
  type CrsRef,
  type DetectedCrs,
  type Finding,
  type Location,
  type NodataSuggestions,
  type Preview,
  type RoleSuggestion,
  type TablePreview,
  type ValidationReport,
} from './types.js';

/** Thrown when a value does not have the shape of its type. */
export class ContractError extends Error {
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = 'ContractError';
  }
}

/** An object whose keys are all in `required` or `optional`, and which has every required key. */
export function checkedObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractError(path, 'expected an object');
  }
  const record = value as Record<string, unknown>;
  for (const key of required) {
    if (!(key in record)) throw new ContractError(path, `missing "${key}"`);
  }
  for (const key of Object.keys(record)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new ContractError(path, `unexpected "${key}"`);
    }
    // A key that is present must hold a value: optional means absent, not undefined.
    if (record[key] === undefined) throw new ContractError(path, `"${key}" is undefined`);
  }
  return record;
}

/** A finite whole number that is not negative. */
export function checkedCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ContractError(path, 'expected a whole number, 0 or more');
  }
  return value;
}

export function checkedString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ContractError(path, 'expected a string');
  return value;
}

export function checkedArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ContractError(path, 'expected an array');
  return value;
}

export function checkedLocation(value: unknown, path: string): Location {
  const o = checkedObject(value, path, [], ['line', 'row', 'element', 'vertex', 'column', 'cell']);
  for (const key of ['line', 'row', 'element', 'vertex']) {
    if (key in o) checkedCount(o[key], `${path}.${key}`);
  }
  if ('column' in o) checkedString(o['column'], `${path}.column`);
  if ('cell' in o) {
    const cell = checkedArray(o['cell'], `${path}.cell`);
    if (cell.length !== 3) throw new ContractError(`${path}.cell`, 'expected [i, j, k]');
    cell.forEach((n, i) => checkedCount(n, `${path}.cell[${String(i)}]`));
  }
  return o;
}

export function checkedFinding(value: unknown, path: string): Finding {
  const o = checkedObject(
    value,
    path,
    ['code', 'severity', 'message', 'count', 'examples'],
    ['hint', 'step'],
  );
  const code = checkedString(o['code'], `${path}.code`);
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(code)) {
    throw new ContractError(`${path}.code`, `"${code}" is not a dotted lowercase code`);
  }
  if (!(SEVERITIES as readonly unknown[]).includes(o['severity'])) {
    throw new ContractError(`${path}.severity`, 'expected error, warning or info');
  }
  if (checkedString(o['message'], `${path}.message`).trim() === '') {
    throw new ContractError(`${path}.message`, 'is empty');
  }
  if (checkedCount(o['count'], `${path}.count`) < 1) {
    throw new ContractError(`${path}.count`, 'is below 1');
  }
  if ('hint' in o) checkedString(o['hint'], `${path}.hint`);
  if ('step' in o && !(WIZARD_STEPS as readonly unknown[]).includes(o['step'])) {
    throw new ContractError(`${path}.step`, 'expected file, mapping, nodata or crs');
  }
  const examples = checkedArray(o['examples'], `${path}.examples`);
  if (examples.length > 20) throw new ContractError(`${path}.examples`, 'more than 20');
  examples.forEach((e, i) => checkedLocation(e, `${path}.examples[${String(i)}]`));
  return o as unknown as Finding;
}

export function checkedValidationReport(value: unknown, path = 'report'): ValidationReport {
  const o = checkedObject(value, path, ['groups']);
  const groups = checkedArray(o['groups'], `${path}.groups`);
  if (groups.length !== CHECK_GROUPS.length) {
    throw new ContractError(`${path}.groups`, 'expected the three groups');
  }
  groups.forEach((group, i) => {
    const gpath = `${path}.groups[${String(i)}]`;
    const g = checkedObject(group, gpath, ['name', 'findings']);
    if (g['name'] !== CHECK_GROUPS[i]) {
      throw new ContractError(`${gpath}.name`, `expected ${CHECK_GROUPS[i] ?? ''}`);
    }
    checkedArray(g['findings'], `${gpath}.findings`).forEach((f, j) => {
      checkedFinding(f, `${gpath}.findings[${String(j)}]`);
    });
  });
  return o as unknown as ValidationReport;
}

/** A string that is one of `allowed`. */
export function checkedOneOf(value: unknown, path: string, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ContractError(path, `expected one of ${allowed.join(', ')}`);
  }
  return value;
}

/** A finite number. */
export function checkedNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractError(path, 'expected a finite number');
  }
  return value;
}

export function checkedCrs(value: unknown, path: string): CrsRef {
  const kind = checkedObject(value, path, ['kind'], ['code', 'units'])['kind'];
  if (kind === 'epsg') {
    const o = checkedObject(value, path, ['kind', 'code']);
    if (checkedCount(o['code'], `${path}.code`) < 1) throw new ContractError(path, 'code below 1');
    return o as unknown as CrsRef;
  }
  if (kind === 'local') {
    const o = checkedObject(value, path, ['kind', 'units']);
    checkedOneOf(o['units'], `${path}.units`, ['m', 'ft', 'us_ft']);
    return o as unknown as CrsRef;
  }
  throw new ContractError(`${path}.kind`, 'expected epsg or local');
}

export function checkedDetectedCrs(value: unknown, path: string): DetectedCrs {
  const o = checkedObject(value, path, ['crs', 'source']);
  checkedCrs(o['crs'], `${path}.crs`);
  checkedOneOf(o['source'], `${path}.source`, CRS_SOURCES);
  return o as unknown as DetectedCrs;
}

function checkedRoleSuggestion(value: unknown, path: string): RoleSuggestion {
  const o = checkedObject(value, path, ['role', 'confidence']);
  checkedOneOf(o['role'], `${path}.role`, ROLES);
  const confidence = checkedNumber(o['confidence'], `${path}.confidence`);
  if (confidence < 0 || confidence > 1) throw new ContractError(path, 'confidence outside 0 to 1');
  return o as unknown as RoleSuggestion;
}

function checkedNodata(value: unknown, path: string): NodataSuggestions {
  const o = checkedObject(value, path, ['tokens', 'numbers']);
  checkedArray(o['tokens'], `${path}.tokens`).forEach((t, i) => {
    const entry = checkedObject(t, `${path}.tokens[${String(i)}]`, ['token', 'count']);
    checkedString(entry['token'], `${path}.tokens[${String(i)}].token`);
    checkedCount(entry['count'], `${path}.tokens[${String(i)}].count`);
  });
  checkedArray(o['numbers'], `${path}.numbers`).forEach((n, i) => {
    const entry = checkedObject(n, `${path}.numbers[${String(i)}]`, ['value', 'count']);
    checkedNumber(entry['value'], `${path}.numbers[${String(i)}].value`);
    checkedCount(entry['count'], `${path}.numbers[${String(i)}].count`);
  });
  return o as unknown as NodataSuggestions;
}

export function checkedTablePreview(value: unknown, path: string): TablePreview {
  const o = checkedObject(value, path, [
    'delimiter',
    'hasHeader',
    'header',
    'rows',
    'estimatedRows',
    'decimalSeparator',
    'columnTypes',
    'roles',
    'nodata',
  ]);
  checkedOneOf(o['delimiter'], `${path}.delimiter`, DELIMITERS);
  if (typeof o['hasHeader'] !== 'boolean')
    throw new ContractError(`${path}.hasHeader`, 'expected a boolean');
  const header = checkedArray(o['header'], `${path}.header`);
  header.forEach((h, i) => checkedString(h, `${path}.header[${String(i)}]`));
  checkedArray(o['rows'], `${path}.rows`).forEach((row, i) => {
    checkedArray(row, `${path}.rows[${String(i)}]`).forEach((cell, j) => {
      checkedString(cell, `${path}.rows[${String(i)}][${String(j)}]`);
    });
  });
  checkedCount(o['estimatedRows'], `${path}.estimatedRows`);
  checkedOneOf(o['decimalSeparator'], `${path}.decimalSeparator`, ['.', ',']);
  const types = checkedArray(o['columnTypes'], `${path}.columnTypes`);
  types.forEach((t, i) => checkedOneOf(t, `${path}.columnTypes[${String(i)}]`, COLUMN_TYPES));
  const roles = checkedArray(o['roles'], `${path}.roles`);
  roles.forEach((r, i) => checkedRoleSuggestion(r, `${path}.roles[${String(i)}]`));
  if (types.length !== header.length || roles.length !== header.length) {
    throw new ContractError(path, 'types and roles must have one entry per column');
  }
  checkedNodata(o['nodata'], `${path}.nodata`);
  return o as unknown as TablePreview;
}

export function checkedPreview(value: unknown, path = 'preview'): Preview {
  const o = checkedObject(
    value,
    path,
    ['fileName', 'findings'],
    ['format', 'suggestedKind', 'encoding', 'table', 'crs'],
  );
  checkedString(o['fileName'], `${path}.fileName`);
  if ('format' in o) checkedOneOf(o['format'], `${path}.format`, FORMATS);
  if ('suggestedKind' in o) checkedOneOf(o['suggestedKind'], `${path}.suggestedKind`, KINDS);
  if ('encoding' in o) {
    checkedOneOf(o['encoding'], `${path}.encoding`, [
      'UTF-8',
      'UTF-16 LE',
      'UTF-16 BE',
      'Windows-1252',
    ]);
  }
  if ('table' in o) checkedTablePreview(o['table'], `${path}.table`);
  if ('crs' in o) checkedDetectedCrs(o['crs'], `${path}.crs`);
  checkedArray(o['findings'], `${path}.findings`).forEach((f, i) => {
    checkedFinding(f, `${path}.findings[${String(i)}]`);
  });
  if (!('format' in o) && !(o['findings'] as readonly unknown[]).length) {
    throw new ContractError(path, 'no format and no finding to say why');
  }
  return o as unknown as Preview;
}
