import { describe, expect, it } from 'vitest';
import { ABSENT, problemsAfter, sampleScene, spoil } from './test-support/documents.js';
import { RAMP_IDS } from './ramps.js';
import { validateScene } from './validate.js';

const LAYER = ['layers', 'layer-2'] as const;
const STYLE = [...LAYER, 'style'] as const;
const COLOUR = ['layers', 'layer-1', 'style', 'colour'] as const;
const CONTOURS = ['layers', 'layer-1', 'contours'] as const;

describe('validateScene: the layers', () => {
  it('says that layers must be an object of layers', () => {
    expect(problemsAfter(['layers'], [])).toEqual(['not_an_object layers']);
    expect(problemsAfter(['layers'], ABSENT)).toEqual(['missing layers']);
    expect(problemsAfter(['layers', 'layer-2'], 'Assays')).toEqual([
      'not_an_object layers.layer-2',
    ]);
  });

  it('wants the id of a layer to be its key, and the fields that a layer has', () => {
    expect(problemsAfter([...LAYER, 'id'], 'layer-9')).toEqual(['consistency layers.layer-2.id']);
    expect(problemsAfter([...LAYER, 'id'], '')).toEqual(['range layers.layer-2.id']);
    expect(problemsAfter([...LAYER, 'colour'], '#fff')).toEqual([
      'unknown_field layers.layer-2.colour',
    ]);
    for (const name of ['id', 'datasetId', 'name', 'visible', 'style']) {
      expect(problemsAfter([...LAYER, name], ABSENT)).toEqual([`missing layers.layer-2.${name}`]);
    }
  });

  it('wants a dataset that is a whole number, a name that is text and a visibility that is true or false', () => {
    expect(problemsAfter([...LAYER, 'datasetId'], 0)).toEqual([]);
    expect(problemsAfter([...LAYER, 'datasetId'], -1)).toEqual(['range layers.layer-2.datasetId']);
    expect(problemsAfter([...LAYER, 'datasetId'], 1.5)).toEqual(['range layers.layer-2.datasetId']);
    expect(problemsAfter([...LAYER, 'datasetId'], '2')).toEqual(['type layers.layer-2.datasetId']);
    expect(problemsAfter([...LAYER, 'name'], '')).toEqual([]);
    expect(problemsAfter([...LAYER, 'name'], 7)).toEqual(['type layers.layer-2.name']);
    expect(problemsAfter([...LAYER, 'visible'], 'yes')).toEqual(['type layers.layer-2.visible']);
  });

  it('checks a single colour: # and six hexadecimal digits, in either case', () => {
    for (const ok of ['#e69f00', '#E69F00', '#000000']) {
      expect(problemsAfter([...STYLE, 'colour', 'value'], ok)).toEqual([]);
    }
    for (const bad of ['e69f00', '#e69f0', '#e69f000', '#e69g00', 'red', '']) {
      expect(problemsAfter([...STYLE, 'colour', 'value'], bad)).toEqual([
        'range layers.layer-2.style.colour.value',
      ]);
    }
    expect(problemsAfter([...STYLE, 'colour', 'value'], 255)).toEqual([
      'type layers.layer-2.style.colour.value',
    ]);
    expect(problemsAfter([...STYLE, 'colour', 'mode'], 'gradient')).toEqual([
      'choice layers.layer-2.style.colour.mode',
    ]);
  });

  it('checks a colour by classes: a column, a method, 2 to 20 classes, a ramp and whether it is reversed', () => {
    expect(problemsAfter([...COLOUR, 'classes'], 2)).toEqual([]);
    expect(problemsAfter([...COLOUR, 'classes'], 20)).toEqual([]);
    expect(problemsAfter([...COLOUR, 'classes'], 1)).toEqual([
      'range layers.layer-1.style.colour.classes',
    ]);
    expect(problemsAfter([...COLOUR, 'classes'], 21)).toEqual([
      'range layers.layer-1.style.colour.classes',
    ]);
    expect(problemsAfter([...COLOUR, 'classes'], 7.5)).toEqual([
      'range layers.layer-1.style.colour.classes',
    ]);
    expect(problemsAfter([...COLOUR, 'column'], '')).toEqual([
      'range layers.layer-1.style.colour.column',
    ]);
    expect(problemsAfter([...COLOUR, 'method'], 'jenks')).toEqual([]);
    expect(problemsAfter([...COLOUR, 'method'], 'median')).toEqual([
      'choice layers.layer-1.style.colour.method',
    ]);
    // A ramp is one of the ramps there are (step 14.4b), and nothing else, whatever is a name in every object.
    for (const id of RAMP_IDS) {
      expect(problemsAfter([...COLOUR, 'ramp'], id)).toEqual([]);
    }
    for (const bad of ['', 'rainbow', 'Viridis', 'constructor']) {
      expect(problemsAfter([...COLOUR, 'ramp'], bad)).toEqual([
        'choice layers.layer-1.style.colour.ramp',
      ]);
    }
    expect(problemsAfter([...COLOUR, 'reverse'], 0)).toEqual([
      'type layers.layer-1.style.colour.reverse',
    ]);
    // A colour by classes has no `value`, and a single colour no `column`.
    expect(problemsAfter([...COLOUR, 'value'], '#000000')).toEqual([
      'unknown_field layers.layer-1.style.colour.value',
    ]);
    expect(problemsAfter([...STYLE, 'colour', 'column'], 'z')).toEqual([
      'unknown_field layers.layer-2.style.colour.column',
    ]);
  });

  it('keeps the opacity from 0 to 1, the point size from 2 to 24 and the line width from 1 to 8', () => {
    const limits: [string, number, number][] = [
      ['opacity', 0, 1],
      ['pointSize', 2, 24],
      ['lineWidth', 1, 8],
    ];
    for (const [name, low, high] of limits) {
      const path = [...STYLE, name];
      const at = `layers.layer-2.style.${name}`;
      expect(problemsAfter(path, low)).toEqual([]);
      expect(problemsAfter(path, high)).toEqual([]);
      expect(problemsAfter(path, low - 0.5)).toEqual([`range ${at}`]);
      expect(problemsAfter(path, high + 0.5)).toEqual([`range ${at}`]);
      expect(problemsAfter(path, '1')).toEqual([`type ${at}`]);
    }
    expect(problemsAfter([...STYLE, 'opacity'], ABSENT)).toEqual([
      'missing layers.layer-2.style.opacity',
    ]);
  });

  it('lets a size that is not there stay out, and a size that is undefined count as not there', () => {
    expect(problemsAfter([...STYLE, 'pointSize'], ABSENT)).toEqual([]);
    expect(problemsAfter([...STYLE, 'pointSize'], undefined)).toEqual([]);
    expect(problemsAfter([...LAYER, 'contours'], undefined)).toEqual([]);
    expect(problemsAfter([...LAYER, 'derived'], undefined)).toEqual([]);
  });

  it('checks the contours: an interval above 0, a base, a whole number of lines to an index line, and a column', () => {
    expect(problemsAfter([...CONTOURS, 'interval'], 0)).toEqual([
      'range layers.layer-1.contours.interval',
    ]);
    expect(problemsAfter([...CONTOURS, 'interval'], 0.25)).toEqual([]);
    expect(problemsAfter([...CONTOURS, 'base'], -1000.5)).toEqual([]);
    expect(problemsAfter([...CONTOURS, 'base'], NaN)).toEqual([
      'type layers.layer-1.contours.base',
    ]);
    expect(problemsAfter([...CONTOURS, 'indexEvery'], 0)).toEqual([
      'range layers.layer-1.contours.indexEvery',
    ]);
    expect(problemsAfter([...CONTOURS, 'indexEvery'], 2.5)).toEqual([
      'range layers.layer-1.contours.indexEvery',
    ]);
    expect(problemsAfter([...CONTOURS, 'visible'], 1)).toEqual([
      'type layers.layer-1.contours.visible',
    ]);
    expect(problemsAfter([...CONTOURS, 'column'], ABSENT)).toEqual([]);
    expect(problemsAfter([...CONTOURS, 'column'], '')).toEqual([
      'range layers.layer-1.contours.column',
    ]);
    expect(problemsAfter([...CONTOURS, 'every'], 5)).toEqual([
      'unknown_field layers.layer-1.contours.every',
    ]);
  });

  it('wants a derived layer to be made of contours of another layer that is not derived itself', () => {
    const source = ['layers', 'layer-3', 'derived', 'sourceLayer'];
    expect(problemsAfter(source, 'layer-2')).toEqual([]);
    expect(problemsAfter(source, 'layer-9')).toEqual([
      'reference layers.layer-3.derived.sourceLayer',
    ]);
    expect(problemsAfter(source, 'constructor')).toEqual([
      'reference layers.layer-3.derived.sourceLayer',
    ]);
    expect(problemsAfter(source, 'layer-3')).toEqual([
      'consistency layers.layer-3.derived.sourceLayer',
    ]);
    // Itself is said in its own words, not as a layer that is derived (which it also is).
    const itself = validateScene(spoil(sampleScene(), source, 'layer-3'));
    expect(itself.map((p) => p.message)).toEqual([
      'layers.layer-3.derived.sourceLayer is the layer itself: contours are made from another layer.',
    ]);
    const chain = validateScene(
      spoil(sampleScene(), [...LAYER, 'derived'], { kind: 'contours', sourceLayer: 'layer-3' }),
    );
    expect(chain.map((p) => p.message)).toEqual([
      'layers.layer-2.derived.sourceLayer is "layer-3", which is itself derived: contours are not made from contours.',
    ]);
    expect(problemsAfter(source, '')).toEqual(['range layers.layer-3.derived.sourceLayer']);
    expect(problemsAfter(['layers', 'layer-3', 'derived', 'kind'], 'hillshade')).toEqual([
      'choice layers.layer-3.derived.kind',
    ]);
    // layer-2 made of layer-3, which is made of layer-1: contours of contours.
    const chained = spoil(sampleScene(), [...LAYER, 'derived'], {
      kind: 'contours',
      sourceLayer: 'layer-3',
    });
    expect(validateScene(chained).map((p) => `${p.code} ${p.path}`)).toEqual([
      'consistency layers.layer-2.derived.sourceLayer',
    ]);
  });

  it('reports each layer`s problems at its own place, in the order of the layers', () => {
    let doc: unknown = sampleScene();
    doc = spoil(doc, ['layers', 'layer-1', 'style', 'opacity'], 2);
    doc = spoil(doc, ['layers', 'layer-3', 'name'], 3);
    expect(validateScene(doc).map((p) => p.path)).toEqual([
      'layers.layer-1.style.opacity',
      'layers.layer-3.name',
    ]);
  });
});
