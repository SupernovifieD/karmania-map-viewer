/**
 * `migrate`: a scene document from outside, brought to the version this package reads. Version 1 is the only
 * version there has been, so for now it accepts a document of version 1 and nothing else; when a version 2
 * exists, the steps from 1 to 2 are added here, and a document of version 1 is migrated, and checked, as it
 * is read.
 */
import type { SceneProblem } from './problems.js';
import type { SceneDocument } from './types.js';
import { isSceneDocument, validateScene } from './validate.js';

/** What `migrate` made of a document. */
export type MigrateResult =
  | {
      readonly status: 'ok';
      /** The document of the current version: the very object that was given, when it already was one. */
      readonly doc: SceneDocument;
      /** The version it was before. */
      readonly from: number;
    }
  | {
      readonly status: 'failed';
      /** Why it is not a document this package can read; see `validateScene`. */
      readonly problems: readonly SceneProblem[];
    };

/**
 * Brings `doc` to the current version and checks it. Never throws, and never changes `doc`: a document that is
 * not usable comes back as the problems, as `validateScene` lists them, and a version that is not known (newer
 * than this package, or not a version at all) is one of them.
 */
export function migrate(doc: unknown): MigrateResult {
  if (isSceneDocument(doc)) {
    return { status: 'ok', doc, from: doc.version };
  }
  return { status: 'failed', problems: validateScene(doc) };
}
