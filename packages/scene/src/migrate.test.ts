import { describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { ABSENT, frozen, sampleScene, spoil } from './test-support/documents.js';

describe('migrate', () => {
  it('gives back a document of version 1 that is right, the very object, and says it was version 1', () => {
    const doc = sampleScene();
    const result = migrate(doc);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.doc).toBe(doc);
    expect(result.status === 'ok' && result.from).toBe(1);
  });

  it('accepts what JSON made of a document, which is how an embedder keeps one', () => {
    const result = migrate(JSON.parse(JSON.stringify(sampleScene())));
    expect(result.status).toBe('ok');
  });

  it('does not change what it is given, even a frozen document, right or wrong', () => {
    expect(migrate(frozen(sampleScene())).status).toBe('ok');
    const wrong = frozen(spoil(sampleScene(), ['viewMode'], 'x'));
    expect(migrate(wrong).status).toBe('failed');
  });

  it('refuses a version that it does not know, with the problem that says so and no other', () => {
    const newer = migrate({ ...sampleScene(), version: 2 });
    expect(newer).toEqual({
      status: 'failed',
      problems: [
        {
          path: 'version',
          code: 'version',
          message: 'version is 2, which is newer than this viewer reads (1).',
        },
      ],
    });
    for (const version of [0, -1, 1.5, '1', null, true]) {
      const result = migrate({ ...sampleScene(), version });
      expect(result.status === 'failed' && result.problems.map((p) => p.code)).toEqual(['version']);
    }
    const missing = migrate(spoil(sampleScene(), ['version'], ABSENT));
    expect(missing.status === 'failed' && missing.problems.map((p) => p.code)).toEqual(['missing']);
  });

  it('refuses a document of version 1 that is wrong, with every problem validateScene lists', () => {
    let doc: unknown = sampleScene();
    doc = spoil(doc, ['camera3d', 'fov'], 180);
    doc = spoil(doc, ['layers', 'layer-2', 'style', 'opacity'], 2);
    const result = migrate(doc);
    expect(result.status === 'failed' && result.problems.map((p) => p.path)).toEqual([
      'camera3d.fov',
      'layers.layer-2.style.opacity',
    ]);
  });

  it('refuses what is not a document at all, and does not throw', () => {
    for (const nothing of [undefined, null, 0, 'scene', [], () => 0]) {
      expect(migrate(nothing).status).toBe('failed');
    }
  });
});
