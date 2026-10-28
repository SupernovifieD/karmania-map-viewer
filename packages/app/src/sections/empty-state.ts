import { kButton } from '@karmania/ui';
import { html } from 'lit';

/** The empty state in the containers it will be used in: the map area, a panel, and not much room. */
export function emptyStateSection() {
  return html`
    <section data-section="empty-state">
      <h2>Empty state</h2>
      <div class="row">
        <div class="empty-demo" id="empty-full">
          <k-empty-state icon="map" heading="No data yet">
            Drop files here or use Import
            <span slot="action">${kButton({ icon: 'upload', children: 'Import' })}</span>
          </k-empty-state>
        </div>
        <div class="empty-demo" id="empty-message">
          <k-empty-state>Layers will appear here once maps are rendered.</k-empty-state>
        </div>
        <div class="empty-demo small" id="empty-small">
          <k-empty-state
            icon="table"
            heading="A heading that is far longer than the little room it has"
          >
            And a line that goes on and on, with a_very_long_unbroken_word_in_the_middle_of_it
          </k-empty-state>
        </div>
      </div>
    </section>
  `;
}
