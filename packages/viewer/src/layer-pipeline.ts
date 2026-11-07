/**
 * The layer pipeline: what turns the layers of the scene into layers on the card. When the scene has a layer for a dataset that
 * has none yet, it asks the engine for the frame the map is drawn in (`chooseFrame`), says which datasets are drawn in it,
 * has each prepared in the worker (`prepare`: reprojected, triangulated, rebased to the frame's origin), and gives the buffers to the
 * renderer. A request that is no longer wanted (a layer that was removed, a frame that changed) is aborted, a layer that is removed
 * is taken off the card, and a change of the frame's origin or map CRS has every layer prepared again, since its positions
 * are relative to the origin. The first view of the data, and the limits of the scale, come from the extents of what was prepared.
 *
 * A layer of a kind that is coloured by classes (every kind that is drawn in 2D) whose style is by classes also has the class of each of
 * its elements worked out by the engine (`classify`, then `classIndex`) and the colour of each class from the scene, and gives both to the
 * renderer with the layer. A change of the style that is only of colours (the ramp, reversing it) gives the renderer new colours for the
 * classes it has; one that changes the classes (the column, the method, how many) asks the engine again; neither prepares the layer again.
 *
 * Everything is in the pipeline and nothing in it is a time: the same scene and data give the same calls in the same order.
 */
import type { Engine } from '@karmania/engine';
import type { ClassBreaks, ClassMethod, Frame, RenderBuffers } from '@karmania/engine/display';
import type { BBox, Finding } from '@karmania/engine/types';
import { DEFAULT_SCALE_LIMITS } from '@karmania/render';
import type { ClassColouring, ScaleLimits } from '@karmania/render';
import { OTHER_COLOUR, classColours, fitCamera2d } from '@karmania/scene';
import type { LayerColour, LayerId, SceneStore } from '@karmania/scene';
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
  /** Colours the elements of a layer by class (`undefined` takes the colouring away). */
  setLayerClasses(id: string, classes: ClassColouring | undefined): void;
  removeLayer(id: string): boolean;
  /** The heights that are drawn, relative to the origin of the frame: what the card's camera has to see. */
  setDepthRange(min: number, max: number): void;
  /** The largest texture the card takes, in cells on a side. */
  readonly maxTextureSize: number;
}

