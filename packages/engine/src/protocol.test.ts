import { describe, expect, expectTypeOf, it } from 'vitest';
import { EngineDisposedError, EngineError, serializeError } from './errors.js';
import { assertNever } from './exhaustive.js';
import type { DatasetInput } from './inputs.js';
import { parseFromWorker, parseToWorker, REQUEST_TYPES } from './protocol.js';
import type { FromWorker, RequestMessage, RequestType, Requests, ToWorker } from './protocol.js';

describe('the types of messages', () => {
  it('list every request, and every request has a result', () => {
    expectTypeOf<(typeof REQUEST_TYPES)[number]>().toEqualTypeOf<RequestType>();
    expectTypeOf<RequestMessage['type']>().toEqualTypeOf<RequestType>();
    expectTypeOf<Requests['rows']['result']>().toHaveProperty('columns');
  });

  it('are exhaustive in both directions', () => {
    const toWorker = (message: ToWorker): string => {
      switch (message.type) {
        case 'init':
        case 'preview':
        case 'import':
        case 'load':
        case 'rows':
        case 'remove':
        case 'cancel':
          return message.type;
        default:
          return assertNever(message);
      }
    };
    const fromWorker = (message: FromWorker): string => {
      switch (message.type) {
        case 'result':
          return message.request;
        case 'progress':
        case 'error':
        case 'cancelled':
          return message.type;
        default:
          return assertNever(message);
      }
    };
    expect(toWorker({ type: 'cancel', target: 1 })).toBe('cancel');
    expect(fromWorker({ type: 'cancelled', id: 1 })).toBe('cancelled');
  });
});

describe('what the worker accepts', () => {
  const envelopes: Record<RequestType, unknown> = {
    init: {},
    preview: { groups: [] },
    import: { file: new Blob([]), mapping: {} },
    load: { input: {} },
    rows: { dataset: 1, start: 0, count: 10 },
    remove: { dataset: 1 },
  };

  it('takes each type of request with its id and parameters', () => {
    for (const type of REQUEST_TYPES) {
      const sent = { type, id: 7, params: envelopes[type] };
      expect(parseToWorker(sent)).toEqual(sent);
    }
  });

  it('takes a cancel naming the request to stop', () => {
    expect(parseToWorker({ type: 'cancel', target: 3 })).toEqual({ type: 'cancel', target: 3 });
  });

  it('refuses everything else', () => {
    const refused: unknown[] = [
      undefined,
      null,
      'init',
      42,
      {},
      { type: 'init', params: {} },
      { type: 'init', id: '1', params: {} },
      { type: 'init', id: 1 },
      { type: 'init', id: 1, params: 'x' },
      { type: 'sing', id: 1, params: {} },
      { type: 'cancel' },
      { type: 'cancel', target: '3' },
    ];
    for (const message of refused) {
      expect(parseToWorker(message), JSON.stringify(message)).toBeUndefined();
    }
  });
});

describe('what the main thread accepts', () => {
  it('takes each kind of reply', () => {
    const accepted: FromWorker[] = [
      { type: 'result', id: 1, request: 'remove', result: true },
      { type: 'progress', id: 1, progress: { phase: 'reading', fraction: 0.5 } },
      { type: 'error', id: 1, error: { name: 'Error', message: 'no' } },
      { type: 'error', id: 1, error: { name: 'Error', message: 'no', stack: 'at x' } },
      { type: 'cancelled', id: 1 },
    ];
    for (const reply of accepted) {
      expect(parseFromWorker(reply)).toEqual(reply);
    }
  });

  it('refuses everything else', () => {
    const refused: unknown[] = [
      null,
      'result',
      {},
      { type: 'result', request: 'remove', result: true },
      { type: 'result', id: 1, request: 'sing', result: true },
      { type: 'result', id: 1, request: 'remove' },
      { type: 'progress', id: 1, progress: { phase: 'chewing', fraction: 0.5 } },
      { type: 'progress', id: 1, progress: { phase: 'parsing', fraction: '1' } },
      { type: 'progress', id: 1 },
      { type: 'error', id: 1, error: { name: 'Error' } },
      { type: 'error', id: 1, error: 'no' },
      { type: 'hello', id: 1 },
    ];
    for (const reply of refused) {
      expect(parseFromWorker(reply), JSON.stringify(reply)).toBeUndefined();
    }
  });
});

describe('what structured cloning does to them', () => {
  const points = (): DatasetInput => ({
    kind: 'points',
    name: 'p',
    crs: null,
    x: new Float64Array([1, 2, 3]),
    y: new Float64Array([4, 5, 6]),
    columns: [{ name: 'rock', type: 'text', values: ['a', 'b', 'c'] }],
  });

  it('carries a request with typed arrays, by copy', () => {
    const message: ToWorker = { type: 'load', id: 1, params: { input: points() } };
    const received = parseToWorker(structuredClone(message));
    expect(received).toEqual(message);
  });

  it('moves the arrays of a request that lists them as transferred', () => {
    const input = points();
    if (input.kind !== 'points') {
      throw new Error('expected points');
    }
    const message: ToWorker = { type: 'load', id: 1, params: { input } };
    const received = parseToWorker(
      structuredClone(message, { transfer: [input.x.buffer, input.y.buffer] }),
    );
    expect(input.x.byteLength).toBe(0);
    expect(received?.type === 'load' && received.params.input.kind === 'points').toBe(true);
    const moved = received?.type === 'load' ? received.params.input : undefined;
    expect(moved?.kind === 'points' ? Array.from(moved.x) : []).toEqual([1, 2, 3]);
  });
});

describe('errors', () => {
  it('cross as a name, a message and a stack, and come back as an EngineError', () => {
    const thrown = new TypeError('there is no dataset with that id');
    const crossed: unknown = structuredClone(serializeError(thrown));
    const message = parseFromWorker({ type: 'error', id: 4, error: crossed });
    expect(message?.type).toBe('error');
    if (message?.type !== 'error') {
      return;
    }
    const error = new EngineError(message.error);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EngineError');
    expect(error.message).toBe('there is no dataset with that id');
    expect(error.remoteName).toBe('TypeError');
    expect(error.remoteStack).toContain('TypeError');
  });

  it('describe what is thrown even when it is not an Error', () => {
    expect(serializeError('plain text')).toEqual({ name: 'Error', message: 'plain text' });
    expect(serializeError({ code: 1 }).message).toMatch(/not an error/);
    expect(serializeError(undefined).name).toBe('Error');
  });

  it('say why an engine cannot be used after it is disposed', () => {
    const error = new EngineDisposedError();
    expect(error.name).toBe('EngineDisposedError');
    expect(error.message).toMatch(/disposed/);
  });
});
