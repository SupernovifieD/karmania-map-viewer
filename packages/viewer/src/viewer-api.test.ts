import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import viewerSource from './create-viewer.ts?raw';
import exportSource from './export-compose.ts?raw';
import { createViewer } from './index.js';
import type {
  Command,
  DatasetInput,
  Engine,
  ExportPngOptions,
  ExportPngRun,
  ImportMapping,
  ImportOptions,
  LoadOptions,
  LoadResult,
  SceneDocument,
  SceneSelection,
  Summary,
  Viewer,
  ViewerEvent,
  ViewerEvents,
  ViewerOptions,
  ViewMode,
} from './index.js';

/*
 * The Viewer API of brief 11.8, as a page that embeds the viewer sees it. The types are checked by `tsc` (these files are part of `pnpm typecheck`):
 * a change of the API that is not meant fails there, and a mistake that the API must refuse is a line that `@ts-expect-error` says is an error.
 * The functions are never called: they are only read by the compiler.
 */

describe('the types of the Viewer API', () => {
  it('createViewer takes a container and options that are all optional, and gives a Viewer', () => {
    expectTypeOf(createViewer).parameter(0).toEqualTypeOf<HTMLElement>();
    expectTypeOf(createViewer).parameter(1).toEqualTypeOf<ViewerOptions | undefined>();
    expectTypeOf(createViewer).returns.toEqualTypeOf<Viewer>();
    expectTypeOf<ViewerOptions>().toEqualTypeOf<{
      readonly engine?: Engine;
      readonly panel?: boolean;
      readonly importUi?: boolean;
    }>();
    const refused = (container: HTMLElement): void => {
      // @ts-expect-error The viewer has no such option.
      createViewer(container, { theme: 'dark' });
      // @ts-expect-error `panel` is a boolean.
      createViewer(container, { panel: 'no' });
      // @ts-expect-error `engine` is an engine, not a name for one.
      createViewer(container, { engine: 'shared' });
      // @ts-expect-error A viewer is put in a container.
      createViewer();
    };
    expect(refused).toBeTypeOf('function');
  });

  it('has the members of brief 11.8, with the types that the brief gives them', () => {
    expectTypeOf<Viewer['engine']>().toEqualTypeOf<Engine>();
    expectTypeOf<Viewer['load']>().toEqualTypeOf<
      (input: DatasetInput, options?: LoadOptions) => Promise<LoadResult>
    >();
    expectTypeOf<Viewer['importFiles']>().toEqualTypeOf<
      (
        files: readonly File[],
        mapping: ImportMapping,
        options?: ImportOptions,
      ) => Promise<LoadResult>
    >();
    expectTypeOf<Viewer['openImport']>().toEqualTypeOf<(files?: readonly File[]) => void>();
    expectTypeOf<Viewer['openExport']>().toEqualTypeOf<() => void>();
    expectTypeOf<Viewer['openMapCrs']>().toEqualTypeOf<() => void>();
    expectTypeOf<Viewer['setViewMode']>().toEqualTypeOf<(mode: ViewMode) => void>();
    expectTypeOf<Viewer['fit']>().toEqualTypeOf<() => void>();
    expectTypeOf<Viewer['scene']>().toEqualTypeOf<() => SceneDocument>();
    expectTypeOf<Viewer['dispatch']>().toEqualTypeOf<(command: Command) => SceneDocument>();
    expectTypeOf<Viewer['exportPng']>().toEqualTypeOf<
      (options: ExportPngOptions, run?: ExportPngRun) => Promise<Blob>
    >();
    expectTypeOf<Viewer['dispose']>().toEqualTypeOf<() => void>();
    expectTypeOf<ExportPngOptions>().toEqualTypeOf<{
      readonly widthPx: number;
      readonly heightPx: number;
      readonly dpi: number;
      readonly legend: boolean;
    }>();
    expectTypeOf<ExportPngRun>().toEqualTypeOf<{
      readonly signal?: AbortSignal;
      readonly onProgress?: (done: number) => void;
    }>();
  });

  it('listens by the name of the event, and the listener is given what that event tells', () => {
    expectTypeOf<ViewerEvent>().toEqualTypeOf<'scene' | 'datasets' | 'selection'>();
    expectTypeOf<ViewerEvents>().toEqualTypeOf<{
      readonly scene: SceneDocument;
      readonly datasets: readonly Summary[];
      readonly selection: SceneSelection | null;
    }>();
    const listening = (viewer: Viewer, engine: Engine): void => {
      viewer.on('scene', (scene) => {
        expectTypeOf(scene).toEqualTypeOf<SceneDocument>();
      });
      viewer.on('datasets', (datasets) => {
        expectTypeOf(datasets).toEqualTypeOf<readonly Summary[]>();
      });
      viewer.on('selection', (selection) => {
        expectTypeOf(selection).toEqualTypeOf<SceneSelection | null>();
      });
      expectTypeOf(viewer.on('scene', () => undefined)).toEqualTypeOf<() => void>();
      // @ts-expect-error There is no such event.
      viewer.on('pointer', () => undefined);
      // @ts-expect-error The listener of `selection` is given a selection, not a scene.
      viewer.on('selection', (scene: SceneDocument) => scene);
      // @ts-expect-error The engine of a viewer is read, not replaced.
      viewer.engine = engine;
    };
    expect(listening).toBeTypeOf('function');
  });
});

describe('the doc comments of the Viewer API', () => {
  const read = (name: string, text: string): ts.SourceFile =>
    ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);

  /** What has no comment above it: the names of the members of the interfaces of the API, and the function that makes a viewer. */
  const undocumented = (source: ts.SourceFile, interfaces: readonly string[]): string[] => {
    const missing: string[] = [];
    const documented = (node: ts.Node): boolean =>
      ts
        .getJSDocCommentsAndTags(node)
        .some(
          (doc) =>
            ts.isJSDoc(doc) &&
            (typeof doc.comment === 'string'
              ? doc.comment
              : (doc.comment?.map((part) => part.text).join('') ?? '')
            ).trim() !== '',
        );
    ts.forEachChild(source, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'createViewer') {
        if (!documented(node)) {
          missing.push('createViewer');
        }
      }
      if (ts.isInterfaceDeclaration(node) && interfaces.includes(node.name.text)) {
        if (!documented(node)) {
          missing.push(node.name.text);
        }
        for (const member of node.members) {
          if (!documented(member)) {
            missing.push(`${node.name.text}.${member.name?.getText() ?? '?'}`);
          }
        }
      }
    });
    return missing;
  };

  it('is there for every member of the Viewer, its options, its events, the export options, and for createViewer', () => {
    const viewer = read('create-viewer.ts', viewerSource);
    expect(undocumented(viewer, ['Viewer', 'ViewerOptions', 'ViewerEvents'])).toEqual([]);
    const exported = read('export-compose.ts', exportSource);
    expect(undocumented(exported, ['ExportPngOptions', 'ExportPngRun'])).toEqual([]);
  });

  it('is found by this check: a member with none is reported', () => {
    // The check is only as good as its finding of a missing comment: it must find one where there is none.
    const source = read(
      'a.ts',
      '/** An interface. */\ninterface A {\n  /** Said. */\n  said: number;\n  unsaid: number;\n}\n',
    );
    expect(undocumented(source, ['A'])).toEqual(['A.unsaid']);
  });
});
