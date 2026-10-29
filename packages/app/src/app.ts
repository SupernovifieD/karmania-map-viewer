import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/**
 * The root of the app, `<karmania-app>`. For now it only shows the name; the shell is built
 * around it from step 7.2.
 */
export class KarmaniaApp extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        padding: var(--k-space-24);
      }

      h1 {
        font-size: var(--k-font-size-dialog-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-dialog-title);
        margin: 0;
      }
    `,
  ];

  override render() {
    return html`<h1>Karmania</h1>`;
  }
}

customElements.define('karmania-app', KarmaniaApp);
