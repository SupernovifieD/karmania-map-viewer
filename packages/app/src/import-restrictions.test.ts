/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The blocks of config that say which package may import which, as the repository's config has them. */
const { importRestrictions } = (await import(
  new URL('eslint.restrictions.mjs', `file://${root}`).href
)) as {
  importRestrictions: Linter.Config[];
};

const linter = new Linter({ cwd: root, configType: 'flat' });
const config: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  ...importRestrictions,
];

/** The rules of the restrictions: the import rule, the one on `import()` and `require()`, and the one on `import { type X }`. */
const RULES = new Set([
  '@typescript-eslint/no-restricted-imports',
  'no-restricted-syntax',
  '@typescript-eslint/no-import-type-side-effects',
]);

/**
 * What the rules say of `statement`, written in `file`: the messages of the import restrictions. A statement that does not
 * parse is a failure of the test, since the rules say nothing of what they cannot read, and so would "allow" it.
 */
function said(file: string, statement: string): string[] {
  const messages = linter.verify(statement, config, { filename: `${root}${file}` });
  expect(
    messages.filter((message) => message.fatal === true).map((message) => message.message),
    `${file}: ${statement}`,
  ).toEqual([]);
  return messages
    .filter((message) => message.ruleId !== null && RULES.has(message.ruleId))
    .map((message) => message.message);
}

const allowed = (file: string, statement: string): void => {
  expect(said(file, statement), `${file}: ${statement}`).toEqual([]);
};
const refused = (file: string, statement: string, words: string): void => {
  const messages = said(file, statement);
  expect(messages, `${file}: ${statement}`).toHaveLength(1);
  expect(messages[0], `${file}: ${statement}`).toContain(words);
};

