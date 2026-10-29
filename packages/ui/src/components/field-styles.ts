import { css } from 'lit';

/**
 * What the form fields share (`k-select`, `k-input`): a label above the control, the control at the
 * height of a button (32, or 28 when compact), and under it a line for help or for what is wrong,
 * which can be kept free (`reserve`) so that a message appearing moves nothing.
 */
export const fieldStyles = css`
  :host {
    display: block;
    min-width: 0;
  }

  /* Positioned, so that a label hidden from the eye (which is placed absolutely) stays inside the
     field, and is clipped with it by whatever scrolls the field away. */
  .field {
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
  }

  label {
    color: var(--k-text);
    font-size: var(--k-font-size-secondary);
    font-weight: var(--k-weight-medium);
    line-height: var(--k-line-height-secondary);
    margin-bottom: var(--k-space-4);
  }

  label.visually-hidden {
    margin-bottom: 0;
  }

  .control {
    position: relative;
  }

  select,
  input {
    background: var(--k-surface);
    border: var(--k-border-width) solid var(--k-border-strong);
    border-radius: var(--k-radius-md);
    color: var(--k-text);
    font-size: var(--k-font-size-body);
    height: var(--k-control-height);
    line-height: var(--k-line-height-body);
    min-width: 0;
    padding: 0 var(--k-space-8);
    text-overflow: ellipsis;
    transition: border-color var(--k-motion-duration) var(--k-motion-easing);
    width: 100%;
  }

  :host([size='28']) select,
  :host([size='28']) input {
    font-size: var(--k-font-size-secondary);
    height: var(--k-control-height-compact);
  }

  select:hover:not(:disabled),
  input:hover:not(:disabled) {
    border-color: var(--k-text-muted);
  }

  select:disabled,
  input:disabled {
    background: var(--k-surface-raised);
    border-color: var(--k-border);
    color: var(--k-text-muted);
    cursor: not-allowed;
  }

  input::placeholder {
    color: var(--k-text-muted);
    opacity: 1;
  }

  :host([invalid]) select,
  :host([invalid]) input {
    border-color: var(--k-danger);
  }

  /* The line under the control: help in muted text, or what is wrong in the colour of errors and
     with an icon, so that it is not told by colour alone. It is there when there is something to
     say, and when asked to keep its room free. */
  .message {
    align-items: flex-start;
    display: flex;
    font-size: var(--k-font-size-caption);
    gap: var(--k-space-4);
    line-height: var(--k-line-height-caption);
    margin-top: var(--k-space-4);
  }

  :host([reserve]) .message {
    min-height: var(--k-line-height-caption);
  }

  .help {
    color: var(--k-text-muted);
  }

  .error {
    align-items: flex-start;
    color: var(--k-danger);
    display: flex;
    gap: var(--k-space-4);
    min-width: 0;
  }

  .error k-icon {
    flex: none;
  }
`;
