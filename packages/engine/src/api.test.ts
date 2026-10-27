/** Tests of the engine's public types; see `types.test.ts` for how they are checked. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { IMPORT_PHASES } from './api.js';
import type {
  Engine,
  EngineEvents,
  EngineOptions,
  ImportOptions,
  ImportPhase,
  ImportProgress,
  LoadOptions,
} from './api.js';
import { assertNever } from './exhaustive.js';
import type { DatasetInput } from './inputs.js';
import type { Phase, Summary } from './types.js';

function wording(phase: ImportPhase): string {
  switch (phase) {
    case 'reading':
      return 'Reading the file';
    case 'parsing':
      return 'Reading the rows';
    case 'validating':
      return 'Checking the data';
    default:
      return assertNever(phase);
  }
}

describe('the import phases', () => {
  it('start with reading the file, then the kernel`s own phases', () => {
    expect(IMPORT_PHASES).toEqual(['reading', 'parsing', 'validating']);
    expect(IMPORT_PHASES.map(wording)).toHaveLength(3);
    expectTypeOf<ImportPhase>().toEqualTypeOf<Phase | 'reading'>();
    expectTypeOf<ImportProgress['phase']>().toEqualTypeOf<ImportPhase>();
  });
});

/** An engine that does nothing, to check that the interface can be implemented. */
function inertEngine(): Engine {
  const unavailable = (): Promise<never> => Promise.reject(new Error('not available'));
  return {
    preview: unavailable,
    importFiles: unavailable,
    load: unavailable,
    datasets: () => [],
    rows: unavailable,
    remove: unavailable,
    on: () => () => undefined,
    dispose: () => undefined,
  };
}

describe('the engine interface', () => {
  it('gives each listener the payload of its own event', () => {
    const engine = inertEngine();
    const stop = engine.on('datasets', (list) => {
      expectTypeOf(list).toEqualTypeOf<readonly Summary[]>();
    });
    expectTypeOf(stop).toEqualTypeOf<() => void>();
    // @ts-expect-error the engine announces no event of this name
    engine.on('unknown', () => undefined);
    expectTypeOf<EngineEvents>().toHaveProperty('datasets');
  });

  it('has the methods of the brief, and no search of coordinate systems', () => {
    expectTypeOf<Engine['load']>().parameter(0).toEqualTypeOf<DatasetInput>();
    expectTypeOf<Engine['datasets']>().returns.toEqualTypeOf<readonly Summary[]>();
    expectTypeOf<Engine>().not.toHaveProperty('searchCrs');
    expect(Object.keys(inertEngine()).sort()).toEqual([
      'datasets',
      'dispose',
      'importFiles',
      'load',
      'on',
      'preview',
      'remove',
      'rows',
    ]);
  });

  it('takes options that are left out rather than undefined', () => {
    const none: ImportOptions = {};
    const signalOnly: LoadOptions = { signal: new AbortController().signal };
    // @ts-expect-error a missing option is left out, not set to undefined
    const undefinedSignal: ImportOptions = { signal: undefined };
    // @ts-expect-error nor is a missing URL
    const undefinedUrl: EngineOptions = { workerUrl: undefined };
    expect([none, signalOnly, undefinedSignal, undefinedUrl]).toHaveLength(4);
  });
});
