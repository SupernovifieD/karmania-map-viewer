import type { ClassBreaks, DrawableEntry } from '@karmania/engine/display';
import { describe, expect, it } from 'vitest';
import { removeLayersOfDataset, setGroupVisible, setVisible } from './commands-layers.js';
import { setGroupCollapsed } from './commands-legend.js';
import { emptyScene } from './empty.js';
import { exportLegendLines, type ExportLine } from './export-lines.js';
import { legendModel } from './legend-model.js';
import { sampleScene } from './test-support/documents.js';

const breaks: ClassBreaks = {
  kind: 'ranges',
  column: 'z',
  bounds: [0, 50, 100],
  counts: [30, 70],
  nulls: 4,
};
const notDrawn = (id: number): DrawableEntry => ({
  id,
  status: 'not_drawn',
  reprojected: false,
  findings: [],
});
const shape = (lines: ExportLine[]): string[] =>
  lines.map((l) =>
    l.kind === 'group'
      ? `G:${l.name}`
      : l.kind === 'layer'
        ? `L:${l.id}${l.indented ? '+' : ''}${l.hasClasses ? '*' : ''}`
        : `C:${l.entry.label}`,
  );

describe('the lines of the exported legend', () => {
  it('are none for a scene with nothing in it', () => {
    expect(exportLegendLines(legendModel(emptyScene()))).toEqual([]);
  });

  it('list the layers that are on, the groups they are in, and the classes of a layer that has them', () => {
    const doc = setVisible(sampleScene(), 'layer-2', true);
    const lines = exportLegendLines(legendModel(doc, { breaks: { 'layer-1': breaks } }));
    expect(shape(lines)).toEqual([
      'L:layer-1*',
      'C:0 – 50',
      'C:50 – 100',
      'C:No value',
      'G:Survey',
      'L:layer-2+',
      'L:layer-3+',
    ]);
  });

  it('leave out a layer that is off, and a group with no layer that is on', () => {
    // In the sample, layer-2 is off and layer-3 is on: the group has one.
    expect(shape(exportLegendLines(legendModel(sampleScene())))).toEqual([
      'L:layer-1',
      'G:Survey',
      'L:layer-3+',
    ]);
    const none = setGroupVisible(sampleScene(), 'group-1', false);
    expect(shape(exportLegendLines(legendModel(none)))).toEqual(['L:layer-1']);
    const empty = removeLayersOfDataset(removeLayersOfDataset(sampleScene(), 2), 3);
    expect(shape(exportLegendLines(legendModel(empty)))).toEqual(['L:layer-1']);
  });

  it('leave out a layer at the top of the legend that is off, or is on but is not drawn, as well as one in a group', () => {
    const off = setVisible(sampleScene(), 'layer-1', false);
    expect(shape(exportLegendLines(legendModel(off)))).toEqual(['G:Survey', 'L:layer-3+']);
    expect(
      shape(exportLegendLines(legendModel(sampleScene(), { drawable: [notDrawn(1)] }))),
    ).toEqual(['G:Survey', 'L:layer-3+']);
  });

  it('leave out a layer that is on but is not drawn, since it is not in the picture', () => {
    const lines = exportLegendLines(legendModel(sampleScene(), { drawable: [notDrawn(3)] }));
    expect(shape(lines)).toEqual(['L:layer-1']);
  });

  it('do not mind that a group is folded in the Legend tab', () => {
    const folded = setGroupCollapsed(sampleScene(), 'group-1', true);
    expect(shape(exportLegendLines(legendModel(folded)))).toEqual([
      'L:layer-1',
      'G:Survey',
      'L:layer-3+',
    ]);
  });

  it('say which layer has lines under it, so that its line is not left at the end of a column from them', () => {
    const lines = exportLegendLines(legendModel(sampleScene(), { breaks: { 'layer-1': breaks } }));
    expect(lines.filter((l) => l.kind === 'layer').map((l) => [l.id, l.hasClasses])).toEqual([
      ['layer-1', true],
      ['layer-3', false],
    ]);
    const first = lines[0];
    expect(first?.kind === 'layer' && first.swatch.kind).toBe('ramp');
  });

  it('name the layer that each class line is of, and write it as the Legend tab does', () => {
    const lines = exportLegendLines(legendModel(sampleScene(), { breaks: { 'layer-1': breaks } }));
    const classes = lines.filter((l) => l.kind === 'class');
    expect(classes.map((l) => l.layerId)).toEqual(['layer-1', 'layer-1', 'layer-1']);
    expect(classes.map((l) => [l.entry.label, l.entry.countLabel])).toEqual([
      ['0 – 50', '30'],
      ['50 – 100', '70'],
      ['No value', '4'],
    ]);
    expect(classes.every((l) => !l.indented)).toBe(true);
  });
});
