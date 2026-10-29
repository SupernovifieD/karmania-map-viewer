import { sharedStyles } from '@karmania/ui';
import type { TabChange, TabDefinition } from '@karmania/ui';
import { css, html, LitElement } from 'lit';

/** The tabs of the panel, in order. */
export const PANEL_TABS = [
  { id: 'legend', label: 'Legend' },
  { id: 'data', label: 'Data' },
] as const satisfies readonly TabDefinition[];

/** The id of one of the tabs. */
export type PanelTab = (typeof PANEL_TABS)[number]['id'];

/** Whether some text is the id of a tab of the panel. */
export function isPanelTab(id: string): id is PanelTab {
  return PANEL_TABS.some((tab) => tab.id === id);
}

/**
 * The side panel, on the right of the map area: a row of tabs, Legend and Data, and under it the
 * chosen tab's body, which fills the rest of the height and is the only part that scrolls, and only
 * down. The Legend has nothing to show until maps are drawn; the Data tab is filled in from M9.
 */
export class KarmaniaPanel extends LitElement {
  static override properties = {
    tab: { type: String, reflect: true },
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

      k-tabs {
        height: 100%;
      }

      /* The row is as high as a tab. It has 8 at the end, for the button that will be there, and 4
         at the start: a tab has 12 of its own, so that its label starts 16 from the edge, where
         the text of the body does. The line under it is drawn inside the row, so it takes no room. */
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

      .body k-empty-state {
        flex: 1 1 auto;
        min-height: 0;
      }
    `,
  ];

  /** The tab that is chosen. */
  declare tab: PanelTab;

  constructor() {
    super();
    this.tab = 'legend';
  }

  private readonly onTabChange = (event: CustomEvent<TabChange>): void => {
    if (isPanelTab(event.detail.id)) {
      this.tab = event.detail.id;
    }
  };

  override render() {
    return html`
      <aside aria-label="Side panel">
        <k-tabs
          label="Panel tabs"
          .tabs=${PANEL_TABS}
          selected=${this.tab}
          @k-tab-change=${this.onTabChange}
        >
          <div slot="legend" class="body" data-scroll-region>
            <k-empty-state>Layers will appear here once maps are rendered.</k-empty-state>
          </div>
          <div slot="data" class="body" data-scroll-region></div>
        </k-tabs>
      </aside>
    `;
  }
}

customElements.define('karmania-panel', KarmaniaPanel);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-panel': KarmaniaPanel;
  }
}
