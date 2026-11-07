import type { Summary } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { describeWarnings, warningCount } from './datasets.js';
import { describeSize, formatCount, KIND_ICONS } from './import-files.js';

/** The name of the event the list sends when a person chooses a dataset. */
export const DATASET_SELECT = 'karmania-dataset-select';

/** The name of the event the list sends when a person has confirmed removing a dataset. */
export const DATASET_REMOVE = 'karmania-dataset-remove';

/** Which dataset a person chose, or asked to remove. */
export interface DatasetChoice {
  readonly id: number;
}

/**
 * The loaded datasets, one to a row of 40: the icon of its kind, its name (cut with an ellipsis if
 * long), how many elements it has, a badge with the number of warnings if there are any, and a button
 * that removes it. The button is only seen while the row is pointed at or has the keyboard, but its
 * room is always kept, so that nothing moves when it appears, and so is the badge's. Choosing a row
 * selects its dataset, which says so by more than a colour: a bar at its edge, a tint and bold type.
 * Removing asks first, in a dialog that says what will be removed and that the file is left alone.
 *
 * The list does not choose or remove anything itself: it says what a person did (`karmania-dataset-select`,
 * `karmania-dataset-remove`) and shows what it is given.
 */
export class KarmaniaDatasetList extends LitElement {
  static override properties = {
    datasets: { attribute: false },
    selected: { attribute: false },
    removing: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      /* Five rows show; more scroll inside the list, so that the table under it keeps its room. */
      ul {
        list-style: none;
        margin: 0;
        max-height: calc(var(--k-list-row-height) * 5);
        overflow: hidden auto;
        padding: 0;
      }

      li {
        align-items: center;
        border-bottom: var(--k-border-width) solid var(--k-border);
        display: grid;
        gap: 0 var(--k-space-8);
        grid-template-columns: minmax(0, 1fr) var(--k-hit-target);
        height: var(--k-list-row-height);
        position: relative;
      }

      li:hover,
      li[data-selected] {
        background: var(--k-surface-raised);
      }

      /* The selected row has a bar at its left edge, over its border, drawn inside the row. */
      li[data-selected]::before {
        background: var(--k-accent);
        bottom: 0;
        content: '';
        left: 0;
        position: absolute;
        top: 0;
        width: calc(var(--k-border-width) * 3);
      }

      /* The whole of the row but the remove button chooses it. */
      .choose {
        align-items: center;
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        display: grid;
        gap: var(--k-space-8);
        grid-template-columns: var(--k-icon-size-sm) minmax(0, 1fr) auto var(--k-space-48);
        height: 100%;
        padding: 0 0 0 var(--k-space-16);
        text-align: left;
      }

      li[data-selected] .name {
        font-weight: var(--k-weight-medium);
      }

      .icon {
        color: var(--k-text-muted);
      }

      .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .count {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }

      /* A badge's room is there whether or not there is a badge, so the counts line up. */
      .badge {
        align-items: center;
        color: var(--k-warning);
        display: flex;
        font-size: var(--k-font-size-caption);
        font-variant-numeric: tabular-nums;
        gap: var(--k-space-2);
        justify-content: flex-end;
        line-height: var(--k-line-height-caption);
      }

      /* Seen when the row is pointed at or has the keyboard; the room is always kept. */
      .remove {
        opacity: 0;
        transition: opacity var(--k-motion-duration) var(--k-motion-easing);
      }

      li:hover .remove,
      li:focus-within .remove,
      li[data-selected] .remove {
        opacity: 1;
      }

      /* Where there is no pointer to point with, it is always there. */
      @media (hover: none) {
        .remove {
          opacity: 1;
        }
      }

      .confirm p {
        margin: 0;
        overflow-wrap: anywhere;
      }

      .confirm .detail {
        color: var(--k-text-muted);
        margin-top: var(--k-space-8);
      }
    `,
  ];

  /** The datasets, in the order they were loaded. */
  declare datasets: readonly Summary[];
  /** The `id` of the one that is selected. */
  declare selected: number | undefined;
  /** The dataset a person has asked to remove and has not yet been asked to confirm, if any. */
  declare private removing: Summary | undefined;
  /** Where in the list the row that was removed was, until the keyboard has been put on another. */
  private removedAt: number | undefined;

  constructor() {
    super();
    this.datasets = [];
    this.selected = undefined;
    this.removing = undefined;
  }

  /** Keeps the selected row in sight when the selection changes. */
  protected override updated(changed: PropertyValues<this>): void {
    // A dataset was removed: the keyboard goes to the row that took its place, or the last one.
    if (changed.has('datasets') && this.removedAt !== undefined) {
      const rows = this.renderRoot.querySelectorAll<HTMLButtonElement>('.choose');
      rows[Math.min(this.removedAt, rows.length - 1)]?.focus();
      this.removedAt = undefined;
    }
    if (changed.has('selected')) {
      this.renderRoot.querySelector('li[data-selected]')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private tell(name: string, id: number): void {
    this.dispatchEvent(
      new CustomEvent<DatasetChoice>(name, { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private readonly onConfirm = (): void => {
    const removing = this.removing;
    this.removing = undefined;
    if (removing !== undefined) {
      this.removedAt = this.datasets.findIndex((dataset) => dataset.id === removing.id);
      this.tell(DATASET_REMOVE, removing.id);
    }
  };

  private readonly onKeep = (): void => {
    this.removing = undefined;
  };

  private row(dataset: Summary) {
    const warnings = warningCount(dataset);
    const selected = dataset.id === this.selected;
    const noun = describeSize(dataset).replace(/^[\d,]+ /, '');
    return html`
      <li data-dataset=${dataset.name} data-id=${String(dataset.id)} ?data-selected=${selected}>
        <button
          type="button"
          class="choose"
          aria-current=${selected ? 'true' : nothing}
          @click=${() => {
            this.tell(DATASET_SELECT, dataset.id);
          }}
        >
          <k-icon class="icon" name=${KIND_ICONS[dataset.kind]} size="16"></k-icon>
          <span class="name" data-truncate title=${dataset.name}>${dataset.name}</span>
          <span class="count">${formatCount(dataset.elementCount)}</span>
          <span
            class="badge"
            aria-hidden="true"
            title=${warnings > 0 ? describeWarnings(warnings) : ''}
          >
            ${
              warnings > 0
                ? html`<k-icon name="triangle-alert" size="16"></k-icon>${String(warnings)}`
                : nothing
            }
          </span>
          <!-- What the numbers count, and what the badge is, for those who cannot see them. -->
          <span class="visually-hidden"
            >${noun}${warnings > 0 ? `, ${describeWarnings(warnings)}` : ''}</span
          >
        </button>
        <span class="remove">
          ${kButton({
            icon: 'trash-2',
            label: `Remove ${dataset.name}`,
            variant: 'ghost',
            onClick: () => {
              this.removing = dataset;
            },
          })}
        </span>
      </li>
    `;
  }

  override render() {
    const removing = this.removing;
    return html`
      <ul aria-label="Datasets" data-scroll-region>
        ${this.datasets.map((dataset) => this.row(dataset))}
      </ul>
      <k-dialog
        heading="Remove dataset?"
        .open=${removing !== undefined}
        @k-dialog-close=${this.onKeep}
      >
        ${
          removing === undefined
            ? nothing
            : html`<div class="confirm">
                <p>
                  <strong>${removing.name}</strong> (${describeSize(removing)}) will be removed.
                </p>
                <p class="detail">The file it came from is not changed.</p>
              </div>`
        }
        <k-button slot="footer-start" variant="ghost" @click=${this.onKeep}>Keep it</k-button>
        <k-button slot="footer-end" variant="primary" @click=${this.onConfirm}>Remove</k-button>
      </k-dialog>
    `;
  }
}

customElements.define('karmania-dataset-list', KarmaniaDatasetList);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-dataset-list': KarmaniaDatasetList;
  }

  interface HTMLElementEventMap {
    [DATASET_SELECT]: CustomEvent<DatasetChoice>;
    [DATASET_REMOVE]: CustomEvent<DatasetChoice>;
  }
}
