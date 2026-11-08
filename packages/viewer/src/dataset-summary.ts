import type { CrsInfo, Summary } from '@karmania/engine';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { crsLabelNamed, crsTitleNamed, describeWarnings, extentRows } from './datasets.js';
import type { CrsLookup } from './datasets.js';
import { withoutNotDrawn } from './finding-text.js';
import './findings.js';
import { groupFindings } from './import-run.js';
import { describeSize, formatCount, KIND_NAMES } from './import-files.js';
import { TYPE_NAMES } from './import-mapping.js';

/**
 * What a person wants to know about the dataset that is selected, in the Data tab: what kind it is
 * and how much there is of it, the coordinate system (the code with its name and unit, from the
 * definitions the engine has, or a local grid with its units), whether it has heights, the box round it, and, to be opened, its columns and the warnings
 * and notes the import left about it. The two lists are closed to begin with: they can be long, and
 * the table under them is what the tab is for.
 */
export class KarmaniaDatasetSummary extends LitElement {
  static override properties = {
    summary: { attribute: false },
    crsInfo: { attribute: false },
    notice: { attribute: false },
    names: { state: true },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      /* A dataset that is not drawn says so at the top, with the reason and what to do about it. */
      .notice {
        align-items: flex-start;
        border-bottom: var(--k-border-width) solid var(--k-border);
        display: grid;
        gap: var(--k-space-8);
        grid-template-columns: var(--k-icon-size-sm) minmax(0, 1fr);
        padding: var(--k-space-8) var(--k-space-16);
      }

      .notice k-icon {
        color: var(--k-warning);
        margin-top: var(--k-space-2);
      }

      .notice strong {
        font-size: var(--k-font-size-secondary);
        font-weight: var(--k-weight-medium);
        line-height: var(--k-line-height-secondary);
      }

      .notice p {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
        margin: 0;
        overflow-wrap: anywhere;
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

      /* The coordinate system is named in words: it takes two lines, and the title has the whole of it. */
      dd.system {
        -webkit-box-orient: vertical;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow-wrap: anywhere;
        white-space: normal;
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

      .findings h2 {
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
  /** What says what an EPSG code means; without it the code is shown as it is. */
  declare crsInfo: CrsLookup | undefined;
  /** Why the dataset is not drawn on the map, with what to do about it; `undefined` while it is, or is being prepared. */
  declare notice: string | undefined;
  /** What it said of the codes it was asked about: the system, or `null` for a code that is not in the definitions. */
  declare names: ReadonlyMap<number, CrsInfo | null>;
  /** The codes it has been asked about, so that none is asked twice. */
  private readonly asked = new Set<number>();

  constructor() {
    super();
    this.summary = undefined;
    this.crsInfo = undefined;
    this.notice = undefined;
    this.names = new Map();
  }

  protected override willUpdate(): void {
    const crs = this.summary?.crs;
    const lookUp = this.crsInfo;
    if (crs?.kind !== 'epsg' || lookUp === undefined || this.asked.has(crs.code)) {
      return;
    }
    this.asked.add(crs.code);
    void this.ask(lookUp, crs.code);
  }

  /** Asks what a code means, and keeps the answer for the next time the summary is drawn. */
  private async ask(lookUp: CrsLookup, code: number): Promise<void> {
    try {
      const info = await lookUp(code);
      this.names = new Map(this.names).set(code, info ?? null);
    } catch {
      // If it cannot say, or throws, the code is shown as it is, and is asked about again when the
      // summary is next made. Nothing else of the summary is lost for it.
      this.asked.delete(code);
    }
  }

  /** Says that the dataset is not drawn, and why. */
  private notices() {
    return this.notice === undefined
      ? nothing
      : html`<div class="notice" role="note">
          <k-icon name="triangle-alert" size="16"></k-icon>
          <div>
            <strong>Not drawn on the map</strong>
            <!-- The engine's words begin with "Not drawn: ", which the line above has said. -->
            <p>${withoutNotDrawn(this.notice)}</p>
          </div>
        </div>`;
  }

  private facts(dataset: Summary) {
    const extent = extentRows(dataset);
    const named = dataset.crs?.kind === 'epsg' ? this.names.get(dataset.crs.code) : undefined;
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
        <dd class="system" data-truncate title=${crsTitleNamed(dataset.crs, named)}>
          ${crsLabelNamed(dataset.crs, named)}
        </dd>
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
                  <h2>Warnings (${String(warnings)})</h2>
                  <karmania-findings .findings=${groups.warnings}></karmania-findings>
                </section>`
          }
          ${
            notes === 0
              ? nothing
              : html`<section class="group" data-severity="info">
                  <h2>Notes (${String(notes)})</h2>
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
    return html`${this.notices()}${this.facts(dataset)}${this.columns(dataset)}${this.findings(dataset)}`;
  }
}

customElements.define('karmania-dataset-summary', KarmaniaDatasetSummary);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-dataset-summary': KarmaniaDatasetSummary;
  }
}