/** What the pipeline needs. */
export interface PipelineOptions {
  readonly engine: Pick<Engine, 'chooseFrame' | 'prepare' | 'classify' | 'classIndex'>;
  readonly scene: SceneStore;
  /** The renderer, or `undefined` while there is none; buffers wait for it. */
  sink(): LayerSink | undefined;
  /** The size of the map area in CSS pixels, for the fit. */
  viewport(): { readonly width: number; readonly height: number };
  /**
   * The column of a dataset that says which of its cells or blocks have a value: its first of numbers (the one the default style colours a
   * grid by), or `undefined` for none. A layer in one colour is drawn where that has a value.
   */
  firstColumn?(datasetId: number): string | undefined;
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

/**
 * The kinds of buffers whose layers take the class of each element: a point, a line, a polygon, a triangle of a mesh, a grid's cell and a model's block are coloured by it. (The surface of a grid with
 * elevations is not drawn in 2D, so it has no colours here.)
 */
const COLOURED_BY_CLASS: ReadonlySet<RenderBuffers['kind']> = new Set([
  'points',
  'lines',
  'polygons',
  'mesh',
  'grid',
  'blocks',
]);

/**
 * The kinds whose cells or blocks may have no value, and so are not all drawn when the layer is in one colour: they are given one class
 * (the cells that have a value in the first column of numbers) and the colour of the style.
 */
const NEEDS_MASK: ReadonlySet<RenderBuffers['kind']> = new Set(['grid', 'blocks']);

/** A text that is the same for styles that have the same classes: the column, the method and how many (the ramp is not of the classes). */
function classKeyOf(colour: Extract<LayerColour, { mode: 'classes' }>): string {
  return [colour.column, colour.method, String(colour.classes)].join('\u0000');
}

/** What the pipeline knows of one layer. */
interface Entry {
  readonly datasetId: number;
  /** The kind of the buffers that were prepared, once there are some. */
  kind?: RenderBuffers['kind'];
  /** What the classes are of (the column, the method, how many); the breaks and the indices below are for it. */
  classKey?: string;
  breaks?: ClassBreaks;
  indices?: Uint8Array;
  /** What the layer is coloured with, and a text that says it (the key and the colours), so that what has been given is not given again. */
  classes?: ClassColouring;
  signature?: string;
  /** Whether the renderer has the layer now. */
  onCard?: boolean;
  /** The signature of what the renderer has for the layer that is on the card now. */
  sent?: string;
  /** The engine could not give the classes that the style asks for (`key`): why, as the layer's state. It is not asked again for the same classes. */
  problem?: { readonly key: string; readonly state: LayerState };
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
        this.depth();
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
      // A change of the style that is of the classes or of their colours, or the classes of a layer that was prepared before it was coloured.
      await this.colour(id, entry);
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
      this.forget(entry);
      // What it was prepared for is of no use: it is prepared again when the frame is one it can be drawn in, even this one.
      delete entry.preparedWith;
      this.options.sink()?.removeLayer(id);
      this.depth();
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
    // The request is no longer wanted: aborted, the pipeline is stopped, or the layer is gone or is another. (A function, so that it is
    // looked at again after each wait.)
    const unwanted = (): boolean =>
      abort.signal.aborted || this.disposed || this.entries.get(id) !== entry;
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
      if (unwanted()) {
        return;
      }
      if (result.status === 'not_drawn') {
        entry.state = { status: 'not_drawn', findings: result.findings };
        this.forget(entry);
        // The answer is for this frame, and is not asked for again until the frame is another.
        entry.preparedWith = frame;
        this.options.sink()?.removeLayer(id);
        this.depth();
      } else {
        entry.preparedWith = frame;
        entry.kind = result.buffers.kind;
        const extent = extentOf(result.buffers, frame.origin);
        if (extent === undefined) {
          delete entry.extent;
        } else {
          entry.extent = extent;
        }
        entry.waiting = result.buffers;
        entry.state = { status: 'preparing', fraction: 1 };
        // The classes first, so that a layer that is coloured by them is on the card with its colours and is never seen without.
        await this.colour(id, entry, abort.signal);
        if (unwanted()) {
          return;
        }
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
    // The heights first: the layer is drawn within them as soon as it is there.
    this.depth();
    const outcome = sink.setLayer(id, buffers);
    // A layer that is put in place of another has none of the classes that the old one had.
    delete entry.sent;
    if (outcome === 'unsupported') {
      delete entry.onCard;
      entry.state = { status: 'unsupported' };
    } else {
      entry.onCard = true;
      // Drawn, unless the classes could not be had, or are to be had and are not here yet.
      entry.state =
        entry.problem?.state ??
        (this.waitsForClasses(id, entry)
          ? { status: 'preparing', fraction: 1 }
          : { status: 'drawn' });
    }
    this.give(id, entry);
    this.changed();
  }

  /** Whether the layer is of a kind that is coloured by classes, and is to be, and does not have them yet. */
  private waitsForClasses(id: LayerId, entry: Entry): boolean {
    return (
      entry.kind !== undefined &&
      COLOURED_BY_CLASS.has(entry.kind) &&
      entry.classes === undefined &&
      this.options.scene.getState().layers[id]?.style.colour.mode === 'classes'
    );
  }

  /** Gives the renderer the classes of the layer if it has a layer on the card and does not have these, or takes them away. */
  private give(id: LayerId, entry: Entry): void {
    const sink = this.options.sink();
    if (sink === undefined || entry.onCard !== true) {
      return;
    }
    const { classes, signature } = entry;
    if (classes === undefined || signature === undefined) {
      if (entry.sent !== undefined) {
        sink.setLayerClasses(id, undefined);
        delete entry.sent;
      }
      return;
    }
    if (entry.sent !== signature) {
      sink.setLayerClasses(id, classes);
      entry.sent = signature;
    }
    entry.state = { status: 'drawn' };
    this.changed();
  }

  /**
   * Forgets that the layer is on the card, of what kind it is, its classes, the buffers that wait for the renderer and the extent of what
   * was prepared (the fit and the heights are of what is drawn): it is not drawn, or is to be made again.
   */
  private forget(entry: Entry): void {
    delete entry.waiting;
    delete entry.extent;
    delete entry.onCard;
    delete entry.kind;
    delete entry.classKey;
    delete entry.breaks;
    delete entry.indices;
    delete entry.classes;
    delete entry.signature;
    delete entry.sent;
    delete entry.problem;
  }

