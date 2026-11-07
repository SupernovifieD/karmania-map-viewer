import type { Engine, PrepareOptions, PrepareParams } from '@karmania/engine';
import type {
  ClassBreaks,
  ClassifyResult,
  Frame,
  FrameChoice,
  PrepareResult,
  RenderBuffers,
} from '@karmania/engine/display';
import type { Finding } from '@karmania/engine/types';
import { DEFAULT_SCALE_LIMITS } from '@karmania/render';
import { OTHER_COLOUR, createSceneStore, fitCamera2d } from '@karmania/scene';
import type { NewDataset, SceneStore } from '@karmania/scene';
import { describe, expect, it, vi } from 'vitest';
import { FIT_PADDING, LayerPipeline, ZOOM_IN_LIMIT, ZOOM_OUT_LIMIT } from './layer-pipeline.js';
import type { LayerSink } from './layer-pipeline.js';

const frame = (
  origin: readonly [number, number, number] = [1000, 2000, 0],
  code = 32640,
): Frame => ({
  mapCrs: { kind: 'epsg', code },
  origin,
  source: 'auto',
});

const dataset = (id: number): NewDataset => ({
  id,
  name: `Dataset ${String(id)}`,
  kind: 'points',
  elementCount: 2,
  columns: [],
});

/** Two points, 10 apart each way, relative to the origin of the frame. */
const buffers = (scale = 10): RenderBuffers => ({
  kind: 'points',
  positions: Float32Array.of(0, 0, 0, scale, scale, 5),
});

const finding = (code: string): Finding =>
  ({
    code,
    severity: 'warning',
    message: code,
    hint: '',
    count: 1,
    examples: [],
  }) as unknown as Finding;

type ClassMethodName = Parameters<Engine['classify']>[2];

/** The classes of two ranges of a column. */
const ranges = (column: string): ClassBreaks => ({
  kind: 'ranges',
  column,
  bounds: [0, 1, 2],
  counts: [1, 1],
  nulls: 0,
});

/** A promise that is settled from outside, so that a request can be held in flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface PrepareCall {
  readonly id: number;
  readonly params: PrepareParams;
  readonly options: PrepareOptions | undefined;
}

/** An engine that answers as it is told, and remembers what it was asked. */
function fakeEngine() {
  const chooseCalls: (Frame['mapCrs'] | undefined)[] = [];
  const prepareCalls: PrepareCall[] = [];
  const classifyCalls: [id: number, column: string, method: string, classes: number][] = [];
  const classIndexCalls: [id: number, breaks: ClassBreaks][] = [];
  const state: {
    choice: () => FrameChoice;
    prepare: (call: PrepareCall) => Promise<PrepareResult>;
    classify: (
      id: number,
      column: string,
      method: string,
      classes: number,
    ) => Promise<ClassifyResult>;
    classIndex: (id: number, breaks: ClassBreaks) => Promise<Uint8Array>;
  } = {
    choice: () => ({ frame: frame(), drawable: [], findings: [] }),
    prepare: () => Promise.resolve({ status: 'drawn', buffers: buffers(), findings: [] }),
    classify: (_id, column) => Promise.resolve({ status: 'classified', breaks: ranges(column) }),
    classIndex: () => Promise.resolve(Uint8Array.of(0, 1)),
  };
  return {
    chooseCalls,
    prepareCalls,
    classifyCalls,
    classIndexCalls,
    state,
    engine: {
      chooseFrame: (preferred?: Frame['mapCrs']): Promise<FrameChoice> => {
        chooseCalls.push(preferred);
        return Promise.resolve(state.choice());
      },
      prepare: (
        id: number,
        params: PrepareParams,
        options?: PrepareOptions,
      ): Promise<PrepareResult> => {
        const call = { id, params, options };
        prepareCalls.push(call);
        return state.prepare(call);
      },
      classify: (
        id: number,
        column: string,
        method: ClassMethodName,
        classes: number,
      ): Promise<ClassifyResult> => {
        classifyCalls.push([id, column, method, classes]);
        return state.classify(id, column, method, classes);
      },
      classIndex: (id: number, breaks: ClassBreaks): Promise<Uint8Array> => {
        classIndexCalls.push([id, breaks]);
        return state.classIndex(id, breaks);
      },
    },
  };
}

function setup(sinkOverride?: LayerSink | null) {
  const scene: SceneStore = createSceneStore();
  const fake = fakeEngine();
  const sink = {
    setLayer: vi.fn((): 'drawn' | 'unsupported' => 'drawn'),
    setLayerClasses: vi.fn<LayerSink['setLayerClasses']>(),
    removeLayer: vi.fn(() => true),
    setDepthRange: vi.fn(),
    maxTextureSize: 8192,
  };
  let current: LayerSink | undefined = sinkOverride === null ? undefined : (sinkOverride ?? sink);
  /** The first column of numbers of a dataset, which the viewer knows and the tests say. */
  let firstColumn: (datasetId: number) => string | undefined = () => undefined;
  const changes = vi.fn();
  const pipeline = new LayerPipeline({
    engine: fake.engine,
    scene,
    sink: () => current,
    viewport: () => ({ width: 1000, height: 500 }),
    firstColumn: (datasetId) => firstColumn(datasetId),
    onChange: changes,
  });
  scene.subscribe(() => {
    pipeline.update();
  });
  /** Gives the scene datasets and lets the pipeline settle. */
  const add = async (...ids: number[]): Promise<void> => {
    scene.dispatch({ type: 'addLayers', datasets: ids.map(dataset) });
    await pipeline.idle();
  };
  const drawable = (...entries: [number, boolean][]) => {
    fake.state.choice = () => ({
      frame: frame(),
      drawable: entries.map(([id, drawn]) => ({
        id,
        status: drawn ? ('drawn' as const) : ('not_drawn' as const),
        reprojected: false,
        findings: drawn ? [] : [finding('display.not_drawn')],
      })),
      findings: [],
    });
  };
  return {
    scene,
    pipeline,
    sink,
    changes,
    add,
    drawable,
    setSink: (next: LayerSink | undefined) => {
      current = next;
    },
    setFirstColumn: (next: (datasetId: number) => string | undefined) => {
      firstColumn = next;
    },
    ...fake,
  };
}

