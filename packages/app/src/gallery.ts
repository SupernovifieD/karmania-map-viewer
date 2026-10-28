/**
 * The gallery: every component of `@karmania/ui` on a page of its own, in every state, so
 * that it can be looked at, tested and photographed without the rest of the app.
 *
 * `?theme=light` or `?theme=dark` forces a theme, as the app's own setting will.
 */
import '@karmania/ui/tokens.css';
import '@karmania/ui/base.css';
import { PACKAGE_NAME, sharedStyles } from '@karmania/ui';
import { css, html, LitElement } from 'lit';
import { buttonsSection } from './sections/buttons.js';
import { iconsSection } from './sections/icons.js';
import { tabsSection } from './sections/tabs.js';
import { tooltipsSection } from './sections/tooltips.js';

const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'light' || theme === 'dark') {
  document.documentElement.dataset['theme'] = theme;
}

export class KarmaniaGallery extends LitElement {
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
        margin: 0 0 var(--k-space-8);
      }

      h2 {
        font-size: var(--k-font-size-section-title);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-section-title);
        margin: var(--k-space-24) 0 var(--k-space-8);
      }

      p {
        margin: 0 0 var(--k-space-8);
      }

      code {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-caption);
        line-height: var(--k-line-height-caption);
      }

      h3 {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin: var(--k-space-16) 0 var(--k-space-8);
      }

      .row {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: var(--k-space-16);
        margin-bottom: var(--k-space-8);
      }

      /* A box that clips its content and has a transform, which would cut off an ordinary
         tooltip and also makes it the containing block of fixed-position children. */
      .clipping-box {
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-md);
        display: inline-flex;
        overflow: hidden;
        padding: var(--k-space-4);
        transform: translateZ(0);
      }

      .tabs-demo {
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-lg);
        max-width: calc(var(--k-space-48) * 8);
      }

      .narrow-tabs {
        width: calc(var(--k-space-48) * 4);
      }

      .tab-content {
        padding: var(--k-space-16);
      }

      .row-label {
        flex: none;
        width: calc(var(--k-space-48) + var(--k-space-24));
      }

      .cell {
        display: inline-flex;
      }

      .narrow {
        width: calc(var(--k-space-48) * 4);
      }

      .grid {
        display: grid;
        gap: var(--k-space-16) var(--k-space-24);
        grid-template-columns: repeat(auto-fill, minmax(var(--k-space-48), 1fr));
        list-style: none;
        margin: 0;
        padding: 0;
      }
    `,
  ];

  override render() {
    return html`
      <h1>Karmania components</h1>
      <p>From ${PACKAGE_NAME}.</p>
      ${iconsSection()} ${buttonsSection()} ${tabsSection()} ${tooltipsSection()}
    `;
  }
}

customElements.define('karmania-gallery', KarmaniaGallery);
