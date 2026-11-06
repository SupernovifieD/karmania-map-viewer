/** `validateScene`, the layers: their style, contours and derivation, and how a derived layer refers to its source. */
import { CLASS_METHODS } from './choices.js';
import {
  field,
  isRecord,
  readBoolean,
  readChoice,
  readMap,
  readNumber,
  readRecord,
  readString,
  show,
  type Problems,
} from './problems.js';

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function checkColour(problems: Problems, path: string, value: unknown): void {
  const mode = isRecord(value) ? value['mode'] : undefined;
  const fields =
    mode === 'classes'
      ? ['mode', 'column', 'method', 'classes', 'ramp', 'reverse']
      : ['mode', 'value'];
  const colour = readRecord(problems, path, value, fields);
  if (colour === undefined) {
    return;
  }
  const chosen = readChoice(problems, field(path, 'mode'), colour['mode'], ['single', 'classes']);
  if (chosen === 'single') {
    const hex = readString(problems, field(path, 'value'), colour['value']);
    if (hex !== undefined && !HEX_COLOUR.test(hex)) {
      const found = `${field(path, 'value')} must be a colour like "#e69f00" (# and six hexadecimal digits), and it is ${show(hex)}.`;
      problems.add(field(path, 'value'), 'range', found);
    }
  } else if (chosen === 'classes') {
    readString(problems, field(path, 'column'), colour['column'], true);
    readChoice(problems, field(path, 'method'), colour['method'], CLASS_METHODS);
    readNumber(problems, field(path, 'classes'), colour['classes'], {
      integer: true,
      min: 2,
      max: 20,
    });
    readString(problems, field(path, 'ramp'), colour['ramp'], true);
    readBoolean(problems, field(path, 'reverse'), colour['reverse']);
  }
}

function checkStyle(problems: Problems, path: string, value: unknown): void {
  const style = readRecord(problems, path, value, ['colour', 'opacity', 'pointSize', 'lineWidth']);
  if (style === undefined) {
    return;
  }
  checkColour(problems, field(path, 'colour'), style['colour']);
  readNumber(problems, field(path, 'opacity'), style['opacity'], { min: 0, max: 1 });
  if (style['pointSize'] !== undefined) {
    readNumber(problems, field(path, 'pointSize'), style['pointSize'], { min: 2, max: 24 });
  }
  if (style['lineWidth'] !== undefined) {
    readNumber(problems, field(path, 'lineWidth'), style['lineWidth'], { min: 1, max: 8 });
  }
}

function checkContours(problems: Problems, path: string, value: unknown): void {
  const fields = ['column', 'interval', 'base', 'indexEvery', 'visible'];
  const contours = readRecord(problems, path, value, fields);
  if (contours === undefined) {
    return;
  }
  if (contours['column'] !== undefined) {
    readString(problems, field(path, 'column'), contours['column'], true);
  }
  readNumber(problems, field(path, 'interval'), contours['interval'], { above: 0 });
  readNumber(problems, field(path, 'base'), contours['base']);
  readNumber(problems, field(path, 'indexEvery'), contours['indexEvery'], {
    integer: true,
    min: 1,
  });
  readBoolean(problems, field(path, 'visible'), contours['visible']);
}

/** Checks one layer and says which layer it is made from, if it is derived. */
function checkLayer(
  problems: Problems,
  path: string,
  key: string,
  value: unknown,
): string | undefined {
  const fields = ['id', 'datasetId', 'name', 'visible', 'style', 'contours', 'derived'];
  const layer = readRecord(problems, path, value, fields);
  if (layer === undefined) {
    return undefined;
  }
  const id = readString(problems, field(path, 'id'), layer['id'], true);
  if (id !== undefined && id !== key) {
    problems.add(
      field(path, 'id'),
      'consistency',
      `${field(path, 'id')} is ${show(id)}, and it must be the key of the layer, ${show(key)}.`,
    );
  }
  readNumber(problems, field(path, 'datasetId'), layer['datasetId'], { integer: true, min: 0 });
  readString(problems, field(path, 'name'), layer['name']);
  readBoolean(problems, field(path, 'visible'), layer['visible']);
  checkStyle(problems, field(path, 'style'), layer['style']);
  if (layer['contours'] !== undefined) {
    checkContours(problems, field(path, 'contours'), layer['contours']);
  }
  if (layer['derived'] === undefined) {
    return undefined;
  }
  const derived = readRecord(problems, field(path, 'derived'), layer['derived'], [
    'kind',
    'sourceLayer',
  ]);
  if (derived === undefined) {
    return undefined;
  }
  readChoice(problems, field(path, 'derived.kind'), derived['kind'], ['contours']);
  return readString(problems, field(path, 'derived.sourceLayer'), derived['sourceLayer'], true);
}

/**
 * Checks the layers of the document, and that a derived layer is made from another layer that is not itself
 * derived. Gives the ids that the layers are under, for the legend and the selection to be checked against, or
 * `undefined` if the layers are not an object (and nothing can be checked against them).
 */
export function checkLayers(
  problems: Problems,
  path: string,
  value: unknown,
): ReadonlySet<string> | undefined {
  const layers = readMap(problems, path, value);
  if (layers === undefined) {
    return undefined;
  }
  const sources = new Map<string, string>();
  for (const [key, layer] of Object.entries(layers)) {
    const source = checkLayer(problems, field(path, key), key, layer);
    if (source !== undefined) {
      sources.set(key, source);
    }
  }
  for (const [key, source] of sources) {
    const where = field(field(path, key), 'derived.sourceLayer');
    if (source === key) {
      problems.add(
        where,
        'consistency',
        `${where} is the layer itself: contours are made from another layer.`,
      );
    } else if (!Object.hasOwn(layers, source)) {
      problems.add(where, 'reference', `${where} is ${show(source)}, and there is no such layer.`);
    } else if (sources.has(source)) {
      problems.add(
        where,
        'consistency',
        `${where} is ${show(source)}, which is itself derived: contours are not made from contours.`,
      );
    }
  }
  return new Set(Object.keys(layers));
}