/** The states of the layers as `[id, status]`, in the order the pipeline met them. */
const statuses = (pipeline: LayerPipeline): [string, string][] =>
  [...pipeline.states()].map(([id, state]) => [id, state.status]);

describe('LayerPipeline: from the scene to the card', () => {
  it('asks for the frame once, prepares the layer for it, and gives the buffers to the renderer', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    expect(t.chooseCalls).toEqual([undefined]);
    expect(t.scene.getState().frame).toEqual(frame());
    expect(t.prepareCalls).toHaveLength(1);
    expect(t.prepareCalls[0]?.id).toBe(0);
    expect(t.prepareCalls[0]?.params).toEqual({ frame: frame(), maxTextureSize: 8192 });
    expect(t.sink.setLayer).toHaveBeenCalledExactlyOnceWith('layer-1', buffers());
    expect(statuses(t.pipeline)).toEqual([['layer-1', 'drawn']]);
  });

  it('does nothing more for a change of the scene that needs nothing: a style, the camera', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: false });
    await t.pipeline.idle();
    t.scene.dispatch({ type: 'setCamera', patch: { camera2d: { centre: [5, 5] } } });
    await t.pipeline.idle();
    t.pipeline.update();
    await t.pipeline.idle();
    expect(t.chooseCalls).toHaveLength(1);
    expect(t.prepareCalls).toHaveLength(1);
    expect(t.sink.setLayer).toHaveBeenCalledTimes(1);
  });

  it('says that buffers the renderer does not draw are unsupported, and that the layer is there for the fit all the same', async () => {
    const t = setup();
    t.sink.setLayer.mockReturnValue('unsupported');
    t.drawable([0, true]);
    await t.add(0);
    expect(statuses(t.pipeline)).toEqual([['layer-1', 'unsupported']]);
    expect(t.scene.getState().camera2d.centre).toEqual([1005, 2005]);
  });

  it('does not prepare a dataset that is not drawn in the frame, and says why', async () => {
    const t = setup();
    t.drawable([0, true], [1, false]);
    await t.add(0, 1);
    expect(t.prepareCalls.map((call) => call.id)).toEqual([0]);
    const states = t.pipeline.states();
    expect(states.get('layer-1')).toEqual({ status: 'drawn' });
    expect(states.get('layer-2')).toEqual({
      status: 'not_drawn',
      findings: [finding('display.not_drawn')],
    });
    // It is not on the card, and in case it was (the frame changed), it is taken off.
    expect(t.sink.removeLayer).toHaveBeenCalledWith('layer-2');
  });

  it('says what prepare says when it finds the dataset cannot be drawn', async () => {
    const t = setup();
    t.drawable([0, true]);
    t.state.prepare = () =>
      Promise.resolve({ status: 'not_drawn', findings: [finding('display.no_geometry')] });
    await t.add(0);
    expect(t.pipeline.states().get('layer-1')).toEqual({
      status: 'not_drawn',
      findings: [finding('display.no_geometry')],
    });
    expect(t.sink.setLayer).not.toHaveBeenCalled();
  });

  it('says how far a request has got, and then that it is done', async () => {
    const t = setup();
    t.drawable([0, true]);
    const held = deferred<PrepareResult>();
    t.state.prepare = (call) => {
      call.options?.onProgress?.({ fraction: 0.4 });
      return held.promise;
    };
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(0)] });
    await vi.waitFor(() => {
      expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'preparing', fraction: 0.4 });
    });
    held.resolve({ status: 'drawn', buffers: buffers(), findings: [] });
    await t.pipeline.idle();
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
    expect(t.changes).toHaveBeenCalled();
  });

  it('aborts the request of a layer that is removed, at once, and takes the layer off the card', async () => {
    const t = setup();
    t.drawable([0, true]);
    const held = deferred<PrepareResult>();
    t.state.prepare = (call) => {
      call.options?.signal?.addEventListener('abort', () => {
        held.reject(call.options?.signal?.reason);
      });
      return held.promise;
    };
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(0)] });
    await vi.waitFor(() => {
      expect(t.prepareCalls).toHaveLength(1);
    });
    t.scene.dispatch({ type: 'removeLayersOfDataset', datasetId: 0 });
    // The pipeline is still waiting for the request, and has aborted it already.
    expect(t.prepareCalls[0]?.options?.signal?.aborted).toBe(true);
    expect(t.sink.removeLayer).toHaveBeenCalledWith('layer-1');
    await t.pipeline.idle();
    expect(t.sink.setLayer).not.toHaveBeenCalled();
    expect(statuses(t.pipeline)).toEqual([]);
  });

  it('does not give the renderer what came back after the layer was removed, if the request could not be stopped', async () => {
    const t = setup();
    t.drawable([0, true]);
    const held = deferred<PrepareResult>();
    t.state.prepare = () => held.promise;
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(0)] });
    await vi.waitFor(() => {
      expect(t.prepareCalls).toHaveLength(1);
    });
    t.scene.dispatch({ type: 'removeLayersOfDataset', datasetId: 0 });
    held.resolve({ status: 'drawn', buffers: buffers(), findings: [] });
    await t.pipeline.idle();
    expect(t.sink.setLayer).not.toHaveBeenCalled();
  });

  it('prepares only the new layer when a dataset is added and the frame is the same', async () => {
    const t = setup();
    t.drawable([0, true], [1, true]);
    await t.add(0);
    await t.add(1);
    expect(t.chooseCalls).toHaveLength(2);
    expect(t.prepareCalls.map((call) => call.id)).toEqual([0, 1]);
    expect(t.sink.setLayer).toHaveBeenCalledTimes(2);
  });

  it('prepares every layer again when the frame changes, since the positions are relative to the origin', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    t.state.choice = () => ({
      frame: frame([5000, 6000, 0]),
      drawable: [0, 1].map((id) => ({
        id,
        status: 'drawn' as const,
        reprojected: false,
        findings: [],
      })),
      findings: [],
    });
    await t.add(1);
    expect(t.prepareCalls.map((call) => [call.id, call.params.frame.origin])).toEqual([
      [0, [1000, 2000, 0]],
      [0, [5000, 6000, 0]],
      [1, [5000, 6000, 0]],
    ]);
    expect(t.scene.getState().frame?.origin).toEqual([5000, 6000, 0]);
    expect(t.sink.setLayer).toHaveBeenCalledTimes(3);
  });

  it('aborts a request made for the old frame when the frame changes', async () => {
    const t = setup();
    t.drawable([0, true]);
    const held = deferred<PrepareResult>();
    let first = true;
    t.state.prepare = (call) => {
      if (first) {
        first = false;
        call.options?.signal?.addEventListener('abort', () => {
          held.reject(call.options?.signal?.reason);
        });
        return held.promise;
      }
      return Promise.resolve({ status: 'drawn', buffers: buffers(), findings: [] });
    };
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(0)] });
    await vi.waitFor(() => {
      expect(t.prepareCalls).toHaveLength(1);
    });
    // The person chooses a coordinate system, while the first request is out.
    t.state.choice = () => ({
      frame: { mapCrs: { kind: 'epsg', code: 32641 }, origin: [0, 0, 0], source: 'user' },
      drawable: [{ id: 0, status: 'drawn', reprojected: true, findings: [] }],
      findings: [],
    });
    t.scene.dispatch({
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 32641 }, origin: [0, 0, 0], source: 'user' },
    });
    expect(t.prepareCalls[0]?.options?.signal?.aborted).toBe(true);
    await t.pipeline.idle();
    expect(t.chooseCalls[1]).toEqual({ kind: 'epsg', code: 32641 });
    expect(t.prepareCalls).toHaveLength(2);
    expect(t.prepareCalls[1]?.params.frame.mapCrs).toEqual({ kind: 'epsg', code: 32641 });
    expect(t.sink.setLayer).toHaveBeenCalledTimes(1);
  });

  it('gives the engine the coordinate system that the person chose, and not one that it chose itself', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    expect(t.chooseCalls).toEqual([undefined]);
    t.scene.dispatch({
      type: 'setFrame',
      frame: { mapCrs: { kind: 'epsg', code: 4326 }, origin: [0, 0, 0], source: 'user' },
    });
    await t.pipeline.idle();
    expect(t.chooseCalls[1]).toEqual({ kind: 'epsg', code: 4326 });
  });

  it('does not take a frame that the person did not choose for a choice: only a frame of source user is asked for', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    // Something else puts another frame in the scene (an embedder; the engine's own is "auto"): it is not a preference.
    t.scene.dispatch({ type: 'setFrame', frame: frame([9, 9, 9], 32641) });
    await t.pipeline.idle();
    expect(t.chooseCalls).toEqual([undefined]);
    expect(t.prepareCalls).toHaveLength(1);
  });

  it('does not ask the engine for the frame again when nothing was drawable, until the datasets change', async () => {
    const t = setup();
    t.state.choice = () => ({
      frame: null,
      drawable: [{ id: 0, status: 'not_drawn', reprojected: false, findings: [] }],
      findings: [],
    });
    await t.add(0);
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: false });
    await t.pipeline.idle();
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: true });
    await t.pipeline.idle();
    expect(t.chooseCalls).toHaveLength(1);
  });

  it('tells the renderer the heights that are drawn, relative to the origin, before the layer is put on the card, and none when there is none', async () => {
    const t = setup();
    t.drawable([0, true]);
    t.state.choice = () => ({
      frame: frame([1000, 2000, 100]),
      drawable: [{ id: 0, status: 'drawn', reprojected: false, findings: [] }],
      findings: [],
    });
    // Two points at 3 and 9 above the origin of the frame.
    t.state.prepare = () =>
      Promise.resolve({
        status: 'drawn',
        buffers: { kind: 'points', positions: Float32Array.of(0, 0, 3, 1, 1, 9) },
        findings: [],
      });
    await t.add(0);
    expect(t.sink.setDepthRange).toHaveBeenCalledWith(3, 9);
    expect(t.sink.setDepthRange.mock.invocationCallOrder[0]).toBeLessThan(
      t.sink.setLayer.mock.invocationCallOrder[0] ?? Infinity,
    );
    t.scene.dispatch({ type: 'removeLayersOfDataset', datasetId: 0 });
    expect(t.sink.setDepthRange).toHaveBeenLastCalledWith(0, 0);
  });

  it('keeps what was prepared until the renderer is there, and gives it then', async () => {
    const t = setup(null);
    t.drawable([0, true]);
    await t.add(0);
    expect(t.prepareCalls[0]?.params.maxTextureSize).toBe(4096);
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'preparing', fraction: 1 });
    t.setSink(t.sink);
    t.pipeline.rendererReady();
    expect(t.sink.setLayer).toHaveBeenCalledExactlyOnceWith('layer-1', buffers());
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
    // And is not given twice.
    t.pipeline.rendererReady();
    expect(t.sink.setLayer).toHaveBeenCalledTimes(1);
  });

  it('says that a request that failed has failed, and goes on with the others', async () => {
    const t = setup();
    t.drawable([0, true], [1, true]);
    t.state.prepare = (call) =>
      call.id === 0
        ? Promise.reject(new Error('The worker stopped.'))
        : Promise.resolve({ status: 'drawn', buffers: buffers(), findings: [] });
    await t.add(0, 1);
    expect(t.pipeline.states().get('layer-1')).toEqual({
      status: 'failed',
      message: 'The worker stopped.',
    });
    expect(t.pipeline.states().get('layer-2')).toEqual({ status: 'drawn' });
  });

  it('says that every layer has failed if the frame cannot be had', async () => {
    const t = setup();
    t.engine.chooseFrame = () => Promise.reject(new Error('No engine.'));
    await t.add(0, 1);
    expect([...t.pipeline.states().values()]).toEqual([
      { status: 'failed', message: 'No engine.' },
      { status: 'failed', message: 'No engine.' },
    ]);
    expect(t.prepareCalls).toHaveLength(0);
  });

  it('says that nothing is drawn when the engine has no frame, and has no scene frame', async () => {
    const t = setup();
    t.state.choice = () => ({
      frame: null,
      drawable: [
        { id: 0, status: 'not_drawn', reprojected: false, findings: [finding('display.no_crs')] },
      ],
      findings: [],
    });
    await t.add(0);
    expect(t.pipeline.states().get('layer-1')?.status).toBe('not_drawn');
    expect(t.scene.getState().frame).toBeNull();
    expect(t.prepareCalls).toHaveLength(0);
  });

  it('gives up the frame when every layer is gone, and fits the next data again', async () => {
    const t = setup();
    t.drawable([0, true], [1, true]);
    await t.add(0);
    t.scene.dispatch({
      type: 'setCamera',
      patch: { camera2d: { centre: [1, 1], unitsPerPixel: 9 } },
    });
    t.scene.dispatch({ type: 'removeLayersOfDataset', datasetId: 0 });
    await t.pipeline.idle();
    expect(t.scene.getState().frame).toBeNull();
    expect(t.pipeline.limits()).toEqual(DEFAULT_SCALE_LIMITS);
    await t.add(1);
    expect(t.scene.getState().camera2d.centre).toEqual([1005, 2005]);
  });

  it('stops at dispose: the requests are aborted and the scene is not looked at again', async () => {
    const t = setup();
    t.drawable([0, true]);
    const held = deferred<PrepareResult>();
    t.state.prepare = () => held.promise;
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(0)] });
    await vi.waitFor(() => {
      expect(t.prepareCalls).toHaveLength(1);
    });
    t.pipeline.dispose();
    expect(t.prepareCalls[0]?.options?.signal?.aborted).toBe(true);
    await t.pipeline.idle();
    held.resolve({ status: 'drawn', buffers: buffers(), findings: [] });
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(7)] });
    await t.pipeline.idle();
    expect(t.chooseCalls).toHaveLength(1);
    expect(t.sink.setLayer).not.toHaveBeenCalled();
  });

  it('is idle when there is nothing to do, and not before it is done', async () => {
    const t = setup();
    await expect(t.pipeline.idle()).resolves.toBeUndefined();
    t.drawable([0, true]);
    const held = deferred<PrepareResult>();
    t.state.prepare = () => held.promise;
    t.scene.dispatch({ type: 'addLayers', datasets: [dataset(0)] });
    let done = false;
    void t.pipeline.idle().then(() => {
      done = true;
    });
    await vi.waitFor(() => {
      expect(t.prepareCalls).toHaveLength(1);
    });
    expect(done).toBe(false);
    held.resolve({ status: 'drawn', buffers: buffers(), findings: [] });
    await vi.waitFor(() => {
      expect(done).toBe(true);
    });
  });
});

