import { kButton } from '@karmania/ui';
import type { TabDefinition } from '@karmania/ui';
import { html } from 'lit';

const PANEL_TABS: readonly TabDefinition[] = [
  { id: 'legend', label: 'Legend' },
  { id: 'data', label: 'Data' },
];

const ACTION_TABS: readonly TabDefinition[] = [
  { id: 'layers', label: 'Layers' },
  { id: 'table', label: 'Table' },
];

const CROWDED_ACTION_TABS: readonly TabDefinition[] = [
  { id: 'a', label: 'Drill hole collars' },
  { id: 'b', label: 'Assay interval results' },
  { id: 'c', label: 'Lithology' },
];

const CROWDED_TABS: readonly TabDefinition[] = [
  { id: 'a', label: 'Collar locations' },
  { id: 'b', label: 'Assay results by hole' },
  { id: 'c', label: 'Geology' },
];

const LINES = Array.from({ length: 24 }, (_, line) => `Layer ${String(line + 1)}`);

/** The collapse button the side panel puts at the end of its row of tabs. */
const collapse = () =>
  html`<k-tooltip slot="actions" text="Collapse panel"
    >${kButton({ icon: 'chevrons-right', label: 'Collapse panel', variant: 'ghost' })}</k-tooltip
  >`;

/** Tabs as the side panel will use them, and tabs with more to say than they have room for. */
export function tabsSection() {
  return html`
    <section data-section="tabs">
      <h2>Tabs</h2>
      <div class="tabs-demo" id="panel-tabs">
        <k-tabs label="Side panel" .tabs=${PANEL_TABS} selected="legend">
          <div slot="legend" class="tab-content">
            <p>Layers will appear here once maps are rendered.</p>
            <input id="legend-input" aria-label="Notes" />
          </div>
          <div slot="data" class="tab-content">
            <p>No datasets yet.</p>
            ${kButton({ icon: 'upload', children: 'Import' })}
          </div>
        </k-tabs>
      </div>
      <h3>An action at the end of the row, and a panel that scrolls in a set height</h3>
      <div class="tabs-demo with-action tall-tabs" id="action-tabs">
        <k-tabs label="Panel with an action" .tabs=${ACTION_TABS} selected="layers">
          ${collapse()}
          <div slot="layers" class="scroll-body" data-scroll-region>
            ${LINES.map((line) => html`<p>${line}</p>`)}
          </div>
          <div slot="table" class="scroll-body" data-scroll-region>
            <p>No rows yet.</p>
          </div>
        </k-tabs>
      </div>
      <h3>Labels longer than their room</h3>
      <div class="tabs-demo narrow-tabs" id="crowded-tabs">
        <k-tabs label="Dataset parts" .tabs=${CROWDED_TABS}>
          <div slot="a" class="tab-content">Collars</div>
          <div slot="b" class="tab-content">Assays</div>
          <div slot="c" class="tab-content">Geology</div>
        </k-tabs>
      </div>
      <h3>An action, and labels longer than their room</h3>
      <div class="tabs-demo with-action narrow-tabs" id="crowded-action-tabs">
        <k-tabs label="Dataset parts with an action" .tabs=${CROWDED_ACTION_TABS}>
          ${collapse()}
          <div slot="a" class="tab-content">Collars</div>
          <div slot="b" class="tab-content">Assays</div>
          <div slot="c" class="tab-content">Geology</div>
        </k-tabs>
      </div>
    </section>
  `;
}
