import type { Summary } from '@karmania/engine';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { crsLabel, describeWarnings, extentRows } from './datasets.js';
import './findings.js';
import { groupFindings } from './import-run.js';
import { describeSize, formatCount, KIND_NAMES } from './import-files.js';
import { TYPE_NAMES } from './import-mapping.js';

/**
 * What a person wants to know about the dataset that is selected, in the Data tab: what kind it is
 * and how much there is of it, the coordinate system (the code as given, or a local grid with its
 * units), whether it has heights, the box round it, and, to be opened, its columns and the warnings
 * and notes the import left about it. The two lists are closed to begin with: they can be long, and
 * the table under them is what the tab is for.
 */
export class KarmaniaDatasetSummary extends LitElement {
  static override properties = {
    summary: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      dl {
        display: grid;
        gap: 0 var(--k-space-12);
        grid-template-columns: auto minmax(0, 1fr);
        margin: 0;
        padding: var(--k-space-8) var(--k-space-16);
      }

      dt {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }

      dd {
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        line-height: var(--k-line-height-secondary);
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      details {
        border-top: var(--k-border-width) solid var(--k-border);
      }

      summary {
        align-items: center;
        cursor: pointer;
        display: flex;
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        gap: var(--k-space-8);
        height: var(--k-control-height);
        line-height: var(--k-line-height-secondary);
        list-style: none;
        padding: 0 var(--k-space-16);
      }

      summary::-webkit-details-marker {
        display: none;
      }

      summary:hover {
        background: var(--k-surface-raised);
      }

      /* The arrow points down when the list is open, and to the right when it is shut. */
      summary k-icon {
        color: var(--k-text-muted);
        rotate: -90deg;
        transition: rotate var(--k-motion-duration) var(--k-motion-easing);
      }

      details[open] summary k-icon {
        rotate: 0deg;
      }

      .columns {
        list-style: none;
        margin: 0;
        padding: 0 var(--k-space-16) var(--k-space-8);
      }

      .column {
        align-items: baseline;
        display: grid;
        font-size: var(--k-font-size-secondary);
        gap: var(--k-space-8);
        grid-template-columns: minmax(0, 1fr) auto auto;
        line-height: var(--k-line-height-secondary);
      }

      .column .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .column .type,
      .column .empty {
        color: var(--k-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .column .empty {
        min-width: calc(var(--k-space-48) + var(--k-space-8));
        text-align: right;
      }

      .findings {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-12);
        padding: 0 var(--k-space-16) var(--k-space-12);
      }

      .findings h4 {
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
        margin: 0 0 var(--k-space-4);
      }

      .none {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
        margin: 0;
        padding: 0 var(--k-space-16) var(--k-space-8);
      }
    `,
  ];

  /** The dataset to describe. */
  declare summary: Summary | undefined;

  constructor() {
    super();
    this.summary = undefined;
  }

  private facts(dataset: Summary) {
    const extent = extentRows(dataset);
    return html`
      <dl>
        <dt>Kind</dt>
        <dd>${KIND_NAMES[dataset.kind]}</dd>
        <dt>Size</dt>
        <dd>${describeSize(dataset)}</dd>
        ${
          dataset.vertexCount === undefined
            ? nothing
            : html`<dt>Vertices</dt>
                <dd>${formatCount(dataset.vertexCount)}</dd>`
        }
        <dt>Coordinates</dt>
        <dd title=${crsLabel(dataset.crs)}>${crsLabel(dataset.crs)}</dd>
        <dt>Heights</dt>
        <dd>${dataset.hasZ ? 'Yes (Z)' : 'No'}</dd>
        ${extent.map(
          (row) =>
            html`<dt>${row.axis}</dt>
              <dd class="extent" data-axis=${row.axis} title=${row.full}>${row.text}</dd>`,
        )}
      </dl>
    `;
  }

  private columns(dataset: Summary) {
    return html`
      <details class="columns-list">
        <summary>
          <k-icon name="chevron-down" size="16"></k-icon>Columns (${String(dataset.columns.length)})
        </summary>
        ${
          dataset.columns.length === 0
            ? html`<p class="none">No columns of its own.</p>`
            : html`<ul class="columns">
                ${dataset.columns.map(
                  (column) =>
                    html`<li class="column">
                      <span class="name" data-truncate title=${column.name}>${column.name}</span>
                      <span class="type">${TYPE_NAMES[column.type]}</span>
                      <span class="empty"
                        >${column.nullCount === 0 ? 'none empty' : `${formatCount(column.nullCount)} empty`}</span
                      >
                    </li>`,
                )}
              </ul>`
        }
      </details>
    `;
  }

  private findings(dataset: Summary) {
    const groups = groupFindings(dataset.findings);
    const warnings = groups.warnings.length;
    const notes = groups.notes.length;
    if (warnings + notes === 0) {
      return html`<p class="none">No warnings or notes.</p>`;
    }
    const title = [
      warnings > 0 ? describeWarnings(warnings) : undefined,
      notes > 0 ? `${String(notes)} ${notes === 1 ? 'note' : 'notes'}` : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(', ');
    return html`
      <details class="findings-list">
        <summary><k-icon name="chevron-down" size="16"></k-icon>${title}</summary>
        <div class="findings">
          ${
            warnings === 0
              ? nothing
              : html`<section class="group" data-severity="warning">
                  <h4>Warnings (${String(warnings)})</h4>
                  <karmania-findings .findings=${groups.warnings}></karmania-findings>
                </section>`
          }
          ${
            notes === 0
              ? nothing
              : html`<section class="group" data-severity="info">
                  <h4>Notes (${String(notes)})</h4>
                  <karmania-findings .findings=${groups.notes}></karmania-findings>
                </section>`
          }
        </div>
      </details>
    `;
  }

  override render() {
    const dataset = this.summary;
    if (dataset === undefined) {
      return nothing;
    }
    return html`${this.facts(dataset)}${this.columns(dataset)}${this.findings(dataset)}`;
  }
}

customElements.define('karmania-dataset-summary', KarmaniaDatasetSummary);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-dataset-summary': KarmaniaDatasetSummary;
  }
}
