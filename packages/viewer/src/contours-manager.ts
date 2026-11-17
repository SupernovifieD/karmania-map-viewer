/**
 * The contour lines of the layers (brief 10.3 and 11.5): what keeps the lines that the engine has made, and the layer that shows them, to what the scene says.
 *
 * A layer whose scene has `contours` (an interval, a base, an index line every so many lines, a column for a grid) has a set of contour lines: the engine
 * makes them (`contours`, in steps in the worker) as a dataset of lines that is listed under the layer's own, and the layer of those lines is made, directly
 * above its source in the legend (which is also drawn over it), by the scene's `setContoursLayer`. **When the settings change the engine makes them again, which replaces the old lines
 * (and the new dataset has a new number, so the layer that shows them is given it and keeps its style); when the settings go, the lines and their layer go; when
 * the lines cannot be made (a column that is not numbers, more than 1,000 levels, no level that the values cross) the old ones are gone too, and the layer says
 * why.** A request that a newer one has made useless (the settings changed again, the contours were turned off) is aborted, and if the
 * engine answers it all the same (it had finished when it was stopped) its lines are not the layer's: they are taken out of the engine
 * when nothing else is being made for the layer. The style a person gave the layer of the lines is kept when the layer goes with the lines
 * (they could not be made, or the contours were turned off) and given to the layer that comes after.
 *
 * Whether the lines are shown is the layer's own visibility, which follows the `visible` of the contours when that is changed (a person may hide the layer
 * of the lines in the legend all the same, and show the contours again to show it). Nothing here is a time: the same scene and the same answers of the engine
 * give the same calls in the same order.
 */
import type { Engine } from '@karmania/engine';
import type { Finding, LoadResult, Summary } from '@karmania/engine/types';
import type {
  ContourParams,
  Layer,
  LayerId,
  LayerStyle,
  SceneDocument,
  SceneStore,
} from '@karmania/scene';

/** Where the contours of a layer are. */
export type ContoursState =
  /** Nothing is being made: the lines are there (or the layer has no contours). */
  | { readonly status: 'idle' }
  /** The engine is making them. */
  | { readonly status: 'making' }
  /**
   * They could not be made: the findings say why (the engine's own words), or, for a fault of the engine and not a matter of the data, there are none
   * and `fault` is what it said.
   */
  | { readonly status: 'failed'; readonly findings: readonly Finding[]; readonly fault?: string };

/** What the manager needs. */
export interface ContoursOptions {
  readonly engine: Pick<Engine, 'contours' | 'contourDefaults' | 'remove' | 'datasets'>;
  readonly scene: SceneStore;
  /**
   * The engine's datasets are not what the viewer last had (lines were made, replaced or removed): it keeps these and brings the layers of
   * the scene to them. It is called after the scene's own layer for the lines is made, so that the layers of datasets that are gone are taken away
   * with that layer already pointing at the lines that are there.
   */
  adopt(datasets: readonly Summary[]): void;
  /** Called whenever the state of the contours of a layer changes. */
  onChange?(): void;
}

/** The settings the engine is asked for: what the scene holds, without whether they are shown. */
function paramsOf(layer: Layer): ContourParams | undefined {
  const { contours } = layer;
  if (contours === undefined) {
    return undefined;
  }
  return {
    ...(contours.column === undefined ? {} : { column: contours.column }),
    interval: contours.interval,
    base: contours.base,
    indexEvery: contours.indexEvery,
  };
}

/** A text that is the same for the same settings. */
const keyOf = (params: ContourParams): string =>
  [
    params.column ?? '',
    String(params.interval),
    String(params.base),
    String(params.indexEvery),
  ].join('\u0000');

/** A job of the engine that is not over. */
interface Job {
  readonly key: string;
  readonly controller: AbortController;
}

