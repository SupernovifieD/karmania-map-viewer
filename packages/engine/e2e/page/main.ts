/**
 * The page the browser tests open. It uses the engine as an application would, with the
 * real worker and the real WebAssembly module, and offers the tests a few scenarios to run
 * through `window.karmaniaTest`. A scenario returns plain data, so it can cross back to the
 * test.
 */
import { createEngine, points } from '../../src/index.js';

/** What loading a dataset made in the page came to. */
export interface LoadedPoints {
  readonly status: string;
  readonly kind: string | undefined;
  readonly elementCount: number | undefined;
  /** The X of the first rows, as read back. */
  readonly x: readonly number[];
}

/** What came of starting an engine whose module is somewhere that may not be right. */
export interface StartedAt {
  readonly started: boolean;
  /** The name and message of the error, if it did not start. */
  readonly error: string | undefined;
}

/** The scenarios the tests can run. */
export interface Scenarios {
  readonly loadPoints: () => Promise<LoadedPoints>;
  readonly startWithModuleAt: (wasmUrl: string) => Promise<StartedAt>;
}

declare global {
  interface Window {
    karmaniaTest?: Scenarios;
  }
}

async function loadPoints(): Promise<LoadedPoints> {
  const engine = createEngine();
  try {
    const result = await engine.load(
      points({
        name: 'in the page',
        x: [500_000, 500_010, 500_020, 500_030],
        y: [2_700_000, 2_700_010, 2_700_020, 2_700_030],
        crs: { kind: 'epsg', code: 32640 },
      }),
    );
    const [summary] = engine.datasets();
    if (summary === undefined) {
      return { status: result.status, kind: undefined, elementCount: undefined, x: [] };
    }
    const page = await engine.rows(summary.id, 1, 3);
    const x = page.columns.find((column) => column.name === 'X')?.values;
    return {
      status: result.status,
      kind: summary.kind,
      elementCount: summary.elementCount,
      x: x instanceof Float64Array ? Array.from(x) : [],
    };
  } finally {
    engine.dispose();
  }
}

async function startWithModuleAt(wasmUrl: string): Promise<StartedAt> {
  const engine = createEngine({ wasmUrl });
  try {
    await engine.load(points({ name: 'p', x: [1], y: [1], crs: { kind: 'epsg', code: 32640 } }));
    return { started: true, error: undefined };
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  } finally {
    engine.dispose();
  }
}

window.karmaniaTest = { loadPoints, startWithModuleAt };
