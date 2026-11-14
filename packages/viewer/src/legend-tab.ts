import type { LegendGroupEntry, LegendLayerEntry, LegendModel } from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { rampGradient, safeColour } from './legend-swatch.js';

/**
 * The Legend tab: the layers of the map as a tree, with one level of groups (section 10.3 of the brief), drawn from the legend model, which is also what
 * the exported legend is drawn from. The empty state of phase 1 stays while there are no layers.
 *
 * A row is 32 high. A layer's row is, from the left: the room of its drag handle (16), the room of its visibility box (16), its swatch (a colour,
 * 16 by 16, or its classes side by side, 24 by 12, in a room of 24, so that the names of all the layers of a level start at one place), its name, the
 * room of its notice (16) and the room of its button that opens it (28). A group's row is its chevron and the room of its box, which are in the places of
 * a layer's handle and box, then its name, and how many layers it has. The room of a control is kept, whether or not the control is there yet, so that
 * a control that comes later moves nothing. The layers of a group are 24 in from its edge.
 *
 * The tab shows what it is given (`model`) and does not change it.
 */
export class KarmaniaLegendTab extends LitElement {
  static override properties = {
    model: { attribute: false },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-8);
        min-width: 0;
      }

      :host([hidden]) {
        display: none;
      }

      k-empty-state {
        flex: 1 1 auto;
        min-height: 0;
      }

      .top {
        align-items: center;
        color: var(--k-text-muted);
        display: flex;
        font-size: var(--k-font-size-caption);
        height: var(--k-control-height);
        justify-content: space-between;
        line-height: var(--k-line-height-caption);
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .row {
        align-items: center;
        border-radius: var(--k-radius-sm);
        display: grid;
        gap: 0 var(--k-space-8);
        height: var(--k-control-height);
        min-width: 0;
      }

      .row:hover {
        background: var(--k-surface-raised);
      }

      /* A layer: handle, box, swatch, name, notice, button. */
      .layer {
        grid-template-columns:
          var(--k-icon-size-sm) var(--k-icon-size-sm) var(--k-space-24) minmax(0, 1fr)
          var(--k-icon-size-sm) var(--k-control-height-compact);
      }

      /* A group: chevron (where a layer has its handle), box (where a layer has its box), name, count. */
      .group {
        grid-template-columns: var(--k-icon-size-sm) var(--k-icon-size-sm) minmax(0, 1fr) auto;
      }

      /* The layers of a group are 24 in. */
      .row[data-level='2'] {
        margin-left: var(--k-space-24);
      }

      .chevron {
        color: var(--k-text-muted);
      }

      .group[data-collapsed] .chevron {
        transform: rotate(-90deg);
      }

      .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .group .name {
        font-weight: var(--k-weight-medium);
      }

      .count {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }

      /* The room of 24 has a colour of 16 by 16 or the classes of 24 by 12, at its left, in the middle of the row. */
      .swatch {
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-sm);
        box-sizing: border-box;
        height: var(--k-icon-size-sm);
        width: var(--k-icon-size-sm);
      }

      .swatch.ramp {
        height: var(--k-space-12);
        width: var(--k-space-24);
      }
    `,
  ];

  /** The legend to draw, or `undefined` before there is one. */
  declare model: LegendModel | undefined;

  constructor() {
    super();
    this.model = undefined;
  }

  private swatch(layer: LegendLayerEntry) {
    const { swatch } = layer;
    return swatch.kind === 'colour'
      ? html`<span
          class="swatch"
          aria-hidden="true"
          style=${`background: ${safeColour(swatch.colour)}`}
        ></span>`
      : html`<span
          class="swatch ramp"
          aria-hidden="true"
          style=${`background: ${rampGradient(swatch.colours)}`}
        ></span>`;
  }

  private layer(layer: LegendLayerEntry, level: 1 | 2) {
    return html`
      <li role="none">
        <div
          class="row layer"
          role="treeitem"
          aria-level=${String(level)}
          data-level=${String(level)}
          data-layer=${layer.id}
        >
          <span class="handle"></span>
          <span class="box"></span>
          ${this.swatch(layer)}
          <span class="name" data-truncate title=${layer.name}>${layer.name}</span>
          <span class="notice"></span>
          <span class="open"></span>
        </div>
      </li>
    `;
  }

  /** A group is a row, and the list of its layers is beside it and owned by it, so that the name of the group is its own words and not those of its layers. */
  private group(group: LegendGroupEntry) {
    const items = `legend-items-${group.id}`;
    return html`
      <li role="none">
        <div
          class="row group"
          role="treeitem"
          aria-level="1"
          aria-expanded=${group.collapsed ? 'false' : 'true'}
          aria-owns=${group.collapsed ? nothing : items}
          data-level="1"
          data-group=${group.id}
          ?data-collapsed=${group.collapsed}
        >
          <k-icon class="chevron" name="chevron-down" size="16" aria-hidden="true"></k-icon>
          <span class="box"></span>
          <span class="name" data-truncate title=${group.name}>${group.name}</span>
          <span class="count">${String(group.layers.length)}</span>
        </div>
        ${
          group.collapsed
            ? nothing
            : html`<ul role="group" id=${items}>
                ${group.layers.map((layer) => this.layer(layer, 2))}
              </ul>`
        }
      </li>
    `;
  }

  override render() {
    const model = this.model;
    if (model === undefined || model.layerCount === 0) {
      return html`<k-empty-state>Layers will appear here once maps are rendered.</k-empty-state>`;
    }
    return html`
      <div class="top"><span>${model.layerCountLabel}</span></div>
      <ul role="tree" aria-label="Layers">
        ${model.entries.map((entry) =>
          entry.type === 'group' ? this.group(entry) : this.layer(entry, 1),
        )}
      </ul>
    `;
  }
}

customElements.define('karmania-legend-tab', KarmaniaLegendTab);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-legend-tab': KarmaniaLegendTab;
  }
}
