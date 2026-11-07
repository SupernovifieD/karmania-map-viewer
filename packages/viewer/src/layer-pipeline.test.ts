import type { PrepareOptions, PrepareParams } from '@karmania/engine';
import type { Frame, FrameChoice, PrepareResult, RenderBuffers } from '@karmania/engine/display';
import type { Finding } from '@karmania/engine/types';
import { DEFAULT_SCALE_LIMITS } from '@karmania/render';
import { createSceneStore, fitCamera2d } from '@karmania/scene';
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
  const state: {
    choice: () => FrameChoice;
    prepare: (call: PrepareCall) => Promise<PrepareResult>;
  } = {
    choice: () => ({ frame: frame(), drawable: [], findings: [] }),
    prepare: () => Promise.resolve({ status: 'drawn', buffers: buffers(), findings: [] }),
  };
  return {
    chooseCalls,
    prepareCalls,
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
    },
  };
}

function setup(sinkOverride?: LayerSink | null) {
  const scene: SceneStore = createSceneStore();
  const fake = fakeEngine();
  const sink = {
    setLayer: vi.fn((): 'drawn' | 'unsupported' => 'drawn'),
    removeLayer: vi.fn(() => true),
    maxTextureSize: 8192,
  };
  let current: LayerSink | undefined = sinkOverride === null ? undefined : (sinkOverride ?? sink);
  const changes = vi.fn();
  const pipeline = new LayerPipeline({
    engine: fake.engine,
    scene,
    sink: () => current,
    viewport: () => ({ width: 1000, height: 500 }),
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
