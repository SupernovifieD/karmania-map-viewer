/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The type declarations of the library build of `@karmania/viewer` (brief 23.2, `scripts/emit-declarations.mjs`), as a page that embeds the viewer sees them: the build is
 * made into a folder of its own, and a file that uses the viewer as its page would is checked by the compiler against `karmania-viewer.d.ts` and nothing else of the
 * repository (the workspace's packages are not there for that page, and three.js, which ships no types, is not in its declarations).
 */

const viewer = fileURLToPath(new URL('../../viewer/', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/emit-declarations.mjs', import.meta.url));
const copyNotices = fileURLToPath(new URL('../../../scripts/copy-notices.mjs', import.meta.url));
let out = '';

/** The files under `folder` that end in `.d.ts`, as paths from it. */
function declarations(folder: string, from = ''): string[] {
  return readdirSync(join(folder, from)).flatMap((name) => {
    const path = join(from, name);
    if (statSync(join(folder, path)).isDirectory()) {
      return declarations(folder, path);
    }
    return path.endsWith('.d.ts') ? [path] : [];
  });
}

/** What a page that embeds the viewer writes: the whole of the API once, with lines that must not compile (`@ts-expect-error` fails when the line is fine, as it is when a type is `any`). */
const consumer = `
import {
  EngineError,
  KarmaniaViewer,
  createEngine,
  createViewer,
  grid,
  points,
} from '../karmania-viewer.js';
import type {
  Command,
  DatasetInput,
  Engine,
  SceneDocument,
  SceneSelection,
  Summary,
  Viewer,
  ViewerEvents,
  ViewerOptions,
  ViewMode,
} from '../karmania-viewer.js';

const container = document.createElement('div');
const options: ViewerOptions = { engine: createEngine(), panel: false, importUi: false };
const viewer: Viewer = createViewer(container, options);

const engine: Engine = viewer.engine;
const scene: SceneDocument = viewer.scene();
const mode: ViewMode = scene.viewMode;
viewer.setViewMode(mode === '2d' ? '3d' : '2d');
viewer.fit();

const crs = { kind: 'epsg', code: 32631 } as const;
const input: DatasetInput = points({ name: 'wells', x: [1, 2], y: [3, 4], crs });
void viewer.load(input);
void viewer.load(grid({ name: 'g', origin: [0, 0, 0], spacing: [1, 1, 1], dims: [2, 2, 1], values: { depth: [1, 2, 3, 4] }, crs }));
const blob: Promise<Blob> = viewer.exportPng({ widthPx: 800, heightPx: 600, dpi: 96, legend: true });
const exportable: boolean = viewer.exportable();
const off: () => void = viewer.onExportable((available: boolean) => void available);

const stop: () => void = viewer.on('scene', (next: SceneDocument) => void next.viewMode);
viewer.on('datasets', (datasets: readonly Summary[]) => void datasets.length);
viewer.on('selection', (selection: SceneSelection | null) => void selection);
const events: keyof ViewerEvents = 'scene';
const command: Command = { type: 'setViewMode', mode: '2d' };
viewer.dispatch(command);

try {
  viewer.dispose();
} catch (error) {
  if (!(error instanceof EngineError)) throw error;
}

// The element is typed by its tag.
const element: KarmaniaViewer = document.createElement('karmania-viewer');
element.withPanel = false;
void [engine, blob, exportable, off, stop, events];

// What is not allowed.
// @ts-expect-error not an event of the viewer
viewer.on('nothing', () => undefined);
// @ts-expect-error panel is a boolean
createViewer(container, { panel: 'yes' });
// @ts-expect-error a dataset is not a number
void viewer.load(5);
// @ts-expect-error the viewer has no such member
viewer.fly();
// @ts-expect-error the members that only tests use are not in the declarations
element.renderPixels(0, 0, 1, 1);
`;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'karmania-types-'));
  return build({
    root: viewer,
    configFile: join(viewer, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true },
  }).then(() => {
    execFileSync('node', [script, out], { stdio: 'pipe' });
    execFileSync('node', [copyNotices, out], { stdio: 'pipe' });
    mkdirSync(join(out, 'consumer'));
    writeFileSync(join(out, 'consumer', 'embed.ts'), consumer);
  });
}, 180_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

/** The messages of the compiler for `file`, with where each is. */
function diagnostics(program: ts.Program): string[] {
  return ts.getPreEmitDiagnostics(program).map((item) => {
    const where =
      item.file === undefined || item.start === undefined
        ? ''
        : `${item.file.fileName.replace(out, '')}:${String(item.file.getLineAndCharacterOfPosition(item.start).line + 1)} `;
    return `${where}TS${String(item.code)} ${ts.flattenDiagnosticMessageText(item.messageText, '\n')}`;
  });
}

/**
 * The compiler's program for files of a page that has the declarations and `lit` (a dependency of the package, which the page's installer brings), and nothing of the repository
 * besides: strict, as an embedder who cares would have it.
 */
