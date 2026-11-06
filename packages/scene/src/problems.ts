/**
 * What `validateScene` finds wrong with a document that an embedder passed in, and the small checks it is made of.
 * A document is data, so a problem is a value in a list and never a thrown error (throwing is for misuse).
 */

/** What kind of fault a problem is, for a program to tell apart; the message is for a person. */
export const PROBLEM_CODES = [
  'not_an_object',
  'missing',
  'unknown_field',
  'type',
  'range',
  'choice',
  'version',
  'reference',
  'duplicate',
  'consistency',
  'too_many',
] as const;

/** `missing` and `unknown_field` are about fields, `type`, `range` and `choice` about a value, `reference`, `duplicate` and `consistency` about how the parts fit. */
export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** One fault in a scene document. */
export interface SceneProblem {
  /** Where, as in `layers.layer-1.style.opacity` or `legend[1].children[0]`; empty for the document as a whole. */
  readonly path: string;
  readonly code: ProblemCode;
  /** In plain words, naming the path and what was found. */
  readonly message: string;
}

/** The most problems listed; the rest are counted in one last problem, so a bad document cannot make a huge list. */
export const MAX_PROBLEMS = 100;

/** Collects problems up to `MAX_PROBLEMS`. */
export class Problems {
  readonly #list: SceneProblem[] = [];
  #omitted = 0;

  /** Notes one problem. */
  add(path: string, code: ProblemCode, message: string): void {
    if (this.#list.length < MAX_PROBLEMS) {
      this.#list.push({ path, code, message });
    } else {
      this.#omitted += 1;
    }
  }

  /** The problems so far, and a last one that counts those that did not fit. */
  finish(): readonly SceneProblem[] {
    if (this.#omitted === 0) {
      return [...this.#list];
    }
    const more = `${String(this.#omitted)} more problems are not listed.`;
    return [...this.#list, { path: '', code: 'too_many', message: more }];
  }
}

/** The way a path is written: `layers.x` for a field, `legend[1]` for a place in a list. */
export function field(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/** See {@link field}. */
export function place(path: string, index: number): string {
  return `${path}[${String(index)}]`;
}

/** Whether `value` is an object made of fields (not a list, not a class instance, not null). */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** What was found, in a few words, for a message. */
export function show(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
    case 'number':
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'object':
      if (value === null) {
        return 'null';
      }
      return Array.isArray(value) ? 'a list' : 'an object';
    default:
      return `a ${typeof value}`;
  }
}

function named(path: string): string {
  return path === '' ? 'The document' : path;
}

/** The limits a number is held to; `above` and `below` leave the limit out, `min` and `max` keep it. */
export interface NumberRule {
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly above?: number;
  readonly below?: number;
}

function describeRule(rule: NumberRule): string {
  const parts = [rule.integer === true ? 'a whole number' : 'a number'];
  if (rule.min !== undefined && rule.max !== undefined) {
    parts.push(`from ${String(rule.min)} to ${String(rule.max)}`);
  } else if (rule.min !== undefined) {
    parts.push(`of ${String(rule.min)} or more`);
  } else if (rule.max !== undefined) {
    parts.push(`of ${String(rule.max)} or less`);
  }
  if (rule.above !== undefined) {
    parts.push(`above ${String(rule.above)}`);
  }
  if (rule.below !== undefined) {
    parts.push(`${rule.above === undefined ? '' : 'and '}below ${String(rule.below)}`);
  }
  return parts.join(' ');
}

function within(value: number, rule: NumberRule): boolean {
  return (
    (rule.integer !== true || Number.isInteger(value)) &&
    (rule.min === undefined || value >= rule.min) &&
    (rule.max === undefined || value <= rule.max) &&
    (rule.above === undefined || value > rule.above) &&
    (rule.below === undefined || value < rule.below)
  );
}

/** A finite number held to `rule`; says what is wrong and gives `undefined` if not. A missing value is `missing`. */
export function readNumber(
  problems: Problems,
  path: string,
  value: unknown,
  rule: NumberRule = {},
): number | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(
      path,
      'type',
      `${named(path)} must be ${describeRule(rule)}, and it is ${show(value)}.`,
    );
    return undefined;
  }
  if (!within(value, rule)) {
    problems.add(
      path,
      'range',
      `${named(path)} must be ${describeRule(rule)}, and it is ${String(value)}.`,
    );
    return undefined;
  }
  return value;
}

