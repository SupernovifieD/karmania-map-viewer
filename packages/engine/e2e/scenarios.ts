/**
 * Scenarios that run the same way in a browser and in Node: they take an engine and a way
 * to get a file, and return plain data. The browser test runs them in the page, through
 * the real worker, and again in Node, through the in-process channel, and expects the two
 * to give the same report: the same data must give the same result everywhere.
 */
import type { Engine, ImportPhase } from '../src/api.js';
import { mappingFrom } from '../src/test-support/mapping.js';
import type { CrsRef, Kind } from '../src/types.js';

/** Gets a sample file by name. */
export type LoadFile = (name: string) => Promise<File>;

const UTM40: CrsRef = { kind: 'epsg', code: 32640 };

/** One sample file, the files that go with it, and how it is imported. */
export interface FixtureCase {
  readonly file: string;
  /** Files that describe `file`, picked together with it. */
  readonly sidecars: readonly string[];
  readonly kind: Kind;
  /** `null` takes what the preview found, or what the format says. */
  readonly crs: CrsRef | null;
  /** What should come out: the kind and number of elements of each dataset. */
  readonly expected: readonly (readonly [Kind, number])[];
}

/** Every sample file in `fixtures/`, as the import wizard would import it. */
export const FIXTURE_CASES: readonly FixtureCase[] = [
  {
    file: 'points.csv',
    sidecars: ['points.prj'],
    kind: 'points',
    crs: null,
    expected: [['points', 8]],
  },
  { file: 'lines.csv', sidecars: [], kind: 'lines', crs: UTM40, expected: [['lines', 2]] },
  { file: 'blocks.csv', sidecars: [], kind: 'blocks', crs: UTM40, expected: [['blocks', 18]] },
  {
    file: 'mixed.geojson',
    sidecars: [],
    kind: 'points',
    crs: null,
    expected: [
      ['points', 2],
      ['lines', 1],
      ['polygons', 1],
    ],
  },
  { file: 'grid.asc', sidecars: [], kind: 'grid', crs: UTM40, expected: [['grid', 12]] },
  { file: 'mesh.obj', sidecars: [], kind: 'mesh', crs: UTM40, expected: [['mesh', 6]] },
];

/** A loaded dataset, described without its data. */
export interface DatasetReport {
  readonly name: string;
  readonly kind: Kind;
  readonly elementCount: number;
  readonly vertexCount: number | undefined;
  readonly hasZ: boolean;
  readonly crs: string | undefined;
  readonly bbox: readonly number[] | undefined;
  /** Name, type and number of nulls of each attribute column. */
  readonly columns: readonly (readonly [string, string, number])[];
  /** Code, severity and count of each finding. */
  readonly findings: readonly (readonly [string, string, number])[];
  /** The first rows: each column's name and its first values as text. */
  readonly firstRows: readonly (readonly [string, readonly string[]])[];
}

/** What importing one sample file came to. */
export interface FixtureReport {
  readonly file: string;
  /** How many previews the file and its sidecars made together. */
  readonly previews: number;
  readonly format: string | undefined;
  readonly suggestedKind: string | undefined;
  readonly detectedCrs: string | undefined;
  /** The phases the import went through, in order, each once. */
  readonly phases: readonly ImportPhase[];
  readonly status: 'loaded' | 'blocked';
  readonly datasets: readonly DatasetReport[];
  /** Code and severity of what blocked the import. */
  readonly blockedBy: readonly (readonly [string, string])[];
}

function crsText(crs: CrsRef | undefined): string | undefined {
  if (crs === undefined) {
    return undefined;
  }
  return crs.kind === 'epsg' ? `EPSG:${String(crs.code)}` : `local (${crs.units})`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

/** Previews and imports one sample file the way the wizard would, and reports what happened. */
export async function runFixture(
  engine: Engine,
  loadFile: LoadFile,
  fixture: FixtureCase,
): Promise<FixtureReport> {
  const files = await Promise.all([fixture.file, ...fixture.sidecars].map(loadFile));
  const previews = await engine.preview(files);
  const [preview] = previews;
  if (preview === undefined) {
    throw new Error(`${fixture.file} was not previewed.`);
  }
  const phases: ImportPhase[] = [];
  const result = await engine.importFiles(files, mappingFrom(preview, fixture.kind, fixture.crs), {
    onProgress: ({ phase }) => {
      if (phases.at(-1) !== phase) {
        phases.push(phase);
      }
    },
  });
  const report = {
    file: fixture.file,
    previews: previews.length,
    format: preview.format,
    suggestedKind: preview.suggestedKind,
    detectedCrs: crsText(preview.crs?.crs),
    phases,
  };
  if (result.status === 'blocked') {
    return {
      ...report,
      status: 'blocked',
      datasets: [],
      blockedBy: result.findings.map((f) => [f.code, f.severity]),
    };
  }
  const datasets: DatasetReport[] = [];
  for (const summary of result.summaries) {
    const rows = await engine.rows(summary.id, 0, 3);
    datasets.push({
      name: summary.name,
      kind: summary.kind,
      elementCount: summary.elementCount,
      vertexCount: summary.vertexCount,
      hasZ: summary.hasZ,
      crs: crsText(summary.crs),
      bbox: summary.bbox === undefined ? undefined : [...summary.bbox.min, ...summary.bbox.max],
      columns: summary.columns.map((c) => [c.name, c.type, c.nullCount]),
      findings: summary.findings.map((f) => [f.code, f.severity, f.count]),
      firstRows: rows.columns.map((column) => [
        column.name,
        Array.from({ length: rows.count }, (_, row) =>
          column.nulls[row] === 1 ? 'null' : text(column.values[row]),
        ),
      ]),
    });
  }
  return { ...report, status: 'loaded', datasets, blockedBy: [] };
}
