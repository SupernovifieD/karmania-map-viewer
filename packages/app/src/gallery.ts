/**
 * The gallery: every component of `@karmania/ui` on a page of its own, in every state, so
 * that it can be looked at, tested and photographed without the rest of the app.
 */
import { PACKAGE_NAME } from '@karmania/ui';
import { html, LitElement } from 'lit';

export class KarmaniaGallery extends LitElement {
  override render() {
    return html`
      <h1>Karmania components</h1>
      <p>From ${PACKAGE_NAME}.</p>
    `;
  }
}

customElements.define('karmania-gallery', KarmaniaGallery);
