import { createSceneStore } from '@karmania/scene';
import type { SceneStore } from '@karmania/scene';
import type {
  ContourDefaultsResult,
  ContourParams,
  Finding,
  LoadResult,
  Summary,
} from '@karmania/engine/types';
import { describe, expect, it, vi } from 'vitest';
import { ContoursManager } from './contours-manager.js';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const finding = (code: string): Finding => ({
  code,
  severity: 'warning',
  message: `Message of ${code}.`,
  hint: 'A hint to follow.',
  count: 1,
  examples: [],
});

function summary(
  id: number,
  name: string,
  kind: Summary['kind'],
  derivedFrom?: Summary['derivedFrom'],
): Summary {
  return {
    id,
    name,
    kind,
    elementCount: 10,
    hasZ: false,
    columns: [{ name: 'height', type: 'float', nullCount: 0 }],
    findings: [],
    ...(derivedFrom === undefined ? {} : { derivedFrom }),
  };
}

/** A job of the fake engine that has been asked for and not answered. */
interface Pending {
  readonly dataset: number;
  readonly params: ContourParams;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (result: LoadResult) => void;
  readonly reject: (error: unknown) => void;
}

function world(kind: Summary['kind'] = 'grid', rejectOnAbort = true) {
  const scene: SceneStore = createSceneStore();
  let datasets: Summary[] = [summary(1, 'Surface', kind)];
  let next = 10;
  const pending: Pending[] = [];
  const adopted: number[][] = [];
  const removed: number[] = [];
  const defaults = vi.fn<(id: number, column?: string) => Promise<ContourDefaultsResult>>();
  const engine = {
    datasets: () => datasets,
    contours: (dataset: number, params: ContourParams, options?: { signal?: AbortSignal }) =>
      new Promise<LoadResult>((resolve, reject) => {
        const entry: Pending = { dataset, params, signal: options?.signal, resolve, reject };
        pending.push(entry);
        if (rejectOnAbort) {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('stopped', 'AbortError'));
          });
        }
      }),
    contourDefaults: defaults,
    remove: vi.fn((id: number) => {
      removed.push(id);
      datasets = datasets.filter((dataset) => dataset.id !== id && dataset.derivedFrom?.id !== id);
      return Promise.resolve();
    }),
  };
  const manager = new ContoursManager({
    engine,
    scene,
    adopt: (list) => {
      adopted.push(list.map((dataset) => dataset.id));
    },
  });
  scene.subscribe(() => {
    manager.update();
  });
  scene.dispatch({
    type: 'addLayers',
    datasets: [{ id: 1, name: 'Surface', kind, elementCount: 10, columns: [] }],
  });
  /** What the engine does when a job is done: the lines replace those made before from the dataset, and the job's promise is settled. */
  const finish = async (index: number): Promise<Summary> => {
    const job = pending[index];
    if (job === undefined) throw new Error('no such job');
    const id = next;
    next += 1;
    const lines = summary(
      id,
      `Contours of Surface (every ${String(job.params.interval)})`,
      'lines',
      {
        id: job.dataset,
        kind: 'contours',
        params: job.params,
      },
    );
    datasets = [...datasets.filter((dataset) => dataset.derivedFrom?.id !== job.dataset), lines];
    job.resolve({ status: 'loaded', summaries: [lines] });
    await settle();
    return lines;
  };
  const refuse = async (index: number, ...findings: Finding[]): Promise<void> => {
    const job = pending[index];
    if (job === undefined) throw new Error('no such job');
    datasets = datasets.filter((dataset) => dataset.derivedFrom?.id !== job.dataset);
    job.resolve({ status: 'blocked', findings });
    await settle();
  };
  const contours = (over: Partial<ContourParams & { visible: boolean }> = {}): void => {
    scene.dispatch({
      type: 'setContours',
      layerId: 'layer-1',
      contours: { column: 'height', interval: 2.5, base: 0, indexEvery: 5, visible: true, ...over },
    });
  };
  const derived = () =>
    Object.values(scene.getState().layers).find((layer) => layer.derived !== undefined);
  return {
    scene,
    manager,
    engine,
    pending,
    adopted,
    removed,
    defaults,
    finish,
    refuse,
    contours,
    derived,
    datasets: () => datasets,
  };
}