describe('LayerPipeline: the view of the data', () => {
  it('puts the camera where the data fits, in the map area, when the first layer is prepared', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    const expected = fitCamera2d({
      extent: { min: [1000, 2000, 0], max: [1010, 2010, 5] },
      viewport: { width: 1000, height: 500 },
      heading: 0,
      padding: FIT_PADDING,
    });
    expect(expected).toBeDefined();
    expect(t.scene.getState().camera2d).toEqual(expected);
    expect(t.scene.getState().camera2d.centre).toEqual([1005, 2005]);
  });

  it('fits once: a camera that a person moved stays where it is when the scene changes', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    t.scene.dispatch({
      type: 'setCamera',
      patch: { camera2d: { centre: [1, 2], unitsPerPixel: 3 } },
    });
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: false });
    await t.pipeline.idle();
    expect(t.scene.getState().camera2d.centre).toEqual([1, 2]);
    expect(t.scene.getState().camera2d.unitsPerPixel).toBe(3);
  });

  it('fits the data of all the layers that are prepared, and a new one is not a reason to fit again', async () => {
    const t = setup();
    t.drawable([0, true], [1, true]);
    t.state.prepare = (call) =>
      Promise.resolve({
        status: 'drawn',
        buffers: buffers(call.id === 0 ? 10 : 100),
        findings: [],
      });
    await t.add(0);
    const first = t.scene.getState().camera2d;
    await t.add(1);
    expect(t.scene.getState().camera2d).toEqual(first);
    t.pipeline.fit();
    // Both layers now: from (1000, 2000) to (1100, 2100).
    expect(t.scene.getState().camera2d.centre).toEqual([1050, 2050]);
  });

  it('fits to the layers that are visible, and does nothing when none is', async () => {
    const t = setup();
    t.drawable([0, true], [1, true]);
    t.state.prepare = (call) =>
      Promise.resolve({
        status: 'drawn',
        buffers: buffers(call.id === 0 ? 10 : 100),
        findings: [],
      });
    await t.add(0, 1);
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-2', visible: false });
    t.pipeline.fit();
    expect(t.scene.getState().camera2d.centre).toEqual([1005, 2005]);
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: false });
    t.scene.dispatch({ type: 'setCamera', patch: { camera2d: { centre: [7, 7] } } });
    t.pipeline.fit();
    expect(t.scene.getState().camera2d.centre).toEqual([7, 7]);
  });

  it('keeps the heading of the camera when it fits', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    t.scene.dispatch({ type: 'setCamera', patch: { camera2d: { heading: 40 } } });
    t.pipeline.fit();
    expect(t.scene.getState().camera2d.heading).toBe(40);
  });

  it('fits again when the map changes to another coordinate system', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    t.scene.dispatch({
      type: 'setCamera',
      patch: { camera2d: { centre: [1, 2], unitsPerPixel: 3 } },
    });
    t.state.choice = () => ({
      frame: frame([0, 0, 0], 32641),
      drawable: [0, 1].map((id) => ({
        id,
        status: 'drawn' as const,
        reprojected: true,
        findings: [],
      })),
      findings: [],
    });
    await t.add(1);
    // Both datasets, relative to the new origin: the same 10 and the same 10.
    expect(t.scene.getState().camera2d.centre).toEqual([5, 5]);
  });

  it('limits the scale to what the fit makes of the data: a hundred thousand times closer and a hundred times farther', async () => {
    const t = setup();
    expect(t.pipeline.limits()).toEqual(DEFAULT_SCALE_LIMITS);
    t.drawable([0, true]);
    await t.add(0);
    const scale = t.scene.getState().camera2d.unitsPerPixel;
    expect(scale).toBeGreaterThan(0);
    expect(t.pipeline.limits()).toEqual({
      min: scale / ZOOM_IN_LIMIT,
      max: scale * ZOOM_OUT_LIMIT,
    });
    expect(ZOOM_IN_LIMIT).toBe(100_000);
    expect(ZOOM_OUT_LIMIT).toBe(100);
  });
});

