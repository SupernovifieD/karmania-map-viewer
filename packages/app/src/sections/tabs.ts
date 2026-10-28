import { kButton } from '@karmania/ui';
import type { TabDefinition } from '@karmania/ui';
import { html } from 'lit';

const PANEL_TABS: readonly TabDefinition[] = [
  { id: 'legend', label: 'Legend' },
  { id: 'data', label: 'Data' },
];

const CROWDED_TABS: readonly TabDefinition[] = [
  { id: 'a', label: 'Collar locations' },
  { id: 'b', label: 'Assay results by hole' },
  { id: 'c', label: 'Geology' },
];

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
      <h3>Labels longer than their room</h3>
      <div class="tabs-demo narrow-tabs" id="crowded-tabs">
        <k-tabs label="Dataset parts" .tabs=${CROWDED_TABS}>
          <div slot="a" class="tab-content">Collars</div>
          <div slot="b" class="tab-content">Assays</div>
          <div slot="c" class="tab-content">Geology</div>
        </k-tabs>
      </div>
    </section>
  `;
}
