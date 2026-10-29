import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { carriesFiles } from './drag.js';
import './map-area.js';
import './panel.js';

/**
 * The root of the app, `<karmania-app>`: the toolbar across the top (the name, and the Import
 * button), and under it the map area and the side panel, side by side. It fills the window and
 * never scrolls.
 */
export class KarmaniaApp extends LitElement {
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

      /* The map takes what the panel leaves. The panel's width is --k-panel-width, which
         the app sets once the panel can be resized. */
      .workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--k-panel-width, var(--k-panel-width-default));
        min-height: 0;
        min-width: 0;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('dragover', this.refuseStrayFiles);
    window.addEventListener('drop', this.refuseStrayFiles);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('dragover', this.refuseStrayFiles);
    window.removeEventListener('drop', this.refuseStrayFiles);
  }

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
    return html`
      <header class="toolbar">
        <h1 class="wordmark">Karmania</h1>
        ${kButton({ icon: 'upload', children: 'Import' })}
      </header>
      <div class="workspace">
        <karmania-map-area></karmania-map-area>
        <karmania-panel></karmania-panel>
      </div>
    `;
  }
}

customElements.define('karmania-app', KarmaniaApp);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-app': KarmaniaApp;
  }
}
