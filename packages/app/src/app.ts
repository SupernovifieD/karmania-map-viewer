import { createEngine } from '@karmania/engine';
import type { Engine, Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { carriesFiles } from './drag.js';
import { IMPORT_FILE_ACCEPT } from './import-files.js';
import './import-dialog.js';
import type { ImportLoaded } from './import-dialog.js';
import './map-area.js';
import type { DroppedFiles } from './map-area.js';
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
import './resize-handle.js';
import type { ResizeRequest } from './resize-handle.js';

/**
 * The root of the app, `<karmania-app>`: the toolbar across the top (the name, and the Import
 * button), and under it the map area and the side panel, side by side. It fills the window and
 * never scrolls.
 *
 * Files come in by the Import buttons (the toolbar's, and the map area's), which open the browser's
 * file picker, and by being dropped on the map area. Either way the import wizard opens with them.
 *
 * It keeps whether the panel is folded away, which tab is chosen and how wide the panel is between
 * visits. The width is limited by the window, and follows it: a panel that was made wide does not
 * stay wider than a narrower window allows, and is as wide as was asked again when the window is.
 */
export class KarmaniaApp extends LitElement {
  static override properties = {
    panel: { state: true },
    viewportWidth: { state: true },
    datasets: { state: true },
    selected: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--k-surface);
        display: grid;
        grid-template-rows: var(--k-toolbar-height) minmax(0, 1fr);
        height: 100dvh;
        overflow: hidden;
        width: 100%;
      }

      /* The border takes a pixel at the bottom; the same above keeps the contents on the middle
         of the 48, on whole pixels. */
      .toolbar {
        align-items: center;
        border-bottom: var(--k-border-width) solid var(--k-border);
        display: flex;
        gap: var(--k-space-16);
        min-width: 0;
        padding: var(--k-border-width) var(--k-space-16) 0;
      }

      .wordmark {
        flex: none;
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
        margin: 0;
      }

      /* The map takes what the panel leaves. The panel's width is --k-panel-width, which the app
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

      /* Over the edge of the panel, a strip centred on it, the whole height of the workspace. */
      karmania-resize-handle {
        bottom: 0;
        position: absolute;
        right: calc(var(--k-panel-width) - var(--k-resize-hit-width) / 2);
        top: 0;
        width: var(--k-resize-hit-width);
        z-index: var(--k-z-sticky);
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

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('dragover', this.refuseStrayFiles);
    window.addEventListener('drop', this.refuseStrayFiles);
    window.addEventListener('resize', this.onWindowResize);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('dragover', this.refuseStrayFiles);
    window.removeEventListener('drop', this.refuseStrayFiles);
    window.removeEventListener('resize', this.onWindowResize);
    this.engine?.dispose();
    this.engine = undefined;
  }

  private readonly onWindowResize = (): void => {
    this.viewportWidth = document.documentElement.clientWidth;
  };

  /** Opens the file picker, which is an input that is not shown. */
  private readonly chooseFiles = (): void => {
    this.renderRoot.querySelector('input')?.click();
  };

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
   * in place of the app, so what nobody has taken is taken here, and the pointer says no.
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
      <header class="toolbar">
        <h1 class="wordmark">Karmania</h1>
        ${kButton({ icon: 'upload', children: 'Import', onClick: this.chooseFiles })}
      </header>
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
        ${
          this.panel.collapsed
            ? nothing
            : html`<karmania-resize-handle
                .value=${width}
                .min=${limits.min}
                .max=${limits.max}
                .reset=${PANEL_WIDTH.default}
                @karmania-resize=${this.onResize}
              ></karmania-resize-handle>`
        }
        <karmania-panel
          .collapsed=${this.panel.collapsed}
          .tab=${this.panel.tab}
          @karmania-panel-change=${this.onPanelChange}
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

customElements.define('karmania-app', KarmaniaApp);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-app': KarmaniaApp;
  }
}
