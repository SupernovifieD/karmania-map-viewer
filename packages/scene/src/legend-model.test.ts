import type { ClassBreaks, DrawableEntry } from '@karmania/engine/display';
import type { Finding } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { classColours } from './class-entries.js';
import { removeLayersOfDataset, setVisible } from './commands-layers.js';
import { setGroupCollapsed } from './commands-legend.js';
import { emptyScene } from './empty.js';
import { legendModel, type LegendGroupEntry, type LegendLayerEntry } from './legend-model.js';
import { rampById, sampleRamp, type Ramp } from './ramps.js';
import { frozen, layerById, sampleScene } from './test-support/documents.js';
import type { ClassColour, SceneDocument } from './types.js';

const breaks: ClassBreaks = {
  kind: 'ranges',
  column: 'z',
  bounds: [0, 50, 100],
  counts: [30, 70],
  nulls: 4,
};

function finding(severity: Finding['severity'], message: string, hint?: string): Finding {
  const base = { code: 'display.test', severity, message, count: 1, examples: [] };
  return hint === undefined ? base : { ...base, hint };
}

function entry(
  id: number,
  status: DrawableEntry['status'],
  findings: Finding[] = [],
): DrawableEntry {
  return { id, status, reprojected: false, findings };
}

function viridis(): Ramp {
  const ramp = rampById('viridis');
  if (ramp === undefined) {
    throw new Error('No viridis');
  }
  return ramp;
}

type Model = ReturnType<typeof legendModel>;

function layer(model: Model, id: string): LegendLayerEntry {
  for (const e of model.entries) {
    if (e.type === 'layer' && e.id === id) {
      return e;
    }
    if (e.type === 'group') {
      const inside = e.layers.find((l) => l.id === id);
      if (inside !== undefined) {
        return inside;
      }
    }
  }
  throw new Error(`No layer ${id}`);
}

function group(model: Model, id: string): LegendGroupEntry {
  const found = model.entries.find((e): e is LegendGroupEntry => e.type === 'group' && e.id === id);
  if (found === undefined) {
    throw new Error(`No group ${id}`);
  }
  return found;
}

describe('legendModel: the order and the layers', () => {
  it('has nothing for a scene with nothing in it, and says how many layers with the right number', () => {
    expect(legendModel(emptyScene())).toEqual({
      entries: [],
      layerCount: 0,
      layerCountLabel: '0 layers',
    });
  });

  it('lists the layers and groups in the order of the document, with the layers of a group in it', () => {
    const model = legendModel(sampleScene());
    const shape = model.entries.map((e) =>
      e.type === 'layer' ? e.id : `${e.id}[${e.layers.map((l) => l.id).join(',')}]`,
    );
    expect(shape).toEqual(['layer-1', 'group-1[layer-2,layer-3]']);
    expect([model.layerCount, model.layerCountLabel]).toEqual([3, '3 layers']);
  });

  it('counts one layer as "1 layer"', () => {
    const one = removeLayersOfDataset(removeLayersOfDataset(sampleScene(), 2), 3);
    expect(legendModel(one).layerCountLabel).toBe('1 layer');
  });

  it('gives each layer its name and whether it is on, and each group its name and whether it is folded', () => {
    const model = legendModel(sampleScene());
    expect([
      layer(model, 'layer-2').name,
      layer(model, 'layer-2').visible,
      layer(model, 'layer-1').visible,
    ]).toEqual(['Assays', false, true]);
    expect([group(model, 'group-1').name, group(model, 'group-1').collapsed]).toEqual([
      'Survey',
      false,
    ]);
    expect(
      group(legendModel(setGroupCollapsed(sampleScene(), 'group-1', true)), 'group-1').collapsed,
    ).toBe(true);
  });

  it('leaves out a layer in the legend that is not in the layers, which a valid document does not have', () => {
    const doc: SceneDocument = {
      ...sampleScene(),
      layers: Object.fromEntries(
        Object.entries(sampleScene().layers).filter(([id]) => id !== 'layer-3'),
      ),
    };
    const model = legendModel(doc);
    expect(group(model, 'group-1').layers.map((l) => l.id)).toEqual(['layer-2']);
    expect(model.layerCount).toBe(2);
    expect(legendModel({ ...doc, legend: [{ type: 'layer', id: 'constructor' }] }).entries).toEqual(
      [],
    );
  });
});

describe('legendModel: whether a group is on', () => {
  const withVisible = (first: boolean, second: boolean): SceneDocument =>
    setVisible(setVisible(sampleScene(), 'layer-2', first), 'layer-3', second);

  it('is all, some or none, from the layers in it', () => {
    expect(group(legendModel(withVisible(true, true)), 'group-1').visibility).toBe('all');
    expect(group(legendModel(withVisible(true, false)), 'group-1').visibility).toBe('some');
    expect(group(legendModel(withVisible(false, true)), 'group-1').visibility).toBe('some');
    expect(group(legendModel(withVisible(false, false)), 'group-1').visibility).toBe('none');
  });

  it('is none for a group with no layer in it', () => {
    // Removing both datasets leaves the group where it was, with nothing in it.
    const doc = removeLayersOfDataset(removeLayersOfDataset(sampleScene(), 2), 3);
    expect(group(legendModel(doc), 'group-1')).toMatchObject({ visibility: 'none', layers: [] });
  });
});