/** A grid of two cells, with one column of numbers: its layer is coloured by classes of that column, as a grid's is at first. */
const gridDataset = (id: number): NewDataset => ({
  id,
  name: `Grid ${String(id)}`,
  kind: 'grid',
  elementCount: 2,
  columns: [{ name: 'Au', type: 'float', nullCount: 0 }],
});

const gridBuffers = (): RenderBuffers => ({
  kind: 'grid',
  size: [2, 1],
  tiles: [{ i0: 0, j0: 0, nx: 2, ny: 1 }],
  placement: { origin: [0, 0, 0], spacing: [10, 10], rotation: 0 },
});

/** A set-up whose datasets are grids. */
function gridSetup(sinkOverride?: LayerSink | null) {
  const t = setup(sinkOverride);
  t.state.prepare = () =>
    Promise.resolve({ status: 'drawn', buffers: gridBuffers(), findings: [] });
  const addGrid = async (...ids: number[]): Promise<void> => {
    t.scene.dispatch({ type: 'addLayers', datasets: ids.map(gridDataset) });
    await t.pipeline.idle();
  };
  return { ...t, addGrid };
}

describe('LayerPipeline: the classes of a layer', () => {
  it('asks the engine for the classes of the column the style names, and gives the renderer the class of each cell with a colour for each class', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    // The default style of a grid: its first column of numbers, in 7 classes of equal intervals, from viridis.
    expect(t.classifyCalls).toEqual([[0, 'Au', 'equal', 7]]);
    expect(t.classIndexCalls).toEqual([[0, ranges('Au')]]);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
    const [id, classes] = t.sink.setLayerClasses.mock.calls[0] ?? [];
    expect(id).toBe('layer-1');
    expect(classes?.indices).toEqual(Uint8Array.of(0, 1));
    // The colours of two classes: the first and last of viridis, as the legend has them.
    expect(classes?.colours).toHaveLength(2);
    expect(classes?.colours.every((colour: string) => /^#[0-9a-f]{6}$/.test(colour))).toBe(true);
    expect(statuses(t.pipeline)).toEqual([['layer-1', 'drawn']]);
  });

  it('has the classes ready before the layer is on the card, and gives them straight after it: the layer is not on the card without them', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    expect(t.sink.setLayer.mock.invocationCallOrder[0]).toBeGreaterThan(0);
    expect(t.sink.setLayerClasses.mock.invocationCallOrder[0]).toBeGreaterThan(
      t.sink.setLayer.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('does not ask for classes for a kind that is not coloured by them', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    expect(t.classifyCalls).toEqual([]);
    expect(t.sink.setLayerClasses).not.toHaveBeenCalled();
  });

  it('asks for the classes of a block model as for a grid, and gives them with the layer', async () => {
    const t = setup();
    t.drawable([0, true]);
    t.state.prepare = () =>
      Promise.resolve({
        status: 'drawn',
        buffers: {
          kind: 'blocks',
          centres: Float32Array.of(0, 0, 0, 10, 0, 0),
          spacing: [10, 10, 10],
          rotation: 0,
        },
        findings: [],
      });
    t.scene.dispatch({
      type: 'addLayers',
      datasets: [{ ...gridDataset(0), name: 'Blocks', kind: 'blocks' }],
    });
    await t.pipeline.idle();
    expect(t.classifyCalls).toEqual([[0, 'Au', 'equal', 7]]);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
    expect(t.sink.setLayerClasses.mock.calls[0]?.[1]?.indices).toEqual(Uint8Array.of(0, 1));
    expect(statuses(t.pipeline)).toEqual([['layer-1', 'drawn']]);
  });

  it('does not ask for classes for a layer of a kind that is not coloured by them, whatever its style says', async () => {
    const t = setup();
    t.drawable([0, true]);
    await t.add(0);
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'Au',
          method: 'equal',
          classes: 7,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    await t.pipeline.idle();
    expect(t.classifyCalls).toEqual([]);
    expect(t.sink.setLayerClasses).not.toHaveBeenCalled();
    expect(statuses(t.pipeline)).toEqual([['layer-1', 'drawn']]);
  });

  it('gives new colours, and asks the engine for nothing, when only the ramp changes, or its direction', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    const first = t.sink.setLayerClasses.mock.calls[0]?.[1];
    const style = t.scene.getState().layers['layer-1']?.style.colour;
    expect(style?.mode).toBe('classes');
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...(style as object), reverse: true } as never },
    });
    await t.pipeline.idle();
    expect(t.classifyCalls).toHaveLength(1);
    expect(t.classIndexCalls).toHaveLength(1);
    expect(t.prepareCalls).toHaveLength(1);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(2);
    const second = t.sink.setLayerClasses.mock.calls[1]?.[1];
    // The same classes of the cells (the same array, not worked out again), the colours the other way round.
    expect(second?.indices).toBe(first?.indices);
    expect(second?.colours).toEqual([...(first?.colours ?? [])].reverse());
  });

  it('asks the engine again, and only the engine, when the column, the method or the number of classes changes', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    const style = t.scene.getState().layers['layer-1']?.style.colour as {
      mode: 'classes';
      column: string;
      method: string;
      classes: number;
      ramp: string;
      reverse: boolean;
    };
    let now = style;
    for (const patch of [{ method: 'quantile' }, { classes: 5 }, { column: 'Cu' }]) {
      now = { ...now, ...patch };
      t.scene.dispatch({
        type: 'setStyle',
        layerId: 'layer-1',
        patch: { colour: now as never },
      });
      await t.pipeline.idle();
    }
    expect(t.classifyCalls).toEqual([
      [0, 'Au', 'equal', 7],
      [0, 'Au', 'quantile', 7],
      [0, 'Au', 'quantile', 5],
      [0, 'Cu', 'quantile', 5],
    ]);
    expect(t.classIndexCalls).toHaveLength(4);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(4);
    expect(t.prepareCalls).toHaveLength(1);
    expect(t.sink.setLayer).toHaveBeenCalledTimes(1);
  });

  it('gives nothing more for a change of the scene that is not of the classes: the visibility, the opacity, the camera', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    t.scene.dispatch({ type: 'setVisible', layerId: 'layer-1', visible: false });
    await t.pipeline.idle();
    t.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    await t.pipeline.idle();
    t.scene.dispatch({ type: 'setCamera', patch: { camera2d: { centre: [5, 5] } } });
    await t.pipeline.idle();
    expect(t.classifyCalls).toHaveLength(1);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
  });

  it('gives the classes again, without asking the engine, to the layer that is made again when the frame changes', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    t.state.choice = () => ({
      frame: frame([5000, 6000, 0]),
      drawable: [{ id: 0, status: 'drawn', reprojected: false, findings: [] }],
      findings: [],
    });
    t.scene.dispatch({
      type: 'setFrame',
      frame: { ...frame([5000, 6000, 0]), source: 'user' },
    });
    await t.pipeline.idle();
    expect(t.prepareCalls).toHaveLength(2);
    expect(t.sink.setLayer).toHaveBeenCalledTimes(2);
    expect(t.classifyCalls).toHaveLength(1);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(2);
    expect(t.sink.setLayerClasses.mock.calls[1]?.[1]).toBe(
      t.sink.setLayerClasses.mock.calls[0]?.[1],
    );
  });

  it('answers only the last request when the style changes while the engine is working', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    const slow = deferred<ClassifyResult>();
    t.state.classify = (_id, column, method) =>
      method === 'quantile'
        ? slow.promise
        : Promise.resolve({ status: 'classified', breaks: ranges(`${column}-${method}`) });
    const style = t.scene.getState().layers['layer-1']?.style.colour as object;
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, method: 'quantile' } as never },
    });
    await Promise.resolve();
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, method: 'jenks' } as never },
    });
    slow.resolve({ status: 'classified', breaks: ranges('late') });
    await t.pipeline.idle();
    await Promise.resolve();
    expect(t.classIndexCalls.map(([, breaks]) => (breaks as { column: string }).column)).toEqual([
      'Au',
      'Au-jenks',
    ]);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(2);
  });

  it('says that the layer is being prepared, and not drawn, while it is on the card without the classes that it is to be coloured by', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    const slow = deferred<ClassifyResult>();
    const log: string[] = [];
    t.sink.setLayer.mockImplementation(() => {
      log.push('setLayer');
      return 'drawn';
    });
    t.changes.mockImplementation(() => {
      log.push(t.pipeline.states().get('layer-1')?.status ?? 'none');
    });
    t.state.classify = (_id, column, method) =>
      method === 'equal'
        ? slow.promise
        : Promise.resolve({ status: 'classified', breaks: ranges(column) });
    t.scene.dispatch({ type: 'addLayers', datasets: [gridDataset(0)] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The style asks for other classes while the first are being worked out: the answer is dropped, and the layer goes on the card all the same.
    const style = t.scene.getState().layers['layer-1']?.style.colour as object;
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, method: 'quantile' } as never },
    });
    slow.resolve({ status: 'classified', breaks: ranges('late') });
    await t.pipeline.idle();
    const after = log.slice(log.indexOf('setLayer') + 1);
    expect(after[0]).toBe('preparing');
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
  });

  it('says that a layer whose column cannot be classified is not drawn, with the findings, and keeps the layer for when it can', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    t.state.classify = () =>
      Promise.resolve({ status: 'not_classified', findings: [finding('classes.column.missing')] });
    await t.addGrid(0);
    expect(t.pipeline.states().get('layer-1')).toEqual({
      status: 'not_drawn',
      findings: [finding('classes.column.missing')],
    });
    expect(t.sink.setLayerClasses).not.toHaveBeenCalled();
    expect(t.classIndexCalls).toEqual([]);
    expect(t.sink.removeLayer).not.toHaveBeenCalled();
    // The engine said no once, and is not asked again for the same classes whatever else changes.
    t.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    await t.pipeline.idle();
    t.scene.dispatch({ type: 'setCamera', patch: { camera2d: { centre: [5, 5] } } });
    await t.pipeline.idle();
    expect(t.classifyCalls).toHaveLength(1);
    expect(t.pipeline.states().get('layer-1')?.status).toBe('not_drawn');
    // A column it can be classified by makes it drawn.
    t.state.classify = (_id, column) =>
      Promise.resolve({ status: 'classified', breaks: ranges(column) });
    const style = t.scene.getState().layers['layer-1']?.style.colour as object;
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, column: 'Cu' } as never },
    });
    await t.pipeline.idle();
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
  });

  it('takes the classes away when the style asks for classes that cannot be had, and has them again, without the engine, when it asks for those that it had', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    const style = t.scene.getState().layers['layer-1']?.style.colour as object;
    t.state.classify = (_id, column) =>
      column === 'Cu'
        ? Promise.resolve({
            status: 'not_classified',
            findings: [finding('classes.column.missing')],
          })
        : Promise.resolve({ status: 'classified', breaks: ranges(column) });
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, column: 'Cu' } as never },
    });
    await t.pipeline.idle();
    expect(t.pipeline.states().get('layer-1')?.status).toBe('not_drawn');
    expect(t.sink.setLayerClasses).toHaveBeenLastCalledWith('layer-1', undefined);
    t.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { colour: style as never } });
    await t.pipeline.idle();
    // The classes of the first column were kept: they are given again and the engine is not asked.
    expect(t.classifyCalls).toEqual([
      [0, 'Au', 'equal', 7],
      [0, 'Cu', 'equal', 7],
    ]);
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(3);
    expect(t.sink.setLayerClasses.mock.calls[2]?.[1]?.indices).toBe(
      t.sink.setLayerClasses.mock.calls[0]?.[1]?.indices,
    );
  });

  it('says that a layer has failed when the engine fails to classify it', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    t.state.classify = () => Promise.reject(new Error('the worker stopped'));
    await t.addGrid(0);
    expect(t.pipeline.states().get('layer-1')).toEqual({
      status: 'failed',
      message: 'the worker stopped',
    });
    // It is not asked again for the same classes, and is for other classes, which it can give.
    t.scene.dispatch({ type: 'setStyle', layerId: 'layer-1', patch: { opacity: 0.5 } });
    await t.pipeline.idle();
    expect(t.classifyCalls).toHaveLength(1);
    t.state.classify = (_id, column) =>
      Promise.resolve({ status: 'classified', breaks: ranges(column) });
    const style = t.scene.getState().layers['layer-1']?.style.colour as object;
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, classes: 5 } as never },
    });
    await t.pipeline.idle();
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
  });

  it('takes the classes away, and does not draw the cells, when the layer is given one colour and the dataset has no column of numbers to say which cells have a value', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await t.pipeline.idle();
    expect(t.sink.setLayerClasses).toHaveBeenLastCalledWith('layer-1', undefined);
    // And back to classes: the engine's answer for the same classes is not asked for twice.
    const first = t.sink.setLayerClasses.mock.calls[0]?.[1];
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: {
        colour: {
          mode: 'classes',
          column: 'Au',
          method: 'equal',
          classes: 7,
          ramp: 'viridis',
          reverse: false,
        },
      },
    });
    await t.pipeline.idle();
    expect(t.classifyCalls).toHaveLength(1);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(3);
    expect(t.sink.setLayerClasses.mock.calls[2]?.[1]?.colours).toEqual(first?.colours);
  });

  it('colours the cells that have a value in the one colour of the style, as one class of the first column of numbers', async () => {
    const t = gridSetup();
    t.setFirstColumn(() => 'Au');
    t.drawable([0, true]);
    t.scene.dispatch({ type: 'addLayers', datasets: [gridDataset(0)] });
    await t.pipeline.idle();
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await t.pipeline.idle();
    // The first asked for the classes of the style it was made with, the second for one class of the first column.
    expect(t.classifyCalls).toEqual([
      [0, 'Au', 'equal', 7],
      [0, 'Au', 'equal', 1],
    ]);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(2);
    expect(t.sink.setLayerClasses.mock.calls[1]?.[1]?.colours).toEqual(['#0072b2']);
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
  });

  it('gives a new colour for the mask without asking the engine again, and asks only once for the column of the mask', async () => {
    const t = gridSetup();
    t.setFirstColumn(() => 'Au');
    t.drawable([0, true]);
    await t.addGrid(0);
    for (const value of ['#0072b2', '#d55e00', '#009e73']) {
      t.scene.dispatch({
        type: 'setStyle',
        layerId: 'layer-1',
        patch: { colour: { mode: 'single', value } },
      });
      await t.pipeline.idle();
    }
    expect(t.classifyCalls).toEqual([
      [0, 'Au', 'equal', 7],
      [0, 'Au', 'equal', 1],
    ]);
    const given = t.sink.setLayerClasses.mock.calls.map(([, classes]) => classes?.colours);
    expect(given.slice(1)).toEqual([['#0072b2'], ['#d55e00'], ['#009e73']]);
    const indices = t.sink.setLayerClasses.mock.calls
      .slice(1)
      .map(([, classes]) => classes?.indices);
    expect(indices[1]).toBe(indices[0]);
    expect(indices[2]).toBe(indices[0]);
  });

  it('asks for the mask of the first column of the dataset it is of', async () => {
    const t = gridSetup();
    t.setFirstColumn((datasetId) => `Column of ${String(datasetId)}`);
    t.drawable([4, true]);
    // (A grid with no column in its summary starts in one colour; the viewer says which column the mask is of.)
    t.scene.dispatch({ type: 'addLayers', datasets: [{ ...gridDataset(4), columns: [] }] });
    await t.pipeline.idle();
    expect(t.classifyCalls).toEqual([[4, 'Column of 4', 'equal', 1]]);
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await t.pipeline.idle();
    expect(t.classifyCalls).toEqual([[4, 'Column of 4', 'equal', 1]]);
  });

  it('asks again for the mask when the column that says which cells have a value is another', async () => {
    const t = gridSetup();
    let column = 'Au';
    t.setFirstColumn(() => column);
    t.drawable([0, true]);
    await t.addGrid(0);
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#0072b2' } },
    });
    await t.pipeline.idle();
    column = 'Cu';
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { mode: 'single', value: '#d55e00' } },
    });
    await t.pipeline.idle();
    expect(t.classifyCalls.slice(1)).toEqual([
      [0, 'Au', 'equal', 1],
      [0, 'Cu', 'equal', 1],
    ]);
  });

  it('does not ask for a mask for a kind whose elements all have a value, in one colour', async () => {
    const t = setup();
    t.setFirstColumn(() => 'Au');
    t.drawable([0, true]);
    await t.add(0);
    expect(t.classifyCalls).toEqual([]);
    expect(t.sink.setLayerClasses).not.toHaveBeenCalled();
  });

  it('gives a layer of categories the grey of "Other" after the colours of its classes, when there are others', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    t.state.classify = (_id, column) =>
      Promise.resolve({
        status: 'classified',
        breaks: {
          kind: 'categories',
          column,
          values: ['granite', 'basalt'],
          counts: [3, 2],
          other: 1,
          nulls: 0,
        },
      });
    await t.addGrid(0);
    const colours = t.sink.setLayerClasses.mock.calls[0]?.[1]?.colours;
    expect(colours).toHaveLength(3);
    expect(colours?.[2]).toBe(OTHER_COLOUR);
    // And none when there are not.
    const u = gridSetup();
    u.drawable([0, true]);
    u.state.classify = (_id, column) =>
      Promise.resolve({
        status: 'classified',
        breaks: { kind: 'categories', column, values: ['granite'], counts: [3], nulls: 0 },
      });
    await u.addGrid(0);
    expect(u.sink.setLayerClasses.mock.calls[0]?.[1]?.colours).toHaveLength(1);
  });

  it('works out the classes without the renderer, and gives them with the layer when it is there', async () => {
    const t = gridSetup(null);
    t.drawable([0, true]);
    await t.addGrid(0);
    expect(t.classifyCalls).toHaveLength(1);
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'preparing', fraction: 1 });
    expect(t.sink.setLayerClasses).not.toHaveBeenCalled();
    t.setSink(t.sink);
    t.pipeline.rendererReady();
    expect(t.sink.setLayer).toHaveBeenCalledTimes(1);
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
    expect(t.pipeline.states().get('layer-1')).toEqual({ status: 'drawn' });
  });

  it('gives nothing for a layer that was removed while the engine worked on its classes', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    const slow = deferred<ClassifyResult>();
    t.state.classify = () => slow.promise;
    t.scene.dispatch({ type: 'addLayers', datasets: [gridDataset(0)] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    t.scene.dispatch({ type: 'removeLayersOfDataset', datasetId: 0 });
    slow.resolve({ status: 'classified', breaks: ranges('Au') });
    await t.pipeline.idle();
    expect(t.sink.setLayer).not.toHaveBeenCalled();
    expect(t.sink.setLayerClasses).not.toHaveBeenCalled();
    expect(t.classIndexCalls).toEqual([]);
  });

  it('does not say that the layer is drawn again for the classes that a grid that is not drawn in the frame had', async () => {
    const t = gridSetup();
    t.drawable([0, true]);
    await t.addGrid(0);
    // The map moves to a system that the grid cannot be drawn in: it is taken off the card.
    t.state.choice = () => ({
      frame: frame([5000, 6000, 0]),
      drawable: [
        {
          id: 0,
          status: 'not_drawn',
          reprojected: false,
          findings: [finding('display.not_drawn')],
        },
      ],
      findings: [],
    });
    t.scene.dispatch({ type: 'setFrame', frame: { ...frame([5000, 6000, 0]), source: 'user' } });
    await t.pipeline.idle();
    expect(t.pipeline.states().get('layer-1')).toEqual({
      status: 'not_drawn',
      findings: [finding('display.not_drawn')],
    });
    // A change of the colours afterwards does not bring it back.
    const style = t.scene.getState().layers['layer-1']?.style.colour as object;
    t.scene.dispatch({
      type: 'setStyle',
      layerId: 'layer-1',
      patch: { colour: { ...style, reverse: true } as never },
    });
    await t.pipeline.idle();
    expect(t.pipeline.states().get('layer-1')?.status).toBe('not_drawn');
    expect(t.sink.setLayerClasses).toHaveBeenCalledTimes(1);
  });
});
