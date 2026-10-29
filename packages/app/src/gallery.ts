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
import { dialogSection } from './sections/dialog.js';
import { emptyStateSection } from './sections/empty-state.js';
import { fieldsSection } from './sections/fields.js';
import { iconsSection } from './sections/icons.js';
import { stepsSection } from './sections/steps.js';
import { tabsSection } from './sections/tabs.js';
import { tooltipsSection } from './sections/tooltips.js';
import { forceThemeFromAddress } from './theme.js';

forceThemeFromAddress();

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

      /* A row that starts a good way in, so that a tooltip to the left of its button has room. */
      .row.indented {
        padding-left: calc(var(--k-space-48) * 4);
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

      .empty-demo {
        background: var(--k-surface-map);
        border-radius: var(--k-radius-lg);
        height: calc(var(--k-space-48) * 5);
        width: calc(var(--k-space-48) * 7.5);
      }

      .empty-demo.small {
        height: calc(var(--k-space-48) * 3);
        width: calc(var(--k-space-48) * 4);
      }

      .tabs-demo {
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-lg);
        max-width: calc(var(--k-space-48) * 8);
      }

      /* A set height, which the panels of the tabs share out; the row is laid out as in the side
         panel, with a little room at either end. */
      .tall-tabs {
        height: calc(var(--k-space-48) * 5);
      }

      .tall-tabs k-tabs {
        height: 100%;
      }

      .with-action k-tabs::part(header) {
        padding: 0 var(--k-space-8) 0 var(--k-space-4);
      }

      .scroll-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: var(--k-space-16);
      }

      .narrow-tabs {
        width: calc(var(--k-space-48) * 4);
      }

      .tab-content {
        padding: var(--k-space-16);
      }

      /* A text box for the demo, drawn with the tokens: the browser's own has a faint
         boundary in the dark theme, and a control's boundary must be easy to see. */
      input {
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-md);
        color: var(--k-text);
        height: var(--k-control-height);
        padding: 0 var(--k-space-8);
      }

      .row-label {
        flex: none;
        width: calc(var(--k-space-48) + var(--k-space-24));
      }

      .cell {
        display: inline-flex;
      }

      /* Each demo is as tall as its own content, so that its picture does not depend on the others. */
      .fields {
        align-items: flex-start;
        display: flex;
        flex-wrap: wrap;
        gap: var(--k-space-16) var(--k-space-24);
        margin-bottom: var(--k-space-16);
      }

      .field-demo {
        width: calc(var(--k-space-48) * 5);
      }

      .field-demo.narrow-field {
        width: calc(var(--k-space-48) * 3);
      }

      /* As wide as the room inside the wizard's dialog. */
      .steps-demo {
        margin-bottom: var(--k-space-16);
        width: calc(var(--k-dialog-max-size) - var(--k-space-48));
      }

      .steps-demo.narrow {
        width: calc(var(--k-space-48) * 6);
      }

      .narrow {
        width: calc(var(--k-space-48) * 4);
      }

      .grid {
        display: grid;
        gap: var(--k-space-16) var(--k-space-24);
        grid-template-columns: repeat(auto-fill, minmax(calc(var(--k-space-48) * 2), 1fr));
        list-style: none;
        margin: 0 0 var(--k-space-16);
        padding: 0;
      }

      .grid li {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-4);
        min-width: 0;
      }

      .icon-pair {
        align-items: center;
        display: flex;
        gap: var(--k-space-8);
      }

      .grid code {
        overflow-wrap: anywhere;
      }
    `,
  ];

  override render() {
    return html`
      <h1>Karmania components</h1>
      <p>From ${PACKAGE_NAME}.</p>
      ${iconsSection()} ${buttonsSection()} ${tabsSection()} ${tooltipsSection()}
      ${emptyStateSection()} ${fieldsSection()} ${stepsSection()} ${dialogSection()}
    `;
  }
}

customElements.define('karmania-gallery', KarmaniaGallery);
