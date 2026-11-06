import { describe, expect, it } from 'vitest';
import { ABSENT, problemsAfter, sampleScene, spoil } from './test-support/documents.js';
import { validateScene } from './validate.js';

const GROUP = ['legend', 1] as const;

describe('validateScene: the legend', () => {
  it('says that the legend must be a list', () => {
    expect(problemsAfter(['legend'], {})).toEqual(['type legend']);
    expect(problemsAfter(['legend'], ABSENT)).toEqual(['missing legend']);
    // What is not a layer or a group places nothing, so its layer is also one that is not in the legend.
    expect(problemsAfter(['legend', 0], 'layer-1')).toEqual([
      'not_an_object legend[0]',
      'consistency layers.layer-1',
    ]);
  });

  it('knows a layer and a group, and the fields of each', () => {
    expect(problemsAfter(['legend', 0, 'type'], 'folder')).toEqual([
      'choice legend[0].type',
      'consistency layers.layer-1',
    ]);
    expect(problemsAfter(['legend', 0, 'name'], 'x')).toEqual(['unknown_field legend[0].name']);
    expect(problemsAfter([...GROUP, 'label'], 'x')).toEqual(['unknown_field legend[1].label']);
    for (const name of ['id', 'name', 'collapsed']) {
      expect(problemsAfter([...GROUP, name], ABSENT)).toEqual([`missing legend[1].${name}`]);
    }
    // Without its children a group places no layer, so its two layers are also ones that are not in the legend.
    const orphans = ['consistency layers.layer-2', 'consistency layers.layer-3'];
    expect(problemsAfter([...GROUP, 'children'], ABSENT)).toEqual([
      'missing legend[1].children',
      ...orphans,
    ]);
    expect(problemsAfter([...GROUP, 'name'], 3)).toEqual(['type legend[1].name']);
    expect(problemsAfter([...GROUP, 'collapsed'], 'no')).toEqual(['type legend[1].collapsed']);
    expect(problemsAfter([...GROUP, 'children'], 'layer-2')).toEqual([
      'type legend[1].children',
      ...orphans,
    ]);
    expect(problemsAfter([...GROUP, 'id'], '')).toEqual(['range legend[1].id']);
  });

  it('wants what it lists to be a layer that is there', () => {
    expect(problemsAfter(['legend', 0, 'id'], 'layer-9')).toEqual([
      'reference legend[0].id',
      'consistency layers.layer-1',
    ]);
    expect(problemsAfter([...GROUP, 'children', 1], 'layer-9')).toEqual([
      'reference legend[1].children[1]',
      'consistency layers.layer-3',
    ]);
    expect(problemsAfter([...GROUP, 'children', 1], 4)).toEqual([
      'type legend[1].children[1]',
      'consistency layers.layer-3',
    ]);
  });

  it('wants every layer in the legend once, in a group or not', () => {
    expect(problemsAfter([...GROUP, 'children'], ['layer-2', 'layer-3', 'layer-1'])).toEqual([
      'duplicate legend[1].children[2]',
    ]);
    // The later place is the duplicate; the first has the layer.
    expect(problemsAfter(['legend', 0], { type: 'layer', id: 'layer-2' })).toEqual([
      'duplicate legend[1].children[0]',
      'consistency layers.layer-1',
    ]);
    expect(problemsAfter([...GROUP, 'children'], ['layer-2'])).toEqual([
      'consistency layers.layer-3',
    ]);
    expect(problemsAfter(['legend'], [])).toEqual([
      'consistency layers.layer-1',
      'consistency layers.layer-2',
      'consistency layers.layer-3',
    ]);
  });

  it('lets a group be empty, and a layer be the only thing in a group or at the top', () => {
    expect(
      problemsAfter(
        ['legend'],
        [
          { type: 'group', id: 'g', name: '', collapsed: true, children: [] },
          { type: 'layer', id: 'layer-1' },
          { type: 'group', id: 'h', name: 'H', collapsed: false, children: ['layer-2', 'layer-3'] },
        ],
      ),
    ).toEqual([]);
  });

  it('gives a group an id of its own: not another group`s and not a layer`s', () => {
    const twice = [
      { type: 'layer', id: 'layer-1' },
      { type: 'group', id: 'group-1', name: 'A', collapsed: false, children: ['layer-2'] },
      { type: 'group', id: 'group-1', name: 'B', collapsed: false, children: ['layer-3'] },
    ];
    expect(problemsAfter(['legend'], twice)).toEqual(['duplicate legend[2].id']);
    expect(problemsAfter([...GROUP, 'id'], 'layer-1')).toEqual(['consistency legend[1].id']);
  });

  it('does not check what the legend refers to when the layers cannot be read, only its own shape', () => {
    expect(problemsAfter(['layers'], 'none')).toEqual(['not_an_object layers']);
    expect(problemsAfter(['layers'], ABSENT)).toEqual(['missing layers']);
  });
});

describe('validateScene: the selection', () => {
  it('may be none, or a layer that is there and an element from 0', () => {
    expect(problemsAfter(['selection'], null)).toEqual([]);
    expect(problemsAfter(['selection', 'element'], 41)).toEqual([]);
    expect(problemsAfter(['selection'], ABSENT)).toEqual(['missing selection']);
    expect(problemsAfter(['selection', 'layerId'], 'layer-9')).toEqual([
      'reference selection.layerId',
    ]);
    expect(problemsAfter(['selection', 'layerId'], '')).toEqual(['range selection.layerId']);
    expect(problemsAfter(['selection', 'element'], -1)).toEqual(['range selection.element']);
    expect(problemsAfter(['selection', 'element'], 0.5)).toEqual(['range selection.element']);
    expect(problemsAfter(['selection', 'element'], '0')).toEqual(['type selection.element']);
    expect(problemsAfter(['selection', 'row'], 0)).toEqual(['unknown_field selection.row']);
  });

  it('is not checked against layers that cannot be read', () => {
    expect(problemsAfter(['layers'], 5)).toEqual(['not_an_object layers']);
  });

  it('is all of it found together, with the problems of the whole document, in the order of the document', () => {
    let doc: unknown = sampleScene();
    doc = spoil(doc, ['selection', 'element'], -1);
    doc = spoil(doc, ['legend', 0, 'id'], 'layer-9');
    doc = spoil(doc, ['viewMode'], 'x');
    expect(validateScene(doc).map((p) => p.path)).toEqual([
      'viewMode',
      'legend[0].id',
      'layers.layer-1',
      'selection.element',
    ]);
  });
});
