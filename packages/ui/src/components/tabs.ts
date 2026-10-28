import { css, html, LitElement } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';

/** One tab: what it is called in code, and what it says. */
export interface TabDefinition {
  /** Names the tab, and the slot its panel goes in. Different for every tab. */
  readonly id: string;
  readonly label: string;
}

/** What `k-tab-change` carries: the tab that was chosen. */
export interface TabChange {
  readonly id: string;
}

/** The name of the event sent when a person chooses a tab. */
export const TAB_CHANGE = 'k-tab-change';

/**
 * Tabs: a row of tabs and the panels they show, following the WAI-ARIA tabs pattern.
 *
 * ```html
 * <k-tabs label="Side panel" selected="data">
 *   <div slot="legend">…</div>
 *   <div slot="data">…</div>
 * </k-tabs>
 * ```
 *
 * with `tabs` set to `[{ id: 'legend', label: 'Legend' }, { id: 'data', label: 'Data' }]`.
 * The panels stay in the page while hidden, so what is in them keeps its state.
 *
 * Left and Right move between the tabs (and choose each as they go, wrapping round at the
 * ends), Home and End go to the first and last, and only the chosen tab is in the Tab order,
 * so Tab goes into the row once and out of it once. A person choosing a tab changes
 * `selected` and sends `k-tab-change`.
 */
export class KTabs extends LitElement {
  static override properties = {
    tabs: { attribute: false },
    selected: { type: String, reflect: true },
    label: { type: String },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .tablist {
        display: flex;
        gap: var(--k-space-4);
        min-width: 0;
      }

      .tab {
        background: transparent;
        border: 0;
        border-radius: 0;
        color: var(--k-text-muted);
        cursor: pointer;
        flex: 0 1 auto;
        font-weight: var(--k-weight-medium);
        height: var(--k-tab-height);
        line-height: var(--k-line-height-body);
        min-width: 0;
        overflow: hidden;
        padding: 0 var(--k-space-12);
        text-overflow: ellipsis;
        transition: color var(--k-motion-duration) var(--k-motion-easing);
        white-space: nowrap;
      }

      .tab:hover {
        color: var(--k-text);
      }

      /* The chosen tab is underlined as well as darker, so it is not marked by color alone.
         The underline is inside the tab, so choosing a tab moves nothing. */
      .tab[aria-selected='true'] {
        box-shadow: inset 0 calc(var(--k-border-width) * -2) 0 var(--k-accent);
        color: var(--k-text);
      }

      /* The focus ring goes inside the tab, where nothing around it can clip it. */
      .tab:focus-visible {
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      [role='tabpanel'][hidden] {
        display: none;
      }
    `,
  ];

  /** The tabs, in order. */
  declare tabs: readonly TabDefinition[];
  /** The `id` of the chosen tab. Anything that is not a tab's id means the first tab. */
  declare selected: string | undefined;
  /** What the row of tabs is called, for people who cannot see it: "Side panel". */
  declare label: string | undefined;

  constructor() {
    super();
    this.tabs = [];
    this.selected = undefined;
    this.label = undefined;
  }

  /** The id of the chosen tab: `selected`, or the first tab if that is not one. */
  private get current(): string | undefined {
    return (this.tabs.find((tab) => tab.id === this.selected) ?? this.tabs[0])?.id;
  }

  protected override willUpdate(): void {
    const ids = this.tabs.map((tab) => tab.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(
        `The tabs of a k-tabs must each have a different id, but they are: ${ids.join(', ')}.`,
      );
    }
    if (this.label === undefined || this.label.trim() === '') {
      throw new Error('A k-tabs needs a label, so that its row of tabs has a name.');
    }
  }

  private choose(id: string, focus: boolean): void {
    if (focus) {
      this.renderRoot
        .querySelector<HTMLElement>(`[role='tab'][data-id='${CSS.escape(id)}']`)
        ?.focus();
    }
    if (id === this.current) {
      return;
    }
    this.selected = id;
    this.dispatchEvent(
      new CustomEvent<TabChange>(TAB_CHANGE, { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private onKeyDown(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const tab = target === undefined ? undefined : this.tabs[target];
    if (tab !== undefined) {
      event.preventDefault();
      this.choose(tab.id, true);
    }
  }

  override render() {
    const current = this.current;
    return html`
      <div class="tablist" role="tablist" aria-label=${this.label ?? ''}>
        ${this.tabs.map(
          (tab, index) => html`
            <button
              type="button"
              class="tab"
              data-truncate
              role="tab"
              id=${`tab-${tab.id}`}
              data-id=${tab.id}
              title=${tab.label}
              aria-selected=${tab.id === current ? 'true' : 'false'}
              aria-controls=${`panel-${tab.id}`}
              tabindex=${tab.id === current ? '0' : '-1'}
              @click=${() => {
                this.choose(tab.id, false);
              }}
              @keydown=${(event: KeyboardEvent) => {
                this.onKeyDown(event, index);
              }}
            >
              ${tab.label}
            </button>
          `,
        )}
      </div>
      ${this.tabs.map(
        (tab) => html`
          <div
            role="tabpanel"
            id=${`panel-${tab.id}`}
            aria-labelledby=${`tab-${tab.id}`}
            ?hidden=${tab.id !== current}
          >
            <slot name=${tab.id}></slot>
          </div>
        `,
      )}
    `;
  }
}

defineOnce('k-tabs', KTabs);

declare global {
  interface HTMLElementTagNameMap {
    'k-tabs': KTabs;
  }

  interface HTMLElementEventMap {
    [TAB_CHANGE]: CustomEvent<TabChange>;
  }
}