/** A string; with `nonEmpty` not the empty string. */
export function readString(
  problems: Problems,
  path: string,
  value: unknown,
  nonEmpty = false,
): string | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    problems.add(path, 'type', `${named(path)} must be text, and it is ${show(value)}.`);
    return undefined;
  }
  if (nonEmpty && value === '') {
    problems.add(path, 'range', `${named(path)} must not be empty.`);
    return undefined;
  }
  return value;
}

/** A true or false. */
export function readBoolean(problems: Problems, path: string, value: unknown): boolean | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  if (typeof value !== 'boolean') {
    problems.add(path, 'type', `${named(path)} must be true or false, and it is ${show(value)}.`);
    return undefined;
  }
  return value;
}

/** One of `choices`. */
export function readChoice<T extends string | number>(
  problems: Problems,
  path: string,
  value: unknown,
  choices: readonly T[],
): T | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  const found = choices.find((choice) => choice === value);
  if (found === undefined) {
    const list = choices.map((choice) => JSON.stringify(choice)).join(', ');
    problems.add(
      path,
      'choice',
      `${named(path)} must be one of ${list}, and it is ${show(value)}.`,
    );
  }
  return found;
}

/** A list of exactly `length` numbers, each held to `rule`. */
export function readNumbers(
  problems: Problems,
  path: string,
  value: unknown,
  length: number,
  rule: NumberRule = {},
): readonly number[] | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== length) {
    const found = Array.isArray(value) ? `a list of ${String(value.length)}` : show(value);
    problems.add(
      path,
      'type',
      `${named(path)} must be a list of ${String(length)} numbers, and it is ${found}.`,
    );
    return undefined;
  }
  // A copy with no holes: `map` and `forEach` skip the holes of a list such as `new Array(3)`, and a hole is a number that is missing.
  const items = Array.from<unknown>(value);
  const numbers = items.map((item, index) => readNumber(problems, place(path, index), item, rule));
  const valid = numbers.filter((number): number is number => number !== undefined);
  return valid.length === numbers.length ? valid : undefined;
}

/** An object: gives its fields, or says that it is missing or not an object and gives `undefined`. */
function readObject(
  problems: Problems,
  path: string,
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  if (!isRecord(value)) {
    problems.add(
      path,
      'not_an_object',
      `${named(path)} must be an object, and it is ${show(value)}.`,
    );
    return undefined;
  }
  return value;
}

/**
 * An object whose fields are among `allowed`: a field that is not is a problem of its own (a typo is not
 * silently ignored). Gives the fields, or `undefined` if the value is not an object.
 */
export function readRecord(
  problems: Problems,
  path: string,
  value: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  const fields = readObject(problems, path, value);
  if (fields === undefined) {
    return undefined;
  }
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) {
      problems.add(
        field(path, key),
        'unknown_field',
        `${field(path, key)} is not a field of ${path === '' ? 'the document' : path}.`,
      );
    }
  }
  return fields;
}

/**
 * An object whose keys can be anything (layers by their id): gives the fields, or `undefined` if the value is not an
 * object. It does not look each key up in a list of the keys, which would take a time in proportion to the square of them.
 */
export function readMap(
  problems: Problems,
  path: string,
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return readObject(problems, path, value);
}

/** A list of anything: gives its items, or `undefined` if the value is not a list. */
export function readList(
  problems: Problems,
  path: string,
  value: unknown,
): readonly unknown[] | undefined {
  if (value === undefined) {
    problems.add(path, 'missing', `${named(path)} is missing.`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    problems.add(path, 'type', `${named(path)} must be a list, and it is ${show(value)}.`);
    return undefined;
  }
  // A copy with no holes, so that going through the items reaches every place, and a place that is empty is a thing that is missing.
  return Array.from<unknown>(value);
}
