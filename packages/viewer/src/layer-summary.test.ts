import type { Finding } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import type { LayerState } from './layer-pipeline.js';
import { datasetNotices, sameNotices, summariseLayers } from './layer-summary.js';

const preparing = (fraction: number): LayerState => ({ status: 'preparing', fraction });
const drawn: LayerState = { status: 'drawn' };
const finding = (message: string, hint = ''): Finding =>
  ({ code: 'x', severity: 'warning', message, hint, count: 1, examples: [] }) as unknown as Finding;
const notDrawn = (...findings: Finding[]): LayerState => ({ status: 'not_drawn', findings });

describe('summariseLayers', () => {
  it('has nothing to say of no layers', () => {
    expect(summariseLayers([])).toEqual({ preparing: 0, progress: 0, reasons: [] });
  });

  it('counts the layers that are being prepared, and how far along all of them are, a layer that is ready counting whole', () => {
    expect(summariseLayers([preparing(0.5), preparing(0), drawn, drawn])).toMatchObject({
      preparing: 2,
      progress: (0.5 + 0 + 1 + 1) / 4,
    });
    expect(summariseLayers([preparing(0.25)])).toMatchObject({ preparing: 1, progress: 0.25 });
    expect(summariseLayers([preparing(1), preparing(1)])).toMatchObject({
      preparing: 2,
      progress: 1,
    });
  });

  it('says nothing is the matter while any layer is being prepared, or any is drawn', () => {
    expect(summariseLayers([notDrawn(finding('a')), preparing(0.1)]).reasons).toEqual([]);
    expect(summariseLayers([notDrawn(finding('a')), drawn]).reasons).toEqual([]);
  });

  it("gives the reason of each layer that cannot be drawn, once none is being prepared and none is drawn: the engine's words and its hint", () => {
    expect(
      summariseLayers([
        notDrawn(finding('The code is not known.', 'Change the coordinate system.')),
        notDrawn(finding('Local grids and EPSG do not mix.')),
      ]).reasons,
    ).toEqual([
      'The code is not known. Change the coordinate system.',
      'Local grids and EPSG do not mix.',
    ]);
  });

  it('says why in words of its own when the engine said no finding, or the preparing failed, or the kind is not drawn', () => {
    expect(
      summariseLayers([
        notDrawn(),
        { status: 'failed', message: 'The worker stopped.' },
        { status: 'unsupported' },
      ]).reasons,
    ).toEqual([
      'It cannot be drawn in the coordinate system of the map.',
      'The worker stopped.',
      'This kind of data is not drawn yet.',
    ]);
  });

  it('has no stray space when a finding has no hint, whether it is empty or not there', () => {
    const bare = {
      code: 'x',
      severity: 'warning',
      message: 'Plain.',
      count: 1,
      examples: [],
    } as unknown as Finding;
    expect(summariseLayers([notDrawn(bare), notDrawn(finding('Empty.', ''))]).reasons).toEqual([
      'Plain.',
      'Empty.',
    ]);
  });

  it('takes only the first finding of a layer: the one that says why', () => {
    expect(summariseLayers([notDrawn(finding('first'), finding('second'))]).reasons).toEqual([
      'first',
    ]);
  });
});

describe('datasetNotices', () => {
  const layers = {
    'layer-1': { datasetId: 1 },
    'layer-2': { datasetId: 2 },
    'layer-3': { datasetId: 2 },
  };
  const states = (...entries: [string, LayerState][]) => new Map(entries);

  it('has nothing for no layers, and for layers that are drawn or being prepared', () => {
    expect(datasetNotices(states(), layers).size).toBe(0);
    expect(
      datasetNotices(states(['layer-1', drawn], ['layer-2', preparing(0.5)]), layers).size,
    ).toBe(0);
  });

  it('gives the reason and the hint of a dataset whose layer is not drawn, by the dataset’s number', () => {
    const notices = datasetNotices(
      states(
        ['layer-1', drawn],
        [
          'layer-2',
          notDrawn(finding('It is a local grid.', 'Change the map’s coordinate system to it.')),
        ],
      ),
      layers,
    );
    expect([...notices]).toEqual([
      [2, 'It is a local grid. Change the map’s coordinate system to it.'],
    ]);
  });

  it('says a failure and a kind that is not drawn in words', () => {
    expect([
      ...datasetNotices(
        states(['layer-1', { status: 'failed', message: 'The worker stopped.' }]),
        layers,
      ),
    ]).toEqual([[1, 'The worker stopped.']]);
    expect([...datasetNotices(states(['layer-1', { status: 'unsupported' }]), layers)]).toEqual([
      [1, 'This kind of data is not drawn yet.'],
    ]);
  });

  it('has the first reason of a dataset with several layers that are not drawn', () => {
    const notices = datasetNotices(
      states(['layer-2', notDrawn(finding('first'))], ['layer-3', notDrawn(finding('second'))]),
      layers,
    );
    expect([...notices]).toEqual([[2, 'first']]);
  });

  it('leaves out a layer that the scene does not have', () => {
    expect(datasetNotices(states(['layer-9', notDrawn(finding('lost'))]), layers).size).toBe(0);
  });
});

describe('sameNotices', () => {
  it('is true for the same reasons for the same datasets, whatever the order', () => {
    expect(sameNotices(new Map(), new Map())).toBe(true);
    expect(
      sameNotices(
        new Map([
          [1, 'a'],
          [2, 'b'],
        ]),
        new Map([
          [2, 'b'],
          [1, 'a'],
        ]),
      ),
    ).toBe(true);
  });

  it('is false for another reason, another dataset, and one more or fewer', () => {
    expect(sameNotices(new Map([[1, 'a']]), new Map([[1, 'b']]))).toBe(false);
    expect(sameNotices(new Map([[1, 'a']]), new Map([[2, 'a']]))).toBe(false);
    expect(sameNotices(new Map([[1, 'a']]), new Map())).toBe(false);
    expect(sameNotices(new Map(), new Map([[1, 'a']]))).toBe(false);
  });
});
