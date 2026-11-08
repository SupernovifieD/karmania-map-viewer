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
  PrepareOptions,
  PrepareParams,
} from './api.js';
import type { FrameChoice, PrepareResult } from './display.js';
import { assertNever } from './exhaustive.js';
import type { DatasetInput } from './inputs.js';
import type { CrsInfo, CrsRef, Phase, Summary } from './types.js';

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
    crsInfo: unavailable,
    searchCrs: unavailable,
    rows: unavailable,
    remove: unavailable,
    chooseFrame: unavailable,
    previewFrame: unavailable,
    prepare: unavailable,
    classify: unavailable,
    classIndex: unavailable,
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

  it('has the methods of the briefs: those of phase 1, the two EPSG lookups, and display preparation', () => {
    expectTypeOf<Engine['load']>().parameter(0).toEqualTypeOf<DatasetInput>();
    expectTypeOf<Engine['datasets']>().returns.toEqualTypeOf<readonly Summary[]>();
    expectTypeOf<Engine['crsInfo']>().toEqualTypeOf<
      (code: number) => Promise<CrsInfo | undefined>
    >();
    expectTypeOf<Engine['searchCrs']>().toEqualTypeOf<
      (query: string, limit: number) => Promise<readonly CrsInfo[]>
    >();
    expectTypeOf<Engine['chooseFrame']>().toEqualTypeOf<
      (preferred?: CrsRef) => Promise<FrameChoice>
    >();
    expectTypeOf<Engine['previewFrame']>().toEqualTypeOf<
      (preferred: CrsRef) => Promise<FrameChoice>
    >();
    expectTypeOf<Engine['prepare']>().toEqualTypeOf<
      (id: number, params: PrepareParams, options?: PrepareOptions) => Promise<PrepareResult>
    >();
    expectTypeOf<Engine['classIndex']>().returns.toEqualTypeOf<Promise<Uint8Array>>();
    expect(Object.keys(inertEngine()).sort()).toEqual([
      'chooseFrame',
      'classIndex',
      'classify',
      'crsInfo',
      'datasets',
      'dispose',
      'importFiles',
      'load',
      'on',
      'prepare',
      'preview',
      'previewFrame',
      'remove',
      'rows',
      'searchCrs',
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
