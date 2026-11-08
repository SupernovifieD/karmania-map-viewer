import { kButton, sharedStyles } from '@karmania/ui';
import type { IconName } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/** The name of the event the navigation group sends when one of its buttons is pressed. */
export const NAVIGATE = 'karmania-navigate';

/** What the four buttons ask for: a closer view, a farther one, the data in view, and the first view of it with north up. */
export type NavAction = 'zoom-in' | 'zoom-out' | 'fit' | 'reset';

/** What `karmania-navigate` carries. */
export interface Navigate {
  readonly action: NavAction;
}

/** A button of the group: what it asks for, its name, its icon, and the tooltip, which says the key that does the same (section 10.2 of the brief). */
const BUTTONS: readonly {
  readonly action: NavAction;
  readonly label: string;
  readonly icon: IconName;
  readonly tip: string;
}[] = [
  { action: 'zoom-in', label: 'Zoom in', icon: 'plus', tip: 'Zoom in (+)' },
  { action: 'zoom-out', label: 'Zoom out', icon: 'minus', tip: 'Zoom out (−)' },
  { action: 'fit', label: 'Fit to data', icon: 'maximize', tip: 'Fit to data (Home)' },
  {
    action: 'reset',
    label: 'Reset view',
    icon: 'rotate-ccw',
    tip: 'Reset view: north up, data fitted',
  },
];

/**
 * The navigation group of the map (section 10.2 of the brief): four buttons of 32 by 32 in a column, 4 apart, in a raised box with 4 of
 * padding: zoom in, zoom out, fit to data and reset view. Each sends `karmania-navigate` with what it asks for, and what the camera does
 * is the viewer's. Their tooltips say the keys that do the same, and a screen reader is given the tooltip as a description.
 */
export class KarmaniaNavGroup extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .group {
        background: var(--k-surface-raised);
        border: var(--k-border-width) solid var(--k-border);
        border-radius: var(--k-radius-lg);
        display: flex;
        flex-direction: column;
        gap: var(--k-space-4);
        padding: var(--k-space-4);
      }
    `,
  ];

  private readonly press = (action: NavAction) => (): void => {
    this.dispatchEvent(
      new CustomEvent<Navigate>(NAVIGATE, { detail: { action }, bubbles: true, composed: true }),
    );
  };

  override render() {
    return html`
      <div class="group" role="group" aria-label="Map navigation">
        ${BUTTONS.map(
          (button) => html`
            <k-tooltip text=${button.tip} placement="left">
              ${kButton({
                icon: button.icon,
                label: button.label,
                onClick: this.press(button.action),
              })}
            </k-tooltip>
          `,
        )}
      </div>
    `;
  }
}

customElements.define('karmania-nav-group', KarmaniaNavGroup);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-nav-group': KarmaniaNavGroup;
  }

  interface HTMLElementEventMap {
    [NAVIGATE]: CustomEvent<Navigate>;
  }
}
