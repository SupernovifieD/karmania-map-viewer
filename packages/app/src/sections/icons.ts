import { ICON_NAMES } from '@karmania/ui';
import { html } from 'lit';

/** Every icon, at both sizes, and one that carries a meaning of its own. */
export function iconsSection() {
  return html`
    <section data-section="icons">
      <h2>Icon</h2>
      <ul class="grid">
        ${ICON_NAMES.map(
          (name) => html`
            <li data-icon=${name}>
              <span class="icon-pair">
                <k-icon name=${name}></k-icon>
                <k-icon name=${name} size="20"></k-icon>
              </span>
              <code>${name}</code>
            </li>
          `,
        )}
      </ul>
      <p>
        With a label, an icon is an image that screen readers announce:
        <k-icon id="labelled-icon" name="triangle-alert" label="Warning"></k-icon>
      </p>
    </section>
  `;
}
