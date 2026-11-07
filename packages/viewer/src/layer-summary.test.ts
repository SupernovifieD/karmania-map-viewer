import type { Finding } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import type { LayerState } from './layer-pipeline.js';
import { summariseLayers } from './layer-summary.js';

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
