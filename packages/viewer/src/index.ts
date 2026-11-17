/**
 * `@karmania/viewer`: the embeddable viewer. Importing it defines `<karmania-viewer>`; `createViewer` puts one in a page.
 *
 * It also gives what a page needs to use the viewer without the packages behind it: the engine (`createEngine`, to be shared by viewers, and the builders that
 * make the input of `Viewer.load`), and the types of what goes in and out of the viewer.
 */
export { createViewer } from './create-viewer.js';
export type { ExportPngOptions, ExportPngRun } from './export-compose.js';
export type { Viewer, ViewerEvent } from './create-viewer.js';
export { KarmaniaViewer } from './viewer.js';

// The engine, and what loads a dataset into it.
export {
  EngineDisposedError,
  EngineError,
  blocks,
  createEngine,
  grid,
  lines,
  mesh,
  points,
  polygons,
} from '@karmania/engine';
export type {
  BlocksData,
  CrsRef,
  DatasetInput,
  Engine,
  EngineEvents,
  EngineOptions,
  Finding,
  GridData,
  ImportMapping,
  ImportOptions,
  LinesData,
  LoadOptions,
  LoadResult,
  MeshData,
  PointsData,
  PolygonsData,
  Preview,
  Summary,
} from '@karmania/engine';

// The scene, which `scene`, `dispatch` and `on` speak of.
export type { Command, SceneDocument, SceneSelection, ViewMode } from '@karmania/scene';