describe('legendModel: the swatch and the lines under a layer', () => {
  it('shows one colour for a layer of one colour, and no lines under it', () => {
    const l = layer(legendModel(sampleScene(), { breaks: { 'layer-2': breaks } }), 'layer-2');
    expect(l.swatch).toEqual({ kind: 'colour', colour: '#e69f00' });
    expect(l.classes).toEqual([]);
  });

  it('shows the ramp as it will be, sampled to the classes asked for, until the layer is classified', () => {
    const l = layer(legendModel(sampleScene()), 'layer-1');
    expect(l.swatch).toEqual({ kind: 'ramp', colours: sampleRamp(viridis(), 7, false) });
    expect(l.classes).toEqual([]);
  });

  it('shows the colours of the classes and a line for each class, when the layer is classified', () => {
    const l = layer(legendModel(sampleScene(), { breaks: { 'layer-1': breaks } }), 'layer-1');
    const colour = layerById(sampleScene(), 'layer-1').style.colour as ClassColour;
    const colours = classColours(colour, breaks);
    expect(l.swatch).toEqual({ kind: 'ramp', colours });
    expect(l.classes.map((c) => [c.label, c.countLabel, c.colour])).toEqual([
      ['0 – 50', '30', colours[0]],
      ['50 – 100', '70', colours[1]],
      ['No value', '4', null],
    ]);
  });

  it('is not fooled by a layer id that is a name every object has, or by no breaks at all', () => {
    expect(layer(legendModel(sampleScene(), { breaks: {} }), 'layer-1').classes).toEqual([]);
    expect(layer(legendModel(sampleScene(), {}), 'layer-1').classes).toEqual([]);
    const doc = sampleScene();
    const odd: SceneDocument = {
      ...doc,
      layers: { ...doc.layers, constructor: { ...layerById(doc, 'layer-1'), id: 'constructor' } },
      legend: [{ type: 'layer', id: 'constructor' }],
    };
    expect(layer(legendModel(odd, { breaks: {} }), 'constructor').classes).toEqual([]);
  });
});

describe('legendModel: layers that are not drawn', () => {
  it('has a notice with the words of the engine, and no lines under the layer, but keeps the swatch and whether it is on', () => {
    const drawable = [
      entry(1, 'not_drawn', [
        finding(
          'warning',
          'Its coordinate system is not known.',
          'Change the map’s coordinate system.',
        ),
      ]),
    ];
    const l = layer(
      legendModel(sampleScene(), { breaks: { 'layer-1': breaks }, drawable }),
      'layer-1',
    );
    expect(l).toMatchObject({
      drawn: false,
      visible: true,
      notice: {
        message: 'Its coordinate system is not known.',
        hint: 'Change the map’s coordinate system.',
      },
      classes: [],
    });
    expect(l.swatch.kind).toBe('ramp');
  });

  it('says an error before a warning before anything else, and has no hint when the finding has none', () => {
    const findings = [
      finding('info', 'info'),
      finding('warning', 'warning'),
      finding('error', 'the error'),
    ];
    const notice = (list: Finding[]) =>
      layer(legendModel(sampleScene(), { drawable: [entry(1, 'not_drawn', list)] }), 'layer-1')
        .notice;
    expect(notice(findings)).toStrictEqual({ message: 'the error' });
    expect(notice(findings.slice(0, 2))).toStrictEqual({ message: 'warning' });
    expect(notice(findings.slice(0, 1))).toStrictEqual({ message: 'info' });
  });

  it('says something when the engine gave no finding, so that a layer that is not drawn is never without a reason', () => {
    const l = layer(legendModel(sampleScene(), { drawable: [entry(1, 'not_drawn')] }), 'layer-1');
    expect(l.notice?.message).toBe(
      'This dataset cannot be drawn in the coordinate system of the map.',
    );
    expect(l.notice).not.toHaveProperty('hint');
  });

  it('has no notice for a layer that is drawn, whatever the engine said besides, or for a dataset it did not mention', () => {
    const drawable = [
      entry(1, 'drawn', [finding('info', 'It was assumed to be the same grid.')]),
      entry(2, 'not_drawn'),
    ];
    const model = legendModel(sampleScene(), { drawable });
    expect(layer(model, 'layer-1')).toMatchObject({ drawn: true });
    expect(layer(model, 'layer-1')).not.toHaveProperty('notice');
    expect(layer(model, 'layer-2')).toMatchObject({ drawn: false });
    expect(layer(model, 'layer-3')).toMatchObject({ drawn: true });
    expect(layer(model, 'layer-3')).not.toHaveProperty('notice');
  });

  it('never changes what it is given', () => {
    const doc = frozen(sampleScene());
    const inputs = frozen({
      breaks: { 'layer-1': breaks },
      drawable: [entry(2, 'not_drawn', [finding('error', 'x')])],
    });
    expect(legendModel(doc, inputs).layerCount).toBe(3);
  });
});
