/**
 * Finds the buffers of a dataset that can be handed to the worker instead of copied.
 */
import type { DatasetInput } from './inputs.js';

/** How deep a dataset goes: the dataset, a list of columns, a column, its arrays. */
const MAX_DEPTH = 4;

function collect(value: unknown, depth: number, into: Set<ArrayBuffer>): void {
  if (ArrayBuffer.isView(value)) {
    // A shared buffer is not handed over: it is shared, and cannot be listed for transfer.
    if (value.buffer instanceof ArrayBuffer) {
      into.add(value.buffer);
    }
    return;
  }
  if (depth >= MAX_DEPTH || typeof value !== 'object' || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    // A list of numbers or of text has nothing to hand over; a list of columns does.
    if (value.length > 0 && typeof value[0] === 'object') {
      for (const item of value as unknown[]) {
        collect(item, depth + 1, into);
      }
    }
    return;
  }
  for (const item of Object.values(value)) {
    collect(item, depth + 1, into);
  }
}

/**
 * Every `ArrayBuffer` under the typed arrays in a dataset, each once, even if several
 * arrays are views of the same one. Handing a buffer over empties every array that
 * is a view of it, not only the one in the dataset.
 */
export function transferablesOf(input: DatasetInput): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  collect(input, 0, buffers);
  return [...buffers];
}
