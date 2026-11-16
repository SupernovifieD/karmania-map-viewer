/**
 * A canvas context that records what it is asked, for the tests of the drawing of the exported picture (there is no canvas in the unit tests): every call is a line
 * `name(arguments)`, and a change of a property is a line `name = value`. Text is measured as `width` pixels for each character, in the size of the font, so that the layout
 * of a test does not depend on a font.
 */
import type { Canvas2d } from './canvas-2d.js';

export interface Recording {
  readonly ctx: Canvas2d;
  readonly log: string[];
}

const round = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The size in pixels that a font string says (`500 14px Inter`), or 10. */
export function fontSize(font: string): number {
  return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
}

export function recording(): Recording {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  /** The font that is set, as text: the size of a character in a test is half of it. */
  const fontNow = (): string => (typeof state['font'] === 'string' ? state['font'] : '10px x');
  const call =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(
        `${name}(${args
          .map((a) => (typeof a === 'number' ? round(a) : typeof a === 'string' ? a : '[path]'))
          .join(', ')})`,
      );
    };
  const ctx = {
    save: call('save'),
    restore: call('restore'),
    translate: call('translate'),
    rotate: call('rotate'),
    scale: call('scale'),
    beginPath: call('beginPath'),
    moveTo: call('moveTo'),
    lineTo: call('lineTo'),
    closePath: call('closePath'),
    roundRect: call('roundRect'),
    rect: call('rect'),
    clip: call('clip'),
    fill: call('fill'),
    stroke: call('stroke'),
    fillRect: call('fillRect'),
    strokeRect: call('strokeRect'),
    fillText: call('fillText'),
    measureText: (text: string) => ({
      width: text.length * fontSize(fontNow()) * 0.5,
    }),
  } as Record<string, unknown>;
  for (const name of [
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'font',
    'textAlign',
    'textBaseline',
  ]) {
    Object.defineProperty(ctx, name, {
      get: () => state[name],
      set: (value: unknown) => {
        state[name] = value;
        log.push(`${name} = ${typeof value === 'number' ? round(value) : String(value)}`);
      },
    });
  }
  return { ctx: ctx as unknown as Canvas2d, log };
}
