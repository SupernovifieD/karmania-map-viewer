/**
 * `validateScene`: whether a value that came from outside (an embedder's state, a saved file) is a scene
 * document this package can use, and if not, everything that is wrong with it. It does not stop at the first
 * problem and it does not throw. It looks at plain data, as JSON has it.
 */
import { CRS_KINDS, FRAME_SOURCES, LOCAL_UNITS } from './choices.js';
import {
  Problems,
  field,
  isRecord,
  readChoice,
  readNumber,
  readNumbers,
  readRecord,
  show,
  type SceneProblem,
} from './problems.js';
import { SCENE_VERSION, VERTICAL_EXAGGERATIONS, VIEW_MODES } from './types.js';

const DOCUMENT_FIELDS = [
  'version',
  'frame',
  'viewMode',
  'camera2d',
  'camera3d',
  'verticalExaggeration',
  'legend',
  'layers',
  'selection',
] as const;

/** Whether the version is the one this package reads; says so in a problem if not. */
function checkVersion(problems: Problems, version: unknown): boolean {
  if (version === SCENE_VERSION) {
    return true;
  }
  if (version === undefined) {
    problems.add(
      'version',
      'missing',
      'version is missing: a scene document says which version it is.',
    );
  } else if (typeof version === 'number' && Number.isInteger(version) && version > SCENE_VERSION) {
    const newer = `version is ${String(version)}, which is newer than this viewer reads (${String(SCENE_VERSION)}).`;
    problems.add('version', 'version', newer);
  } else {
    const found = `version must be ${String(SCENE_VERSION)}, and it is ${show(version)}.`;
    problems.add('version', 'version', found);
  }
  return false;
}

function checkCrs(problems: Problems, path: string, value: unknown): void {
  const kind = isRecord(value) ? value['kind'] : undefined;
  const crs = readRecord(
    problems,
    path,
    value,
    kind === 'local' ? ['kind', 'units'] : ['kind', 'code'],
  );
  if (crs === undefined) {
    return;
  }
  const chosen = readChoice(problems, field(path, 'kind'), crs['kind'], CRS_KINDS);
  if (chosen === 'epsg') {
    readNumber(problems, field(path, 'code'), crs['code'], { integer: true, min: 1 });
  } else if (chosen === 'local') {
    readChoice(problems, field(path, 'units'), crs['units'], LOCAL_UNITS);
  }
}

function checkFrame(problems: Problems, path: string, value: unknown): void {
  if (value === null) {
    return;
  }
  const frame = readRecord(problems, path, value, ['mapCrs', 'origin', 'source']);
  if (frame === undefined) {
    return;
  }
  checkCrs(problems, field(path, 'mapCrs'), frame['mapCrs']);
  readNumbers(problems, field(path, 'origin'), frame['origin'], 3);
  readChoice(problems, field(path, 'source'), frame['source'], FRAME_SOURCES);
}

function checkCamera2d(problems: Problems, path: string, value: unknown): void {
  const camera = readRecord(problems, path, value, ['centre', 'unitsPerPixel', 'heading']);
  if (camera === undefined) {
    return;
  }
  readNumbers(problems, field(path, 'centre'), camera['centre'], 2);
  readNumber(problems, field(path, 'unitsPerPixel'), camera['unitsPerPixel'], { above: 0 });
  readNumber(problems, field(path, 'heading'), camera['heading']);
}

function checkCamera3d(problems: Problems, path: string, value: unknown): void {
  const fields = ['target', 'distance', 'heading', 'elevation', 'fov'];
  const camera = readRecord(problems, path, value, fields);
  if (camera === undefined) {
    return;
  }
  readNumbers(problems, field(path, 'target'), camera['target'], 3);
  readNumber(problems, field(path, 'distance'), camera['distance'], { above: 0 });
  readNumber(problems, field(path, 'heading'), camera['heading']);
  readNumber(problems, field(path, 'elevation'), camera['elevation'], { min: -89, max: 89 });
  readNumber(problems, field(path, 'fov'), camera['fov'], { above: 0, below: 180 });
}

/**
 * Everything that is wrong with `doc` as a scene document of the version this package reads, or an empty list
 * if it is one. A document of another version is one problem, `version`, and nothing else is said of it
 * (`migrate` is for older ones).
 */
export function validateScene(doc: unknown): readonly SceneProblem[] {
  const problems = new Problems();
  if (!isRecord(doc)) {
    readRecord(problems, '', doc, []);
    return problems.finish();
  }
  if (!checkVersion(problems, doc['version'])) {
    return problems.finish();
  }
  readRecord(problems, '', doc, DOCUMENT_FIELDS);
  checkFrame(problems, 'frame', doc['frame']);
  readChoice(problems, 'viewMode', doc['viewMode'], VIEW_MODES);
  checkCamera2d(problems, 'camera2d', doc['camera2d']);
  checkCamera3d(problems, 'camera3d', doc['camera3d']);
  readChoice(problems, 'verticalExaggeration', doc['verticalExaggeration'], VERTICAL_EXAGGERATIONS);
  // The layers, the legend and the selection are checked by the steps that follow (14.3c and 14.3d).
  return problems.finish();
}
