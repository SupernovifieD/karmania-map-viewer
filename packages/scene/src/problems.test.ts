import { describe, expect, it } from 'vitest';
import {
  MAX_PROBLEMS,
  Problems,
  field,
  isRecord,
  place,
  readBoolean,
  readChoice,
  readList,
  readMap,
  readNumber,
  readNumbers,
  readRecord,
  readString,
  show,
} from './problems.js';

/** What a check says about `value`: what it gave back, and the problems it noted. */
function run<T>(check: (problems: Problems) => T): { value: T; problems: readonly string[] } {
  const problems = new Problems();
  const value = check(problems);
  return { value, problems: problems.finish().map((p) => `${p.code} ${p.path}: ${p.message}`) };
}

describe('the checks a scene document is validated with', () => {
  it('writes paths with a dot for a field and brackets for a place in a list', () => {
    expect(field('', 'camera2d')).toBe('camera2d');
    expect(field('camera2d', 'heading')).toBe('camera2d.heading');
    expect(place('legend', 1)).toBe('legend[1]');
    expect(field(place('legend', 1), 'children')).toBe('legend[1].children');
  });

  it('tells an object of fields from a list, null, a number and a class instance', () => {
    expect([{}, { a: 1 }, Object.create(null)].map(isRecord)).toEqual([true, true, true]);
    expect([[], null, 3, 'x', new Date(0), new Map()].map(isRecord)).toEqual(Array(6).fill(false));
  });

  it('shows what was found in few words, and cuts a long text', () => {
    expect([1.5, NaN, true, undefined, null, [1], {}, () => 0].map(show)).toEqual([
      '1.5',
      'NaN',
      'true',
      'undefined',
      'null',
      'a list',
      'an object',
      'a function',
    ]);
    expect(show('x'.repeat(60))).toBe(`"${'x'.repeat(40)}…"`);
  });

  it('accepts a number that is within its limits and gives it back', () => {
    expect(run((p) => readNumber(p, 'a', 0.5, { min: 0, max: 1 }))).toEqual({
      value: 0.5,
      problems: [],
    });
    expect(run((p) => readNumber(p, 'a', 1, { min: 0, max: 1 })).value).toBe(1);
    expect(run((p) => readNumber(p, 'a', -3)).value).toBe(-3);
    // `min` and `max` keep their limit, `above` and `below` leave it out.
    expect(run((p) => readNumber(p, 'a', 0, { min: 0, max: 1 })).problems).toEqual([]);
    expect(run((p) => readNumber(p, 'a', 0, { above: 0 })).problems).toHaveLength(1);
    expect(run((p) => readNumber(p, 'a', 180, { below: 180 })).problems).toHaveLength(1);
    expect(run((p) => readNumber(p, 'a', 5, { integer: true, min: 5 })).problems).toEqual([]);
  });

  it('says what a number must be when it is not, by what is wrong with it', () => {
    const rule = { above: 0, below: 180 };
    expect(run((p) => readNumber(p, 'camera3d.fov', 0, rule)).problems).toEqual([
      'range camera3d.fov: camera3d.fov must be a number above 0 and below 180, and it is 0.',
    ]);
    expect(
      run((p) => readNumber(p, 'x', '5', { integer: true, min: 2, max: 20 })).problems,
    ).toEqual(['type x: x must be a whole number from 2 to 20, and it is "5".']);
    expect(run((p) => readNumber(p, 'x', 2.5, { integer: true })).problems[0]).toMatch(/^range x:/);
    expect(run((p) => readNumber(p, 'x', 7, { min: 8 })).problems[0]).toContain('of 8 or more');
    expect(run((p) => readNumber(p, 'x', 7, { max: 6 })).problems[0]).toContain('of 6 or less');
  });

  it('refuses NaN and infinity, which JSON cannot carry and a camera cannot use', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(run((p) => readNumber(p, 'x', bad)).problems[0]).toMatch(/^type x:/);
    }
  });

  it('calls a value that is not there missing, for every kind of value', () => {
    const checks: ((p: Problems) => unknown)[] = [
      (p: Problems) => readNumber(p, 'x', undefined),
      (p: Problems) => readString(p, 'x', undefined),
      (p: Problems) => readBoolean(p, 'x', undefined),
      (p: Problems) => readChoice(p, 'x', undefined, ['a']),
      (p: Problems) => readNumbers(p, 'x', undefined, 2),
      (p: Problems) => readRecord(p, 'x', undefined, []),
    ];
    for (const check of checks) {
      expect(run(check)).toEqual({ value: undefined, problems: ['missing x: x is missing.'] });
    }
  });

  it('checks text, true and false, and a choice from a list of numbers or of words', () => {
    expect(run((p) => readString(p, 'n', 'Assays')).value).toBe('Assays');
    expect(run((p) => readString(p, 'n', '')).value).toBe('');
    expect(run((p) => readString(p, 'n', '', true)).problems).toEqual([
      'range n: n must not be empty.',
    ]);
    expect(run((p) => readString(p, 'n', 4)).problems).toEqual([
      'type n: n must be text, and it is 4.',
    ]);
    expect(run((p) => readBoolean(p, 'b', false)).value).toBe(false);
    expect(run((p) => readBoolean(p, 'b', 'yes')).problems).toEqual([
      'type b: b must be true or false, and it is "yes".',
    ]);
    expect(run((p) => readChoice(p, 'v', 5, [1, 2, 3, 5, 10])).value).toBe(5);
    expect(run((p) => readChoice(p, 'v', '5', [1, 2, 3, 5, 10])).problems).toEqual([
      'choice v: v must be one of 1, 2, 3, 5, 10, and it is "5".',
    ]);
    expect(run((p) => readChoice(p, 'm', '3d', ['2d', '3d'])).value).toBe('3d');
  });

  it('checks a list of numbers of a length, and names the place of the one that is wrong', () => {
    expect(run((p) => readNumbers(p, 'centre', [1, 2], 2))).toEqual({
      value: [1, 2],
      problems: [],
    });
    expect(run((p) => readNumbers(p, 'centre', [1, 2, 3], 2)).problems).toEqual([
      'type centre: centre must be a list of 2 numbers, and it is a list of 3.',
    ]);
    expect(run((p) => readNumbers(p, 'centre', 'xy', 2)).problems[0]).toContain('and it is "xy"');
    const bad = run((p) => readNumbers(p, 'origin', [0, NaN, 'z'], 3));
    expect(bad.value).toBeUndefined();
    expect(bad.problems.map((m) => m.split(':')[0])).toEqual(['type origin[1]', 'type origin[2]']);
  });

  it('checks an object, and a field it should not have is a problem of its own', () => {
    const fields = { a: 1, typo: 2 };
    const found = run((p) => readRecord(p, 'camera2d', fields, ['a', 'b']));
    expect(found.value).toBe(fields);
    expect(found.problems).toEqual([
      'unknown_field camera2d.typo: camera2d.typo is not a field of camera2d.',
    ]);
    expect(run((p) => readRecord(p, '', { z: 1 }, [])).problems).toEqual([
      'unknown_field z: z is not a field of the document.',
    ]);
    expect(run((p) => readRecord(p, 'camera2d', [1], ['a'])).problems).toEqual([
      'not_an_object camera2d: camera2d must be an object, and it is a list.',
    ]);
    expect(run((p) => readRecord(p, '', 7, [])).problems).toEqual([
      'not_an_object : The document must be an object, and it is 7.',
    ]);
  });

  it('checks a list and an object of any keys, and says what it found when it is neither', () => {
    const items = [1, 'a'];
    expect(run((p) => readList(p, 'legend', items))).toEqual({ value: items, problems: [] });
    expect(run((p) => readList(p, 'legend', {})).problems).toEqual([
      'type legend: legend must be a list, and it is an object.',
    ]);
    expect(run((p) => readList(p, 'legend', undefined)).problems).toEqual([
      'missing legend: legend is missing.',
    ]);
    const layers = { 'layer-1': 1, anything: 2 };
    expect(run((p) => readMap(p, 'layers', layers))).toEqual({ value: layers, problems: [] });
    expect(run((p) => readMap(p, 'layers', [])).problems).toEqual([
      'not_an_object layers: layers must be an object, and it is a list.',
    ]);
  });

  it('lists at most 100 problems and counts the rest in one last, so a bad document cannot make a huge list', () => {
    const { problems } = run((p) => {
      for (let i = 0; i < MAX_PROBLEMS + 25; i += 1) {
        p.add(`layers[${String(i)}]`, 'type', 'bad');
      }
    });
    expect(problems).toHaveLength(MAX_PROBLEMS + 1);
    expect(problems.at(-1)).toBe('too_many : 25 more problems are not listed.');
    expect(
      run((p) => {
        p.add('a', 'type', 'bad');
      }).problems,
    ).toHaveLength(1);
  });
});
