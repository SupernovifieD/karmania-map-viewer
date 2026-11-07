/**
 * The layer pipeline: what turns the layers of the scene into layers on the card. When the scene has a layer for a dataset that
 * has none yet, it asks the engine for the frame the map is drawn in (`chooseFrame`), says which datasets are drawn in it,
 * has each prepared in the worker (`prepare`: reprojected, triangulated, rebased to the frame's origin), and gives the buffers to the
 * renderer. A request that is no longer wanted (a layer that was removed, a frame that changed) is aborted, a layer that is removed
 * is taken off the card, and a change of the frame's origin or map CRS has every layer prepared again, since its positions
 * are relative to the origin. The first view of the data, and the limits of the scale, come from the extents of what was prepared.
 *
 * Everything is in the pipeline and nothing in it is a time: the same scene and data give the same calls in the same order.
 */
import type { Engine } from '@karmania/engine';
import type { Frame, RenderBuffers } from '@karmania/engine/display';
import type { BBox, Finding } from '@karmania/engine/types';
import { DEFAULT_SCALE_LIMITS } from '@karmania/render';
import type { ScaleLimits } from '@karmania/render';
import { fitCamera2d } from '@karmania/scene';
import type { LayerId, SceneStore } from '@karmania/scene';
import { extentOf } from './extent.js';

/** Where a layer is. */
export type LayerState =
  /** Being prepared in the worker (`fraction` of the way), or prepared and waiting for the renderer. */
  | { readonly status: 'preparing'; readonly fraction: number }
  /** On the card. */
  | { readonly status: 'drawn' }
  /** Prepared, but the renderer does not draw buffers of this kind. */
  | { readonly status: 'unsupported' }
  /** The dataset cannot be drawn in the map's coordinate system, and the findings say why. */
  | { readonly status: 'not_drawn'; readonly findings: readonly Finding[] }
  /** Preparing it failed, which is a fault of the engine and not a finding about the data. */
  | { readonly status: 'failed'; readonly message: string };

/** What the pipeline gives the buffers to: the renderer, which may not be there yet. */
export interface LayerSink {
  setLayer(id: string, buffers: RenderBuffers): 'drawn' | 'unsupported';
  removeLayer(id: string): boolean;
  /** The largest texture the card takes, in cells on a side. */
  readonly maxTextureSize: number;
}

/** What the pipeline needs. */
export interface PipelineOptions {
  readonly engine: Pick<Engine, 'chooseFrame' | 'prepare'>;
  readonly scene: SceneStore;
  /** The renderer, or `undefined` while there is none; buffers wait for it. */
  sink(): LayerSink | undefined;
  /** The size of the map area in CSS pixels, for the fit. */
  viewport(): { readonly width: number; readonly height: number };
  /** Called whenever the state of a layer changes. */
  onChange?(): void;
}

/** Pixels left free all round the data by a fit, for the overlays that are over the map. */
export const FIT_PADDING = 24;
/** The scale may go this many times closer than the fit and this many times farther. */
export const ZOOM_IN_LIMIT = 100_000;
export const ZOOM_OUT_LIMIT = 100;
/** What `prepare` is told the card's texture limit is while there is no card yet (the engine's own default). */
const DEFAULT_TEXTURE_SIZE = 4096;

/** What the pipeline knows of one layer. */
interface Entry {
  readonly datasetId: number;
  state: LayerState;
  abort?: AbortController;
  /** The frame the buffers were made for; the layer is up to date while this is the frame. */
  preparedWith?: Frame;
  extent?: BBox;
  /** Buffers that are ready and waiting for the renderer. */
  waiting?: RenderBuffers;
}

function sameFrame(a: Frame | null, b: Frame | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const crs =
    a.mapCrs.kind === 'epsg'
      ? b.mapCrs.kind === 'epsg' && a.mapCrs.code === b.mapCrs.code
      : b.mapCrs.kind === 'local' && a.mapCrs.units === b.mapCrs.units;
  return crs && a.source === b.source && a.origin.every((value, i) => value === b.origin[i]);
}

function sameSystem(a: Frame | null, b: Frame | null): boolean {
  return a !== null && b !== null && sameFrame({ ...a, source: b.source, origin: b.origin }, b);
}

export class LayerPipeline {
  private readonly entries = new Map<LayerId, Entry>();
  private readonly idleWaiters: (() => void)[] = [];
  /** The frame the layers are being prepared for, and which datasets are drawn in it. */
  private frame: Frame | null = null;
  private drawable = new Map<number, { drawn: boolean; findings: readonly Finding[] }>();
  /** The datasets (a sorted list of ids) that `frame` was chosen for. */
  private chosenFor = '';
  private running = false;
  private dirty = false;
  private disposed = false;
  /** The map CRS that the camera was last fitted for; the camera goes back to its start when that changes. */
  private fittedFor: Frame | null | undefined;
  private scale: number | undefined;

