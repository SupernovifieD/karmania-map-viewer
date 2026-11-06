/** Public name of this package. */
export const PACKAGE_NAME = '@karmania/scene';

export { contrastRatio, mix, parseHex, relativeLuminance, toHex } from './colour.js';
export type { Rgb } from './colour.js';
export { migrate } from './migrate.js';
export type { MigrateResult } from './migrate.js';
export { isSceneDocument, validateScene } from './validate.js';
export { MAX_PROBLEMS, PROBLEM_CODES } from './problems.js';
export type { ProblemCode, SceneProblem } from './problems.js';
export { COLOUR_MODES, SCENE_VERSION, VERTICAL_EXAGGERATIONS, VIEW_MODES } from './types.js';
export type {
  Camera2d,
  Camera3d,
  ClassColour,
  ContourParams,
  DerivedLayer,
  GroupId,
  Layer,
  LayerColour,
  LayerContours,
  LayerId,
  LayerStyle,
  LegendGroupNode,
  LegendLayerNode,
  LegendNode,
  RampId,
  SceneDocument,
  SceneSelection,
  SingleColour,
  VerticalExaggeration,
  ViewMode,
} from './types.js';
