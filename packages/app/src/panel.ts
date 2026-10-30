import type { Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import type { TabChange } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import './data-tab.js';
import type { RowSource } from './datasets.js';
import { PANEL_TABS } from './panel-tabs.js';
import type { PanelTab } from './panel-tabs.js';
import './resize-handle.js';

/** What a person asked of the panel: to fold it away or open it, or to choose a tab. */
export interface PanelChange {
  readonly collapsed?: boolean;
  readonly tab?: PanelTab;
}

/** The name of the event the panel sends when a person asks something of it. */
export const PANEL_CHANGE = 'karmania-panel-change';

/** What to put the keyboard on once the panel has changed: a button, or the chosen tab. */
type FocusTarget = 'collapse' | 'expand' | 'tab';

/**
 * The side panel, on the right of the map area. Open, it is a row of tabs, Legend and Data, with a
 * button at its end that folds the panel away, and under it the chosen tab's body, which fills the
 * rest of the height and is the only part that scrolls, and only down. Folded away, it is a rail of
 * buttons: one that opens it again, and one for each tab that opens it on that tab.
 *
 * The panel does not decide what it looks like; it shows `collapsed` and `tab`, and when a person
 * asks for something else it says so (`karmania-panel-change`) and waits to be told. When the
 * change moves the buttons, the keyboard goes where the button went: to the button that now stands
 * for the one that was pressed, or to the chosen tab.
 */
export class KarmaniaPanel extends LitElement {
  static override properties = {
    tab: { type: String, reflect: true },
    collapsed: { type: Boolean, reflect: true },
    datasets: { attribute: false },
    selected: { attribute: false },
    rows: { attribute: false },
    width: { type: Number },
    min: { type: Number },
    max: { type: Number },
    reset: { type: Number },
  };

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

      /* Over the edge of the panel, a strip centred on it, the whole height of the panel. The panel's
         own line is outside the aside, so the strip starts that far further out. */
      karmania-resize-handle {
        bottom: 0;
        left: calc(var(--k-resize-hit-width) / -2 - var(--k-border-width));
        position: absolute;
        top: 0;
        width: var(--k-resize-hit-width);
        z-index: var(--k-z-sticky);
      }

      .open {
        height: 100%;
      }

      .open[hidden],
      .rail[hidden] {
        display: none;
      }

      k-tabs {
        height: 100%;
      }

      /* The row is as high as a tab. It has 8 at the end, round the button, and 4 at the start:
         a tab has 12 of its own, so that its label starts 16 from the edge, where the text of the
         body does. The line under it is drawn inside the row, so it takes no room. */
      k-tabs::part(header) {
        box-shadow: inset 0 calc(var(--k-border-width) * -1) 0 var(--k-border);
        padding: 0 var(--k-space-8) 0 var(--k-space-4);
      }

      /* Only this scrolls, and only down: what is in it has to fit across. */
      .body {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        overflow: hidden auto;
        padding: var(--k-space-16);
      }

      /* The Data tab keeps its own padding, since its table goes the whole width of the panel. */
      .body.flush {
        padding: 0;
      }

      .body k-empty-state {
        flex: 1 1 auto;
        min-height: 0;
      }

      /* Buttons stacked from the top, 8 from the top and 4 apart. At the sides there are 4 from the
         edge of the panel, which is 1 more than the room beside the border on the left. (Their
         tooltips go to the left, over the map: above or below, one would cover the next button.) */
      .rail {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-4);
        padding: var(--k-space-8) var(--k-space-4) var(--k-space-8)
          calc(var(--k-space-4) - var(--k-border-width));
      }
    `,
  ];

  /** The tab that is chosen. */
  declare tab: PanelTab;
  /** Whether the panel is folded away into its rail. */
  declare collapsed: boolean;
  /** The datasets that are loaded, which the Data tab shows. */
  declare datasets: readonly Summary[];
  /** The `id` of the dataset that is selected. */
  declare selected: number | undefined;
  /** Gets the rows of a dataset, for the table of the Data tab. */
  declare rows: RowSource | undefined;
  /** How wide the panel is, and the least and most it can be, and the width it goes back to. */
  declare width: number;
  declare min: number;
  declare max: number;
  declare reset: number;

  private pendingFocus: FocusTarget | undefined;

  constructor() {
    super();
    this.tab = 'legend';
    this.collapsed = false;
    this.datasets = [];
    this.selected = undefined;
    this.rows = undefined;
    this.width = 0;
    this.min = 0;
    this.max = 0;
    this.reset = 0;
    this.pendingFocus = undefined;
  }

  /** Asks for a change, and for the keyboard to be put somewhere once it has been made. */
  private ask(change: PanelChange, focus: FocusTarget): void {
    this.pendingFocus = focus;
    this.dispatchEvent(
      new CustomEvent<PanelChange>(PANEL_CHANGE, { detail: change, bubbles: true, composed: true }),
    );
  }

  private readonly onTabChange = (event: CustomEvent<TabChange>): void => {
    const tab = PANEL_TABS.find((known) => known.id === event.detail.id);
    if (tab !== undefined) {
      this.dispatchEvent(
        new CustomEvent<PanelChange>(PANEL_CHANGE, {
          detail: { tab: tab.id },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  protected override updated(changed: PropertyValues<this>): void {
    const target = this.pendingFocus;
    if (target !== undefined && changed.has('collapsed')) {
      this.pendingFocus = undefined;
      void this.focusOn(target);
    }
  }

  /** Puts the keyboard on a button, or on the chosen tab, once what is there has been drawn. */
  private async focusOn(target: FocusTarget): Promise<void> {
    if (target === 'tab') {
      const tabs = this.renderRoot.querySelector('k-tabs');
      await tabs?.updateComplete;
      tabs?.focus();
      return;
    }
    // The first button of the rail is the one that opens the panel; the first of the open panel,
    // the one that folds it away.
    const button = this.renderRoot.querySelector<HTMLElementTagNameMap['k-button']>(
      target === 'expand' ? '.rail k-button' : '.open k-button',
    );
    await button?.updateComplete;
    button?.focus();
  }

  override render() {
    return html`
      <aside aria-label="Side panel">
        ${
          this.collapsed
            ? nothing
            : html`<karmania-resize-handle
                .value=${this.width}
                .min=${this.min}
                .max=${this.max}
                .reset=${this.reset}
              ></karmania-resize-handle>`
        }
        <div class="open" ?hidden=${this.collapsed}>
          <k-tabs
            label="Panel tabs"
            .tabs=${PANEL_TABS}
            selected=${this.tab}
            @k-tab-change=${this.onTabChange}
          >
            <k-tooltip slot="actions" text="Collapse panel">
              ${kButton({
                icon: 'chevrons-right',
                label: 'Collapse panel',
                variant: 'ghost',
                expanded: true,
                onClick: () => {
                  this.ask({ collapsed: true }, 'expand');
                },
              })}
            </k-tooltip>
            <div slot="legend" class="body" data-scroll-region>
              <k-empty-state>Layers will appear here once maps are rendered.</k-empty-state>
            </div>
            <div slot="data" class="body flush" data-scroll-region>
              <karmania-data-tab
                .datasets=${this.datasets}
                .selected=${this.selected}
                .rows=${this.rows}
              ></karmania-data-tab>
            </div>
          </k-tabs>
        </div>
        <div class="rail" ?hidden=${!this.collapsed}>
          <k-tooltip text="Expand panel" placement="left">
            ${kButton({
              icon: 'chevrons-left',
              label: 'Expand panel',
              variant: 'ghost',
              expanded: false,
              onClick: () => {
                this.ask({ collapsed: false }, 'collapse');
              },
            })}
          </k-tooltip>
          <k-tooltip text="Legend" placement="left">
            ${kButton({
              icon: 'layers',
              label: 'Legend',
              variant: 'ghost',
              expanded: false,
              onClick: () => {
                this.ask({ collapsed: false, tab: 'legend' }, 'tab');
              },
            })}
          </k-tooltip>
          <k-tooltip text="Data" placement="left">
            ${kButton({
              icon: 'table',
              label: 'Data',
              variant: 'ghost',
              expanded: false,
              onClick: () => {
                this.ask({ collapsed: false, tab: 'data' }, 'tab');
              },
            })}
          </k-tooltip>
        </div>
      </aside>
    `;
  }
}

customElements.define('karmania-panel', KarmaniaPanel);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-panel': KarmaniaPanel;
  }

  interface HTMLElementEventMap {
    [PANEL_CHANGE]: CustomEvent<PanelChange>;
  }
}
