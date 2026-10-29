import { css, html, LitElement, nothing } from 'lit';
import { defineOnce } from '../define.js';
import { sharedStyles } from '../shared-styles.js';
import './icon.js';

/** One step of a sequence: a name for the code, and the words a person reads. */
export interface StepDefinition {
  readonly id: string;
  readonly label: string;
}

/** How far along a step is: behind the current one, the current one, or still to come. */
type StepState = 'done' | 'current' | 'pending';

/**
 * Where a person is in a sequence of steps, such as a wizard: a row of numbered, labelled steps.
 *
 * ```html
 * <k-steps label="Import steps" current="mapping" .steps=${[{ id: 'file', label: 'File' }, ...]}></k-steps>
 * ```
 *
 * The steps before the current one are done, the ones after it are still to come. The three are
 * told apart by more than colour: a done step has a tick in an outlined circle, the current one a
 * number in a filled circle and a bold label, and one still to come a number in a grey circle.
 * Screen readers are told `current` with `aria-current="step"`, and "done" and "to do" in words
 * that are not drawn. The row is information, not a control: it takes no focus.
 */
export class KSteps extends LitElement {
  static override properties = {
    steps: { attribute: false },
    current: { type: String },
    label: { type: String },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      ol {
        align-items: center;
        display: flex;
        gap: var(--k-space-8);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      /* Each step but the last is followed by a line that takes up the room that is left. */
      li {
        align-items: center;
        display: flex;
        flex: 1 1 auto;
        gap: var(--k-space-8);
        min-width: 0;
        position: relative;
      }

      li:last-child {
        flex: none;
      }

      li:not(:last-child)::after {
        background: var(--k-border-strong);
        content: '';
        flex: 1 1 auto;
        height: var(--k-border-width);
        min-width: var(--k-space-8);
      }

      li[data-state='done']:not(:last-child)::after {
        background: var(--k-accent);
      }

      .marker {
        align-items: center;
        border: var(--k-border-width) solid var(--k-border-strong);
        border-radius: 50%;
        color: var(--k-text-muted);
        display: flex;
        flex: none;
        font-size: var(--k-font-size-caption);
        font-variant-numeric: tabular-nums;
        font-weight: var(--k-weight-medium);
        height: var(--k-space-24);
        justify-content: center;
        line-height: var(--k-line-height-caption);
        width: var(--k-space-24);
      }

      li[data-state='done'] .marker {
        border-color: var(--k-accent);
        color: var(--k-accent);
      }

      li[data-state='current'] .marker {
        background: var(--k-accent);
        border-color: var(--k-accent);
        color: var(--k-on-accent);
      }

      .name {
        color: var(--k-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      li[data-state='done'] .name {
        color: var(--k-text);
      }

      li[data-state='current'] .name {
        color: var(--k-text);
        font-weight: var(--k-weight-medium);
      }

      .visually-hidden {
        clip-path: inset(50%);
        height: var(--k-border-width);
        margin: calc(var(--k-border-width) * -1);
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
        width: var(--k-border-width);
      }
    `,
  ];

  /** The steps, in order. */
  declare steps: readonly StepDefinition[];
  /** The `id` of the step a person is on. */
  declare current: string;
  /** What the row is called, for people who cannot see it. */
  declare label: string;

  constructor() {
    super();
    this.steps = [];
    this.current = '';
    this.label = 'Steps';
  }

  private stateOf(index: number): StepState {
    const at = this.steps.findIndex((step) => step.id === this.current);
    if (index === at) {
      return 'current';
    }
    return index < at ? 'done' : 'pending';
  }

  override render() {
    return html`
      <ol aria-label=${this.label}>
        ${this.steps.map((step, index) => {
          const state = this.stateOf(index);
          return html`
            <li
              data-step=${step.id}
              data-state=${state}
              aria-current=${state === 'current' ? 'step' : nothing}
            >
              <span class="marker" aria-hidden="true">
                ${
                  state === 'done'
                    ? html`<k-icon name="check" size="16"></k-icon>`
                    : String(index + 1)
                }
              </span>
              <span class="name" data-truncate>${step.label}</span>
              ${
                state === 'current'
                  ? nothing
                  : html`<span class="visually-hidden"
                      >${state === 'done' ? ', done' : ', to do'}</span
                    >`
              }
            </li>
          `;
        })}
      </ol>
    `;
  }
}

defineOnce('k-steps', KSteps);

declare global {
  interface HTMLElementTagNameMap {
    'k-steps': KSteps;
  }
}
