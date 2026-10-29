import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/**
 * The map area. Nothing is drawn in phase 1; this is the place where the map will go, and
 * where files can be dropped.
 */
export class KarmaniaMapArea extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--k-surface-map);
        display: block;
        min-height: 0;
        min-width: 0;
      }

      main {
        height: 100%;
        position: relative;
      }
    `,
  ];

  override render() {
    return html`<main></main>`;
  }
}

customElements.define('karmania-map-area', KarmaniaMapArea);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-map-area': KarmaniaMapArea;
  }
}