export class ContoursManager {
  private readonly jobs = new Map<LayerId, Job>();
  /** The settings the lines of each layer were last made with, and the number of the dataset they are. */
  private readonly made = new Map<LayerId, { readonly key: string; readonly datasetId: number }>();
  /** Why the lines of a layer were not made, and the settings that was of: the same settings are not asked again. */
  private readonly failed = new Map<
    LayerId,
    { readonly key: string; readonly findings: readonly Finding[]; readonly fault?: string }
  >();
  /** Whether the contours of each layer were shown the last time they were looked at, so that the layer of the lines follows a change and not a person's choice. */
  private readonly shown = new Map<LayerId, boolean>();
  /** The style of the layer of the lines of each layer, from when that layer was taken away, for the one that is made next. */
  private readonly styles = new Map<LayerId, LayerStyle>();
  /**
   * The jobs that were stopped and that the engine has not answered yet, for each layer: the engine may answer a stopped job all the same (it had finished when it was told), and its
   * lines are in the engine, and in the engine's change, before the manager has the answer, so they are not the layer's contours (`followEngine` leaves the layer alone until then).
   */
  private readonly stopped = new Map<LayerId, number>();
  private disposed = false;

  constructor(private readonly options: ContoursOptions) {}

  /** Where the contours of a layer are. */
  state(layerId: LayerId): ContoursState {
    if (this.jobs.has(layerId)) {
      return { status: 'making' };
    }
    const failure = this.failed.get(layerId);
    return failure === undefined
      ? { status: 'idle' }
      : {
          status: 'failed',
          findings: failure.findings,
          ...(failure.fault === undefined ? {} : { fault: failure.fault }),
        };
  }

  /**
   * Whether the manager is waiting for the engine to make lines. The engine's datasets change while it is (the lines replace the old), and the manager
   * brings the layers to what the engine holds when it has the answer, after the layer of the lines has taken the new lines, which keeps its style:
   * layers brought to the engine's datasets before that would take the layer away with the old lines.
   */
  busy(): boolean {
    return this.jobs.size > 0;
  }

  /** Looks at the scene again: call it whenever the scene changes. Nothing is done for a change that needs nothing. */
  update(): void {
    if (this.disposed) {
      return;
    }
    const doc = this.options.scene.getState();
    for (const layer of Object.values(doc.layers)) {
      if (layer.derived !== undefined) {
        continue;
      }
      if (layer.contours === undefined) {
        this.withdraw(doc, layer.id);
      } else {
        this.keep(doc, layer);
      }
    }
    // A job or a record of a layer that is gone goes with it.
    for (const id of [
      ...this.jobs.keys(),
      ...this.made.keys(),
      ...this.failed.keys(),
      ...this.styles.keys(),
    ]) {
      if (doc.layers[id] === undefined) {
        this.forget(id);
      }
    }
  }

  /**
   * Turns the contours of a layer on, for the first time: the settings that the engine says a set of contours starts with (a nice interval
   * for the range of the values, a base of 0, an index line every 5, the first column of numbers of a grid) are put in the scene, shown. A dataset that cannot
   * be contoured says why, as the state of the layer. Does nothing for a layer that has contours already, or is not there.
   */
  async turnOn(layerId: LayerId, column?: string): Promise<void> {
    const layer = this.options.scene.getState().layers[layerId];
    if (layer === undefined || layer.derived !== undefined || layer.contours !== undefined) {
      return;
    }
    let defaults;
    try {
      defaults = await this.options.engine.contourDefaults(layer.datasetId, column);
    } catch (error) {
      this.fail(layerId, '', [], faultOf(error));
      return;
    }
    const now = this.options.scene.getState().layers[layerId];
    if (this.disposed || now === undefined || now.contours !== undefined) {
      return;
    }
    if (defaults.status === 'not_available') {
      this.fail(layerId, '', defaults.findings);
      return;
    }
    this.failed.delete(layerId);
    this.options.scene.dispatch({
      type: 'setContours',
      layerId,
      contours: { ...defaults.params, visible: true },
    });
  }

