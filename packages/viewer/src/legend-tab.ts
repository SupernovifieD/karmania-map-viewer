import type {
  Command,
  GroupVisibility,
  LegendGroupEntry,
  LegendLayerEntry,
  LegendModel,
} from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { rampGradient, safeColour } from './legend-swatch.js';
import { itemKey, moveFrom, toggleCommand, treeItems } from './legend-tree.js';
import type { MoveKey, TreeItem } from './legend-tree.js';

/** The name of the event the tab sends when a person asks something of the scene. */
export const LEGEND_COMMAND = 'karmania-legend-command';

/** What the tab asks of the scene: a command, which the viewer gives to it. */
export interface LegendCommand {
  readonly command: Command;
}

/** How a group's box looks, and what the row says of it to a screen reader, for all, some and none of its layers on. */
const BOX: Record<GroupVisibility, 'checked' | 'mixed' | 'unchecked'> = {
  all: 'checked',
  some: 'mixed',
  none: 'unchecked',
};
const CHECKED: Record<GroupVisibility, 'true' | 'mixed' | 'false'> = {
  all: 'true',
  some: 'mixed',
  none: 'false',
};

const MOVES: readonly string[] = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

function isMove(key: string): key is MoveKey {
  return MOVES.includes(key);
}

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
 * The tree has one stop for Tab, the row that last had the keyboard (the first before any has), and the arrow keys, Home and End move between the rows
 * (`moveFrom`); Space switches the row, and a pointer on its box does. A row says whether it is on in `aria-checked` (`mixed` for a group with some of its
 * layers on), and its box is for the eye and the pointer. The tab does not change the scene: it says what a person asked (`karmania-legend-command`, with a
 * command) and shows what it is given (`model`).
 */
export class KarmaniaLegendTab extends LitElement {
  static override properties = {
    model: { attribute: false },
    current: { state: true },
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

      /* The row that has the keyboard has its ring inside it, where no scroll area can clip it. */
      .row:focus-visible {
        outline: var(--k-focus-width) solid var(--k-accent);
        outline-offset: calc(var(--k-focus-width) * -1);
      }

      /* A layer that is off has its name muted. */
      .layer[aria-checked='false'] .name {
        color: var(--k-text-muted);
      }

      /* The switch: a room of 24 by the height of the row, which takes the pointer (24 is the least a target is), with the box of 16 in the middle of it, ticked,
         or with a bar for a group that has some of its layers on. */
      .switch {
        align-items: center;
        cursor: pointer;
        display: flex;
        height: 100%;
        justify-content: center;
      }

      .tick {
        background: var(--k-surface);
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-sm);
        box-sizing: border-box;
        color: var(--k-on-accent);
        height: var(--k-icon-size-sm);
        position: relative;
        width: var(--k-icon-size-sm);
      }

      .switch:hover .tick {
        border-color: var(--k-text-muted);
      }

      .tick[data-state='checked'],
      .tick[data-state='mixed'] {
        background: var(--k-accent);
        border-color: var(--k-accent);
      }

      /* The mark is the size of the whole box, over its border. */
      .tick k-icon {
        inset: calc(var(--k-border-width) * -1);
        opacity: 0;
        pointer-events: none;
        position: absolute;
      }

      .tick[data-state='checked'] k-icon,
      .tick[data-state='mixed'] k-icon {
        opacity: 1;
      }

      /* A layer: handle, switch (24, with its box of 16 in the middle), swatch, name, notice, button. */
      .layer {
        grid-template-columns:
          var(--k-icon-size-sm) var(--k-space-24) var(--k-space-24) minmax(0, 1fr)
          var(--k-icon-size-sm) var(--k-control-height-compact);
      }

