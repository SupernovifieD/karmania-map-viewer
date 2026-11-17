// Writes the type declarations of the viewer's library build (brief 23.2), after `vite build`: `packages/viewer/dist/karmania-viewer.d.ts`, and under `dist/types/` the
// declarations that it needs. It uses the TypeScript that the repository has (no new dependency), and does what the packages of a monorepo need and the compiler does not:
//
// - `@karmania/engine`, `@karmania/scene`, ... are workspace packages that a page that embeds the viewer does not have, so each such import is rewritten to a relative path
//   (the tree under `types/` has the layout of `packages/`: `types/viewer/src/...`, `types/engine/src/...`);
// - only the declarations that the entry reaches are written (the compiler writes one for every file of the program, the viewer's own internals among them);
// - what the declarations import from outside (`lit`, ...) is printed, since a page that has the types needs the packages.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = join(root, 'packages');
const viewer = join(packages, 'viewer');
// The folder of the build (`dist` of the package, or the one that is the first argument: the tests build into a folder of their own).
const dist = process.argv[2] === undefined ? join(viewer, 'dist') : resolve(process.argv[2]);
const types = join(dist, 'types');
const entry = join(viewer, 'src', 'index.ts');

const read = ts.readConfigFile(join(viewer, 'tsconfig.json'), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(read.config, ts.sys, viewer);
const options = {
  ...config.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  declarationMap: false,
  sourceMap: false,
  outDir: types,
  // The tree under `types/` is the tree under `packages/`.
  rootDir: packages,
  // What a doc comment marks `@internal` (the members that tests and the app's own code use, typed with the renderer's types) is not in the declarations.
  stripInternal: true,
};

// The entry, and the ambient declarations of the package (`src/vite-env.d.ts`, which gives the types of `import x from 'file.svg?raw'` to the sources that do).
const ambient = config.fileNames.filter((name) => name.endsWith('.d.ts'));
let roots = [entry, ...ambient];
let program = ts.createProgram({ rootNames: roots, options });
// The compiler writes no declaration for a file that it found through `node_modules`, and the workspace's packages are there (as links): so each file of `packages/` that
// it found that way becomes a root of the program, until there are none.
for (;;) {
  const linked = program
    .getSourceFiles()
    .filter(
      (file) =>
        file.fileName.startsWith(packages + sep) &&
        program.isSourceFileFromExternalLibrary(file) &&
        !roots.includes(file.fileName),
    )
    .map((file) => file.fileName);
  if (linked.length === 0) {
    break;
  }
  roots = [...roots, ...linked];
  program = ts.createProgram({ rootNames: roots, options, oldProgram: program });
}
const problems = ts.getPreEmitDiagnostics(program);
if (problems.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(problems, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
  throw new Error(
    `${problems.length} errors in the program of ${entry}: the declarations are not written.`,
  );
}

/** The declarations as the compiler writes them, by the path they would have, and what each imports (the paths of other declarations, and the names of packages). */
const written = new Map();
const imports = new Map();

/** The path from the declaration of `from` to the declaration of the file `to`, as it is written in an import. */
function pathBetween(from, to) {
  const path = relative(dirname(from), to).split(sep).join(posix.sep).replace(/\.ts$/, '.js');
  return path.startsWith('.') ? path : `./${path}`;
}

/** The transformer that runs on every declaration file: rewrites the imports of the workspace's packages, and records what each file imports. */
const rewriting = (context) => (file) => {
  if (!ts.isSourceFile(file)) {
    return file;
  }
  const from = ts.getOriginalNode(file).fileName;
  const found = { relative: new Set(), packages: new Set() };
  imports.set(from, found);
  /** The specifier as the declaration should have it. */
  const specifier = (name) => {
    if (name.startsWith('@karmania/')) {
      const resolved = ts.resolveModuleName(name, from, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (resolved === undefined || !resolved.startsWith(packages)) {
        throw new Error(`${from} imports ${name}, which is not one of the workspace's packages.`);
      }
      name = pathBetween(from, resolved);
    }
    if (name.startsWith('.')) {
      found.relative.add(name);
    } else {
      found.packages.add(name);
    }
    return name;
  };
  const visit = (node) => {
    // An import with nothing named (`import './map-area.js'`) defines an element in the sources. In a declaration it would only load the declaration of an element that nobody
    // outside uses, with whatever that one imports: it goes.
    if (ts.isImportDeclaration(node) && node.importClause === undefined) {
      return undefined;
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const name = specifier(node.moduleSpecifier.text);
      const literal = ts.factory.createStringLiteral(name, true);
      return ts.isImportDeclaration(node)
        ? ts.factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            literal,
            node.attributes,
          )
        : ts.factory.updateExportDeclaration(
            node,
            node.modifiers,
            node.isTypeOnly,
            node.exportClause,
            literal,
            node.attributes,
          );
    }
    // `import('@karmania/engine').Engine`, which the compiler writes for a type it can not name otherwise.
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const name = specifier(node.argument.literal.text);
      const argument = ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(name, true));
      return ts.factory.updateImportTypeNode(
        node,
        argument,
        node.attributes,
        node.qualifier,
        node.typeArguments,
        node.isTypeOf,
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return ts.visitNode(file, visit);
};

const result = program.emit(undefined, (path, text) => written.set(path, text), undefined, true, {
  afterDeclarations: [rewriting],
});
if (result.emitSkipped || written.size === 0) {
  throw new Error('The compiler wrote no declarations.');
}

// What the entry reaches, by the imports of each declaration (a `./x.js` is `x.d.ts`).
const declarationOf = (source) => join(types, relative(packages, source)).replace(/\.ts$/, '.d.ts');
const entryDeclaration = declarationOf(entry);
const needed = new Set([entryDeclaration]);
const outside = new Set();
for (const path of needed) {
  const source = [...imports.keys()].find((name) => declarationOf(name) === path);
  if (source === undefined) {
    throw new Error(`${path} is imported, and the compiler has not written it.`);
  }
  const found = imports.get(source);
  for (const name of found.packages) {
    outside.add(name);
  }
  for (const name of found.relative) {
    needed.add(declarationOf(join(dirname(source), name.replace(/\.js$/, '.ts'))));
  }
}

rmSync(types, { recursive: true, force: true });
for (const path of needed) {
  const text = written.get(path);
  if (text === undefined) {
    throw new Error(`${path} is needed, and the compiler has not written it.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const main = join(dist, 'karmania-viewer.d.ts');
writeFileSync(
  main,
  `export * from './${posix.join('types', relative(types, entryDeclaration).split(sep).join(posix.sep)).replace(/\.d\.ts$/, '.js')}';\n`,
);

console.log(
  `declarations: ${needed.size} of the ${written.size} that the compiler wrote, from ${relative(root, main)}`,
);
console.log(`needs the types of: ${[...outside].sort().join(', ') || 'nothing'}`);