describe('the direction of the imports between packages', () => {
  it('lets the engine and the ui depend on no other package', () => {
    refused('packages/engine/src/a.ts', "import { x } from '@karmania/ui';", 'depends on no other');
    refused(
      'packages/engine/src/a.ts',
      "import type { X } from '@karmania/scene';",
      'no other package',
    );
    refused('packages/ui/src/a.ts', "import { x } from '@karmania/engine';", 'depends on no other');
    refused(
      'packages/ui/src/a.ts',
      "import { x } from '@karmania/viewer/drag';",
      'no other package',
    );
    allowed('packages/ui/src/a.ts', "import { css } from 'lit';");
    allowed('packages/engine/src/a.ts', "import { x } from './b.js';");
  });

  it('lets the scene name the types of the engine, and nothing else of it, and nothing else at all', () => {
    allowed('packages/scene/src/a.ts', "import type { X } from '@karmania/engine/types';");
    // Under `verbatimModuleSyntax` that is emitted as `import {} from '...'`, which loads the module.
    refused(
      'packages/scene/src/a.ts',
      "import { type X } from '@karmania/engine/display';",
      'side effect import',
    );
    refused(
      'packages/render/src/a.ts',
      "import { type X } from '@karmania/scene';",
      'side effect import',
    );
    allowed('packages/viewer/src/a.ts', "import { type X } from '@karmania/scene';");
    refused(
      'packages/scene/src/a.ts',
      "import { createEngine } from '@karmania/engine';",
      'types of the engine',
    );
    refused(
      'packages/scene/src/a.ts',
      "import { x, type X } from '@karmania/engine/types';",
      'types of the engine',
    );
    refused(
      'packages/scene/src/a.ts',
      "import { kButton } from '@karmania/ui';",
      'nothing but the engine',
    );
    refused(
      'packages/scene/src/a.ts',
      "import type { Viewer } from '@karmania/viewer';",
      'nothing but the engine',
    );
    refused('packages/scene/src/a.ts', "import { css } from 'lit';", 'no Lit');
    refused('packages/scene/src/a.ts', "import { Scene } from 'three';", 'behind @karmania/render');
  });

  it('lets the renderer name the types of the scene and the engine, have three, and have no Lit and no ui', () => {
    allowed('packages/render/src/a.ts', "import type { Camera2d } from '@karmania/scene';");
    allowed(
      'packages/render/src/a.ts',
      "import type { RenderBuffers } from '@karmania/engine/display';",
    );
    allowed('packages/render/src/a.ts', "import { Scene } from 'three';");
    allowed('packages/render/src/a.ts', "import { WebGLRenderer } from 'three/src/Three.js';");
    refused(
      'packages/render/src/a.ts',
      "import { classColours } from '@karmania/scene';",
      'types of the scene and the engine',
    );
    refused(
      'packages/render/src/a.ts',
      "import { createEngine } from '@karmania/engine';",
      'types of the scene and the engine',
    );
    refused(
      'packages/render/src/a.ts',
      "import { kButton } from '@karmania/ui';",
      'depends on the scene and the engine',
    );
    refused(
      'packages/render/src/a.ts',
      "import { createViewer } from '@karmania/viewer';",
      'depends on the scene and the engine',
    );
    refused('packages/render/src/a.ts', "import { LitElement } from 'lit';", 'no Lit');
  });

  it('lets the viewer use the renderer, the scene, the engine and the ui, and not the app, and not three', () => {
    for (const name of ['render', 'scene', 'engine', 'ui']) {
      allowed('packages/viewer/src/a.ts', `import { x } from '@karmania/${name}';`);
    }
    allowed('packages/viewer/src/a.ts', "import { x } from '@karmania/engine/display';");
    refused('packages/viewer/src/a.ts', "import { x } from '@karmania/app';", 'used by the app');
    refused(
      'packages/viewer/src/a.ts',
      "import { Scene } from 'three';",
      'behind @karmania/render',
    );
  });

  it('lets the app use the ui and the entry of the viewer, and nothing inside the viewer or beyond it', () => {
    allowed('packages/app/src/a.ts', "import { createViewer } from '@karmania/viewer';");
    allowed('packages/app/src/a.ts', "import { kButton } from '@karmania/ui';");
    refused(
      'packages/app/src/a.ts',
      "import { x } from '@karmania/viewer/drag';",
      'entry of the viewer',
    );
    refused(
      'packages/app/src/a.ts',
      "import { createEngine } from '@karmania/engine';",
      'through the viewer',
    );
    refused('packages/app/src/a.ts', "import { x } from '@karmania/scene';", 'through the viewer');
    refused('packages/app/src/a.ts', "import { x } from '@karmania/render';", 'through the viewer');
  });

  it('lets the tests of the app look inside the viewer, which its source may not', () => {
    allowed('packages/app/e2e/a.e2e.ts', "import { x } from '@karmania/viewer/import-mapping';");
  });

  it('refuses to import a package of the workspace, three or Lit by `import()`, `require()` or `import(...).T`, which the import rule does not see', () => {
    const dynamic = 'static import';
    refused('packages/scene/src/a.ts', "const x = await import('@karmania/engine');", dynamic);
    refused('packages/viewer/src/a.ts', "const x = await import('three');", dynamic);
    refused('packages/viewer/src/a.ts', "const x = await import('@karmania/app');", dynamic);
    refused('packages/engine/src/a.ts', "const x = require('@karmania/ui');", dynamic);
    refused('packages/render/src/a.ts', "const x = await import('lit/decorators.js');", dynamic);
    refused('packages/scene/src/a.ts', "const x = await import('lit-html');", dynamic);
    refused(
      'packages/scene/src/a.ts',
      "const x = await import('lit-element/lit-element.js');",
      dynamic,
    );
    refused('packages/scene/src/a.ts', "const x = await import('@lit/reactive-element');", dynamic);
    refused('packages/scene/src/a.ts', "const x = await import('@lit-labs/ssr');", dynamic);
    refused('packages/scene/src/a.ts', "let x: import('lit-html').Foo;", dynamic);
    refused('packages/scene/src/a.ts', "let x: import('@lit/reactive-element').Foo;", dynamic);
    // A template with no substitution is a string, and one that starts with a package is refused too.
    refused('packages/scene/src/a.ts', 'const x = await import(`@karmania/engine`);', dynamic);
    refused('packages/viewer/src/a.ts', 'const x = await import(`three`);', dynamic);
    refused('packages/scene/src/a.ts', 'let x: import(`@karmania/ui`).Button;', dynamic);
    allowed('packages/viewer/src/a.ts', 'const x = await import(`./b.js`);');
    allowed('packages/viewer/src/a.ts', "const x = await import('react');");
    allowed('packages/viewer/src/a.ts', "const x = await import('literal');");
    refused('packages/app/src/a.ts', "const x = await import('@karmania/viewer/drag');", dynamic);
    refused('packages/scene/src/a.ts', "let x: import('@karmania/ui').Button;", dynamic);
    refused('packages/app/e2e/a.e2e.ts', "const x = await import('three');", dynamic);
    // Files of the package itself, and a specifier that is worked out, are not packages and are not looked at.
    allowed('packages/viewer/src/a.ts', "const x = await import('./b.js');");
    allowed('packages/viewer/src/a.ts', 'const x = await import(name);');
    allowed('packages/viewer/src/a.ts', "const x = await import('node:fs');");
  });

  it('holds the tests and tools of the app to what its source is held to, except for looking inside the viewer', () => {
    refused(
      'packages/app/e2e/a.e2e.ts',
      "import { Scene } from 'three';",
      'behind @karmania/render',
    );
    refused(
      'packages/app/e2e/a.e2e.ts',
      "import { x } from '@karmania/engine';",
      'through the viewer',
    );
    refused(
      'packages/app/vite.config.ts',
      "import { x } from '@karmania/scene';",
      'through the viewer',
    );
    allowed('packages/app/e2e/a.e2e.ts', "import { x } from '@karmania/ui';");
  });

  it('does not take a statement that does not parse for one that is allowed: the rules say nothing of what they cannot read', () => {
    // `said` fails the test on a parsing error, which is what `toThrow` sees.
    expect(() => said('packages/render/src/a.ts', "import {{ Scene } from 'three';")).toThrow(
      'import {{ Scene',
    );
  });

  it('refuses a path into another package, from any of them, and allows the paths inside one', () => {
    refused('packages/viewer/src/a.ts', "import { x } from '../../app/src/app.js';", 'by its name');
    refused(
      'packages/scene/src/a.ts',
      "import { x } from '../../engine/src/types.js';",
      'by its name',
    );
    refused(
      'packages/app/e2e/support/a.ts',
      "import { x } from '../../../viewer/src/a.js';",
      'by its name',
    );
    refused(
      'packages/app/src/a.ts',
      "import { x } from '../../../packages/viewer/src/a.js';",
      'by its name',
    );
    refused('packages/app/src/a.ts', "import { x } from './../../viewer/src/a.js';", 'by its name');
    refused(
      'packages/viewer/src/a.ts',
      "import { x } from '/work/karmania/packages/engine/src/a.js';",
      'by its name',
    );
    allowed('packages/app/e2e/a.e2e.ts', "import { x } from '../src/theme.js';");
    allowed('packages/viewer/src/a.ts', "import { x } from './b.js';");
    allowed('packages/viewer/src/a.ts', "import { x } from '../package.json';");
  });
});
