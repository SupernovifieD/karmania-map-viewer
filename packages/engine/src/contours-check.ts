/**
 * Strict checks that what the kernel gives for contour lines has the shape of its public type: a step of the
 * job, and the settings a set of contours starts with. As the other checks of the engine, they reject keys that
 * are not in the type, so that a field added on the Rust side without a type fails a test and not a person.
 */
import {
  ContractError,
  checkedArray,
  checkedContourParams,
  checkedFindings,
  checkedNumber,
  checkedObject,
  checkedSummary,
} from './contract-check.js';
import type { ContourDefaultsResult, LoadResult } from './types.js';

/**
 * What a step of making contours answered: progress, the end, or that the job is gone. The end is what a load
 * gives: the new lines (one summary, of lines, that says it came from a dataset) or the findings that say why
 * there are none, which may be warnings (a dataset that cannot be contoured is not an error of the data).
 */
export type CheckedContourStep =
  | { readonly status: 'progress'; readonly fraction: number }
  | { readonly status: 'done'; readonly result: LoadResult }
  | { readonly status: 'cancelled' };

function checkedContourResult(value: unknown, path: string): LoadResult {
  const status = checkedObject(value, path, ['status'], ['summaries', 'findings'])['status'];
  if (status === 'loaded') {
    const o = checkedObject(value, path, ['status', 'summaries']);
    const summaries = checkedArray(o['summaries'], `${path}.summaries`).map((s, i) =>
      checkedSummary(s, `${path}.summaries[${String(i)}]`),
    );
    const [lines, ...more] = summaries;
    if (lines === undefined || more.length > 0) {
      throw new ContractError(`${path}.summaries`, 'expected one dataset of lines');
    }
    if (lines.kind !== 'lines' || lines.derivedFrom?.kind !== 'contours') {
      throw new ContractError(`${path}.summaries[0]`, 'expected lines made as contours');
    }
    return o as unknown as LoadResult;
  }
  if (status === 'blocked') {
    const o = checkedObject(value, path, ['status', 'findings']);
    if (checkedFindings(o['findings'], `${path}.findings`).length === 0) {
      throw new ContractError(`${path}.findings`, 'contours that are not made have a reason');
    }
    return o as unknown as LoadResult;
  }
  throw new ContractError(`${path}.status`, 'expected loaded or blocked');
}

export function checkedContourStep(value: unknown, path = 'contourStep'): CheckedContourStep {
  const status = checkedObject(value, path, ['status'], ['fraction', 'result'])['status'];
  if (status === 'progress') {
    const o = checkedObject(value, path, ['status', 'fraction']);
    const fraction = checkedNumber(o['fraction'], `${path}.fraction`);
    if (fraction < 0 || fraction > 1)
      throw new ContractError(`${path}.fraction`, 'expected 0 to 1');
    return { status: 'progress', fraction };
  }
  if (status === 'done') {
    const o = checkedObject(value, path, ['status', 'result']);
    return { status: 'done', result: checkedContourResult(o['result'], `${path}.result`) };
  }
  if (status === 'cancelled') {
    checkedObject(value, path, ['status']);
    return { status: 'cancelled' };
  }
  throw new ContractError(`${path}.status`, 'expected progress, done or cancelled');
}

export function checkedContourDefaults(
  value: unknown,
  path = 'contourDefaults',
): ContourDefaultsResult {
  const status = checkedObject(value, path, ['status'], ['params', 'findings'])['status'];
  if (status === 'defaults') {
    const o = checkedObject(value, path, ['status', 'params']);
    checkedContourParams(o['params'], `${path}.params`);
    return o as unknown as ContourDefaultsResult;
  }
  if (status === 'not_available') {
    const o = checkedObject(value, path, ['status', 'findings']);
    if (checkedFindings(o['findings'], `${path}.findings`).length === 0) {
      throw new ContractError(`${path}.findings`, 'a dataset with no settings has a reason');
    }
    return o as unknown as ContourDefaultsResult;
  }
  throw new ContractError(`${path}.status`, 'expected defaults or not_available');
}