  constructor(private readonly options: PipelineOptions) {}

  /** What there is to say of each layer. */
  states(): ReadonlyMap<LayerId, LayerState> {
    return new Map([...this.entries].map(([id, entry]) => [id, entry.state]));
  }

  /** How near and how far the map may be taken: from the fit, once there is one. */
  limits(): ScaleLimits {
    return this.scale === undefined
      ? DEFAULT_SCALE_LIMITS
      : { min: this.scale / ZOOM_IN_LIMIT, max: this.scale * ZOOM_OUT_LIMIT };
  }

  /** Looks at the scene again: call it whenever the scene changes. Nothing is done for a change that needs nothing. */
  update(): void {
    if (this.disposed) {
      return;
    }
    // Layers that are gone, and requests that a frame the person chose has made useless, are dealt with now, not when the
    // request that the pipeline is waiting for is back.
    const doc = this.options.scene.getState();
    for (const [id, entry] of this.entries) {
      if (doc.layers[id] === undefined) {
        entry.abort?.abort();
        this.options.sink()?.removeLayer(id);
        this.entries.delete(id);
        this.changed();
      }
    }
    const chosen = doc.frame?.source === 'user' ? doc.frame : null;
    if (chosen !== null && this.frame !== null && !sameFrame(chosen, this.frame)) {
      for (const entry of this.entries.values()) {
        entry.abort?.abort();
      }
    }
    this.dirty = true;
    if (!this.running) {
      void this.run();
    }
  }

  /** The renderer is there now: what was prepared and waited for it goes to it. */
  rendererReady(): void {
    for (const [id, entry] of this.entries) {
      this.deliver(id, entry);
    }
  }

  /** Resolves when the pipeline has nothing left to do for the scene as it is (at once, once it is disposed of). */
  idle(): Promise<void> {
    return !this.disposed && (this.running || this.dirty)
      ? new Promise((resolve) => {
          this.idleWaiters.push(resolve);
        })
      : Promise.resolve();
  }

  /**
   * Shows the data: the camera is put where all of the visible layers that were prepared fit in the map area, with the heading it
   * has. Nothing happens if there is nothing to show, or the map area has no size yet.
   */
  fit(): void {
    const doc = this.options.scene.getState();
    const extents = [...this.entries]
      .filter(([id]) => doc.layers[id]?.visible === true)
      .flatMap(([, entry]) => (entry.extent === undefined ? [] : [entry.extent]));
    const first = extents[0];
    if (first === undefined) {
      return;
    }
    const extent: BBox = {
      min: [
        Math.min(...extents.map((box) => box.min[0])),
        Math.min(...extents.map((box) => box.min[1])),
        Math.min(...extents.map((box) => box.min[2])),
      ],
      max: [
        Math.max(...extents.map((box) => box.max[0])),
        Math.max(...extents.map((box) => box.max[1])),
        Math.max(...extents.map((box) => box.max[2])),
      ],
    };
    const camera = fitCamera2d({
      extent,
      viewport: this.options.viewport(),
      heading: doc.camera2d.heading,
      padding: FIT_PADDING,
    });
    if (camera !== undefined) {
      this.scale = camera.unitsPerPixel;
      this.options.scene.dispatch({ type: 'setCamera', patch: { camera2d: camera } });
    }
  }

  /** Stops: every request is aborted, and nothing more is done. The renderer frees the layers it has. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.abort?.abort();
    }
    this.entries.clear();
    this.settle();
  }

  private settle(): void {
    for (const resolve of this.idleWaiters.splice(0)) {
      resolve();
    }
  }

  private changed(): void {
    this.options.onChange?.();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false;
        await this.pass();
      }
    } finally {
      this.running = false;
      this.settle();
    }
  }

  /** One look at the scene, and what it asks for. */
  private async pass(): Promise<void> {
    const doc = this.options.scene.getState();
    // (Layers that are gone were dealt with by `update`.)
    for (const [id, layer] of Object.entries(doc.layers)) {
      if (!this.entries.has(id)) {
        this.entries.set(id, {
          datasetId: layer.datasetId,
          state: { status: 'preparing', fraction: 0 },
        });
        this.changed();
      }
    }
    if (this.entries.size === 0) {
      this.empty();
      return;
    }
    const datasets = [...new Set([...this.entries.values()].map((entry) => entry.datasetId))]
      .sort((a, b) => a - b)
      .join(',');
    const chosen = doc.frame?.source === 'user' ? doc.frame : null;
    if (datasets !== this.chosenFor || (chosen !== null && !sameFrame(chosen, this.frame))) {
      if (!(await this.choose(datasets, chosen))) {
        return;
      }
    }
    for (const [id, entry] of [...this.entries]) {
      if (this.disposed || this.entries.get(id) !== entry) {
        continue;
      }
      await this.prepare(id, entry);
    }
    if (!this.dirty && !this.disposed) {
      this.view();
    }
  }

