/**
 * Scenarios that run the same way in a browser and in Node: they take an engine and a way
 * to get a file, and return plain data. The browser test runs them in the page, through
 * the real worker, and again in Node, through the in-process channel, and expects the two
 * to give the same report: the same data must give the same result everywhere.
 */
import type { Engine, ImportPhase } from '../src/api.js';
import { mappingFrom } from '../src/test-support/mapping.js';
import { grid, points, polygons } from '../src/builders.js';
import type { RenderBuffers } from '../src/display.js';
import type { CrsInfo, CrsRef, Kind } from '../src/types.js';

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

/** What the EPSG definitions said through an engine, as plain data. */
export interface CrsReport {
  readonly utm40: CrsInfo | undefined;
  readonly unknown: CrsInfo | undefined;
  /** The codes of a search for a name, and of one for a code. */
  readonly byName: readonly number[];
  readonly byCode: readonly number[];
  /** The name and message of the error for a code that is not a whole number. */
  readonly misuse: string;
  /** The codes of the findings a load of UTM-looking points came to, for each EPSG code. */
  readonly loaded: Readonly<Record<string, readonly string[]>>;
}

/** Asks about EPSG codes, and loads points under three of them, and reports what came back. */
export async function runCrs(engine: Engine): Promise<CrsReport> {
  const [utm40, unknown, byName, byCode] = await Promise.all([
    engine.crsInfo(32640),
    engine.crsInfo(99_999),
    engine.searchCrs('WGS 84 / UTM zone 40', 5),
    engine.searchCrs('EPSG:4326', 5),
  ]);
  let misuse = 'no error';
  try {
    await engine.crsInfo(-1);
  } catch (error) {
    misuse = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  const loaded: Record<string, string[]> = {};
  for (const code of [32640, 99_999, 4269]) {
    const result = await engine.load(
      points({
        name: `EPSG:${String(code)}`,
        x: [500_000, 500_010],
        y: [2_700_000, 2_700_010],
        crs: { kind: 'epsg', code },
      }),
    );
    loaded[String(code)] =
      result.status === 'loaded'
        ? (result.summaries[0]?.findings ?? []).map((finding) => finding.code)
        : result.findings.map((finding) => `blocked: ${finding.code}`);
  }
  return {
    utm40,
    unknown,
    byName: byName.map((found) => found.code),
    byCode: byCode.map((found) => found.code),
    misuse,
    loaded,
  };
}

/** A hash (FNV-1a, 32 bits) of the bytes of a typed array: two arrays with one bit different give different hashes. */
export function hashOf(array: ArrayBufferView): string {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** What preparing and classifying a few datasets came to, in plain data: the same in every environment. */
export interface DisplayReport {
  /** The map's coordinate system and the origin, and what the choice said. */
  readonly frame: {
    readonly crs: string;
    readonly origin: readonly number[];
    readonly source: string;
  };
  readonly frameFindings: readonly string[];
  /** For each dataset: its kind, whether each typed array is the kind it has to be, and what is in them. */
  readonly points: PointsReport;
  readonly polygons: {
    readonly triangles: number;
    readonly outline: number;
    readonly findings: readonly string[];
    /** Hashes of every byte of the positions, the triangles and the outline. */
    readonly hashes: readonly string[];
  };
  readonly warpedGrid: {
    readonly tiles: number;
    readonly tileTriangles: readonly number[];
    readonly placement: boolean;
    /** Hashes of every byte of the positions, the uvs and the triangles of the meshes. */
    readonly hashes: readonly string[];
  };
  /** Classes of a column: bounds and counts, and whether the class index's tally is the same. */
  readonly classes: readonly {
    readonly method: string;
    readonly breaks: string;
    readonly indexAgrees: boolean;
  }[];
  /** What happened to a big prepare that was stopped, and to the next one. */
  readonly stopped: { readonly outcome: string; readonly nextWorks: boolean };
  /** How many reports of progress a big prepare made, and whether they only went up. */
  readonly progress: { readonly reports: boolean; readonly ascending: boolean };
}

interface PointsReport {
  readonly isFloat32: boolean;
  readonly length: number;
  readonly firstThree: readonly number[];
  /** A hash of every byte of the positions. */
  readonly hash: string;
  readonly notPlaced: number;
  readonly findings: readonly string[];
}

const GEOGRAPHIC: CrsRef = { kind: 'epsg', code: 4326 };

function buffersOf(result: Awaited<ReturnType<Engine['prepare']>>): RenderBuffers {
  if (result.status !== 'drawn') {
    throw new Error(`not drawn: ${result.findings.map((f) => f.code).join(', ')}`);
  }
  return result.buffers;
}

/** Loads some data in longitude and latitude, prepares and classifies it, and reports what came out. */
export async function runDisplay(engine: Engine): Promise<DisplayReport> {
  const count = 3_000;
  const loaded = async (input: Parameters<Engine['load']>[0]): Promise<number> => {
    const result = await engine.load(input);
    if (result.status !== 'loaded') throw new Error('blocked');
    return result.summaries[0]?.id ?? -1;
  };
  const wells = await loaded(
    points({
      name: 'Wells',
      crs: GEOGRAPHIC,
      x: Array.from({ length: count }, (_, i) => 57 + (i % 100) * 0.001),
      // The last position is off the Earth.
      y: Array.from({ length: count }, (_, i) =>
        i === count - 1 ? 95 : 25 + Math.floor(i / 100) * 0.001,
      ),
      attributes: {
        grade: Array.from({ length: count }, (_, i) => (i % 7 === 3 ? null : (i % 40) * 1.5)),
      },
    }),
  );
  const leases = await loaded(
    polygons({
      name: 'Leases',
      crs: GEOGRAPHIC,
      x: [57, 57.1, 57.1, 57, 57.2, 57.3, 57.3, 57.2, 57.4, 57.5, 57.5, 57.4],
      y: [25, 25, 25.1, 25.1, 25, 25, 25.1, 25.1, 25, 25, 25.1, 25.1],
      ringOffsets: [0, 4, 8, 12],
      polygonOffsets: [0, 1, 2, 3],
    }),
  );
  const surface = await loaded(
    grid({
      name: 'Grid',
      crs: GEOGRAPHIC,
      origin: [57, 25, 0],
      spacing: [0.01, 0.01, 1],
      dims: [90, 40, 1],
      values: { value: Array.from({ length: 3_600 }, (_, i) => i) },
    }),
  );

  const choice = await engine.chooseFrame();
  if (choice.frame === null) throw new Error('no frame');
  const { frame } = choice;
  const prepare = (id: number, maxTextureSize?: number) =>
    engine.prepare(id, { frame, ...(maxTextureSize === undefined ? {} : { maxTextureSize }) });

  const pointsResult = await prepare(wells);
  const pointBuffers = buffersOf(pointsResult);
  if (pointBuffers.kind !== 'points') throw new Error('not points');
  const positions = pointBuffers.positions;
  const pointsReport: PointsReport = {
    isFloat32: positions instanceof Float32Array,
    length: positions.length,
    firstThree: Array.from(positions.slice(0, 3)).map((n) => Math.round(n * 100) / 100),
    // A position that cannot be placed has NaN for x and for y, and its height as it was.
    notPlaced: Array.from(positions).filter((n, i) => i % 3 === 0 && Number.isNaN(n)).length,
    findings: pointsResult.findings.map((f) => `${f.code} x${String(f.count)}`),
    hash: hashOf(positions),
  };

  const polygonResult = await prepare(leases);
  const polygonBuffers = buffersOf(polygonResult);
  if (polygonBuffers.kind !== 'polygons') throw new Error('not polygons');

  const gridBuffers = buffersOf(await prepare(surface, 32));
  if (gridBuffers.kind !== 'grid' || gridBuffers.warp === undefined) throw new Error('not warped');

  const classes: DisplayReport['classes'][number][] = [];
  for (const method of ['equal', 'quantile', 'jenks', 'categories'] as const) {
    const classified = await engine.classify(wells, 'grade', method, 5);
    if (classified.status !== 'classified') throw new Error('not classified');
    const { breaks } = classified;
    const index = await engine.classIndex(wells, breaks);
    const counts = [...breaks.counts];
    if (breaks.kind === 'categories' && breaks.other !== undefined) counts.push(breaks.other);
    const tally = counts.map(() => 0);
    let none = 0;
    for (const c of index) {
      if (c === 255) none += 1;
      else tally[c] = (tally[c] ?? 0) + 1;
    }
    classes.push({
      method,
      breaks: JSON.stringify(breaks),
      indexAgrees: JSON.stringify(tally) === JSON.stringify(counts) && none === breaks.nulls,
    });
  }

  // A prepare that is stopped as soon as it is under way, and one after it.
  const big = await loaded(
    points({
      name: 'Big',
      crs: { kind: 'epsg', code: 32640 },
      x: Array.from({ length: 300_000 }, (_, i) => 500_000 + (i % 1_000)),
      y: Array.from({ length: 300_000 }, (_, i) => 2_700_000 + Math.floor(i / 1_000)),
    }),
  );
  const controller = new AbortController();
  let outcome = 'prepared';
  try {
    await engine.prepare(
      big,
      { frame },
      {
        signal: controller.signal,
        onProgress: () => {
          controller.abort();
        },
      },
    );
  } catch (error) {
    outcome = error instanceof Error ? error.name : String(error);
  }
  const fractions: number[] = [];
  const again = await engine.prepare(
    big,
    { frame },
    { onProgress: (p) => fractions.push(p.fraction) },
  );
  return {
    frame: { crs: JSON.stringify(frame.mapCrs), origin: frame.origin, source: frame.source },
    frameFindings: choice.findings.map((f) => f.code),
    points: pointsReport,
    polygons: {
      triangles: polygonBuffers.triangles.length / 3,
      outline: polygonBuffers.outline.length / 2,
      findings: polygonResult.findings.map((f) => f.code),
      hashes: [polygonBuffers.positions, polygonBuffers.triangles, polygonBuffers.outline].map(
        hashOf,
      ),
    },
    warpedGrid: {
      tiles: gridBuffers.tiles.length,
      tileTriangles: Array.from(gridBuffers.warp.tileTriangles),
      placement: 'placement' in gridBuffers,
      hashes: [gridBuffers.warp.positions, gridBuffers.warp.uvs, gridBuffers.warp.triangles].map(
        hashOf,
      ),
    },
    classes,
    stopped: { outcome, nextWorks: again.status === 'drawn' },
    progress: {
      reports: fractions.length >= 2,
      ascending: fractions.every((f, i) => i === 0 || f >= (fractions[i - 1] ?? 0)),
    },
  };
}
