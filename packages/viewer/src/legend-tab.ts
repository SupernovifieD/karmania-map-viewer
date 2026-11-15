import type {
  ClassEntry,
  Command,
  GroupVisibility,
  LegendGroupEntry,
  LegendLayerEntry,
  LegendModel,
} from '@karmania/scene';
import { sharedStyles } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { LegendDrag } from './legend-drag.js';
import type { DropRow } from './legend-drop.js';
import { announceMove, placeOf, stepMove } from './legend-order.js';
import type { Move } from './legend-order.js';
import { rampGradient, safeColour } from './legend-swatch.js';
import {
  expansionFor,
  itemKey,
  moveFrom,
  stillThere,
  toggleCommand,
  treeItems,
  withExpansion,
} from './legend-tree.js';
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

/** What the rows are drawn from: the row that has the stop for Tab, and every row that is shown, by its key. */
interface View {
  readonly stop: string | undefined;
  readonly items: ReadonlyMap<string, TreeItem>;
}

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
    open: { state: true },
    announcement: { state: true },
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

      .tree {
        position: relative;
      }

      /* Where the row that is dragged will land: a line of 2 over the rows, in the accent, which takes no room and no pointer. */
      .drop-line {
        background: var(--k-accent);
        height: var(--k-focus-width);
        pointer-events: none;
        position: absolute;
        transform: translateY(-50%);
      }

      :host([data-dragging]) {
        cursor: grabbing;
      }

      .row[data-dragging] {
        background: var(--k-surface-raised);
      }

      .row {
        align-items: center;
        border-radius: var(--k-radius-sm);
        user-select: none;
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

      /* The handle that a layer is dragged by, in the room of 16 that is kept on every layer: seen when the row is pointed at or has the keyboard, and, where there is no pointer to point with, always. */
      .handle {
        align-items: center;
        color: var(--k-text-muted);
        cursor: grab;
        display: flex;
        height: 100%;
        justify-content: center;
        opacity: 0;
        touch-action: none;
        transition: opacity var(--k-motion-duration) var(--k-motion-easing);
      }

      .row:hover .handle,
      .row:focus-within .handle,
      .row[data-dragging] .handle {
        opacity: 1;
      }

      @media (hover: none) {
        .handle {
          opacity: 1;
        }
      }

      /* The button that opens a layer, in the room of 28 that is kept for it on every layer: for the pointer, and not a stop for Tab (Right and Left do it from the row). */
      .open {
        align-items: center;
        color: var(--k-text-muted);
        cursor: pointer;
        display: flex;
        height: 100%;
        justify-content: center;
      }

      .open k-icon:not([data-open]) {
        transform: rotate(-90deg);
      }

      /* The class lines of a layer that is open: their swatches are under the layer's own and their counts at the right edge, where a group's is. */
      .classes {
        padding: 0 0 var(--k-space-4)
          calc(var(--k-icon-size-sm) + var(--k-space-8) + var(--k-space-24) + var(--k-space-8));
      }

      .classes[data-level='2'] {
        margin-left: var(--k-space-24);
      }

      .entry {
        align-items: center;
        display: grid;
        font-size: var(--k-font-size-secondary);
        font-variant-numeric: tabular-nums;
        gap: 0 var(--k-space-8);
        grid-template-columns: var(--k-space-12) minmax(0, 1fr) auto;
        height: var(--k-space-24);
        line-height: var(--k-line-height-secondary);
      }

      /* The line of the cells that have no value has a swatch that is only its outline: it has no colour. */
      .dot {
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: var(--k-radius-sm);
        box-sizing: border-box;
        height: var(--k-space-12);
        width: var(--k-space-12);
      }

      .figure {
        color: var(--k-text-muted);
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
  /** The ids of the layers that a person has opened (a layer is open only if it has lines to show: `treeItems`). */
  declare private open: ReadonlySet<string>;
  /** What the polite live region says: the last move, or why a row was not moved. */
  declare private announcement: string;
  /** The key of a row that was moved, which has the keyboard again once the legend that has it in its new place comes. */
  private refocus: string | undefined;
  /** Dragging a row with the pointer. */
  private readonly drag = new LegendDrag(this, (move) => {
    this.dropped(move);
  });
  /** Said twice in a row, a sentence is not read twice: a space that is not a break comes and goes at its end. */
  private spaced = false;

  constructor() {
    super();
    this.model = undefined;
    this.current = undefined;
    this.open = new Set();
    this.announcement = '';
    this.refocus = undefined;
  }

  /** A layer that has gone is not kept open for another that is given its id. */
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('model') && this.model !== undefined) {
      this.open = stillThere(this.open, this.model);
      const dragged = this.drag.dragging;
      if (dragged !== undefined && placeOf(this.model, dragged.id) === undefined) {
        this.drag.cancel();
      }
    }
  }

  /** The rows that are shown, measured now, for the drag (`DragHost`). */
  measureRows(): readonly DropRow[] {
    const model = this.model;
    const rows: DropRow[] = [];
    if (model === undefined) {
      return rows;
    }
    for (const row of this.renderRoot.querySelectorAll<HTMLElement>('.row')) {
      const group = row.dataset['group'];
      const id = group ?? row.dataset['layer'];
      const place = id === undefined ? undefined : placeOf(model, id);
      if (id === undefined || place === undefined) {
        continue;
      }
      const box = row.getBoundingClientRect();
      rows.push({
        id,
        kind: group === undefined ? 'layer' : 'group',
        parent: place.parent,
        index: place.index,
        collapsed: row.hasAttribute('data-collapsed'),
        top: box.top,
        bottom: box.bottom,
        blockBottom: row.closest('li')?.getBoundingClientRect().bottom ?? box.bottom,
        left: box.left,
      });
    }
    return rows;
  }

  /** How far in the layers of a group are, for the drag (`DragHost`). */
  indent(): number {
    return Number.parseFloat(getComputedStyle(this).getPropertyValue('--k-space-24')) || 0;
  }

  /** A press on the handle of a layer, or on the row of a group: it is a drag if the pointer goes on. */
  private press(event: PointerEvent, item: TreeItem): void {
    this.focusRow(itemKey(item));
    this.drag.press(event, item.id, item.kind);
  }

  /** A row was dropped: it is moved, and the move is said. */
  private dropped(move: Move): void {
    const model = this.model;
    if (model === undefined) {
      return;
    }
    this.say(announceMove(model, move.id, move.to));
    this.refocus = model.entries.some((entry) => entry.type === 'group' && entry.id === move.id)
      ? `group:${move.id}`
      : `layer:${move.id}`;
    this.ask({ type: 'moveNode', id: move.id, to: move.to });
  }

  /** The line where the dragged row will land, over the rows: nothing when there is no drag or no place for it. */
  private dropLine() {
    const drop = this.drag.drop;
    const tree = this.renderRoot.querySelector('.tree')?.getBoundingClientRect();
    if (drop === undefined || tree === undefined) {
      return nothing;
    }
    const style = `top: ${String(drop.y - tree.top)}px; left: ${String(drop.left - tree.left)}px; width: ${String(tree.right - drop.left)}px`;
    return html`<div class="drop-line" aria-hidden="true" style=${style}></div>`;
  }

  /** A row that was moved is in its new place now, and has the keyboard again (moving it in the page took it away). */
  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('model') && this.refocus !== undefined) {
      const key = this.refocus;
      this.refocus = undefined;
      this.focusRow(key);
    }
  }

  /** Says something in the live region. */
  private say(text: string): void {
    this.spaced = !this.spaced;
    this.announcement = this.spaced ? `${text}\u00a0` : text;
  }

  /** Moves a row by one place of its list, and says where it went or why it did not. */
  private moveRow(item: TreeItem, direction: 'up' | 'down'): void {
    if (this.model === undefined) {
      return;
    }
    const step = stepMove(this.model, item.id, direction);
    this.say(step.say);
    if (step.move !== undefined) {
      this.refocus = itemKey(item);
      this.ask({ type: 'moveNode', id: step.move.id, to: step.move.to });
    }
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
    // Escape in a drag puts the row back: nothing is moved.
    if (event.key === 'Escape' && this.drag.active) {
      event.preventDefault();
      this.drag.cancel();
      return;
    }
    // A key with Control or Command is the browser's, and so is one with Alt, but for Alt and Up or Down, which move the row.
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.altKey) {
      if (!event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        this.moveRow(item, event.key === 'ArrowUp' ? 'up' : 'down');
      }
      return;
    }
    if (isMove(event.key)) {
      event.preventDefault();
      const next = moveFrom(
        this.model === undefined ? [] : treeItems(this.model, this.open),
        itemKey(item),
        event.key,
      );
      if (next !== undefined) {
        this.focusRow(next);
      }
    } else if (event.key === ' ') {
      event.preventDefault();
      this.ask(toggleCommand(item));
    } else {
      const expanded = expansionFor(item, event.key);
      if (expanded !== undefined) {
        event.preventDefault();
        this.open = withExpansion(this.open, item.id, expanded);
      }
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

  /** The button that opens a layer, or the room that is kept for it if the layer has nothing to show. */
  private opener(item: TreeItem) {
    if (item.kind !== 'layer' || !item.expandable) {
      return html`<span class="open"></span>`;
    }
    return html`<span
      class="open"
      aria-hidden="true"
      @click=${() => {
        this.focusRow(itemKey(item));
        this.open = withExpansion(this.open, item.id, !item.expanded);
      }}
      ><k-icon name="chevron-down" size="16" ?data-open=${item.expanded}></k-icon
    ></span>`;
  }

  /** A line of a layer's classes: its colour (the cells with no value have none), its label and how many it has. */
  private entry(entry: ClassEntry) {
    return html`<div class="entry">
      <span
        class="dot"
        aria-hidden="true"
        style=${entry.colour === null ? nothing : `background: ${safeColour(entry.colour)}`}
      ></span>
      <span class="label name" data-truncate title=${entry.label}>${entry.label}</span>
      <span class="visually-hidden">, </span>
      <span class="figure">${entry.countLabel}</span>
    </div>`;
  }

  private layer(layer: LegendLayerEntry, level: 1 | 2, view: View, parent: string | null) {
    const key = `layer:${layer.id}`;
    const item = view.items.get(key);
    if (item?.kind !== 'layer') {
      return nothing;
    }
    const classes = `legend-classes-${layer.id}`;
    return html`
      <li role="none">
        <div
          class="row layer"
          role="treeitem"
          aria-level=${String(level)}
          aria-checked=${layer.visible ? 'true' : 'false'}
          aria-expanded=${item.expandable ? String(item.expanded) : nothing}
          aria-owns=${item.expanded ? classes : nothing}
          tabindex=${key === view.stop ? '0' : '-1'}
          data-level=${String(level)}
          data-layer=${layer.id}
          data-parent=${parent ?? nothing}
          data-key=${key}
          ?data-dragging=${this.drag.dragging?.id === layer.id}
          @focus=${() => {
            this.current = key;
          }}
          @keydown=${(event: KeyboardEvent) => {
            this.onKeyDown(event, item);
          }}
        >
          <span
            class="handle"
            aria-hidden="true"
            @pointerdown=${(event: PointerEvent) => {
              this.press(event, item);
            }}
            ><k-icon name="grip-vertical" size="16"></k-icon
          ></span>
          ${this.switch(item, layer.visible ? 'checked' : 'unchecked')} ${this.swatch(layer)}
          <span class="name" data-truncate title=${layer.name}>${layer.name}</span>
          <span class="notice"></span>
          ${this.opener(item)}
        </div>
        ${
          item.expanded
            ? html`<div
                class="classes"
                role="group"
                id=${classes}
                aria-label=${`Classes of ${layer.name}`}
                data-level=${String(level)}
              >
                ${layer.classes.map((entry) => this.entry(entry))}
              </div>`
            : nothing
        }
      </li>
    `;
  }

  /** A group is a row, and the list of its layers is beside it and owned by it, so that the name of the group is its own words and not those of its layers. */
  private group(group: LegendGroupEntry, view: View) {
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
          tabindex=${key === view.stop ? '0' : '-1'}
          data-level="1"
          data-group=${group.id}
          data-key=${key}
          ?data-collapsed=${group.collapsed}
          ?data-dragging=${this.drag.dragging?.id === group.id}
          @pointerdown=${(event: PointerEvent) => {
            // A group is dragged by its row (it has no handle), but not by its chevron or its switch, which are for a press.
            if (!(event.target as Element).closest('.switch, .chevron')) {
              this.press(event, item);
            }
          }}
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
                  (layer) => this.layer(layer, 2, view, group.id),
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
    const items = treeItems(model, this.open);
    const view: View = {
      stop: this.stopOf(items),
      items: new Map(items.map((item) => [itemKey(item), item])),
    };
    return html`
      <div class="top"><span>${model.layerCountLabel}</span></div>
      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        ${this.announcement}
      </div>
      <div class="tree">
        <ul role="tree" aria-label="Layers">
          ${repeat(
            model.entries,
            (entry) => `${entry.type}:${entry.id}`,
            (entry) =>
              entry.type === 'group' ? this.group(entry, view) : this.layer(entry, 1, view, null),
          )}
        </ul>
        ${this.dropLine()}
      </div>
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
