import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import './map-area.js';
import './panel.js';

/**
 * The root of the app, `<karmania-app>`: the toolbar across the top, and under it the map area
 * and the side panel, side by side. It fills the window and never scrolls.
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

      .toolbar {
        border-bottom: var(--k-border-width) solid var(--k-border);
        min-width: 0;
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

  override render() {
    return html`
      <header class="toolbar"></header>
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
