import { createEngine } from '@karmania/engine';
import type { Engine, Summary } from '@karmania/engine';
import { DEFAULT_SCALE_LIMITS, attachController2d, createRenderer } from '@karmania/render';
import type { Controller2d, Renderer, RenderStats } from '@karmania/render';
import { createSceneStore } from '@karmania/scene';
import type { Command, SceneDocument } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { carriesFiles } from './drag.js';
import { IMPORT_FILE_ACCEPT } from './import-files.js';
import type { DatasetChoice } from './dataset-list.js';
import { selectionAfterRemoving } from './datasets.js';
import type { CrsLookup, RowSource } from './datasets.js';
import './import-dialog.js';
import type { ImportLoaded } from './import-dialog.js';
import './map-area.js';
import type { DroppedFiles, KarmaniaMapArea } from './map-area.js';
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
    selected: { state: true },
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
  /** The dataset that is selected: the one that was loaded last, until a person chooses another. */
  declare private selected: number | undefined;

  constructor() {
    super();
    this.panel = loadPanelState(browserStorage());
    this.viewportWidth = document.documentElement.clientWidth;
    this.datasets = [];
    this.selected = undefined;
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
    if (area === null || this.renderer !== undefined || this.attaching) {
      return;
    }
    this.attaching = true;
    try {
      await area.updateComplete;
    } finally {
      this.attaching = false;
    }
    const canvas = area.canvas;
    if (canvas !== undefined && this.isConnected) {
      this.renderer = createRenderer(canvas, {
        // The card took the context away, or gave it back: the map area says so while the map is being drawn again.
        onContextLoss: (lost) => {
          area.redrawing = lost;
        },
      });
      this.lookThroughCamera();
      this.controller = this.renderer === undefined ? undefined : this.listenToPerson(area, canvas);
      area.interactive = this.controller !== undefined;
    }
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
      getLimits: () => DEFAULT_SCALE_LIMITS,
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

  /** Called when the scene changes: the first layer is what the renderer is for, and the camera is what it looks through. */
  private readonly onScene = (state: SceneDocument, previous: SceneDocument): void => {
    if (Object.keys(state.layers).length > 0) {
      void this.attachRenderer();
    }
    if (state.camera2d !== previous.camera2d || state.frame !== previous.frame) {
      this.lookThroughCamera();
    }
  };

  /** Stops listening to the scene; set while the viewer is in a page. */
  private unlistenScene: (() => void) | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
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
    this.controller?.dispose();
    this.controller = undefined;
    const area = this.renderRoot.querySelector('karmania-map-area');
    if (area !== null) {
      area.interactive = false;
    }
    this.renderer?.dispose();
    this.renderer = undefined;
    this.engine?.dispose();
    this.engine = undefined;
    // What the engine held is gone with it, so the list of datasets, the selection and the layers are emptied: a viewer
    // that is put back in a page starts again, and does not list datasets that no engine can give rows of.
    this.datasets = [];
    this.selected = undefined;
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
  private readonly onImportLoaded = (event: CustomEvent<ImportLoaded>): void => {
    this.datasets = this.engine?.datasets() ?? [];
    syncDatasets(this.store, this.datasets);
    this.selected = event.detail.summaries[0]?.id;
    this.changePanel({ tab: 'data', collapsed: false });
  };

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
    return html`
      <div
        class="workspace"
        ?data-collapsed=${this.panel.collapsed}
        style=${`--k-panel-width: ${String(width)}px`}
      >
        <karmania-map-area
          .datasets=${this.datasets.length}
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
    `;
  }
}

customElements.define('karmania-viewer', KarmaniaViewer);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-viewer': KarmaniaViewer;
  }
}
