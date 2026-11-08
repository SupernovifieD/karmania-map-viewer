import { createEngine } from '@karmania/engine';
import type {
  CrsInfo,
  DatasetInput,
  Engine,
  LoadOptions,
  LoadResult,
  Summary,
} from '@karmania/engine';
import {
  DEFAULT_SCALE_LIMITS,
  KEY_ZOOM_FACTOR,
  attachController2d,
  createRenderer,
  zoomAt,
} from '@karmania/render';
import type { Controller2d, Renderer, RenderStats } from '@karmania/render';
import { createSceneStore, firstNumericColumn } from '@karmania/scene';
import type { Command, SceneDocument } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { CrsNames } from './crs-names.js';
import { carriesFiles } from './drag.js';
import { IMPORT_FILE_ACCEPT } from './import-files.js';
import type { DatasetChoice } from './dataset-list.js';
import { selectionAfterRemoving } from './datasets.js';
import type { CrsLookup, RowSource } from './datasets.js';
import './import-dialog.js';
import type { ImportLoaded } from './import-dialog.js';
import './map-area.js';
import './map-crs-dialog.js';
import type { MapCrsApply } from './map-crs-dialog.js';
import type { Navigate } from './nav-group.js';
import type { DroppedFiles, KarmaniaMapArea, PointerOnMap } from './map-area.js';
import './panel.js';
import type { PanelChange } from './panel.js';
import {
  browserStorage,
  clampPanelWidth,
  loadPanelState,
  PANEL_WIDTH,
  panelWidthLimits,
  savePanelState,
} from './panel-state.js';
import type { PanelState } from './panel-state.js';
import type { ResizeRequest } from './resize-handle.js';
import { layerLook } from './layer-look.js';
import { LayerPipeline } from './layer-pipeline.js';
import type { LayerSink, LayerState } from './layer-pipeline.js';
import { drawOrder } from './draw-order.js';
import { furnitureOf, sameFurniture } from './furniture.js';
import type { Furniture } from './furniture.js';
import { datasetNotices, sameNotices, summariseLayers } from './layer-summary.js';
import { readoutAt, readoutWidth } from './pointer-readout.js';
import { syncDatasets } from './scene-datasets.js';

/**
 * The viewer, `<karmania-viewer>`: the map area and the side panel, side by side, and the import wizard that opens
 * over them. It fills the element it is in and never scrolls. It is what a page embeds (`createViewer`), and what the
 * app puts under its toolbar.
 *
 * Files come in by the Import buttons (the map area's and the panel's, and `openImport`, which a page's own button
 * calls), which open the browser's file picker, and by being dropped on the map area. Either way the import wizard opens
 * with them.
 *
 * It keeps whether the panel is folded away, which tab is chosen and how wide the panel is between visits. The width is
 * limited by the window, and follows it: a panel that was made wide does not stay wider than a narrower window allows,
 * and is as wide as was asked again when the window is.
 */
