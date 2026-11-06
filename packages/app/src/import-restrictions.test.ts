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

/** What the rules say of `statement`, written in `file`: the messages of the import restrictions. */
function said(file: string, statement: string): string[] {
  return linter
    .verify(statement, config, { filename: `${root}${file}` })
    .filter((message) => message.ruleId === '@typescript-eslint/no-restricted-imports')
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
    allowed('packages/scene/src/a.ts', "import { type X } from '@karmania/engine/display';");
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
    allowed('packages/app/e2e/a.e2e.ts', "import { x } from '../src/theme.js';");
    allowed('packages/viewer/src/a.ts', "import { x } from './b.js';");
    allowed('packages/viewer/src/a.ts', "import { x } from '../package.json';");
  });
});