  /**
   * Works out the classes of the layer for its style, if it is of a kind that is coloured by classes, and gives them to the renderer: the
   * engine is asked only if the column, the method or the number of classes is not what the classes that are held are of (the colours of
   * the classes are the scene's, from the ramp, and need no engine). Nothing is done if the layer has what its style asks for.
   * `signal` is the request that this is part of, if it is part of one.
   */
  private async colour(id: LayerId, entry: Entry, signal?: AbortSignal): Promise<void> {
    const colour = this.options.scene.getState().layers[id]?.style.colour;
    if (colour === undefined || entry.kind === undefined || !COLOURED_BY_CLASS.has(entry.kind)) {
      return;
    }
    const wanted = this.classesWanted(entry, colour);
    if (wanted === undefined) {
      // Nothing to colour by (one colour for a kind that has no cells with no value, or no column of numbers to say which have one).
      delete entry.problem;
      delete entry.classes;
      delete entry.signature;
      this.give(id, entry);
      return;
    }
    const { key } = wanted;
    if (entry.problem !== undefined && entry.problem.key !== key) {
      delete entry.problem;
    }
    if (entry.problem !== undefined) {
      // The engine was asked for these classes and could not give them: it is asked again when the style asks for other classes.
      return;
    }
    if (entry.classKey !== key) {
      // An answer is of no use once the layer is gone, the request it was part of is aborted, or the style has asked for other classes
      // meanwhile (the pipeline looks at the scene again only when it is done with this, so the style is looked at here).
      const stale = (): boolean => {
        const now = this.options.scene.getState().layers[id]?.style.colour;
        return (
          this.disposed ||
          signal?.aborted === true ||
          this.entries.get(id) !== entry ||
          now === undefined ||
          this.classesWanted(entry, now)?.key !== key
        );
      };
      try {
        const result = await this.options.engine.classify(
          entry.datasetId,
          wanted.column,
          wanted.method,
          wanted.classes,
        );
        if (stale()) {
          return;
        }
        if (result.status === 'not_classified') {
          this.refuse(id, entry, key, { status: 'not_drawn', findings: result.findings });
          return;
        }
        const indices = await this.options.engine.classIndex(entry.datasetId, result.breaks);
        if (stale()) {
          return;
        }
        entry.classKey = key;
        entry.breaks = result.breaks;
        entry.indices = indices;
      } catch (error) {
        if (stale()) {
          return;
        }
        this.refuse(id, entry, key, {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    const { breaks, indices } = entry;
    if (breaks === undefined || indices === undefined) {
      return;
    }
    // The classes of a column of categories have "Other" after them, which is a grey of the scene's own; one colour is one class.
    const colours =
      colour.mode === 'single'
        ? [colour.value]
        : [
            ...classColours(colour, breaks),
            ...(breaks.kind === 'categories' && breaks.other !== undefined ? [OTHER_COLOUR] : []),
          ];
    const signature = `${key}\u0001${colours.join(',')}`;
    if (signature !== entry.signature) {
      entry.signature = signature;
      entry.classes = { indices, colours };
    }
    this.give(id, entry);
  }

  /**
   * What the engine is to be asked for the style: a layer by classes asks for those of its column, a kind that can have cells with no value, in
   * one colour, for one class of the cells that have a value (in the first column of numbers). `undefined` for a style that has nothing to ask.
   */
  private classesWanted(
    entry: Entry,
    colour: LayerColour,
  ): { key: string; column: string; method: ClassMethod; classes: number } | undefined {
    if (colour.mode === 'classes') {
      return {
        key: classKeyOf(colour),
        column: colour.column,
        method: colour.method,
        classes: colour.classes,
      };
    }
    if (entry.kind === undefined || !NEEDS_MASK.has(entry.kind)) {
      return undefined;
    }
    const column = this.options.firstColumn?.(entry.datasetId);
    return column === undefined
      ? undefined
      : { key: ['single', column].join('\u0000'), column, method: 'equal', classes: 1 };
  }

  /** The classes could not be had: the layer says why, the renderer has no classes for it, and they are not asked for again. */
  private refuse(id: LayerId, entry: Entry, key: string, state: LayerState): void {
    entry.problem = { key, state };
    delete entry.classes;
    delete entry.signature;
    if (entry.onCard === true) {
      entry.state = state;
    }
    this.give(id, entry);
    this.changed();
  }

  /** Tells the renderer the heights of what was prepared, relative to the origin: the least and the greatest, or 0 for none. */
  private depth(): void {
    const sink = this.options.sink();
    const origin = this.frame?.origin[2] ?? 0;
    const heights = [...this.entries.values()].flatMap((entry) =>
      entry.extent === undefined
        ? []
        : [entry.extent.min[2] - origin, entry.extent.max[2] - origin],
    );
    sink?.setDepthRange(
      heights.length === 0 ? 0 : Math.min(...heights),
      heights.length === 0 ? 0 : Math.max(...heights),
    );
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
