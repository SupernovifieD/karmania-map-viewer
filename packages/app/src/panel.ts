import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/** The side panel, on the right of the map area. */
export class KarmaniaPanel extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--k-surface);
        border-left: var(--k-border-width) solid var(--k-border);
        display: block;
        min-height: 0;
        min-width: 0;
      }

      aside {
        height: 100%;
        position: relative;
      }
    `,
  ];

  override render() {
    return html`<aside aria-label="Side panel"></aside>`;
  }
}

customElements.define('karmania-panel', KarmaniaPanel);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-panel': KarmaniaPanel;
  }
}