describe('the contours of a layer', () => {
  it('are made when the layer has them: the engine is asked with the settings, and the layer of the lines is made above the layer', async () => {
    const w = world();
    expect(w.pending).toHaveLength(0);
    w.contours();
    expect(w.pending).toHaveLength(1);
    expect(w.pending[0]).toMatchObject({
      dataset: 1,
      params: { column: 'height', interval: 2.5, base: 0, indexEvery: 5 },
    });
    expect(w.manager.state('layer-1')).toEqual({ status: 'making' });
    const lines = await w.finish(0);
    expect(w.derived()).toMatchObject({
      datasetId: lines.id,
      name: lines.name,
      visible: true,
      derived: { kind: 'contours', sourceLayer: 'layer-1' },
    });
    const order = w.scene.getState().legend.map((node) => node.id);
    expect(order).toEqual(['layer-2', 'layer-1']);
    expect(w.adopted).toEqual([[1, lines.id]]);
    expect(w.manager.state('layer-1')).toEqual({ status: 'idle' });
    // Nothing more is asked while the settings are what the lines were made with, whatever else changes.
    w.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    w.scene.dispatch({ type: 'setViewMode', mode: '2d' });
    expect(w.pending).toHaveLength(1);
  });

  it('are made again when the settings change, and the layer of the lines keeps its place and its style', async () => {
    const w = world();
    w.contours();
    const first = await w.finish(0);
    const layer = w.derived();
    w.scene.dispatch({
      type: 'setStyle',
      layerId: layer?.id ?? '',
      patch: { opacity: 0.4, colour: { mode: 'single', value: '#112233' } },
    });
    w.contours({ interval: 5 });
    expect(w.pending).toHaveLength(2);
    expect(w.pending[1]?.params.interval).toBe(5);
    const second = await w.finish(1);
    expect(second.id).not.toBe(first.id);
    const again = w.derived();
    expect(again?.id).toBe(layer?.id);
    expect(again).toMatchObject({
      datasetId: second.id,
      name: second.name,
      style: { colour: { mode: 'single', value: '#112233' }, opacity: 0.4 },
    });
    expect(Object.values(w.scene.getState().layers)).toHaveLength(2);
  });

  it('stop what is under way when the settings change again, and only the last is used', async () => {
    const w = world();
    w.contours();
    w.contours({ interval: 5 });
    w.contours({ interval: 10 });
    expect(w.pending).toHaveLength(3);
    expect(w.pending[0]?.signal?.aborted).toBe(true);
    expect(w.pending[1]?.signal?.aborted).toBe(true);
    expect(w.pending[2]?.signal?.aborted).toBe(false);
    await settle();
    expect(w.derived()).toBeUndefined();
    await w.finish(2);
    expect(w.derived()?.name).toBe('Contours of Surface (every 10)');
    expect(w.manager.state('layer-1')).toEqual({ status: 'idle' });
  });

  it('are not taken from a request that was stopped but answered all the same: the engine resolves a job that was already done when it was stopped', async () => {
    const w = world('grid', false);
    w.contours();
    w.contours({ interval: 5 });
    expect(w.pending[0]?.signal?.aborted).toBe(true);
    // The first is answered after it was stopped: its lines are not the layer's.
    const late = await w.finish(0);
    expect(w.derived()).toBeUndefined();
    expect(w.manager.state('layer-1')).toEqual({ status: 'making' });
    const current = await w.finish(1);
    expect(w.derived()?.datasetId).toBe(current.id);
    expect(w.derived()?.datasetId).not.toBe(late.id);
  });

  it('go, with the layer of the lines and the dataset, when the layer has no contours any more, and stop what is under way', async () => {
    const w = world();
    w.contours();
    const lines = await w.finish(0);
    w.scene.dispatch({ type: 'setContours', layerId: 'layer-1', contours: null });
    expect(w.derived()).toBeUndefined();
    expect(w.removed).toEqual([lines.id]);
    await settle();
    expect(w.adopted.at(-1)).toEqual([1]);
    // While they are being made again, and then not wanted.
    w.contours({ interval: 7 });
    expect(w.pending).toHaveLength(2);
    w.scene.dispatch({ type: 'setContours', layerId: 'layer-1', contours: null });
    expect(w.pending[1]?.signal?.aborted).toBe(true);
    await settle();
    expect(w.manager.state('layer-1')).toEqual({ status: 'idle' });
    expect(w.derived()).toBeUndefined();
  });

  it('say why they were not made, take the old lines out of the scene as the engine did, and are not asked for again with the same settings', async () => {
    const w = world();
    w.contours();
    await w.finish(0);
    w.contours({ interval: 0.001 });
    await w.refuse(1, finding('contours.levels.too_many'));
    expect(w.derived()).toBeUndefined();
    expect(w.adopted.at(-1)).toEqual([1]);
    const state = w.manager.state('layer-1');
    expect(state.status === 'failed' && state.findings.map((f) => f.code)).toEqual([
      'contours.levels.too_many',
    ]);
    // The same settings are not asked again for a change that is not theirs.
    w.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.3 } });
    expect(w.pending).toHaveLength(2);
    // Other settings are asked, and the reason is forgotten while they are.
    w.contours({ interval: 2 });
    expect(w.pending).toHaveLength(3);
    expect(w.manager.state('layer-1')).toEqual({ status: 'making' });
    await w.finish(2);
    expect(w.manager.state('layer-1')).toEqual({ status: 'idle' });
    expect(w.derived()).toBeDefined();
  });

  it('say that the engine could not, as a fault and not a finding, unless the dataset was removed or the work stopped', async () => {
    const w = world();
    w.contours();
    w.pending[0]?.reject(new Error('The worker failed.'));
    await settle();
    expect(w.manager.state('layer-1')).toEqual({
      status: 'failed',
      findings: [],
      fault: 'The worker failed.',
    });
    // Not again for the same settings.
    w.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.3 } });
    expect(w.pending).toHaveLength(1);
    // The layer is removed while the lines are being made: its job fails and nothing is told of a layer that is not there.
    w.contours({ interval: 4 });
    w.scene.dispatch({ type: 'removeLayersOfDataset', datasetId: 1 });
    w.pending[1]?.reject(new Error('The dataset was removed.'));
    await settle();
    expect(w.manager.state('layer-1')).toEqual({ status: 'idle' });
  });

  it('are shown or hidden with the layer of the lines as the contours are made shown or hidden, and not against a person who hid the layer', async () => {
    const w = world();
    w.contours();
    await w.finish(0);
    const lines = w.derived();
    if (lines === undefined) throw new Error('no layer of lines');
    w.contours({ visible: false });
    expect(w.derived()?.visible).toBe(false);
    w.contours({ visible: true });
    expect(w.derived()?.visible).toBe(true);
    // A person hides the layer of the lines in the legend: other changes of the contours' settings that are not of whether they are shown leave it so.
    w.scene.dispatch({ type: 'setVisible', layerId: lines.id, visible: false });
    w.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.8 } });
    expect(w.derived()?.visible).toBe(false);
    // And the contours being made shown again shows it.
    w.contours({ visible: false });
    w.contours({ visible: true });
    expect(w.derived()?.visible).toBe(true);
  });

  it('are not made for the layers that have none, nor for the layers of the lines, which have none of their own', async () => {
    const w = world();
    w.scene.dispatch({ type: 'setViewMode', mode: '2d' });
    expect(w.pending).toHaveLength(0);
    w.contours();
    await w.finish(0);
    const lines = w.derived();
    if (lines === undefined) throw new Error('no layer of lines');
    // (The scene does not give contours to a layer of lines: the command refuses it.)
    w.scene.dispatch({
      type: 'setContours',
      layerId: lines.id,
      contours: { interval: 1, base: 0, indexEvery: 5, visible: true },
    });
    expect(w.pending).toHaveLength(1);
    expect(w.engine.remove).not.toHaveBeenCalled();
  });

  it('start at the settings the engine says, shown, and say why a dataset has none', async () => {
    const w = world();
    w.defaults.mockResolvedValueOnce({
      status: 'defaults',
      params: { column: 'height', interval: 2.5, base: 0, indexEvery: 5 },
    });
    await w.manager.turnOn('layer-1');
    expect(w.defaults).toHaveBeenCalledWith(1, undefined);
    expect(w.scene.getState().layers['layer-1']?.contours).toEqual({
      column: 'height',
      interval: 2.5,
      base: 0,
      indexEvery: 5,
      visible: true,
    });
    expect(w.pending).toHaveLength(1);
    // Contours that a layer has already are not started again.
    await w.manager.turnOn('layer-1');
    expect(w.defaults).toHaveBeenCalledTimes(1);

    const other = world('points');
    other.defaults.mockResolvedValueOnce({
      status: 'not_available',
      findings: [finding('contours.kind.unsupported')],
    });
    await other.manager.turnOn('layer-1');
    expect(other.scene.getState().layers['layer-1']?.contours).toBeUndefined();
    const state = other.manager.state('layer-1');
    expect(state.status === 'failed' && state.findings[0]?.code).toBe('contours.kind.unsupported');
    other.defaults.mockRejectedValueOnce(new Error('No worker.'));
    await other.manager.turnOn('layer-1');
    expect(other.manager.state('layer-1')).toMatchObject({ status: 'failed', fault: 'No worker.' });
    // A layer that is not there, or is one of lines made from another, has none to start.
    const nothing = world();
    await nothing.manager.turnOn('layer-9');
    expect(nothing.defaults).not.toHaveBeenCalled();
  });

  it('are let go of when the manager is: what is under way is stopped, and nothing is changed afterwards', async () => {
    const w = world();
    w.contours();
    w.manager.dispose();
    expect(w.pending[0]?.signal?.aborted).toBe(true);
    await settle();
    expect(w.derived()).toBeUndefined();
    w.contours({ interval: 3 });
    expect(w.pending).toHaveLength(1);
  });
});
