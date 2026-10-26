/**
 * Strict runtime checks that a value from the kernel has the shape of a public
 * type. They exist for tests: they reject unknown keys, so a field added on the
 * Rust side without a matching TypeScript type fails a test instead of passing
 * unnoticed. Each function returns the value with its type, or throws an error
 * that says where the mismatch is.
 */

import {
  CHECK_GROUPS,
  SEVERITIES,
  WIZARD_STEPS,
  type Finding,
  type Location,
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