export class KarmaniaViewer extends LitElement {
  static override properties = {
    panel: { state: true },
    viewportWidth: { state: true },
    datasets: { state: true },
    layerChanges: { state: true },
    cannotDraw: { state: true },
    selected: { state: true },
    furniture: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      /* The viewer fills what it is in, and the workspace fills the viewer. It does not clip: what a
         control of the panel shows beyond the edge (a tooltip, a focus ring) is not cut off. */
      :host {
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        min-width: 0;
      }

      /* The map takes what the panel leaves. The panel's width is --k-panel-width, which the viewer
         sets from the width it was given and the window allows. */
      .workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--k-panel-width, var(--k-panel-width-default));
        min-height: 0;
        min-width: 0;
        position: relative;
      }

      .workspace[data-collapsed] {
        grid-template-columns: minmax(0, 1fr) var(--k-panel-rail-width);
      }
    `,
  ];

  /** How the panel is: folded away or open, the tab it is on, and the width it was given. */
  declare private panel: PanelState;
  /** How wide the window is, which limits how wide the panel can be. */
  declare private viewportWidth: number;
  /** The datasets that have been loaded and kept, in the order they were loaded. */
  declare private datasets: readonly Summary[];
  /** Counts the changes of where the layers are (being prepared, drawn, not drawn): what the map area says of them is made again for each. */
  declare private layerChanges: number;
  /** Whether the browser could not give the page a renderer (it has no WebGL 2): the map area says so, and the page does not try again. */
  declare private cannotDraw: boolean;
  /** The dataset that is selected: the one that was loaded last, until a person chooses another. */
  declare private selected: number | undefined;
  /**
   * What the furniture over the map shows (the north arrow's heading, the scale bar). Kept here, and made again only when what it shows is
   * different, so that the viewer is drawn again when the map is turned or zoomed and not when it is only moved.
   */
  declare private furniture: Furniture;

  constructor() {
    super();
    this.panel = loadPanelState(browserStorage());
    this.viewportWidth = document.documentElement.clientWidth;
    this.datasets = [];
    this.layerChanges = 0;
    this.cannotDraw = false;
    this.selected = undefined;
    this.furniture = furnitureOf(this.store.getState(), undefined);
  }

  /** The engine, which is started when the first files arrive, not before. */
  private engine: Engine | undefined;

  /**
   * The scene: what there is to draw and how, the one place that says so. It has a layer for each dataset that is
   * loaded, which `syncDatasets` keeps; nothing is drawn from it yet.
   */
  private readonly store = createSceneStore();

  /** The scene as it is now. */
  scene(): SceneDocument {
    return this.store.getState();
  }

  /** Changes the scene by a command (the same that the controls of the viewer use), and gives the document that comes of it. */
  dispatch(command: Command): SceneDocument {
    return this.store.dispatch(command);
  }

  /** Gets rows of a dataset from the engine, for the table. It is one function for as long as the viewer is. */
  private readonly rows: RowSource = (id, start, count) => {
    const engine = this.engine;
    return engine === undefined
      ? Promise.reject(new Error('There is no engine to ask for rows.'))
      : engine.rows(id, start, count);
  };

  /**
   * Says what an EPSG code means, for the Data tab. With no engine it fails, as `rows` does: that is not
   * the same as the definitions not having the code, which is an answer of `undefined`.
   */
  private readonly crsInfo: CrsLookup = (code) => {
    const engine = this.engine;
    return engine === undefined
      ? Promise.reject(new Error('There is no engine to ask what a code means.'))
      : engine.crsInfo(code);
  };

  /** What the definitions say of the codes of the map's coordinate systems, for the units of the scale bar; an answer that arrives draws the furniture again. */
  private readonly names = new CrsNames(this.crsInfo, () => {
    this.refreshFurniture();
  });

  /** Where the pointer last was on the map, which the readout of the status chip follows; `undefined` while it is off it. */
  private pointer: { readonly x: number; readonly y: number } | undefined;

  /**
   * Writes where the pointer is for the status chip: the point of the map under it at the camera the scene has now (the map moves under a
   * pointer that is still, with a key or a button), or a dash if it is off the map or the view is 3D. It is set on the map area at once and not
   * kept as state of the viewer, so that a move of the pointer draws the chip and not the viewer.
   */
  private updateReadout(): void {
    const area = this.renderRoot.querySelector('karmania-map-area');
    const box = area?.canvas?.getBoundingClientRect();
    if (area === null || box === undefined) {
      return;
    }
    const state = this.store.getState();
    const size = { width: box.width, height: box.height };
    const here = this.pointer;
    area.readout =
      here === undefined || state.viewMode === '3d' || state.frame === null
        ? undefined
        : readoutAt(state.camera2d, size, here.x, here.y);
    area.readoutChars = readoutWidth(state.camera2d, size);
  }

  private readonly onPointer = (event: CustomEvent<PointerOnMap>): void => {
    this.pointer = event.detail === null ? undefined : { x: event.detail.x, y: event.detail.y };
    this.updateReadout();
  };

  /** What the definitions say of the code of the map's coordinate system, if it is an EPSG one that has been asked about. */
  private mapCrsInfo(): CrsInfo | null | undefined {
    const crs = this.store.getState().frame?.mapCrs;
    return crs?.kind === 'epsg' ? this.names.get(crs.code) : undefined;
  }

  /** Makes the furniture again for the scene as it is, and keeps the new one if it shows something different. */
  private refreshFurniture(): void {
    const state = this.store.getState();
    const crs = state.frame?.mapCrs;
    const next = furnitureOf(state, crs?.kind === 'epsg' ? this.names.get(crs.code) : undefined);
    if (!sameFurniture(this.furniture, next)) {
      this.furniture = next;
    }
  }

  /** What draws the map on the canvas of the map area: there from just after the first render until the viewer is taken out. */
  private renderer: Renderer | undefined;

  /** A rectangle of what the renderer has drawn, as it reads it back (see `Renderer.readPixels`), for tests; none without a renderer. */
  renderPixels(x: number, y: number, width: number, height: number): Uint8Array | undefined {
    return this.renderer?.readPixels(x, y, width, height);
  }

  /** How the renderer is (frames drawn, the size of its buffer, what is on the card), for tests and diagnostics; none without one. */
  renderStats(): RenderStats | undefined {
    return this.renderer?.stats();
  }

  /** Whether the viewer is waiting for the map area's canvas, so that two calls do not make two renderers. */
  private attaching = false;

  /**
   * Makes the renderer when there is something to draw, once the map area has made its canvas. **Not before**: a page that
   * has no data holds no context of the graphics card (the browser allows a few), and the browser draws the text of a page
   * that has a WebGL canvas in it otherwise than it does without one (greyscale for subpixel anti-aliasing), which would
   * change every picture of the empty app. The viewer may be taken out of the page while it waits, or put back and ask again
   * (which does nothing while the first is waiting), so it looks at whether it is in the page after the wait.
   */
  private async attachRenderer(): Promise<void> {
    const area = this.renderRoot.querySelector('karmania-map-area');
    if (area === null || this.renderer !== undefined || this.attaching || this.cannotDraw) {
      return;
    }
    let canvas: HTMLCanvasElement | undefined;
    let made: Renderer | undefined;
    this.attaching = true;
    try {
      await area.updateComplete;
      // The context and the renderer are made in tasks of their own, which is why it is awaited: made in the one that is handling the click
      // that loaded the file, they held the page for about 50 ms along with what that click does, and no task of the page is to be over
      // 50 ms (section 9.6). The browser's context and three's own state are two more (and a wait for the card between them).
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      canvas = area.canvas;
      // Nothing may be waiting any more (the layer was removed, or cannot be drawn, in the turns that it took to get here): no context then.
      if (canvas === undefined || !this.inPage() || !this.hasWaiting()) {
        return;
      }
      made = await createRenderer(canvas, {
        // The card took the context away, or gave it back: the map area says so while the map is being drawn again.
        onContextLoss: (lost) => {
          area.redrawing = lost;
        },
      });
    } finally {
      this.attaching = false;
    }
    // The viewer was taken out of the page while the renderer was being made: it gives the context up at once.
    if (!this.inPage()) {
      made?.dispose();
      return;
    }
    this.renderer = made;
    this.cannotDraw = made === undefined;
    this.lookThroughCamera();
    this.controller = made === undefined ? undefined : this.listenToPerson(area, canvas);
    area.interactive = this.controller !== undefined;
    this.pipeline?.rendererReady();
  }

  /** Whether a layer is prepared and waits for the renderer (asked again after each wait, since the pipeline may be gone or the layer too). */
  private hasWaiting(): boolean {
    return this.pipeline?.hasWaiting() === true;
  }

  /** Whether the viewer is in a page now (asked again after each wait, since it may have been taken out meanwhile). */
  private inPage(): boolean {
    return this.isConnected;
  }

  /** What moves the map when a person drags it, turns the wheel or presses a key: it asks the scene for a camera. */
  private controller: Controller2d | undefined;

  private listenToPerson(
    area: KarmaniaMapArea,
    canvas: HTMLCanvasElement,
  ): Controller2d | undefined {
    const focusTarget = area.focusTarget;
    if (focusTarget === undefined) {
      return undefined;
    }
    return attachController2d({
      element: area,
      canvas,
      focusTarget,
      getCamera: () => this.store.getState().camera2d,
      getLimits: () => this.pipeline?.limits() ?? DEFAULT_SCALE_LIMITS,
      onFit: () => {
        this.fit();
      },
      onCamera: (change) => {
        this.store.dispatch({ type: 'setCamera', patch: { camera2d: change } });
      },
    });
  }

  /** Gives the renderer the camera and the origin of the scene. */
  private lookThroughCamera(): void {
    const { camera2d, frame } = this.store.getState();
    this.renderer?.setCamera2d(camera2d, frame?.origin ?? [0, 0, 0]);
  }

  /**
   * What turns the layers of the scene into layers on the card (prepared in the worker, given to the renderer), and fits the camera
   * to the data. It needs the engine, so it is made with it, and stopped when the viewer is taken out of the page.
   */
  private pipeline: LayerPipeline | undefined;

  private pipelineFor(engine: Engine): LayerPipeline {
    this.pipeline ??= new LayerPipeline({
      engine,
      scene: this.store,
      sink: () => this.sink(),
      viewport: () => {
        const box = this.renderRoot.querySelector('karmania-map-area')?.getBoundingClientRect();
        return { width: box?.width ?? 0, height: box?.height ?? 0 };
      },
      onChange: () => {
        this.layerChanges += 1;
        // The renderer is made when the first buffers are ready to be drawn, and not when the layer is first asked for: made while the worker
        // is busy preparing them, the card and the worker compete for the machine and the renderer's own start takes 25 to 55 ms of the page.
        if (this.renderer === undefined && this.hasWaiting()) {
          // (If it fails for a reason that is not the lack of WebGL 2, the map cannot be drawn all the same, and the message says so.)
          void this.attachRenderer().catch(() => {
            this.cannotDraw = true;
          });
        }
      },
      firstColumn: (datasetId) => {
        const summary = this.datasets.find((dataset) => dataset.id === datasetId);
        return summary === undefined ? undefined : firstNumericColumn(summary);
      },
    });
    return this.pipeline;
  }

  /** The renderer, as what the pipeline gives buffers to; `undefined` while there is none. */
  private sink(): LayerSink | undefined {
    const renderer = this.renderer;
    return renderer === undefined
      ? undefined
      : {
          setLayer: (id, buffers) => {
            const state = this.store.getState();
            const layer = state.layers[id];
            // (A layer that is gone is not given buffers; the look is the scene's own for the one that is there.)
            const outcome =
              layer === undefined
                ? 'unsupported'
                : renderer.setLayer(id, buffers, layerLook(layer));
            // The order it is drawn in is the legend's, which the renderer is told with the first layer it has, and when the legend changes.
            renderer.setLayerOrder(drawOrder(state));
            return outcome;
          },
          setLayerClasses: (id, classes) => {
            renderer.setLayerClasses(id, classes);
          },
          removeLayer: (id) => renderer.removeLayer(id),
          setDepthRange: (min, max) => {
            renderer.setDepthRange(min, max);
          },
          get maxTextureSize() {
            return renderer.stats().maxTextureSize;
          },
        };
  }

  /** Shows the data: the camera goes where all that is visible and prepared fits in the map area. */
  fit(): void {
    this.pipeline?.fit();
  }

  /** Why each dataset that is not drawn is not, as the Data tab was last given it. */
  private notices: ReadonlyMap<number, string> = new Map();

  /** Where each layer is (`preparing`, `drawn`, `not_drawn` with why, ...), for tests and diagnostics. */
  layerStates(): [string, LayerState][] {
    return [...(this.pipeline?.states() ?? [])];
  }

  /** Called when the scene changes: the camera is what the renderer looks through. */
  private readonly onScene = (state: SceneDocument, previous: SceneDocument): void => {
    if (this.engine !== undefined) {
      this.pipelineFor(this.engine).update();
    }
    if (state.camera2d !== previous.camera2d || state.frame !== previous.frame) {
      this.lookThroughCamera();
    }
    // The scale bar is in the units of the map's coordinate system, which the definitions say for an EPSG code: asked once.
    const crs = state.frame?.mapCrs;
    if (crs?.kind === 'epsg') {
      this.names.ask(crs.code);
    }
    this.refreshFurniture();
    if (
      state.camera2d !== previous.camera2d ||
      state.frame !== previous.frame ||
      state.viewMode !== previous.viewMode
    ) {
      this.updateReadout();
    }
    // What is higher in the legend is drawn over what is lower.
    if (state.legend !== previous.legend) {
      this.renderer?.setLayerOrder(drawOrder(state));
    }
    // A layer whose style or visibility changed looks different, and is not built again for it.
    for (const [id, layer] of Object.entries(state.layers)) {
      if (layer !== previous.layers[id]) {
        this.renderer?.setLayerLook(id, layerLook(layer));
      }
    }
  };

  /** Stops listening to the scene; set while the viewer is in a page. */
  private unlistenScene: (() => void) | undefined;

  /** Watches the size of the map area, which changes the point under a pointer that is still (a resized window, a panel that is folded away). */
  private sizeWatch: ResizeObserver | undefined;

  private watchSize(): void {
    const area = this.renderRoot.querySelector('karmania-map-area');
    if (area === null || this.sizeWatch !== undefined) {
      return;
    }
    this.sizeWatch = new ResizeObserver(() => {
      this.updateReadout();
    });
    this.sizeWatch.observe(area);
  }

  protected override firstUpdated(): void {
    this.watchSize();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Put back in a page, the viewer's first render has been made already.
    if (this.hasUpdated) {
      this.watchSize();
    }
    window.addEventListener('dragover', this.refuseStrayFiles);
    window.addEventListener('drop', this.refuseStrayFiles);
    window.addEventListener('resize', this.onWindowResize);
    this.unlistenScene = this.store.subscribe(this.onScene);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('dragover', this.refuseStrayFiles);
    window.removeEventListener('drop', this.refuseStrayFiles);
    window.removeEventListener('resize', this.onWindowResize);
    this.unlistenScene?.();
    this.unlistenScene = undefined;
    this.sizeWatch?.disconnect();
    this.sizeWatch = undefined;
    this.pipeline?.dispose();
    this.pipeline = undefined;
    this.controller?.dispose();
    this.controller = undefined;
    const area = this.renderRoot.querySelector('karmania-map-area');
    if (area !== null) {
      area.interactive = false;
    }
    this.renderer?.dispose();
    this.renderer = undefined;
    this.cannotDraw = false;
    this.engine?.dispose();
    this.engine = undefined;
    // What the engine held is gone with it, so the list of datasets, the selection and the layers are emptied: a viewer
    // that is put back in a page starts again, and does not list datasets that no engine can give rows of.
    this.datasets = [];
    this.selected = undefined;
    this.names.clear();
    syncDatasets(this.store, this.datasets);
  }

  private readonly onWindowResize = (): void => {
    this.viewportWidth = document.documentElement.clientWidth;
  };

  /** Opens the file picker, which is an input that is not shown. */
  private readonly chooseFiles = (): void => {
    this.renderRoot.querySelector('input')?.click();
  };

  /** Opens the import wizard on `files`, or the file picker when there are none to give (no list, or an empty one). */
  openImport(files?: readonly File[]): void {
    if (files === undefined || files.length === 0) {
      this.chooseFiles();
    } else {
      this.importFiles(files);
    }
  }

  /** Opens the wizard with what was chosen in the picker, and clears the input so that the same file can be chosen again. */
  private readonly onFilesChosen = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    this.importFiles(files);
  };

  private readonly onFilesDropped = (event: CustomEvent<DroppedFiles>): void => {
    this.importFiles(event.detail.files);
  };

  /** Opens the import wizard on `files`, if there are any. */
  private importFiles(files: readonly File[]): void {
    const wizard = this.renderRoot.querySelector('karmania-import-dialog');
    if (files.length > 0 && wizard) {
      this.engine ??= createEngine();
      wizard.engine = this.engine;
      wizard.show(files);
    }
  }

  /** Does what a person asked of the panel, and keeps the panel that way. */
  private readonly onPanelChange = (event: CustomEvent<PanelChange>): void => {
    this.changePanel(event.detail);
  };

  /** The map area says nothing can be drawn and sends people to the Legend, which says why for each layer. */
  private readonly onShowLegend = (): void => {
    this.changePanel({ tab: 'legend', collapsed: false });
  };

  /** The north arrow was pressed: north is up, with the centre and the scale as they are. */
  private readonly onNorthReset = (): void => {
    this.store.dispatch({ type: 'setCamera', patch: { camera2d: { heading: 0 } } });
  };

  /** A button of the navigation group was pressed: the same as the key that does it, or, for the last, north up and the data in view. */
  private readonly onNavigate = (event: CustomEvent<Navigate>): void => {
    switch (event.detail.action) {
      case 'zoom-in':
        this.zoomBy(1 / KEY_ZOOM_FACTOR);
        break;
      case 'zoom-out':
        this.zoomBy(KEY_ZOOM_FACTOR);
        break;
      case 'fit':
        this.fit();
        break;
      case 'reset':
        this.onNorthReset();
        this.fit();
        break;
    }
  };

  /** Changes the scale by `factor` (less than 1 comes closer) about the middle of the map, as the keys do, and not past the limits. */
  private zoomBy(factor: number): void {
    const box = this.renderRoot.querySelector('karmania-map-area')?.canvas?.getBoundingClientRect();
    if (box === undefined) {
      return;
    }
    const size = { width: box.width, height: box.height };
    const change = zoomAt(
      this.store.getState().camera2d,
      size,
      factor,
      size.width / 2,
      size.height / 2,
      this.pipeline?.limits() ?? DEFAULT_SCALE_LIMITS,
    );
    if (change !== undefined) {
      this.store.dispatch({ type: 'setCamera', patch: { camera2d: change } });
    }
  }

  /** The status chip's button was pressed: the dialog for the map's coordinate system opens, with nothing chosen. */
  private readonly onMapCrsRequest = (): void => {
    this.renderRoot.querySelector('karmania-map-crs-dialog')?.show();
  };

  /**
   * A person applied a coordinate system in the map CRS dialog: the scene takes it as the person's choice (`source: user`), and the pipeline
   * asks the engine for the frame in it (which gives the origin), prepares every layer again for it, and fits the camera to the data in the
   * new units, which it does whenever the map's system changes.
   */
  private readonly onMapCrsApply = (event: CustomEvent<MapCrsApply>): void => {
    this.store.dispatch({
      type: 'setFrame',
      frame: { mapCrs: event.detail.crs, origin: [0, 0, 0], source: 'user' },
    });
  };

  private readonly onDatasetSelect = (event: CustomEvent<DatasetChoice>): void => {
    this.selected = event.detail.id;
  };

  /** Removes a dataset from the engine, and from what is shown, and selects the one that takes its place. */
  private readonly onDatasetRemove = async (event: CustomEvent<DatasetChoice>): Promise<void> => {
    const engine = this.engine;
    if (engine === undefined) {
      return;
    }
    const { id } = event.detail;
    const next = selectionAfterRemoving(this.datasets, id, this.selected);
    await engine.remove(id);
    this.datasets = engine.datasets();
    syncDatasets(this.store, this.datasets);
    this.selected = next;
  };

  private changePanel(change: PanelChange): void {
    this.panel = { ...this.panel, ...change };
    savePanelState(browserStorage(), this.panel);
  }

  /**
   * Something has been loaded: the datasets are those the engine holds, the new one is selected, and
   * the panel shows the Data tab, open, whatever it was showing.
   */
  private adopt(summaries: readonly Summary[]): void {
    this.datasets = this.engine?.datasets() ?? [];
    syncDatasets(this.store, this.datasets);
    this.selected = summaries[0]?.id;
    this.changePanel({ tab: 'data', collapsed: false });
  }

  private readonly onImportLoaded = (event: CustomEvent<ImportLoaded>): void => {
    this.adopt(event.detail.summaries);
  };

  /**
   * Loads a dataset made with a builder (`points`, `grid`, `blocks`, ...), as a file that is imported is: it is listed in the Data tab, selected,
   * and drawn. The engine takes the input's arrays, which are empty afterwards, so an input is loaded once. Resolves with what the engine says:
   * `loaded` with the summaries, or `blocked` with the findings, and then nothing is added. Rejects when the viewer is not in a page: the engine
   * belongs to the time it is in one (it is made here, and let go when the viewer is taken out), so one made for a viewer that is out of a page
   * would never be let go. (The first part of the viewer's API; the rest of it comes with the embedding.)
   */
  async load(input: DatasetInput, options?: LoadOptions): Promise<LoadResult> {
    if (!this.isConnected) {
      throw new Error('The viewer is not in a page: put it in one before loading a dataset.');
    }
    this.engine ??= createEngine();
    const result = await this.engine.load(input, options);
    if (result.status === 'loaded') {
      this.adopt(result.summaries);
    }
    return result;
  }

  /** Gives the panel the width that was asked for, as far as the window allows. */
  private readonly onResize = (event: CustomEvent<ResizeRequest>): void => {
    this.panel = { ...this.panel, width: clampPanelWidth(event.detail.width, this.viewportWidth) };
    savePanelState(browserStorage(), this.panel);
  };

  /**
   * Files dropped anywhere but the map area do nothing. Left alone, the browser would open the file
   * in place of the page, so what nobody has taken is taken here, and the pointer says no.
   */
  private readonly refuseStrayFiles = (event: DragEvent): void => {
    if (carriesFiles(event) && !event.defaultPrevented) {
      event.preventDefault();
      if (event.type === 'dragover' && event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'none';
      }
    }
  };

  override render() {
    // The width that was asked for, or what the window allows of it.
    const width = clampPanelWidth(this.panel.width, this.viewportWidth);
    const limits = panelWidthLimits(this.viewportWidth);
    const states = this.pipeline?.states() ?? new Map();
    const layers = summariseLayers(states.values());
    const found = datasetNotices(states, this.store.getState().layers);
    // The same object while the reasons are the same: a turn of the map draws the viewer again, and the panel need not be.
    if (!sameNotices(this.notices, found)) {
      this.notices = found;
    }
    const notices = this.notices;
    return html`
      <div
        class="workspace"
        ?data-collapsed=${this.panel.collapsed}
        style=${`--k-panel-width: ${String(width)}px`}
      >
        <karmania-map-area
          .datasets=${this.datasets.length}
          .unavailable=${this.cannotDraw}
          .heading=${this.furniture.heading}
          .scale=${this.furniture.scale}
          .crs=${this.furniture.crs}
          .label=${this.furniture.label}
          .preparing=${layers.preparing}
          .progress=${layers.progress}
          .reasons=${layers.reasons}
          @karmania-show-legend=${this.onShowLegend}
          @karmania-north-reset=${this.onNorthReset}
          @karmania-navigate=${this.onNavigate}
          @karmania-map-crs-request=${this.onMapCrsRequest}
          @karmania-pointer-on-map=${this.onPointer}
          @karmania-import-request=${this.chooseFiles}
          @karmania-files-dropped=${this.onFilesDropped}
        ></karmania-map-area>
        <karmania-panel
          .collapsed=${this.panel.collapsed}
          .width=${width}
          .min=${limits.min}
          .max=${limits.max}
          .reset=${PANEL_WIDTH.default}
          .tab=${this.panel.tab}
          .datasets=${this.datasets}
          .selected=${this.selected}
          .rows=${this.rows}
          .crsInfo=${this.crsInfo}
          .notices=${notices}
          @karmania-import-request=${this.chooseFiles}
          @karmania-dataset-select=${this.onDatasetSelect}
          @karmania-dataset-remove=${this.onDatasetRemove}
          @karmania-panel-change=${this.onPanelChange}
          @karmania-resize=${this.onResize}
        ></karmania-panel>
      </div>
      <input
        type="file"
        multiple
        hidden
        accept=${IMPORT_FILE_ACCEPT}
        aria-label="Choose files to import"
        @change=${this.onFilesChosen}
      />
      <karmania-import-dialog
        @karmania-import-loaded=${this.onImportLoaded}
      ></karmania-import-dialog>
      <karmania-map-crs-dialog
        @karmania-map-crs-apply=${this.onMapCrsApply}
        .engine=${this.engine}
        .frame=${this.store.getState().frame}
        .info=${this.mapCrsInfo()}
        .datasets=${this.datasets}
      ></karmania-map-crs-dialog>
    `;
  }
}

customElements.define('karmania-viewer', KarmaniaViewer);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-viewer': KarmaniaViewer;
  }
}