  /** Stops what is under way and lets go of the scene. */
  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) {
      job.controller.abort();
    }
    this.jobs.clear();
    this.made.clear();
    this.failed.clear();
    this.shown.clear();
    this.styles.clear();
  }

  /** Stops a job, and notes that its answer is still to come. */
  private stopJob(layerId: LayerId, job: Job): void {
    job.controller.abort();
    this.stopped.set(layerId, (this.stopped.get(layerId) ?? 0) + 1);
  }

  /** The engine has answered a job that was stopped (with lines or with an error). */
  private settled(layerId: LayerId): void {
    const waiting = this.stopped.get(layerId);
    if (waiting === undefined) {
      return;
    }
    if (waiting <= 1) {
      this.stopped.delete(layerId);
    } else {
      this.stopped.set(layerId, waiting - 1);
    }
  }

  /** The layer has contours: the lines are made if they are not what they ask for, and the layer of the lines follows whether they are shown. */
  private keep(doc: SceneDocument, layer: Layer): void {
    const params = paramsOf(layer);
    if (params === undefined) {
      return;
    }
    const key = keyOf(params);
    const lines = this.options.engine
      .datasets()
      .find((dataset) => dataset.derivedFrom?.id === layer.datasetId);
    const made = this.made.get(layer.id);
    const current = made !== undefined && made.key === key && made.datasetId === lines?.id;
    const running = this.jobs.get(layer.id);
    if (current) {
      this.followVisibility(doc, layer);
      return;
    }
    // The engine has lines for these very settings (a viewer that shares it made them, or this one did, and the record of it is gone): they are shown, and nothing is asked (also
    // where they could not be made here before: they are there).
    if (
      running === undefined &&
      lines !== undefined &&
      lines.derivedFrom !== undefined &&
      keyOf(lines.derivedFrom.params) === key
    ) {
      this.showLines(layer.id, lines, key);
      this.followVisibility(doc, layer);
      return;
    }
    // A failure is told again only when the settings are changed: the same settings are not asked again.
    if (running?.key === key || this.failed.get(layer.id)?.key === key) {
      return;
    }
    // The settings are the ones the layer's lines were made with, and the lines are not what the engine has now (they are gone, or are others): it is the engine that has changed, a viewer
    // that shares it having turned the contours off or made them again, and not a person who asked. That is for `followEngine` to bring the layer to, when this viewer is told: asking
    // for the settings again here would undo what the other viewer did.
    if (running === undefined && made !== undefined && made.key === key) {
      return;
    }
    if (running !== undefined) {
      this.stopJob(layer.id, running);
    }
    void this.make(layer.id, layer.datasetId, params, key);
  }

  /**
   * The layer of the lines of `layerId` shows `lines`, which were made with the settings `key`: it is made, or given the new lines (it keeps its place and its style), and the
   * record says so. The layer of the lines takes the new ones first, so that the layers of the datasets that are gone are taken away with it already there.
   */
  private showLines(layerId: LayerId, lines: Summary, key: string): void {
    const { scene } = this.options;
    this.made.set(layerId, { key, datasetId: lines.id });
    this.failed.delete(layerId);
    scene.dispatch({
      type: 'setContoursLayer',
      sourceLayer: layerId,
      datasetId: lines.id,
      name: lines.name,
    });
    // A layer that is new has the style of the one that was taken away, if there was one (and a layer that is not new is not given it again).
    const style = this.styles.get(layerId);
    const layer = this.linesLayerOf(scene.getState(), layerId);
    if (style !== undefined && layer !== undefined) {
      scene.dispatch({ type: 'setStyle', layerId: layer.id, patch: style });
    }
    this.styles.delete(layerId);
    this.changed();
  }

  /**
   * The engine's contour lines are the layers' contours, whoever made them: when it holds lines for the dataset of a layer, the layer has those settings (it keeps whether they are
   * shown, which is its own) and its layer of lines shows them, and when the lines that it showed are gone (a viewer that shares the engine turned the contours off) the layer has no
   * contours. Nothing is asked of the engine. A layer whose lines are being made here is left to its own answer. Call it when the engine's datasets have changed, before the scene's
   * layers are brought to them (so that lines that were made again keep their layer and its style) and after (so that a layer that is new has the contours the engine has).
   */
  followEngine(): void {
    if (this.disposed) {
      return;
    }
    const { scene, engine } = this.options;
    const held = engine.datasets();
    for (const layer of Object.values(scene.getState().layers)) {
      if (layer.derived !== undefined || this.jobs.has(layer.id) || this.stopped.has(layer.id)) {
        continue;
      }
      const lines = held.find(
        (dataset) =>
          dataset.derivedFrom?.kind === 'contours' && dataset.derivedFrom.id === layer.datasetId,
      );
      const mine = paramsOf(layer);
      if (lines?.derivedFrom !== undefined) {
        const theirs = lines.derivedFrom.params;
        if (mine === undefined || keyOf(mine) !== keyOf(theirs)) {
          scene.dispatch({
            type: 'setContours',
            layerId: layer.id,
            contours: { ...theirs, visible: layer.contours?.visible ?? true },
          });
        }
      } else if (mine !== undefined && this.made.has(layer.id)) {
        // The lines are gone from the engine: the contours go with them, and nothing is taken out of an engine that has no such lines (`removeLinesOf`).
        scene.dispatch({ type: 'setContours', layerId: layer.id, contours: null });
      }
    }
    // The layers whose settings are what the engine's lines say, and whose lines have a new number, are given them.
    this.update();
  }

  private async make(
    layerId: LayerId,
    datasetId: number,
    params: ContourParams,
    key: string,
  ): Promise<void> {
    const job: Job = { key, controller: new AbortController() };
    this.jobs.set(layerId, job);
    this.failed.delete(layerId);
    this.changed();
    try {
      const result = await this.options.engine.contours(datasetId, params, {
        signal: job.controller.signal,
      });
      if (this.disposed) {
        return;
      }
      if (this.jobs.get(layerId) !== job) {
        this.settled(layerId);
        this.dropStray(layerId, result);
        return;
      }
      this.jobs.delete(layerId);
      const { scene, engine } = this.options;
      const lines = result.status === 'loaded' ? result.summaries[0] : undefined;
      if (lines !== undefined) {
        this.showLines(layerId, lines, key);
      } else {
        // The engine took the lines made before out too: so does the scene.
        this.made.delete(layerId);
        this.failed.set(layerId, {
          key,
          findings: result.status === 'blocked' ? result.findings : [],
        });
        this.takeAwayLinesLayer(scene.getState(), layerId);
      }
      this.options.adopt(engine.datasets());
      this.followVisibility(scene.getState(), scene.getState().layers[layerId]);
      this.changed();
    } catch (error) {
      if (this.disposed) {
        return;
      }
      if (this.jobs.get(layerId) !== job) {
        this.settled(layerId);
        return;
      }
      this.jobs.delete(layerId);
      if (!job.controller.signal.aborted) {
        // The engine could not do it (it is a fault of the engine and not of the data), or the dataset was removed meanwhile.
        const layerIsThere = this.options.scene.getState().layers[layerId] !== undefined;
        if (layerIsThere) {
          this.failed.set(layerId, { key, findings: [], fault: faultOf(error) });
        }
      }
      // What the engine held changed while this was under way (a viewer that shares the engine took a dataset out, say) was left to the manager, which is what being busy
      // is: the layers are brought to what the engine holds now, as when it has an answer.
      this.bringToEngine();
      this.changed();
    }
  }

  /** Brings the layers to what the engine holds, unless the engine is gone (then there is nothing to bring them to). */
  private bringToEngine(): void {
    let held: readonly Summary[];
    try {
      held = this.options.engine.datasets();
    } catch {
      return;
    }
    this.options.adopt(held);
  }

  /** The contours of the layer are not wanted: what is under way is stopped, and the lines and their layer go. */
  private withdraw(doc: SceneDocument, layerId: LayerId): void {
    // Why the contours could not be turned on (the failure of no settings) stays, until they are turned on: it is what says why there are none.
    const failure = this.failed.get(layerId);
    const forgetsFailure = failure !== undefined && failure.key !== '';
    const hadJob = this.jobs.has(layerId);
    const hadState = hadJob || forgetsFailure;
    const job = this.jobs.get(layerId);
    if (job !== undefined) {
      this.stopJob(layerId, job);
    }
    this.jobs.delete(layerId);
    if (forgetsFailure) {
      this.failed.delete(layerId);
    }
    this.made.delete(layerId);
    this.shown.delete(layerId);
    const lines = this.takeAwayLinesLayer(doc, layerId);
    if (lines !== undefined || hadState) {
      this.removeLinesOf(doc.layers[layerId]?.datasetId, lines?.datasetId);
    }
    // A job that was under way is what kept the viewer from acting on the changes of its engine (a viewer that shares it took a dataset out, say), and it is over: when there
    // were lines to take out the engine says so as they go, and when there were none nothing else would bring the layers to what it holds.
    if (hadJob) {
      this.bringToEngine();
    }
    if (hadState) {
      this.changed();
    }
  }

  /** The layer that shows the lines of `layerId`, if it has one. */
  private linesLayerOf(doc: SceneDocument, layerId: LayerId): Layer | undefined {
    return Object.values(doc.layers).find(
      (layer) => layer.derived?.kind === 'contours' && layer.derived.sourceLayer === layerId,
    );
  }

  /** Takes the layer of the lines of `layerId` out of the scene, keeping its style for the next one. Gives the layer, or nothing if there was none. */
  private takeAwayLinesLayer(doc: SceneDocument, layerId: LayerId): Layer | undefined {
    const lines = this.linesLayerOf(doc, layerId);
    if (lines !== undefined) {
      this.styles.set(layerId, lines.style);
      this.options.scene.dispatch({
        type: 'setContoursLayer',
        sourceLayer: layerId,
        datasetId: null,
      });
    }
    return lines;
  }

  /**
   * Takes out of the engine the lines of the dataset `source`: those that the layer of the lines shows (`shown`), and any that were made from it
   * all the same, which no layer shows (an answer kept because another job was under way, and that job was then stopped, or failed).
   */
  private removeLinesOf(source: number | undefined, shown: number | undefined): void {
    const held = this.options.engine.datasets();
    // What the engine holds, and no more: a viewer that shares it may have taken the lines out already, and it is not asked for what is not there.
    const ids = new Set(
      shown !== undefined && held.some((dataset) => dataset.id === shown) ? [shown] : [],
    );
    for (const dataset of held) {
      if (dataset.derivedFrom?.id === source) {
        ids.add(dataset.id);
      }
    }
    for (const id of ids) {
      this.removeFromEngine(id);
    }
  }

  /** Takes a dataset of lines out of the engine, and brings the layers to what is left. */
  private removeFromEngine(datasetId: number): void {
    void this.options.engine.remove(datasetId).then(
      () => {
        if (!this.disposed) {
          this.options.adopt(this.options.engine.datasets());
        }
      },
      () => undefined,
    );
  }

  /**
   * The engine answered a job that was stopped all the same (it had finished when it was told to stop): the lines it made are not the layer's.
   * When another job is under way for the layer its lines replace them (and if that one is stopped too, `withdraw` takes them out); when none
   * is, nothing wants them, and they are taken out.
   */
  private dropStray(layerId: LayerId, result: LoadResult): void {
    const lines = result.status === 'loaded' ? result.summaries[0] : undefined;
    if (lines !== undefined && !this.jobs.has(layerId)) {
      this.removeFromEngine(lines.id);
    }
  }

  /** The layer of the lines is shown when the contours are made shown, and hidden when they are made hidden: when that changes, and not otherwise. */
  private followVisibility(doc: SceneDocument, layer: Layer | undefined): void {
    const visible = layer?.contours?.visible;
    if (layer === undefined || visible === undefined || this.shown.get(layer.id) === visible) {
      return;
    }
    const lines = Object.values(doc.layers).find(
      (each) => each.derived?.kind === 'contours' && each.derived.sourceLayer === layer.id,
    );
    if (lines === undefined) {
      // (Nothing to follow yet: the layer of the lines is made visible as the contours are, and what is told is told when it is there.)
      return;
    }
    this.shown.set(layer.id, visible);
    if (lines.visible !== visible) {
      this.options.scene.dispatch({ type: 'setVisible', layerId: lines.id, visible });
    }
  }

  private fail(layerId: LayerId, key: string, findings: readonly Finding[], fault?: string): void {
    this.failed.set(layerId, { key, findings, ...(fault === undefined ? {} : { fault }) });
    this.changed();
  }

  private forget(layerId: LayerId): void {
    const job = this.jobs.get(layerId);
    if (job !== undefined) {
      this.stopJob(layerId, job);
    }
    this.jobs.delete(layerId);
    this.made.delete(layerId);
    this.failed.delete(layerId);
    this.shown.delete(layerId);
    this.styles.delete(layerId);
  }

  private changed(): void {
    this.options.onChange?.();
  }
}

/** What the engine said when it could not do it, as words: a fault of the engine and not a matter of the data. */
function faultOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