  /** Nothing is loaded: no frame, and a fit for the next data. */
  private empty(): void {
    this.frame = null;
    this.chosenFor = '';
    this.fittedFor = undefined;
    this.scale = undefined;
    this.drawable = new Map();
    if (this.options.scene.getState().frame !== null) {
      this.options.scene.dispatch({ type: 'setFrame', frame: null });
    }
  }

  /** Asks the engine for the frame, and says which datasets are drawn in it. `false` if it could not be had. */
  private async choose(datasets: string, preferred: Frame | null): Promise<boolean> {
    let choice;
    try {
      choice = await this.options.engine.chooseFrame(preferred?.mapCrs);
    } catch (error) {
      if (this.disposed) {
        return false;
      }
      for (const entry of this.entries.values()) {
        entry.state = {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      this.changed();
      return false;
    }
    if (this.disposed) {
      return false;
    }
    this.chosenFor = datasets;
    this.drawable = new Map(
      choice.drawable.map((entry) => [
        entry.id,
        { drawn: entry.status === 'drawn', findings: entry.findings },
      ]),
    );
    const before = this.frame;
    this.frame = choice.frame;
    if (!sameFrame(this.options.scene.getState().frame, choice.frame)) {
      this.options.scene.dispatch({ type: 'setFrame', frame: choice.frame });
    }
    if (!sameFrame(before, choice.frame)) {
      // Every layer was made for the origin that was: its positions are relative to it, so they are made again.
      for (const entry of this.entries.values()) {
        entry.abort?.abort();
        if (entry.state.status !== 'not_drawn') {
          entry.state = { status: 'preparing', fraction: 0 };
        }
      }
      this.changed();
    }
    return true;
  }

  /** Has the dataset of a layer prepared for the frame, if it is not already, and gives the result to the renderer. */
  private async prepare(id: LayerId, entry: Entry): Promise<void> {
    const frame = this.frame;
    const verdict = this.drawable.get(entry.datasetId);
    if (verdict === undefined) {
      return;
    }
    if (!verdict.drawn) {
      entry.state = { status: 'not_drawn', findings: verdict.findings };
      this.options.sink()?.removeLayer(id);
      this.changed();
      return;
    }
    if (frame === null) {
      return;
    }
    if (entry.preparedWith !== undefined && sameFrame(entry.preparedWith, frame)) {
      return;
    }
    const abort = new AbortController();
    entry.abort = abort;
    try {
      const result = await this.options.engine.prepare(
        entry.datasetId,
        { frame, maxTextureSize: this.options.sink()?.maxTextureSize ?? DEFAULT_TEXTURE_SIZE },
        {
          signal: abort.signal,
          onProgress: (progress) => {
            if (!abort.signal.aborted && this.entries.get(id) === entry) {
              entry.state = { status: 'preparing', fraction: progress.fraction };
              this.changed();
            }
          },
        },
      );
      // What came back is of no use if it was asked for something else meanwhile.
      if (abort.signal.aborted || this.disposed || this.entries.get(id) !== entry) {
        return;
      }
      if (result.status === 'not_drawn') {
        entry.state = { status: 'not_drawn', findings: result.findings };
        this.options.sink()?.removeLayer(id);
      } else {
        entry.preparedWith = frame;
        const extent = extentOf(result.buffers, frame.origin);
        if (extent === undefined) {
          delete entry.extent;
        } else {
          entry.extent = extent;
        }
        entry.waiting = result.buffers;
        entry.state = { status: 'preparing', fraction: 1 };
        this.deliver(id, entry);
      }
      this.changed();
    } catch (error) {
      if (abort.signal.aborted || this.disposed) {
        return;
      }
      entry.state = {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
      this.changed();
    }
  }

  /** Gives waiting buffers to the renderer, if there is one. */
  private deliver(id: LayerId, entry: Entry): void {
    const sink = this.options.sink();
    if (entry.waiting === undefined || sink === undefined) {
      return;
    }
    const buffers = entry.waiting;
    delete entry.waiting;
    entry.state = { status: sink.setLayer(id, buffers) === 'drawn' ? 'drawn' : 'unsupported' };
    this.changed();
  }

  /** The first view of data that was just prepared, and again when the map's coordinate system changes. */
  private view(): void {
    const prepared = [...this.entries.values()].some((entry) => entry.extent !== undefined);
    if (prepared && (this.fittedFor === undefined || !sameSystem(this.fittedFor, this.frame))) {
      this.fittedFor = this.frame;
      this.fit();
    }
  }
}