function pageProgram(rootNames: string[]): ts.Program {
  const lit = dirname(createRequire(join(viewer, 'package.json')).resolve('lit'));
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    {
      strict: true,
      noEmit: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: [],
      skipLibCheck: false,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      paths: { lit: [lit] },
    },
    out,
  );
  expect(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
  return ts.createProgram({ rootNames, options });
}

describe('the declarations of the library build of the viewer', () => {
  it('are a file of the build that names the tree under types/, which has nothing of the workspace by its name', () => {
    expect(readFileSync(join(out, 'karmania-viewer.d.ts'), 'utf8')).toBe(
      "export * from './types/viewer/src/index.js';\n",
    );
    const all = declarations(join(out, 'types'));
    expect(all.length).toBeGreaterThan(10);
    for (const path of all) {
      const code = readFileSync(join(out, 'types', path), 'utf8');
      // An import or an export from a package of the workspace (the words in a doc comment are fine), and what three.js has to say.
      expect(
        /(?:from|import\()\s*'@karmania\//.test(code),
        `${path} imports a package of the workspace`,
      ).toBe(false);
      expect(/from\s*'three'/.test(code), `${path} imports three.js`).toBe(false);
    }
  });

  it('keep the doc comments, so that an editor shows them', () => {
    const code = readFileSync(join(out, 'types', 'viewer', 'src', 'create-viewer.d.ts'), 'utf8');
    expect((code.match(/\/\*\*/g) ?? []).length).toBeGreaterThan(20);
  });

  it('let a page that has only them use the whole of the API, and refuse what is not in it', () => {
    expect(diagnostics(pageProgram([join(out, 'consumer', 'embed.ts')]))).toEqual([]);
  });

  it('are what the examples of docs/embedding.md are written against: each is a page that compiles', () => {
    const guide = readFileSync(
      fileURLToPath(new URL('../../../docs/embedding.md', import.meta.url)),
      'utf8',
    );
    // The TypeScript examples, each of them whole (a page's own file), as the guide has them in fenced blocks.
    const examples = [...guide.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(examples.length, 'the guide has no TypeScript example').toBeGreaterThanOrEqual(6);
    mkdirSync(join(out, 'guide'));
    const files = examples.map((example, index) => {
      const file = join(out, 'guide', `example-${String(index + 1)}.ts`);
      // The guide imports the module from where it says a page keeps it; here it is next to the declarations.
      const code = example
        .replaceAll("'/vendor/karmania/karmania-viewer.js'", "'../karmania-viewer.js'")
        .replaceAll("'./karmania-viewer.js'", "'../karmania-viewer.js'");
      writeFileSync(file, `${code}\nexport {};\n`);
      return file;
    });
    expect(diagnostics(pageProgram(files))).toEqual([]);
  });
});

describe('what the package publishes', () => {
  interface Manifest {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly files?: readonly string[];
    readonly publishConfig?: {
      readonly main?: string;
      readonly types?: string;
      readonly exports?: Readonly<Record<string, string | Readonly<Record<string, string>>>>;
    };
  }
  const manifest = JSON.parse(readFileSync(join(viewer, 'package.json'), 'utf8')) as Manifest;

  it('is the folder of the build, found by files that are in it, with the module and the style sheet as what a page can import', () => {
    const published = manifest.publishConfig;
    expect(manifest.files).toEqual(['dist']);
    expect(Object.keys(published?.exports ?? {})).toEqual(['.', './style.css']);
    const targets = [
      published?.main,
      published?.types,
      ...Object.values(published?.exports ?? {}).flatMap((target) =>
        typeof target === 'string' ? [target] : Object.values(target),
      ),
    ];
    expect(targets).toHaveLength(5);
    for (const target of targets) {
      expect(target?.startsWith('./dist/'), `${String(target)} is not in dist`).toBe(true);
      expect(
        existsSync(join(out, (target ?? '').slice('./dist/'.length))),
        `${String(target)} is not in the build`,
      ).toBe(true);
    }
  });

  it('needs of the workspace nothing, since the build has it all in it: a package of it that is a dependency could not be installed', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['lit']);
  });
});

describe('the licences that go with the build', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));

  it('are in the folder of the build as the files of the repository are: the notices and the licence next to the code, and the licence of the font next to the font files', () => {
    const same = (built: string, original: string): void => {
      expect(
        readFileSync(join(out, built), 'utf8') === readFileSync(join(repo, original), 'utf8'),
        `${built} is not ${original}`,
      ).toBe(true);
    };
    same('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
    same('LICENSE', 'LICENSE');
    same('assets/OFL.txt', 'packages/ui/src/fonts/OFL.txt');
    // The font files are where the licence is.
    expect(readdirSync(join(out, 'assets')).filter((name) => name.endsWith('.woff2'))).toHaveLength(
      2,
    );
  });

  it('are made by the builds of the library and of the app: both call the script that copies them', () => {
    for (const name of ['viewer', 'app']) {
      const scripts = (
        JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8')) as {
          scripts: Record<string, string>;
        }
      ).scripts;
      expect(scripts['build'], `the build of ${name}`).toContain('scripts/copy-notices.mjs');
    }
  });
});
