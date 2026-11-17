import { createEngine } from '@karmania/engine';
import type {
  CrsInfo,
  DatasetInput,
  Engine,
  LoadOptions,
  LoadResult,
  Page,
  Summary,
} from '@karmania/engine';
import {
  DEFAULT_DISTANCE_LIMITS,
  DEFAULT_SCALE_LIMITS,
  ExportError,
  KEY_ZOOM_FACTOR,
  attachController2d,
  attachController3d,
  createRenderer,
  zoom3dAt,
  zoomAt,
} from '@karmania/render';
import type {
  Controller2d,
  Controller3d,
  ExportLimits,
  ExportRenderOptions,
  ExportRendered,
  PickHit,
  Renderer,
  RenderStats,
} from '@karmania/render';
import {
  EXPORT_COLOURS,
  cameraTo2d,
  cameraTo3d,
  createSceneStore,
  exportLegendLines,
  firstNumericColumn,
  legendModel,
  maxSide,
  parseHex,
  sizeProblems,
} from '@karmania/scene';
import type {
  Command,
  LegendModel,
  SceneDocument,
  SceneListener,
  Size,
  ViewMode,
} from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { CrsNames } from './crs-names.js';
import { browserEnv, composeExport, planOnly } from './export-compose.js';
import type {
  Composed,
  ExportPlan,
  ExportPngOptions,
  ExportPngRun,
  PictureOptions,
  PlanInput,
} from './export-compose.js';
import './export-dialog.js';
import type { ExportDialogWork } from './export-dialog.js';
import { encodePng } from './png-encode.js';
import { carriesFiles } from './drag.js';
import { IMPORT_FILE_ACCEPT } from './import-files.js';
import type { DatasetChoice } from './dataset-list.js';
import type { ContoursTurnOn, LegendCommand } from './legend-tab.js';
import { selectionAfterChange, selectionAfterRemoved } from './datasets.js';
import type { CrsLookup, RowSource } from './datasets.js';
import './import-dialog.js';
import type { ImportLoaded } from './import-dialog.js';
import './map-area.js';
import './map-crs-dialog.js';
import type { MapCrsApply } from './map-crs-dialog.js';
import type { Navigate } from './nav-group.js';
import type { DroppedFiles, KarmaniaMapArea, PointerOnMap } from './map-area.js';
import { headingOf } from './heading.js';
import { identifyModel } from './identify.js';
import { unitsOf } from './map-units.js';
import './identify-popover.js';
import type { IdentifyClose, IdentifyShow } from './identify-popover.js';
import type { TableSelect } from '@karmania/ui';
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
import { ContoursManager } from './contours-manager.js';
import type { ContoursState } from './contours-manager.js';
import { LayerPipeline } from './layer-pipeline.js';
import { styleInfos } from './legend-style.js';
import type { StyleInfo } from './legend-style.js';
import type { LayerSink, LayerState } from './layer-pipeline.js';
import { drawOrder } from './draw-order.js';
import { furnitureOf, sameFurniture } from './furniture.js';
import type { Furniture } from './furniture.js';
import { datasetNotices, sameNotices, summariseLayers } from './layer-summary.js';
import { readoutAt, readoutWidth } from './pointer-readout.js';
import { syncDatasets } from './scene-datasets.js';

