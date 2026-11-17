import { noChange } from 'lit';
import { Directive, directive, PartType } from 'lit/directive.js';
import type { AttributePart, DirectiveParameters, PartInfo } from 'lit/directive.js';

/** The style properties of an element, by their CSS names (`background`, `width`, `--columns`): a `null` or an `undefined` leaves a property out. */
export type StyleProperties = Readonly<Record<string, string | number | null | undefined>>;

/**
 * Sets the inline style of an element from properties, as `style=${setStyle({ width: '10px' })}`, and only through the element's CSSOM (`style.setProperty`).
 *
 * It is what Lit's own `styleMap` is not, for a page under a strict Content Security Policy (no `'unsafe-inline'` for styles): the first render of `styleMap`
 * writes the `style` attribute as text, which such a policy refuses, and only the renders after that use the CSSOM, which it does not govern. Here no render
 * writes text, so the properties are there from the first one. A property that a later render leaves out is removed.
 */
export class SetStyle extends Directive {
  /** What was set, by name, so that a render sets only what changed. */
  private readonly set = new Map<string, string>();

  constructor(info: PartInfo) {
    super(info);
    if (info.type !== PartType.ATTRIBUTE || info.name !== 'style') {
      throw new Error(
        'setStyle is the value of the style attribute of an element: style=${setStyle({...})}.',
      );
    }
  }

  /** What the directive gives where a template is rendered to text: nothing (the properties are set on the element, not written). */
  // The signature of a directive: `render` takes what `update` takes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(properties: StyleProperties): typeof noChange {
    return noChange;
  }

  override update(part: AttributePart, [properties]: DirectiveParameters<this>): typeof noChange {
    const { style } = part.element;
    const now = new Map<string, string>();
    for (const [name, value] of Object.entries(properties)) {
      if (value !== null && value !== undefined) {
        now.set(name, String(value));
      }
    }
    for (const name of this.set.keys()) {
      if (!now.has(name)) {
        style.removeProperty(name);
      }
    }
    for (const [name, value] of now) {
      if (this.set.get(name) !== value) {
        style.setProperty(name, value);
      }
    }
    this.set.clear();
    for (const [name, value] of now) {
      this.set.set(name, value);
    }
    return noChange;
  }
}

export const setStyle = directive(SetStyle);
