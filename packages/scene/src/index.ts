/** Public name of this package. */
export const PACKAGE_NAME = '@karmania/scene';

export { contrastRatio, mix, parseHex, relativeLuminance, toHex } from './colour.js';
export type { Rgb } from './colour.js';
export { RAMPS, RAMP_IDS, RAMP_KINDS, rampById, sampleRamp } from './ramps.js';
export type { Ramp, RampKind } from './ramps.js';
export {
  DEFAULT_CLASSES,
  DEFAULT_LINE_WIDTH,
  DEFAULT_METHOD,
  DEFAULT_OPACITY,
  DEFAULT_POINT_SIZE,
  DEFAULT_POLYGON_OPACITY,
  DEFAULT_RAMP,
  LAYER_COLOURS,
  defaultStyle,
  firstNumericColumn,
  layerColour,
} from './defaults.js';
export type { DatasetBrief } from './defaults.js';
export {
  addLayers,
  removeLayersOfDataset,
  setGroupVisible,
  setVisible,
} from './commands-layers.js';
export type { NewDataset } from './commands-layers.js';
export {
  createGroup,
  deleteGroup,
  moveNode,
  renameGroup,
  setGroupCollapsed,
} from './commands-legend.js';
export type { LegendPlace } from './commands-legend.js';
export { COMMAND_TYPES, applyCommand } from './commands.js';
export type { Command } from './commands.js';
export { setFrame, setSelection } from './commands-frame.js';
export {
  heldElevation,
  normalHeading,
  setCamera,
  setVerticalExaggeration,
  setViewMode,
} from './commands-view.js';
export type { CameraPatch } from './commands-view.js';
export { setContours, setStyle } from './commands-style.js';
export type { StylePatch } from './commands-style.js';
export { emptyScene } from './empty.js';
export { MAP_BACKGROUNDS, MIN_GRAPHIC_CONTRAST, contrastOnMaps } from './palettes.js';
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