/** The elevation the 3D view is put at by "Reset view", in degrees above the horizon: that of the first view of the data (`fitCamera3d` and the empty scene). */
const RESET_ELEVATION = 45;

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

  /** Calls `listener` after each change of the scene, with the document that came of it and the one it replaced; gives the way to stop. */
  subscribeToScene(listener: SceneListener): () => void {
    return this.store.subscribe(listener);
  }

  /**
   * Shows the map in 2D or in 3D, looking at the same place: the camera of the view it goes to is made from the camera of the view it
   * leaves (`cameraTo3d`, `cameraTo2d`), so the centre, the heading and the scale at the centre are kept. Going to 3D looks at the middle of
   * the height of the visible data, from the elevation and with the lens that the 3D camera had. The camera comes first and the mode
   * after, so that the scene is never in 3D with a camera that was not made for it. **With no map area to measure** (nothing is drawn yet, or the
   * viewer is hidden) the scale cannot be converted, but the centre and the heading can still be kept, so they are: the camera that is gone to has
   * the centre and the heading of the one that is left, and its own distance or scale.
   *
   * @throws RangeError for a mode that is not `2d` or `3d`, which is a mistake of the caller.
   */
  setViewMode(mode: ViewMode): void {
    // (The type says it is one of two; a caller in plain JavaScript can still give another.)
    if (!(['2d', '3d'] as readonly string[]).includes(mode)) {
      throw new RangeError(`The view is "2d" or "3d", and not ${JSON.stringify(mode)}.`);
    }
    const state = this.store.getState();
    if (state.viewMode === mode) {
      return;
    }
    const box = this.renderRoot.querySelector('karmania-map-area')?.getBoundingClientRect();
    const viewport = { width: box?.width ?? 0, height: box?.height ?? 0 };
    if (mode === '3d') {
      const targetZ = this.pipeline?.middleHeight() ?? state.camera3d.target[2];
      const camera3d = cameraTo3d({
        camera2d: state.camera2d,
        viewport,
        fov: state.camera3d.fov,
        elevation: state.camera3d.elevation,
        targetZ,
      });
      this.store.dispatch({
        type: 'setCamera',
        patch: {
          // Without a size to measure, the place and the way it faces are still kept; the distance is the 3D camera's own.
          camera3d: camera3d ?? {
            target: [state.camera2d.centre[0], state.camera2d.centre[1], targetZ],
            heading: state.camera2d.heading,
          },
        },
      });
    } else {
      const camera2d = cameraTo2d({ camera3d: state.camera3d, viewport });
      this.store.dispatch({
        type: 'setCamera',
        patch: {
          camera2d: camera2d ?? {
            centre: [state.camera3d.target[0], state.camera3d.target[1]],
            heading: state.camera3d.heading,
          },
        },
      });
    }
    this.store.dispatch({ type: 'setViewMode', mode });
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

  /**
   * Which element of which layer is at a point of the map (`x` and `y` in CSS pixels from the top left of the canvas), as the renderer picks it
   * (see `Renderer.pick`); `null` where there is none, and `undefined` without a renderer. For tests, and for what a click does.
   */
  async renderPick(x: number, y: number): Promise<PickHit | null | undefined> {
    return this.renderer?.pick(x, y);
  }

  /**
   * Draws the map again for the picture of an export, band by band (see `Renderer.renderExport`); `undefined` without a renderer. The export of the viewer is made
   * with this (22.6), and the drawing of it is tested through it.
   */
  async renderExport(options: ExportRenderOptions): Promise<ExportRendered | undefined> {
    return this.renderer?.renderExport(options);
  }

  /** What the graphics card allows an export, or `undefined` without a renderer (see `Renderer.exportLimits`). */
  exportLimits(): ExportLimits | undefined {
    return this.renderer?.exportLimits();
  }

  /**
   * Puts the picture of the map together on a canvas of `size` pixels at `dpi` (see `composeExport`): the map drawn again by the renderer in the light theme, the north arrow, the
   * scale bar and, with `legend`, the legend, from the scene as it is now. This is what the exported file is made from (22.6), and what the dialog's preview is a small copy of.
   *
   * @throws Error if the map has not been drawn yet (there is no renderer), which is a mistake of the caller: nothing is exported before something is drawn.
   * @throws RangeError for a size or dpi that is not a number above 0.
   * Rejects with an `ExportError`, a `ComposeError`, an `ExportFontError`, or the signal's reason (see `composeExport`).
   */
  async composePicture(options: PictureOptions): Promise<Composed<HTMLCanvasElement>> {
    const renderer = this.renderer;
    if (renderer === undefined) {
      throw new Error('There is nothing to export: the map has not been drawn.');
    }
    const bytes = (hex: string): readonly [number, number, number] => parseHex(hex) ?? [0, 0, 0];
    return composeExport(browserEnv(this.ownerDocument), {
      ...this.pictureInput(options, renderer),
      heading: headingOf(this.store.getState()),
      renderMap: async (request) => {
        await renderer.renderExport({
          ...request,
          background: bytes(EXPORT_COLOURS.map),
          ink: bytes(EXPORT_COLOURS.text),
        });
      },
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
  }

  /**
   * Refuses a picture that cannot be made, as the dialog does before it asks: the **whole picture** is held to the most a side can be (8,192, or less where the card allows
   * less), and not only the map inside it, which is smaller by its margins and its line.
   *
   * @throws RangeError for a size that is not whole pixels or is below the least (a mistake of the caller).
   * @throws ExportError `too_large` for a side above the most this computer can draw.
   */
  private checkSize(size: Size, renderer: Renderer): void {
    const limits = renderer.exportLimits();
    const most = maxSide(limits);
    for (const problem of sizeProblems(size, most)) {
      if (problem.code === 'too_large') {
        throw new ExportError(
          'too_large',
          `The ${problem.side} of the picture is more than this computer can draw (${String(problem.most)} pixels at most).`,
        );
      }
      throw new RangeError(
        problem.code === 'too_small'
          ? `The ${problem.side} of the picture has to be at least ${String(problem.least)} pixels.`
          : 'The picture has to be whole pixels.',
      );
    }
  }

  /** What the layout of a picture is worked out from, for the scene as it is now. */
  private pictureInput(options: PictureOptions, renderer: Renderer): PlanInput {
    const state = this.store.getState();
    const screen = renderer.stats();
    return {
      size: options.size,
      dpi: options.dpi,
      legend: options.legend ? this.currentLegend() : null,
      viewMode: state.viewMode,
      camera2d: state.camera2d,
      camera3d: state.camera3d,
      units: unitsOf(state.frame, this.mapCrsInfo()),
      screen: { width: screen.cssWidth, height: screen.cssHeight },
      fonts: this.ownerDocument.fonts,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
  }

  /**
   * Where everything would go in the picture, with nothing drawn and no canvas of the picture's size made: what the export dialog warns from before it exports. Rejects as
   * `composePicture` does for the fonts and for a legend that leaves no room for the map (`ComposeError`).
   */
  async planPicture(options: PictureOptions): Promise<ExportPlan> {
    const renderer = this.renderer;
    if (renderer === undefined) {
      throw new Error('There is nothing to export: the map has not been drawn.');
    }
    const measure = this.ownerDocument.createElement('canvas').getContext('2d');
    if (measure === null) {
      throw new Error('The browser gave no canvas to measure the picture with.');
    }
    return planOnly(measure, this.pictureInput(options, renderer));
  }

  /** Whether there is something drawn to export: the map is there and at least one layer of it is shown and drawn. */
  exportable(): boolean {
    return this.renderer !== undefined && exportLegendLines(this.currentLegend()).length > 0;
  }

  /** What listens for `exportable()` changing, and what it was last. */
  private readonly exportableListeners = new Set<(available: boolean) => void>();
  private exportableNow = false;

  /** Calls `listener` when `exportable()` changes, with the new answer; gives the way to stop. */
  subscribeToExportable(listener: (available: boolean) => void): () => void {
    this.exportableListeners.add(listener);
    return () => {
      this.exportableListeners.delete(listener);
    };
  }

  /** What the export dialog makes pictures with. */
  private readonly exportWork: ExportDialogWork = {
    plan: (options) => this.planPicture(options),
    preview: async (options) => (await this.composePicture(options)).canvas,
    run: (options, run) => this.exportPng(options, run),
  };

  /** Opens the export dialog, with the options at their start. Nothing happens if there is nothing drawn to export. */
  openExport(): void {
    const dialog = this.renderRoot.querySelector('karmania-export-dialog');
    const renderer = this.renderer;
    if (dialog === null || renderer === undefined || !this.exportable()) {
      return;
    }
    const screen = renderer.stats();
    dialog.screen = { width: screen.cssWidth, height: screen.cssHeight };
    dialog.limits = renderer.exportLimits();
    dialog.work = this.exportWork;
    dialog.show();
  }

  /**
   * The exported picture as a PNG file (brief 11.8): the picture put together (see `composePicture`) and encoded, with the dpi in the file (`pHYs`) and the colour space (`sRGB`).
   * The same scene and options give the same bytes twice in a row (in one browser). `progress` is how far it is, from 0 to 1, counted in steps and never in time; the picture is the
   * first 70 % of it and the encoding the rest.
   *
   * @throws Error if the map has not been drawn yet; RangeError for a size or dpi that is not a number above 0.
   * Rejects with an `ExportError` (the card, the size, another export going on), a `ComposeError`, an `ExportFontError`, a `PngError`, or the signal's reason.
   */
  async exportPng(options: ExportPngOptions, run: ExportPngRun = {}): Promise<Blob> {
    const { signal, onProgress } = run;
    const size = { width: options.widthPx, height: options.heightPx };
    // Only the picture that is the file is held to the sizes of a picture: the dialog's preview is a small copy of it, and may be under the least.
    if (this.renderer !== undefined) {
      this.checkSize(size, this.renderer);
    }
    const composed = await this.composePicture({
      size,
      dpi: options.dpi,
      legend: options.legend,
      ...(signal === undefined ? {} : { signal }),
      onProgress: (done) => onProgress?.(0.7 * done),
    });
    const ctx = composed.canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) {
      throw new Error('The picture has no canvas to read.');
    }
    return encodePng({
      width: size.width,
      height: size.height,
      dpi: options.dpi,
      readRows: (first, count) => ctx.getImageData(0, first, size.width, count).data,
      ...(signal === undefined ? {} : { signal }),
      onProgress: (done) => onProgress?.(0.7 + 0.3 * done),
    });
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
    made?.setSelection(this.store.getState().selection);
    this.lookThroughCamera();
    this.refreshController();
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
  private controller: Controller2d | Controller3d | undefined;

  private listenToPerson(
    area: KarmaniaMapArea,
    canvas: HTMLCanvasElement,
  ): Controller2d | Controller3d | undefined {
    const focusTarget = area.focusTarget;
    if (focusTarget === undefined) {
      return undefined;
    }
    if (this.store.getState().viewMode === '3d') {
      return attachController3d({
        element: area,
        canvas,
        focusTarget,
        getCamera: () => this.store.getState().camera3d,
        getLimits: () => this.pipeline?.distanceLimits() ?? DEFAULT_DISTANCE_LIMITS,
        onFit: () => {
          this.fit();
        },
        onCamera: (change) => {
          this.store.dispatch({ type: 'setCamera', patch: { camera3d: change } });
        },
      });
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

  /** Replaces the listener when the renderer arrives or the active camera changes. */
  private refreshController(): void {
    const area = this.renderRoot.querySelector('karmania-map-area');
    const canvas = area?.canvas;
    this.controller?.dispose();
    this.controller =
      this.renderer === undefined || area === null || canvas === undefined
        ? undefined
        : this.listenToPerson(area, canvas);
    if (area !== null) {
      area.interactive = this.controller !== undefined;
    }
  }

  /** Gives the renderer both cameras, the active view and the origin of the scene. */
  private lookThroughCamera(): void {
    const { viewMode, camera2d, camera3d, frame, verticalExaggeration } = this.store.getState();
    this.renderer?.setView({
      viewMode,
      camera2d,
      camera3d,
      origin: frame?.origin ?? [0, 0, 0],
      verticalExaggeration,
    });
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

  /**
   * What keeps the contour lines of the layers, and their layers, to what the scene says: it asks the engine for them, replaces them when their settings
   * change and takes them away when the layer has none. It needs the engine, so it is made with it and stopped with the pipeline.
   */
  private contours: ContoursManager | undefined;

  private contoursFor(engine: Engine): ContoursManager {
    this.contours ??= new ContoursManager({
      engine,
      scene: this.store,
      adopt: (list) => {
        const before = this.datasets;
        this.datasets = list;
        syncDatasets(this.store, this.datasets);
        this.selected = selectionAfterChange(before, list, this.selected);
      },
      onChange: () => {
        this.layerChanges += 1;
      },
    });
    return this.contours;
  }

  /** Whether the contours of a layer are being made, are there, or could not be made (and why), for the style editor. */
  contoursState(layerId: string): ContoursState {
    return this.contours?.state(layerId) ?? { status: 'idle' };
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
          setExtent: (extent) => {
            renderer.setExtent(extent);
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
  /** The legend the Legend tab shows, and the text it was made into, so that the same legend is the same object (a turn of the map draws the viewer again). */
  private legend: LegendModel | undefined;
  private legendKey = '';
  /** What the style editors are given, and the text of it, kept the same while it is the same (as the legend is). */
  private styles: Readonly<Record<string, StyleInfo>> | undefined;
  private stylesKey = '';

  /** What the style editors need now: the style of each layer, and the kind and columns of its dataset. */
  private currentStyles(): Readonly<Record<string, StyleInfo>> {
    const next = styleInfos(this.store.getState(), this.datasets, (layerId) =>
      this.contoursState(layerId),
    );
    const key = JSON.stringify(next);
    if (this.styles === undefined || key !== this.stylesKey) {
      this.styles = next;
      this.stylesKey = key;
    }
    return this.styles;
  }

  /** The legend of the scene now: the layers and groups, with the classes the engine has given and why a layer is not drawn. */
  private currentLegend(): LegendModel {
    const next = legendModel(this.store.getState(), this.pipeline?.legendInputs() ?? {});
    const key = JSON.stringify(next);
    if (this.legend === undefined || key !== this.legendKey) {
      this.legend = next;
      this.legendKey = key;
    }
    return this.legend;
  }

  /** Where each layer is (`preparing`, `drawn`, `not_drawn` with why, ...), for tests and diagnostics. */
  layerStates(): [string, LayerState][] {
    return [...(this.pipeline?.states() ?? [])];
  }

  /** Called when the scene changes: the camera is what the renderer looks through. */
  private readonly onScene = (state: SceneDocument, previous: SceneDocument): void => {
    if (this.engine !== undefined) {
      this.pipelineFor(this.engine).update();
      this.contoursFor(this.engine).update();
    }
    if (
      state.viewMode !== previous.viewMode ||
      state.camera2d !== previous.camera2d ||
      state.camera3d !== previous.camera3d ||
      state.verticalExaggeration !== previous.verticalExaggeration ||
      state.frame !== previous.frame
    ) {
      this.lookThroughCamera();
    }
    if (state.viewMode !== previous.viewMode) {
      this.refreshController();
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
    // The Legend tab lists the layers, with their names, switches, styles and order.
    if (state.layers !== previous.layers || state.legend !== previous.legend) {
      this.requestUpdate();
    }
    // What is higher in the legend is drawn over what is lower.
    if (state.legend !== previous.legend) {
      this.renderer?.setLayerOrder(drawOrder(state));
    }
    // The selected element has an outline, and the popover is of it while it is the selection.
    if (state.selection !== previous.selection) {
      this.renderer?.setSelection(state.selection);
      this.refreshIdentify();
      // The row of the table that is the selected element is tinted.
      this.requestUpdate();
    }
    // A layer whose style or visibility changed looks different, and is not built again for it.
    for (const [id, layer] of Object.entries(state.layers)) {
      if (layer !== previous.layers[id]) {
        this.renderer?.setLayerLook(id, layerLook(layer));
      }
    }
  };

  /** The pick that was asked for last: the answer of an older one that comes after is not taken. */
  private pickSerial = 0;

  /** What a person decided after a click on the map (Escape, a row of the table, the popover closed) stands over the click's answer, which is not taken when it comes. */
  private overtakePick(): void {
    this.pickSerial += 1;
  }

  /**
   * A click on the map selects what is at that point of it (the renderer's pick), or nothing when nothing is: a click on the empty map clears the
   * selection. The answer comes from the card a little later, and one that a later click has overtaken is dropped.
   */
  private readonly onMapClick = (event: CustomEvent<PointerOnMap>): void => {
    const click = event.detail;
    const renderer = this.renderer;
    if (click === null || renderer === undefined) {
      return;
    }
    this.pickSerial += 1;
    const serial = this.pickSerial;
    void renderer.pick(click.x, click.y).then((hit) => {
      if (serial !== this.pickSerial || this.renderer !== renderer) {
        return;
      }
      // What is clicked is identified where it was clicked, and its row is read for the popover (a click on nothing clears the selection, which ends it).
      if (hit !== null) {
        this.identified = { ...hit, at: { x: click.x, y: click.y } };
      }
      this.store.dispatch({ type: 'setSelection', selection: hit });
      this.readIdentified();
      this.refreshIdentify();
    });
  };

  /**
   * The element that a click identified, and where the map was clicked: what the popover is of. The popover is of it while it is the selection: a selection that
   * is another (a row chosen in the table, a click elsewhere) or none ends it.
   */
  private identified:
    { layerId: string; element: number; at: { x: number; y: number }; page?: Page } | undefined;

  /** Reads the row of the identified element (one row, from the engine's cache if it was read), and tells the popover when it has come. */
  private readIdentified(): void {
    const found = this.identified;
    const engine = this.engine;
    const layer = found === undefined ? undefined : this.store.getState().layers[found.layerId];
    if (found === undefined || engine === undefined || layer === undefined) {
      return;
    }
    const gone = { start: found.element, count: 0, columns: [] };
    engine.rows(layer.datasetId, found.element, 1).then(
      (page) => {
        if (this.identified === found) {
          found.page = page;
          this.refreshIdentify();
          this.moveToPopover(found);
        }
      },
      () => {
        if (this.identified === found) {
          found.page = gone;
          this.refreshIdentify();
          this.moveToPopover(found);
        }
      },
    );
  }

  /**
   * The keyboard goes to the popover when it says what the click found (its name and what it says are then read out by a screen reader, as a dialog's are), but only if it is
   * still where the click put it, on the map: a person who has moved on to something else is not taken from it. It is done once for a click, and not at each change of
   * what the popover says (a pan of the map moves it, and must not take the keyboard).
   */
  private moveToPopover(found: object): void {
    const area = this.renderRoot.querySelector('karmania-map-area');
    if (area === null) {
      return;
    }
    void area.updateComplete.then(async () => {
      const popover = area.renderRoot.querySelector('karmania-identify');
      if (popover === null) {
        return;
      }
      await popover.updateComplete;
      if (this.identified === found && area.shadowRoot?.activeElement === area.focusTarget) {
        popover.takeFocus();
      }
    });
  }

  /** Gives the map area what the popover says now, or nothing when what was identified is not the selection any more (or its layer or dataset is gone). */
  private refreshIdentify(): void {
    const area = this.renderRoot.querySelector('karmania-map-area');
    if (area === null) {
      return;
    }
    const state = this.store.getState();
    const found = this.identified;
    const same =
      found !== undefined &&
      state.selection?.layerId === found.layerId &&
      state.selection.element === found.element;
    const layer = same ? state.layers[found.layerId] : undefined;
    const summary =
      layer === undefined ? undefined : this.datasets.find((each) => each.id === layer.datasetId);
    if (!same || summary === undefined) {
      this.identified = undefined;
      // A popover that has the keyboard is not taken away from under it: the map has it again (its own keys), as when the popover is closed.
      if (area.renderRoot.querySelector('karmania-identify')?.matches(':focus-within') === true) {
        area.focusTarget?.focus();
      }
      area.identify = undefined;
      return;
    }
    area.identifyAt = found.at;
    area.identify = identifyModel(summary, found.element, found.page);
  }

  /**
   * Escape clears the selection (and so ends the popover and the outline) when the keyboard is on the map or on the table: a key of the map or of the table
   * that nothing else has used. The popover's own Escape is taken before it gets here, and a field or a dialog that wants Escape has it first.
   */
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }
    // Where the keyboard is: the map, or the table (the fields of the Legend and the buttons of the panel have their own uses of the key).
    const onMapOrTable = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          (node.localName === 'main' || node.localName === 'k-table'),
      );
    if (onMapOrTable) {
      // (A click that was just made and has not been answered is cleared with the rest.)
      this.overtakePick();
      if (this.store.getState().selection !== null) {
        this.store.dispatch({ type: 'setSelection', selection: null });
      }
    }
  };

  /** "Show in table": the Data tab is shown, with the dataset of the element selected, and the table scrolls to its row, which has the keyboard and the focus. */
  private readonly onIdentifyShow = (event: CustomEvent<IdentifyShow>): void => {
    const { datasetId, element } = event.detail;
    this.selected = datasetId;
    this.changePanel({ tab: 'data', collapsed: false });
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector('karmania-panel')?.showRow(element),
    );
  };

  /**
   * A person selected a row of the table (a click, or Enter or Space): the element of the dataset that is that row is the scene's selection, so that the
   * map outlines it. It has no popover: that is for a click on the map. A dataset that no layer shows has nothing to select.
   */
  private readonly onTableSelect = (event: CustomEvent<TableSelect>): void => {
    const dataset = this.selected;
    const layer = Object.values(this.store.getState().layers).find(
      (each) => each.datasetId === dataset,
    );
    if (layer !== undefined) {
      this.overtakePick();
      this.store.dispatch({
        type: 'setSelection',
        selection: { layerId: layer.id, element: event.detail.row },
      });
    }
  };

  /** The row of the selected dataset that is the scene's selected element: the table tints it. `undefined` when the selection is of another dataset or none. */
  private selectedElementOfDataset(): number | undefined {
    const state = this.store.getState();
    const selection = state.selection;
    if (selection === null || this.selected === undefined) {
      return undefined;
    }
    return state.layers[selection.layerId]?.datasetId === this.selected
      ? selection.element
      : undefined;
  }

  /** The popover is closed with its button (the element stays selected) or with Escape (the selection is cleared too); focus goes back to the map. */
  private readonly onIdentifyClose = (event: CustomEvent<IdentifyClose>): void => {
    this.overtakePick();
    this.identified = undefined;
    if (event.detail.escape) {
      this.store.dispatch({ type: 'setSelection', selection: null });
    }
    this.refreshIdentify();
    this.renderRoot.querySelector('karmania-map-area')?.focusTarget?.focus();
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
    // A viewer that was put in a page and taken out before it first rendered has nothing to watch for: Lit makes the update whether or not the
    // element is still connected, and nothing would disconnect an observer made now.
    if (this.isConnected) {
      this.watchSize();
    }
  }

  /** Says to those who watch whether there is something to export now, after each update (the layers being drawn or not changes it, and it changes the viewer's render). */
  protected override updated(): void {
    const now = this.exportable();
    if (now !== this.exportableNow) {
      this.exportableNow = now;
      for (const listener of [...this.exportableListeners]) {
        listener(now);
      }
    }
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
    this.contours?.dispose();
    this.contours = undefined;
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

  /**
   * Opens the import wizard on `files`, if there are any and the viewer is in a page. The engine belongs to the time it is in one (see `load`), and
   * the wizard of a viewer that was taken out is still in its shadow root, so one made here would never be let go.
   */
  private importFiles(files: readonly File[]): void {
    const wizard = this.renderRoot.querySelector('karmania-import-dialog');
    if (this.isConnected && files.length > 0 && wizard) {
      this.engine ??= createEngine();
      wizard.engine = this.engine;
      wizard.show(files);
    }
  }

  /** Does what a person asked of the panel, and keeps the panel that way. */
  private readonly onPanelChange = (event: CustomEvent<PanelChange>): void => {
    this.changePanel(event.detail);
  };

  /** The contours of a layer were turned on for the first time: they start at the settings that the engine says for its data. */
  private readonly onContoursTurnOn = (event: CustomEvent<ContoursTurnOn>): void => {
    if (this.engine !== undefined) {
      void this.contoursFor(this.engine).turnOn(event.detail.layerId);
    }
  };

  /** What the Legend tab asked of the scene (to switch, move, group, rename or style a layer) is done by the command it gives. */
  private readonly onLegendCommand = (event: CustomEvent<LegendCommand>): void => {
    this.dispatch(event.detail.command);
  };

  /** The map area says nothing can be drawn and sends people to the Legend, which says why for each layer. */
  private readonly onShowLegend = (): void => {
    this.changePanel({ tab: 'legend', collapsed: false });
  };

  /**
   * The north arrow was pressed: north is up, with the centre and the scale as they are. In 3D the heading of the 3D camera is what is turned, and
   * only that: the elevation, the target and the distance are kept (a patch gives what changes and no more).
   */
  private readonly onNorthReset = (): void => {
    this.store.dispatch({
      type: 'setCamera',
      patch:
        this.store.getState().viewMode === '3d'
          ? { camera3d: { heading: 0 } }
          : { camera2d: { heading: 0 } },
    });
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
        this.resetView();
        break;
    }
  };

  /**
   * North up and the data in view. In 2D that is the heading turned to 0 and the data fitted at that heading; in 3D the camera's heading is turned to
   * 0 and its elevation put to `RESET_ELEVATION`, and the data is fitted from there (a fit keeps the heading and the elevation it is given).
   */
  private resetView(): void {
    if (this.store.getState().viewMode === '3d') {
      this.store.dispatch({
        type: 'setCamera',
        patch: { camera3d: { heading: 0, elevation: RESET_ELEVATION } },
      });
    } else {
      this.onNorthReset();
    }
    this.fit();
  }

  /**
   * Changes the scale (in 3D, the distance) by `factor` (less than 1 comes closer) about the middle of the map, as the keys do, and not past the
   * limits.
   */
  private zoomBy(factor: number): void {
    const box = this.renderRoot.querySelector('karmania-map-area')?.canvas?.getBoundingClientRect();
    if (box === undefined) {
      return;
    }
    const size = { width: box.width, height: box.height };
    const state = this.store.getState();
    if (state.viewMode === '3d') {
      const change3d = zoom3dAt(
        state.camera3d,
        size,
        factor,
        size.width / 2,
        size.height / 2,
        this.pipeline?.distanceLimits() ?? DEFAULT_DISTANCE_LIMITS,
      );
      if (change3d !== undefined) {
        this.store.dispatch({ type: 'setCamera', patch: { camera3d: change3d } });
      }
      return;
    }
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
    const before = this.datasets;
    await engine.remove(id);
    this.datasets = engine.datasets();
    syncDatasets(this.store, this.datasets);
    // What is selected is what it is now, and not what it was when the removal was asked for.
    this.selected = selectionAfterRemoved(before, this.datasets, id, this.selected);
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
    const legend = this.currentLegend();
    const styles = this.currentStyles();
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
          .viewMode=${this.store.getState().viewMode}
          .preparing=${layers.preparing}
          .progress=${layers.progress}
          .reasons=${layers.reasons}
          @karmania-show-legend=${this.onShowLegend}
          @karmania-north-reset=${this.onNorthReset}
          @karmania-navigate=${this.onNavigate}
          @karmania-map-crs-request=${this.onMapCrsRequest}
          @karmania-pointer-on-map=${this.onPointer}
          @karmania-map-click=${this.onMapClick}
          @keydown=${this.onEscape}
          @karmania-identify-close=${this.onIdentifyClose}
          @karmania-identify-show=${this.onIdentifyShow}
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
          .legend=${legend}
          .styles=${styles}
          .datasets=${this.datasets}
          .selected=${this.selected}
          .selectedElement=${this.selectedElementOfDataset()}
          .rows=${this.rows}
          .crsInfo=${this.crsInfo}
          .notices=${notices}
          @karmania-import-request=${this.chooseFiles}
          @karmania-legend-command=${this.onLegendCommand}
          @karmania-contours-turn-on=${this.onContoursTurnOn}
          @k-table-select=${this.onTableSelect}
          @keydown=${this.onEscape}
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
      <karmania-export-dialog
        .canLegend=${exportLegendLines(this.currentLegend()).length > 0}
      ></karmania-export-dialog>
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