      /* A group: chevron (where a layer has its handle), switch (where a layer has its switch), name, count. */
      .group {
        grid-template-columns: var(--k-icon-size-sm) var(--k-space-24) minmax(0, 1fr) auto;
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
  /** The key of the row that last had the keyboard, which is the row with the stop for Tab if it is still a row. */
  declare private current: string | undefined;

  constructor() {
    super();
    this.model = undefined;
    this.current = undefined;
  }

  /** Asks the scene for something. */
  private ask(command: Command): void {
    this.dispatchEvent(
      new CustomEvent<LegendCommand>(LEGEND_COMMAND, {
        detail: { command },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** The key of the row that has the stop for Tab: the one that last had the keyboard if it is still a row, and the first if not. */
  private stopOf(items: readonly TreeItem[]): string | undefined {
    const keys = items.map(itemKey);
    return this.current !== undefined && keys.includes(this.current) ? this.current : keys[0];
  }

  /** Puts the keyboard on a row, which is then the one with the stop. */
  private focusRow(key: string): void {
    this.current = key;
    this.renderRoot.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }

  private onKeyDown(event: KeyboardEvent, item: TreeItem): void {
    // A key with Alt, Control or Command is the browser's, or another step's, and is left alone.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (isMove(event.key)) {
      event.preventDefault();
      const next = moveFrom(
        this.model === undefined ? [] : treeItems(this.model),
        itemKey(item),
        event.key,
      );
      if (next !== undefined) {
        this.focusRow(next);
      }
    } else if (event.key === ' ') {
      event.preventDefault();
      this.ask(toggleCommand(item));
    }
  }

  /** The switch of a row: its box, and the room that takes the pointer. */
  private switch(item: TreeItem, state: 'checked' | 'unchecked' | 'mixed') {
    return html`<span
      class="switch"
      aria-hidden="true"
      @click=${() => {
        this.focusRow(itemKey(item));
        this.ask(toggleCommand(item));
      }}
      ><span class="tick" data-state=${state}
        ><k-icon name=${state === 'mixed' ? 'minus' : 'check'} size="16"></k-icon></span
    ></span>`;
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

  private layer(layer: LegendLayerEntry, level: 1 | 2, stop: string | undefined) {
    const item: TreeItem = { kind: 'layer', id: layer.id, level, visible: layer.visible };
    const key = itemKey(item);
    return html`
      <li role="none">
        <div
          class="row layer"
          role="treeitem"
          aria-level=${String(level)}
          aria-checked=${layer.visible ? 'true' : 'false'}
          tabindex=${key === stop ? '0' : '-1'}
          data-level=${String(level)}
          data-layer=${layer.id}
          data-key=${key}
          @focus=${() => {
            this.current = key;
          }}
          @keydown=${(event: KeyboardEvent) => {
            this.onKeyDown(event, item);
          }}
        >
          <span class="handle"></span>
          ${this.switch(item, layer.visible ? 'checked' : 'unchecked')} ${this.swatch(layer)}
          <span class="name" data-truncate title=${layer.name}>${layer.name}</span>
          <span class="notice"></span>
          <span class="open"></span>
        </div>
      </li>
    `;
  }

  /** A group is a row, and the list of its layers is beside it and owned by it, so that the name of the group is its own words and not those of its layers. */
  private group(group: LegendGroupEntry, stop: string | undefined) {
    const items = `legend-items-${group.id}`;
    const item: TreeItem = {
      kind: 'group',
      id: group.id,
      level: 1,
      collapsed: group.collapsed,
      visibility: group.visibility,
    };
    const key = itemKey(item);
    return html`
      <li role="none">
        <div
          class="row group"
          role="treeitem"
          aria-level="1"
          aria-expanded=${group.collapsed ? 'false' : 'true'}
          aria-checked=${CHECKED[group.visibility]}
          aria-owns=${group.collapsed ? nothing : items}
          tabindex=${key === stop ? '0' : '-1'}
          data-level="1"
          data-group=${group.id}
          data-key=${key}
          ?data-collapsed=${group.collapsed}
          @focus=${() => {
            this.current = key;
          }}
          @keydown=${(event: KeyboardEvent) => {
            this.onKeyDown(event, item);
          }}
        >
          <k-icon class="chevron" name="chevron-down" size="16" aria-hidden="true"></k-icon>
          ${this.switch(item, BOX[group.visibility])}
          <span class="name" data-truncate title=${group.name}>${group.name}</span>
          <span class="count">${String(group.layers.length)}</span>
        </div>
        ${
          group.collapsed
            ? nothing
            : html`<ul role="group" id=${items}>
                ${repeat(
                  group.layers,
                  (layer) => layer.id,
                  (layer) => this.layer(layer, 2, stop),
                )}
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
    const stop = this.stopOf(treeItems(model));
    return html`
      <div class="top"><span>${model.layerCountLabel}</span></div>
      <ul role="tree" aria-label="Layers">
        ${repeat(
          model.entries,
          (entry) => `${entry.type}:${entry.id}`,
          (entry) =>
            entry.type === 'group' ? this.group(entry, stop) : this.layer(entry, 1, stop),
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

  interface HTMLElementEventMap {
    [LEGEND_COMMAND]: CustomEvent<LegendCommand>;
  }
}
