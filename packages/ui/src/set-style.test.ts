import { noChange } from 'lit';
import { PartType } from 'lit/directive.js';
import type { AttributePart, PartInfo } from 'lit/directive.js';
import { describe, expect, it } from 'vitest';
import { SetStyle } from './set-style.js';
import type { StyleProperties } from './set-style.js';

const STYLE_ATTRIBUTE: PartInfo = {
  type: PartType.ATTRIBUTE,
  name: 'style',
  strings: ['', ''],
  tagName: 'div',
};

/** An element that keeps what is done to its style, as the CSSOM would: the properties it has, and the calls in order. */
function mount() {
  const properties = new Map<string, string>();
  const calls: string[] = [];
  const element = {
    style: {
      setProperty: (name: string, value: string): void => {
        calls.push(`set ${name}: ${value}`);
        properties.set(name, value);
      },
      removeProperty: (name: string): string => {
        calls.push(`remove ${name}`);
        properties.delete(name);
        return '';
      },
    },
  };
  const directive = new SetStyle(STYLE_ATTRIBUTE);
  return {
    properties,
    calls,
    /** One render of the template with `style=${setStyle(styles)}`: what the directive gives back, which is not a text. */
    render: (styles: StyleProperties): unknown =>
      directive.update({ element } as unknown as AttributePart, [styles]),
  };
}

describe('setStyle', () => {
  it('sets every property through the style of the element on the first render, and gives no text for the attribute', () => {
    const page = mount();
    const given = page.render({ width: '10px', '--columns': 3, background: 'red' });
    // The text of `styleMap` on its first render is what a strict policy refuses; here there is none.
    expect(given).toBe(noChange);
    expect(page.calls).toEqual(['set width: 10px', 'set --columns: 3', 'set background: red']);
    expect([...page.properties]).toEqual([
      ['width', '10px'],
      ['--columns', '3'],
      ['background', 'red'],
    ]);
  });

  it('does nothing for what has not changed, sets what has, and removes what is left out', () => {
    const page = mount();
    page.render({ width: '10px', top: '1px' });
    page.calls.length = 0;
    expect(page.render({ width: '10px', top: '1px' })).toBe(noChange);
    expect(page.calls).toEqual([]);
    page.render({ width: '12px', top: '1px' });
    expect(page.calls).toEqual(['set width: 12px']);
    page.calls.length = 0;
    page.render({ width: '12px' });
    expect(page.calls).toEqual(['remove top']);
    expect([...page.properties]).toEqual([['width', '12px']]);
  });

  it('leaves out a property that is null or undefined, and sets it when it has a value again', () => {
    const page = mount();
    page.render({ width: '10px', top: null, left: undefined });
    expect([...page.properties]).toEqual([['width', '10px']]);
    page.render({ width: null, top: '2px' });
    expect([...page.properties]).toEqual([['top', '2px']]);
    expect(page.calls).toEqual(['set width: 10px', 'remove width', 'set top: 2px']);
  });

  it('is for the style attribute of an element and for nothing else', () => {
    for (const info of [
      { type: PartType.ATTRIBUTE, name: 'class', strings: ['', ''], tagName: 'div' },
      { type: PartType.PROPERTY, name: 'style', strings: ['', ''], tagName: 'div' },
      { type: PartType.CHILD },
    ] as PartInfo[]) {
      expect(() => new SetStyle(info)).toThrow(/style attribute/);
    }
  });
});
