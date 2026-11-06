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
export { SCALE_BAR_MAX_PIXELS, scaleBar } from './scale-bar.js';
export type {
  NoScaleBar,
  ScaleBar,
  ScaleBarInput,
  ScaleBarModel,
  ScaleBarReason,
  ScaleBarUnit,
} from './scale-bar.js';
export { northArrow } from './north-arrow.js';
export type { NorthArrow } from './north-arrow.js';
export { legendModel } from './legend-model.js';
export type {
  GroupVisibility,
  LayerNotice,
  LayerSwatch,
  LegendEntry,
  LegendGroupEntry,
  LegendInputs,
  LegendLayerEntry,
  LegendModel,
} from './legend-model.js';
export {
  NO_VALUE_LABEL,
  OTHER_COLOUR,
  OTHER_LABEL,
  classColours,
  classCount,
  classEntries,
} from './class-entries.js';
export type { ClassEntry } from './class-entries.js';
export { BOUND_DASH, MINUS, formatBounds, formatCount, formatNumber } from './numbers.js';
export { createSceneStore } from './store.js';
export type { SceneListener, SceneStore } from './store.js';
export {
  COLUMN_GAP,
  COLUMN_WIDTH,
  FURNITURE_INSET,
  LEGEND_GAP,
  MARGIN,
  NORTH_ARROW_SIZE,
  exportLayout,
} from './export-layout.js';
export type {
  ExportLayout,
  ExportLayoutInput,
  ExportWarning,
  LegendColumn,
  PlacedLine,
  Rect,
  Size,
} from './export-layout.js';
export { exportLegendLines } from './export-lines.js';
export type { ExportLine } from './export-lines.js';
export { cameraTo2d, cameraTo3d, fitCamera2d, fitCamera3d } from './cameras.js';
export type { Fit2dInput, Fit3dInput, To2dInput, To3dInput, Viewport } from './cameras.js';
export { COMMAND_TYPES, applyCommand } from './commands.js';
export type { Command } from './commands.js';
export { setFrame, setSelection } from './commands-frame.js';
export { heldElevation, normalHeading } from './angles.js';
export { setCamera, setVerticalExaggeration, setViewMode } from './commands-view.js';
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
