import { kButton } from '@karmania/ui';
import type { ButtonSize, ButtonVariant } from '@karmania/ui';
import { html } from 'lit';

function assertNever(value: never): never {
  throw new Error(`Unhandled kind: ${String(value)}`);
}

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost'];
const SIZES: readonly ButtonSize[] = [32, 28];

const KINDS = ['text', 'icon-text', 'icon-only', 'disabled', 'icon-only-disabled'] as const;

function buttonOfKind(variant: ButtonVariant, size: ButtonSize, kind: (typeof KINDS)[number]) {
  const name = `(${variant}, ${String(size)})`;
  switch (kind) {
    case 'text':
      return kButton({ variant, size, children: 'Import' });
    case 'icon-text':
      return kButton({ variant, size, icon: 'upload', children: 'Import' });
    case 'icon-only':
      return kButton({ variant, size, icon: 'x', label: `Close ${name}` });
    case 'disabled':
      return kButton({ variant, size, icon: 'upload', children: 'Import', disabled: true });
    case 'icon-only-disabled':
      return kButton({
        variant,
        size,
        icon: 'x',
        label: `Close, disabled ${name}`,
        disabled: true,
      });
    default:
      return assertNever(kind);
  }
}

/** Every variant at both sizes: with words, with an icon and words, with an icon alone, disabled. */
export function buttonsSection() {
  return html`
    <section data-section="buttons">
      <h2>Button</h2>
      ${SIZES.map(
        (size) => html`
          <h3>Height ${size}</h3>
          ${VARIANTS.map(
            (variant) => html`
              <div class="row">
                <code class="row-label">${variant}</code>
                ${KINDS.map(
                  (kind) => html`
                    <div class="cell" data-variant=${variant} data-size=${size} data-kind=${kind}>
                      ${buttonOfKind(variant, size, kind)}
                    </div>
                  `,
                )}
              </div>
            `,
          )}
        `,
      )}
      <h3>A label longer than its room</h3>
      <div class="narrow" data-kind="truncated">
        ${kButton({
          variant: 'primary',
          icon: 'upload',
          children: 'Import every file in this long list of drill hole data',
        })}
      </div>
    </section>
  `;
}
