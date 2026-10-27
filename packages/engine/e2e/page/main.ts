/**
 * The page the browser tests open. It uses the engine as an application would, with the
 * real worker and the real WebAssembly module, and offers the tests a few scenarios to run
 * through `window.karmaniaTest`. A scenario returns plain data, so it can cross back to the
 * test.
 */
import { createEngine, points } from '../../src/index.js';
import { runFixture } from '../scenarios.js';
import type { FixtureCase, FixtureReport } from '../scenarios.js';
import type { ImportMapping } from '../../src/types.js';

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

/** What stopping a big import came to. */
export interface StoppedImport {
  /** The name of the error the import rejected with, or `imported` if it did not reject. */
  readonly outcome: string;
  readonly datasetsAfterStopping: number;
  readonly datasetsAfterImportingAgain: number;
}

/** Two engines side by side. */
export interface TwoEngines {
  readonly first: readonly string[];
  readonly second: readonly string[];
  /** How many rows the second could read after the first was disposed. */
  readonly rowsOfSecondAfterDisposingFirst: number;
}

/** What an engine does once it is disposed. */
export interface AfterDispose {
  readonly datasets: string;
  readonly rows: string;
}

/** The scenarios the tests can run. */
export interface Scenarios {
  readonly loadPoints: () => Promise<LoadedPoints>;
  readonly startWithModuleAt: (wasmUrl: string) => Promise<StartedAt>;
  readonly runFixture: (fixture: FixtureCase) => Promise<FixtureReport>;
  readonly stopBigImport: () => Promise<StoppedImport>;
  readonly twoEngines: () => Promise<TwoEngines>;
  readonly afterDispose: () => Promise<AfterDispose>;
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

/** A sample file, fetched from the page's own server. */
async function fetchFixture(name: string): Promise<File> {
  const response = await fetch(`/${name}`);
  if (!response.ok) {
    throw new Error(`${name} could not be fetched: ${String(response.status)}`);
  }
  return new File([await response.blob()], name);
}

async function runFixtureInPage(fixture: FixtureCase): Promise<FixtureReport> {
  const engine = createEngine();
  try {
    return await runFixture(engine, fetchFixture, fixture);
  } finally {
    engine.dispose();
  }
}

const UTM40 = { kind: 'epsg', code: 32640 } as const;

/** A CSV of `rows` points, and the mapping for it. */
function bigCsv(rows: number): { file: File; mapping: ImportMapping } {
  const lines = ['X,Y,Z'];
  for (let row = 0; row < rows; row += 1) {
    lines.push(`${String(500_000 + row)},${String(2_700_000 + row)},${String(row % 100)}`);
  }
  return {
    file: new File([lines.join('\n')], 'big.csv'),
    mapping: {
      datasetName: 'big',
      kind: 'points',
      columns: [
        { source: 'X', role: 'x' },
        { source: 'Y', role: 'y' },
        { source: 'Z', role: 'z' },
      ],
      nodata: { tokens: [], numbers: [] },
      emptyCoordinates: 'error',
      decimalSeparator: '.',
      crs: UTM40,
    },
  };
}

async function stopBigImport(): Promise<StoppedImport> {
  const engine = createEngine();
  try {
    const big = bigCsv(150_000);
    const controller = new AbortController();
    let outcome = 'imported';
    try {
      await engine.importFiles([big.file], big.mapping, {
        signal: controller.signal,
        onProgress: ({ phase }) => {
          if (phase === 'parsing') {
            controller.abort();
          }
        },
      });
    } catch (error) {
      outcome = error instanceof Error ? error.name : String(error);
    }
    const datasetsAfterStopping = engine.datasets().length;
    const small = bigCsv(5);
    await engine.importFiles([small.file], small.mapping);
    return {
      outcome,
      datasetsAfterStopping,
      datasetsAfterImportingAgain: engine.datasets().length,
    };
  } finally {
    engine.dispose();
  }
}

async function twoEngines(): Promise<TwoEngines> {
  const [first, second] = [createEngine(), createEngine()];
  try {
    await first.load(points({ name: 'in the first', x: [1], y: [1], crs: UTM40 }));
    await second.load(points({ name: 'in the second', x: [1, 2, 3], y: [1, 2, 3], crs: UTM40 }));
    const names = (engine: typeof first): string[] => engine.datasets().map((d) => d.name);
    const report = { first: names(first), second: names(second) };
    first.dispose();
    const id = second.datasets()[0]?.id ?? -1;
    const rows = await second.rows(id, 0, 10);
    return { ...report, rowsOfSecondAfterDisposingFirst: rows.count };
  } finally {
    first.dispose();
    second.dispose();
  }
}

async function afterDispose(): Promise<AfterDispose> {
  const engine = createEngine();
  engine.dispose();
  const describe = (error: unknown): string => (error instanceof Error ? error.name : 'no error');
  let datasets = 'no error';
  try {
    engine.datasets();
  } catch (error) {
    datasets = describe(error);
  }
  let rows = 'no error';
  try {
    await engine.rows(1, 0, 1);
  } catch (error) {
    rows = describe(error);
  }
  return { datasets, rows };
}

window.karmaniaTest = {
  loadPoints,
  startWithModuleAt,
  runFixture: runFixtureInPage,
  stopBigImport,
  twoEngines,
  afterDispose,
};
