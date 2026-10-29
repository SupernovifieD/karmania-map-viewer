import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { carriesFiles } from './drag.js';
import './import-dialog.js';
import './map-area.js';
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
 * It keeps whether the panel is folded away, which tab is chosen and how wide the panel is between
 * visits. The width is limited by the window, and follows it: a panel that was made wide does not
 * stay wider than a narrower window allows, and is as wide as was asked again when the window is.
 */
export class KarmaniaApp extends LitElement {
  static override properties = {
    panel: { state: true },
    viewportWidth: { state: true },
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

  constructor() {
    super();
    this.panel = loadPanelState(browserStorage());
    this.viewportWidth = document.documentElement.clientWidth;
  }

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
  }

  private readonly onWindowResize = (): void => {
    this.viewportWidth = document.documentElement.clientWidth;
  };

  /** Does what a person asked of the panel, and keeps the panel that way. */
  private readonly onPanelChange = (event: CustomEvent<PanelChange>): void => {
    this.panel = { ...this.panel, ...event.detail };
    savePanelState(browserStorage(), this.panel);
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
        ${kButton({ icon: 'upload', children: 'Import' })}
      </header>
      <div
        class="workspace"
        ?data-collapsed=${this.panel.collapsed}
        style=${`--k-panel-width: ${String(width)}px`}
      >
        <karmania-map-area></karmania-map-area>
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
      <karmania-import-dialog></karmania-import-dialog>
    `;
  }
}

customElements.define('karmania-app', KarmaniaApp);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-app': KarmaniaApp;
  }
}
