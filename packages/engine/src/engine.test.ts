import { afterEach, describe, expect, it } from 'vitest';
import { IMPORT_PHASES } from './api.js';
import type { Engine, ImportProgress } from './api.js';
import { createEngine } from './engine.js';
import { EngineDisposedError, EngineError } from './errors.js';
import type { DatasetInput } from './inputs.js';
import { bigPointsCsv, pointsMapping } from './test-support/data.js';
import { fixtureFile } from './test-support/kernel.js';
import { mappingFrom } from './test-support/mapping.js';
import { engineOverChannel } from './test-support/ports.js';
import type { ImportMapping } from './types.js';

const UTM40 = { kind: 'epsg', code: 32640 } as const;

const points = (name: string, crs: DatasetInput['crs'] = UTM40): DatasetInput => ({
  kind: 'points',
  name,
  crs,
  x: new Float64Array([500_000, 500_010, 500_020]),
  y: new Float64Array([2_700_000, 2_700_010, 2_700_020]),
});

const engines: Engine[] = [];
function start(...args: Parameters<typeof engineOverChannel>): Engine {
  const engine = engineOverChannel(...args);
  engines.push(engine);
  return engine;
}

afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.dispose();
  }
});

describe('an engine', () => {
  it('starts with no datasets, and has them once they are loaded', async () => {
    const engine = start();
    expect(engine.datasets()).toEqual([]);
    const result = await engine.load(points('first'));
    expect(result.status).toBe('loaded');
    expect(engine.datasets().map((d) => [d.name, d.kind, d.elementCount])).toEqual([
      ['first', 'points', 3],
    ]);
  });

  it('imports a file, using a mapping made from its preview', async () => {
    const engine = start();
    const file = fixtureFile('points.csv');
    const [preview] = await engine.preview([file]);
    expect(preview?.format).toBe('csv');
    if (preview === undefined) {
      return;
    }
    const result = await engine.importFiles([file], mappingFrom(preview, 'points', UTM40));
    expect(result.status).toBe('loaded');
    expect(engine.datasets()[0]?.elementCount).toBe(8);
  });

  it('reads rows of a dataset and unloads it', async () => {
    const engine = start();
    await engine.load(points('p'));
    const id = engine.datasets()[0]?.id ?? -1;
    const page = await engine.rows(id, 1, 2);
    expect([page.start, page.count]).toEqual([1, 2]);
    await engine.remove(id);
    expect(engine.datasets()).toEqual([]);
    await expect(engine.rows(id, 0, 1)).rejects.toBeInstanceOf(EngineError);
  });

  it('tells listeners about every change, with the datasets as they are then', async () => {
    const engine = start();
    const heard: string[][] = [];
    const stop = engine.on('datasets', (list) => {
      heard.push(list.map((d) => d.name));
    });
    await engine.load(points('a'));
    await engine.load(points('b'));
    await engine.remove(engine.datasets()[0]?.id ?? -1);
    stop();
    await engine.load(points('c'));
    expect(heard).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('reports what blocks a dataset, and changes nothing', async () => {
    const engine = start();
    let announced = 0;
    engine.on('datasets', () => {
      announced += 1;
    });
    const result = await engine.load(points('p', null));
    expect(result.status === 'blocked' && result.findings.map((f) => f.code)).toEqual([
      'crs.missing',
    ]);
    expect(engine.datasets()).toEqual([]);
    expect(announced).toBe(0);
  });
});

describe('previewing files', () => {
  it('looks at a data file together with its .prj, and gives one preview for the pair', async () => {
    const engine = start();
    const previews = await engine.preview([fixtureFile('points.prj'), fixtureFile('points.csv')]);
    expect(previews.map((p) => p.fileName)).toEqual(['points.csv']);
    expect(previews[0]?.crs?.source).toBe('prj_file');
  });

  it('gives a preview for each file that is not a sidecar, in the order given', async () => {
    const engine = start();
    const previews = await engine.preview([
      fixtureFile('grid.asc'),
      fixtureFile('esri.prj'),
      fixtureFile('mesh.obj'),
      fixtureFile('points.csv'),
      fixtureFile('points.prj'),
    ]);
    expect(previews.map((p) => [p.fileName, p.format])).toEqual([
      ['grid.asc', 'ascii_grid'],
      ['esri.prj', 'prj'],
      ['mesh.obj', 'obj'],
      ['points.csv', 'csv'],
    ]);
  });

  it('gives nothing for no files', async () => {
    expect(await start().preview([])).toEqual([]);
  });

  it('still refuses once disposed, even with nothing to look at', async () => {
    const engine = start();
    engine.dispose();
    await expect(engine.preview([])).rejects.toBeInstanceOf(EngineDisposedError);
  });
});

describe('several engines', () => {
  it('share nothing', async () => {
    const [one, two] = [start(), start()];
    await one.load(points('only in one'));
    expect(two.datasets()).toEqual([]);
    await two.load(points('only in two'));
    const names = (engine: Engine): readonly string[] => engine.datasets().map((d) => d.name);
    expect([names(one), names(two)]).toEqual([['only in one'], ['only in two']]);
    // Both have a dataset with the same number, which means different things in each.
    expect(one.datasets()[0]?.id).toBe(two.datasets()[0]?.id);
    one.dispose();
    await two.remove(two.datasets()[0]?.id ?? -1);
    expect(two.datasets()).toEqual([]);
  });
});

describe('disposing an engine', () => {
  it('makes every later call a misuse, and says so', async () => {
    const engine = start();
    await engine.load(points('p'));
    engine.dispose();
    expect(() => engine.datasets()).toThrow(EngineDisposedError);
    expect(() => engine.on('datasets', () => undefined)).toThrow(/disposed/);
    const file = fixtureFile('points.csv');
    await expect(engine.preview([file])).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(engine.load(points('q'))).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(engine.rows(1, 0, 1)).rejects.toBeInstanceOf(EngineDisposedError);
    await expect(engine.remove(1)).rejects.toBeInstanceOf(EngineDisposedError);
    engine.dispose();
  });

  it('rejects what is under way and stops telling listeners anything', async () => {
    const engine = start();
    let announced = 0;
    engine.on('datasets', () => {
      announced += 1;
    });
    const loading = engine.load(points('p'));
    engine.dispose();
    await expect(loading).rejects.toBeInstanceOf(EngineDisposedError);
    expect(announced).toBe(0);
  });
});

describe('starting', () => {
  it('says why when the kernel cannot be loaded, at the first call', async () => {
    const engine = start(() => Promise.reject(new Error('the .wasm file is missing')));
    await expect(engine.load(points('p'))).rejects.toThrow('the .wasm file is missing');
    await expect(engine.rows(1, 0, 1)).rejects.toThrow('the .wasm file is missing');
  });

  it('says that it needs a browser when there are no workers', () => {
    expect(() => createEngine()).toThrow(/Web Workers are not available/);
  });
});

describe('importing files', () => {
  it('imports one data file, and leaves its sidecar alone', async () => {
    const engine = start();
    const csv = fixtureFile('points.csv');
    const prj = fixtureFile('points.prj');
    const [preview] = await engine.preview([csv, prj]);
    if (preview === undefined) {
      throw new Error('no preview');
    }
    const result = await engine.importFiles([prj, csv], mappingFrom(preview, 'points', UTM40));
    expect(result.status).toBe('loaded');
    expect(engine.datasets().map((d) => [d.name, d.elementCount])).toEqual([['points.csv', 8]]);
  });

  it('tells listeners of the new dataset once', async () => {
    const engine = start();
    const heard: number[] = [];
    engine.on('datasets', (list) => heard.push(list.length));
    await engine.importFiles([bigPointsCsv(10)], pointsMapping('ten'));
    expect(heard).toEqual([1]);
  });

  it('reports what blocks an import and loads nothing', async () => {
    const engine = start();
    const result = await engine.importFiles([bigPointsCsv(10)], {
      ...pointsMapping('x'),
      crs: null,
    });
    expect(result.status === 'blocked' && result.findings.map((f) => f.code)).toEqual([
      'crs.missing',
    ]);
    expect(engine.datasets()).toEqual([]);
  });

  it('refuses to import no file, or several data files, as misuse', async () => {
    const engine = start();
    const mapping = pointsMapping('x');
    await expect(engine.importFiles([], mapping)).rejects.toThrow(/needs a data file/);
    await expect(
      engine.importFiles([fixtureFile('points.csv'), fixtureFile('lines.csv')], mapping),
    ).rejects.toThrow(/one data file at a time.*"points.csv", "lines.csv"/);
    await expect(
      engine.importFiles([fixtureFile('points.csv'), fixtureFile('lines.csv')], mapping),
    ).rejects.toBeInstanceOf(TypeError);
    expect(engine.datasets()).toEqual([]);
  });

  it('refuses a mapping that is not a mapping, as misuse', async () => {
    const engine = start();
    const notAMapping = {} as unknown as ImportMapping;
    await expect(engine.importFiles([bigPointsCsv(2)], notAMapping)).rejects.toBeInstanceOf(
      EngineError,
    );
  });
});

describe('progress and stopping an import', () => {
  it('reports reading, parsing and validating, each from the start, before it resolves', async () => {
    const engine = start();
    const seen: ImportProgress[] = [];
    let resolved = false;
    const importing = engine
      .importFiles([bigPointsCsv(150_000)], pointsMapping('big'), {
        onProgress: (progress) => {
          expect(resolved).toBe(false);
          seen.push(progress);
        },
      })
      .then((result) => {
        resolved = true;
        return result;
      });
    expect((await importing).status).toBe('loaded');
    expect(seen[0]).toEqual({ phase: 'reading', fraction: 0 });
    expect([...new Set(seen.map((p) => p.phase))]).toEqual(['reading', 'parsing', 'validating']);
    for (const phase of IMPORT_PHASES) {
      const fractions = seen.filter((p) => p.phase === phase).map((p) => p.fraction);
      expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    }
    expect(engine.datasets()[0]?.elementCount).toBe(150_000);
  });

  it('stops when aborted, drops what it had read, and can import again', async () => {
    const engine = start();
    let announced = 0;
    engine.on('datasets', () => {
      announced += 1;
    });
    const controller = new AbortController();
    const importing = engine.importFiles([bigPointsCsv(150_000)], pointsMapping('big'), {
      signal: controller.signal,
      onProgress: ({ phase }) => {
        if (phase === 'parsing') {
          controller.abort();
        }
      },
    });
    await expect(importing).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.datasets()).toEqual([]);
    expect(announced).toBe(0);
    const again = await engine.importFiles([bigPointsCsv(5)], pointsMapping('small'));
    expect(again.status).toBe('loaded');
    expect(engine.datasets().map((d) => d.elementCount)).toEqual([5]);
  });

  it('does not start when the signal is already aborted', async () => {
    const engine = start();
    const importing = engine.importFiles([bigPointsCsv(5)], pointsMapping('small'), {
      signal: AbortSignal.abort(),
    });
    await expect(importing).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.datasets()).toEqual([]);
  });
});
