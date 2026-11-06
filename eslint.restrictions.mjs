/**
 * Which package may import which (section 5.2 of the Phase 2 brief): app → viewer → (render, scene, engine, ui);
 * render depends on the types of scene and engine and nothing else; scene on the types of engine and nothing else;
 * three stays behind render; render and scene have no Lit. One block of flat config for each package, so that the rules
 * of a package are all in one place; a test (`packages/app/src/import-restrictions.test.ts`) lints sample imports
 * against exactly these blocks.
 */

/** The packages of the workspace. */
const PACKAGES = ['engine', 'ui', 'scene', 'render', 'viewer', 'app'];

/** A package by its name, and every path inside it. */
const named = (...names) => names.flatMap((name) => [`@karmania/${name}`, `@karmania/${name}/*`]);

/** The packages other than these. */
const except = (...names) => named(...PACKAGES.filter((name) => !names.includes(name)));

/** A path into another package: up and then down into it, or any path that goes through `packages/<package>/`. */
const PATH_IMPORT = {
  regex: `^(\\./)?(\\.\\./)+(packages/)?(${PACKAGES.join('|')})(/|$)|/packages/(${PACKAGES.join('|')})/`,
  message: 'Import another package by its name, not by its path.',
};

const NO_THREE = { group: ['three', 'three/*'], message: 'three stays behind @karmania/render.' };

const NO_LIT = {
  group: [
    'lit',
    'lit/*',
    'lit-html',
    'lit-html/*',
    'lit-element',
    'lit-element/*',
    '@lit/*',
    '@lit-labs/*',
  ],
  message: 'This package has no Lit: it has no components.',
};

/**
 * What `import()`, `require()` and `import('x').T` may not name: a workspace package, three or Lit. The rule above sees
 * only static imports, so a package is imported statically, where the direction of the dependencies can be checked.
 */
const DYNAMIC = '^(@karmania\\/|three($|\\/)|lit($|\\/))';
const STATIC_ONLY =
  'Import a package with a static import: the direction of the dependencies is checked there.';
const NO_DYNAMIC = [
  { selector: `ImportExpression[source.value=/${DYNAMIC}/]`, message: STATIC_ONLY },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=/${DYNAMIC}/]`,
    message: STATIC_ONLY,
  },
  { selector: `TSImportType[argument.literal.value=/${DYNAMIC}/]`, message: STATIC_ONLY },
];

/**
 * A block of config: these files may not import what the patterns say, `types` only as types. `extra` is more rules
 * for the same files.
 */
function block(files, patterns, extra = {}) {
  return {
    files,
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
      'no-restricted-syntax': ['error', ...NO_DYNAMIC],
      ...extra,
    },
  };
}

/**
 * With `verbatimModuleSyntax`, `import { type X } from 'm'` is emitted as `import {} from 'm'`, which loads `m`: where only the
 * types of a package may be named, a type import is `import type { X } from 'm'`.
 */
const TYPES_ONLY_AS_TYPES = { '@typescript-eslint/no-import-type-side-effects': 'error' };

export const importRestrictions = [
  block(
    ['packages/engine/**/*.{ts,mts}'],
    [
      PATH_IMPORT,
      NO_THREE,
      NO_LIT,
      { group: except('engine'), message: 'The engine depends on no other package.' },
    ],
  ),
  block(
    ['packages/ui/**/*.{ts,mts}'],
    [
      PATH_IMPORT,
      NO_THREE,
      { group: except('ui'), message: 'The ui depends on no other package.' },
    ],
  ),
  block(
    ['packages/scene/**/*.{ts,mts}'],
    [
      PATH_IMPORT,
      NO_THREE,
      NO_LIT,
      { group: except('scene', 'engine'), message: 'The scene depends on nothing but the engine.' },
      {
        group: named('engine'),
        allowTypeImports: true,
        message: 'The scene names the types of the engine and nothing else of it.',
      },
    ],
    TYPES_ONLY_AS_TYPES,
  ),
  block(
    ['packages/render/**/*.{ts,mts}'],
    [
      PATH_IMPORT,
      NO_LIT,
      {
        group: except('render', 'scene', 'engine'),
        message: 'The renderer depends on the scene and the engine, and on no other package.',
      },
      {
        group: named('scene', 'engine'),
        allowTypeImports: true,
        message:
          'The renderer names the types of the scene and the engine and nothing else of them.',
      },
    ],
    TYPES_ONLY_AS_TYPES,
  ),
  block(
    ['packages/viewer/**/*.{ts,mts}'],
    [
      PATH_IMPORT,
      NO_THREE,
      { group: named('app'), message: 'The viewer is used by the app, not the other way round.' },
    ],
  ),
  block(
    ['packages/app/src/**/*.{ts,mts}'],
    [
      PATH_IMPORT,
      NO_THREE,
      {
        group: named('engine', 'scene', 'render'),
        message: 'The app reaches the engine, the scene and the renderer through the viewer.',
      },
      {
        group: ['@karmania/viewer/*'],
        message: 'The app uses the entry of the viewer, `@karmania/viewer`, and nothing inside it.',
      },
    ],
  ),
  // The app's tests and tools may look inside the viewer (a test of the wizard's wording does), and, like its source,
  // reach the engine, the scene and the renderer through the viewer only.
  block(
    ['packages/app/e2e/**/*.{ts,mts}', 'packages/app/*.config.ts'],
    [
      PATH_IMPORT,
      NO_THREE,
      {
        group: named('engine', 'scene', 'render'),
        message: 'The app reaches the engine, the scene and the renderer through the viewer.',
      },
    ],
  ),
];
