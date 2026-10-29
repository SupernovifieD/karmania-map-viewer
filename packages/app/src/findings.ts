import type { Finding, Severity } from '@karmania/engine';
import { kButton, sharedStyles } from '@karmania/ui';
import type { IconName } from '@karmania/ui';
import { css, html, LitElement, nothing } from 'lit';
import { describeOccurrences, SEVERITY_NAMES } from './findings-text.js';
import { IMPORT_STEPS } from './import-steps.js';

/** The name of the event a finding's link sends: a person asked to go to the step that can fix it. */
export const GO_TO_STEP = 'karmania-go-step';

/** Where a person asked to go. */
export interface GoToStep {
  readonly step: string;
}

/** The icon of each severity: they differ by shape, not only by colour. */
const SEVERITY_ICONS: Readonly<Record<Severity, IconName>> = {
  error: 'circle-alert',
  warning: 'triangle-alert',
  info: 'info',
};

/**
 * A list of findings, for people: for each, an icon for its severity (a circle with a mark for an
 * error, a triangle for a warning, an "i" for a note), what it says, what can be done about it, and,
 * for one that happened more than once, how often and where. The severity is also said in words that
 * are not drawn, for those who cannot see the icon.
 */
export class KarmaniaFindings extends LitElement {
  static override properties = {
    findings: { attribute: false },
    stepLinks: { type: Boolean },
  };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      ul {
        display: flex;
        flex-direction: column;
        gap: var(--k-space-12);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      li {
        display: flex;
        gap: var(--k-space-8);
        min-width: 0;
      }

      k-icon {
        flex: none;
        /* The icon is 16 high and the first line of text is 20: this centres one on the other. */
        margin-top: var(--k-space-2);
      }

      li[data-severity='error'] k-icon {
        color: var(--k-danger);
      }

      li[data-severity='warning'] k-icon {
        color: var(--k-warning);
      }

      li[data-severity='info'] k-icon {
        color: var(--k-info);
      }

      .text {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      /* Positioned, so that the severity said for those who cannot see (placed absolutely) stays
         with the finding and is clipped with it when what scrolls it away does. */
      .message {
        font-weight: var(--k-weight-medium);
        position: relative;
      }

      .link {
        margin-top: var(--k-space-8);
      }

      .hint,
      .occurrences {
        color: var(--k-text-muted);
        font-size: var(--k-font-size-secondary);
        line-height: var(--k-line-height-secondary);
      }
    `,
  ];

  /** What was found, in the order to show it. */
  declare findings: readonly Finding[];
  /** Whether a finding that a step can fix has a link to that step. */
  declare stepLinks: boolean;

  constructor() {
    super();
    this.findings = [];
    this.stepLinks = false;
  }

  /** The link to the step that can fix a finding, if it has one and links are wanted. */
  private link(finding: Finding) {
    const step = finding.step;
    const label = IMPORT_STEPS.find((known) => known.id === step)?.label;
    if (!this.stepLinks || step === undefined || label === undefined) {
      return nothing;
    }
    return html`<div class="link">
      ${kButton({
        children: `Fix in the ${label} step`,
        variant: 'secondary',
        size: 28,
        onClick: () => {
          this.dispatchEvent(
            new CustomEvent<GoToStep>(GO_TO_STEP, {
              detail: { step },
              bubbles: true,
              composed: true,
            }),
          );
        },
      })}
    </div>`;
  }

  override render() {
    if (this.findings.length === 0) {
      return nothing;
    }
    return html`
      <ul>
        ${this.findings.map((finding) => {
          const occurrences = describeOccurrences(finding);
          return html`
            <li data-severity=${finding.severity} data-code=${finding.code}>
              <k-icon name=${SEVERITY_ICONS[finding.severity]} size="16"></k-icon>
              <div class="text">
                <div class="message">
                  <span class="visually-hidden">${SEVERITY_NAMES[finding.severity]}: </span
                  >${finding.message}
                </div>
                ${finding.hint === undefined ? nothing : html`<div class="hint">${finding.hint}</div>`}
                ${
                  occurrences === undefined
                    ? nothing
                    : html`<div class="occurrences">${occurrences}</div>`
                }
                ${this.link(finding)}
              </div>
            </li>
          `;
        })}
      </ul>
    `;
  }
}

customElements.define('karmania-findings', KarmaniaFindings);

declare global {
  interface HTMLElementTagNameMap {
    'karmania-findings': KarmaniaFindings;
  }

  interface HTMLElementEventMap {
    [GO_TO_STEP]: CustomEvent<GoToStep>;
  }
}
