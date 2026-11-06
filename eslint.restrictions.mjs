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

const PATH_IMPORT = {
  regex: `^(\\.\\./)+(packages/)?(${PACKAGES.join('|')})(/|$)`,
  message: 'Import another package by its name, not by its path.',
};

const NO_THREE = { group: ['three', 'three/*'], message: 'three stays behind @karmania/render.' };

const NO_LIT = {
  group: ['lit', 'lit/*', '@lit/*', '@lit-labs/*'],
  message: 'This package has no Lit: it has no components.',
};

/** A block of config: these files may not import what the patterns say, and `types` only as types. */
function block(files, patterns) {
  return {
    files,
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
    },
  };
}

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
  // The app's tests and tools may look inside the viewer (a test of the wizard's wording does), and nothing else.
  block(['packages/app/e2e/**/*.{ts,mts}', 'packages/app/*.config.ts'], [PATH_IMPORT, NO_THREE]),
];
